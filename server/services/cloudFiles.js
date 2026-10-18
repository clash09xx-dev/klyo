const S = require("./sharepoint"),
  db = require("../db"),
  C = require("./communications"),
  { invalid, text } = require("./dealWorkspace");
const fid = (v) => {
  if (typeof v !== "string" || v.length > 500 || /[\x00-\x1f]/.test(v) || !v)
    throw invalid("Invalid provider file.");
  return v;
};
async function google(conn, path, options = {}) {
  const url = new URL(path, "https://www.googleapis.com/drive/v3/");
  if (
    url.origin !== "https://www.googleapis.com" ||
    !/^\/(drive\/v3|upload\/drive\/v3)\//.test(url.pathname)
  )
    throw invalid("Invalid Drive route.");
  const r = await C.request(url.href, {
    ...options,
    headers: {
      Authorization: "Bearer " + (await C.token(conn)),
      ...options.headers,
    },
  });
  return options.raw ? r : r.json();
}
async function dropbox(conn, path, data = {}, options = {}) {
  if (!/^\/(files|users)\/[a-z_]+(?:\/[a-z_]+)?$/.test(path))
    throw invalid("Invalid Dropbox route.");
  const r = await C.request(
    "https://" +
      (options.content ? "content" : "api") +
      ".dropboxapi.com/2" +
      path,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + (await C.token(conn)),
        ...(options.content
          ? {
              "Dropbox-API-Arg": JSON.stringify(data),
              "Content-Type": "application/octet-stream",
            }
          : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      body: options.content ? options.body || undefined : JSON.stringify(data),
    },
  );
  return options.raw ? r : r.json();
}
const folderMime = "application/vnd.google-apps.folder";
function item(provider, x) {
  return provider === "google_drive"
    ? {
        id: x.id,
        name: x.name,
        size: Number(x.size || 0),
        folder: x.mimeType === folderMime,
        mime_type: x.mimeType,
        modified_at: x.modifiedTime,
      }
    : {
        id: x.id,
        name: x.name,
        size: Number(x.size || 0),
        folder: x[".tag"] === "folder",
        mime_type: "",
        modified_at: x.client_modified,
      };
}
async function metadata(conn, id) {
  fid(id);
  return conn.provider === "google_drive"
    ? module.exports.google(
        conn,
        "files/" +
          encodeURIComponent(id) +
          "?supportsAllDrives=true&fields=id,name,mimeType,size,parents,trashed,webViewLink",
      )
    : module.exports.dropbox(conn, "/files/get_metadata", { path: id });
}
async function within(conn, id) {
  let current = await module.exports.metadata(conn, id),
    first = current;
  for (let depth = 0; depth < 60; depth++) {
    if (conn.provider === "google_drive") {
      if (current.trashed) throw invalid("This file is in the trash.", 404);
      if (current.id === conn.root_id) return first;
      const parent = current.parents?.[0];
      if (!parent) break;
      current = await module.exports.metadata(conn, parent);
    } else {
      const root = conn.root_id;
      if (current.id === root) return first;
      const selected = await module.exports.metadata(conn, root);
      if (
        first.path_lower &&
        selected.path_lower &&
        (first.path_lower === selected.path_lower ||
          first.path_lower.startsWith(selected.path_lower + "/"))
      )
        return first;
      break;
    }
  }
  throw invalid("File is outside the connected CRM folder.", 403);
}
function seal(conn, folder, value, setup = false) {
  return value
    ? S.encrypt(
        JSON.stringify({
          conn: conn.id,
          root: conn.root_id,
          folder,
          setup,
          value,
          expires: Date.now() + 3600000,
        }),
      )
    : null;
}
function unseal(conn, folder, value, setup = false) {
  try {
    const c = JSON.parse(S.decrypt(value));
    if (
      c.conn !== conn.id ||
      c.root !== conn.root_id ||
      c.folder !== folder ||
      c.setup !== setup ||
      c.expires < Date.now() ||
      typeof c.value !== "string"
    )
      throw Error();
    return c.value;
  } catch {
    throw invalid("The folder page expired. Browse this folder again.");
  }
}
async function list(conn, folder, cursor) {
  if (!conn.root_id) throw invalid("Choose a CRM folder first.", 409);
  folder = folder || conn.root_id;
  if (cursor) cursor = unseal(conn, folder, cursor);
  const f = await module.exports.within(conn, folder);
  if (conn.provider === "google_drive") {
    if (f.mimeType !== folderMime) throw invalid("Choose a folder.");
    const q = new URLSearchParams({
      q:
        "'" +
        fid(folder).replace(/'/g, "\\'") +
        "' in parents and trashed=false",
      pageSize: "100",
      fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (cursor) q.set("pageToken", text(cursor, 5000, "cursor"));
    const r = await module.exports.google(conn, "files?" + q);
    return {
      items: (r.files || []).map((x) => item(conn.provider, x)),
      cursor: seal(conn, folder, r.nextPageToken),
    };
  }
  if (f[".tag"] !== "folder") throw invalid("Choose a folder.");
  const r = await module.exports.dropbox(
    conn,
    cursor ? "/files/list_folder/continue" : "/files/list_folder",
    cursor
      ? { cursor: text(cursor, 5000, "cursor") }
      : { path: f.id, limit: 100, include_deleted: false },
  );
  return {
    items: (r.entries || []).map((x) => item(conn.provider, x)),
    cursor: seal(conn, folder, r.has_more ? r.cursor : null),
  };
}
async function setupFolders(conn, folder = "root", cursor) {
  if (cursor) cursor = unseal(conn, folder, cursor, true);
  if (conn.provider === "google_drive") {
    const q = new URLSearchParams({
      q:
        (folder === "root"
          ? "'root'"
          : "'" + fid(folder).replace(/'/g, "\\'") + "'") +
        " in parents and mimeType='" +
        folderMime +
        "' and trashed=false",
      pageSize: "100",
      fields: "nextPageToken,files(id,name,mimeType)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (cursor) q.set("pageToken", text(cursor, 5000, "cursor"));
    const r = await module.exports.google(conn, "files?" + q);
    return {
      items: (r.files || []).map((x) => item(conn.provider, x)),
      cursor: seal(conn, folder, r.nextPageToken, true),
    };
  }
  const r = await module.exports.dropbox(
    conn,
    cursor ? "/files/list_folder/continue" : "/files/list_folder",
    cursor
      ? { cursor: text(cursor, 5000, "cursor") }
      : { path: folder === "root" ? "" : fid(folder), limit: 100 },
  );
  return {
    items: (r.entries || [])
      .filter((x) => x[".tag"] === "folder")
      .map((x) => item(conn.provider, x)),
    cursor: seal(conn, folder, r.has_more ? r.cursor : null, true),
  };
}
async function upload(conn, folder, name, body, mime) {
  const parent = await module.exports.within(conn, folder || conn.root_id);
  if (
    !Buffer.isBuffer(body) ||
    body.length < 1 ||
    body.length > 20 * 1024 * 1024
  )
    throw invalid("Choose a file up to 20 MB.");
  name = text(name, 180, "file name", true);
  if (/[\\/:*?"<>|\x00-\x1f]/.test(name) || /^\.+$/.test(name))
    throw invalid("Invalid file name.");
  if (conn.provider === "google_drive") {
    if (parent.mimeType !== folderMime) throw invalid("Choose a folder.");
    const boundary =
        "klyo_" + require("crypto").randomBytes(16).toString("hex"),
      metadata = JSON.stringify({ name, parents: [parent.id] });
    const payload = Buffer.concat([
      Buffer.from(
        "--" +
          boundary +
          "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
          metadata +
          "\r\n--" +
          boundary +
          "\r\nContent-Type: application/octet-stream\r\n\r\n",
      ),
      body,
      Buffer.from("\r\n--" + boundary + "--"),
    ]);
    return module.exports.google(
      conn,
      "/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,parents",
      {
        method: "POST",
        headers: { "Content-Type": "multipart/related; boundary=" + boundary },
        body: payload,
      },
    );
  }
  if (parent[".tag"] !== "folder") throw invalid("Choose a folder.");
  return module.exports.dropbox(
    conn,
    "/files/upload",
    {
      path: parent.path_display + "/" + name,
      mode: "add",
      autorename: true,
      mute: true,
    },
    { content: true, body },
  );
}
async function link(conn, user, x, record) {
  const m = item(conn.provider, x);
  if (m.folder) throw invalid("Choose a file.");
  return (
    await db.query(
      "INSERT INTO cloud_file_links(workspace_id,connection_id,provider_id,name,size,mime_type,entity,entity_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(connection_id,provider_id) DO UPDATE SET name=EXCLUDED.name,entity=COALESCE(EXCLUDED.entity,cloud_file_links.entity),entity_id=COALESCE(EXCLUDED.entity_id,cloud_file_links.entity_id) RETURNING *",
      [
        user.workspace_id,
        conn.id,
        m.id,
        m.name,
        m.size,
        m.mime_type,
        record.entity,
        record.entity_id,
        user.id,
      ],
    )
  ).rows[0];
}
async function download(conn, id) {
  await module.exports.within(conn, id);
  return conn.provider === "google_drive"
    ? module.exports.google(
        conn,
        "files/" + encodeURIComponent(id) + "?alt=media&supportsAllDrives=true",
        { raw: true },
      )
    : module.exports.dropbox(
        conn,
        "/files/download",
        { path: id },
        { content: true, raw: true },
      );
}
module.exports = {
  fid,
  google,
  dropbox,
  item,
  metadata,
  within,
  list,
  setupFolders,
  upload,
  link,
  download,
  folderMime,
};
