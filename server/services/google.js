// server/services/google.js
// ---------------------------------------------------------
// Two distinct Google OAuth flows live here:
//  1. Gmail sending — a workspace admin connects their own Gmail
//     account so offers/quotes send from it (gmail.send scope).
//  2. Sign in/up with Google — anyone can authenticate with their
//     Google identity instead of a password (just email/profile,
//     no Gmail permissions at all). Separate redirect URI, since
//     Google requires each one to be registered explicitly.
// ---------------------------------------------------------
const { google } = require("googleapis");

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const SIGNIN_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

function getRedirectUri() {
  const appUrl = process.env.APP_URL || "http://localhost:4000";
  return `${appUrl}/api/integrations/gmail/callback`;
}

function isConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getOAuthClient() {
  if (!isConfigured()) {
    throw new Error("Gmail sign-in isn't configured on the server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.");
  }
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, getRedirectUri());
}

// `state` is a short-lived signed token (built by the route, see
// integrations.js) — it's how the callback knows which workspace
// is connecting, since Google's redirect is a plain browser
// navigation with no Authorization header.
function getConsentUrl(state) {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline", // required to get a refresh_token back, not just a short-lived access token
    prompt: "consent",
    scope: [GMAIL_SEND_SCOPE, "https://www.googleapis.com/auth/userinfo.email"],
    state,
  });
}

async function exchangeCodeForTokens(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google didn't return a refresh token. This usually means the account already granted access before — disconnect it in Google's own security settings (myaccount.google.com/permissions) and try connecting again."
    );
  }
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();

  return { refreshToken: tokens.refresh_token, email: data.email };
}

// --- Sign in / sign up with Google (separate flow, separate redirect URI) ---

function getSigninRedirectUri() {
  const appUrl = process.env.APP_URL || "http://localhost:4000";
  return `${appUrl}/api/auth/google/callback`;
}

function getSigninOAuthClient() {
  if (!isConfigured()) {
    throw new Error("Google sign-in isn't configured on the server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.");
  }
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, getSigninRedirectUri());
}

function getSigninConsentUrl(state) {
  const client = getSigninOAuthClient();
  return client.generateAuthUrl({
    access_type: "online", // identity check only — no refresh token needed, unlike the Gmail-send flow
    prompt: "select_account",
    scope: SIGNIN_SCOPES,
    state,
  });
}

async function getGoogleProfile(code) {
  const client = getSigninOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  return { googleId: data.id, email: data.email, name: data.name };
}

/**
 * Sends one email through a workspace's connected Gmail account.
 * @param {string} refreshToken - stored on the workspace row
 * @param {string} to, subject, body
 */
async function sendViaGmail(refreshToken, to, subject, body) {
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });

  const gmail = google.gmail({ version: "v1", auth: client });

  const message = [`To: ${to}`, `Subject: ${encodeSubject(subject)}`, "Content-Type: text/plain; charset=utf-8", "", body].join(
    "\r\n"
  );
  const encodedMessage = Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  await gmail.users.messages.send({ userId: "me", requestBody: { raw: encodedMessage } });
}

// Keeps non-ASCII subject lines (Polish characters, etc.) intact in the raw MIME message.
function encodeSubject(subject) {
  return `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
}

module.exports = { isConfigured, getConsentUrl, exchangeCodeForTokens, sendViaGmail, getSigninConsentUrl, getGoogleProfile };
