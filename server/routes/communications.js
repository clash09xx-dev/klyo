const crypto = require("crypto"),
  express = require("express"),
  db = require("../db"),
  C = require("../services/communications"),
  S = require("../services/sharepoint"),
  F = require("../services/cloudFiles"),
  { invalid, text, optionalId } = require("../services/dealWorkspace"),
  { requireAuth, requireEditor } = require("../middleware/auth"),
  { requirePaidAccess } = require("../middleware/billing");
const router = require("../middleware/safeRouter")();
const manager = (req, res, next) =>
  req.user.is_personal || req.user.is_team_owner
    ? next()
    : res.status(403).json({
        error:
          "Only the workspace owner can configure shared integrations and RFQ rules.",
      });
const cookie = (p) => "klyo_connect_" + p,
  opts = (p) => ({
    httpOnly: true,
    sameSite: "lax",
    secure: C.base().startsWith("https:"),
    path: "/api/communications/oauth/" + p + "/callback",
    maxAge: 600000,
  });
router.get("/oauth/:provider/callback", async (req, res) => {
  const p = req.params.provider,
    state = req.query.state,
    proof = String(req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim().split("="))
      .find((x) => x[0] === cookie(p))?.[1];
  if (!C.providers.includes(p) || typeof state !== "string" || proof !== state)
    return res.redirect(C.base() + "/app?integration=error");
  res.clearCookie(cookie(p), { ...opts(p), maxAge: undefined });
  const pending = (
    await db.query(
      "DELETE FROM communication_oauth WHERE id=$1 AND provider=$2 AND expires_at>now() RETURNING *",
      [state, p],
    )
  ).rows[0];
  if (!pending || req.query.error || typeof req.query.code !== "string")
    return res.redirect(C.base() + "/app?integration=cancelled");
  try {
    const account = (
      await db.query(
        "SELECT u.workspace_id,w.owner_user_id,w.space_type FROM users u JOIN workspaces w ON w.id=$2 WHERE u.id=$1",
        [pending.user_id, pending.workspace_id],
      )
    ).rows[0];
    if (
      !account ||
      account.workspace_id !== pending.account_workspace_id ||
      (account.space_type === "personal" &&
        account.owner_user_id !== pending.user_id) ||
      (p !== "microsoft_mail" && account.owner_user_id !== pending.user_id)
    )
      throw invalid("Workspace access changed.");
    const r = await C.exchange(
      p,
      req.query.code,
      S.decrypt(pending.verifier),
      pending.account_type,
    );
    const old = (
      await db.query(
        "SELECT id,account_id FROM communication_connections WHERE workspace_id=$1 AND user_id=$2 AND provider=$3 AND mailbox=''",
        [pending.workspace_id, pending.user_id, p],
      )
    ).rows[0];
    if (old && old.account_id !== r.account_id)
      await db.query("DELETE FROM communication_connections WHERE id=$1", [
        old.id,
      ]);
    await db.query(
      "INSERT INTO communication_connections(workspace_id,user_id,provider,credentials,account_name,account_id,account_type) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,user_id,provider,mailbox) DO UPDATE SET credentials=EXCLUDED.credentials,account_name=EXCLUDED.account_name,account_id=EXCLUDED.account_id,account_type=EXCLUDED.account_type,sync_error=NULL",
      [
        pending.workspace_id,
        pending.user_id,
        p,
        r.credentials,
        r.account_name,
        r.account_id,
        r.account_type || "organization",
      ],
    );
    res.redirect(
      C.base() +
        "/app?integration=connected&provider=" +
        p +
        "&scope=" +
        (account.space_type === "personal" ? "personal" : "team"),
    );
  } catch {
    res.redirect(C.base() + "/app?integration=error");
  }
});
router.use(requireAuth, requirePaidAccess);
router.get("/status", async (req, res) =>
  res.json({
    providers: C.providers.map((provider) => ({
      provider,
      configured: C.configured(provider),
    })),
    can_manage: !!(req.user.is_personal || req.user.is_team_owner),
    connections: (
      await db.query(
        "SELECT id,provider,account_name,account_type,mailbox,root_id,root_name,folder_id,synced_at,sync_error FROM communication_connections WHERE workspace_id=$1 AND (provider<>'microsoft_mail' OR user_id=$2) ORDER BY id",
        [req.user.workspace_id, req.user.id],
      )
    ).rows,
    apollo_connected: !!(
      await db.query(
        "SELECT workspace_id FROM apollo_connections WHERE workspace_id=$1",
        [req.user.workspace_id],
      )
    ).rows.length,
  }),
);
router.post("/connect/:provider", requireEditor, async (req, res) => {
  const p = req.params.provider;
  const type =
    p === "microsoft_mail"
      ? C.accountType(req.body.account_type)
      : "organization";
  if (
    p !== "microsoft_mail" &&
    !req.user.is_personal &&
    !req.user.is_team_owner
  )
    throw invalid("Only the owner can connect shared storage.", 403);
  const state = crypto.randomBytes(32).toString("hex"),
    verifier = crypto.randomBytes(48).toString("base64url"),
    url = await C.authorize(p, state, verifier, type);
  await db.query("DELETE FROM communication_oauth WHERE expires_at<now()");
  await db.query(
    "INSERT INTO communication_oauth(id,workspace_id,user_id,account_workspace_id,provider,verifier,account_type,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')",
    [
      state,
      req.user.workspace_id,
      req.user.id,
      req.account.workspace_id,
      p,
      S.encrypt(verifier),
      type,
    ],
  );
  res.cookie(cookie(p), state, opts(p)).json({ url });
});
router.delete("/connections/:id", requireEditor, async (req, res) => {
  const conn = await C.connection(req.user, req.params.id);
  if (
    conn.provider !== "microsoft_mail" &&
    !req.user.is_personal &&
    !req.user.is_team_owner
  )
    throw invalid("Only the owner can disconnect shared storage.", 403);
  await db.query("DELETE FROM communication_connections WHERE id=$1", [
    conn.id,
  ]);
  res.json({ ok: true });
});
router.post("/mail/:id/shared", requireEditor, async (req, res) => {
  const conn = await C.connection(req.user, req.params.id, true);
  if (conn.account_type === "personal")
    throw invalid(
      "Shared mailboxes require a Microsoft work or school account.",
      400,
    );
  const mailbox = String(req.body.mailbox || "")
    .trim()
    .toLowerCase();
  if (
    !/^[a-z0-9.!#$%&'*+?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(mailbox) ||
    mailbox.length > 254
  )
    throw invalid("Enter a shared mailbox email.");
  await C.graph({ ...conn, mailbox }, "/v1.0/me/mailFolders/inbox?$select=id");
  const r = await db.query(
    "INSERT INTO communication_connections(workspace_id,user_id,provider,credentials,account_name,account_id,mailbox) VALUES($1,$2,'microsoft_mail',$3,$4,$5,$4) ON CONFLICT(workspace_id,user_id,provider,mailbox) DO UPDATE SET credentials=EXCLUDED.credentials,account_id=EXCLUDED.account_id,sync_error=NULL RETURNING id",
    [
      req.user.workspace_id,
      req.user.id,
      conn.credentials,
      mailbox,
      conn.account_id,
    ],
  );
  res.status(201).json({ connection_id: r.rows[0].id });
});
router.get("/mail/folders/:id", async (req, res) => {
  const conn = await C.connection(req.user, req.params.id, true),
    parent = req.query.parent;
  const r = await C.graph(
    conn,
    parent
      ? "/v1.0/me/mailFolders/" + S.id(parent) + "/childFolders?$top=100"
      : "/v1.0/me/mailFolders?$top=100",
  );
  res.json({
    folders: (r.value || []).map((x) => ({
      id: x.id,
      name: x.displayName,
      child_count: x.childFolderCount,
    })),
  });
});
router.post("/mail/:id/sync", requireEditor, async (req, res) =>
  res.json(await C.sync(await C.connection(req.user, req.params.id, true))),
);
router.get("/mail", async (req, res) => {
  const params = [req.user.workspace_id, req.user.id],
    q = String(req.query.search || "").slice(0, 200),
    page = Math.min(10000, Math.max(0, Number(req.query.page) || 0));
  params.push("%" + q + "%", page * 50);
  res.json({
    messages: (
      await db.query(
        "SELECT id,subject,sender_name,sender_email,received_at,has_attachments,shared,removed,connection_id FROM correspondence WHERE workspace_id=$1 AND owner_id=$2 AND (subject ILIKE $3 OR sender_email ILIKE $3) ORDER BY received_at DESC,id DESC LIMIT 50 OFFSET $4",
        params,
      )
    ).rows,
  });
});
async function mail(req, id, ownerOnly = false) {
  const m = (
    await db.query(
      "SELECT * FROM correspondence WHERE id=$1 AND workspace_id=$2 AND (owner_id=$3 OR (shared=true AND $4=false))",
      [optionalId(id), req.user.workspace_id, req.user.id, ownerOnly],
    )
  ).rows[0];
  if (!m) throw invalid("Message not found.", 404);
  return m;
}
router.get("/mail/:id", async (req, res) => {
  const m = await mail(req, req.params.id);
  res.json({
    message: m,
    links: (
      await db.query(
        "SELECT entity,entity_id FROM correspondence_links WHERE message_id=$1",
        [m.id],
      )
    ).rows,
    attachments: (
      await db.query(
        "SELECT id,name,mime_type,size FROM correspondence_attachments WHERE message_id=$1",
        [m.id],
      )
    ).rows,
  });
});
router.get("/history", async (req, res) => {
  const e = await C.entity(
    db,
    req.user.workspace_id,
    req.query.entity,
    req.query.entity_id,
  );
  res.json({
    messages: (
      await db.query(
        "SELECT DISTINCT m.id,m.subject,m.sender_name,m.sender_email,m.received_at,m.has_attachments FROM correspondence m JOIN correspondence_links l ON l.message_id=m.id WHERE m.workspace_id=$1 AND (m.owner_id=$2 OR m.shared=true) AND l.entity=$3 AND l.entity_id=$4 ORDER BY m.received_at DESC LIMIT 200",
        [req.user.workspace_id, req.user.id, e.entity, e.entity_id],
      )
    ).rows,
  });
});
router.post("/mail/:id/link", requireEditor, async (req, res) => {
  const m = await mail(req, req.params.id, true),
    record = await C.entity(
      db,
      req.user.workspace_id,
      req.body.entity,
      req.body.entity_id,
    );
  if (!record.entity) throw invalid("Choose a record.");
  await C.associate(db, req.user.workspace_id, m.id, record);
  res.json({ ok: true });
});
router.post("/mail/:id/create", requireEditor, async (req, res) => {
  const m = await mail(req, req.params.id, true),
    type = req.body.type,
    name = text(req.body.name || m.subject, 300, "name", true);
  let record;
  if (type === "contact") {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        req.user.workspace_id,
      ]);
      await require("../services/limits").assertWithinLimit(
        req.user.workspace_id,
        "contacts",
        client,
      );
      const company = req.body.company_id
        ? await C.entity(
            client,
            req.user.workspace_id,
            "company",
            req.body.company_id,
          )
        : null;
      record = {
        entity: "contact",
        entity_id: (
          await client.query(
            "INSERT INTO contacts(workspace_id,full_name,email,owner_id,company_id) VALUES($1,$2,$3,$4,$5) RETURNING id",
            [
              req.user.workspace_id,
              name,
              m.sender_email,
              req.user.id,
              company?.entity_id || null,
            ],
          )
        ).rows[0].id,
      };
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } else if (type === "company") {
    record = {
      entity: "company",
      entity_id: (
        await db.query(
          "INSERT INTO companies(workspace_id,name) VALUES($1,$2) RETURNING id",
          [req.user.workspace_id, name],
        )
      ).rows[0].id,
    };
  } else if (type === "deal") {
    const d = await require("../services/dealWorkspace").saveDeal(
      db.pool,
      req.user,
      null,
      {
        title: name,
        contact_id: req.body.contact_id,
        company_id: req.body.company_id,
        pipeline_id: req.body.pipeline_id,
        stage_id: req.body.stage_id,
        notes: "From email: " + m.sender_email,
      },
    );
    record = { entity: "deal", entity_id: d.id };
  } else throw invalid("Choose contact, company or deal.");
  await C.associate(db, req.user.workspace_id, m.id, record);
  res.status(201).json({ record });
});
router.post("/mail/:id/attachments/sync", requireEditor, async (req, res) => {
  const m = await mail(req, req.params.id),
    conn = (
      await db.query("SELECT * FROM communication_connections WHERE id=$1", [
        m.connection_id,
      ])
    ).rows[0];
  if (!conn) throw invalid("Reconnect the original mailbox.", 409);
  const r = await C.graph(
    conn,
    "/v1.0/me/messages/" +
      S.id(m.provider_id) +
      "/attachments?$select=id,name,contentType,size,isInline&$top=100",
  );
  for (const a of r.value || [])
    if (a["@odata.type"] === "#microsoft.graph.fileAttachment" && !a.isInline)
      await db.query(
        "INSERT INTO correspondence_attachments(message_id,provider_id,name,mime_type,size) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id,provider_id) DO UPDATE SET name=EXCLUDED.name,size=EXCLUDED.size",
        [
          m.id,
          a.id,
          String(a.name || "attachment").slice(0, 300),
          a.contentType,
          Number(a.size) || 0,
        ],
      );
  res.json({
    attachments: (
      await db.query(
        "SELECT id,name,mime_type,size FROM correspondence_attachments WHERE message_id=$1",
        [m.id],
      )
    ).rows,
  });
});
router.get("/attachments/:id/download", async (req, res) => {
  const a = (
    await db.query(
      "SELECT a.*,m.workspace_id,m.owner_id,m.shared,m.connection_id,m.provider_id AS message_provider_id FROM correspondence_attachments a JOIN correspondence m ON m.id=a.message_id WHERE a.id=$1 AND m.workspace_id=$2 AND (m.owner_id=$3 OR m.shared=true)",
      [optionalId(req.params.id), req.user.workspace_id, req.user.id],
    )
  ).rows[0];
  if (!a) throw invalid("Attachment not found.", 404);
  if (Number(a.size) > 20 * 1024 * 1024)
    throw invalid(
      "Open large attachments in Outlook. The download limit is 20 MB.",
    );
  const conn = (
      await db.query("SELECT * FROM communication_connections WHERE id=$1", [
        a.connection_id,
      ])
    ).rows[0],
    r = await C.graph(
      conn,
      "/v1.0/me/messages/" +
        S.id(a.message_provider_id) +
        "/attachments/" +
        S.id(a.provider_id),
    );
  if (
    typeof r.contentBytes !== "string" ||
    r.contentBytes.length > 28 * 1024 * 1024
  )
    throw invalid("Attachment is unavailable or too large.", 502);
  res
    .set({
      "Content-Type": "application/octet-stream",
      "Content-Disposition":
        "attachment; filename*=UTF-8''" + encodeURIComponent(a.name),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    })
    .send(Buffer.from(r.contentBytes, "base64"));
});
router.get("/rfq/rules", manager, async (req, res) =>
  res.json({
    rules: (
      await db.query(
        "SELECT r.* FROM rfq_rules r JOIN communication_connections c ON c.id=r.connection_id WHERE r.workspace_id=$1 AND c.user_id=$2 ORDER BY r.id",
        [req.user.workspace_id, req.user.id],
      )
    ).rows,
  }),
);
router.post("/rfq/rules", manager, async (req, res) => {
  const b = req.body,
    conn = await C.connection(req.user, b.connection_id, true),
    assigned = optionalId(b.assigned_to),
    sla = Number(b.sla_minutes),
    folder = text(b.folder_id, 500, "mail folder", true),
    pipeline = optionalId(b.pipeline_id),
    stage = optionalId(b.stage_id);
  if (
    !(await require("../services/spaces").canLinkUser(
      db,
      assigned,
      req.user.workspace_id,
    ))
  )
    throw invalid("Choose a workspace assignee.");
  if (!Number.isInteger(sla) || sla < 1 || sla > 43200)
    throw invalid("SLA must be 1–43200 minutes.");
  if (
    !(
      await db.query(
        "SELECT id FROM sales_pipelines WHERE id=$1 AND workspace_id=$2",
        [pipeline, req.user.workspace_id],
      )
    ).rows.length
  )
    throw invalid("Choose a workspace pipeline.");
  if (
    stage &&
    !(
      await db.query(
        "SELECT id FROM pipeline_stages WHERE id=$1 AND pipeline_id=$2 AND workspace_id=$3",
        [stage, pipeline, req.user.workspace_id],
      )
    ).rows.length
  )
    throw invalid("Choose a stage in this pipeline.");
  await C.graph(conn, "/v1.0/me/mailFolders/" + S.id(folder) + "?$select=id");
  const domain = text(
    b.sender_domain || "",
    253,
    "sender domain",
  ).toLowerCase();
  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))
    throw invalid("Enter a sender domain without @.");
  const rule = (
    await db.query(
      "INSERT INTO rfq_rules(workspace_id,connection_id,name,folder_id,subject_contains,sender_domain,assigned_to,pipeline_id,stage_id,sla_minutes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(connection_id,folder_id) DO UPDATE SET name=EXCLUDED.name,subject_contains=EXCLUDED.subject_contains,sender_domain=EXCLUDED.sender_domain,assigned_to=EXCLUDED.assigned_to,pipeline_id=EXCLUDED.pipeline_id,stage_id=EXCLUDED.stage_id,sla_minutes=EXCLUDED.sla_minutes,enabled=true RETURNING *",
      [
        req.user.workspace_id,
        conn.id,
        text(b.name, 150, "rule name", true),
        folder,
        text(b.subject_contains || "", 200, "subject filter"),
        domain,
        assigned,
        pipeline,
        stage,
        sla,
      ],
    )
  ).rows[0];
  res.status(201).json({ rule });
});
router.delete("/rfq/rules/:id", manager, async (req, res) => {
  await db.query(
    "DELETE FROM rfq_rules WHERE id=$1 AND workspace_id=$2 AND connection_id IN(SELECT id FROM communication_connections WHERE user_id=$3)",
    [optionalId(req.params.id), req.user.workspace_id, req.user.id],
  );
  res.json({ ok: true });
});
router.get("/rfq", async (req, res) =>
  res.json({
    requests: (
      await db.query(
        "SELECT r.*,m.subject,m.sender_email,u.name AS assignee_name,d.title AS deal_title FROM rfq_requests r JOIN correspondence m ON m.id=r.message_id LEFT JOIN users u ON u.id=r.assigned_to LEFT JOIN deals d ON d.id=r.deal_id AND d.workspace_id=r.workspace_id WHERE r.workspace_id=$1 ORDER BY r.due_at DESC LIMIT 1000",
        [req.user.workspace_id],
      )
    ).rows,
    server_time: new Date().toISOString(),
  }),
);
router.patch("/rfq/:id", requireEditor, async (req, res) => {
  if (!["new", "in_progress", "responded", "closed"].includes(req.body.status))
    throw invalid("Invalid RFQ status.");
  const r = (
    await db.query(
      "UPDATE rfq_requests SET status=$1,responded_at=CASE WHEN $1='responded' THEN COALESCE(responded_at,now()) ELSE responded_at END WHERE id=$2 AND workspace_id=$3 RETURNING *",
      [req.body.status, optionalId(req.params.id), req.user.workspace_id],
    )
  ).rows[0];
  if (!r) throw invalid("RFQ not found.", 404);
  res.json({ request: r });
});
router.get("/cloud/:id/setup", manager, async (req, res) => {
  const c = await C.connection(req.user, req.params.id);
  if (c.provider === "microsoft_mail") throw invalid("Choose cloud storage.");
  res.json(
    await F.setupFolders(c, req.query.folder_id || "root", req.query.cursor),
  );
});
router.put("/cloud/:id/root", manager, async (req, res) => {
  const c = await C.connection(req.user, req.params.id);
  if (c.provider === "microsoft_mail") throw invalid("Choose cloud storage.");
  const f = await F.metadata(c, F.fid(req.body.folder_id));
  if (
    c.provider === "google_drive"
      ? f.mimeType !== F.folderMime
      : f[".tag"] !== "folder"
  )
    throw invalid("Choose a folder.");
  await db.query(
    "UPDATE communication_connections SET root_id=$1,root_name=$2 WHERE id=$3",
    [f.id, f.name, c.id],
  );
  res.json({ ok: true });
});
router.get("/cloud/:id/children", async (req, res) => {
  const c = await C.connection(req.user, req.params.id);
  if (c.provider === "microsoft_mail") throw invalid("Choose cloud storage.");
  res.json(await F.list(c, req.query.folder_id, req.query.cursor));
});
router.get("/cloud/files", async (req, res) => {
  let query = "",
    params = [req.user.workspace_id];
  if (req.query.entity) {
    const e = await C.entity(
      db,
      req.user.workspace_id,
      req.query.entity,
      req.query.entity_id,
    );
    query =
      " AND " +
      require("../services/recordLinks").inheritingCondition(e.entity, "f");
    params.push(e.entity, e.entity_id);
  }
  res.json({
    files: (
      await db.query(
        "SELECT f.*,c.provider,c.root_name FROM cloud_file_links f JOIN communication_connections c ON c.id=f.connection_id WHERE f.workspace_id=$1" +
          query +
          " ORDER BY f.created_at DESC LIMIT 1000",
        params,
      )
    ).rows,
  });
});
router.post("/cloud/:id/link", requireEditor, async (req, res) => {
  const c = await C.connection(req.user, req.params.id);
  if (c.provider === "microsoft_mail") throw invalid("Choose cloud storage.");
  const e = await C.entity(
      db,
      req.user.workspace_id,
      req.body.entity,
      req.body.entity_id,
    ),
    f = await F.within(c, F.fid(req.body.item_id));
  res.status(201).json({ file: await F.link(c, req.user, f, e) });
});
router.post(
  "/cloud/:id/upload",
  requireEditor,
  express.raw({ type: "application/octet-stream", limit: "20mb" }),
  async (req, res) => {
    const c = await C.connection(req.user, req.params.id);
    if (c.provider === "microsoft_mail") throw invalid("Choose cloud storage.");
    const e = await C.entity(
        db,
        req.user.workspace_id,
        req.query.entity,
        req.query.entity_id,
      ),
      f = await F.upload(
        c,
        req.query.folder_id,
        text(req.query.name, 180, "name", true),
        req.body,
      );
    res.status(201).json({ file: await F.link(c, req.user, f, e) });
  },
);
router.get("/cloud/files/:id/download", async (req, res) => {
  const f = (
    await db.query(
      "SELECT * FROM cloud_file_links WHERE id=$1 AND workspace_id=$2",
      [optionalId(req.params.id), req.user.workspace_id],
    )
  ).rows[0];
  if (!f) throw invalid("File not found.", 404);
  if (Number(f.size) > 20 * 1024 * 1024)
    throw invalid("Open files over 20 MB directly in your storage provider.");
  const c = await C.connection(req.user, f.connection_id),
    r = await F.download(c, f.provider_id);
  let n = 0,
    chunks = [];
  for await (const chunk of r.body) {
    n += chunk.length;
    if (n > 20 * 1024 * 1024) throw invalid("File is too large.");
    chunks.push(chunk);
  }
  res
    .set({
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition":
        "attachment; filename*=UTF-8''" + encodeURIComponent(f.name),
    })
    .send(Buffer.concat(chunks));
});
router.delete("/cloud/files/:id", requireEditor, async (req, res) => {
  await db.query(
    "DELETE FROM cloud_file_links WHERE id=$1 AND workspace_id=$2",
    [optionalId(req.params.id), req.user.workspace_id],
  );
  res.json({ ok: true });
});
router.put("/apollo", manager, async (req, res) => {
  const key = text(req.body.api_key, 1000, "Apollo API key", true);
  await db.query(
    "INSERT INTO apollo_connections(workspace_id,api_key,connected_by) VALUES($1,$2,$3) ON CONFLICT(workspace_id) DO UPDATE SET api_key=EXCLUDED.api_key,connected_by=EXCLUDED.connected_by",
    [req.user.workspace_id, S.encrypt(key), req.user.id],
  );
  res.json({ ok: true });
});
router.delete("/apollo", manager, async (req, res) => {
  await db.query("DELETE FROM apollo_connections WHERE workspace_id=$1", [
    req.user.workspace_id,
  ]);
  res.json({ ok: true });
});
router.post("/apollo/search", requireEditor, async (req, res) => {
  const conn = (
    await db.query(
      "SELECT api_key FROM apollo_connections WHERE workspace_id=$1",
      [req.user.workspace_id],
    )
  ).rows[0];
  if (!conn) throw invalid("Connect an Apollo API key first.", 409);
  const b = req.body;
  const data = {
    page: Math.min(100, Math.max(1, Number(b.page) || 1)),
    per_page: 25,
  };
  if (b.title) data.person_titles = [text(b.title, 150, "job title")];
  if (b.domain)
    data.q_organization_domains_list = [text(b.domain, 250, "company domain")];
  if (b.keywords) data.q_keywords = text(b.keywords, 200, "keywords");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value))
      for (const v of value) query.append(key + "[]", v);
    else query.set(key, String(value));
  }
  const r = await C.request(
    "https://api.apollo.io/api/v1/mixed_people/api_search?" + query,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": S.decrypt(conn.api_key),
      },
    },
  );
  const result = await r.json();
  res.json({
    people: (result.people || []).slice(0, 25).map((p) => ({
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name || p.last_name_obfuscated,
      title: p.title,
      company: p.organization?.name,
      has_email: !!p.has_email,
    })),
    total: result.total_entries || 0,
  });
});
router.post("/apollo/import", requireEditor, async (req, res) => {
  const ids = req.body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 10 ||
    ids.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,150}$/.test(id),
    )
  )
    throw invalid("Select 1–10 Apollo people.");
  if (req.body.confirm_credits !== true)
    throw invalid("Confirm Apollo enrichment credit usage before importing.");
  const conn = (
    await db.query(
      "SELECT api_key FROM apollo_connections WHERE workspace_id=$1",
      [req.user.workspace_id],
    )
  ).rows[0];
  if (!conn) throw invalid("Connect Apollo first.", 409);
  const present = (
      await db.query(
        "SELECT apollo_id FROM apollo_imports WHERE workspace_id=$1 AND apollo_id=ANY($2::text[]) AND contact_id IS NOT NULL",
        [req.user.workspace_id, ids],
      )
    ).rows.map((x) => x.apollo_id),
    pending = [...new Set(ids)].filter((id) => !present.includes(id));
  if (!pending.length) return res.json({ imported: 0, skipped: ids.length });
  const r = await C.request(
      "https://api.apollo.io/api/v1/people/bulk_match?reveal_personal_emails=false&reveal_phone_number=false",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": S.decrypt(conn.api_key),
        },
        body: JSON.stringify({ details: pending.map((id) => ({ id })) }),
      },
    ),
    data = await r.json(),
    c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      req.user.workspace_id,
    ]);
    let imported = 0,
      skipped = present.length;
    for (const p of data.matches || []) {
      if (!p?.id || !ids.includes(p.id) || !p.email) {
        skipped++;
        continue;
      }
      const already = (
        await c.query(
          "SELECT contact_id FROM apollo_imports WHERE workspace_id=$1 AND apollo_id=$2",
          [req.user.workspace_id, p.id],
        )
      ).rows[0];
      if (already?.contact_id) {
        skipped++;
        continue;
      }
      const found = (
        await c.query(
          "SELECT id FROM contacts WHERE workspace_id=$1 AND lower(email)=lower($2) ORDER BY id LIMIT 1",
          [req.user.workspace_id, p.email],
        )
      ).rows[0];
      let contact = found?.id;
      if (!contact) {
        await require("../services/limits").assertWithinLimit(
          req.user.workspace_id,
          "contacts",
          c,
        );
        const companyName = String(p.organization?.name || "").slice(0, 300);
        let company = null;
        if (companyName) {
          company = (
            await c.query(
              "SELECT id FROM companies WHERE workspace_id=$1 AND lower(name)=lower($2) ORDER BY id LIMIT 1",
              [req.user.workspace_id, companyName],
            )
          ).rows[0]?.id;
          if (!company)
            company = (
              await c.query(
                "INSERT INTO companies(workspace_id,name) VALUES($1,$2) RETURNING id",
                [req.user.workspace_id, companyName],
              )
            ).rows[0].id;
        }
        contact = (
          await c.query(
            "INSERT INTO contacts(workspace_id,full_name,first_name,last_name,email,title,company_id,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
            [
              req.user.workspace_id,
              String(
                p.name ||
                  [p.first_name, p.last_name].filter(Boolean).join(" ") ||
                  p.email,
              ).slice(0, 300),
              String(p.first_name || "").slice(0, 150),
              String(p.last_name || "").slice(0, 150),
              String(p.email).slice(0, 320),
              String(p.title || "").slice(0, 300),
              company,
              req.user.id,
            ],
          )
        ).rows[0].id;
        imported++;
      } else skipped++;
      await c.query(
        "INSERT INTO apollo_imports(workspace_id,apollo_id,contact_id) VALUES($1,$2,$3) ON CONFLICT(workspace_id,apollo_id) DO UPDATE SET contact_id=EXCLUDED.contact_id",
        [req.user.workspace_id, p.id, contact],
      );
    }
    await c.query("COMMIT");
    res.json({ imported, skipped });
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});
router.get("/tracking", async (req, res) => {
  const carrier = String(req.query.carrier || "").toLowerCase(),
    number = text(req.query.number, 100, "tracking number", true);
  if (!/^[a-zA-Z0-9 -]{4,100}$/.test(number))
    throw invalid("Enter a valid tracking number.");
  const n = encodeURIComponent(number),
    urls = {
      dhl: "https://www.dhl.com/pl-en/home/tracking.html?tracking-id=" + n,
      ups: "https://www.ups.com/track?tracknum=" + n,
      fedex: "https://www.fedex.com/fedextrack/?trknbr=" + n,
      dpd: "https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=" + n,
      inpost: "https://inpost.pl/sledzenie-przesylek?number=" + n,
    };
  if (!urls[carrier]) throw invalid("Choose DHL, UPS, FedEx, DPD or InPost.");
  res.json({
    carrier,
    tracking_number: number,
    url: urls[carrier],
    mode: "carrier_portal",
  });
});
const I = require("../services/invoiceProvider");
router.get("/invoice-provider", manager, async (req, res) => {
  const c = (
    await db.query(
      "SELECT subdomain FROM invoice_provider_connections WHERE workspace_id=$1",
      [req.user.workspace_id],
    )
  ).rows[0];
  res.json({ connected: !!c, subdomain: c?.subdomain || "" });
});
router.put("/invoice-provider", manager, async (req, res) => {
  const domain = text(
    req.body.subdomain,
    63,
    "account subdomain",
    true,
  ).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(domain))
    throw invalid("Enter only your Fakturownia account subdomain.");
  await db.query(
    "INSERT INTO invoice_provider_connections(workspace_id,subdomain,api_token,connected_by) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id) DO UPDATE SET subdomain=EXCLUDED.subdomain,api_token=EXCLUDED.api_token,connected_by=EXCLUDED.connected_by",
    [
      req.user.workspace_id,
      domain,
      S.encrypt(text(req.body.api_token, 1000, "API token", true)),
      req.user.id,
    ],
  );
  res.json({ ok: true });
});
router.delete("/invoice-provider", manager, async (req, res) => {
  await db.query(
    "DELETE FROM invoice_provider_connections WHERE workspace_id=$1",
    [req.user.workspace_id],
  );
  res.json({ ok: true });
});
router.post(
  "/invoice-provider/orders/:id/preview",
  requireEditor,
  async (req, res) => {
    const p = await I.preview(req.user, req.params.id, req.body);
    res.json({
      invoice: p.invoice,
      order_id: p.order.id,
      order_total: p.order.total,
      preview_token: p.preview_token,
    });
  },
);
router.post("/invoice-provider/orders/:id/issue", manager, async (req, res) =>
  res.status(201).json(await I.create(req.user, req.params.id, req.body)),
);
router.post("/invoice-provider/orders/:id/sync", manager, async (req, res) =>
  res.json(await I.status(req.user, req.params.id)),
);
router.post(
  "/invoice-provider/orders/:id/reconcile",
  manager,
  async (req, res) => {
    const n = String(req.body.provider_id || "");
    if (!/^[0-9]{1,20}$/.test(n))
      throw invalid("Enter the provider invoice ID.");
    const c = await I.connection(req.user.workspace_id),
      r = await I.api(c, "/invoices/" + n + ".json"),
      link = (
        await db.query(
          "SELECT * FROM invoice_provider_links WHERE order_id=$1 AND workspace_id=$2",
          [optionalId(req.params.id), req.user.workspace_id],
        )
      ).rows[0];
    if (
      !link ||
      link.provider_subdomain !== c.subdomain ||
      r.oid !== link.external_ref
    )
      throw invalid("Invoice external ID does not match this CRM order.");
    await db.query(
      "UPDATE invoice_provider_links SET provider_id=$1,status='needs_reconciliation' WHERE order_id=$2",
      [n, link.order_id],
    );
    res.json(await I.status(req.user, req.params.id));
  },
);
module.exports = router;
