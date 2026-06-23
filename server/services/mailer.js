// server/services/mailer.js
// ---------------------------------------------------------
// Sends the actual email once a draft (AI-written or hand-written)
// is approved and the "Send" button is pressed.
//
// Two ways this can work, tried in order:
//  1. The workspace connected their own Gmail account (Settings →
//     Team → Email sending) — offers send through Gmail's API
//     using that account, so it arrives from the business's real
//     address with no shared password involved.
//  2. Falls back to the SMTP_* values in .env — works with Gmail,
//     Outlook, SendGrid, Mailgun, or any standard SMTP provider.
//     Useful for your own testing, or for workspaces that haven't
//     connected Gmail yet.
// ---------------------------------------------------------
const nodemailer = require("nodemailer");
const { sendViaGmail } = require("./google");

let transporter = null;
function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

/**
 * @param {string} to - recipient email address
 * @param {string} subject
 * @param {string} body - plain text body (line breaks are preserved as paragraphs)
 * @param {{gmail_refresh_token?: string}} [workspace] - if it has a
 *   connected Gmail account, that's used instead of SMTP
 */
async function sendOfferEmail(to, subject, body, workspace) {
  if (!to) {
    throw new Error("This contact has no email address on file.");
  }

  if (workspace?.gmail_refresh_token) {
    await sendViaGmail(workspace.gmail_refresh_token, to, subject, body);
    return;
  }

  const t = getTransporter();
  if (!t) {
    throw new Error(
      "No way to send email is configured yet. Connect Gmail (Team settings) or add SMTP_HOST / SMTP_USER / SMTP_PASS to your .env file."
    );
  }

  const fromName = process.env.SMTP_FROM_NAME || "Klyo";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const html = body
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 14px 0;">${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");

  await t.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text: body,
    html,
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = { sendOfferEmail };
