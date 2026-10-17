const test = require("node:test"),
  assert = require("node:assert/strict");
test(
  "outcomes respect workspace, currency, period, deletion and drill-down; nested pricing survives templates and fulfillment",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await require("./helpers/calendar-fixture")();
    const call = async (p, m = "GET", b, u = 0, s = "team") =>
        f.req(p, m, b, u, s),
      ok = async (p, m, b, u, s) => {
        const r = await call(p, m, b, u, s);
        assert.ok(r.status < 400, JSON.stringify(r.data));
        return r.data;
      };
    try {
      const company = (
        await ok("/companies", "POST", { name: "Computer client" })
      ).company;
      const contact = (
        await f.db.query(
          "INSERT INTO contacts(workspace_id,full_name,company_id) VALUES($1,'Computer buyer',$2) RETURNING *",
          [f.w, company.id],
        )
      ).rows[0];
      const groups = [
        {
          id: "computer",
          name: "Complete computer",
          discount_type: "percent",
          discount_value: 5,
        },
        {
          id: "core",
          name: "CPU and GPU",
          parent_id: "computer",
          discount_type: "percent",
          discount_value: 10,
        },
      ];
      const items = [100, 100, 200, 400].map((price, i) => ({
        description: ["Motherboard", "RAM", "CPU", "GPU"][i],
        unit_price: price,
        quantity: 1,
        bundle_id: i < 2 ? "computer" : "core",
        discount_percent: i === 2 ? 10 : 0,
        show_component_price: i === 2,
      }));
      const payload = {
        title: "Custom computer",
        currency: "PLN",
        company_id: company.id,
        contact_id: contact.id,
        line_items: items,
        discount_type: "percent",
        discount_value: 10,
        document: { pricing_groups: groups, language: "en" },
      };
      const q = (await ok("/quotes", "POST", payload)).quote;
      assert.equal(Number(q.total), 617.31);
      const stored = await ok("/quotes/" + q.id);
      assert.equal(stored.lineItems[2].show_component_price, true);
      assert.equal(
        stored.quote.document.pricing_groups[1].parent_id,
        "computer",
      );
      const template = (
        await ok("/quote-templates", "POST", {
          name: "Computer template",
          content: payload,
        })
      ).template;
      assert.equal(template.content.document.pricing_groups.length, 2);
      assert.equal(template.content.line_items[2].show_component_price, true);
      assert.equal(
        (await ok("/quote-templates", "GET", undefined, 1)).templates.length,
        0,
      );
      assert.equal(
        (await call("/quotes/" + q.id, "GET", undefined, 3)).status,
        404,
      );
      assert.equal(
        (
          await call(
            "/commercial/quotes/" + q.id + "/margins",
            "GET",
            undefined,
            1,
          )
        ).status,
        403,
      );
      const order = (await ok("/operations/orders", "POST", { quote_id: q.id }))
        .order;
      assert.equal(Number(order.total), 617.31);
      assert.equal(order.pricing_groups.length, 2);
      assert.equal(order.items[2].show_component_price, true);
      const edited = (
        await ok("/operations/orders/" + order.id, "PUT", {
          notes: "Ready to deliver",
        })
      ).order;
      assert.deepEqual(edited.pricing_groups, order.pricing_groups);
      assert.equal(Number(edited.total), 617.31);
      const invoice = await ok(
        "/communications/invoice-provider/orders/" + order.id + "/preview",
        "POST",
        { tax_rate: 23 },
      );
      assert.deepEqual(
        invoice.invoice.positions.map((p) => Number(p.total_price_net)),
        [85.5, 85.5, 138.51, 307.8],
      );
      assert.equal(
        invoice.invoice.positions.reduce(
          (s, p) => s + Math.round(Number(p.total_price_net) * 100),
          0,
        ),
        61731,
      );
      assert.equal(
        (await call("/commercial/orders/" + order.id + "/confirmation.pdf"))
          .status,
        200,
      );
      assert.equal(
        (await call("/quote-templates/preview", "POST", payload)).status,
        200,
      );
      const create = async (title, status, value, currency = "PLN", u = 0) => {
        const d = (
          await ok(
            "/deals",
            "POST",
            {
              title,
              status,
              value,
              currency,
              source: "Website",
              lost_reason: status === "lost" ? "Price" : "",
            },
            u,
          )
        ).deal;
        await f.db.query(
          "UPDATE deals SET created_at='2026-09-01',closed_at='2026-10-10T12:00:00Z' WHERE id=$1",
          [d.id],
        );
        return d;
      };
      const won = await create("Won computer", "won", 5000);
      await create("Lost sensor", "lost", 3000);
      await create("USD result", "won", 9000, "USD");
      await create("Other workspace secret", "won", 999999, "PLN", 3);
      const deleted = await create("Deleted result", "won", 7777);
      await f.db.query("UPDATE deals SET deleted_at=now() WHERE id=$1", [
        deleted.id,
      ]);
      const old = await create("Old period", "won", 10000);
      await f.db.query("UPDATE deals SET closed_at='2026-09-10' WHERE id=$1", [
        old.id,
      ]);
      const report = await ok("/deal-outcomes?month=2026-10&currency=PLN");
      assert.equal(report.summary.won_count, 1);
      assert.equal(report.summary.lost_count, 1);
      assert.equal(Number(report.summary.won_value), 5000);
      assert.equal(report.deals[0].id, won.id);
      assert.equal(report.reasons[0].label, "Price");
      assert.equal(report.trend.length, 6);
      assert.equal(report.sources[0].won, 1);
      assert.equal(
        (await ok("/deal-outcomes?month=2026-10&currency=PLN&status=lost"))
          .deals[0].title,
        "Lost sensor",
      );
      assert.equal(
        (
          await ok(
            "/deal-outcomes?month=2026-10&currency=PLN",
            undefined,
            undefined,
            0,
            "personal",
          )
        ).total,
        0,
      );
      const foreign = (await ok("/pipelines", "GET", undefined, 3))
        .pipelines[0];
      assert.equal(
        (await call("/deal-outcomes?pipeline_id=" + foreign.id)).status,
        404,
      );
      assert.equal(
        (await call("/deal-outcomes?user_id=" + f.users[3].id)).status,
        400,
      );
      assert.equal((await call("/deal-outcomes?month=2026-99")).status, 400);
    } finally {
      await f.close();
    }
  },
);
