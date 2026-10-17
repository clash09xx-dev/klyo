// server/routes/auth.js
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const {
  requireAuth,
  requireAdmin,
  requireTeamOwner,
} = require("../middleware/auth");
const { assertWithinLimit, LimitExceededError } = require("../services/limits");
const {
  isConfigured: isGoogleConfigured,
  getSigninConsentUrl,
  getGoogleProfile,
} = require("../services/google");

const {
  normalizeCurrency,
  setWorkspaceCurrency,
} = require("../services/workspaceCurrency");

const preferences = require("../../public/js/preferences-core");
const router = require("../middleware/safeRouter")();

const M = require('../services/mfa');
const signToken = M.signToken;

function randomInviteCode() {
  return crypto.randomBytes(5).toString("hex").toUpperCase(); // e.g. "A1B2C3D4E5"
}

// Retries a couple of times in the vanishingly unlikely event of a
// collision with an existing invite code (unique constraint in the DB).
async function createUniqueInviteCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomInviteCode();
    const existing = await db.query(
      "SELECT id FROM workspaces WHERE invite_code = $1 AND space_type='team'",
      [code],
    );
    if (!existing.rows.length) return code;
  }
  throw new Error("Could not generate a unique invite code. Please try again.");
}

// POST /api/auth/register
// Two ways to register:
//  - Provide `workspace_name` to create a brand-new business workspace
//    (you become its admin, with a 7-day free trial).
//  - Provide `invite_code` to join an existing teammate's workspace
//    (you join as a regular member).
router.post("/register", async (req, res) => {
  const { name, email, password, workspace_name, invite_code } = req.body || {};

  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ error: "Name, email, and password are all required." });
  }
  if (!EMAIL_RE.test(email.trim())) {
    return res
      .status(400)
      .json({ error: "Please enter a valid email address." });
  }
  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters." });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await db.query("SELECT id FROM users WHERE email = $1", [
    normalizedEmail,
  ]);
  if (existing.rows.length) {
    return res
      .status(409)
      .json({ error: "An account with that email already exists." });
  }

  let workspaceId;
  let role;

  const client = await db.pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    if (invite_code && invite_code.trim()) {
      const ws = await client.query(
        "SELECT id FROM workspaces WHERE invite_code = $1 AND space_type='team' FOR UPDATE",
        [invite_code.trim().toUpperCase()],
      );
      if (!ws.rows.length) {
        return res
          .status(400)
          .json({ error: "That invite code doesn't match any workspace." });
      }
      workspaceId = ws.rows[0].id;
      role = "member";

      try {
        await assertWithinLimit(workspaceId, "seats", client);
      } catch (err) {
        if (err instanceof LimitExceededError) {
          return res
            .status(403)
            .json({ error: err.message, code: "LIMIT_EXCEEDED" });
        }
        throw err;
      }
    } else {
      if (!workspace_name || !workspace_name.trim()) {
        return res
          .status(400)
          .json({
            error:
              "Enter a name for your business to create a new workspace, or use an invite code instead.",
          });
      }
      const code = await createUniqueInviteCode();
      const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const wsResult = await client.query(
        "INSERT INTO workspaces (name, invite_code, plan, trial_ends_at) VALUES ($1, $2, 'trial', $3) RETURNING id",
        [workspace_name.trim(), code, trialEndsAt],
      );
      workspaceId = wsResult.rows[0].id;
      role = "admin";
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const userResult = await client.query(
      "INSERT INTO users (workspace_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [workspaceId, name.trim(), normalizedEmail, passwordHash, role],
    );

    const user = {
      id: userResult.rows[0].id,
      name: name.trim(),
      email: normalizedEmail,
      role,
      workspace_id: workspaceId,
    };
    if (role === "admin")
      await client.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
        user.id,
        workspaceId,
      ]);
    await client.query("COMMIT");
    transactionOpen = false;
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    await client.query("ROLLBACK");
    transactionOpen = false;
    console.error(err);
    res
      .status(500)
      .json({ error: "Could not create your account. Please try again." });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK");
    client.release();
  }
});

// Shared email format validator
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  if (!EMAIL_RE.test(email.trim())) {
    return res
      .status(400)
      .json({ error: "Please enter a valid email address." });
  }

  await M.limit("password-login-ip:" + req.ip, 300, 900);
  await M.limit("password-login-account:" + email.toLowerCase().trim(), 20, 900);
  const result = await db.query("SELECT * FROM users WHERE email = $1", [
    email.toLowerCase().trim(),
  ]);
  const row = result.rows[0];
  if (!row) {
    return res
      .status(401)
      .json({
        error: "No account found for that email address.",
        code: "NO_ACCOUNT",
      });
  }
  if (!row.password_hash) {
    return res.status(401).json({
      error:
        'This account uses Google sign-in — use the "Continue with Google" button instead.',
      code: "GOOGLE_ONLY",
    });
  }
  if (!bcrypt.compareSync(password, row.password_hash)) {
    return res
      .status(401)
      .json({
        error: "Incorrect password. Please try again.",
        code: "WRONG_PASSWORD",
      });
  }

  res.json(await M.login(row, req.ip));
});

// GET /api/auth/me — includes theme + onboarding status, which aren't in the token
router.get("/me", requireAuth, async (req, res) => {
  const result = await db.query(
    "SELECT id, name, email, role, workspace_id, theme, has_seen_onboarding, password_hash, language, terms_accepted_at, workspace_preferences FROM users WHERE id = $1",
    [req.user.id],
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: "Account not found." });

  const isPlatformAdmin =
    Boolean(process.env.PLATFORM_ADMIN_EMAIL) &&
    row.email.toLowerCase() === process.env.PLATFORM_ADMIN_EMAIL.toLowerCase();

  const { password_hash, ...user } = row;
  res.json({
    user: {
      ...user,
      workspace_id: req.user.workspace_id,
      team_workspace_id: req.account.workspace_id,
      role: req.user.role,
      scope: req.user.scope,
      is_team_owner: req.user.is_team_owner,
      can_manage_billing:
        req.user.owns_team ||
        (req.user.is_personal &&
          req.account.workspace_id === req.user.workspace_id),
      has_password: Boolean(password_hash),
      is_platform_admin: isPlatformAdmin,
    },
  });
});

// PUT /api/auth/profile — update your display name
router.put("/profile", requireAuth, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim())
    return res.status(400).json({ error: "Name can't be empty." });

  await db.query("UPDATE users SET name = $1 WHERE id = $2", [
    name.trim(),
    req.user.id,
  ]);
  res.json({ name: name.trim() });
});

// PUT /api/auth/password — change an existing password, or set one for the
// first time (e.g. a Google-only account adding password login as a backup)
router.put("/password", requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 6) {
    return res
      .status(400)
      .json({ error: "New password must be at least 6 characters." });
  }

  const result = await db.query(
    "SELECT password_hash FROM users WHERE id = $1",
    [req.user.id],
  );
  const existingHash = result.rows[0]?.password_hash;

  if (existingHash) {
    if (
      !current_password ||
      !bcrypt.compareSync(current_password, existingHash)
    ) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
    newHash,
    req.user.id,
  ]);
  res.json({ ok: true });
});

// Personal preferences never update a workspace, another user, or platform access.
router.get("/preferences", requireAuth, async (req, res) => {
  const result = await db.query(
    "SELECT workspace_preferences,theme FROM users WHERE id=$1",
    [req.user.id],
  );
  if (!result.rows.length)
    return res.status(404).json({ error: "Account not found." });
  res.json({
    preferences: preferences.normalize(
      result.rows[0].workspace_preferences,
      false,
      result.rows[0].theme,
    ),
  });
});
router.put("/preferences", requireAuth, async (req, res) => {
  try {
    const value = preferences.normalize(req.body, true);
    const result = await db.query(
      "UPDATE users SET workspace_preferences=$1,theme=$2 WHERE id=$3 RETURNING id",
      [JSON.stringify(value), value.palette.preset, req.user.id],
    );
    if (!result.rows.length)
      return res.status(404).json({ error: "Account not found." });
    res.json({ preferences: value });
  } catch (error) {
    if (!error.status)
      console.error("Preferences update failed:", error.message);
    res
      .status(error.status || 500)
      .json({
        error: error.status
          ? error.message
          : "Could not save your workspace preferences.",
      });
  }
});

// PUT /api/auth/theme — save the signed-in user's chosen color theme
router.put("/theme", requireAuth, async (req, res) => {
  const VALID_THEMES = [
    "signal",
    "ember",
    "meadow",
    "nebula",
    "arctic",
    "slate",
    "midnight",
    "sand",
    "cobalt",
    "graphite",
    "forest",
    "pearl",
    "dawn",
    "office",
    "blanc",
    "noir",
  ];
  const { theme } = req.body || {};
  if (
    ![...VALID_THEMES, ...Object.keys(preferences.PRESETS), "custom"].includes(
      theme,
    )
  ) {
    return res.status(400).json({ error: "That's not a valid theme." });
  }
  const preset =
    preferences.PRESETS[theme] || theme === "custom"
      ? theme
      : preferences.LEGACY[theme] || "graphite";
  await db.query(
    "UPDATE users SET theme=$1,workspace_preferences=CASE WHEN workspace_preferences ? 'palette' THEN jsonb_set(workspace_preferences,'{palette,preset}',to_jsonb($3::text),true) ELSE workspace_preferences END WHERE id=$2",
    [theme, req.user.id, preset],
  );
  res.json({ theme });
});

// POST /api/auth/onboarding/complete — mark the welcome tour as seen
router.post("/onboarding/complete", requireAuth, async (req, res) => {
  await db.query("UPDATE users SET has_seen_onboarding = TRUE WHERE id = $1", [
    req.user.id,
  ]);
  res.json({ ok: true });
});

// GET /api/auth/team — teammates within the current workspace only
router.get("/team", requireAuth, async (req, res) => {
  if (req.user.is_personal)
    return res.json({ team: [{ ...req.user, is_owner: true }] });
  const result = await db.query(
    "SELECT u.id,u.name,u.email,u.role,(u.id=w.owner_user_id) AS is_owner FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.workspace_id=$1 ORDER BY u.name",
    [req.user.workspace_id],
  );
  res.json({ team: result.rows });
});

// GET /api/auth/workspace — current workspace's info. The invite code is
// only included for admins, since it's effectively a "join my team" key.
router.get("/workspace", requireAuth, async (req, res) => {
  const result = await db.query(
    "SELECT id, name, invite_code, plan, is_comped, trial_ends_at FROM workspaces WHERE id = $1",
    [req.user.workspace_id],
  );
  const workspace = result.rows[0];
  if (!workspace)
    return res.status(404).json({ error: "Workspace not found." });
  if (!req.user.is_team_owner) delete workspace.invite_code;
  res.json({ workspace });
});

// GET /api/auth/workspace/settings — full workspace settings including currency
router.get("/workspace/settings", requireAuth, async (req, res) => {
  const result = await db.query(
    "SELECT id, name, invite_code, plan, default_currency FROM workspaces WHERE id = $1",
    [req.user.workspace_id],
  );
  const workspace = result.rows[0];
  if (!workspace)
    return res.status(404).json({ error: "Workspace not found." });
  if (!req.user.is_team_owner) delete workspace.invite_code;
  res.json({ workspace });
});

// PUT /api/auth/workspace/currency — relabel workspace amounts without FX conversion.
router.put("/workspace/currency", requireAuth, async (req, res) => {
  if (req.user.role !== "admin")
    return res
      .status(403)
      .json({ error: "Only the workspace admin can change this." });
  const currency = normalizeCurrency(req.body?.currency);
  if (!currency)
    return res.status(400).json({ error: "Choose a supported currency." });
  try {
    await setWorkspaceCurrency(db.pool, req.user.workspace_id, currency);
    res.json({ currency });
  } catch (err) {
    console.error("Workspace currency update failed:", err.message);
    res
      .status(500)
      .json({ error: "Currency could not be saved. Please try again." });
  }
});

// POST /api/auth/workspace/regenerate-invite — admin-only, in case a code leaks
router.post(
  "/workspace/regenerate-invite",
  requireAuth,
  requireTeamOwner,
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Only the workspace admin can do this." });
    }
    try {
      const code = await createUniqueInviteCode();
      await db.query("UPDATE workspaces SET invite_code = $1 WHERE id = $2", [
        code,
        req.user.workspace_id,
      ]);
      res.json({ invite_code: code });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /api/auth/google/start — kicks off "Continue with Google" for either
// login or signup. mode/workspace_name/invite_code only matter if this
// turns out to be a brand-new account; an existing account is found by
// email and logged straight in regardless of what was passed.
router.get("/google/start", (req, res) => {
  if (!isGoogleConfigured()) {
    return res
      .status(400)
      .json({ error: "Google sign-in isn't configured on the server yet." });
  }
  const { mode, workspace_name, invite_code } = req.query;
  const state = jwt.sign(
    { mode, workspace_name, invite_code },
    process.env.JWT_SECRET,
    { expiresIn: "10m" },
  );
  res.json({ url: getSigninConsentUrl(state) });
});

// GET /api/auth/google/callback — Google redirects the browser here
// directly, so the result has to travel back via a redirect too. We hand
// the login page a one-time token in the URL; it picks it up and signs
// itself in (see login.html), the same pattern used for Gmail-connect.
router.get("/google/callback", async (req, res) => {
  const appUrl = process.env.APP_URL || "http://localhost:4000";
  const { code, state, error } = req.query;

  if (error) return res.redirect(`${appUrl}/login?google_error=cancelled`);

  let payload;
  try {
    payload = jwt.verify(state, process.env.JWT_SECRET);
  } catch {
    return res.redirect(`${appUrl}/login?google_error=expired`);
  }

  try {
    const profile = await getGoogleProfile(code);
    if (!profile.email)
      return res.redirect(`${appUrl}/login?google_error=no_email`);
    const normalizedEmail = profile.email.toLowerCase();

    const existing = await db.query("SELECT * FROM users WHERE email = $1", [
      normalizedEmail,
    ]);
    let user;

    if (existing.rows.length) {
      user = existing.rows[0];
      if (!user.google_id) {
        await db.query("UPDATE users SET google_id = $1 WHERE id = $2", [
          profile.googleId,
          user.id,
        ]);
      }
    } else {
      let workspaceId;
      let role;

      if (payload.mode === "join" && payload.invite_code) {
        const ws = await db.query(
          "SELECT id FROM workspaces WHERE invite_code = $1 AND space_type='team'",
          [payload.invite_code.toUpperCase()],
        );
        if (!ws.rows.length)
          return res.redirect(`${appUrl}/login?google_error=bad_invite`);
        workspaceId = ws.rows[0].id;
        role = "member";
        try {
          await assertWithinLimit(workspaceId, "seats");
        } catch (err) {
          if (err instanceof LimitExceededError)
            return res.redirect(`${appUrl}/login?google_error=seat_limit`);
          throw err;
        }
      } else {
        const code2 = await createUniqueInviteCode();
        const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const workspaceName =
          payload.workspace_name || `${profile.name || "New"}'s business`;
        const wsResult = await db.query(
          "INSERT INTO workspaces (name, invite_code, plan, trial_ends_at) VALUES ($1, $2, 'trial', $3) RETURNING id",
          [workspaceName, code2, trialEndsAt],
        );
        workspaceId = wsResult.rows[0].id;
        role = "admin";
      }

      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        const locked = (
          await client.query(
            "SELECT id,invite_code FROM workspaces WHERE id=$1 AND space_type='team' FOR UPDATE",
            [workspaceId],
          )
        ).rows[0];
        if (
          !locked ||
          (payload.mode === "join" &&
            locked.invite_code !== payload.invite_code.toUpperCase())
        )
          throw new Error("Invitation was revoked.");
        if (role === "member")
          await assertWithinLimit(workspaceId, "seats", client);
        const userResult = await client.query(
          "INSERT INTO users (workspace_id, name, email, google_id, role) VALUES ($1, $2, $3, $4, $5) RETURNING *",
          [
            workspaceId,
            profile.name || normalizedEmail,
            normalizedEmail,
            profile.googleId,
            role,
          ],
        );
        user = userResult.rows[0];
        if (role === "admin")
          await client.query(
            "UPDATE workspaces SET owner_user_id=$1 WHERE id=$2",
            [user.id, workspaceId],
          );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }

    const result = await M.login(user, req.ip);
    if(result.mfa_required) res.redirect(`${appUrl}/login?mfa_challenge=${result.challenge}`);
    else res.redirect(`${appUrl}/login?google_token=${result.token}`);
  } catch (err) {
    console.error("Google sign-in failed:", err.message);
    res.redirect(`${appUrl}/login?google_error=failed`);
  }
});

// POST /api/auth/join — switch a logged-in user into a different workspace
// using an invite code. Useful when someone already has an account but wants
// to join a colleague's workspace without signing up again.
router.post("/join", requireAuth, async (req, res) => {
  const invite_code = req.body?.invite_code;
  if (typeof invite_code !== "string" || !invite_code.trim())
    return res.status(400).json({ error: "Enter an invite code." });
  const result = await require("../services/spaces").joinTeam(
    req.account,
    invite_code,
  );
  const user = {
    id: result.user.id,
    name: result.user.name,
    email: result.user.email,
    role: result.user.role,
    workspace_id: result.user.workspace_id,
  };
  res.json({ token: signToken({...user,mfa_version:req.account.mfa_version,auth_time:req.authToken.auth_time||req.authToken.iat}), user, workspace_name: result.name });
});

// PUT /api/auth/language — save UI language preference
const VALID_LANGS = ["en", "pl", "es", "fr", "de"];
router.put("/language", requireAuth, async (req, res) => {
  const { language } = req.body || {};
  if (!VALID_LANGS.includes(language))
    return res.status(400).json({ error: "Unsupported language." });
  await db.query("UPDATE users SET language = $1 WHERE id = $2", [
    language,
    req.user.id,
  ]);
  res.json({ ok: true });
});

// GET /api/auth/workspace/ai-context
router.get("/workspace/ai-context", requireAuth, async (req, res) => {
  const result = await db.query(
    "SELECT ai_context FROM workspaces WHERE id = $1",
    [req.user.workspace_id],
  );
  res.json({ ai_context: result.rows[0]?.ai_context || "" });
});

// PUT /api/auth/workspace/ai-context — admin only
router.put(
  "/workspace/ai-context",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { ai_context } = req.body || {};
    await db.query("UPDATE workspaces SET ai_context = $1 WHERE id = $2", [
      ai_context?.trim() || null,
      req.user.workspace_id,
    ]);
    res.json({ ok: true });
  },
);

// PUT /api/auth/team/:id/role — admin only, change a member's role
const VALID_ROLES = ["viewer", "editor", "member", "admin"];
router.put(
  "/team/:id/role",
  requireAuth,
  requireTeamOwner,
  async (req, res) => {
    const { role } = req.body || {};
    if (!VALID_ROLES.includes(role))
      return res.status(400).json({ error: "Invalid role." });

    // Can't demote yourself
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: "You can't change your own role." });
    }

    // Target must be in same workspace
    const existing = await db.query(
      "SELECT id, role FROM users WHERE id = $1 AND workspace_id = $2",
      [req.params.id, req.user.workspace_id],
    );
    if (!existing.rows.length)
      return res.status(404).json({ error: "User not found." });

    await db.query("UPDATE users SET role = $1 WHERE id = $2", [
      role,
      req.params.id,
    ]);
    res.json({ ok: true });
  },
);

// DELETE /api/auth/team/:id — admin removes a member from the workspace
router.delete("/team/:id", requireAuth, requireTeamOwner, async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: "You can't remove yourself." });
  }
  const existing = await db.query(
    "SELECT id FROM users WHERE id = $1 AND workspace_id = $2",
    [req.params.id, req.user.workspace_id],
  );
  if (!existing.rows.length)
    return res.status(404).json({ error: "User not found." });

  // Removing a teammate revokes shared access, never deletes their account or private data.
  const member = await require("../services/spaces").account(
    Number(req.params.id),
  );
  const personal = await require("../services/spaces").personalSpace(member);
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    const locked = (
      await c.query("SELECT workspace_id FROM users WHERE id=$1 FOR UPDATE", [
        member.id,
      ])
    ).rows[0];
    const workspace = (
      await c.query(
        "SELECT owner_user_id FROM workspaces WHERE id=$1 FOR UPDATE",
        [req.user.workspace_id],
      )
    ).rows[0];
    if (workspace?.owner_user_id !== req.user.id)
      throw Object.assign(
        new Error("Team ownership changed. Refresh and try again."),
        { status: 403 },
      );
    if (locked?.workspace_id !== req.user.workspace_id)
      throw Object.assign(new Error("This user already left the team."), {
        status: 409,
      });
    for (const [table, field] of [
      ["contacts", "owner_id"],
      ["deals", "assigned_to"],
      ["tasks", "assigned_to"],
    ])
      await c.query(
        `UPDATE ${table} SET ${field}=$1 WHERE workspace_id=$2 AND ${field}=$3`,
        [req.user.id, req.user.workspace_id, member.id],
      );
    await c.query("UPDATE users SET workspace_id=$1,role='admin' WHERE id=$2", [
      personal.id,
      member.id,
    ]);
    await c.query(
      "UPDATE workspaces SET billing_workspace_id=NULL WHERE id=$1",
      [personal.id],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  res.json({ ok: true });
});

// POST /api/auth/accept-terms — record that the user accepted terms
router.post("/accept-terms", requireAuth, async (req, res) => {
  await db.query("UPDATE users SET terms_accepted_at = now() WHERE id = $1", [
    req.user.id,
  ]);
  res.json({ ok: true });
});

module.exports = router;
