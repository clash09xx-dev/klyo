const test = require("node:test"),
  assert = require("node:assert/strict"),
  bcrypt = require("bcryptjs"),
  jwt = require("jsonwebtoken");
test(
  "SMS enrollment, login, recovery and disable enforce both factors and invalidate old sessions",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await require("./helpers/calendar-fixture")(),
      M = require("../server/services/mfa"),
      oldProvider = M.provider,
      oldEnv = { ...process.env };
    let token = f.token(0),
      sent = 0;
    const call = async (path, method = "GET", body, auth = token) => {
      const r = await fetch(f.base + "/api" + path, {
        method,
        headers: {
          ...(auth ? { Authorization: "Bearer " + auth } : {}),
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, data: await r.json() };
    };
    const resetRate = async () => {
      await f.db.query("DELETE FROM auth_rate_limits");
      await f.db.query(
        "UPDATE mfa_challenges SET sent_at=now()-interval '61 seconds'",
      );
    };
    try {
      f.users[0].email = f.users[0].email.toLowerCase();
      await f.db.query("UPDATE users SET email=lower(email) WHERE id=$1", [
        f.users[0].id,
      ]);
      await f.db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        await bcrypt.hash("Strong-test-42", 4),
        f.users[0].id,
      ]);
      delete process.env.TWILIO_VERIFY_SERVICE_SID;
      assert.equal((await call("/mfa/status")).data.configured, false);
      assert.equal(
        (
          await call("/mfa/enroll", "POST", {
            phone: "+48123456789",
            password: "wrong",
          })
        ).status,
        401,
      );
      Object.assign(process.env, {
        TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32),
        TWILIO_AUTH_TOKEN: "test-only",
        TWILIO_VERIFY_SERVICE_SID: "VA" + "2".repeat(32),
      });
      M.provider = async (path, b) => {
        if (path === "Verifications") {
          sent++;
          assert.equal(b.Channel, "sms");
          return { sid: "VE" + "3".repeat(32), status: "pending" };
        }
        return { status: b.Code === "123456" ? "approved" : "pending" };
      };
      const enrollment = await call("/mfa/enroll", "POST", {
        phone: "+48123456789",
        password: "Strong-test-42",
      });
      assert.equal(enrollment.status, 200);
      assert.equal(enrollment.data.sms_sent, true);
      assert.equal(sent, 1);
      assert.equal(
        (
          await call(
            "/mfa/verify",
            "POST",
            { challenge: enrollment.data.challenge, code: "123456" },
            null,
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await call(
            "/mfa/confirm",
            "POST",
            { challenge: enrollment.data.challenge, code: "123456" },
            f.token(1),
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await call(
            "/mfa/resend",
            "POST",
            { challenge: enrollment.data.challenge },
            null,
          )
        ).status,
        401,
      );
      const expired = require("crypto").randomBytes(32).toString("hex");
      await f.db.query(
        "INSERT INTO mfa_challenges(token_hash,user_id,purpose,phone,version,expires_at) VALUES($1,$2,'login',$3,0,now()-interval '1 minute')",
        [M.hash(expired), f.users[0].id, f.S.encrypt("+48123456789")],
      );
      assert.equal(
        (
          await call(
            "/mfa/verify",
            "POST",
            { challenge: expired, code: "123456" },
            null,
          )
        ).status,
        401,
      );
      const enabled = await call("/mfa/confirm", "POST", {
        challenge: enrollment.data.challenge,
        code: "123456",
      });
      assert.equal(enabled.status, 200);
      assert.equal(enabled.data.recovery_codes.length, 10);
      const recovery = enabled.data.recovery_codes[0];
      token = enabled.data.token;
      assert.equal(
        (await call("/auth/me", "GET", undefined, f.token(0))).status,
        401,
      );
      assert.equal((await call("/auth/me")).status, 200);
      const persisted = (
        await f.db.query("SELECT mfa_phone FROM users WHERE id=$1", [
          f.users[0].id,
        ])
      ).rows[0];
      assert.ok(!persisted.mfa_phone.includes("+48123456789"));
      await resetRate();
      const login = await call(
        "/auth/login",
        "POST",
        { email: f.users[0].email, password: "Strong-test-42" },
        null,
      );
      assert.equal(login.status, 200, login.data.error);
      assert.equal(login.data.mfa_required, true);
      assert.equal(login.data.token, undefined);
      assert.ok(!login.data.phone.includes("123456789"));
      assert.equal(
        (
          await call(
            "/mfa/resend",
            "POST",
            { challenge: login.data.challenge },
            null,
          )
        ).status,
        429,
      );
      assert.equal(
        (
          await call(
            "/mfa/verify",
            "POST",
            { challenge: login.data.challenge, code: "000000" },
            null,
          )
        ).status,
        401,
      );
      const signed = await call(
        "/mfa/verify",
        "POST",
        { challenge: login.data.challenge, code: "123456" },
        null,
      );
      assert.equal(signed.status, 200);
      assert.ok(signed.data.token);
      assert.equal(
        (
          await call(
            "/mfa/verify",
            "POST",
            { challenge: login.data.challenge, code: "123456" },
            null,
          )
        ).status,
        401,
      );
      await resetRate();
      delete process.env.TWILIO_VERIFY_SERVICE_SID;
      const outage = await call(
        "/auth/login",
        "POST",
        { email: f.users[0].email, password: "Strong-test-42" },
        null,
      );
      assert.equal(outage.data.sms_sent, false);
      const recovered = await call(
        "/mfa/verify",
        "POST",
        { challenge: outage.data.challenge, code: recovery },
        null,
      );
      assert.equal(recovered.status, 200);
      token = recovered.data.token;
      await resetRate();
      const locked = await call(
        "/auth/login",
        "POST",
        { email: f.users[0].email, password: "Strong-test-42" },
        null,
      );
      for (let i = 0; i < 5; i++)
        assert.equal(
          (
            await call(
              "/mfa/verify",
              "POST",
              { challenge: locked.data.challenge, code: "000000" },
              null,
            )
          ).status,
          401,
        );
      assert.equal(
        (
          await call(
            "/mfa/verify",
            "POST",
            {
              challenge: locked.data.challenge,
              code: enabled.data.recovery_codes[1],
            },
            null,
          )
        ).status,
        401,
      );
      await resetRate();
      const disable = await call("/mfa/disable", "POST", {
        password: "Strong-test-42",
      });
      assert.equal(disable.status, 200);
      assert.equal(
        (
          await call("/mfa/confirm", "POST", {
            challenge: disable.data.challenge,
            code: recovery,
          })
        ).status,
        401,
      );
      const disabled = await call("/mfa/confirm", "POST", {
        challenge: disable.data.challenge,
        code: enabled.data.recovery_codes[1],
      });
      assert.equal(disabled.status, 200);
      assert.equal((await call("/auth/me")).status, 401);
      token = disabled.data.token;
      assert.equal((await call("/mfa/status")).data.enabled, false);
      const illegal = jwt.sign(
        {
          id: f.users[0].id,
          workspace_id: f.w,
          purpose: "challenge",
          mfa_version: 2,
        },
        process.env.JWT_SECRET,
      );
      assert.equal(
        (await call("/auth/me", "GET", undefined, illegal)).status,
        401,
      );
      assert.equal((await call("/mfa/status")).data.recovery_codes, 0);
    } finally {
      M.provider = oldProvider;
      for (const k of [
        "TWILIO_ACCOUNT_SID",
        "TWILIO_AUTH_TOKEN",
        "TWILIO_VERIFY_SERVICE_SID",
      ]) {
        if (oldEnv[k] === undefined) delete process.env[k];
        else process.env[k] = oldEnv[k];
      }
      await f.close();
    }
  },
);
