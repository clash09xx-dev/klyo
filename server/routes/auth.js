// server/routes/auth.js
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { assertWithinLimit, LimitExceededError } = require("../services/limits");
const { isConfigured: isGoogleConfigured, getSigninConsentUrl, getGoogleProfile } = require("../services/google");

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, workspace_id: user.workspace_id },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function randomInviteCode() {
  return crypto.randomBytes(5).toString("hex").toUpperCase(); // e.g. "A1B2C3D4E5"
}

// Retries a couple of times in the vanishingly unlikely event of a
// collision with an existing invite code (unique constraint in the DB).
async function createUniqueInviteCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomInviteCode();
    const existing = await db.query("SELECT id FROM workspaces WHERE invite_code = $1", [code]);
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
    return res.status(400).json({ error: "Name, email, and password are all required." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await db.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (existing.rows.length) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }

  let workspaceId;
  let role;

  try {
    if (invite_code && invite_code.trim()) {
      const ws = await db.query("SELECT id FROM workspaces WHERE invite_code = $1", [
        invite_code.trim().toUpperCase(),
      ]);
      if (!ws.rows.length) {
        return res.status(400).json({ error: "That invite code doesn't match any workspace." });
      }
      workspaceId = ws.rows[0].id;
      role = "member";

      try {
        await assertWithinLimit(workspaceId, "seats");
      } catch (err) {
        if (err instanceof LimitExceededError) {
          return res.status(403).json({ error: err.message, code: "LIMIT_EXCEEDED" });
        }
        throw err;
      }
    } else {
      if (!workspace_name || !workspace_name.trim()) {
        return res
          .status(400)
          .json({ error: "Enter a name for your business to create a new workspace, or use an invite code instead." });
      }
      const code = await createUniqueInviteCode();
      const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const wsResult = await db.query(
        "INSERT INTO workspaces (name, invite_code, plan, trial_ends_at) VALUES ($1, $2, 'trial', $3) RETURNING id",
        [workspace_name.trim(), code, trialEndsAt]
      );
      workspaceId = wsResult.rows[0].id;
      role = "admin";
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const userResult = await db.query(
      "INSERT INTO users (workspace_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [workspaceId, name.trim(), normalizedEmail, passwordHash, role]
    );

    const user = {
      id: userResult.rows[0].id,
      name: name.trim(),
      email: normalizedEmail,
      role,
      workspace_id: workspaceId,
    };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create your account. Please try again." });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const result = await db.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase().trim()]);
  const row = result.rows[0];
  if (!row || !row.password_hash) {
    return res.status(401).json({
      error: row
        ? "This account uses Google sign-in — use the \"Continue with Google\" button instead."
        : "Incorrect email or password.",
    });
  }
  if (!bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  const user = { id: row.id, name: row.name, email: row.email, role: row.role, workspace_id: row.workspace_id };
  res.json({ token: signToken(user), user });
});

// GET /api/auth/me — includes theme + onboarding status, which aren't in the token
router.get("/me", requireAuth, async (req, res) => {
  const result = await db.query(
    "SELECT id, name, email, role, workspace_id, theme, has_seen_onboarding, password_hash FROM users WHERE id = $1",
    [req.user.id]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: "Account not found." });

  const isPlatformAdmin =
    Boolean(process.env.PLATFORM_ADMIN_EMAIL) && row.email.toLowerCase() === process.env.PLATFORM_ADMIN_EMAIL.toLowerCase();

  const { password_hash, ...user } = row;
  res.json({ user: { ...user, has_password: Boolean(password_hash), is_platform_admin: isPlatformAdmin } });
});

// PUT /api/auth/profile — update your display name
router.put("/profile", requireAuth, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Name can't be empty." });

  await db.query("UPDATE users SET name = $1 WHERE id = $2", [name.trim(), req.user.id]);
  res.json({ name: name.trim() });
});

// PUT /api/auth/password — change an existing password, or set one for the
// first time (e.g. a Google-only account adding password login as a backup)
router.put("/password", requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters." });
  }

  const result = await db.query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
  const existingHash = result.rows[0]?.password_hash;

  if (existingHash) {
    if (!current_password || !bcrypt.compareSync(current_password, existingHash)) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, req.user.id]);
  res.json({ ok: true });
});

// PUT /api/auth/theme — save the signed-in user's chosen color theme
router.put("/theme", requireAuth, async (req, res) => {
  const VALID_THEMES = ["signal", "ember", "meadow", "nebula", "arctic", "slate", "midnight", "sand"];
  const { theme } = req.body || {};
  if (!VALID_THEMES.includes(theme)) {
    return res.status(400).json({ error: "That's not a valid theme." });
  }
  await db.query("UPDATE users SET theme = $1 WHERE id = $2", [theme, req.user.id]);
  res.json({ theme });
});

// POST /api/auth/onboarding/complete — mark the welcome tour as seen
router.post("/onboarding/complete", requireAuth, async (req, res) => {
  await db.query("UPDATE users SET has_seen_onboarding = TRUE WHERE id = $1", [req.user.id]);
  res.json({ ok: true });
});

// GET /api/auth/team — teammates within the current workspace only
router.get("/team", requireAuth, async (req, res) => {
  const result = await db.query(
    "SELECT id, name, email, role FROM users WHERE workspace_id = $1 ORDER BY name",
    [req.user.workspace_id]
  );
  res.json({ team: result.rows });
});

// GET /api/auth/workspace — current workspace's info. The invite code is
// only included for admins, since it's effectively a "join my team" key.
router.get("/workspace", requireAuth, async (req, res) => {
  const result = await db.query(
    "SELECT id, name, invite_code, plan, is_comped, trial_ends_at FROM workspaces WHERE id = $1",
    [req.user.workspace_id]
  );
  const workspace = result.rows[0];
  if (!workspace) return res.status(404).json({ error: "Workspace not found." });
  if (req.user.role !== "admin") delete workspace.invite_code;
  res.json({ workspace });
});

// GET /api/auth/workspace/settings — full workspace settings including currency
router.get("/workspace/settings", requireAuth, async (req, res) => {
  const result = await db.query(
    "SELECT id, name, invite_code, plan, default_currency FROM workspaces WHERE id = $1",
    [req.user.workspace_id]
  );
  const workspace = result.rows[0];
  if (!workspace) return res.status(404).json({ error: "Workspace not found." });
  if (req.user.role !== "admin") delete workspace.invite_code;
  res.json({ workspace });
});

// PUT /api/auth/workspace/currency — admin-only, sets the default currency for new quotes
router.put("/workspace/currency", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Only the workspace admin can change this." });
  const { currency } = req.body || {};
  if (!currency || !currency.trim()) return res.status(400).json({ error: "Currency code is required." });
  await db.query("UPDATE workspaces SET default_currency = $1 WHERE id = $2", [currency.trim().toUpperCase(), req.user.workspace_id]);
  res.json({ currency: currency.trim().toUpperCase() });
});

// POST /api/auth/workspace/regenerate-invite — admin-only, in case a code leaks
router.post("/workspace/regenerate-invite", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the workspace admin can do this." });
  }
  try {
    const code = await createUniqueInviteCode();
    await db.query("UPDATE workspaces SET invite_code = $1 WHERE id = $2", [code, req.user.workspace_id]);
    res.json({ invite_code: code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/google/start — kicks off "Continue with Google" for either
// login or signup. mode/workspace_name/invite_code only matter if this
// turns out to be a brand-new account; an existing account is found by
// email and logged straight in regardless of what was passed.
router.get("/google/start", (req, res) => {
  if (!isGoogleConfigured()) {
    return res.status(400).json({ error: "Google sign-in isn't configured on the server yet." });
  }
  const { mode, workspace_name, invite_code } = req.query;
  const state = jwt.sign({ mode, workspace_name, invite_code }, process.env.JWT_SECRET, { expiresIn: "10m" });
  res.json({ url: getSigninConsentUrl(state) });
});

// GET /api/auth/google/callback — Google redirects the browser here
// directly, so the result has to travel back via a redirect too. We hand
// the login page a one-time token in the URL; it picks it up and signs
// itself in (see login.html), the same pattern used for Gmail-connect.
router.get("/google/callback", async (req, res) => {
  const appUrl = process.env.APP_URL || "http://localhost:4000";
  const { code, state, error } = req.query;

  if (error) return res.redirect(`${appUrl}/login.html?google_error=cancelled`);

  let payload;
  try {
    payload = jwt.verify(state, process.env.JWT_SECRET);
  } catch {
    return res.redirect(`${appUrl}/login.html?google_error=expired`);
  }

  try {
    const profile = await getGoogleProfile(code);
    if (!profile.email) return res.redirect(`${appUrl}/login.html?google_error=no_email`);
    const normalizedEmail = profile.email.toLowerCase();

    const existing = await db.query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
    let user;

    if (existing.rows.length) {
      user = existing.rows[0];
      if (!user.google_id) {
        await db.query("UPDATE users SET google_id = $1 WHERE id = $2", [profile.googleId, user.id]);
      }
    } else {
      let workspaceId;
      let role;

      if (payload.mode === "join" && payload.invite_code) {
        const ws = await db.query("SELECT id FROM workspaces WHERE invite_code = $1", [payload.invite_code.toUpperCase()]);
        if (!ws.rows.length) return res.redirect(`${appUrl}/login.html?google_error=bad_invite`);
        workspaceId = ws.rows[0].id;
        role = "member";
        try {
          await assertWithinLimit(workspaceId, "seats");
        } catch (err) {
          if (err instanceof LimitExceededError) return res.redirect(`${appUrl}/login.html?google_error=seat_limit`);
          throw err;
        }
      } else {
        const code2 = await createUniqueInviteCode();
        const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const workspaceName = payload.workspace_name || `${profile.name || "New"}'s business`;
        const wsResult = await db.query(
          "INSERT INTO workspaces (name, invite_code, plan, trial_ends_at) VALUES ($1, $2, 'trial', $3) RETURNING id",
          [workspaceName, code2, trialEndsAt]
        );
        workspaceId = wsResult.rows[0].id;
        role = "admin";
      }

      const userResult = await db.query(
        "INSERT INTO users (workspace_id, name, email, google_id, role) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [workspaceId, profile.name || normalizedEmail, normalizedEmail, profile.googleId, role]
      );
      user = userResult.rows[0];
    }

    const token = signToken({ id: user.id, name: user.name, email: user.email, role: user.role, workspace_id: user.workspace_id });
    res.redirect(`${appUrl}/login.html?google_token=${token}`);
  } catch (err) {
    console.error("Google sign-in failed:", err.message);
    res.redirect(`${appUrl}/login.html?google_error=failed`);
  }
});

// POST /api/auth/join — switch a logged-in user into a different workspace
// using an invite code. Useful when someone already has an account but wants
// to join a colleague's workspace without signing up again.
router.post("/join", requireAuth, async (req, res) => {
  const { invite_code } = req.body || {};
  if (!invite_code || !invite_code.trim()) {
    return res.status(400).json({ error: "Enter an invite code." });
  }

  const ws = await db.query("SELECT id, name FROM workspaces WHERE invite_code = $1", [
    invite_code.trim().toUpperCase(),
  ]);
  if (!ws.rows.length) {
    return res.status(400).json({ error: "That invite code doesn't match any workspace." });
  }
  const target = ws.rows[0];

  if (target.id === req.user.workspace_id) {
    return res.status(400).json({ error: "You're already in that workspace." });
  }

  try {
    await assertWithinLimit(target.id, "seats");
  } catch (err) {
    if (err instanceof LimitExceededError) {
      return res.status(403).json({ error: err.message, code: "LIMIT_EXCEEDED" });
    }
    throw err;
  }

  // Move the user to the new workspace as a member.
  const result = await db.query(
    "UPDATE users SET workspace_id = $1, role = 'member' WHERE id = $2 RETURNING *",
    [target.id, req.user.id]
  );
  const updated = result.rows[0];
  const user = {
    id: updated.id,
    name: updated.name,
    email: updated.email,
    role: updated.role,
    workspace_id: updated.workspace_id,
  };
  res.json({ token: signToken(user), user, workspace_name: target.name });
});

// GET /api/auth/workspace/ai-context
router.get("/workspace/ai-context", requireAuth, async (req, res) => {
  const result = await db.query("SELECT ai_context FROM workspaces WHERE id = $1", [req.user.workspace_id]);
  res.json({ ai_context: result.rows[0]?.ai_context || "" });
});

// PUT /api/auth/workspace/ai-context — admin only
router.put("/workspace/ai-context", requireAuth, requireAdmin, async (req, res) => {
  const { ai_context } = req.body || {};
  await db.query("UPDATE workspaces SET ai_context = $1 WHERE id = $2", [ai_context?.trim() || null, req.user.workspace_id]);
  res.json({ ok: true });
});

// PUT /api/auth/team/:id/role — admin only, change a member's role
const VALID_ROLES = ["viewer", "editor", "member", "admin"];
router.put("/team/:id/role", requireAuth, requireAdmin, async (req, res) => {
  const { role } = req.body || {};
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role." });

  // Can't demote yourself
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: "You can't change your own role." });
  }

  // Target must be in same workspace
  const existing = await db.query(
    "SELECT id, role FROM users WHERE id = $1 AND workspace_id = $2",
    [req.params.id, req.user.workspace_id]
  );
  if (!existing.rows.length) return res.status(404).json({ error: "User not found." });

  await db.query("UPDATE users SET role = $1 WHERE id = $2", [role, req.params.id]);
  res.json({ ok: true });
});

// DELETE /api/auth/team/:id — admin removes a member from the workspace
router.delete("/team/:id", requireAuth, requireAdmin, async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: "You can't remove yourself." });
  }
  const existing = await db.query(
    "SELECT id FROM users WHERE id = $1 AND workspace_id = $2",
    [req.params.id, req.user.workspace_id]
  );
  if (!existing.rows.length) return res.status(404).json({ error: "User not found." });

  await db.query("DELETE FROM users WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
