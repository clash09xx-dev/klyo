const crypto = require("crypto"),
  db = require("../db"),
  S = require("./sharepoint"),
  { invalid, text, optionalId } = require("./dealWorkspace"),
  { ConfidentialClientApplication } = require("@azure/msal-node");
const providers = ["microsoft_mail", "google_drive", "dropbox"];
const base = () => process.env.APP_URL || "http://localhost:4000";
const redirect = (p) => base() + "/api/communications/oauth/" + p + "/callback";
function configured(p) {
  return p === "microsoft_mail"
    ? S.configured()
    : p === "google_drive"
      ? !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
      : p === "dropbox"
        ? !!(process.env.DROPBOX_CLIENT_ID && process.env.DROPBOX_CLIENT_SECRET)
        : false;
}
const scopes = (p) =>
  p === "microsoft_mail"
    ? [
        "https://graph.microsoft.com/Mail.Read",
        "https://graph.microsoft.com/Mail.Read.Shared",
        "offline_access",
      ]
    : p === "google_drive"
      ? ["https://www.googleapis.com/auth/drive"]
      : ["files.metadata.read", "files.content.read", "files.content.write"];
function msal() {
  const c = S.config();
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
async function authorize(p, state, verifier) {
  if (!providers.includes(p) || !configured(p))
    throw invalid(
      "This provider needs administrator configuration. Read the integration setup guide.",
      503,
    );
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  if (p === "microsoft_mail")
    return msal().getAuthCodeUrl({
      scopes: scopes(p),
      redirectUri: redirect(p),
      state,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      prompt: "select_account",
    });
  const u = new URL(
    p === "google_drive"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : "https://www.dropbox.com/oauth2/authorize",
  );
  Object.entries({
    client_id:
      p === "google_drive"
        ? process.env.GOOGLE_CLIENT_ID
        : process.env.DROPBOX_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirect(p),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: scopes(p).join(" "),
    ...(p === "google_drive"
      ? { access_type: "offline", prompt: "consent" }
      : { token_access_type: "offline" }),
  }).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.href;
}
async function request(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok)
    throw invalid(
      r.status === 401 || r.status === 403
        ? "Provider access expired or was denied. Reconnect the integration."
        : r.status === 429
          ? "Provider rate limit reached. Try again later."
          : "The provider could not complete this request.",
      [401, 403, 429].includes(r.status) ? r.status : 502,
    );
  return r;
}
async function exchange(p, code, verifier) {
  if (p === "microsoft_mail") {
    const a = msal(),
      r = await a.acquireTokenByCode({
        code,
        codeVerifier: verifier,
        scopes: scopes(p),
        redirectUri: redirect(p),
      });
    if (!r?.account) throw invalid("Microsoft account is unavailable.");
    return {
      credentials: S.encrypt(a.getTokenCache().serialize()),
      account_id: r.account.homeAccountId,
      account_name: r.account.username,
    };
  }
  const g = p === "google_drive",
    r = await request(
      g
        ? "https://oauth2.googleapis.com/token"
        : "https://api.dropboxapi.com/oauth2/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          code_verifier: verifier,
          grant_type: "authorization_code",
          redirect_uri: redirect(p),
          client_id: g
            ? process.env.GOOGLE_CLIENT_ID
            : process.env.DROPBOX_CLIENT_ID,
          client_secret: g
            ? process.env.GOOGLE_CLIENT_SECRET
            : process.env.DROPBOX_CLIENT_SECRET,
        }),
      },
    ),
    tokens = await r.json();
  if (!tokens.refresh_token)
    throw invalid(
      "A refresh token is required. Reconnect and grant offline access.",
    );
  let identity = null;
  if (g)
    identity = await (
      await request(
        "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,permissionId,displayName)",
        { headers: { Authorization: "Bearer " + tokens.access_token } },
      )
    ).json();
  return {
    credentials: S.encrypt(
      JSON.stringify({ refresh_token: tokens.refresh_token }),
    ),
    account_id: g
      ? identity?.user?.permissionId || ""
      : tokens.account_id || "",
    account_name: g
      ? identity?.user?.emailAddress || "Google Drive"
      : "Dropbox",
  };
}
async function token(conn) {
  if (conn.provider === "microsoft_mail") {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const current = (
        await client.query(
          "SELECT * FROM communication_connections WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND provider='microsoft_mail' FOR UPDATE",
          [conn.id, conn.workspace_id, conn.user_id],
        )
      ).rows[0];
      if (!current || current.account_id !== conn.account_id)
        throw invalid("Microsoft account changed. Reconnect the mailbox.", 409);
      const a = msal();
      a.getTokenCache().deserialize(S.decrypt(current.credentials));
      const account = await a
        .getTokenCache()
        .getAccountByHomeId(current.account_id);
      if (!account) throw invalid("Reconnect Microsoft 365.", 409);
      let r;
      try {
        r = await a.acquireTokenSilent({
          account,
          scopes: scopes(conn.provider),
        });
      } catch {
        throw invalid(
          "Microsoft consent expired. Reconnect Microsoft 365.",
          409,
        );
      }
      await client.query(
        "UPDATE communication_connections SET credentials=$1 WHERE id=$2",
        [S.encrypt(a.getTokenCache().serialize()), conn.id],
      );
      await client.query("COMMIT");
      return r.accessToken;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  const g = conn.provider === "google_drive",
    saved = JSON.parse(S.decrypt(conn.credentials));
  const r = await request(
    g
      ? "https://oauth2.googleapis.com/token"
      : "https://api.dropboxapi.com/oauth2/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: saved.refresh_token,
        client_id: g
          ? process.env.GOOGLE_CLIENT_ID
          : process.env.DROPBOX_CLIENT_ID,
        client_secret: g
          ? process.env.GOOGLE_CLIENT_SECRET
          : process.env.DROPBOX_CLIENT_SECRET,
      }),
    },
  );
  return (await r.json()).access_token;
}
function graphURL(path, conn = {}) {
  const u = new URL(path, "https://graph.microsoft.com/v1.0/");
  if (
    u.origin !== "https://graph.microsoft.com" ||
    !(conn.mailbox
      ? decodeURIComponent(u.pathname)
          .toLowerCase()
          .startsWith("/v1.0/users/" + conn.mailbox.toLowerCase() + "/")
      : u.pathname.startsWith("/v1.0/me/")) ||
    u.username ||
    u.password
  )
    throw invalid("Invalid Microsoft continuation.", 502);
  return u.href;
}
async function graph(conn, path, options = {}) {
  return (
    await request(
      graphURL(
        conn.mailbox && path.startsWith("/v1.0/me/")
          ? path.replace(
              "/v1.0/me/",
              "/v1.0/users/" + encodeURIComponent(conn.mailbox) + "/",
            )
          : path,
        conn,
      ),
      {
        ...options,
        headers: {
          Authorization: "Bearer " + (await module.exports.token(conn)),
          Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"',
          ...options.headers,
        },
      },
    )
  ).json();
}
async function connection(user, id, mailOnly = false) {
  const r = (
    await db.query(
      "SELECT * FROM communication_connections WHERE id=$1 AND workspace_id=$2",
      [optionalId(id), user.workspace_id],
    )
  ).rows[0];
  if (
    !r ||
    (r.provider === "microsoft_mail" && r.user_id !== user.id) ||
    (mailOnly && r.provider !== "microsoft_mail")
  )
    throw invalid("Connection not found.", 404);
  return r;
}
async function entity(client, wid, kind, id) {
  if (!kind && !id) return { entity: null, entity_id: null };
  const table = {
    contact: "contacts",
    company: "companies",
    deal: "deals",
    product: "products",
    quote: "quotes",
    project: "projects",
    order: "sales_orders",
    equipment: "equipment",
  }[kind];
  if (
    !table ||
    !(
      await client.query(
        `SELECT id FROM ${table} WHERE id=$1 AND workspace_id=$2${kind === "deal" ? " AND deleted_at IS NULL" : ""}`,
        [optionalId(id), wid],
      )
    ).rows.length
  )
    throw invalid("Choose a record in this workspace.");
  return { entity: kind, entity_id: optionalId(id) };
}
async function associate(client, wid, messageId, record) {
  await module.exports.entity(client, wid, record.entity, record.entity_id);
  const links = [record];
  if (record.entity === "deal") {
    const d = (
      await client.query(
        "SELECT contact_id,company_id FROM deals WHERE id=$1 AND workspace_id=$2",
        [record.entity_id, wid],
      )
    ).rows[0];
    if (d.contact_id)
      links.push({ entity: "contact", entity_id: d.contact_id });
    if (d.company_id)
      links.push({ entity: "company", entity_id: d.company_id });
  }
  if (record.entity === "contact") {
    const c = (
      await client.query(
        "SELECT company_id FROM contacts WHERE id=$1 AND workspace_id=$2",
        [record.entity_id, wid],
      )
    ).rows[0];
    if (c.company_id)
      links.push({ entity: "company", entity_id: c.company_id });
  }
  for (const l of links)
    await client.query(
      "INSERT INTO correspondence_links(message_id,entity,entity_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [messageId, l.entity, l.entity_id],
    );
  await client.query(
    "UPDATE correspondence SET shared=true WHERE id=$1 AND workspace_id=$2",
    [messageId, wid],
  );
}
function message(m) {
  const from = m.from?.emailAddress || m.sender?.emailAddress || {};
  return {
    provider_id: String(m.id || "").slice(0, 1000),
    conversation_id: String(m.conversationId || "").slice(0, 1000),
    internet_id: String(m.internetMessageId || "").slice(0, 1000),
    subject: String(m.subject || "(No subject)").slice(0, 1000),
    sender_name: String(from.name || "").slice(0, 300),
    sender_email: String(from.address || "")
      .toLowerCase()
      .slice(0, 320),
    recipients: (m.toRecipients || [])
      .slice(0, 100)
      .map((x) => String(x.emailAddress?.address || "").slice(0, 320)),
    body_text: String(m.body?.content || m.bodyPreview || "").slice(0, 200000),
    received_at: Number.isFinite(Date.parse(m.receivedDateTime))
      ? m.receivedDateTime
      : new Date().toISOString(),
    has_attachments: !!m.hasAttachments,
  };
}
async function ingest(conn, m, rule = null) {
  if (m["@removed"]) {
    await db.query(
      "UPDATE correspondence SET removed=true WHERE connection_id=$1 AND provider_id=$2",
      [conn.id, m.id],
    );
    return false;
  }
  if (!m.id) return false;
  const n = message(m),
    c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      conn.workspace_id,
    ]);
    const existing = (
      await c.query(
        "SELECT id FROM communication_connections WHERE id=$1 AND workspace_id=$2",
        [conn.id, conn.workspace_id],
      )
    ).rows[0];
    if (!existing) throw invalid("Connection was disconnected.", 409);
    const vals = Object.values(n),
      keys = Object.keys(n);
    const saved = (
      await c.query(
        `INSERT INTO correspondence(workspace_id,connection_id,owner_id,${keys.join(",")}) VALUES($1,$2,$3,${vals.map((_, i) => "$" + (i + 4)).join(",")}) ON CONFLICT(connection_id,provider_id) DO UPDATE SET subject=EXCLUDED.subject,body_text=EXCLUDED.body_text,has_attachments=EXCLUDED.has_attachments,removed=false RETURNING *`,
        [
          conn.workspace_id,
          conn.id,
          conn.user_id,
          ...vals.map((v, i) =>
            keys[i] === "recipients" ? JSON.stringify(v) : v,
          ),
        ],
      )
    ).rows[0];
    if (n.conversation_id) {
      const prior = (
        await c.query(
          "SELECT DISTINCT l.entity,l.entity_id FROM correspondence_links l JOIN correspondence p ON p.id=l.message_id WHERE p.connection_id=$1 AND p.conversation_id=$2 AND p.shared=true AND l.entity='deal' LIMIT 20",
          [conn.id, n.conversation_id],
        )
      ).rows;
      for (const record of prior) {
        if (
          (
            await c.query(
              "SELECT id FROM deals WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL",
              [record.entity_id, conn.workspace_id],
            )
          ).rows.length
        )
          await associate(c, conn.workspace_id, saved.id, record);
      }
    }
    const contacts = (
      await c.query(
        "SELECT id FROM contacts WHERE workspace_id=$1 AND lower(email)=$2 ORDER BY id LIMIT 20",
        [conn.workspace_id, n.sender_email],
      )
    ).rows;
    for (const ct of contacts)
      await associate(c, conn.workspace_id, saved.id, {
        entity: "contact",
        entity_id: ct.id,
      });
    if (
      rule &&
      new Date(n.received_at) >= new Date(rule.start_at) &&
      n.subject.toLowerCase().includes(rule.subject_contains.toLowerCase()) &&
      (!rule.sender_domain || n.sender_email.endsWith("@" + rule.sender_domain))
    ) {
      const exists = (
        await c.query("SELECT id FROM rfq_requests WHERE message_id=$1", [
          saved.id,
        ])
      ).rows[0];
      if (!exists) {
        if (
          !(await require("./spaces").canLinkUser(
            c,
            rule.assigned_to,
            conn.workspace_id,
          ))
        )
          throw invalid("RFQ assignee no longer has workspace access.", 409);
        const pipeline = (
          await c.query(
            "SELECT id FROM sales_pipelines WHERE id=$1 AND workspace_id=$2",
            [rule.pipeline_id, conn.workspace_id],
          )
        ).rows[0];
        if (!pipeline) throw invalid("RFQ pipeline is unavailable.", 409);
        const contact = contacts[0],
          company = contact
            ? (
                await c.query("SELECT company_id FROM contacts WHERE id=$1", [
                  contact.id,
                ])
              ).rows[0]?.company_id
            : null,
          currency =
            (
              await c.query(
                "SELECT default_currency FROM workspaces WHERE id=$1",
                [conn.workspace_id],
              )
            ).rows[0]?.default_currency || "USD";
        const deal = (
          await c.query(
            "INSERT INTO deals(workspace_id,title,contact_id,company_id,pipeline_id,stage_id,assigned_to,currency,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
            [
              conn.workspace_id,
              n.subject,
              contact?.id || null,
              company || null,
              rule.pipeline_id,
              rule.stage_id,
              rule.assigned_to,
              currency,
              "Created from inbound RFQ. " + n.sender_email,
            ],
          )
        ).rows[0];
        const due = new Date(
          new Date(n.received_at).getTime() + rule.sla_minutes * 60000,
        );
        const task = (
          await c.query(
            "INSERT INTO tasks(workspace_id,title,description,assigned_to,created_by,contact_id,company_id,deal_id,due_date,priority,reminder_at,urgent,important) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'high',$10,true,true) RETURNING id",
            [
              conn.workspace_id,
              "Respond to RFQ: " + n.subject,
              "Response SLA deadline: " + due.toISOString(),
              rule.assigned_to,
              conn.user_id,
              contact?.id || null,
              company || null,
              deal.id,
              due.toISOString().slice(0, 10),
              due,
            ],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO rfq_requests(workspace_id,message_id,rule_id,deal_id,task_id,assigned_to,due_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            conn.workspace_id,
            saved.id,
            rule.id,
            deal.id,
            task.id,
            rule.assigned_to,
            due,
          ],
        );
        await associate(c, conn.workspace_id, saved.id, {
          entity: "deal",
          entity_id: deal.id,
        });
      }
    }
    await c.query("COMMIT");
    return saved.id;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function sync(conn) {
  const lock = await db.pool.connect();
  try {
    if (
      !(
        await lock.query("SELECT pg_try_advisory_lock(9174,$1) AS locked", [
          conn.id,
        ])
      ).rows[0].locked
    )
      return { busy: true };
    const check = (
      await db.query(
        "SELECT u.workspace_id,w.space_type,w.owner_user_id FROM users u JOIN workspaces w ON w.id=$2 WHERE u.id=$1",
        [conn.user_id, conn.workspace_id],
      )
    ).rows[0];
    if (
      !check ||
      (check.space_type === "personal"
        ? check.owner_user_id !== conn.user_id
        : check.workspace_id !== conn.workspace_id)
    )
      throw invalid("Mailbox owner no longer has access.", 403);
    let total = 0;
    const rules = (
      await db.query(
        "SELECT * FROM rfq_rules WHERE connection_id=$1 AND enabled=true",
        [conn.id],
      )
    ).rows;
    for (const rule of [null, ...rules]) {
      let next =
        rule?.delta_url ||
        (!rule ? conn.delta_url : null) ||
        `/v1.0/me/mailFolders/${encodeURIComponent(rule?.folder_id || conn.folder_id)}/messages/delta?$select=id,conversationId,internetMessageId,subject,from,toRecipients,body,receivedDateTime,hasAttachments&$top=50`;
      for (let pages = 0; pages < 5 && next; pages++) {
        const data = await module.exports.graph(conn, next);
        for (const m of data.value || []) {
          await module.exports.ingest(conn, m, rule);
          total++;
        }
        const cursor = data["@odata.nextLink"] || data["@odata.deltaLink"];
        if (cursor) graphURL(cursor, conn);
        if (rule)
          await db.query("UPDATE rfq_rules SET delta_url=$1 WHERE id=$2", [
            cursor || next,
            rule.id,
          ]);
        else
          await db.query(
            "UPDATE communication_connections SET delta_url=$1,synced_at=now(),sync_error=NULL WHERE id=$2",
            [cursor || next, conn.id],
          );
        next = data["@odata.nextLink"];
      }
    }
    return { messages: total };
  } catch (e) {
    await db.query(
      "UPDATE communication_connections SET sync_error=$1 WHERE id=$2",
      [
        e.status
          ? e.message
          : "Mailbox synchronization failed. Reconnect or retry.",
        conn.id,
      ],
    );
    throw e;
  } finally {
    await lock
      .query("SELECT pg_advisory_unlock(9174,$1)", [conn.id])
      .catch(() => {});
    lock.release();
  }
}
let running = false;
function start() {
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const cs = (
        await db.query(
          "SELECT * FROM communication_connections WHERE provider='microsoft_mail' AND (synced_at IS NULL OR synced_at<now()-interval '1 minute') ORDER BY synced_at NULLS FIRST LIMIT 10",
        )
      ).rows;
      for (const c of cs) await module.exports.sync(c).catch(() => {});
    } catch {
    } finally {
      running = false;
    }
  }, 60000);
  timer.unref();
  return timer;
}
module.exports = {
  providers,
  base,
  redirect,
  configured,
  scopes,
  authorize,
  exchange,
  token,
  request,
  graphURL,
  graph,
  connection,
  entity,
  associate,
  message,
  ingest,
  sync,
  start,
};
