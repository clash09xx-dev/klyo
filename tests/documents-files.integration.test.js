const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  C = require("../public/js/quote-canvas-core"),
  Q = require("../public/js/quote-core"),
  P = require("../server/services/priceLists");
test("A4 templates validate bounded geometry and resolve automatic fields without HTML", () => {
  const canvas = C.starter();
  assert.equal(canvas.pages[0].elements.length, 9);
  for (const mutate of [
    (d) => (d.pages[0].elements[0].x = 209),
    (d) => (d.pages[0].elements[0].id = 'bad" onclick="'),
    (d) => (d.pages[0].elements[0].color = "red"),
    (d) => (d.pages[0].elements[0].field = "token"),
    (d) => d.pages[0].elements.push({ ...d.pages[0].elements[0] }),
  ]) {
    const d = structuredClone(canvas);
    mutate(d);
    assert.throws(() => C.normalize(d), { status: 400 });
  }
  assert.equal(
    C.resolve(
      { type: "text", text: "{{buyer.name}} / {{total}} / {{page_number}}" },
      { total: 12 },
      { buyer: { name: "A & B" } },
      (n) => "$" + n,
      2,
      3,
    ),
    "A & B / $12 / 2",
  );
  assert.throws(
    () =>
      Q.normalizeDocument({
        layout: "canvas",
        canvas: { pages: [{ elements: [] }] },
      }),
    { status: 400 },
  );
  assert.equal(
    Q.normalizeDocument({ layout: "canvas", canvas }).layout,
    "canvas",
  );
});
test("Price lists parse Polish and English prices and reject malformed amounts", () => {
  for (const [v, n] of [
    ["1 234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1.234,56", 1234.56],
    ["4,500", 4500],
    ["0", 0],
  ])
    assert.equal(P.price(v), n);
  for (const v of ["", -1, "1.2345", "2 USD", Infinity, "0x20", "1e3"])
    assert.throws(() => P.price(v), { status: 400 });
});
test("A4 PDF overflow repeats pricing geometry and rejects clipped text", async () => {
  const totals = Q.computeTotals(
      Array.from({ length: 24 }, (_, i) => ({
        description: "Sensor " + (i + 1) + " — calibration and installation",
        quantity: 2,
        unit_price: 1200,
      })),
      23,
      { type: "percent", value: 10 },
    ),
    quote = {
      id: 42,
      title: "Sensor supply and installation",
      currency: "USD",
      created_at: "2026-10-15",
      ...totals,
      discount_total: totals.discountTotal,
      document: Q.normalizeDocument({
        language: "en",
        layout: "canvas",
        canvas: C.starter(),
        seller: { name: "Northline Systems" },
        buyer: {
          name: "Eastfield Engineering",
          email: "procurement@example.test",
        },
        terms: "Payment within 14 days. Warranty: 5 years.",
        issued_on: "2026-10-15",
      }),
    };
  const pdf = await require("../server/services/quotePdf").generateQuotePdf(
    quote,
    totals.computed,
  );
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const out = path.join(__dirname, "../../qa-documents");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "a4-multipage.pdf"), pdf);
  const single = Q.computeTotals(totals.computed.slice(0, 3), 23, {
    type: "percent",
    value: 10,
  });
  fs.writeFileSync(
    path.join(out, "a4-example.pdf"),
    await require("../server/services/quotePdf").generateQuotePdf(
      { ...quote, ...single, discount_total: single.discountTotal },
      single.computed,
    ),
  );
  const bad = structuredClone(quote);
  bad.document.canvas.pages[0].elements.push({
    id: "tiny",
    type: "text",
    text: "Too much text ".repeat(100),
    x: 10,
    y: 10,
    w: 10,
    h: 2,
    font_size: 12,
    color: "#000000",
  });
  await assert.rejects(
    require("../server/services/quotePdf").generateQuotePdf(
      bad,
      totals.computed,
    ),
    { status: 400 },
  );
});
test(
  "Price lists, canvas templates and SharePoint preserve workspace and role boundaries",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { Pool } = require("pg"),
      express = require("express"),
      jwt = require("jsonwebtoken"),
      admin = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        ssl: false,
      }),
      schema = "klyo_docs_" + process.pid + "_" + Date.now();
    await admin.query("CREATE SCHEMA " + schema);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", "-c search_path=" + schema);
    Object.assign(process.env, {
      DATABASE_URL: url.toString(),
      PGSSL: "false",
      JWT_SECRET: "docs-tests-only",
    });
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    const db = require("../server/db"),
      S = require("../server/services/sharepoint");
    let server;
    const originalGraph = S.graph,
      originalFetch = global.fetch,
      originalAuthorize = S.authorize,
      originalExchange = S.exchange;
    try {
      await db.init();
    await db.query("ALTER TABLE users ALTER COLUMN mfa_enabled SET DEFAULT true");
      await db.init();
    await db.query("ALTER TABLE users ALTER COLUMN mfa_enabled SET DEFAULT true");
      const ids = [];
      for (const name of ["Alpha", "Beta"])
        ids.push(
          (
            await db.query(
              "INSERT INTO workspaces(name,invite_code,is_comped) VALUES($1,$1,true) RETURNING id",
              [name],
            )
          ).rows[0].id,
        );
      const users = [];
      for (const [wid, name, role] of [
        [ids[0], "Owner", "admin"],
        [ids[0], "Editor", "member"],
        [ids[0], "Viewer", "viewer"],
        [ids[1], "Other", "admin"],
      ])
        users.push(
          (
            await db.query(
              "INSERT INTO users(workspace_id,name,email,password_hash,role) VALUES($1,$2,$3,'fixture',$4) RETURNING *",
              [wid, name, name + "@example.test", role],
            )
          ).rows[0],
        );
      await db.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
        users[0].id,
        ids[0],
      ]);
      const tokens = users.map((u) =>
          jwt.sign(
            { sms_verified: true, id: u.id, workspace_id: u.workspace_id, role: u.role },
            process.env.JWT_SECRET,
          ),
        ),
        app = express();
      app.use(express.json({ limit: "5mb" }));
      for (const name of [
        "spaces",
        "products",
        "contacts",
        "quotes",
        "quote-templates",
        "price-lists",
        "sharepoint",
        "custom-fields",
      ])
        app.use("/api/" + name, require("../server/routes/" + name));
      server = await new Promise((r) => {
        const s = app.listen(0, "127.0.0.1", () => r(s));
      });
      const base = "http://127.0.0.1:" + server.address().port;
      async function req(
        route,
        method = "GET",
        body,
        user = 0,
        scope = "team",
        extra = {},
      ) {
        const r = await originalFetch(base + "/api" + route, {
          method,
          headers: {
            Authorization: "Bearer " + tokens[user],
            "Content-Type": Buffer.isBuffer(body)
              ? "application/octet-stream"
              : "application/json",
            "X-Klyo-Scope": scope,
            ...extra,
          },
          body:
            body === undefined
              ? undefined
              : Buffer.isBuffer(body)
                ? body
                : JSON.stringify(body),
          redirect: "manual",
        });
        const raw = Buffer.from(await r.arrayBuffer());
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
        return { status: r.status, data, headers: r.headers };
      }
      function check(r, status) {
        assert.equal(r.status, status, JSON.stringify(r.data));
        return r.data;
      }
      const rows = [
        { name: "Sensor", sku: "S-01", unit_price: "1 200,50" },
        { name: "Installation", sku: "I-01", unit_price: 300 },
      ];
      let list, product, contact;
      await t.test(
        "preview catches bad rows; imports are atomic and base prices are opt-in",
        async () => {
          const preview = check(
            await req("/price-lists/preview", "POST", {
              currency: "PLN",
              rows: [...rows, rows[0], null],
            }),
            200,
          );
          assert.equal(preview.valid, 2);
          assert.match(preview.rows[2].error, /more than once/);
          assert.match(preview.rows[3].error, /fields/);
          check(
            await req("/price-lists/import", "POST", {
              name: "Broken",
              currency: "PLN",
              rows: [rows[0], { name: "Bad", unit_price: -1 }],
            }),
            400,
          );
          assert.equal(
            (await db.query("SELECT count(*)::int n FROM products")).rows[0].n,
            0,
          );
          const result = check(
            await req("/price-lists/import", "POST", {
              name: "Supplier",
              currency: "PLN",
              rows,
            }),
            201,
          );
          list = result.list;
          product = check(await req("/products"), 200).products[0];
          check(
            await req("/price-lists/import", "POST", {
              list_id: list.id,
              name: "Supplier",
              currency: "PLN",
              rows: [{ ...rows[0], unit_price: 900 }],
            }),
            201,
          );
          assert.equal(
            Number(
              (
                await db.query(
                  "SELECT unit_price FROM products WHERE sku='S-01'",
                )
              ).rows[0].unit_price,
            ),
            1200.5,
          );
          check(
            await req("/price-lists/import", "POST", {
              list_id: list.id,
              name: "Supplier",
              currency: "PLN",
              rows: [{ ...rows[0], unit_price: 950 }],
              update_catalog: true,
            }),
            201,
          );
          assert.equal(
            Number(
              (
                await db.query(
                  "SELECT unit_price FROM products WHERE sku='S-01'",
                )
              ).rows[0].unit_price,
            ),
            950,
          );
          check(
            await req(
              "/price-lists/import",
              "POST",
              { name: "Reader", currency: "PLN", rows },
              2,
            ),
            403,
          );
          check(await req("/price-lists/" + list.id, "GET", undefined, 3), 404);
          assert.equal(
            check(
              await req("/price-lists", "GET", undefined, 0, "personal"),
              200,
            ).price_lists.length,
            0,
          );
          const dup = check(
            await req("/products/" + product.id + "/duplicate", "POST", {}),
            201,
          );
          assert.equal(dup.product.sku, "");
        },
      );
      await t.test(
        "quotes snapshot list prices, enforce scope/currency and persist freeform private templates",
        async () => {
          contact = check(
            await req("/contacts", "POST", { full_name: "Eastfield" }),
            201,
          ).contact;
          const doc = {
            language: "en",
            layout: "canvas",
            canvas: C.starter(),
            seller: { name: "Northline" },
            buyer: { name: "Eastfield" },
          };
          const content = {
            title: "Custom A4",
            currency: "PLN",
            document: doc,
            line_items: [
              { description: "Sensor", unit_price: 950, quantity: 1 },
            ],
          };
          const tpl = check(
            await req("/quote-templates", "POST", {
              name: "Exact layout",
              content,
            }),
            201,
          ).template;
          assert.deepEqual(tpl.content.document.canvas, C.starter());
          assert.equal(
            check(await req("/quote-templates", "GET", undefined, 1), 200)
              .templates.length,
            0,
          );
          const body = {
            ...content,
            contact_id: contact.id,
            price_list_id: list.id,
          };
          check(
            await req("/quotes", "POST", { ...body, currency: "USD" }),
            400,
          );
          check(
            await req("/quotes", "POST", { ...body, price_list_id: 999999 }),
            400,
          );
          const quote = check(await req("/quotes", "POST", body), 201).quote;
          check(
            await req("/price-lists/import", "POST", {
              list_id: list.id,
              name: "Supplier",
              currency: "PLN",
              rows: [{ ...rows[0], unit_price: 2000 }],
            }),
            201,
          );
          assert.equal(
            Number(check(await req("/quotes/" + quote.id), 200).quote.total),
            950,
          );
          const preview = await req(
            "/quote-templates/preview",
            "POST",
            content,
          );
          check(preview, 200);
          assert.equal(preview.data.subarray(0, 5).toString(), "%PDF-");
          check(
            await req(
              "/quote-templates/preview",
              "POST",
              {
                ...content,
                line_items: [
                  {
                    product_id: product.id,
                    description: "Foreign",
                    quantity: 1,
                    unit_price: 2,
                  },
                ],
              },
              3,
            ),
            400,
          );
          check(await req("/price-lists/" + list.id, "DELETE"), 200);
          assert.equal(
            check(await req("/quotes/" + quote.id), 200).quote.price_list_id,
            null,
          );
        },
      );
      await t.test(
        "Team-to-Personal copies remap price lists and preserve independent prices on repeat",
        async () => {
          const list2 = check(
            await req("/price-lists/import", "POST", {
              name: "Team catalogue",
              currency: "USD",
              rows: [{ name: "Sensor", sku: "S-01", unit_price: 100 }],
            }),
            201,
          ).list;
          check(
            await req(
              "/products",
              "POST",
              {
                name: "Private sensor",
                sku: "S-01",
                unit_price: 55,
                currency: "USD",
              },
              0,
              "personal",
            ),
            201,
          );
          const quote = check(
            await req("/quotes", "POST", {
              title: "Shared list quote",
              contact_id: contact.id,
              currency: "USD",
              price_list_id: list2.id,
              line_items: [
                { description: "Sensor", quantity: 1, unit_price: 100 },
              ],
            }),
            201,
          ).quote;
          check(
            await req(
              "/spaces/copy",
              "POST",
              { mode: "everything" },
              0,
              "personal",
            ),
            200,
          );
          const privateList = check(
            await req("/price-lists", "GET", undefined, 0, "personal"),
            200,
          ).price_lists.find((l) => l.name === "Team catalogue");
          assert(privateList);
          assert.notEqual(privateList.id, list2.id);
          const privatePrices = check(
            await req(
              "/price-lists/" + privateList.id,
              "GET",
              undefined,
              0,
              "personal",
            ),
            200,
          ).products;
          assert.equal(privatePrices.length, 1);
          assert.notEqual(privatePrices[0].workspace_id, ids[0]);
          const privateQuote = (
            await db.query(
              "SELECT q.* FROM quotes q JOIN space_copies c ON c.target_id=q.id AND c.entity='quote' WHERE c.source_id=$1",
              [quote.id],
            )
          ).rows[0];
          assert.equal(privateQuote.price_list_id, privateList.id);
          await db.query(
            "UPDATE price_list_items SET unit_price=321 WHERE price_list_id=$1",
            [privateList.id],
          );
          check(
            await req(
              "/spaces/copy",
              "POST",
              { mode: "everything" },
              0,
              "personal",
            ),
            200,
          );
          assert.equal(
            Number(
              (
                await db.query(
                  "SELECT unit_price FROM price_list_items WHERE price_list_id=$1",
                  [privateList.id],
                )
              ).rows[0].unit_price,
            ),
            321,
          );
        },
      );
      await t.test(
        "SharePoint starts unconfigured; credentials and outside folders are never exposed",
        async () => {
          assert.equal(
            check(await req("/sharepoint/status"), 200).configured,
            false,
          );
          check(await req("/sharepoint/connect", "POST", {}), 503);
          check(await req("/sharepoint/connect", "POST", {}, 1), 403);
          const enc = S.encrypt("sensitive-cache");
          assert(!enc.includes("sensitive"));
          assert.equal(S.decrypt(enc), "sensitive-cache");
          assert.throws(() => S.decrypt(enc.slice(0, -4) + "AAAA"));
          process.env.MICROSOFT_CLIENT_ID = "test";
          process.env.MICROSOFT_CLIENT_SECRET = "test";
          await db.query(
            "INSERT INTO sharepoint_connections(workspace_id,connected_by,account_id,account_name,token_cache,drive_id,root_id,root_name,generation) VALUES($1,$2,'account','owner@example.test',$3,'drive','root','CRM','g1')",
            [ids[0], users[0].id, enc],
          );
          const status = check(await req("/sharepoint/status"), 200);
          assert.equal(status.ready, true);
          assert(!JSON.stringify(status).includes(enc));
          assert.equal(
            check(await req("/sharepoint/status", "GET", undefined, 1), 200)
              .can_manage,
            false,
          );
          assert.equal(
            check(
              await req("/sharepoint/status", "GET", undefined, 0, "personal"),
              200,
            ).connected,
            false,
          );
          const nodes = {
            root: { id: "root", name: "CRM", folder: {} },
            inside: {
              id: "inside",
              name: "Manual.pdf",
              file: { mimeType: "application/pdf" },
              size: 12,
              parentReference: { driveId: "drive", id: "root" },
              webUrl: "https://company.sharepoint.com/Manual.pdf",
            },
            outside: {
              id: "outside",
              file: {},
              parentReference: { driveId: "drive", id: "other" },
            },
            other: { id: "other", folder: {} },
          };
          S.graph = async (wid, route) => {
            if (route.includes("createUploadSession"))
              return {
                uploadUrl: "https://company.sharepoint.com/upload-session",
                expirationDateTime: new Date(Date.now() + 600000).toISOString(),
              };
            const id = decodeURIComponent(
              route.split("/items/")[1]?.split("?")[0] || "root",
            );
            return (
              nodes[id] || {
                id: "new",
                name: "Upload.pdf",
                file: { mimeType: "application/pdf" },
                size: 12,
                parentReference: { id: "root" },
                webUrl: "https://company.sharepoint.com/upload.pdf",
              }
            );
          };
          check(
            await req("/sharepoint/link", "POST", { item_id: "outside" }),
            403,
          );
          check(
            await req("/sharepoint/link", "POST", {
              item_id: "inside",
              entity: "contact",
              entity_id: 999999,
            }),
            400,
          );
          check(
            await req("/sharepoint/link", "POST", { item_id: "inside" }, 2),
            403,
          );
          const file = check(
            await req(
              "/sharepoint/link",
              "POST",
              { item_id: "inside", entity: "contact", entity_id: contact.id },
              1,
            ),
            201,
          ).file;
          check(
            await req(
              "/sharepoint/files/" + file.id + "/open",
              "GET",
              undefined,
              3,
            ),
            404,
          );
          assert.equal(
            check(await req("/sharepoint/files/" + file.id + "/open"), 200).url,
            nodes.inside.webUrl,
          );
          assert.equal(
            check(
              await req(
                "/sharepoint/files?entity=contact&entity_id=" + contact.id,
              ),
              200,
            ).files.length,
            1,
          );
          check(
            await req("/sharepoint/files/" + file.id, "DELETE", undefined, 1),
            200,
          );
          assert(nodes.inside);
        },
      );
      await t.test(
        "upload chunks are scoped, encrypted and retried idempotently without forwarding bearer tokens",
        async () => {
          const session = check(
            await req(
              "/sharepoint/uploads",
              "POST",
              {
                name: "Quote.pdf",
                size: 12,
                entity: "contact",
                entity_id: contact.id,
              },
              1,
            ),
            201,
          );
          const stored = (
            await db.query(
              "SELECT upload_url FROM sharepoint_uploads WHERE id=$1",
              [session.id],
            )
          ).rows[0];
          assert(!stored.upload_url.includes("sharepoint.com"));
          check(
            await req(
              "/sharepoint/uploads/" + session.id,
              "PUT",
              Buffer.alloc(12),
              0,
              "team",
              { "Content-Range": "bytes 0-11/12" },
            ),
            404,
          );
          let puts = 0;
          global.fetch = async (url, options = {}) => {
            assert.equal(url, "https://company.sharepoint.com/upload-session");
            assert.equal(options.headers?.Authorization, undefined);
            puts++;
            return new Response(
              JSON.stringify({
                id: "new-file",
                name: "Quote.pdf",
                file: { mimeType: "application/pdf" },
                size: 12,
                parentReference: { id: "root" },
                webUrl: "https://company.sharepoint.com/Quote.pdf",
              }),
              { status: 201, headers: { "Content-Type": "application/json" } },
            );
          };
          const sent = check(
            await req(
              "/sharepoint/uploads/" + session.id,
              "PUT",
              Buffer.alloc(12),
              1,
              "team",
              { "Content-Range": "bytes 0-11/12" },
            ),
            200,
          );
          assert(sent.done);
          assert.equal(
            check(
              await req(
                "/sharepoint/uploads/" + session.id,
                "PUT",
                Buffer.alloc(12),
                1,
                "team",
                { "Content-Range": "bytes 0-11/12" },
              ),
              200,
            ).file_id,
            sent.file_id,
          );
          assert.equal(puts, 1);
          global.fetch = originalFetch;
        },
      );
      await t.test(
        "Owner selects the library and folder; price-list download stays inside it",
        async () => {
          let unsafe = false,
            cloudRequests = 0;
          S.graph = async (wid, route) => {
            if (route === "/sites/site")
              return { id: "site", displayName: "Company site" };
            if (route === "/sites/site/drives")
              return { value: [{ id: "drive", name: "Documents" }] };
            if (route === "/drives/drive/root")
              return { id: "chosen-root", name: "CRM", folder: {} };
            if (route.includes("/children"))
              return {
                value: [],
                "@odata.nextLink":
                  "https://graph.microsoft.com/v1.0/drives/drive/items/chosen-root/children?$skiptoken=next-page",
              };
            if (route.includes("/items/chosen-root"))
              return { id: "chosen-root", name: "CRM", folder: {} };
            return {
              id: "prices",
              name: "prices.csv",
              size: 30,
              file: { mimeType: "text/csv" },
              parentReference: { driveId: "drive", id: "chosen-root" },
              "@microsoft.graph.downloadUrl": unsafe
                ? "http://127.0.0.1/secret"
                : "https://company.sharepoint.com/download-prices",
            };
          };
          check(
            await req(
              "/sharepoint/folder",
              "PUT",
              { site_id: "site", drive_id: "drive", root_id: "root" },
              1,
            ),
            403,
          );
          check(
            await req("/sharepoint/folder", "PUT", {
              site_id: "site",
              drive_id: "unknown",
              root_id: "root",
            }),
            400,
          );
          check(
            await req("/sharepoint/folder", "PUT", {
              site_id: "site",
              drive_id: "drive",
              root_id: "root",
            }),
            200,
          );
          assert.equal(
            check(await req("/sharepoint/status"), 200).connection.root_id,
            "chosen-root",
          );
          assert.equal(
            check(await req("/sharepoint/children"), 200).cursor,
            "next-page",
          );
          global.fetch = async (url, options) => {
            cloudRequests++;
            assert.equal(url, "https://company.sharepoint.com/download-prices");
            assert.equal(options.headers?.Authorization, undefined);
            return new Response("name,price\nSensor,1200\n");
          };
          const content = check(
            await req("/sharepoint/content?item_id=prices"),
            200,
          );
          assert.match(content.toString(), /Sensor,1200/);
          unsafe = true;
          check(await req("/sharepoint/content?item_id=prices"), 502);
          assert.equal(cloudRequests, 1);
          global.fetch = originalFetch;
        },
      );
      await t.test(
        "OAuth requires one-use state, browser cookie and current owner membership",
        async () => {
          S.authorize = async (state) =>
            "https://login.microsoftonline.com/?state=" + state;
          S.exchange = async () => ({
            account: {
              homeAccountId: "new-account",
              username: "new@example.test",
            },
            cache: S.encrypt("new-cache"),
          });
          const start = await req("/sharepoint/connect", "POST", {});
          check(start, 200);
          const state = new URL(start.data.url).searchParams.get("state");
          let response = await originalFetch(
            base + "/api/sharepoint/callback?state=" + state + "&code=ok",
            { redirect: "manual" },
          );
          assert.match(response.headers.get("location"), /sharepoint=error/);
          response = await originalFetch(
            base + "/api/sharepoint/callback?state=" + state + "&code=ok",
            {
              headers: { Cookie: "klyo_sharepoint_connect=" + state },
              redirect: "manual",
            },
          );
          assert.match(
            response.headers.get("location"),
            /sharepoint=connected/,
          );
          response = await originalFetch(
            base + "/api/sharepoint/callback?state=" + state + "&code=ok",
            {
              headers: { Cookie: "klyo_sharepoint_connect=" + state },
              redirect: "manual",
            },
          );
          assert.match(response.headers.get("location"), /sharepoint=expired/);
          assert.equal(
            (
              await db.query(
                "SELECT account_id FROM sharepoint_connections WHERE workspace_id=$1",
                [ids[0]],
              )
            ).rows[0].account_id,
            "new-account",
          );
        },
      );
    } finally {
      global.fetch = originalFetch;
      S.graph = originalGraph;
      S.authorize = originalAuthorize;
      S.exchange = originalExchange;
      delete process.env.MICROSOFT_CLIENT_ID;
      delete process.env.MICROSOFT_CLIENT_SECRET;
      if (server) await new Promise((r) => server.close(r));
      await db.pool.end();
      await admin.query("DROP SCHEMA " + schema + " CASCADE");
      await admin.end();
    }
  },
);
