const crypto = require("crypto"),
  db = require("../db"),
  { ConfidentialClientApplication } = require("@azure/msal-node"),
  { invalid } = require("./dealWorkspace");
const SCOPES = [
  "https://graph.microsoft.com/Files.ReadWrite",
  "https://graph.microsoft.com/Sites.Read.All",
  "offline_access",
];
function config() {
  const tenant = process.env.MICROSOFT_TENANT_ID || "organizations";
  if (!/^(organizations|[a-f\d-]{36})$/i.test(tenant))
    throw invalid("Microsoft tenant configuration is invalid.", 503);
  return {
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    authority: "https://login.microsoftonline.com/" + tenant,
    redirectUri:
      process.env.MICROSOFT_REDIRECT_URI ||
      (process.env.APP_URL || "http://localhost:4000") +
        "/api/sharepoint/callback",
  };
}
function configured() {
  return !!(
    process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
  );
}
function encryptionKey() {
  const secret =
    process.env.INTEGRATION_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing integration encryption key.");
  return crypto
    .createHash("sha256")
    .update("klyo-integrations-v1:" + secret)
    .digest();
}
function encrypt(value) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv),
    data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64url"))
    .join(".");
}
function decrypt(value) {
  const [iv, tag, data] = String(value)
      .split(".")
      .map((v) => Buffer.from(v, "base64url")),
    decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
function msal() {
  if (!configured())
    throw invalid(
      "SharePoint is not enabled yet. Ask the Klyo owner to configure Microsoft sign-in.",
      503,
    );
  const c = config();
  return new ConfidentialClientApplication({
    auth: {
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      authority: c.authority,
    },
    system: {
      loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} },
    },
  });
}
async function authorize(state, verifier) {
  return msal().getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: config().redirectUri,
    state,
    codeChallenge: crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url"),
    codeChallengeMethod: "S256",
    prompt: "select_account",
  });
}
async function exchange(code, verifier) {
  const client = msal(),
    result = await client.acquireTokenByCode({
      code,
      codeVerifier: verifier,
      scopes: SCOPES,
      redirectUri: config().redirectUri,
    });
  if (!result?.account)
    throw invalid("Microsoft did not return an account. Reconnect SharePoint.");
  return {
    account: result.account,
    cache: encrypt(client.getTokenCache().serialize()),
  };
}
async function token(wid) {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    const conn = (
      await c.query(
        "SELECT * FROM sharepoint_connections WHERE workspace_id=$1 FOR UPDATE",
        [wid],
      )
    ).rows[0];
    if (!conn) throw invalid("Connect SharePoint first.", 409);
    const client = msal();
    client.getTokenCache().deserialize(decrypt(conn.token_cache));
    const account = await client
      .getTokenCache()
      .getAccountByHomeId(conn.account_id);
    if (!account) throw invalid("Reconnect your Microsoft account.", 409);
    let result;
    try {
      result = await client.acquireTokenSilent({ account, scopes: SCOPES });
    } catch {
      throw invalid(
        "Your Microsoft connection needs attention. Reconnect SharePoint.",
        409,
      );
    }
    await c.query(
      "UPDATE sharepoint_connections SET token_cache=$1 WHERE workspace_id=$2",
      [encrypt(client.getTokenCache().serialize()), wid],
    );
    await c.query("COMMIT");
    return result.accessToken;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
function id(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 500 ||
    /[\x00-\x20/?#\\]/.test(value)
  )
    throw invalid("Invalid SharePoint item.");
  return encodeURIComponent(value);
}
async function graph(wid, route, options = {}) {
  if (!route.startsWith("/") || route.startsWith("//"))
    throw new Error("Invalid Graph route.");
  const access = await module.exports.token(wid);
  const response = await fetch("https://graph.microsoft.com/v1.0" + route, {
    ...options,
    headers: {
      Authorization: "Bearer " + access,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw invalid(
        "Microsoft did not allow this action. Check the account and library permissions.",
        403,
      );
    if (response.status === 404)
      throw invalid("The SharePoint item was removed or is unavailable.", 404);
    if (response.status === 429)
      throw invalid("Microsoft is busy. Try again shortly.", 429);
    throw invalid("SharePoint could not complete the request. Try again.", 502);
  }
  return response.status === 204 ? null : response.json();
}
function safeURL(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      (u.hostname.endsWith(".sharepoint.com") ||
        u.hostname.endsWith(".sharepoint-df.com"))
      ? u.href
      : "";
  } catch {
    return "";
  }
}
function uploadURL(value) {
  try {
    const u = new URL(value);
    if (
      u.protocol === "https:" &&
      (u.hostname.endsWith(".1drv.com") ||
        u.hostname.endsWith(".sharepoint.com") ||
        u.hostname.endsWith(".sharepoint-df.com"))
    )
      return u.href;
  } catch {}
  throw invalid("Microsoft returned an unsupported upload location.", 502);
}
function publicItem(item) {
  return {
    id: item.id,
    name: item.name,
    size: Number(item.size || 0),
    folder: !!item.folder,
    mime_type: item.file?.mimeType || "",
    web_url: safeURL(item.webUrl),
    modified_at: item.lastModifiedDateTime,
  };
}
async function connection(wid, ready = true) {
  const c = (
    await db.query(
      "SELECT * FROM sharepoint_connections WHERE workspace_id=$1",
      [wid],
    )
  ).rows[0];
  if (!c) throw invalid("Connect SharePoint first.", 409);
  if (ready && (!c.drive_id || !c.root_id))
    throw invalid("Choose a SharePoint library and folder first.", 409);
  return c;
}
async function within(wid, conn, itemId) {
  let item = await module.exports.graph(
      wid,
      `/drives/${id(conn.drive_id)}/items/${id(itemId)}`,
    ),
    first = item;
  for (let i = 0; i < 60; i++) {
    if (item.id === conn.root_id) return first;
    if (
      item.parentReference?.driveId &&
      item.parentReference.driveId !== conn.drive_id
    )
      break;
    const parent = item.parentReference?.id;
    if (!parent) break;
    item = await module.exports.graph(
      wid,
      `/drives/${id(conn.drive_id)}/items/${id(parent)}?$select=id,parentReference`,
    );
  }
  throw invalid("This item is outside the connected CRM folder.", 403);
}
async function entity(client, wid, kind, entityId) {
  if (!kind && !entityId) return { entity: null, entity_id: null };
  const table = {
      contact: "contacts",
      company: "companies",
      deal: "deals",
      product: "products",
      quote: "quotes",
      project:"projects", order:"sales_orders",equipment:"equipment",
    }[kind],
    n = Number(entityId);
  if (
    !table ||
    !Number.isSafeInteger(n) ||
    n < 1 ||
    !(
      await client.query(
        `SELECT id FROM ${table} WHERE id=$1 AND workspace_id=$2${kind==='deal'?' AND deleted_at IS NULL':''}`,
        [n, wid],
      )
    ).rows.length
  )
    throw invalid("Choose a record in this workspace.");
  return { entity: kind, entity_id: n };
}
async function link(client, user, conn, item, record) {
  if (!item.file || !item.id) throw invalid("Choose a file, not a folder.");
  return (
    await client.query(
      `INSERT INTO workspace_files(workspace_id,created_by,drive_id,item_id,name,size,mime_type,web_url,entity,entity_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(workspace_id,drive_id,item_id) DO UPDATE SET name=EXCLUDED.name,size=EXCLUDED.size,mime_type=EXCLUDED.mime_type,web_url=EXCLUDED.web_url,entity=COALESCE(EXCLUDED.entity,workspace_files.entity),entity_id=COALESCE(EXCLUDED.entity_id,workspace_files.entity_id) RETURNING *`,
      [
        user.workspace_id,
        user.id,
        conn.drive_id,
        item.id,
        String(item.name).slice(0, 300),
        Number(item.size || 0),
        item.file.mimeType || "",
        safeURL(item.webUrl),
        record.entity,
        record.entity_id,
      ],
    )
  ).rows[0];
}
module.exports = {
  SCOPES,
  config,
  configured,
  encrypt,
  decrypt,
  authorize,
  exchange,
  token,
  graph,
  id,
  safeURL,
  uploadURL,
  publicItem,
  connection,
  within,
  entity,
  link,
};
