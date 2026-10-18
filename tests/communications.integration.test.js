const test = require("node:test"),
  assert = require("node:assert/strict");
test(
  "Communications privacy, delta idempotency, RFQ SLA and cloud folders are scoped",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const { Pool } = require("pg"),
      jwt = require("jsonwebtoken"),
      express = require("express"),
      admin = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        ssl: false,
      }),
      schema = "comm_" + process.pid + "_" + Date.now();
    await admin.query("CREATE SCHEMA " + schema);
    const u = new URL(process.env.TEST_DATABASE_URL);
    u.searchParams.set("options", "-c search_path=" + schema);
    Object.assign(process.env, {
      DATABASE_URL: u.toString(),
      PGSSL: "false",
      JWT_SECRET: "communications-fixture",
      APP_URL: "http://localhost:4000",
    });
    const C = require("../server/services/communications"),
      db = require("../server/db"),
      S = require("../server/services/sharepoint"),
      F = require("../server/services/cloudFiles"),
      I = require("../server/services/invoiceProvider");
    let server;
    const oldGraph = C.graph,
      oldCloud = F.google,
      oldReq = C.request,
      oldInvoice = I.api;
    try {
      await db.init();
    await db.query("ALTER TABLE users ALTER COLUMN mfa_enabled SET DEFAULT true");
      assert.throws(() => C.graphURL("https://evil.example/v1.0/me/messages"));
      assert.throws(() => C.graphURL("/v1.0/users/another/messages"));
      assert.equal(
        C.message({ from: { emailAddress: { address: "A@EXAMPLE.TEST" } } })
          .sender_email,
        "a@example.test",
      );
      await require("../server/migrations/communications")(db.pool);
      const ws = (
          await db.query(
            "INSERT INTO workspaces(name,invite_code,is_comped) VALUES('Alpha','comm-alpha',true),('Beta','comm-beta',true) RETURNING id",
          )
        ).rows.map((x) => x.id),
        users = [];
      for (const [wid, name, role] of [
        [ws[0], "Owner", "admin"],
        [ws[0], "Editor", "member"],
        [ws[0], "Viewer", "viewer"],
        [ws[1], "Other", "admin"],
      ])
        users.push(
          (
            await db.query(
              "INSERT INTO users(workspace_id,name,email,password_hash,role) VALUES($1,$2,$3,'x',$4) RETURNING *",
              [wid, name, name + "@example.test", role],
            )
          ).rows[0],
        );
      await db.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
        users[0].id,
        ws[0],
      ]);
      await db.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
        users[3].id,
        ws[1],
      ]);
      const ct = (
          await db.query(
            "INSERT INTO contacts(workspace_id,full_name,email) VALUES($1,'Known contact','known@example.test') RETURNING id",
            [ws[0]],
          )
        ).rows[0],
        co = (
          await db.query(
            "INSERT INTO companies(workspace_id,name) VALUES($1,'Buyer') RETURNING id",
            [ws[0]],
          )
        ).rows[0];
      await db.query("UPDATE contacts SET company_id=$1 WHERE id=$2", [
        co.id,
        ct.id,
      ]);
      const pipeline = await require("../server/services/pipelines").ensure(
          db,
          ws[0],
        ),
        conn = (
          await db.query(
            "INSERT INTO communication_connections(workspace_id,user_id,provider,credentials,account_name) VALUES($1,$2,'microsoft_mail',$3,'Owner mailbox') RETURNING *",
            [ws[0], users[0].id, S.encrypt("cache")],
          )
        ).rows[0];
      const app = express();
      app.use(express.json({ limit: "30mb" }));
      app.use(
        "/api/communications",
        require("../server/routes/communications"),
      );
      app.use((e, req, res, next) =>
        res.status(e.status || 500).json({ error: e.message }),
      );
      server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      const base =
        "http://127.0.0.1:" + server.address().port + "/api/communications";
      async function req(path, method = "GET", body, who = 0, scope = "team") {
        const response = await fetch(base + path, {
          method,
          headers: {
            Authorization:
              "Bearer " +
              jwt.sign(
                { sms_verified: true, id: users[who].id, workspace_id: users[who].workspace_id },
                process.env.JWT_SECRET,
              ),
            "Content-Type": "application/json",
            "X-Klyo-Scope": scope,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      }
      assert.equal((await req("/status")).status, 200);
      assert.equal(
        (await req("/status")).body.connections[0].credentials,
        undefined,
      );
      assert.equal(
        (await req("/status", "GET", undefined, 1)).body.connections.length,
        0,
      );
      assert.equal(
        (await req("/mail/" + conn.id + "/sync", "POST", {}, 1)).status,
        404,
      );
      assert.equal((await req("/connect/dropbox", "POST", {}, 1)).status, 403);
      assert.equal((await req("/rfq/rules", "POST", {}, 1)).status, 403);
      assert.equal(
        (await req("/apollo", "PUT", { api_key: "test" }, 2)).status,
        403,
      );
      const unknown = await C.ingest(conn, {
        id: "private",
        subject: "Private inquiry",
        from: { emailAddress: { address: "unknown@example.test" } },
        body: { content: "Private text" },
        receivedDateTime: new Date().toISOString(),
      });
      assert.equal(
        (await req("/mail/" + unknown, "GET", undefined, 1)).status,
        404,
      );
      assert.equal(
        (await req("/mail", "GET", undefined, 1)).body.messages.length,
        0,
      );
      const known = await C.ingest(conn, {
        id: "known",
        subject: "Known inquiry",
        from: { emailAddress: { address: "known@example.test" } },
        body: { content: "Known text" },
        receivedDateTime: new Date().toISOString(),
      });
      assert.equal(
        (await req("/mail/" + known, "GET", undefined, 1)).status,
        200,
      );
      assert.equal(
        (
          await req(
            "/history?entity=company&entity_id=" + co.id,
            "GET",
            undefined,
            1,
          )
        ).body.messages.length,
        1,
      );
      assert.equal(
        (await req("/mail/" + known, "GET", undefined, 3)).status,
        404,
      );
      assert.equal(
        (await req("/mail/" + known, "GET", undefined, 0, "personal")).status,
        404,
      );
      assert.equal(
        (
          await req(
            "/mail/" + known + "/link",
            "POST",
            { entity: "contact", entity_id: ct.id },
            2,
          )
        ).status,
        403,
      );
      C.graph = async (c, path) => {
        if (path.includes("mailFolders")) return { id: "RFQ-folder" };
        throw new Error("Unexpected provider request " + path);
      };
      const ruleR = await req("/rfq/rules", "POST", {
        connection_id: conn.id,
        name: "Inbound RFQ",
        folder_id: "RFQ-folder",
        assigned_to: users[1].id,
        pipeline_id: pipeline.id,
        sla_minutes: 120,
        subject_contains: "RFQ",
      });
      assert.equal(ruleR.status, 201, JSON.stringify(ruleR.body));
      const rule = ruleR.body.rule,
        inbound = {
          id: "new-rfq",
          subject: "RFQ sensors",
          from: { emailAddress: { address: "known@example.test" } },
          body: { content: "Need sensors" },
          receivedDateTime: new Date(Date.now() + 1000).toISOString(),
        };
      await C.ingest(conn, inbound, rule);
      await C.ingest(conn, inbound, rule);
      const rfqs = (await req("/rfq")).body.requests;
      assert.equal(rfqs.length, 1);
      assert.equal(rfqs[0].assigned_to, users[1].id);
      assert.equal(
        new Date(rfqs[0].due_at) - new Date(inbound.receivedDateTime),
        120 * 60000,
      );
      assert.ok(rfqs[0].deal_id && rfqs[0].task_id);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM deals WHERE workspace_id=$1",
            [ws[0]],
          )
        ).rows[0].n,
        1,
      );
      await C.ingest(
        conn,
        { ...inbound, id: "old-rfq", receivedDateTime: "2020-01-01T00:00:00Z" },
        rule,
      );
      assert.equal((await req("/rfq")).body.requests.length, 1);
      assert.equal(
        (await req("/rfq/" + rfqs[0].id, "PATCH", { status: "responded" }, 1))
          .status,
        200,
      );
      assert.ok((await req("/rfq")).body.requests[0].responded_at);
      const cloud = (
        await db.query(
          "INSERT INTO communication_connections(workspace_id,user_id,provider,credentials,root_id,root_name) VALUES($1,$2,'google_drive',$3,'crm-root','CRM') RETURNING *",
          [ws[0], users[0].id, S.encrypt("cache")],
        )
      ).rows[0];
      F.google = async (c, path) => {
        if (path.startsWith("files/inside"))
          return {
            id: "inside",
            name: "Sensor.pdf",
            mimeType: "application/pdf",
            size: 20,
            parents: ["crm-root"],
          };
        if (path.startsWith("files/crm-root"))
          return {
            id: "crm-root",
            name: "CRM",
            mimeType: F.folderMime,
            parents: [],
          };
        if (path.startsWith("files/outside"))
          return {
            id: "outside",
            name: "Private",
            mimeType: "application/pdf",
            parents: [],
          };
        throw new Error(path);
      };
      assert.equal(
        (
          await req(
            "/cloud/" + cloud.id + "/link",
            "POST",
            { item_id: "inside", entity: "company", entity_id: co.id },
            1,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await req(
            "/cloud/" + cloud.id + "/link",
            "POST",
            { item_id: "outside" },
            1,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/cloud/" + cloud.id + "/link",
            "POST",
            { item_id: "inside" },
            2,
          )
        ).status,
        403,
      );
      assert.equal(
        (await req("/cloud/files", "GET", undefined, 3)).body.files.length,
        0,
      );
      assert.equal((await req("/cloud/files")).body.files.length, 1);
      assert.equal(
        (await req("/cloud/" + cloud.id + "/children", "GET", undefined, 3))
          .status,
        404,
      );
      assert.equal(
        (await req("/apollo", "PUT", { api_key: "apollo-secret" })).status,
        200,
      );
      assert.equal((await req("/status")).body.apollo_connected, true);
      assert.equal(
        (
          await req(
            "/apollo/import",
            "POST",
            { ids: ["abc"], confirm_credits: false },
            1,
          )
        ).status,
        400,
      );
      let calls = 0;
      C.request = async (url, opts) => {
        calls++;
        assert.equal(new URL(url).hostname, "api.apollo.io");
        return {
          json: async () => ({
            matches: [
              {
                id: "abc",
                name: "Apollo Buyer",
                email: "apollo@example.test",
                organization: { name: "Apollo Co" },
              },
            ],
          }),
        };
      };
      assert.equal(
        (
          await req(
            "/apollo/import",
            "POST",
            { ids: ["abc"], confirm_credits: true },
            1,
          )
        ).body.imported,
        1,
      );
      assert.equal(
        (
          await req(
            "/apollo/import",
            "POST",
            { ids: ["abc"], confirm_credits: true },
            1,
          )
        ).body.imported,
        0,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM contacts WHERE email='apollo@example.test'",
          )
        ).rows[0].n,
        1,
      );
      assert.equal(calls, 1);
      assert.equal(
        (await req("/tracking?carrier=evil&number=123456")).status,
        400,
      );
      assert.match(
        (await req("/tracking?carrier=ups&number=123456")).body.url,
        /^https:\/\/www.ups.com\//,
      );
      C.graph = async (c, path) => ({
        value: [],
        "@odata.deltaLink": "https://evil.example/delta",
      });
      await assert.rejects(C.sync(conn), { status: 502 });
      assert.equal(
        (
          await req("/invoice-provider", "PUT", {
            subdomain: "evil.example",
            api_token: "secret",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await req("/invoice-provider", "PUT", {
            subdomain: "fixture-account",
            api_token: "invoice-secret",
          })
        ).status,
        200,
      );
      const order = (
        await db.query(
          "INSERT INTO sales_orders(workspace_id,number,title,kind,currency,items,total,subtotal,company_id) VALUES($1,'ORDER-1','Sensor order','customer','USD',$2,200,200,$3) RETURNING id",
          [
            ws[0],
            JSON.stringify([{ name: "Sensor", quantity: 2, unit_price: 100 }]),
            co.id,
          ],
        )
      ).rows[0];
      const invoiceInput = {
        tax_rate: 23,
        issue_date: "2026-10-17",
        payment_to: "2026-10-30",
        buyer_name: "Buyer",
        confirm_issue: true,
      };
      const invoicePreview = (
        await req(
          "/invoice-provider/orders/" + order.id + "/preview",
          "POST",
          invoiceInput,
        )
      ).body;
      assert.equal(
        invoicePreview.invoice.positions[0].total_price_net,
        "200.00",
      );
      invoiceInput.preview_token = invoicePreview.preview_token;
      assert.equal(
        (
          await req(
            "/invoice-provider/orders/" + order.id + "/issue",
            "POST",
            invoiceInput,
            1,
          )
        ).status,
        403,
      );
      let invoiceCalls = 0,
        invoicePaid = 123;
      I.api = async (conn, path, body) => {
        invoiceCalls++;
        if (body) {
          assert.equal(conn.subdomain, "fixture-account");
          assert.equal(body.invoice.oid, "klyo-" + ws[0] + "-" + order.id);
          return { id: 44, number: "FV-1", currency: "USD", price_net: 200 };
        }
        return {
          id: 44,
          number: "FV-1",
          currency: "USD",
          price_net: 200,
          price_gross: 246,
          paid: invoicePaid,
          status: invoicePaid === 246 ? "paid" : "partial",
        };
      };

      const lines = I.allocate(
        [
          { name: "A", quantity: 2, unit_price: 100, discount_percent: 10 },
          { name: "B", quantity: 3, unit_price: 10 },
        ],
        100.01,
        23,
      );
      assert.equal(lines[0].quantity, 2);
      assert.equal(lines[1].quantity, 3);
      assert.equal(
        lines.reduce(
          (sum, x) => sum + Math.round(Number(x.total_price_net) * 100),
          0,
        ),
        10001,
      );
      assert.equal(lines[0].total_price_net, "85.72");
      assert.equal(lines[1].total_price_net, "14.29");
      assert.equal(
        I.allocate(
          [{ description: "A", quantity: 3, unit_price: 1 }],
          0.01,
          0,
        )[0].total_price_net,
        "0.01",
      );
      assert.throws(
        () =>
          I.allocate(
            [{ description: "Zero", quantity: 1, unit_price: 0 }],
            1,
            0,
          ),
        { status: 400 },
      );
      await db.query("UPDATE sales_orders SET total=201 WHERE id=$1", [
        order.id,
      ]);
      assert.equal(
        (
          await req(
            "/invoice-provider/orders/" + order.id + "/issue",
            "POST",
            invoiceInput,
          )
        ).status,
        409,
      );
      assert.equal(invoiceCalls, 0);
      await db.query("UPDATE sales_orders SET total=200 WHERE id=$1", [
        order.id,
      ]);
      const commercialCase = (
        await db.query(
          "INSERT INTO commercial_cases(workspace_id,number,title,value,currency) VALUES($1,'CASE-INVOICE','Invoice case',200,'USD') RETURNING id",
          [ws[0]],
        )
      ).rows[0];
      await db.query("UPDATE sales_orders SET case_id=$1 WHERE id=$2", [
        commercialCase.id,
        order.id,
      ]);
      assert.equal(
        (
          await req(
            "/invoice-provider/orders/" + order.id + "/issue",
            "POST",
            invoiceInput,
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await req(
            "/invoice-provider/orders/" + order.id + "/issue",
            "POST",
            invoiceInput,
          )
        ).status,
        409,
      );
      assert.equal(invoiceCalls, 1);
      assert.equal(
        (
          await req(
            "/invoice-provider/orders/" + order.id + "/sync",
            "POST",
            {},
          )
        ).body.order_paid_net,
        100,
      );
      invoicePaid = 246;
      assert.equal(
        (
          await req(
            "/invoice-provider/orders/" + order.id + "/sync",
            "POST",
            {},
          )
        ).body.order_paid_net,
        200,
      );
      assert.ok(
        (
          await db.query("SELECT paid_at FROM sales_orders WHERE id=$1", [
            order.id,
          ])
        ).rows[0].paid_at,
      );
      assert.equal(
        (
          await db.query(
            "SELECT s.paid FROM commercial_cases c JOIN commercial_statuses s ON s.id=c.status_id WHERE c.id=$1",
            [commercialCase.id],
          )
        ).rows[0].paid,
        true,
      );
      await req("/invoice-provider", "PUT", {
        subdomain: "different-account",
        api_token: "new-secret",
      });
      assert.equal(
        (
          await req(
            "/invoice-provider/orders/" + order.id + "/sync",
            "POST",
            {},
          )
        ).status,
        409,
      );
    } finally {
      C.graph = oldGraph;
      F.google = oldCloud;
      C.request = oldReq;
      I.api = oldInvoice;
      if (server) await new Promise((r) => server.close(r));
      await db.pool.end();
      await admin.query("DROP SCHEMA " + schema + " CASCADE");
      await admin.end();
    }
  },
);
