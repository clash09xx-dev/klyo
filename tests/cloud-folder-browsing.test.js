const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
function service() {
  const module = { exports: {} };
  const invalid = (message, status = 400) =>
    Object.assign(new Error(message), { status });
  const deps = {
    "./sharepoint": {
      encrypt: (s) => Buffer.from(s).toString("base64"),
      decrypt: (s) => Buffer.from(s, "base64").toString(),
    },
    "../db": {},
    "./communications": {},
    "./dealWorkspace": { invalid, text: (v) => v },
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../server/services/cloudFiles.js"),
      "utf8",
    ),
    {
      module,
      require: (n) => {
        assert.ok(deps[n], n);
        return deps[n];
      },
      Buffer,
      URL,
      URLSearchParams,
    },
  );
  return module.exports;
}
for (const provider of ["dropbox", "google_drive"])
  test(
    provider +
      " lists a selected folder, pages results and rejects outside folders",
    async () => {
      const f = service(),
        conn = { id: 1, provider, root_id: "root-id" },
        calls = [];
      f.metadata = async (c, id) =>
        provider === "dropbox"
          ? {
              id,
              ".tag": "folder",
              path_lower: id === "outside" ? "/private" : "/crm",
            }
          : {
              id,
              mimeType: f.folderMime,
              parents: id === "outside" ? [] : undefined,
            };
      const file =
        provider === "dropbox"
          ? { id: "file-1", name: "Offer.pdf", ".tag": "file", size: 32 }
          : {
              id: "file-1",
              name: "Offer.pdf",
              mimeType: "application/pdf",
              size: "32",
            };
      const stub = async (c, route, data) => {
        calls.push({ route, data });
        return provider === "dropbox"
          ? {
              entries: [file],
              has_more: calls.length === 1,
              cursor: "next-page",
            }
          : {
              files: [file],
              nextPageToken: calls.length === 1 ? "next-page" : undefined,
            };
      };
      f[provider === "dropbox" ? "dropbox" : "google"] = stub;
      const first = await f.list(conn);
      assert.equal(first.items[0].name, "Offer.pdf");
      assert.equal(first.items[0].size, 32);
      assert.ok(first.cursor);
      const second = await f.list(conn, conn.root_id, first.cursor);
      assert.equal(second.items.length, 1);
      assert.equal(second.cursor, null);
      if (provider === "dropbox") {
        assert.equal(calls[0].route, "/files/list_folder");
        assert.equal(calls[0].data.path, "root-id");
        assert.equal(calls[1].route, "/files/list_folder/continue");
        assert.equal(calls[1].data.cursor, "next-page");
      } else {
        assert.match(calls[0].route, /^files\?/);
        assert.match(calls[1].route, /pageToken=next-page/);
      }
      await assert.rejects(
        () => f.list(conn, "outside"),
        /outside the connected CRM folder/,
      );
      assert.equal(calls.length, 2);
      await assert.rejects(
        () => f.list({ ...conn, id: 2 }, conn.root_id, first.cursor),
        /folder page expired/,
      );
    },
  );
