const crypto = require("crypto"),
  db = require("../db"),
  S = require("./sharepoint"),
  E = require("./calendarEvents"),
  D = require("./dealWorkspace"),
  { ConfidentialClientApplication } = require("@azure/msal-node");
const providers = ["google", "microsoft"],
  base = () => process.env.APP_URL || "http://localhost:4000",
  redirect = (p) =>
    base() + "/api/calendar-integrations/oauth/" + p + "/callback";
const scopes = (p) =>
  p === "google"
    ? [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        "https://www.googleapis.com/auth/calendar.events",
      ]
    : ["https://graph.microsoft.com/Calendars.ReadWrite", "offline_access"];
const configured = (p) =>
  providers.includes(p) &&
  (p === "google"
    ? Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    : Boolean(
        process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET,
      ));
function msal() {
  const tenant =
    process.env.CALENDAR_MICROSOFT_TENANT_ID ||
    process.env.MICROSOFT_TENANT_ID ||
    "common";
  if (!/^(common|organizations|consumers|[a-f\d-]{36})$/i.test(tenant))
    throw D.invalid("Microsoft tenant configuration is invalid.", 503);
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      authority: "https://login.microsoftonline.com/" + tenant,
    },
    system: {
      loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} },
    },
  });
}
async function request(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    const error = D.invalid(
      r.status === 429
        ? "Calendar provider rate limit reached. Try again later."
        : [401, 403].includes(r.status)
          ? "Calendar access expired or was denied. Reconnect the calendar."
          : r.status === 412
            ? "This event changed in the calendar. Reload it before updating."
            : r.status === 404 || r.status === 410
              ? "Calendar event is no longer available."
              : "The calendar provider could not complete this request.",
      [400, 401, 403, 404, 409, 410, 412, 429].includes(r.status)
        ? r.status
        : 502,
    );
    error.provider_status = r.status;
    throw error;
  }
  return r;
}
async function authorize(p, state, verifier) {
  if (!configured(p))
    throw D.invalid(
      "Enable this provider in server settings first. Read the calendar setup guide.",
      503,
    );
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  if (p === "microsoft")
    return msal().getAuthCodeUrl({
      scopes: scopes(p),
      redirectUri: redirect(p),
      state,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      prompt: "select_account",
    });
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [k, v] of Object.entries({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirect(p),
    response_type: "code",
    scope: scopes(p).join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  }))
    u.searchParams.set(k, v);
  return u.href;
}
async function exchange(p, code, verifier) {
  if (p === "microsoft") {
    const a = msal(),
      r = await a.acquireTokenByCode({
        code,
        codeVerifier: verifier,
        scopes: scopes(p),
        redirectUri: redirect(p),
      });
    if (!r?.account) throw D.invalid("Microsoft account is unavailable.");
    return {
      credentials: S.encrypt(a.getTokenCache().serialize()),
      account_id: r.account.homeAccountId,
      account_name: r.account.username || "Microsoft account",
    };
  }
  const r = await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirect(p),
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
      }),
    }),
    tokens = await r.json();
  if (!tokens.refresh_token || !tokens.access_token)
    throw D.invalid(
      "Google did not grant offline calendar access. Reconnect and grant consent.",
    );
  const profile = await (
    await request("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer " + tokens.access_token },
    })
  ).json();
  if (!profile.sub) throw D.invalid("Google account is unavailable.");
  return {
    credentials: S.encrypt(
      JSON.stringify({
        ...tokens,
        expires_at: Date.now() + Number(tokens.expires_in || 0) * 1000,
      }),
    ),
    account_id: profile.sub,
    account_name: profile.email || "Google account",
  };
}
async function lock(user, id, fn) {
  const c = await db.pool.connect();
  let held = false;
  try {
    held = (
      await c.query("SELECT pg_try_advisory_lock(9186,$1) AS locked", [
        D.optionalId(id),
      ])
    ).rows[0].locked;
    if (!held)
      throw D.invalid("This calendar is busy. Try again in a moment.", 409);
    const conn = (
      await c.query(
        "SELECT * FROM calendar_connections WHERE id=$1 AND workspace_id=$2 AND user_id=$3",
        [id, user.workspace_id, user.id],
      )
    ).rows[0];
    if (!conn) throw D.invalid("Calendar connection not found.", 404);
    return await fn(conn, c);
  } finally {
    if (held)
      await c.query("SELECT pg_advisory_unlock(9186,$1)", [id]).catch(() => {});
    c.release();
  }
}
async function token(conn, c) {
  if (conn.provider === "microsoft") {
    const a = msal();
    a.getTokenCache().deserialize(S.decrypt(conn.credentials));
    const account = (await a.getTokenCache().getAllAccounts()).find(
      (x) => x.homeAccountId === conn.account_id,
    );
    if (!account) throw D.invalid("Reconnect Microsoft Calendar.", 409);
    const r = await a.acquireTokenSilent({
      account,
      scopes: scopes(conn.provider),
    });
    conn.credentials = S.encrypt(a.getTokenCache().serialize());
    await c.query(
      "UPDATE calendar_connections SET credentials=$1 WHERE id=$2 AND generation=$3",
      [conn.credentials, conn.id, conn.generation],
    );
    return r.accessToken;
  }
  let saved = JSON.parse(S.decrypt(conn.credentials));
  if (saved.access_token && saved.expires_at > Date.now() + 60000)
    return saved.access_token;
  const r = await (
    await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: saved.refresh_token,
      }),
    })
  ).json();
  if (!r.access_token) throw D.invalid("Reconnect Google Calendar.", 409);
  saved = {
    ...saved,
    ...r,
    expires_at: Date.now() + Number(r.expires_in || 0) * 1000,
  };
  conn.credentials = S.encrypt(JSON.stringify(saved));
  await c.query(
    "UPDATE calendar_connections SET credentials=$1 WHERE id=$2 AND generation=$3",
    [conn.credentials, conn.id, conn.generation],
  );
  return r.access_token;
}
function url(conn, path) {
  const google = conn.provider === "google",
    u = new URL(
      path,
      google
        ? "https://www.googleapis.com/calendar/v3/"
        : "https://graph.microsoft.com/v1.0/",
    );
  if (
    u.origin !==
      (google ? "https://www.googleapis.com" : "https://graph.microsoft.com") ||
    !u.pathname.startsWith(google ? "/calendar/v3/" : "/v1.0/me/") ||
    u.username ||
    u.password
  )
    throw D.invalid("Invalid calendar continuation.", 502);
  return u.href;
}
async function call(conn, c, path, options = {}) {
  const r = await request(url(conn, path), {
    ...options,
    headers: {
      Authorization: "Bearer " + (await module.exports.token(conn, c)),
      "Content-Type": "application/json",
      ...(conn.provider === "microsoft"
        ? {
            Prefer:
              'outlook.timezone="UTC", outlook.body-content-type="text", IdType="ImmutableId"',
          }
        : {}),
      ...options.headers,
    },
  });
  return r.status === 204 ? null : r.json();
}
const encoded = (v) =>
  encodeURIComponent(D.text(v, 1500, "provider identifier", true));
const eventPath = (conn, id) =>
  conn.provider === "google"
    ? `calendars/${encoded(conn.calendar_id)}/events${id ? "/" + encoded(id) : ""}`
    : `me/calendars/${encoded(conn.calendar_id)}/events${id ? "/" + encoded(id) : ""}`;
async function calendars(conn, c) {
  const out = [];
  let next =
    conn.provider === "google"
      ? "users/me/calendarList?maxResults=250&minAccessRole=reader"
      : "me/calendars?$top=100&$select=id,name,canEdit,owner";
  for (let page = 0; next; page++) {
    if (page >= 20)
      throw D.invalid("Too many calendars. Narrow account access.", 413);
    const r = await module.exports.call(conn, c, next);
    out.push(
      ...(conn.provider === "google"
        ? (r.items || [])
            .filter((x) => !x.deleted)
            .map((x) => ({
              id: x.id,
              name: x.summaryOverride || x.summary || x.id,
              can_write: [
                "owner",
                "writer",
                "writerWithoutPrivateAccess",
              ].includes(x.accessRole),
              primary: Boolean(x.primary),
            }))
        : (r.value || []).map((x) => ({
            id: x.id,
            name: x.name,
            can_write: x.canEdit === true,
          }))),
    );
    next =
      conn.provider === "google"
        ? r.nextPageToken
          ? "users/me/calendarList?maxResults=250&minAccessRole=reader&pageToken=" +
            encodeURIComponent(r.nextPageToken)
          : null
        : r["@odata.nextLink"];
  }
  return out;
}
const plain = (v) =>
  String(v || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .slice(0, 20000);
function safeURL(v) {
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password) return "";
    return [
      "calendar.google.com",
      "outlook.live.com",
      "outlook.office.com",
      "outlook.office365.com",
    ].includes(u.hostname) ||
      (u.hostname === "www.google.com" && u.pathname.startsWith("/calendar/"))
      ? u.href
      : "";
  } catch {
    return "";
  }
}
async function normalize(conn, c, v) {
  if (v.status === "cancelled" || v.isCancelled || v["@removed"]) return null;
  let all =
      conn.provider === "google" ? Boolean(v.start?.date) : Boolean(v.isAllDay),
    startDate = null,
    endDate = null;
  if (
    conn.provider === "microsoft" &&
    all &&
    v.originalStartTimeZone &&
    !/^UTC$/i.test(v.originalStartTimeZone)
  ) {
    if (!/^[\w /:+-]{1,100}$/.test(v.originalStartTimeZone))
      throw D.invalid(
        "Unsupported event timezone. Open this event in Outlook.",
        422,
      );
    v = await module.exports.call(conn, c, eventPath(conn, v.id), {
      headers: {
        Prefer: `outlook.timezone="${v.originalStartTimeZone}", outlook.body-content-type="text", IdType="ImmutableId"`,
      },
    });
  }
  if (all) {
    startDate = E.date(
      conn.provider === "google" ? v.start.date : v.start.dateTime.slice(0, 10),
    );
    endDate = E.date(
      conn.provider === "google" ? v.end.date : v.end.dateTime.slice(0, 10),
    );
  }
  const event = E.normalize({
    title: String(
      conn.provider === "google"
        ? v.summary || "(Untitled event)"
        : v.subject || "(Untitled event)",
    ).slice(0, 300),
    description: plain(
      conn.provider === "google"
        ? v.description
        : v.body?.content || v.bodyPreview,
    ),
    location: String(
      conn.provider === "google"
        ? v.location || ""
        : v.location?.displayName || "",
    ).slice(0, 1000),
    all_day: all,
    start_date: startDate,
    end_date: endDate,
    start_at: all
      ? startDate + "T00:00:00Z"
      : conn.provider === "google"
        ? v.start?.dateTime
        : v.start?.dateTime,
    end_at: all
      ? endDate + "T00:00:00Z"
      : conn.provider === "google"
        ? v.end?.dateTime
        : v.end?.dateTime,
    time_zone: "UTC",
    color: conn.provider === "google" ? "#1a7f37" : "#2563eb",
  });
  return {
    ...event,
    id: "external:" + conn.id + ":" + v.id,
    external: true,
    external_id: v.id,
    connection_id: conn.id,
    provider: conn.provider,
    calendar_name: conn.calendar_name,
    account_name: conn.account_name,
    etag: v.etag || v["@odata.etag"] || v.changeKey || null,
    web_url: safeURL(conn.provider === "google" ? v.htmlLink : v.webLink),
  };
}
async function read(conn, c, range) {
  if (!conn.calendar_id) return [];
  const query = new URLSearchParams(
    conn.provider === "google"
      ? {
          singleEvents: "true",
          showDeleted: "false",
          timeMin: range.start,
          timeMax: range.end,
          maxResults: "250",
        }
      : { startDateTime: range.start, endDateTime: range.end, $top: "250" },
  );
  let next =
      conn.provider === "google"
        ? eventPath(conn) + "?" + query
        : `me/calendars/${encoded(conn.calendar_id)}/calendarView?${query}`,
    out = [];
  for (let page = 0; next; page++) {
    if (page >= 20)
      throw D.invalid("Too many events. Choose a shorter date range.", 413);
    const r = await module.exports.call(conn, c, next);
    for (const raw of conn.provider === "google"
      ? r.items || []
      : r.value || []) {
      const event = await normalize(conn, c, raw);
      if (event) out.push(event);
    }
    next =
      conn.provider === "google"
        ? r.nextPageToken
          ? eventPath(conn) +
            "?" +
            query +
            "&pageToken=" +
            encodeURIComponent(r.nextPageToken)
          : null
        : r["@odata.nextLink"];
  }
  await c.query(
    "UPDATE calendar_connections SET last_read_at=now() WHERE id=$1",
    [conn.id],
  );
  return out;
}
function hash(e) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        e.title,
        e.description || "",
        e.location || "",
        new Date(e.start_at).toISOString(),
        e.end_at ? new Date(e.end_at).toISOString() : null,
        Boolean(e.all_day),
        e.start_date ? E.date(e.start_date) : null,
        e.end_date ? E.date(e.end_date) : null,
      ]),
    )
    .digest("hex");
}
function payload(conn, e) {
  const start = e.all_day
      ? {
          date: E.date(
            e.start_date || new Date(e.start_at).toISOString().slice(0, 10),
          ),
        }
      : { dateTime: new Date(e.start_at).toISOString() },
    end = e.all_day
      ? { date: E.date(e.end_date || E.nextDay(start.date)) }
      : {
          dateTime: e.end_at
            ? new Date(e.end_at).toISOString()
            : new Date(new Date(e.start_at).getTime() + 3600000).toISOString(),
        };
  return conn.provider === "google"
    ? {
        summary: e.title,
        description: e.description || "",
        location: e.location || "",
        start,
        end,
        reminders: { useDefault: false },
      }
    : {
        subject: e.title,
        body: { contentType: "text", content: e.description || "" },
        location: { displayName: e.location || "" },
        start: {
          dateTime: e.all_day
            ? start.date + "T00:00:00"
            : start.dateTime.replace(/Z$/, ""),
          timeZone: "UTC",
        },
        end: {
          dateTime: e.all_day
            ? end.date + "T00:00:00"
            : end.dateTime.replace(/Z$/, ""),
          timeZone: "UTC",
        },
        isAllDay: e.all_day,
        isReminderOn: false,
      };
}
async function remote(conn, c, id) {
  return normalize(
    conn,
    c,
    await module.exports.call(conn, c, eventPath(conn, id)),
  );
}
module.exports = {
  providers,
  base,
  redirect,
  scopes,
  configured,
  authorize,
  exchange,
  lock,
  token,
  call,
  url,
  calendars,
  normalize,
  read,
  hash,
  payload,
  remote,
  eventPath,
  encoded,
  safeURL,
};
