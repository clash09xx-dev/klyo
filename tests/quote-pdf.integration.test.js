const test = require("node:test"),
  assert = require("node:assert/strict");
const Q = require("../public/js/quote-core");
test(
  "PDF quotation workflow persists branded drafts, isolates workspaces and sends only on approval",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { Pool } = require("pg"),
      express = require("express"),
      jwt = require("jsonwebtoken");
    const admin = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        ssl: false,
      }),
      schema = `klyo_pdf_${process.pid}_${Date.now()}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.PGSSL = "false";
    process.env.JWT_SECRET = "isolated-pdf-test";
    const sent = [],
      mailer = require.resolve("../server/services/mailer");
    require.cache[mailer] = {
      id: mailer,
      filename: mailer,
      loaded: true,
      exports: {
        sendOfferEmail: async (...args) => {
          sent.push(args);
        },
      },
    };
    const db = require("../server/db");
    let server, id;
    const design = Q.normalizeDocument({
      layout: "executive",
      language: "pl",
      reference: "OF-2026-0042",
      issued_on: "2026-10-15",
      valid_until: "2026-10-30",
      seller: {
        name: "Studio Łódź",
        email: "sender@example.test",
        details: "Adres testowy",
      },
      buyer: { name: "Klient Żółć", email: "client@example.test" },
      terms: "Zakres wymaga akceptacji.",
      payment: "50% przed rozpoczęciem.",
      delivery: "4 tygodnie.",
      scope: "Projekt i wdrożenie strony.",
    });
    const payload = {
      contact_id: 1,
      title: "Oferta - nowa strona",
      currency: "PLN",
      tax_rate: 23,
      document: design,
      line_items: [
        {
          description: "Strona internetowa",
          quantity: 1,
          unit_price: 4500,
          discount_percent: 10,
          product_id: 1,
        },
      ],
      recipient_ids: [1],
    };
    try {
      await db.init();
      await db.init();
      await db.query(
        "INSERT INTO workspaces(id,name,invite_code,is_comped) VALUES(1,'Studio','A',true),(2,'Other','B',true)",
      );
      await db.query(
        "INSERT INTO users(id,workspace_id,name,email,password_hash,role) VALUES(1,1,'Admin','a@example.test','fixture','admin'),(2,1,'Viewer','v@example.test','fixture','viewer'),(3,2,'Other','o@example.test','fixture','admin')",
      );
      await db.query(
        "INSERT INTO companies(id,workspace_id,name) VALUES(1,1,'Client'),(2,2,'Private')",
      );
      await db.query(
        "INSERT INTO contacts(id,workspace_id,full_name,email,company_id) VALUES(1,1,'Klient','client@example.test',1),(2,2,'Other','other@example.test',2)",
      );
      await db.query(
        "INSERT INTO products(id,workspace_id,name,unit_price) VALUES(1,1,'Website',4500),(2,2,'Private product',10)",
      );
      const app = express();
      app.use(express.json({ limit: "1mb" }));
      app.use("/api/quotes", require("../server/routes/quotes"));
      app.use("/q", require("../server/routes/publicQuotes"));
      server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      async function request(route, method = "GET", body, user = 1) {
        const headers = { "Content-Type": "application/json" };
        if (user)
          headers.Authorization =
            "Bearer " +
            jwt.sign(
              {
                id: user,
                workspace_id: user === 3 ? 2 : 1,
                role: user === 2 ? "viewer" : "admin",
                name: "Admin",
              },
              process.env.JWT_SECRET,
            );
        const r = await fetch(base + route, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const binary = r.headers
          .get("Content-Type")
          ?.includes("application/pdf");
        return {
          status: r.status,
          headers: r.headers,
          data: binary
            ? Buffer.from(await r.arrayBuffer())
            : await r.text().then((text) => {
                try {
                  return JSON.parse(text);
                } catch {
                  return text;
                }
              }),
        };
      }
      await t.test(
        "company design defaults require admin and are scoped and sanitized",
        async () => {
          assert.equal(
            (await request("/api/quotes/document-defaults", "PUT", design, 2))
              .status,
            403,
          );
          const r = await request(
            "/api/quotes/document-defaults",
            "PUT",
            design,
          );
          assert.equal(r.status, 200);
          assert.equal(r.data.document.reference, "");
          assert.equal(r.data.document.buyer.name, "");
          assert.equal(
            (await request("/api/quotes/document-defaults")).data.workspace
              .quote_defaults.seller.name,
            "Studio Łódź",
          );
          assert.deepEqual(
            (
              await request(
                "/api/quotes/document-defaults",
                "GET",
                undefined,
                3,
              )
            ).data.workspace.quote_defaults,
            {},
          );
        },
      );
      await t.test(
        "draft calculations, document snapshots, PDF and public share links agree",
        async () => {
          const r = await request("/api/quotes", "POST", payload);
          assert.equal(r.status, 201, JSON.stringify(r.data));
          id = r.data.quote.id;
          assert.equal(r.data.quote.total, "4981.50");
          assert.equal(r.data.quote.tax_total, "931.50");
          assert.deepEqual(r.data.quote.document, design);
          assert.equal(sent.length, 0);
          const pdf = await request(
            `/api/quotes/${id}/pdf`,
            "GET",
            undefined,
            2,
          );
          assert.equal(pdf.status, 200);
          assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
          assert.match(
            pdf.headers.get("Content-Disposition"),
            /OF-2026-0042\.pdf/,
          );
          assert.equal(pdf.headers.get("Cache-Control"), "private, no-store");
          assert.equal(
            (await request(`/api/quotes/${id}/pdf`, "GET", undefined, 3))
              .status,
            404,
          );
          assert.equal(
            (await request(`/api/quotes/${id}/pdf`, "GET", undefined, 0))
              .status,
            401,
          );
          const token = r.data.quote.public_token;
          const publicPdf = await request(
            `/q/${token}/pdf`,
            "GET",
            undefined,
            0,
          );
          assert.equal(publicPdf.status, 200);
          assert.equal(publicPdf.data.subarray(0, 5).toString(), "%PDF-");
          const page = await request(`/q/${token}`, "GET", undefined, 0);
          assert.match(page.data, /Pobierz PDF/);
          assert.match(page.data, /Studio Łódź/);
          assert.equal(
            (await request("/q/unknown-token/pdf", "GET", undefined, 0)).status,
            404,
          );
          await request("/api/quotes/document-defaults", "PUT", {
            ...design,
            seller: { name: "New brand" },
          });
          assert.equal(
            (await request(`/api/quotes/${id}`)).data.quote.document.seller
              .name,
            "Studio Łódź",
          );
        },
      );
      await t.test(
        "foreign links, viewer mutations and invalid values are rejected without orphan drafts",
        async () => {
          const before = Number(
            (await db.query("SELECT count(*) FROM quotes")).rows[0].count,
          );
          for (const body of [
            { ...payload, contact_id: 2 },
            { ...payload, company_id: 2 },
            { ...payload, recipient_ids: [2] },
            {
              ...payload,
              line_items: [{ ...payload.line_items[0], product_id: 2 }],
            },
          ])
            assert.equal(
              (await request("/api/quotes", "POST", body)).status,
              404,
            );
          assert.equal(
            (
              await request("/api/quotes", "POST", {
                ...payload,
                tax_rate: 101,
              })
            ).status,
            400,
          );
          for (const [route, method] of [
            ["/api/quotes", "POST"],
            [`/api/quotes/${id}`, "PUT"],
            [`/api/quotes/${id}`, "DELETE"],
            [`/api/quotes/${id}/send`, "POST"],
            [`/api/quotes/${id}/duplicate`, "POST"],
            [`/api/quotes/${id}/accept`, "POST"],
          ])
            assert.equal(
              (await request(route, method, payload, 2)).status,
              403,
            );
          assert.equal(
            Number(
              (await db.query("SELECT count(*) FROM quotes")).rows[0].count,
            ),
            before,
          );
          assert.equal(sent.length, 0);
        },
      );
      await t.test(
        "database failures roll back both quote and line changes",
        async () => {
          await db.query(
            "CREATE FUNCTION reject_pdf_line() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.description='FAIL' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$",
          );
          await db.query(
            "CREATE TRIGGER reject_pdf_line BEFORE INSERT ON quote_line_items FOR EACH ROW EXECUTE FUNCTION reject_pdf_line()",
          );
          const r = await request(`/api/quotes/${id}`, "PUT", {
            ...payload,
            title: "Should roll back",
            line_items: [{ description: "FAIL", quantity: 1, unit_price: 1 }],
          });
          assert.equal(r.status, 500);
          const full = (await request(`/api/quotes/${id}`)).data;
          assert.equal(full.quote.title, payload.title);
          assert.equal(full.lineItems[0].description, "Strona internetowa");
          assert.equal(full.quote.total, "4981.50");
        },
      );
      await t.test(
        "duplicate starts a new draft and approved delivery attaches the actual PDF",
        async () => {
          const copy = (
            await request(`/api/quotes/${id}/duplicate`, "POST", {})
          ).data;
          assert.notEqual(copy.quote.id, id);
          assert.equal(copy.quote.status, "draft");
          assert.equal(copy.quote.document.reference, "");
          assert.equal(copy.quote.document.valid_until, "");
          const preview = (await request(`/api/quotes/${id}/preview`)).data;
          assert.match(preview.body, /Dzień dobry/);
          assert.equal(preview.attachment.filename, "OF-2026-0042.pdf");
          assert.equal(sent.length, 0);
          assert.equal(
            (
              await request(`/api/quotes/${id}/send`, "POST", {
                revision: "2000-01-01",
              })
            ).status,
            409,
          );
          assert.equal(sent.length, 0);
          assert.equal(
            (
              await request(`/api/quotes/${id}/send`, "POST", {
                revision: preview.revision,
                subject: preview.subject,
                body: preview.body,
              })
            ).status,
            200,
          );
          assert.equal(sent.length, 1);
          assert.equal(sent[0][4][0].filename, preview.attachment.filename);
          assert.equal(
            sent[0][4][0].content.subarray(0, 5).toString(),
            "%PDF-",
          );
          assert.equal(
            (await request(`/api/quotes/${id}`, "PUT", payload)).status,
            400,
          );
          assert.equal(
            (await request(`/api/quotes/${id}/send`, "POST", {})).status,
            400,
          );
          assert.equal(sent.length, 1);
          await db.query("UPDATE quotes SET status='sent' WHERE id=$1", [
            copy.quote.id,
          ]);
          assert.equal(
            (await request(`/api/quotes/${copy.quote.id}/accept`, "POST", {}))
              .status,
            200,
          );
          assert.equal(
            (await request(`/api/quotes/${copy.quote.id}/accept`, "POST", {}))
              .status,
            400,
          );
          assert.equal(
            Number(
              (
                await db.query(
                  "SELECT count(*) FROM purchases WHERE quote_id=$1",
                  [copy.quote.id],
                )
              ).rows[0].count,
            ),
            1,
          );
        },
      );
      await t.test(
        "concurrent approvals cannot deliver the same draft twice",
        async () => {
          const copy = (
            await request(`/api/quotes/${id}/duplicate`, "POST", {})
          ).data.quote;
          const before = sent.length;
          const results = await Promise.all([
            request(`/api/quotes/${copy.id}/send`, "POST", {
              attach_pdf: false,
            }),
            request(`/api/quotes/${copy.id}/send`, "POST", {
              attach_pdf: false,
            }),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
          assert.equal(sent.length, before + 1);
          assert.deepEqual(sent.at(-1)[4], []);
        },
      );
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await db.pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
