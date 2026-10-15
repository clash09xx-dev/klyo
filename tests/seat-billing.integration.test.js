const test = require("node:test"),
  assert = require("node:assert/strict");
test(
  "plan user limits require upgrading and cannot be bypassed through retired seat billing",
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
      const join = (email) =>
        req("/auth/register", "POST", {
          name: "New teammate",
          email,
          password: "test-only",
          invite_code: "SEATS",
        });
      await t.test(
        "summary uses the plan cap only and billing stays owner-only",
        async () => {
          await db.query("UPDATE workspaces SET extra_seats=99 WHERE id=$1", [
            ws.id,
          ]);
          const r = await req("/billing/seats");
          assert.equal(r.status, 200);
          assert.equal(r.data.included, 1);
          assert.equal(r.data.used, 2);
          assert.equal(r.data.total_monthly, 9);
          assert.equal(r.data.limit_reached, true);
          assert.equal("unit_price" in r.data, false);
          assert.equal("extra" in r.data, false);
          assert.equal(
            (await req("/billing/seats", "GET", undefined, 1)).status,
            403,
          );
          assert.equal(
            (await req("/billing/plan", "POST", { tier: "plus" }, 1)).status,
            403,
          );
          assert.equal(
            (await req("/billing/checkout", "POST", { tier: "plus" }, 1))
              .status,
            403,
          );
        },
      );
      await t.test(
        "retired seat endpoint never calls Stripe; stale purchase inputs cannot bypass plan caps",
        async () => {
          const start = calls.length;
          for (const extra of [0, 2, -1, 1.5, 1001]) {
            const r = await req("/billing/seats", "POST", {
              extra_seats: extra,
            });
            assert.equal(r.status, 410);
            assert.equal(r.data.code, "PLAN_UPGRADE_REQUIRED");
          }
          for (const route of ["/billing/checkout", "/billing/plan"])
            for (const extra of [2, -1, 1.5, 1001])
              assert.equal(
                (await req(route, "POST", { tier: "plus", extra_seats: extra }))
                  .status,
                400,
              );
          assert.equal(calls.length, start);
          const r = await join("blocked@seats.test");
          assert.equal(r.status, 403);
          assert.equal(r.data.code, "LIMIT_EXCEEDED");
          assert.match(r.data.error, /maximum.*Upgrade to a higher plan/);
          assert.equal(
            (
              await db.query(
                "SELECT COUNT(*)::int n FROM users WHERE workspace_id=$1",
                [ws.id],
              )
            ).rows[0].n,
            2,
          );
        },
      );
      await t.test(
        "only a completed higher-plan payment increases capacity; legacy add-ons are removed",
        async () => {
          sub.items.data.push({
            id: "si_extra",
            price: prices.extra,
            quantity: 99,
          });
          let r = await req("/billing/plan", "POST", { tier: "plus" });
          assert.equal(r.status, 200);
          assert.equal(r.data.pending, true);
          assert.equal(
            (await db.query("SELECT tier FROM workspaces WHERE id=$1", [ws.id]))
              .rows[0].tier,
            "personal",
          );
          assert.equal((await join("still-blocked@seats.test")).status, 403);
          const update = calls.find((c) => c[0] === "update");
          assert.deepEqual(update[1].items, [
            { id: "si_base", price: "price_plus", quantity: 1 },
            { id: "si_extra", deleted: true },
          ]);
          pending = false;
          r = await req("/billing/plan", "POST", { tier: "plus" });
          assert.equal(r.status, 200);
          assert.equal(r.data.pending, false);
          assert.equal(
            (await db.query("SELECT tier FROM workspaces WHERE id=$1", [ws.id]))
              .rows[0].tier,
            "plus",
          );
          assert.equal(await readSeats(), 0);
          assert.equal((await join("allowed@seats.test")).status, 201);
          const noOpStart = calls.length;
          assert.equal(
            (await req("/billing/plan", "POST", { tier: "plus" })).status,
            200,
          );
          assert.equal(calls.length, noOpStart);
          assert.equal(
            (await req("/billing/plan", "POST", { tier: "personal" })).status,
            400,
          );
        },
      );
      await t.test(
        "concurrent invitations cannot exceed the plan limit",
        async () => {
          await db.query(
            "INSERT INTO users(workspace_id,name,email,password_hash) VALUES($1,'Fourth','fourth@seats.test','fixture')",
            [ws.id],
          );
          const replies = await Promise.all([
            join("race-one@seats.test"),
            join("race-two@seats.test"),
          ]);
          assert.deepEqual(replies.map((r) => r.status).sort(), [201, 403]);
          assert.equal((await req("/billing/seats")).data.limit_reached, true);
          assert.equal(
            (
              await db.query(
                "SELECT COUNT(*)::int n FROM users WHERE workspace_id=$1",
                [ws.id],
              )
            ).rows[0].n,
            5,
          );
        },
      );
      await t.test(
        "subscription webhooks cannot restore retired add-on entitlement; verified events stay idempotent",
        async () => {
          sub.items.data.push({
            id: "si_legacy",
            price: prices.extra,
            quantity: 100,
          });
          await db.query("UPDATE workspaces SET extra_seats=100 WHERE id=$1", [
            ws.id,
          ]);
          const event = {
            id: "evt_legacy",
            type: "customer.subscription.updated",
            data: { object: sub },
          };
          assert.equal(
            (await req("/billing/webhook", "POST", event)).status,
            200,
          );
          assert.equal(await readSeats(), 0);
          assert.equal((await join("legacy-blocked@seats.test")).status, 403);
          assert.equal(
            (await req("/billing/webhook", "POST", event)).status,
            200,
          );
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
        "checkout contains only the selected plan and rejects plans too small for the team",
        async () => {
          assert.equal(
            (await req("/billing/checkout", "POST", { tier: "plus" })).status,
            409,
          );
          await db.query(
            "UPDATE workspaces SET stripe_subscription_id=NULL WHERE id=$1",
            [ws.id],
          );
          assert.equal(
            (await req("/billing/checkout", "POST", { tier: "personal" }))
              .status,
            400,
          );
          const r = await req("/billing/checkout", "POST", { tier: "plus" });
          assert.equal(r.status, 200);
          const call = calls.find((c) => c[0] === "checkout");
          assert.deepEqual(call[1].line_items, [
            { price: "price_plus", quantity: 1 },
          ]);
          assert.equal("extra_seats" in call[1].metadata, false);
          assert.ok(call[2].idempotencyKey.includes("klyo-checkout"));
          prices.price_plus.unit_amount = 9900;
          assert.equal(
            (await req("/billing/checkout", "POST", { tier: "plus" })).status,
            502,
          );
          prices.price_plus.unit_amount = 2900;
        },
      );
      await t.test(
        "unpaid/duplicate one-time webhooks do not grant access twice or restore add-ons",
        async () => {
          const session = {
            client_reference_id: String(ws.id),
            customer: "cus_mock",
            payment_status: "unpaid",
            metadata: {
              tier: "plus",
              billing_mode: "one_time",
              extra_seats: "100",
            },
          };
          await db.query(
            "UPDATE workspaces SET plan='past_due',extra_seats=100 WHERE id=$1",
            [ws.id],
          );
          assert.equal(
            (
              await req("/billing/webhook", "POST", {
                id: "evt_unpaid",
                type: "checkout.session.completed",
                data: { object: session },
              })
            ).status,
            200,
          );
          assert.equal(
            (await db.query("SELECT plan FROM workspaces WHERE id=$1", [ws.id]))
              .rows[0].plan,
            "past_due",
          );
          const event = {
            id: "evt_onetime",
            type: "checkout.session.async_payment_succeeded",
            data: { object: { ...session, payment_status: "paid" } },
          };
          assert.equal(
            (await req("/billing/webhook", "POST", event)).status,
            200,
          );
          assert.equal(await readSeats(), 0);
          const end = (
            await db.query(
              "SELECT current_period_end FROM workspaces WHERE id=$1",
              [ws.id],
            )
          ).rows[0].current_period_end.toISOString();
          await req("/billing/webhook", "POST", event);
          assert.equal(
            (
              await db.query(
                "SELECT current_period_end FROM workspaces WHERE id=$1",
                [ws.id],
              )
            ).rows[0].current_period_end.toISOString(),
            end,
          );
          assert.equal((await join("one-time-blocked@seats.test")).status, 403);
        },
      );
      await t.test(
        "trial, comped and unlimited plans keep their existing unlimited access",
        async () => {
          const { assertWithinLimit } = require("../server/services/limits");
          for (const patch of [
            "plan='trial'",
            "plan='active',is_comped=true,comped_until=NULL",
            "is_comped=false,tier='ultra'",
          ]) {
            await db.query("UPDATE workspaces SET " + patch + " WHERE id=$1", [
              ws.id,
            ]);
            await assertWithinLimit(ws.id, "seats");
            const r = await req("/billing/seats");
            assert.equal(r.data.limit_reached, false);
            assert.equal(r.data.unlimited, true);
          }
          await db.query(
            "UPDATE workspaces SET tier='plus',is_comped=true,comped_until=now()-interval '1 day' WHERE id=$1",
            [ws.id],
          );
          await assert.rejects(
            () => assertWithinLimit(ws.id, "seats"),
            /Upgrade to a higher plan/,
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
