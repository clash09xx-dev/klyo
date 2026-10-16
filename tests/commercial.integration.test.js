const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  Q = require("../public/js/quote-core");
test("Bundle presentation preserves precise totals and keeps component prices private", async () => {
  const items = Q.computeTotals(
    [
      {
        description: "CPU",
        sku: "CPU-1",
        quantity: 1,
        unit_price: 200,
        bundle_id: "pc",
        bundle_name: "Workstation",
      },
      {
        description: "Memory",
        sku: "RAM",
        quantity: 2,
        unit_price: 50,
        discount_percent: 10,
        bundle_id: "pc",
        bundle_name: "Workstation",
      },
      { description: "Monitor", quantity: 1, unit_price: 100 },
    ],
    23,
    { type: "percent", value: 10 },
  );
  const display = Q.presentItems(items.computed, {});
  assert.equal(display.length, 2);
  assert.equal(display[0].line_total, 290);
  assert.match(display[0].description, /2 × RAM · Memory/);
  assert.equal(items.total, 431.73);
  assert.equal(
    Q.presentItems(items.computed, { pricing_mode: "total_only" })[0]
      .hide_prices,
    true,
  );
  const quote = {
    id: 1,
    title: "Workstation supply",
    currency: "USD",
    ...items,
    discount_total: items.discountTotal,
    document: Q.normalizeDocument({
      pricing_mode: "total_only",
      seller: { name: "Example Engineering" },
      buyer: { name: "Sample Client" },
      reference: "CASE-2026-1",
    }),
  };
  const pdf = await require("../server/services/quotePdf").generateQuotePdf(
    quote,
    items.computed,
  );
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  fs.mkdirSync(
    require("node:path").join(
      require("node:os").tmpdir(),
      "klyo-commercial-qa",
    ),
    { recursive: true },
  );
  fs.writeFileSync(
    require("node:path").join(
      require("node:os").tmpdir(),
      "klyo-commercial-qa/total-only.pdf",
    ),
    pdf,
  );
  const canvasQuote = {
    ...quote,
    document: Q.normalizeDocument({
      ...quote.document,
      layout: "canvas",
      canvas: require("../public/js/quote-canvas-core").starter(),
    }),
  };
  fs.writeFileSync(
    require("node:path").join(
      require("node:os").tmpdir(),
      "klyo-commercial-qa/canvas-total-only.pdf",
    ),
    await require("../server/services/quotePdf").generateQuotePdf(
      canvasQuote,
      items.computed,
    ),
  );
});
test(
  "Commercial register, private costs, company structures and quote links are scoped",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { Pool } = require("pg"),
      express = require("express"),
      jwt = require("jsonwebtoken"),
      admin = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        ssl: false,
      }),
      schema = "commercial_" + process.pid + "_" + Date.now();
    await admin.query("CREATE SCHEMA " + schema);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", "-c search_path=" + schema);
    Object.assign(process.env, {
      DATABASE_URL: url.toString(),
      PGSSL: "false",
      JWT_SECRET: "commercial-test-only",
    });
    const db = require("../server/db");
    let server;
    try {
      await db.init();
      await require("../server/migrations/commercial")(db.pool);
      await require("../server/migrations/commercial")(db.pool);
      const ws = [];
      for (const name of ["AlphaCommercial", "BetaCommercial"])
        ws.push(
          (
            await db.query(
              "INSERT INTO workspaces(name,invite_code,is_comped) VALUES($1,$1,true) RETURNING id",
              [name],
            )
          ).rows[0].id,
        );
      const users = [];
      for (const [wid, name, role] of [
        [ws[0], "Owner", "admin"],
        [ws[0], "Member", "member"],
        [ws[0], "Viewer", "viewer"],
        [ws[1], "Other", "admin"],
      ])
        users.push(
          (
            await db.query(
              "INSERT INTO users(workspace_id,name,email,password_hash,role)VALUES($1,$2,$3,'test',$4)RETURNING *",
              [wid, name, name + "@commercial.test", role],
            )
          ).rows[0],
        );
      await db.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
        users[0].id,
        ws[0],
      ]);
      const tokens = users.map((u) =>
          jwt.sign(
            { id: u.id, workspace_id: u.workspace_id, role: u.role },
            process.env.JWT_SECRET,
          ),
        ),
        app = express();
      app.use(express.json({ limit: "5mb" }));
      for (const n of [
        "commercial",
        "quotes",
        "products",
        "companies",
        "custom-fields",
        "spaces",
      ])
        app.use("/api/" + n, require("../server/routes/" + n));
      server = await new Promise((r) => {
        const s = app.listen(0, "127.0.0.1", () => r(s));
      });
      const base = "http://127.0.0.1:" + server.address().port;
      async function req(path, method = "GET", body, user = 0, scope = "team") {
        const r = await fetch(base + "/api" + path, {
            method,
            headers: {
              Authorization: "Bearer " + tokens[user],
              "Content-Type": "application/json",
              "X-Klyo-Scope": scope,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
          raw = Buffer.from(await r.arrayBuffer());
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
        return { status: r.status, data };
      }
      const ok = (r, status = 200) => {
        assert.equal(r.status, status, JSON.stringify(r.data));
        return r.data;
      };
      const company = ok(
          await req("/companies", "POST", { name: "Steel Works" }),
          201,
        ).company,
        foreign = ok(
          await req("/companies", "POST", { name: "Foreign" }, 3),
          201,
        ).company,
        contact = (
          await db.query(
            "INSERT INTO contacts(workspace_id,full_name,company_id,email)VALUES($1,'Purchasing Manager',$2,'buy@example.test')RETURNING *",
            [ws[0], company.id],
          )
        ).rows[0],
        product = ok(
          await req("/products", "POST", {
            name: "Sensor",
            sku: "S-01",
            unit_price: 100,
            currency: "PLN",
            serial_required: true,
          }),
          201,
        ).product;
      let unit, caseId, quoteId;
      await t.test(
        "company fields and nested departments validate cycles and tenant links",
        async () => {
          const field = ok(
            await req("/custom-fields", "POST", {
              entity: "company",
              name: "Plant capacity",
              type: "number",
              required: false,
            }),
            201,
          ).field;
          ok(
            await req(`/commercial/companies/${company.id}/details`, "PUT", {
              tax_id: "PL123",
              city: "Warszawa",
              custom_fields: { [field.field_key]: 200 },
            }),
          );
          unit = ok(
            await req("/commercial/units", "POST", {
              company_id: company.id,
              name: "Warszawa",
              kind: "branch",
            }),
            201,
          ).unit;
          const child = ok(
            await req("/commercial/units", "POST", {
              company_id: company.id,
              parent_id: unit.id,
              name: "Cold rolling mill",
              kind: "department",
            }),
            201,
          ).unit;
          assert.equal(
            (
              await req("/commercial/units/" + unit.id, "PUT", {
                parent_id: child.id,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await req("/commercial/units", "POST", {
                company_id: foreign.id,
                name: "Foreign",
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await req(
                `/commercial/companies/${company.id}/details`,
                "GET",
                undefined,
                3,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await req(
                `/commercial/companies/${company.id}/details`,
                "PUT",
                { tax_id: "x" },
                2,
              )
            ).status,
            403,
          );
        },
      );
      await t.test(
        "register first creates one deal and offer first creates a scoped case with unified numbering",
        async () => {
          const r = ok(
            await req("/commercial/cases", "POST", {
              title: "Sensor supply",
              contact_id: contact.id,
              company_id: company.id,
              company_unit_id: unit.id,
              value: 200,
              currency: "PLN",
            }),
            201,
          ).case;
          caseId = r.id;
          assert.ok(r.deal_id);
          assert.match(r.number, /^OF-/);
          const line_items = [
            {
              product_id: product.id,
              description: "Sensor",
              quantity: 2,
              unit_price: 100,
              sku: "S-01",
              bundle_id: "sensor-kit",
              bundle_name: "Measurement package",
            },
          ];
          const q = ok(
            await req("/quotes", "POST", {
              title: r.title,
              contact_id: contact.id,
              company_id: company.id,
              currency: "PLN",
              line_items,
              commercial_case_id: r.id,
              deal_id: r.deal_id,
              document: { pricing_mode: "total_only" },
            }),
            201,
          );
          quoteId = q.quote.id;
          assert.equal(q.quote.document.reference, r.number);
          assert.equal(q.quote.commercial_case_id, r.id);
          assert.equal(q.lineItems[0].bundle_name, "Measurement package");
          assert.equal(
            (
              await db.query(
                "SELECT count(*) FROM deals WHERE workspace_id=$1",
                [ws[0]],
              )
            ).rows[0].count,
            "1",
          );
          const again = ok(
            await req("/quotes/" + quoteId, "PUT", {
              title: r.title,
              contact_id: contact.id,
              company_id: company.id,
              currency: "PLN",
              line_items,
            }),
          );
          assert.equal(again.quote.commercial_case_id, r.id);
          assert.equal(
            (
              await db.query(
                "SELECT count(*) FROM commercial_cases WHERE workspace_id=$1",
                [ws[0]],
              )
            ).rows[0].count,
            "1",
          );
          assert.equal(
            (
              await req("/commercial/cases/" + r.id, "PUT", {
                company_id: foreign.id,
              })
            ).status,
            400,
          );
          const q2 = ok(
            await req("/quotes", "POST", {
              title: "Second quote",
              contact_id: contact.id,
              currency: "PLN",
              line_items,
            }),
            201,
          );
          assert.notEqual(q2.quote.commercial_case_id, r.id);
          assert.notEqual(q2.quote.document.reference, r.number);
        },
      );
      await t.test(
        "purchase price import is owner-only, atomic and never exposed in standard product or quote APIs",
        async () => {
          assert.equal(
            (
              await req(
                "/commercial/purchase-prices/import",
                "POST",
                { currency: "PLN", rows: [{ sku: "S-01", unit_cost: 40 }] },
                1,
              )
            ).status,
            403,
          );
          ok(
            await req("/commercial/purchase-prices/import", "POST", {
              currency: "PLN",
              rows: [{ sku: "S-01", unit_cost: "40,00", supplier: "Factory" }],
            }),
          );
          assert.equal(
            (
              await req("/commercial/purchase-prices/import", "POST", {
                currency: "PLN",
                rows: [
                  { sku: "S-01", unit_cost: 50 },
                  { sku: "unknown", unit_cost: 2 },
                ],
              })
            ).status,
            400,
          );
          assert.equal(
            ok(await req("/commercial/purchase-prices")).prices[0].unit_cost,
            "40.00",
          );
          const raw = ok(await req("/products", "GET", undefined, 1));
          assert.doesNotMatch(JSON.stringify(raw), /unit_cost|purchase_price/);
          assert.equal(
            (
              await req(
                `/commercial/quotes/${quoteId}/margins`,
                "GET",
                undefined,
                1,
              )
            ).status,
            403,
          );
          const full = ok(await req("/quotes/" + quoteId));
          ok(
            await req("/quotes/" + quoteId, "PUT", {
              ...full.quote,
              line_items: full.lineItems,
            }),
          );
          const m = ok(await req(`/commercial/quotes/${quoteId}/margins`));
          assert.equal(m.profit, 120);
          assert.equal(m.margin_percent, 60);
          assert.equal(m.markup_percent, 150);
          assert.equal(m.rows[0].unit_cost, 40);
          assert.doesNotMatch(
            JSON.stringify(
              ok(await req("/quotes/" + quoteId, "GET", undefined, 1)),
            ),
            /unit_cost|margin_factor/,
          );
        },
      );
      await t.test(
        "per-user margin factors recalculate percentages without leaking true costs",
        async () => {
          ok(
            await req("/commercial/permissions/" + users[1].id, "PUT", {
              can_view_margin: true,
              margin_factor: 0.5,
            }),
          );
          assert.doesNotMatch(
            JSON.stringify(
              ok(await req("/commercial/access", "GET", undefined, 1)),
            ),
            /margin_factor/,
          );
          const m = ok(
            await req(
              `/commercial/quotes/${quoteId}/margins`,
              "GET",
              undefined,
              1,
            ),
          );
          assert.equal(m.profit, 60);
          assert.equal(m.margin_percent, 30);
          assert.ok(Math.abs(m.markup_percent - 42.857142) < 0.001);
          assert.doesNotMatch(JSON.stringify(m), /unit_cost|margin_factor/);
          assert.equal(
            ok(await req(`/commercial/quotes/${quoteId}/margins`)).profit,
            120,
          );
          assert.equal(
            (
              await req("/commercial/permissions/" + users[3].id, "PUT", {
                can_view_margin: true,
                margin_factor: 1,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await req(
                `/commercial/quotes/${quoteId}/margins`,
                "GET",
                undefined,
                3,
              )
            ).status,
            404,
          );
        },
      );
      await t.test(
        "saved margin snapshots remain unchanged when purchase prices change; draft preview uses new costs",
        async () => {
          ok(
            await req("/commercial/purchase-prices/import", "POST", {
              currency: "PLN",
              rows: [{ sku: "S-01", unit_cost: 80 }],
            }),
          );
          assert.equal(
            ok(await req(`/commercial/quotes/${quoteId}/margins`)).profit,
            120,
          );
          const full = ok(await req("/quotes/" + quoteId));
          const preview = ok(
            await req("/commercial/margins/preview", "POST", {
              line_items: full.lineItems,
              currency: "PLN",
            }),
          );
          assert.equal(preview.profit, 40);
          ok(
            await req("/commercial/purchase-prices/import", "POST", {
              currency: "PLN",
              rows: [{ sku: "S-01", unit_cost: 40 }],
            }),
          );
        },
      );
      await t.test(
        "custom register statuses update the linked deal while preserving the saved offer amount",
        async () => {
          const statuses = ok(await req("/commercial/statuses")).statuses,
            paid = statuses.find((s) => s.paid);
          const r = ok(
              await req("/commercial/cases/" + caseId, "PUT", {
                status_id: paid.id,
              }),
            ).case,
            deal = (
              await db.query("SELECT * FROM deals WHERE id=$1", [r.deal_id])
            ).rows[0];
          assert.equal(deal.status, "won");
          assert.equal(
            ok(await req("/quotes/" + quoteId)).quote.total,
            "200.00",
          );
        },
      );
      await t.test(
        "branch clearing, immutable company membership and audited status configuration stay consistent",
        async () => {
          const other = ok(
            await req("/companies", "POST", { name: "Another plant" }),
            201,
          ).company;
          assert.equal(
            (
              await req("/commercial/units/" + unit.id, "PUT", {
                company_id: other.id,
              })
            ).status,
            400,
          );
          const cleared = ok(
            await req("/commercial/cases/" + caseId, "PUT", {
              company_unit_id: null,
            }),
          ).case;
          assert.equal(cleared.company_unit_id, null);
          const status = ok(
            await req("/commercial/statuses", "POST", {
              name: "Custom stage",
              color: "#abcdef",
              outcome: "open",
            }),
            201,
          ).status;
          const active = ok(
              await req("/commercial/cases", "POST", {
                title: "Active case",
                status_id: status.id,
                value: 10,
                currency: "PLN",
              }),
              201,
            ).case,
            removed = ok(
              await req("/commercial/cases", "POST", {
                title: "Trashed case",
                status_id: status.id,
                value: 10,
                currency: "PLN",
              }),
              201,
            ).case;
          await db.query("UPDATE deals SET deleted_at=now() WHERE id=$1", [
            removed.deal_id,
          ]);
          ok(
            await req("/commercial/statuses/" + status.id, "PUT", {
              name: "Custom stage",
              color: "#abcdef",
              outcome: "lost",
              paid: false,
            }),
          );
          assert.equal(
            (
              await db.query("SELECT status FROM deals WHERE id=$1", [
                active.deal_id,
              ])
            ).rows[0].status,
            "lost",
          );
          assert.equal(
            (
              await db.query("SELECT status FROM deals WHERE id=$1", [
                removed.deal_id,
              ])
            ).rows[0].status,
            "open",
          );
          const event = (
            await db.query(
              "SELECT * FROM deal_events WHERE deal_id=$1 AND to_status='lost'",
              [active.deal_id],
            )
          ).rows[0];
          assert.match(event.reason, /Custom stage/);
          assert.equal(
            (
              await req("/commercial/cases/" + removed.id, "PUT", {
                title: "Cannot change deleted deal",
              })
            ).status,
            404,
          );
        },
      );
      await t.test(
        "serial-required products are checked at order confirmation, with scoped products and unique serials",
        async () => {
          const S = require("../server/services/commercial");
          await assert.rejects(
            S.validateOrderSerials(db, ws[0], [
              { product_id: product.id, quantity: 2, serial_numbers: ["A"] },
            ]),
            { status: 400 },
          );
          await assert.rejects(
            S.validateOrderSerials(db, ws[0], [
              {
                product_id: product.id,
                quantity: 2,
                serial_numbers: ["A", "a"],
              },
            ]),
            { status: 400 },
          );
          await S.validateOrderSerials(db, ws[0], [
            {
              product_id: product.id,
              quantity: 2,
              serial_numbers: ["SN-A", "SN-B"],
            },
          ]);
          await assert.rejects(
            S.validateOrderSerials(db, ws[1], [
              { product_id: product.id, quantity: 1, serial_numbers: ["SN-A"] },
            ]),
            { status: 400 },
          );
        },
      );
      await t.test(
        "copy-all maps new domain relationships, preserves Personal edits and never discloses Team costs to members",
        async () => {
          const project = (
            await db.query(
              "INSERT INTO projects(workspace_id,title,deal_id,company_id,contact_id) SELECT $1,'Delivery',deal_id,$2,$3 FROM commercial_cases WHERE id=$4 RETURNING *",
              [ws[0], company.id, contact.id, caseId],
            )
          ).rows[0];
          const parent = (
            await db.query(
              "INSERT INTO tasks(workspace_id,title,project_id,contact_id,company_id,created_by)VALUES($1,'Parent milestone',$2,$3,$4,$5)RETURNING *",
              [ws[0], project.id, contact.id, company.id, users[0].id],
            )
          ).rows[0];
          const child = (
            await db.query(
              "INSERT INTO tasks(workspace_id,title,project_id,parent_id,created_by)VALUES($1,'Child milestone',$2,$3,$4)RETURNING *",
              [ws[0], project.id, parent.id, users[0].id],
            )
          ).rows[0];
          const equipment = (
            await db.query(
              "INSERT INTO equipment(workspace_id,name,serial_number,assigned_to,created_by)VALUES($1,'VA5','EQ-01',$2,$2)RETURNING *",
              [ws[0], users[0].id],
            )
          ).rows[0];
          await db.query(
            "INSERT INTO equipment_assignments(workspace_id,equipment_id,project_id,assigned_to,starts_at,ends_at,status)VALUES($1,$2,$3,$4,now(),now()+interval '1 day','checked_out')",
            [ws[0], equipment.id, project.id, users[0].id],
          );
          await db.query(
            "INSERT INTO sales_orders(workspace_id,project_id,case_id,quote_id,company_id,contact_id,number,title,items,total,paid_amount,paid_at,status,created_by)VALUES($1,$2,$3,$4,$5,$6,'ORD-COPY','Customer delivery',$7,200,200,now(),'completed',$8)",
            [
              ws[0],
              project.id,
              caseId,
              quoteId,
              company.id,
              contact.id,
              JSON.stringify([
                {
                  product_id: product.id,
                  description: "Sensor",
                  quantity: 2,
                  unit_price: 100,
                  serial_numbers: ["A", "B"],
                },
              ]),
              users[0].id,
            ],
          );
          const result = ok(
            await req(
              "/spaces/copy",
              "POST",
              { mode: "everything" },
              1,
              "personal",
            ),
          );
          assert.ok(result.created > 0);
          const wid = (
            await db.query(
              "SELECT id FROM workspaces WHERE owner_user_id=$1 AND space_type='personal'",
              [users[1].id],
            )
          ).rows[0].id;
          const copied = (
            await db.query(
              "SELECT * FROM quotes WHERE workspace_id=$1 AND commercial_case_id IS NOT NULL ORDER BY id LIMIT 1",
              [wid],
            )
          ).rows[0];
          assert.ok(copied);
          assert.notEqual(
            copied.deal_id,
            (
              await db.query("SELECT deal_id FROM quotes WHERE id=$1", [
                quoteId,
              ])
            ).rows[0].deal_id,
          );
          const copiedCase = (
            await db.query(
              "SELECT * FROM commercial_cases WHERE id=$1 AND workspace_id=$2",
              [copied.commercial_case_id, wid],
            )
          ).rows[0];
          assert.equal(copiedCase.quote_id, copied.id);
          assert.equal(copied.document.reference, copiedCase.number);
          const copiedCompany = (
            await db.query("SELECT * FROM companies WHERE workspace_id=$1", [
              wid,
            ])
          ).rows.find((c) => c.name === "Steel Works");
          assert.ok(copiedCompany);
          const copiedUnits = (
            await db.query(
              "SELECT * FROM company_units WHERE workspace_id=$1",
              [wid],
            )
          ).rows;
          assert.ok(
            copiedUnits.every((u) => u.company_id === copiedCompany.id),
          );
          assert.ok(copiedUnits.find((u) => u.parent_id));
          const cp = (
              await db.query(
                "SELECT * FROM projects WHERE workspace_id=$1 AND title='Delivery'",
                [wid],
              )
            ).rows[0],
            tasks = (
              await db.query("SELECT * FROM tasks WHERE workspace_id=$1", [wid])
            ).rows;
          const pc = tasks.find((t) => t.title === "Parent milestone"),
            cc = tasks.find((t) => t.title === "Child milestone");
          assert.equal(cc.parent_id, pc.id);
          assert.equal(cc.project_id, cp.id);
          const order = (
            await db.query(
              "SELECT * FROM sales_orders WHERE workspace_id=$1 AND title='Customer delivery'",
              [wid],
            )
          ).rows[0];
          assert.equal(order.status, "draft");
          assert.equal(order.paid_at, null);
          assert.equal(order.paid_amount, "0.00");
          assert.equal(order.project_id, cp.id);
          assert.equal(order.items[0].serial_numbers.length, 0);
          assert.notEqual(order.items[0].product_id, product.id);
          assert.equal(
            Number(
              (
                await db.query(
                  "SELECT count(*) FROM equipment_assignments WHERE workspace_id=$1",
                  [wid],
                )
              ).rows[0].count,
            ),
            0,
          );
          assert.equal(
            (
              await db.query(
                "SELECT assigned_to FROM equipment WHERE workspace_id=$1",
                [wid],
              )
            ).rows[0].assigned_to,
            null,
          );
          assert.equal(
            Number(
              (
                await db.query(
                  "SELECT count(*) FROM product_purchase_prices WHERE workspace_id=$1",
                  [wid],
                )
              ).rows[0].count,
            ),
            0,
          );
          assert.equal(
            Number(
              (
                await db.query(
                  "SELECT count(*) FROM quote_item_costs WHERE workspace_id=$1",
                  [wid],
                )
              ).rows[0].count,
            ),
            0,
          );
          await db.query(
            "UPDATE tasks SET title='Private changed milestone',parent_id=NULL WHERE id=$1",
            [cc.id],
          );
          await db.query(
            "UPDATE sales_orders SET notes='Private order notes' WHERE id=$1",
            [order.id],
          );
          const second = ok(
            await req(
              "/spaces/copy",
              "POST",
              { mode: "everything" },
              1,
              "personal",
            ),
          );
          assert.equal(second.created, 0);
          assert.equal(
            (
              await db.query("SELECT title,parent_id FROM tasks WHERE id=$1", [
                cc.id,
              ])
            ).rows[0].title,
            "Private changed milestone",
          );
          assert.equal(
            (await db.query("SELECT parent_id FROM tasks WHERE id=$1", [cc.id]))
              .rows[0].parent_id,
            null,
          );
          assert.equal(
            (
              await db.query("SELECT notes FROM sales_orders WHERE id=$1", [
                order.id,
              ])
            ).rows[0].notes,
            "Private order notes",
          );
        },
      );
      await t.test(
        "legacy offers gain one case and deal atomically without changing issued PDFs, including duplicate references",
        async () => {
          const initial = Number(
              (
                await db.query(
                  "SELECT count(*) FROM deals WHERE workspace_id=$1",
                  [ws[0]],
                )
              ).rows[0].count,
            ),
            ids = [];
          for (let i = 0; i < 2; i++)
            ids.push(
              (
                await db.query(
                  "INSERT INTO quotes(workspace_id,contact_id,title,currency,total,status,document)VALUES($1,$2,'Legacy accepted offer','PLN',120,'accepted',$3)RETURNING id",
                  [
                    ws[0],
                    contact.id,
                    JSON.stringify({
                      version: 1,
                      reference: "LEGACY-SAME",
                      language: "en",
                    }),
                  ],
                )
              ).rows[0].id,
            );
          await require("../server/migrations/commercial")(db.pool);
          const offers = (
            await db.query("SELECT * FROM quotes WHERE id=ANY($1::int[])", [
              ids,
            ])
          ).rows;
          assert.ok(
            offers.every(
              (q) =>
                q.commercial_case_id &&
                q.deal_id &&
                q.document.reference === "LEGACY-SAME",
            ),
          );
          const cases = (
            await db.query(
              "SELECT * FROM commercial_cases WHERE quote_id=ANY($1::int[])",
              [ids],
            )
          ).rows;
          assert.equal(new Set(cases.map((c) => c.number)).size, 2);
          const deals = (
            await db.query("SELECT * FROM deals WHERE id=ANY($1::int[])", [
              offers.map((q) => q.deal_id),
            ])
          ).rows;
          assert.ok(deals.every((d) => d.status === "won"));
          await require("../server/migrations/commercial")(db.pool);
          assert.equal(
            Number(
              (
                await db.query(
                  "SELECT count(*) FROM deals WHERE workspace_id=$1",
                  [ws[0]],
                )
              ).rows[0].count,
            ),
            initial + 2,
          );
        },
      );
      await t.test(
        "quote-derived register and deal amounts consistently exclude VAT",
        async () => {
          const saved = ok(
            await req("/quotes", "POST", {
              title: "VAT example",
              contact_id: contact.id,
              company_id: company.id,
              currency: "PLN",
              tax_rate: 23,
              line_items: [
                { description: "Service", quantity: 1, unit_price: 100 },
              ],
            }),
            201,
          ).quote;
          assert.equal(saved.total, "123.00");
          assert.equal(saved.tax_total, "23.00");
          assert.equal(
            (
              await db.query("SELECT value FROM commercial_cases WHERE id=$1", [
                saved.commercial_case_id,
              ])
            ).rows[0].value,
            "100.00",
          );
          assert.equal(
            (
              await db.query("SELECT value FROM deals WHERE id=$1", [
                saved.deal_id,
              ])
            ).rows[0].value,
            "100.00",
          );
        },
      );
      await t.test(
        "Personal register and purchase costs are isolated from Team",
        async () => {
          const r = ok(
            await req("/commercial/cases", "GET", undefined, 0, "personal"),
          );
          assert.equal(r.cases.length, 0);
          assert.equal(
            ok(
              await req(
                "/commercial/purchase-prices",
                "GET",
                undefined,
                0,
                "personal",
              ),
            ).prices.length,
            0,
          );
          assert.equal(
            (
              await req(
                "/commercial/cases/" + caseId,
                "PUT",
                { title: "steal" },
                0,
                "personal",
              )
            ).status,
            404,
          );
        },
      );
    } finally {
      if (server) await new Promise((r) => server.close(r));
      await db.pool.end();
      await admin.query("DROP SCHEMA " + schema + " CASCADE");
      await admin.end();
    }
  },
);
