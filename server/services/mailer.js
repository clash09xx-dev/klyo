// server/services/mailer.js
// ---------------------------------------------------------
// Sends email on behalf of a workspace. Priority order:
//  1. Workspace SMTP settings (saved in Settings → Mail)
//     — works with any provider: Gmail, Outlook, Yahoo, custom
//  2. Workspace Gmail OAuth (legacy — existing connected accounts)
//  3. Server-level SMTP_* env vars (fallback / self-hosted)
// ---------------------------------------------------------
const nodemailer = require("nodemailer");
const { sendViaGmail } = require("./google");

let envTransporter = null;
function getEnvTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!envTransporter) {
    envTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return envTransporter;
}

/**
 * @param {string} to
 * @param {string} subject
 * @param {string} body - plain text
 * @param {object} [workspace] - workspace row with smtp_* and/or gmail_refresh_token fields
 */
async function sendOfferEmail(to, subject, body, workspace) {
  if (!to) throw new Error("This contact has no email address on file.");

  const html = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px 0;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");

  // 1. Workspace SMTP (any provider)
  if (workspace?.smtp_host && workspace?.smtp_user && workspace?.smtp_pass) {
    const t = nodemailer.createTransport({
      host: workspace.smtp_host,
      port: workspace.smtp_port || 587,
      secure: workspace.smtp_secure || false,
      auth: { user: workspace.smtp_user, pass: workspace.smtp_pass },
    });
    const fromEmail = workspace.smtp_from_email || workspace.smtp_user;
    const fromName  = workspace.smtp_from_name  || "Klyo";
    await t.sendMail({ from: `"${fromName}" <${fromEmail}>`, to, subject, text: body, html });
    return;
  }

  // 2. Legacy Gmail OAuth
  if (workspace?.gmail_refresh_token) {
    await sendViaGmail(workspace.gmail_refresh_token, to, subject, body);
    return;
  }

  // 3. Server-level SMTP env fallback
  const t = getEnvTransporter();
  if (!t) {
    throw new Error(
      "No email sending is configured. Go to Settings → Mail to set up SMTP."
    );
  }
  const fromName  = process.env.SMTP_FROM_NAME  || "Klyo";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  await t.sendMail({ from: `"${fromName}" <${fromEmail}>`, to, subject, text: body, html });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

module.exports = { sendOfferEmail };
