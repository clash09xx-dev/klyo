const test = require("node:test"),
  assert = require("node:assert/strict");
test(
  "paid seat entitlement and Stripe checkout are owner-controlled and payment-gated",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { Pool } = require("pg"),
      express = require("express"),
      jwt = require("jsonwebtoken");
    const schema = `klyo_seats_${process.pid}_${Date.now()}`,
      admin = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        ssl: false,
      });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.PGSSL = "false";
    process.env.JWT_SECRET = "seat-test-only";
    process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    process.env.STRIPE_WEBHOOK_SECRET = "mock";
    process.env.STRIPE_PRICE_ID_PERSONAL = "price_personal";
    process.env.STRIPE_PRICE_ID_PLUS = "price_plus";
    const prices = {
      price_personal: {
        id: "price_personal",
        currency: "usd",
        unit_amount: 900,
        recurring: { interval: "month", interval_count: 1 },
        metadata: {},
      },
      price_plus: {
        id: "price_plus",
        currency: "usd",
        unit_amount: 2900,
        recurring: { interval: "month", interval_count: 1 },
        metadata: {},
      },
      extra: {
        id: "price_extra",
        currency: "usd",
        unit_amount: 500,
        recurring: { interval: "month", interval_count: 1 },
        metadata: { klyo_extra_seat: "1" },
      },
    };
    let sub = {
        id: "sub_mock",
        status: "active",
        cancel_at_period_end: false,
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
        items: {
          data: [{ id: "si_base", price: prices.price_personal, quantity: 1 }],
        },
        pending_update: null,
      },
      pending = true,
      calls = [];
    const stripe = {
      prices: {
        list: async () => ({ data: [prices.extra] }),
        retrieve: async (id) => prices[id],
      },
      checkout: {
        sessions: {
          create: async (...args) => {
            calls.push(["checkout", ...args]);
            return { url: "https://checkout.stripe.test/session" };
          },
        },
      },
      subscriptions: {
        retrieve: async () => structuredClone(sub),
        update: async (id, params, opts) => {
          calls.push(["update", params, opts]);
          if (pending)
            return {
              ...structuredClone(sub),
              pending_update: { expires_at: 1234 },
              latest_invoice: {
                hosted_invoice_url: "https://invoice.stripe.test/pay",
              },
            };
          let items = structuredClone(sub.items.data);
          for (const item of params.items || []) {
            if (item.deleted) items = items.filter((i) => i.id !== item.id);
            else if (item.id) {
              const old = items.find((i) => i.id === item.id);
              if (item.price) old.price = prices[item.price];
              old.quantity = item.quantity;
            } else
              items.push({
                id: "si_extra",
                price: prices.extra,
                quantity: item.quantity,
              });
          }
          sub = { ...sub, items: { data: items }, pending_update: null };
          return structuredClone(sub);
        },
      },
      webhooks: {
        constructEvent: (raw, signature) => {
          if (signature !== "valid-test-signature")
            throw new Error("Bad signature");
          return Buffer.isBuffer(raw) ? JSON.parse(raw.toString()) : raw;
        },
      },
    };
    const stripePath = require.resolve("stripe");
    require.cache[stripePath] = {
      id: stripePath,
      filename: stripePath,
      loaded: true,
      exports: class {
        constructor() {
          return stripe;
        }
      },
    };
    const db = require("../server/db");
    let server;
    try {
      await db.init();
      const ws = (
          await db.query(
            "INSERT INTO workspaces(name,invite_code,plan,tier,current_period_end,stripe_subscription_id,stripe_customer_id) VALUES('Paid team','SEATS','active','personal',now()+interval '30 days','sub_mock','cus_mock') RETURNING *",
          )
        ).rows[0],
        users = [];
      for (const name of ["Owner", "Manager"])
        users.push(
          (
            await db.query(
              "INSERT INTO users(workspace_id,name,email,password_hash,role) VALUES($1,$2,$3,'fixture','admin') RETURNING *",
              [ws.id, name, name.toLowerCase() + "@seats.test"],
            )
          ).rows[0],
        );
      await db.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
        users[0].id,
        ws.id,
      ]);
      const app = express();
      app.use(express.json());
      app.use("/api/billing", require("../server/routes/billing"));
      app.use("/api/auth", require("../server/routes/auth"));
      server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      async function req(
        route,
        method = "GET",
        body,
        index = 0,
        signature = "valid-test-signature",
      ) {
        const u = users[index],
          r = await fetch(
            `http://127.0.0.1:${server.address().port}/api${route}`,
            {
              method,
              headers: {
                "Content-Type": "application/json",
                Authorization:
                  "Bearer " +
                  jwt.sign(
                    { id: u.id, workspace_id: ws.id, role: u.role },
                    process.env.JWT_SECRET,
                  ),
                "stripe-signature": signature,
              },
              body: body === undefined ? undefined : JSON.stringify(body),
            },
          );
        const raw = await r.text();
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = { error: raw };
        }
        return { status: r.status, data };
      }
      const readSeats = async () =>
        Number(
          (
            await db.query("SELECT extra_seats FROM workspaces WHERE id=$1", [
              ws.id,
            ])
          ).rows[0].extra_seats,
        );
      await t.test(
        "additional seats are $5; even a team admin cannot buy or inspect owner billing",
        async () => {
          const summary = await req("/billing/seats");
          assert.equal(summary.status, 200);
          assert.equal(summary.data.unit_price, 5);
          assert.equal(summary.data.included, 1);
          assert.equal(summary.data.used, 2);
          assert.equal(
            (await req("/billing/seats", "POST", { extra_seats: 2 }, 1)).status,
            403,
          );
          assert.equal(
            (await req("/billing/seats", "GET", undefined, 1)).status,
            403,
          );
          assert.equal(calls.length, 0);
        },
      );
      await t.test(
        "unpaid seat changes do not increase invitations or local entitlement",
        async () => {
          const r = await req("/billing/seats", "POST", { extra_seats: 2 });
          assert.equal(r.status, 200, JSON.stringify(r));
          assert.equal(r.data.pending, true);
          assert.equal(r.data.url, "https://invoice.stripe.test/pay");
          assert.equal(await readSeats(), 0);
          const update = calls.find((c) => c[0] === "update");
          assert.equal(update[1].payment_behavior, "pending_if_incomplete");
          assert.equal(update[1].proration_behavior, "always_invoice");
          assert.equal(update[1].items[0].quantity, 2);
          const join = await req("/auth/register", "POST", {
            name: "Blocked",
            email: "blocked@seats.test",
            password: "test-only",
            invite_code: "SEATS",
          });
          assert.equal(join.status, 403);
        },
      );
      await t.test(
        "verified paid subscription event unlocks exact quantity, not request metadata",
        async () => {
          sub.items.data.push({
            id: "si_extra",
            price: prices.extra,
            quantity: 2,
          });
          const event = {
            id: "evt_paid_seats",
            type: "customer.subscription.updated",
            data: { object: sub },
          };
          assert.equal(
            (await req("/billing/webhook", "POST", event)).status,
            200,
          );
          assert.equal(await readSeats(), 2);
          const joined = await req("/auth/register", "POST", {
            name: "Allowed",
            email: "allowed@seats.test",
            password: "test-only",
            invite_code: "SEATS",
          });
          assert.equal(joined.status, 201, JSON.stringify(joined));
          assert.equal(
            (await req("/billing/webhook", "POST", event)).status,
            200,
          );
          assert.equal(await readSeats(), 2);
          assert.equal(
            (
              await req(
                "/billing/webhook",
                "POST",
                { ...event, id: "bad" },
                0,
                "invalid",
              )
            ).status,
            400,
          );
        },
      );
      await t.test(
        "cannot buy negative seats, reduce below use, or create a second base subscription",
        async () => {
          for (const extra of [-1, 1.5, 1001])
            assert.equal(
              (await req("/billing/seats", "POST", { extra_seats: extra }))
                .status,
              400,
            );
          assert.equal(
            (await req("/billing/seats", "POST", { extra_seats: 0 })).status,
            400,
          );
          assert.equal(
            (
              await req("/billing/checkout", "POST", {
                tier: "plus",
                extra_seats: 0,
              })
            ).status,
            409,
          );
        },
      );
      await t.test(
        "plan changes keep pending payments gated and activate the paid Stripe plan",
        async () => {
          let r = await req("/billing/plan", "POST", {
            tier: "plus",
            extra_seats: 2,
          });
          assert.equal(r.status, 200);
          assert.equal(r.data.pending, true);
          assert.equal(
            (await db.query("SELECT tier FROM workspaces WHERE id=$1", [ws.id]))
              .rows[0].tier,
            "personal",
          );
          pending = false;
          r = await req("/billing/plan", "POST", {
            tier: "plus",
            extra_seats: 2,
          });
          assert.equal(r.status, 200);
          assert.equal(
            (await db.query("SELECT tier FROM workspaces WHERE id=$1", [ws.id]))
              .rows[0].tier,
            "plus",
          );
        },
      );
      await t.test('repeated seat changes use fresh operations and identical quantities are a no-op',async()=>{
 pending=false;const start=calls.length;
 for(const extra of [3,2,3])assert.equal((await req('/billing/seats','POST',{extra_seats:extra})).status,200);
 const updates=calls.slice(start).filter(c=>c[0]==='update');assert.equal(updates.length,3);assert.equal(new Set(updates.map(c=>c[2].idempotencyKey)).size,3);assert.equal(await readSeats(),3);
 assert.equal((await req('/billing/seats','POST',{extra_seats:3})).status,200);assert.equal(calls.slice(start).filter(c=>c[0]==='update').length,3);
 });
 await t.test(
        "checkout shows a base plan plus seat line, validates actual configured prices and is idempotent",
        async () => {
          await db.query(
            "UPDATE workspaces SET stripe_subscription_id=NULL WHERE id=$1",
            [ws.id],
          );
          const r = await req("/billing/checkout", "POST", {
            tier: "plus",
            extra_seats: 2,
          });
          assert.equal(r.status, 200, JSON.stringify(r));
          const call = calls.find((c) => c[0] === "checkout");
          assert.deepEqual(call[1].line_items, [
            { price: "price_plus", quantity: 1 },
            { price: "price_extra", quantity: 2 },
          ]);
          assert.equal(call[1].metadata.extra_seats, "2");
          assert.ok(call[2].idempotencyKey.includes("klyo-checkout"));
          assert.equal(call[1].success_url.endsWith("/app?upgraded=1"), true);
          prices.price_plus.unit_amount = 9900;
          const bad = await req("/billing/checkout", "POST", {
            tier: "plus",
            extra_seats: 2,
          });
          assert.equal(bad.status, 502);
          prices.price_plus.unit_amount = 2900;
        },
      );
      await t.test(
        "duplicate one-time payment webhooks do not extend access twice; unpaid sessions do not activate",
        async () => {
          const session = {
              client_reference_id: String(ws.id),
              customer: "cus_mock",
              payment_status: "unpaid",
              metadata: {
                tier: "personal",
                billing_mode: "one_time",
                extra_seats: "3",
              },
            },
            unpaid = {
              id: "evt_unpaid_once",
              type: "checkout.session.completed",
              data: { object: session },
            };
          await db.query("UPDATE workspaces SET plan='past_due' WHERE id=$1", [
            ws.id,
          ]);
          await req("/billing/webhook", "POST", unpaid);
          assert.equal(
            (await db.query("SELECT plan FROM workspaces WHERE id=$1", [ws.id]))
              .rows[0].plan,
            "past_due",
          );
          const paid = {
            id: "evt_paid_once",
            type: "checkout.session.async_payment_succeeded",
            data: { object: { ...session, payment_status: "paid" } },
          };
          assert.equal(
            (await req("/billing/webhook", "POST", paid)).status,
            200,
          );
          assert.equal(await readSeats(), 3);
          const end = (
            await db.query(
              "SELECT current_period_end FROM workspaces WHERE id=$1",
              [ws.id],
            )
          ).rows[0].current_period_end.toISOString();
          await req("/billing/webhook", "POST", paid);
          assert.equal(
            (
              await db.query(
                "SELECT current_period_end FROM workspaces WHERE id=$1",
                [ws.id],
              )
            ).rows[0].current_period_end.toISOString(),
            end,
          );
        },
      );
    } finally {
      if (server) await new Promise((r) => server.close(r));
      await new Promise((r) => setTimeout(r, 20));
      await db.pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
