const test = require("node:test"),
  assert = require("node:assert/strict"),
  Q = require("../public/js/quote-core");
test("quote-level discounts use integer cents after line discounts and before tax", () => {
  const items = [
    {
      description: "Sensor",
      quantity: 2,
      unit_price: 100,
      discount_percent: 10,
    },
  ];
  const percent = Q.computeTotals(items, 23, { type: "percent", value: 10 });
  assert.equal(percent.subtotal, 200);
  assert.equal(percent.line_discount_total, 20);
  assert.equal(percent.quote_discount_total, 18);
  assert.equal(percent.discountTotal, 38);
  assert.equal(percent.tax_total, 37.26);
  assert.equal(percent.total, 199.26);
  const fixed = Q.computeTotals(items, 23, { type: "fixed", value: 25 });
  assert.equal(fixed.total, 190.65);
  assert.throws(
    () => Q.computeTotals(items, 0, { type: "fixed", value: 181 }),
    /cannot exceed/,
  );
  assert.throws(
    () => Q.computeTotals(items, 0, { type: "percent", value: 101 }),
    /discount/,
  );
  assert.equal(
    Q.computeTotals([{ unit_price: 0.05, quantity: 1 }], 0, {
      type: "percent",
      value: 10,
    }).quote_discount_total,
    0.01,
  );
});
test(
  "custom CRM isolation, fields, templates, warranty schedules and team control",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { Pool } = require("pg"),
      express = require("express"),
      jwt = require("jsonwebtoken"),
      schema = `klyo_custom_${process.pid}_${Date.now()}`,
      admin = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        ssl: false,
      });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.PGSSL = "false";
    process.env.JWT_SECRET = "custom-tests-only";
    const mailer = require.resolve("../server/services/mailer");
    let sent = 0;
    require.cache[mailer] = {
      id: mailer,
      filename: mailer,
      loaded: true,
      exports: { sendOfferEmail: async () => sent++ },
    };
    const db = require("../server/db");
    let server;
    try {
      await db.init();
    await db.query("ALTER TABLE users ALTER COLUMN mfa_enabled SET DEFAULT true");
      await db.init();
    await db.query("ALTER TABLE users ALTER COLUMN mfa_enabled SET DEFAULT true");
      const a = (
          await db.query(
            "INSERT INTO workspaces(name,invite_code,is_comped,default_currency) VALUES('Shared team','TEAM-A',true,'PLN') RETURNING id",
          )
        ).rows[0].id,
        b = (
          await db.query(
            "INSERT INTO workspaces(name,invite_code,is_comped) VALUES('Other team','TEAM-B',true) RETURNING id",
          )
        ).rows[0].id;
      const users = [];
      for (const [wid, name, role] of [
        [a, "Owner", "admin"],
        [a, "Colleague", "member"],
        [b, "Foreign", "admin"],
        [a, "Manager", "admin"],
        [a, "Reader", "viewer"],
      ])
        users.push(
          (
            await db.query(
              "INSERT INTO users(workspace_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING *",
              [
                wid,
                name,
                name.toLowerCase() + "@example.test",
                "fixture",
                role,
              ],
            )
          ).rows[0],
        );
      await db.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
        users[0].id,
        a,
      ]);
      const app = express();
      app.use(express.json({ limit: "2mb" }));
      for (const name of [
        "auth",
        "spaces",
        "contacts",
        "companies",
        "products",
        "deals",
        "pipelines",
        "sales",
        "quotes",
        "quote-templates",
        "custom-fields",
        "warranty",
        "tasks",
        "calendar",
        "history",
        "team-stats",
        "billing",
        "offers",
        "reminders",
        "platform",
      ])
        app.use("/api/" + name, require("../server/routes/" + name));
      server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      const tokens = users.map((u) =>
        jwt.sign(
          { sms_verified: true,
            id: u.id,
            workspace_id: u.workspace_id,
            name: u.name,
            role: u.role,
          },
          process.env.JWT_SECRET,
        ),
      );
      async function req(path, method = "GET", body, options = {}) {
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}/api${path}`,
          {
            method,
            headers: {
              "Content-Type": "application/json",
              Authorization:
                "Bearer " + (options.token || tokens[options.user || 0]),
              "X-Klyo-Scope": options.scope || "team",
              "X-Klyo-Timezone": options.zone || "UTC",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          },
        );
        const raw = await response.arrayBuffer();
        let data;
        if (response.headers.get("Content-Type")?.includes("application/pdf"))
          data = Buffer.from(raw);
        else {
          try {
            data = JSON.parse(Buffer.from(raw).toString());
          } catch {
            data = Buffer.from(raw).toString();
          }
        }
        return { status: response.status, data };
      }
      const check = (r, status) =>
        assert.equal(r.status, status, JSON.stringify(r.data));
      let teamContact,
        teamProduct,
        privateProduct,
        privateContact,
        contactField,
        productField,
        template,
        warranty,
        privateId;
      await t.test(
        "each user has exactly one private space; data and raw IDs cannot cross modes",
        async () => {
          const spaces = (await req("/spaces")).data;
          privateId = spaces.personal.id;
          assert.equal(spaces.team.id, a);
          assert.equal(spaces.is_team_owner, true);
          assert.equal((await req("/spaces")).data.personal.id, privateId);
          assert.notEqual(
            (await req("/spaces", "GET", undefined, { user: 1 })).data.personal
              .id,
            privateId,
          );
          teamContact = (
            await req("/contacts", "POST", { full_name: "Shared client" })
          ).data.contact;
          privateContact = (
            await req(
              "/contacts",
              "POST",
              { full_name: "Secret client" },
              { scope: "personal" },
            )
          ).data.contact;
          assert.equal((await req("/contacts")).data.contacts.length, 1);
          assert.equal(
            (await req("/contacts", "GET", undefined, { scope: "personal" }))
              .data.contacts.length,
            1,
          );
          check(await req("/contacts/" + privateContact.id), 404);
          check(
            await req("/contacts/" + privateContact.id, "GET", undefined, {
              user: 1,
              scope: "personal",
            }),
            404,
          );
          check(
            await req(
              "/contacts/" + privateContact.id,
              "PUT",
              { full_name: "Break in" },
              { user: 3 },
            ),
            404,
          );
          check(
            await req("/contacts/" + privateContact.id, "DELETE", undefined, {
              user: 1,
            }),
            404,
          );
          check(
            await req("/spaces", "GET", undefined, {
              scope: String(privateId),
            }),
            400,
          );
          const me = (
            await req("/auth/me", "GET", undefined, {
              user: 1,
              scope: "personal",
            })
          ).data.user;
          assert.equal(me.role, "admin");
          assert.equal(me.is_team_owner, false);
          assert.equal(me.is_platform_admin, false);
          assert.equal(
            (
              await req("/auth/team", "GET", undefined, {
                user: 1,
                scope: "personal",
              })
            ).data.team.length,
            1,
          );
          check(
            await req(
              "/auth/preferences",
              "PUT",
              require("../public/js/preferences-core").defaults(),
              { user: 1, scope: "personal" },
            ),
            200,
          );
        },
      );
      await t.test(
        "custom fields validate types, choices, requirements and workspace ownership",
        async () => {
          contactField = (
            await req("/custom-fields", "POST", {
              entity: "contact",
              name: "Sensor model",
              type: "select",
              options: ["A1", "B2"],
              required: true,
            })
          ).data.field;
          productField = (
            await req("/custom-fields", "POST", {
              entity: "product",
              name: "Rated power W",
              type: "number",
            })
          ).data.field;
          check(
            await req("/contacts", "POST", {
              full_name: "Missing required field",
            }),
            400,
          );
          check(
            await req("/contacts/" + teamContact.id, "PUT", {
              full_name: "Shared client",
              custom_fields: { [contactField.field_key]: "A1" },
            }),
            200,
          );
          check(
            await req("/contacts/" + teamContact.id, "PUT", {
              full_name: "Shared client",
              custom_fields: { [contactField.field_key]: "Unknown" },
            }),
            400,
          );
          check(
            await req("/custom-fields/" + contactField.id, "PUT", {
              entity: "contact",
              name: "Model",
              type: "number",
            }),
            400,
          );
          check(
            await req("/custom-fields/" + contactField.id, "PUT", {
              entity: "contact",
              name: "Model",
              type: "select",
              options: ["B2"],
              required: true,
            }),
            400,
          );
          check(
            await req(
              "/custom-fields/" + contactField.id,
              "DELETE",
              undefined,
              { user: 2 },
            ),
            404,
          );
          check(
            await req(
              "/custom-fields",
              "POST",
              { entity: "contact", name: "Blocked", type: "text" },
              { user: 4 },
            ),
            403,
          );
          teamProduct = (
            await req("/products", "POST", {
              name: "Team sensor",
              unit_price: 200,
              warranty_months: 60,
              service_interval_months: 12,
              custom_fields: { [productField.field_key]: 250 },
            })
          ).data.product;
          assert.equal(teamProduct.warranty_months, 60);
          assert.equal(teamProduct.custom_fields[productField.field_key], 250);
          check(
            await req("/products/" + teamProduct.id, "PUT", {
              custom_fields: { [productField.field_key]: "lots" },
            }),
            400,
          );
          privateProduct = (
            await req(
              "/products",
              "POST",
              { name: "Private sensor", unit_price: 100 },
              { scope: "personal" },
            )
          ).data.product;
          check(
            await req("/deals", "POST", {
              title: "Wrong linked item",
              product_id: privateProduct.id,
            }),
            400,
          );
          check(
            await req("/tasks", "POST", {
              title: "Wrong linked client",
              contact_id: privateContact.id,
            }),
            400,
          );
          check(
            await req("/calendar", "POST", {
              title: "Wrong linked client",
              contact_id: privateContact.id,
              start_at: "2026-11-01T10:00:00Z",
            }),
            400,
          );
          check(
            await req(
              "/custom-fields",
              "POST",
              { entity: "product", name: "Private product data", type: "text" },
              { scope: "personal" },
            ),
            201,
          );
        },
      );
      await t.test(
        "users own editable template libraries, client details are stripped and real PDF honours custom layout",
        async () => {
          const content = {
            title: "Sensor proposal",
            currency: "PLN",
            document: {
              language: "pl",
              sections: ["terms", "items", "scope"],
              headings: {
                items: "Twoja własna wycena",
                terms: "Zasady współpracy",
              },
              body_size: 11,
              seller: { name: "Brand Łódź" },
              buyer: { name: "Must not be saved" },
              reference: "OLD",
              issued_on: "2026-01-01",
              terms: "Custom terms",
              scope: "Custom scope",
            },
            line_items: [
              {
                product_id: teamProduct.id,
                description: "Sensor",
                quantity: 2,
                unit_price: 200,
                discount_percent: 10,
              },
            ],
            tax_rate: 23,
            discount_type: "fixed",
            discount_value: 20,
          };
          const r = await req("/quote-templates", "POST", {
            name: "My sensor template",
            content,
          });
          check(r, 201);
          template = r.data.template;
          assert.equal(template.content.document.buyer.name, "");
          assert.equal(template.content.document.reference, "");
          assert.equal(template.content.document.issued_on, "");
          assert.equal(
            (await req("/quote-templates", "GET", undefined, { user: 1 })).data
              .templates.length,
            0,
          );
          check(
            await req(
              "/quote-templates/" + template.id,
              "PUT",
              { name: "Hijack", content },
              { user: 1 },
            ),
            404,
          );
          check(
            await req("/quote-templates/" + template.id, "PUT", {
              name: "Updated template",
              content,
            }),
            200,
          );
          const quote = await req("/quotes", "POST", {
            ...content,
            contact_id: teamContact.id,
          });
          check(quote, 201);
          assert.equal(quote.data.quote.total, "418.20");
          assert.equal(quote.data.quote.discount_total, "60.00");
          assert.equal(quote.data.quote.quote_discount_total, "20.00");
          const pdf = await req("/quotes/" + quote.data.quote.id + "/pdf");
          check(pdf, 200);
          assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
          assert.ok(pdf.data.length > 10000);
          check(
            await req(
              "/quotes/" + quote.data.quote.id + "/pdf",
              "GET",
              undefined,
              { scope: "personal" },
            ),
            404,
          );
        },
      );
      await t.test(
        "copy selected products into Personal and preserve independent edits on repeated copy",
        async () => {
          const before = (
            await req("/products", "GET", undefined, { scope: "personal" })
          ).data.products.length;
          check(
            await req(
              "/spaces/copy",
              "POST",
              { mode: "products", ids: [teamProduct.id] },
              { scope: "personal" },
            ),
            200,
          );
          let list = (
            await req("/products", "GET", undefined, { scope: "personal" })
          ).data.products;
          assert.equal(list.length, before + 1);
          let copied = list.find((p) => p.name === "Team sensor");
          assert.notEqual(copied.id, teamProduct.id);
          assert.equal(copied.warranty_months, 60);
          assert.equal(copied.custom_fields[productField.field_key], 250);
          check(
            await req(
              "/products/" + copied.id,
              "PUT",
              { name: "Personal edit", unit_price: 999 },
              { scope: "personal" },
            ),
            200,
          );
          const repeated = await req(
            "/spaces/copy",
            "POST",
            { mode: "products", ids: [teamProduct.id] },
            { scope: "personal" },
          );
          check(repeated, 200);
          assert.ok(repeated.data.skipped > 0);
          assert.equal(
            (
              await req("/products/" + copied.id, "GET", undefined, {
                scope: "personal",
              })
            ).status,
            404,
          ); // Products are listed, no detail endpoint.
          list = (
            await req("/products", "GET", undefined, { scope: "personal" })
          ).data.products;
          assert.equal(list.length, before + 1);
          assert.equal(
            list.find((p) => p.id === copied.id).name,
            "Personal edit",
          );
          assert.equal(
            (await req("/products")).data.products.find(
              (p) => p.id === teamProduct.id,
            ).unit_price,
            "200.00",
          );
          check(
            await req(
              "/spaces/copy",
              "POST",
              { mode: "products", ids: [privateProduct.id] },
              { scope: "personal" },
            ),
            400,
          );
          check(await req("/spaces/copy", "POST", { mode: "products" }), 400);
        },
      );
      await t.test(
        "warranty registration, date clamping, due notifications, review history and isolation",
        async () => {
          const W = require("../server/services/warranty"),
            today = W.today();
          assert.equal(W.addMonths("2024-01-31", 1), "2024-02-29");
          assert.equal(W.addMonths("2024-02-29", 12), "2025-02-28");
          const yearAgo = W.addMonths(today, -12),
            r = await req("/warranty", "POST", {
              contact_id: teamContact.id,
              product_id: teamProduct.id,
              serial_number: "SN-001",
              purchased_on: yearAgo,
              warranty_months: 60,
              review_interval_months: 12,
              next_review_on: today,
              color: "#e79324",
            });
          check(r, 201);
          warranty = r.data.item;
          const notifications = (await req("/warranty/notifications")).data;
          assert.equal(notifications.count, 1);
          assert.equal(notifications.items[0].contact_name, "Shared client");
          assert.equal(notifications.items[0].product_name, "Team sensor");
          assert.equal(
            (
              await req("/warranty/notifications", "GET", undefined, {
                scope: "personal",
              })
            ).data.count,
            0,
          );
          assert.equal(
            (
              await req("/warranty/notifications", "GET", undefined, {
                user: 2,
              })
            ).data.count,
            0,
          );
          check(
            await req("/warranty/" + warranty.id, "PUT", {
              notes: "Edited once",
            }),
            200,
          );
          check(
            await req("/warranty/" + warranty.id + "/review", "POST", {
              performed_on: today,
              next_review_on: W.addMonths(today, 12),
              notes: "Calibration completed",
            }),
            200,
          );
          assert.equal((await req("/warranty/notifications")).data.count, 0);
          assert.equal(
            (await req("/warranty/" + warranty.id + "/reviews")).data.reviews[0]
              .notes,
            "Calibration completed",
          );
          check(
            await req(
              "/warranty/" + warranty.id + "/review",
              "POST",
              { performed_on: today },
              { user: 4 },
            ),
            403,
          );
          check(
            await req(
              "/warranty/" + warranty.id + "/reviews",
              "GET",
              undefined,
              { scope: "personal" },
            ),
            404,
          );
          check(
            await req("/warranty", "POST", {
              contact_id: teamContact.id,
              product_id: teamProduct.id,
              purchased_on: today,
              warranty_months: 60,
              next_review_on: W.addMonths(today, 61),
            }),
            400,
          );
          check(
            await req("/warranty/notifications", "GET", undefined, {
              zone: "Europe/Warsaw",
            }),
            200,
          );
        },
      );
      await t.test(
        "only the team owner controls invitations, roles, audit and team statistics",
        async () => {
          assert.equal(
            (await req("/auth/workspace", "GET", undefined, { user: 3 })).data
              .workspace.invite_code,
            undefined,
          );
          check(
            await req(
              "/auth/workspace/regenerate-invite",
              "POST",
              {},
              { user: 3 },
            ),
            403,
          );
          check(
            await req(
              "/auth/team/" + users[1].id + "/role",
              "PUT",
              { role: "admin" },
              { user: 3 },
            ),
            403,
          );
          check(await req("/spaces/audit", "GET", undefined, { user: 3 }), 403);
          check(await req("/team-stats", "GET", undefined, { user: 3 }), 403);
          check(
            await req("/auth/team/" + users[1].id + "/role", "PUT", {
              role: "viewer",
            }),
            200,
          );
          // The old member token must immediately lose its previous write privileges.
          check(
            await req(
              "/products",
              "POST",
              { name: "Stale role attempt" },
              { user: 1 },
            ),
            403,
          );
          check(
            await req("/auth/team/" + users[1].id + "/role", "PUT", {
              role: "member",
            }),
            200,
          );
          check(await req("/spaces/audit"), 200);
          check(await req("/team-stats"), 200);
          check(
            await req("/spaces/audit", "GET", undefined, { scope: "personal" }),
            403,
          );
        },
      );
      await t.test(
        "copy everything preserves relationships, private templates, quote drafts and does not send",
        async () => {
          const pipeline = (await req("/pipelines")).data.pipelines[0],
            stages = (await req("/deals/stages?pipeline_id=" + pipeline.id))
              .data.stages;
          check(
            await req("/deals", "POST", {
              title: "Copy this deal",
              contact_id: teamContact.id,
              product_id: teamProduct.id,
              pipeline_id: pipeline.id,
              stage_id: stages[0].id,
            }),
            201,
          );
          check(
            await req(
              "/spaces/copy",
              "POST",
              { mode: "everything" },
              { scope: "personal" },
            ),
            200,
          );
          const contacts = (
              await req("/contacts", "GET", undefined, { scope: "personal" })
            ).data.contacts,
            copied = contacts.find((c) => c.full_name === "Shared client");
          assert.ok(copied);
          assert.notEqual(copied.id, teamContact.id);
          assert.equal(copied.custom_fields[contactField.field_key], "A1");
          const sourceWarranty = (await req("/warranty")).data.items[0];
          const privateWarranty = (
            await req("/warranty", "GET", undefined, { scope: "personal" })
          ).data.items[0];
          assert.equal(
            privateWarranty.purchased_on,
            sourceWarranty.purchased_on,
          );
          assert.equal(
            privateWarranty.warranty_until,
            sourceWarranty.warranty_until,
          );
          assert.equal(
            privateWarranty.next_review_on,
            sourceWarranty.next_review_on,
          );
          const deals = (
            await req("/deals?status=all", "GET", undefined, {
              scope: "personal",
            })
          ).data.deals;
          assert.ok(
            deals.some(
              (d) => d.title === "Copy this deal" && d.contact_id === copied.id,
            ),
          );
          const quotes = (
            await req("/quotes", "GET", undefined, { scope: "personal" })
          ).data.quotes;
          assert.equal(quotes.length, 1);
          assert.equal(quotes[0].status, "draft");
          assert.equal(quotes[0].contact_id, copied.id);
          assert.equal(
            (await req("/warranty", "GET", undefined, { scope: "personal" }))
              .data.items.length,
            1,
          );
          assert.equal(
            (
              await req("/quote-templates", "GET", undefined, {
                scope: "personal",
              })
            ).data.templates.length,
            1,
          );
          const once = quotes[0].id;
          check(
            await req(
              "/spaces/copy",
              "POST",
              { mode: "everything" },
              { scope: "personal" },
            ),
            200,
          );
          assert.equal(
            (await req("/quotes", "GET", undefined, { scope: "personal" })).data
              .quotes[0].id,
            once,
          );
          assert.equal(sent, 0);
          const info = (
            await req("/spaces", "GET", undefined, { scope: "personal" })
          ).data;
          const p = (
            await db.query(
              "SELECT smtp_pass,gmail_refresh_token,stripe_customer_id FROM workspaces WHERE id=$1",
              [info.personal.id],
            )
          ).rows[0];
          assert.deepEqual(p, {
            smtp_pass: null,
            gmail_refresh_token: null,
            stripe_customer_id: null,
          });
        },
      );
      await t.test('Platform remains exclusive to its configured account and excludes linked Personal spaces from customer counts',async()=>{
 const old=process.env.PLATFORM_ADMIN_EMAIL;process.env.PLATFORM_ADMIN_EMAIL='owner@example.test';
 try{
  check(await req('/platform/overview','GET',undefined,{user:3}),403);
  const overviewResponse=await req('/platform/overview');check(overviewResponse,200);const overview=overviewResponse.data;
  assert.equal(overview.workspaces.total,2);
  const spacesResponse=await req('/platform/workspaces');check(spacesResponse,200);const workspaces=spacesResponse.data.workspaces;
  assert.equal(workspaces.length,2);
  check(await req('/platform/page-views'),200);
 }finally{if(old===undefined)delete process.env.PLATFORM_ADMIN_EMAIL;else process.env.PLATFORM_ADMIN_EMAIL=old;}
 });
 await t.test(
        "removing a teammate preserves private records and revokes old shared tokens",
        async () => {
          const mine = (
            await req(
              "/contacts",
              "POST",
              { full_name: "Colleague private" },
              { user: 1, scope: "personal" },
            )
          ).data.contact;
          check(await req("/auth/team/" + users[1].id, "DELETE"), 200);
          check(await req("/contacts", "GET", undefined, { user: 1 }), 401);
          const user = (
            await db.query("SELECT * FROM users WHERE id=$1", [users[1].id])
          ).rows[0];
          assert.ok(user);
          assert.notEqual(user.workspace_id, a);
          assert.equal(
            (
              await db.query("SELECT full_name FROM contacts WHERE id=$1", [
                mine.id,
              ])
            ).rows[0].full_name,
            "Colleague private",
          );
        },
      );
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await new Promise((r) => setTimeout(r, 20));
      await db.pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
