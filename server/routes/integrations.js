// server/routes/integrations.js
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { isConfigured, getConsentUrl, exchangeCodeForTokens } = require("../services/google");

const router = express.Router();

// GET /api/integrations/gmail/status
router.get("/gmail/status", requireAuth, async (req, res) => {
  const result = await db.query("SELECT gmail_email, gmail_connected_at FROM workspaces WHERE id = $1", [
    req.user.workspace_id,
  ]);
  const ws = result.rows[0];
  res.json({
    configured: isConfigured(),
    connected: Boolean(ws?.gmail_email),
    email: ws?.gmail_email || null,
    connected_at: ws?.gmail_connected_at || null,
  });
});

// POST /api/integrations/gmail/connect — admin clicks "Connect Gmail".
// Returns a Google consent URL for the browser to navigate to directly
// (this can't go through the normal fetch+Bearer-token pattern, since
// Google's redirect is a plain page navigation with no custom headers —
// so the workspace id rides along in a short-lived signed `state` token
// instead of the usual Authorization header).
router.post("/gmail/connect", requireAuth, (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the workspace admin can connect Gmail." });
  }
  if (!isConfigured()) {
    return res.status(400).json({
      error: "Gmail sign-in isn't configured on the server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.",
    });
  }

  const state = jwt.sign({ workspace_id: req.user.workspace_id }, process.env.JWT_SECRET, { expiresIn: "10m" });
  res.json({ url: getConsentUrl(state) });
});

// GET /api/integrations/gmail/callback — Google redirects the browser
// here directly. No auth header available, so we trust the signed
// `state` token instead (it can't be forged or reused past 10 minutes).
router.get("/gmail/callback", async (req, res) => {
  const appUrl = process.env.APP_URL || "http://localhost:4000";
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${appUrl}/app?gmail=cancelled`);
  }

  let payload;
  try {
    payload = jwt.verify(state, process.env.JWT_SECRET);
  } catch {
    return res.redirect(`${appUrl}/app?gmail=error`);
  }

  try {
    const { refreshToken, email } = await exchangeCodeForTokens(code);
    await db.query(
      "UPDATE workspaces SET gmail_email = $1, gmail_refresh_token = $2, gmail_connected_at = now() WHERE id = $3",
      [email, refreshToken, payload.workspace_id]
    );
    res.redirect(`${appUrl}/app?gmail=connected`);
  } catch (err) {
    console.error("Gmail connect failed:", err.message);
    res.redirect(`${appUrl}/app?gmail=error`);
  }
});

// POST /api/integrations/gmail/disconnect
router.post("/gmail/disconnect", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the workspace admin can disconnect Gmail." });
  }
  await db.query(
    "UPDATE workspaces SET gmail_email = NULL, gmail_refresh_token = NULL, gmail_connected_at = NULL WHERE id = $1",
    [req.user.workspace_id]
  );
  res.json({ ok: true });
});

module.exports = router;
