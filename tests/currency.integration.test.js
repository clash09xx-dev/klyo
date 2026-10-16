const test = require("node:test");
const assert = require("node:assert/strict");

// Opt in with a disposable PostgreSQL connection. Fixtures live in their own schema.
test(
  "currency API persists values, isolates workspaces and rolls back failures in PostgreSQL",
  {
    skip: !process.env.TEST_DATABASE_URL,
  },
  async (t) => {
    const { Pool } = require("pg");
    const schema = `klyo_qa_${process.pid}_${Date.now()}`;
    const admin = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      ssl: false,
    });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.PGSSL = "false";
    process.env.JWT_SECRET = "test-only-secret";
    const db = require("../server/db");
    let server;
    try {
      await db.init();
      await db.query(
        "INSERT INTO workspaces (id, name, invite_code, is_comped) VALUES (1, 'Fixture A', 'TESTA', true), (2, 'Fixture B', 'TESTB', true)",
      );
      await db.query(
        "INSERT INTO users (id, workspace_id, name, email, role, password_hash) VALUES (1, 1, 'Admin', 'a@example.test', 'admin', 'fixture')",
      );
      await db.query(
        "INSERT INTO contacts (id, workspace_id, full_name, email) VALUES (1, 1, 'Client A', 'client@example.test'), (2, 2, 'Client B', 'b@example.test')",
      );
      await db.query(
        "INSERT INTO deals (workspace_id, title, value, currency) VALUES (1, 'Existing deal', 4500, 'USD'), (2, 'Other deal', 500, 'USD')",
      );
      await db.query(
        "INSERT INTO products (workspace_id, name, unit_price) VALUES (1, 'Website', 4500), (2, 'Other product', 500)",
      );
      await db.query(
        "INSERT INTO quotes (workspace_id, contact_id, title, total, status, sent_at) VALUES (1,1,'Draft',4500,'draft',NULL), (1,1,'Sent',4500,'sent',now()), (2,2,'Other draft',500,'draft',NULL)",
      );
      const express = require("express");
      const jwt = require("jsonwebtoken");
      const app = express();
      app.use(express.json());
      app.use("/api/auth", require("../server/routes/auth"));
      app.use("/api/quotes", require("../server/routes/quotes"));
      app.use("/api/deals", require("../server/routes/deals"));
      app.use("/api/products", require("../server/routes/products"));
      server = await new Promise((resolve) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      const token = (role) =>
        jwt.sign(
          { id: 1, workspace_id: 1, name: "Admin", role },
          process.env.JWT_SECRET,
        );
      async function request(endpoint, method = "GET", body, role = "admin") {
        if (role) await db.query("UPDATE users SET role=$1 WHERE id=1", [role]);
        const response = await fetch(base + "/api" + endpoint, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(role ? { Authorization: `Bearer ${token(role)}` } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, data: await response.json() };
      }

      await t.test(
        "only authenticated admins can change to supported currencies",
        async () => {
          assert.equal(
            (
              await request(
                "/auth/workspace/currency",
                "PUT",
                { currency: "PLN" },
                null,
              )
            ).status,
            401,
          );
          assert.equal(
            (
              await request(
                "/auth/workspace/currency",
                "PUT",
                { currency: "PLN" },
                "member",
              )
            ).status,
            403,
          );
          for (const currency of [{}, "", "ZZZ"])
            assert.equal(
              (await request("/auth/workspace/currency", "PUT", { currency }))
                .status,
              400,
            );
          assert.equal(
            (await request("/auth/workspace/settings")).data.workspace
              .default_currency,
            "USD",
          );
        },
      );
      await t.test(
        "existing 4500 USD becomes 4500 PLN and other workspaces and sent quotes stay intact",
        async () => {
          assert.equal(
            (
              await request("/auth/workspace/currency", "PUT", {
                currency: " pln ",
              })
            ).status,
            200,
          );
          assert.equal(
            (await request("/auth/workspace/settings")).data.workspace
              .default_currency,
            "PLN",
          );
          assert.deepEqual(
            (
              await db.query(
                "SELECT workspace_id, value, currency FROM deals ORDER BY workspace_id",
              )
            ).rows,
            [
              { workspace_id: 1, value: "4500.00", currency: "PLN" },
              { workspace_id: 2, value: "500.00", currency: "USD" },
            ],
          );
          assert.deepEqual(
            (
              await db.query(
                "SELECT workspace_id, unit_price, currency FROM products ORDER BY workspace_id",
              )
            ).rows,
            [
              { workspace_id: 1, unit_price: "4500.00", currency: "PLN" },
              { workspace_id: 2, unit_price: "500.00", currency: "USD" },
            ],
          );
          assert.deepEqual(
            (
              await db.query(
                "SELECT title, total, currency FROM quotes ORDER BY id",
              )
            ).rows,
            [
              { title: "Draft", total: "4500.00", currency: "PLN" },
              { title: "Sent", total: "4500.00", currency: "USD" },
              { title: "Other draft", total: "500.00", currency: "USD" },
            ],
          );
          // Correct records left behind by the old default-only implementation.
          await db.query(
            "UPDATE deals SET currency='USD' WHERE workspace_id=1",
          );
          await request("/auth/workspace/currency", "PUT", { currency: "PLN" });
          assert.equal(
            (await db.query("SELECT currency FROM deals WHERE workspace_id=1"))
              .rows[0].currency,
            "PLN",
          );
        },
      );
      await t.test(
        "new deals and products use the workspace currency and retain it on edits",
        async () => {
          const created = await request("/deals", "POST", {
            title: "New deal",
            value: 4500,
          });
          assert.equal(created.status, 201);
          assert.equal(created.data.deal.currency, "PLN");
          const edited = await request(
            `/deals/${created.data.deal.id}`,
            "PUT",
            { title: "Updated deal", value: 4500 },
          );
          assert.equal(edited.data.deal.currency, "PLN");
          const product = await request("/products", "POST", {
            name: "New product",
            unit_price: 4500,
          });
          assert.equal(product.status, 201);
          assert.equal(product.data.product.currency, "PLN");
          const updated = await request(
            `/products/${product.data.product.id}`,
            "PUT",
            { name: "Updated product", unit_price: 4500 },
          );
          assert.equal(updated.data.product.currency, "PLN");
        },
      );
      await t.test(
        "new quotes honor default currency, explicit currency and draft edits",
        async () => {
          const body = {
            contact_id: 1,
            title: "New quote",
            line_items: [
              { description: "Website", quantity: 1, unit_price: 4500 },
            ],
          };
          const created = await request("/quotes", "POST", body);
          assert.equal(created.status, 201);
          assert.equal(created.data.quote.currency, "PLN");
          assert.equal(created.data.quote.total, "4500.00");
          const edited = await request(
            `/quotes/${created.data.quote.id}`,
            "PUT",
            { ...body, currency: "EUR" },
          );
          assert.equal(edited.data.quote.currency, "EUR");
          assert.equal(edited.data.quote.total, "4500.00");
          const explicit = await request("/quotes", "POST", {
            ...body,
            currency: "GBP",
          });
          assert.equal(explicit.data.quote.currency, "GBP");
          const preview = await request(
            `/quotes/${created.data.quote.id}/preview`,
          );
          assert.match(preview.data.body, /€4,500\.00/);
          assert.doesNotMatch(preview.data.body, /\$/);
          assert.equal(
            (await request("/quotes", "POST", { ...body, currency: "ZZZ" }))
              .status,
            400,
          );
        },
      );
      let currencyFixture = 0;
      async function chain(
        name,
        {
          orderStatus = "draft",
          quoteStatus = "draft",
          sent = false,
          invoice = null,
          workspace = 1,
        } = {},
      ) {
        currencyFixture++;
        const deal = (
          await db.query(
            "INSERT INTO deals(workspace_id,title,value,currency) VALUES($1,$2,4500,'USD') RETURNING *",
            [workspace, name + " deal"],
          )
        ).rows[0];
        const quote = (
          await db.query(
            "INSERT INTO quotes(workspace_id,contact_id,title,total,currency,status,sent_at) VALUES($1,$2,$3,4500,'USD',$4,CASE WHEN $5 THEN now() ELSE NULL END) RETURNING *",
            [
              workspace,
              workspace === 1 ? 1 : 2,
              name + " quote",
              quoteStatus,
              sent,
            ],
          )
        ).rows[0];
        const salesCase = (
          await db.query(
            "INSERT INTO commercial_cases(workspace_id,number,title,deal_id,quote_id,value,currency) VALUES($1,$2,$3,$4,$5,4500,'USD') RETURNING *",
            [workspace, "CUR-" + currencyFixture, name, deal.id, quote.id],
          )
        ).rows[0];
        await db.query("UPDATE quotes SET commercial_case_id=$1 WHERE id=$2", [
          salesCase.id,
          quote.id,
        ]);
        const order = (
          await db.query(
            "INSERT INTO sales_orders(workspace_id,number,title,kind,status,deal_id,quote_id,case_id,currency,total,subtotal) VALUES($1,$2,$3,'customer',$4,$5,$6,$7,'USD',4500,4500) RETURNING *",
            [
              workspace,
              "CUR-ORD-" + currencyFixture,
              name + " order",
              orderStatus,
              deal.id,
              quote.id,
              salesCase.id,
            ],
          )
        ).rows[0];
        if (invoice)
          await db.query(
            "INSERT INTO invoice_provider_links(order_id,workspace_id,provider_subdomain,external_ref,status,provider_id) VALUES($1,$2,'fixture',$3,$4,$5)",
            [
              order.id,
              workspace,
              "CUR-INV-" + currencyFixture,
              invoice,
              invoice === "issued" ? "123" : null,
            ],
          );
        return { deal, quote, salesCase, order };
      }
      async function assertCurrencies(f, expected) {
        for (const [table, record] of [
          ["deals", f.deal],
          ["quotes", f.quote],
          ["commercial_cases", f.salesCase],
          ["sales_orders", f.order],
        ]) {
          const row = (
            await db.query(`SELECT * FROM ${table} WHERE id=$1`, [record.id])
          ).rows[0];
          assert.equal(row.currency, expected, table + " " + record.id);
          if (table === "deals") assert.equal(row.value, "4500.00");
          if (table === "quotes" || table === "sales_orders")
            assert.equal(row.total, "4500.00");
        }
      }
      await t.test(
        "currency relabels eligible case/order graphs but preserves confirmed, sent and invoice-bound financial records",
        async () => {
          const draft = await chain("Editable"),
            confirmed = await chain("Confirmed", { orderStatus: "confirmed" }),
            pending = await chain("Pending invoice", { invoice: "pending" }),
            issued = await chain("Issued invoice", { invoice: "issued" }),
            sent = await chain("Sent offer", {
              quoteStatus: "sent",
              sent: true,
            }),
            other = await chain("Other workspace", { workspace: 2 });
          const product = (
            await db.query(
              "SELECT id FROM products WHERE workspace_id=1 ORDER BY id LIMIT 1",
            )
          ).rows[0];
          const priceList = (
            await db.query(
              "INSERT INTO price_lists(workspace_id,name,currency) VALUES(1,'Original USD supplier list','USD') RETURNING id",
            )
          ).rows[0];
          await db.query(
            "INSERT INTO price_list_items(price_list_id,product_id,unit_price) VALUES($1,$2,123.45)",
            [priceList.id, product.id],
          );
          await db.query(
            "INSERT INTO product_purchase_prices(workspace_id,product_id,unit_cost,currency) VALUES(1,$1,80,'USD') ON CONFLICT(workspace_id,product_id,currency) DO UPDATE SET unit_cost=80",
            [product.id],
          );
          await db.query(
            "UPDATE quotes SET price_list_id=$1 WHERE id=ANY($2::int[])",
            [priceList.id, [draft.quote.id, confirmed.quote.id]],
          );
          const costItems = [];
          for (const f of [draft, confirmed]) {
            const item = (
              await db.query(
                "INSERT INTO quote_line_items(quote_id,product_id,description,quantity,unit_price,line_total) VALUES($1,$2,'Costed line',1,100,100) RETURNING id",
                [f.quote.id, product.id],
              )
            ).rows[0];
            costItems.push(item.id);
            await db.query(
              "INSERT INTO quote_item_costs(item_id,workspace_id,unit_cost,currency) VALUES($1,1,80,'USD')",
              [item.id],
            );
          }
          const beforeDraft = (
            await db.query("SELECT updated_at FROM quotes WHERE id=$1", [
              draft.quote.id,
            ])
          ).rows[0].updated_at;
          assert.equal(
            (
              await request("/auth/workspace/currency", "PUT", {
                currency: "PLN",
              })
            ).status,
            200,
          );
          await assertCurrencies(draft, "PLN");
          for (const f of [confirmed, pending, issued, sent, other])
            await assertCurrencies(f, "USD");
          const dq = (
            await db.query(
              "SELECT price_list_id,updated_at FROM quotes WHERE id=$1",
              [draft.quote.id],
            )
          ).rows[0];
          assert.equal(dq.price_list_id, null);
          assert.ok(dq.updated_at > beforeDraft);
          assert.equal(
            (
              await db.query("SELECT price_list_id FROM quotes WHERE id=$1", [
                confirmed.quote.id,
              ])
            ).rows[0].price_list_id,
            priceList.id,
          );
          assert.equal(
            (
              await db.query("SELECT currency FROM price_lists WHERE id=$1", [
                priceList.id,
              ])
            ).rows[0].currency,
            "USD",
          );
          assert.equal(
            (
              await db.query(
                "SELECT unit_price FROM price_list_items WHERE price_list_id=$1",
                [priceList.id],
              )
            ).rows[0].unit_price,
            "123.45",
          );
          const cost = (
            await db.query(
              "SELECT currency,unit_cost FROM product_purchase_prices WHERE workspace_id=1 AND product_id=$1",
              [product.id],
            )
          ).rows[0];
          assert.deepEqual(cost, { currency: "USD", unit_cost: "80.00" });
          const snapshots = (
            await db.query(
              "SELECT item_id,unit_cost,currency FROM quote_item_costs WHERE item_id=ANY($1::int[]) ORDER BY item_id",
              [costItems],
            )
          ).rows;
          assert.deepEqual(snapshots, [
            { item_id: costItems[0], unit_cost: "80.00", currency: "USD" },
            { item_id: costItems[1], unit_cost: "80.00", currency: "USD" },
          ]);
          const margin =
            await require("../server/services/commercial").quoteMargin(
              db,
              { workspace_id: 1, id: 1, is_team_owner: true },
              draft.quote.id,
            );
          assert.equal(margin.missing_costs, 1);
          assert.equal(margin.profit, null);
          const preserved =
            await require("../server/services/commercial").quoteMargin(
              db,
              { workspace_id: 1, id: 1, is_team_owner: true },
              confirmed.quote.id,
            );
          assert.equal(preserved.missing_costs, 0);
        },
      );
      await t.test(
        "an invoice reservation made while the currency change waits keeps its complete document graph in the original currency",
        async () => {
          const f = await chain("Concurrent invoice"),
            c = await db.pool.connect();
          try {
            await c.query("BEGIN");
            await c.query(
              "SELECT id FROM sales_orders WHERE id=$1 FOR UPDATE",
              [f.order.id],
            );
            const changed = request("/auth/workspace/currency", "PUT", {
              currency: "PLN",
            });
            await new Promise((resolve) => setTimeout(resolve, 60));
            await c.query(
              "INSERT INTO invoice_provider_links(order_id,workspace_id,provider_subdomain,external_ref,status) VALUES($1,1,'fixture',$2,'pending')",
              [f.order.id, "CUR-RACE-" + f.order.id],
            );
            await c.query("COMMIT");
            assert.equal((await changed).status, 200);
            await assertCurrencies(f, "USD");
          } catch (e) {
            await c.query("ROLLBACK");
            throw e;
          } finally {
            c.release();
          }
        },
      );
      await t.test(
        "a database failure restores default and all record currencies",
        async () => {
          const before = (
            await db.query(
              "SELECT id,currency FROM deals WHERE workspace_id=1 ORDER BY id",
            )
          ).rows;
          await db.query(`CREATE FUNCTION reject_currency() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$;
        CREATE TRIGGER reject_currency BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION reject_currency()`);
          assert.equal(
            (
              await request("/auth/workspace/currency", "PUT", {
                currency: "EUR",
              })
            ).status,
            500,
          );
          assert.equal(
            (await request("/auth/workspace/settings")).data.workspace
              .default_currency,
            "PLN",
          );
          assert.deepEqual(
            (
              await db.query(
                "SELECT id,currency FROM deals WHERE workspace_id=1 ORDER BY id",
              )
            ).rows,
            before,
          );
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
