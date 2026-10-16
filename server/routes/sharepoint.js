const crypto = require("crypto"),
  express = require("express"),
  db = require("../db"),
  S = require("../services/sharepoint"),
  { requireAuth, requireEditor } = require("../middleware/auth"),
  { requirePaidAccess } = require("../middleware/billing"),
  { invalid, text, optionalId } = require("../services/dealWorkspace");
const router = require("../middleware/safeRouter")(),
  owner = (req, res, next) => {
    if (!(req.user.is_personal || req.user.is_team_owner))
      return res
        .status(403)
        .json({
          error: "Only the team owner can connect or configure SharePoint.",
        });
    next();
  };
const appURL = () => process.env.APP_URL || "http://localhost:4000",
  cookie = "klyo_sharepoint_connect",
  cookieOptions = () => ({
    httpOnly: true,
    sameSite: "lax",
    secure: appURL().startsWith("https:"),
    path: "/api/sharepoint/callback",
    maxAge: 600000,
  });
router.get("/callback", async (req, res) => {
  const { state, code, error } = req.query;
  const cookies = String(req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim().split("="));
  const proof = cookies.find(([k]) => k === cookie)?.[1];
  res.clearCookie(cookie, { ...cookieOptions(), maxAge: undefined });
  if (
    typeof state !== "string" ||
    !proof ||
    proof !== state ||
    (!error && typeof code !== "string")
  )
    return res.redirect(appURL() + "/app?sharepoint=error");
  const pending = (
    await db.query(
      "DELETE FROM sharepoint_oauth_states WHERE id=$1 AND expires_at>now() RETURNING *",
      [state],
    )
  ).rows[0];
  if (!pending) return res.redirect(appURL() + "/app?sharepoint=expired");
  if (error) return res.redirect(appURL() + "/app?sharepoint=cancelled");
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
      account.owner_user_id !== pending.user_id
    )
      throw invalid("Workspace access changed.");
    const result = await S.exchange(code, S.decrypt(pending.verifier));
    await db.query(
      `INSERT INTO sharepoint_connections(workspace_id,connected_by,account_id,account_name,token_cache,generation) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id) DO UPDATE SET connected_by=EXCLUDED.connected_by,account_id=EXCLUDED.account_id,account_name=EXCLUDED.account_name,token_cache=EXCLUDED.token_cache,generation=EXCLUDED.generation,site_id=NULL,site_name=NULL,drive_id=NULL,drive_name=NULL,root_id=NULL,root_name=NULL,connected_at=now()`,
      [
        pending.workspace_id,
        pending.user_id,
        result.account.homeAccountId,
        result.account.username,
        result.cache,
        crypto.randomUUID(),
      ],
    );
    res.redirect(
      appURL() +
        "/app?sharepoint=connected&scope=" +
        (account.space_type === "personal" ? "personal" : "team"),
    );
  } catch {
    res.redirect(appURL() + "/app?sharepoint=error");
  }
});
router.use(requireAuth, requirePaidAccess);
router.get("/status", async (req, res) => {
  const c = (
    await db.query(
      "SELECT account_name,site_name,drive_name,root_name,root_id,connected_at FROM sharepoint_connections WHERE workspace_id=$1",
      [req.user.workspace_id],
    )
  ).rows[0];
  res.json({
    configured: S.configured(),
    connected: !!c,
    ready: !!c?.root_id,
    can_manage: req.user.is_personal || req.user.is_team_owner,
    connection: c || null,
    max_upload_bytes: 250 * 1024 * 1024,
  });
});
router.post("/connect", owner, async (req, res) => {
  if (!S.configured())
    throw invalid(
      "The Klyo owner needs to enable Microsoft sign-in first.",
      503,
    );
  const state = crypto.randomBytes(32).toString("hex"),
    verifier = crypto.randomBytes(48).toString("base64url");
  const url = await S.authorize(state, verifier);
  await db.query(
    "DELETE FROM sharepoint_oauth_states WHERE expires_at<now() OR (workspace_id=$1 AND user_id=$2)",
    [req.user.workspace_id, req.user.id],
  );
  await db.query(
    "INSERT INTO sharepoint_oauth_states(id,workspace_id,user_id,account_workspace_id,verifier,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')",
    [
      state,
      req.user.workspace_id,
      req.user.id,
      req.account.workspace_id,
      S.encrypt(verifier),
    ],
  );
  res.cookie(cookie, state, cookieOptions()).json({ url });
});
router.delete("/connection", owner, async (req, res) => {
  await db.query("DELETE FROM sharepoint_connections WHERE workspace_id=$1", [
    req.user.workspace_id,
  ]);
  await db.query(
    "DELETE FROM sharepoint_uploads WHERE workspace_id=$1 AND completed_file_id IS NULL",
    [req.user.workspace_id],
  );
  res.json({ ok: true });
});
router.get("/sites", owner, async (req, res) => {
  const query = text(req.query.search || "*", 150, "site search", true),
    r = await S.graph(
      req.user.workspace_id,
      "/sites?search=" + encodeURIComponent(query) + "&$top=50",
    );
  res.json({
    sites: (r.value || []).map((s) => ({
      id: s.id,
      name: s.displayName || s.name,
      web_url: S.safeURL(s.webUrl),
    })),
  });
});
router.get("/drives", owner, async (req, res) => {
  const r = await S.graph(
    req.user.workspace_id,
    `/sites/${S.id(req.query.site_id)}/drives`,
  );
  res.json({
    drives: (r.value || []).map((d) => ({ id: d.id, name: d.name })),
  });
});
async function children(req, setup = false) {
  const c = await S.connection(req.user.workspace_id, !setup);
  const drive = setup ? req.query.drive_id : c.drive_id,
    folder = req.query.folder_id || (setup ? "root" : c.root_id);
  if (setup) {
    const drives = await S.graph(
      req.user.workspace_id,
      `/sites/${S.id(req.query.site_id)}/drives`,
    );
    if (!drives.value?.some((d) => d.id === drive))
      throw invalid("Choose a library in this site.");
  } else {
    const item = await S.within(req.user.workspace_id, c, folder);
    if (!item.folder) throw invalid("Choose a folder.");
  }
  const query =
    "?$top=100" +
    (req.query.cursor
      ? "&$skiptoken=" +
        encodeURIComponent(text(req.query.cursor, 10000, "page cursor"))
      : "");
  const result = await S.graph(
    req.user.workspace_id,
    `/drives/${S.id(drive)}/${folder === "root" ? "root" : "items/" + S.id(folder)}/children` +
      query,
  );
  let cursor = null;
  if (result["@odata.nextLink"]) {
    const url = new URL(result["@odata.nextLink"]);
    cursor =
      url.searchParams.get("$skiptoken") || url.searchParams.get("$skipToken");
  }
  return { items: (result.value || []).map(S.publicItem), cursor };
}
router.get("/setup/folders", owner, async (req, res) =>
  res.json(await children(req, true)),
);
router.put("/folder", owner, async (req, res) => {
  const { site_id, drive_id, root_id } = req.body,
    c = await S.connection(req.user.workspace_id, false),
    site = await S.graph(req.user.workspace_id, "/sites/" + S.id(site_id)),
    drives = await S.graph(
      req.user.workspace_id,
      `/sites/${S.id(site_id)}/drives`,
    ),
    drive = drives.value?.find((d) => d.id === drive_id);
  if (!drive) throw invalid("Choose a library in this site.");
  const folder = await S.graph(
    req.user.workspace_id,
    `/drives/${S.id(drive_id)}/${root_id === "root" ? "root" : "items/" + S.id(root_id)}`,
  );
  if (!folder.folder) throw invalid("Choose a folder for CRM files.");
  const updated = await db.query(
    "UPDATE sharepoint_connections SET site_id=$1,site_name=$2,drive_id=$3,drive_name=$4,root_id=$5,root_name=$6,generation=$7 WHERE workspace_id=$8 AND generation=$9",
    [
      site_id,
      site.displayName || site.name,
      drive_id,
      drive.name,
      folder.id,
      folder.name,
      crypto.randomUUID(),
      req.user.workspace_id,
      c.generation,
    ],
  );
  if (!updated.rowCount)
    throw invalid("The connection changed. Refresh and try again.", 409);
  res.json({ ok: true });
});
router.get("/content", async (req, res) => {
  const c = await S.connection(req.user.workspace_id),
    item = await S.within(req.user.workspace_id, c, req.query.item_id);
  if (!item.file || !Number(item.size) || Number(item.size) > 10 * 1024 * 1024)
    throw invalid("Choose a CSV or Excel file up to 10 MB.");
  if (!/\.(csv|xlsx)$/i.test(item.name))
    throw invalid("Choose a CSV or XLSX price list.");
  const url = S.uploadURL(item["@microsoft.graph.downloadUrl"]);
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw invalid("Unable to download this price list.", 502);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) {
      await response.body.cancel().catch(() => {});
      throw invalid("Price list is too large.");
    }
    chunks.push(chunk);
  }
  res
    .set({
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    })
    .send(Buffer.concat(chunks));
});
router.get("/children", async (req, res) => res.json(await children(req)));
router.get("/files", async (req, res) => {
  const params = [req.user.workspace_id];
  let filter = "";
  if (req.query.entity) {
    const record = await S.entity(
      db,
      req.user.workspace_id,
      req.query.entity,
      req.query.entity_id,
    );
    params.push(record.entity, record.entity_id);
    filter = " AND "+require("../services/recordLinks").inheritingCondition(record.entity,"f");
  }
  res.json({
    files: (
      await db.query(
        "SELECT id,name,size,mime_type,entity,entity_id,created_at FROM workspace_files f WHERE workspace_id=$1" +
          filter +
          " ORDER BY created_at DESC,id DESC LIMIT 1000",
        params,
      )
    ).rows,
  });
});
router.post("/link", requireEditor, async (req, res) => {
  const c = await S.connection(req.user.workspace_id),
    record = await S.entity(
      db,
      req.user.workspace_id,
      req.body.entity,
      req.body.entity_id,
    ),
    item = await S.within(req.user.workspace_id, c, req.body.item_id);
  res.status(201).json({ file: await S.link(db, req.user, c, item, record) });
});
router.get("/files/:id/open", async (req, res) => {
  const file = (
    await db.query(
      "SELECT * FROM workspace_files WHERE id=$1 AND workspace_id=$2",
      [optionalId(req.params.id), req.user.workspace_id],
    )
  ).rows[0];
  if (!file) throw invalid("File not found.", 404);
  const c = await S.connection(req.user.workspace_id);
  if (c.drive_id !== file.drive_id)
    throw invalid(
      "Reconnect the original document library to open this file.",
      409,
    );
  const item = await S.within(req.user.workspace_id, c, file.item_id),
    url = S.safeURL(item.webUrl);
  if (!url) throw invalid("Microsoft did not return a valid file link.", 502);
  res.json({ url });
});
router.delete("/files/:id", requireEditor, async (req, res) => {
  if (
    !(
      await db.query(
        "DELETE FROM workspace_files WHERE id=$1 AND workspace_id=$2 RETURNING id",
        [optionalId(req.params.id), req.user.workspace_id],
      )
    ).rows.length
  )
    throw invalid("File not found.", 404);
  res.json({ ok: true });
});
router.post("/uploads", requireEditor, async (req, res) => {
  await db.query(
    "DELETE FROM sharepoint_uploads WHERE workspace_id=$1 AND expires_at<now()",
    [req.user.workspace_id],
  );
  const c = await S.connection(req.user.workspace_id),
    folder = await S.within(
      req.user.workspace_id,
      c,
      req.body.folder_id || c.root_id,
    );
  if (!folder.folder) throw invalid("Choose a folder.");
  const name = text(req.body.name, 180, "file name", true),
    size = Number(req.body.size);
  if (
    /[\\/:*?"<>|\x00-\x1f]/.test(name) ||
    /^\.+$/.test(name) ||
    /[. ]$/.test(name)
  )
    throw invalid("Choose a valid file name.");
  if (!Number.isSafeInteger(size) || size < 1 || size > 250 * 1024 * 1024)
    throw invalid("Upload a file between 1 byte and 250 MB.");
  const record = await S.entity(
      db,
      req.user.workspace_id,
      req.body.entity,
      req.body.entity_id,
    ),
    id = crypto.randomUUID(),
    dot = name.lastIndexOf("."),
    actual =
      dot > 0
        ? name.slice(0, dot) + " (" + id.slice(0, 8) + ")" + name.slice(dot)
        : name + " (" + id.slice(0, 8) + ")";
  const upload = await S.graph(
    req.user.workspace_id,
    `/drives/${S.id(c.drive_id)}/items/${S.id(folder.id)}:/${encodeURIComponent(actual)}:/createUploadSession`,
    {
      method: "POST",
      body: JSON.stringify({
        item: { "@microsoft.graph.conflictBehavior": "fail", name: actual },
      }),
    },
  );
  await db.query(
    "INSERT INTO sharepoint_uploads(id,workspace_id,user_id,generation,upload_url,total_bytes,name,entity,entity_id,expires_at,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      id,
      req.user.workspace_id,
      req.user.id,
      c.generation,
      S.encrypt(S.uploadURL(upload.uploadUrl)),
      size,
      actual,
      record.entity,
      record.entity_id,
      upload.expirationDateTime,
      folder.id,
    ],
  );
  res.status(201).json({ id, offset: 0, chunk_size: 5242880 });
});
router.put(
  "/uploads/:id",
  requireEditor,
  express.raw({ type: "application/octet-stream", limit: "6mb" }),
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const upload = (
        await client.query(
          "SELECT * FROM sharepoint_uploads WHERE id=$1 AND workspace_id=$2 AND user_id=$3 FOR UPDATE",
          [req.params.id, req.user.workspace_id, req.user.id],
        )
      ).rows[0];
      if (!upload) throw invalid("Upload not found.", 404);
      if (upload.completed_file_id) {
        await client.query("COMMIT");
        return res.json({
          offset: Number(upload.total_bytes),
          file_id: upload.completed_file_id,
          done: true,
        });
      }
      if (new Date(upload.expires_at) < new Date())
        throw invalid("This upload expired. Start it again.", 410);
      const c = await S.connection(req.user.workspace_id);
      if (c.generation !== upload.generation)
        throw invalid(
          "The SharePoint folder changed. Start the upload again.",
          409,
        );
      const record = await S.entity(
          client,
          req.user.workspace_id,
          upload.entity,
          upload.entity_id,
        ),
        range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
          req.headers["content-range"] || "",
        );
      if (!range || !Buffer.isBuffer(req.body))
        throw invalid("Send a valid file chunk.");
      const [start, end, total] = range.slice(1).map(Number);
      if (
        total !== Number(upload.total_bytes) ||
        end >= total ||
        start > end ||
        end - start + 1 !== req.body.length ||
        req.body.length > 5242880 ||
        (end + 1 < total && req.body.length % 327680 !== 0)
      )
        throw invalid("Invalid upload range.");
      if (
        start < Number(upload.uploaded_bytes) &&
        end < Number(upload.uploaded_bytes)
      ) {
        await client.query("COMMIT");
        return res.json({ offset: Number(upload.uploaded_bytes), done: false });
      }
      if (start !== Number(upload.uploaded_bytes))
        throw invalid("Resume from the last confirmed file chunk.", 409);
      const url = S.uploadURL(S.decrypt(upload.upload_url));
      let response = await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Range": `bytes ${start}-${end}/${total}`,
          },
          body: req.body,
          redirect: "error",
          signal: AbortSignal.timeout(60000),
        }),
        result;
      if (response.ok) result = await response.json();
      else if ([404, 410, 416].includes(response.status)) {
        const check = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        if (check.ok) {
          const state = await check.json(),
            offset = Number(state.nextExpectedRanges?.[0]?.split("-")[0]);
          if (offset === end + 1) result = state;
          else
            throw invalid(
              "Microsoft requires a different upload position. Retry the file.",
              409,
            );
        } else if (check.status === 404 || check.status === 410)
          result = await S.graph(
            req.user.workspace_id,
            `/drives/${S.id(c.drive_id)}/items/${S.id(upload.parent_id)}:/${encodeURIComponent(upload.name)}`,
          );
        else throw invalid("Unable to resume this upload. Try again.", 502);
      } else
        throw invalid(
          "Microsoft could not accept this file chunk. Retry it.",
          502,
        );
      if (result.id && result.file) {
        if (
          (await S.connection(req.user.workspace_id)).generation !==
          upload.generation
        )
          throw invalid(
            "The SharePoint connection changed. Upload again.",
            409,
          );
        if (Number(result.size) !== total)
          throw invalid("The uploaded file size does not match.", 502);
        const file = await S.link(client, req.user, c, result, record);
        await client.query(
          "UPDATE sharepoint_uploads SET uploaded_bytes=total_bytes,completed_file_id=$1 WHERE id=$2",
          [file.id, upload.id],
        );
        await client.query("COMMIT");
        return res.json({ offset: total, done: true, file_id: file.id });
      }
      const offset = Number(result.nextExpectedRanges?.[0]?.split("-")[0]);
      if (!Number.isSafeInteger(offset) || offset !== end + 1)
        throw invalid("Microsoft did not confirm this chunk. Retry it.", 502);
      await client.query(
        "UPDATE sharepoint_uploads SET uploaded_bytes=$1 WHERE id=$2",
        [offset, upload.id],
      );
      await client.query("COMMIT");
      res.json({ offset, done: false });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },
);
module.exports = router;
