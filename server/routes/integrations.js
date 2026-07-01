// server/routes/integrations.js
const express = require("express");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { isConfigured, getConsentUrl, exchangeCodeForTokens } = require("../services/google");

const router = express.Router();

// ─── Generic SMTP / Mail integration ────────────────────────────────────────

// GET /api/integrations/mail/status
router.get("/mail/status", requireAuth, async (req, res) => {
  const result = await db.query(
    "SELECT smtp_host, smtp_port, smtp_user, smtp_from_name, smtp_from_email, smtp_secure FROM workspaces WHERE id = $1",
    [req.user.workspace_id]
  );
  const ws = result.rows[0];
  res.json({
    connected: Boolean(ws?.smtp_host && ws?.smtp_user),
    host: ws?.smtp_host || null,
    port: ws?.smtp_port || 587,
    user: ws?.smtp_user || null,
    from_name: ws?.smtp_from_name || null,
    from_email: ws?.smtp_from_email || null,
    secure: ws?.smtp_secure || false,
  });
});

// POST /api/integrations/mail/save — save SMTP settings
router.post("/mail/save", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only admins can update mail settings." });
  }
  const { host, port, user, pass, from_name, from_email, secure } = req.body;
  if (!host || !user || !pass) {
    return res.status(400).json({ error: "Host, username and password are required." });
  }
  await db.query(
    `UPDATE workspaces SET
       smtp_host=$1, smtp_port=$2, smtp_user=$3, smtp_pass=$4,
       smtp_from_name=$5, smtp_from_email=$6, smtp_secure=$7
     WHERE id=$8`,
    [host, Number(port) || 587, user, pass, from_name || null, from_email || user, Boolean(secure), req.user.workspace_id]
  );
  res.json({ ok: true });
});

// POST /api/integrations/mail/test — send a test email using current settings
router.post("/mail/test", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only admins can send test emails." });
  }
  const result = await db.query(
    "SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name, smtp_from_email, smtp_secure FROM workspaces WHERE id=$1",
    [req.user.workspace_id]
  );
  const ws = result.rows[0];
  if (!ws?.smtp_host || !ws?.smtp_user || !ws?.smtp_pass) {
    return res.status(400).json({ error: "Mail is not configured yet." });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: ws.smtp_host,
      port: ws.smtp_port || 587,
      secure: ws.smtp_secure || false,
      auth: { user: ws.smtp_user, pass: ws.smtp_pass },
    });
    const fromEmail = ws.smtp_from_email || ws.smtp_user;
    const fromName  = ws.smtp_from_name  || "Klyo";
    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: req.user.email,
      subject: "Klyo mail test ✓",
      text: `This is a test email from Klyo.\n\nSent via ${ws.smtp_host} as ${fromEmail}.`,
    });
    res.json({ ok: true, sent_to: req.user.email });
  } catch (err) {
    res.status(400).json({ error: `Could not send: ${err.message}` });
  }
});

// POST /api/integrations/mail/disconnect
router.post("/mail/disconnect", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only admins can disconnect mail." });
  }
  await db.query(
    `UPDATE workspaces SET
       smtp_host=NULL, smtp_port=587, smtp_user=NULL, smtp_pass=NULL,
       smtp_from_name=NULL, smtp_from_email=NULL, smtp_secure=FALSE
     WHERE id=$1`,
    [req.user.workspace_id]
  );
  res.json({ ok: true });
});

// ─── Legacy Gmail (Google OAuth) — kept for existing connected workspaces ───

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

router.post("/gmail/connect", requireAuth, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admins only." });
  if (!isConfigured()) return res.status(400).json({ error: "Google OAuth not configured on server." });
  const state = jwt.sign({ workspace_id: req.user.workspace_id }, process.env.JWT_SECRET, { expiresIn: "10m" });
  res.json({ url: getConsentUrl(state) });
});

router.get("/gmail/callback", async (req, res) => {
  const appUrl = process.env.APP_URL || "http://localhost:4000";
  const { code, state, error } = req.query;
  if (error) return res.redirect(`${appUrl}/app?gmail=cancelled`);
  let payload;
  try { payload = jwt.verify(state, process.env.JWT_SECRET); } catch { return res.redirect(`${appUrl}/app?gmail=error`); }
  try {
    const { refreshToken, email } = await exchangeCodeForTokens(code);
    await db.query(
      "UPDATE workspaces SET gmail_email=$1, gmail_refresh_token=$2, gmail_connected_at=now() WHERE id=$3",
      [email, refreshToken, payload.workspace_id]
    );
    res.redirect(`${appUrl}/app?gmail=connected`);
  } catch (err) {
    console.error("Gmail connect failed:", err.message);
    res.redirect(`${appUrl}/app?gmail=error`);
  }
});

router.post("/gmail/disconnect", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admins only." });
  await db.query(
    "UPDATE workspaces SET gmail_email=NULL, gmail_refresh_token=NULL, gmail_connected_at=NULL WHERE id=$1",
    [req.user.workspace_id]
  );
  res.json({ ok: true });
});

module.exports = router;
