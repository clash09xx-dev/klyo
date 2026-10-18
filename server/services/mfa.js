const crypto = require("crypto"),
  jwt = require("jsonwebtoken"),
  bcrypt = require("bcryptjs"),
  db = require("../db"),
  S = require("./sharepoint");
const fail = (m, status = 400) => Object.assign(new Error(m), { status });
const hash = (s) =>
  crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(String(s))
    .digest("hex");
const configured = () =>
  !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    /^VA[\da-f]{32}$/i.test(process.env.TWILIO_VERIFY_SERVICE_SID || "")
  );
const phone = (s) => {
  if (typeof s !== "string" || !/^\+[1-9]\d{7,14}$/.test(s))
    throw fail("Use an international phone number, for example +48123456789.");
  return s;
};
const mask = (s) => "•••• " + s.slice(-4);
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  workspace_id: u.workspace_id,
  language: u.language,
});
const signToken = (u) =>
  jwt.sign(
    {
      ...publicUser(u),
      mfa_version: u.mfa_version || 0,
      sms_verified: true,
      auth_time: u.auth_time || Math.floor(Date.now() / 1000),
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" },
  );
const session = (u) => ({ token: signToken(u), user: publicUser(u) });
async function limit(key, max, seconds) {
  const r = (
    await db.query(
      "INSERT INTO auth_rate_limits(key,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN auth_rate_limits.expires_at<now() THEN 1 ELSE auth_rate_limits.hits+1 END,expires_at=CASE WHEN auth_rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE auth_rate_limits.expires_at END RETURNING hits",
      [hash(key), seconds],
    )
  ).rows[0];
  if (r.hits > max) throw fail("Too many attempts. Try again later.", 429);
}
async function provider(path, body) {
  if (!configured())
    throw fail(
      "SMS verification needs Twilio setup. A recovery code can still be used for sign-in.",
      503,
    );
  const r = await fetch(
    `https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SERVICE_SID}/${path}`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            process.env.TWILIO_ACCOUNT_SID +
              ":" +
              process.env.TWILIO_AUTH_TOKEN,
          ).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!r.ok)
    throw fail(
      r.status === 429
        ? "SMS verification limit reached. Try later."
        : "SMS verification could not be completed. Check the code or use a recovery code.",
      r.status === 429 ? 429 : 400,
    );
  return r.json();
}
async function transaction(fn) {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function fresh(req) {
  await limit("mfa-security-password:" + req.account.id, 20, 900);
  const u = (
    await db.query("SELECT * FROM users WHERE id=$1", [req.account.id])
  ).rows[0];
  if (u.password_hash) {
    if (
      typeof req.body.password !== "string" ||
      !(await bcrypt.compare(req.body.password, u.password_hash))
    )
      throw fail("Enter your current password.", 401);
  } else if (
    Date.now() / 1000 - (req.authToken?.auth_time || req.authToken?.iat || 0) >
    300
  )
    throw fail(
      "Sign in with Google again before changing security settings.",
      401,
    );
  return u;
}
async function start(u, purpose, number, ip = "") {
  await limit("mfa-send-user:" + u.id, 6, 3600);
  await limit("mfa-send-ip:" + ip, 1000, 3600);
  await limit("mfa-day:" + u.id, 12, 86400);
  await limit("mfa-phone:" + number, 20, 86400);
  const token = crypto.randomBytes(32).toString("hex");
  return transaction(async (c) => {
    const locked = (
      await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [u.id])
    ).rows[0];
    if (!locked || locked.mfa_version !== u.mfa_version)
      throw fail("Security settings changed. Sign in again.", 409);
    const recent = (
      await c.query(
        "SELECT 1 FROM mfa_challenges WHERE user_id=$1 AND sent_at>now()-interval '60 seconds'",
        [u.id],
      )
    ).rows.length;
    if (recent)
      throw fail("Wait 60 seconds before requesting another SMS.", 429);
    await c.query(
      "UPDATE mfa_challenges SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL",
      [u.id],
    );
    // Recovery sign-in remains available when the provider is temporarily unavailable.
    let sid = null,
      sent = false;
    if (configured()) {
      try {
        const r = await module.exports.provider("Verifications", {
          To: number,
          Channel: "sms",
        });
        if (!r.sid || r.status !== "pending")
          throw fail("SMS could not be sent.");
        sid = r.sid;
        sent = true;
      } catch (e) {
        if (purpose !== "login") throw e;
      }
    } else if (purpose !== "login")
      throw fail(
        "Configure Twilio Verify before enabling SMS verification.",
        503,
      );
    await c.query(
      "INSERT INTO mfa_challenges(token_hash,user_id,purpose,phone,provider_sid,version,sent_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN now() END,now()+interval '5 minutes')",
      [hash(token), u.id, purpose, S.encrypt(number), sid, u.mfa_version, sent],
    );
    return {
      mfa_required: true,
      challenge: token,
      phone: mask(number),
      sms_sent: sent,
    };
  });
}
function enrollment(u) {
  return { mfa_enrollment_required: true, enrollment_token: jwt.sign(
    { id: u.id, purpose: "mfa_enrollment", version: u.mfa_version || 0 },
    process.env.JWT_SECRET, { expiresIn: "10m" }
  ) };
}
async function enrollmentUser(token) {
  let p;
  try { p = jwt.verify(token, process.env.JWT_SECRET); } catch { throw fail("Sign in again to verify your phone.", 401); }
  if (p.purpose !== "mfa_enrollment") throw fail("Invalid phone verification session.", 401);
  const u = (await db.query("SELECT * FROM users WHERE id=$1", [p.id])).rows[0];
  if (!u || u.mfa_enabled || (u.mfa_version || 0) !== p.version) throw fail("Sign in again to verify your phone.", 401);
  return u;
}
async function login(u, ip) {
  return u.mfa_enabled && u.mfa_phone
    ? start(u, "login", S.decrypt(u.mfa_phone), ip)
    : enrollment(u);
}
async function check(token, code, expectedUser) {
  if (
    typeof token !== "string" ||
    !/^\w{64}$/.test(token) ||
    typeof code !== "string" ||
    code.length > 80
  )
    throw fail("Invalid verification request.");
  const tokenHash = hash(token),
    before = (
      await db.query("SELECT user_id FROM mfa_challenges WHERE token_hash=$1", [
        tokenHash,
      ])
    ).rows[0];
  if (!before) throw fail("Verification expired. Sign in again.", 401);
  await limit("mfa-check:" + before.user_id, 30, 900);
  const result = await transaction(async (c) => {
    const u = (
      await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
        before.user_id,
      ])
    ).rows[0];
    const ch = (
      await c.query(
        "SELECT * FROM mfa_challenges WHERE token_hash=$1 FOR UPDATE",
        [tokenHash],
      )
    ).rows[0];
    if (
      !ch ||
      ch.purpose === "disable" ||
      ch.consumed_at ||
      new Date(ch.expires_at) <= new Date() ||
      ch.attempts >= 5 ||
      ch.version !== u.mfa_version ||
      (expectedUser && u.id !== expectedUser)
    )
      return { error: fail("Verification expired or used. Start again.", 401) };
    if (!["login", "login_enroll", "signup"].includes(ch.purpose) && !expectedUser)
      return { error: fail("Sign in before changing security settings.", 401) };
    await c.query(
      "UPDATE mfa_challenges SET attempts=attempts+1 WHERE token_hash=$1",
      [tokenHash],
    );
    let approved = false;
    const recovery = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!["login", "signup", "login_enroll", "enroll"].includes(ch.purpose) && /^[A-F0-9]{20}$/.test(recovery))
      approved = !!(
        await c.query(
          "UPDATE mfa_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash",
          [u.id, hash(u.id + ":" + recovery)],
        )
      ).rows.length;
    else if (/^\d{4,10}$/.test(code) && ch.provider_sid) {
      try {
        approved =
          (
            await module.exports.provider("VerificationCheck", {
              VerificationSid: ch.provider_sid,
              Code: code,
            })
          ).status === "approved";
      } catch {
        approved = false;
      }
    }
    if (!approved)
      return { error: fail("Incorrect or expired verification code.", 401) };
    await c.query(
      "UPDATE mfa_challenges SET consumed_at=now() WHERE token_hash=$1",
      [tokenHash],
    );
    let codes;
    if (["enroll", "signup", "login_enroll"].includes(ch.purpose)) {
      await c.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [u.id]);
      await c.query(
        "UPDATE users SET mfa_enabled=true,mfa_phone=$1,mfa_version=mfa_version+1 WHERE id=$2",
        [ch.phone, u.id],
      );
      u.mfa_enabled = true;
      u.mfa_version++;
    } else if (ch.purpose === "disable") {
      await c.query(
        "UPDATE users SET mfa_enabled=false,mfa_phone=NULL,mfa_version=mfa_version+1 WHERE id=$1",
        [u.id],
      );
      await c.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [u.id]);
      u.mfa_enabled = false;
      u.mfa_version++;
    }
    return { ...session(u), ...(codes ? { recovery_codes: codes } : {}) };
  });
  if (result.error) throw result.error;
  return result;
}
async function resend(token) {
  if (typeof token !== "string" || !/^\w{64}$/.test(token))
    throw fail("Invalid verification request.");
  return transaction(async (c) => {
    const ch = (
      await c.query(
        "SELECT * FROM mfa_challenges WHERE token_hash=$1 AND purpose IN ('login','signup','login_enroll') FOR UPDATE",
        [hash(token)],
      )
    ).rows[0];
    if (
      !ch ||
      ch.purpose === "disable" ||
      ch.consumed_at ||
      ch.attempts >= 5 ||
      new Date(ch.expires_at) <= new Date()
    )
      throw fail("Verification expired. Sign in again.", 401);
    if (ch.sent_at && Date.now() - new Date(ch.sent_at).getTime() < 60000)
      throw fail("Wait 60 seconds before resending.", 429);
    const u = (
      await c.query("SELECT mfa_version FROM users WHERE id=$1", [ch.user_id])
    ).rows[0];
    if (ch.version !== u.mfa_version)
      throw fail("Security settings changed. Sign in again.", 401);
    await limit("mfa-send-user:" + ch.user_id, 6, 3600);
    await limit("mfa-day:" + ch.user_id, 12, 86400);
    const r = await module.exports.provider("Verifications", {
      To: S.decrypt(ch.phone),
      Channel: "sms",
    });
    if (!r.sid || r.status !== "pending") throw fail("SMS could not be sent.");
    await c.query(
      "UPDATE mfa_challenges SET provider_sid=$1,sent_at=now() WHERE token_hash=$2",
      [r.sid, hash(token)],
    );
    return { ok: true };
  });
}
module.exports = {
  enrollment,
  enrollmentUser,
  resend,
  configured,
  phone,
  mask,
  hash,
  signToken,
  session,
  publicUser,
  provider,
  limit,
  fresh,
  start,
  login,
  check,
};
