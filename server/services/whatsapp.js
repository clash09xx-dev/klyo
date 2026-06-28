// server/services/whatsapp.js
// Provider-ready WhatsApp messaging service.
//
// Supported providers (set WHATSAPP_PROVIDER env var):
//   "twilio"  → Twilio WhatsApp sandbox / Business API
//   "meta"    → Meta Cloud API (WhatsApp Business Platform)
//
// Required env vars per provider:
//   Twilio: WHATSAPP_PROVIDER=twilio, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
//   Meta:   WHATSAPP_PROVIDER=meta,   META_WA_TOKEN, META_WA_PHONE_ID
//
// If no provider is configured the function logs a warning and no-ops,
// so reminder logic still runs without crashing.

const provider = (process.env.WHATSAPP_PROVIDER || "").toLowerCase();

async function sendWhatsApp(to, body) {
  if (!to) return;

  if (provider === "twilio") {
    return sendViaTwilio(to, body);
  } else if (provider === "meta") {
    return sendViaMeta(to, body);
  } else {
    console.warn(`[WhatsApp] No provider configured. Would send to ${to}: "${body}"`);
  }
}

async function sendViaTwilio(to, body) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"

  if (!sid || !token || !from) {
    console.error("[WhatsApp/Twilio] Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_WHATSAPP_FROM");
    return;
  }

  const twilio = require("twilio");
  const client = twilio(sid, token);
  await client.messages.create({
    from,
    to: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
    body,
  });
  console.log(`[WhatsApp/Twilio] Sent to ${to}`);
}

async function sendViaMeta(to, body) {
  const token   = process.env.META_WA_TOKEN;
  const phoneId = process.env.META_WA_PHONE_ID;

  if (!token || !phoneId) {
    console.error("[WhatsApp/Meta] Missing META_WA_TOKEN or META_WA_PHONE_ID");
    return;
  }

  const https = require("https");
  const payload = JSON.stringify({
    messaging_product: "whatsapp",
    to: to.replace(/\D/g, ""),
    type: "text",
    text: { body },
  });

  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "graph.facebook.com",
      path: `/v19.0/${phoneId}/messages`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }, (res) => {
      res.on("data", () => {});
      res.on("end", resolve);
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
  console.log(`[WhatsApp/Meta] Sent to ${to}`);
}

module.exports = { sendWhatsApp };
