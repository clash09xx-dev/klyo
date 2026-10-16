const test = require("node:test"),
  assert = require("node:assert/strict");
test(
  "completion: won projects, required dates, finance, insights, tracking and shared mailboxes",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await require("./helpers/calendar-fixture")(),
      { db, req, users, w } = f;
    const ok = (r, status = 200) => {
      assert.equal(r.status, status, JSON.stringify(r.data));
      return r.data;
    };
    let deal, project;
    try {
      await t.test(
        "future wins create one project across repeat wins; owner can disable; existing projects are reused",
        async () => {
          deal = ok(
            await req("/deals", "POST", {
              title: "Sensor delivery",
              value: 2000,
              currency: "PLN",
              source: "Referral",
              probability: 75,
              expected_close_date: "2026-10-27",
            }),
            201,
          ).deal;
          ok(await req("/deals/" + deal.id, "PUT", { status: "won" }));
          project = (
            await db.query(
              "SELECT * FROM projects WHERE workspace_id=$1 AND deal_id=$2",
              [w, deal.id],
            )
          ).rows[0];
          assert.ok(project.auto_created);
          assert.equal(Number(project.budget), 2000);
          ok(await req("/deals/" + deal.id, "PUT", { status: "open" }));
          ok(await req("/deals/" + deal.id, "PUT", { status: "won" }));
          assert.equal(
            (
              await db.query("SELECT count(*) FROM projects WHERE deal_id=$1", [
                deal.id,
              ])
            ).rows[0].count,
            "1",
          );
          assert.equal(
            ok(
              await req("/operations/projects", "POST", {
                title: "Duplicate attempt",
                currency: "PLN",
                deal_id: deal.id,
              }),
              201,
            ).project.id,
            project.id,
          );
          ok(
            await req(
              "/operations/settings",
              "PUT",
              { auto_project_on_win: false },
              1,
            ),
            403,
          );
          ok(
            await req("/operations/settings", "PUT", {
              auto_project_on_win: false,
            }),
          );
          const second = ok(
            await req("/deals", "POST", {
              title: "Won without delivery",
              status: "won",
              currency: "PLN",
            }),
            201,
          ).deal;
          assert.equal(
            (
              await db.query("SELECT count(*) FROM projects WHERE deal_id=$1", [
                second.id,
              ])
            ).rows[0].count,
            "0",
          );
          ok(
            await req("/operations/settings", "PUT", {
              auto_project_on_win: true,
            }),
          );
        },
      );
      await t.test(
        "task creation requires a real due date through both APIs, and dates cannot be cleared",
        async () => {
          for (const path of ["/tasks", "/operations/tasks"]) {
            ok(await req(path, "POST", { title: "Missing date" }), 400);
            const task = ok(
              await req(path, "POST", {
                title: "Dated task",
                due_date: "2030-01-02",
              }),
              201,
            ).task;
            ok(await req(path + "/" + task.id, "PUT", { due_date: "" }), 400);
          }
          const legacy = (
            await db.query(
              "INSERT INTO tasks(workspace_id,title) VALUES($1,'Legacy undated') RETURNING id",
              [w],
            )
          ).rows[0];
          ok(
            await req("/tasks/" + legacy.id + "/status", "PATCH", {
              status: "done",
            }),
          );
        },
      );
      await t.test(
        "project finance respects currency, cost snapshots, missing costs and owner-only access",
        async () => {
          ok(
            await req(
              "/operations/projects/" + project.id + "/resources",
              "POST",
              { user_id: users[0].id, planned_hours: 8, hourly_cost: 100 },
            ),
            201,
          );
          const time = ok(
            await req("/operations/projects/" + project.id + "/time", "POST", {
              hours: 2,
              spent_on: "2026-10-16",
            }),
            201,
          ).entry;
          assert.equal(Number(time.hourly_cost), 100);
          ok(
            await req(
              "/operations/projects/" + project.id + "/resources",
              "POST",
              { user_id: users[0].id, planned_hours: 8, hourly_cost: 500 },
            ),
            201,
          );
          for (const [kind, total, paid] of [
            ["customer", 2000, 500],
            ["supplier", 600, 100],
            ["internal", 600, 0],
          ])
            ok(
              await req("/operations/orders", "POST", {
                title: kind,
                kind,
                status: "confirmed",
                currency: "PLN",
                project_id: project.id,
                total,
                paid_amount: paid,
                items: [{ description: kind, quantity: 1, unit_price: total }],
              }),
              201,
            );
          ok(
            await req(
              "/operations/projects/" + project.id + "/expenses",
              "POST",
              {
                description: "Travel",
                amount: 100,
                currency: "PLN",
                spent_on: "2026-10-16",
              },
            ),
            201,
          );
          ok(
            await req(
              "/operations/projects/" + project.id + "/expenses",
              "POST",
              {
                description: "Euro expense",
                amount: 50,
                currency: "EUR",
                spent_on: "2026-10-16",
              },
            ),
            201,
          );
          let fin = ok(
              await req("/operations/projects/" + project.id + "/finance"),
            ),
            pln = fin.groups.find((g) => g.currency === "PLN");
          ok(
            await req("/operations/projects/" + project.id, "PUT", {
              currency: "EUR",
            }),
            400,
          );
          assert.equal(pln.labor, 200);
          assert.equal(pln.purchases, 600);
          assert.equal(pln.profit, 1100);
          assert.equal(pln.outstanding, 1500);
          assert.equal(
            fin.groups.find((g) => g.currency === "EUR").expenses,
            50,
          );
          ok(
            await req(
              "/operations/projects/" + project.id + "/finance",
              "GET",
              undefined,
              1,
            ),
            403,
          );
          const shared = ok(
            await req(
              "/operations/projects/" + project.id,
              "GET",
              undefined,
              1,
            ),
          );
          assert.equal(shared.resources[0].hourly_cost, undefined);
          assert.equal(shared.time_entries[0].hourly_cost, undefined);
          ok(
            await req(
              "/operations/projects/" + project.id + "/time",
              "POST",
              { hours: 1, spent_on: "2026-10-16", hourly_cost: 1 },
              1,
            ),
            403,
          );
          ok(
            await req(
              "/operations/projects/" +
                project.id +
                "/time/" +
                time.id +
                "/cost",
              "PATCH",
              { hourly_cost: null },
            ),
          );
          fin = ok(
            await req("/operations/projects/" + project.id + "/finance"),
          );
          pln = fin.groups.find((g) => g.currency === "PLN");
          assert.equal(pln.profit, null);
          assert.equal(pln.unpriced_hours, 2);
        },
      );
      await t.test(
        "dashboard reports real source values, daily counts, forecast, risk and configured targets with scoped filters",
        async () => {
          ok(
            await req("/analytics/target", "PUT", {
              month: "2026-10",
              currency: "PLN",
              amount: 10000,
            }),
          );
          ok(
            await req("/analytics/benchmarks", "PUT", {
              month: "2026-10",
              currency: "PLN",
              pipeline_goal: 4000,
              meeting_goal: 20,
              win_rate_goal: 60,
              stale_days: 7,
            }),
          );
          await db.query(
            "UPDATE deals SET created_at='2026-10-02T10:00Z',closed_at='2026-10-15T10:00Z' WHERE id=$1",
            [deal.id],
          );
          const pending = ok(
            await req("/deals", "POST", {
              title: "Needs attention",
              currency: "PLN",
              value: 400,
              probability: 50,
              source: "Website",
              expected_close_date: "2026-10-10",
            }),
            201,
          ).deal;
          const r = ok(
            await req(
              "/analytics?month=2026-10&currency=PLN&pipeline_id=" +
                deal.pipeline_id,
            ),
          );
          assert.equal(r.extended.benchmark.meeting_goal, 20);
          assert.equal(r.extended.daily.length, 31);
          assert.ok(
            r.extended.sources.some(
              (s) => s.source === "Referral" && Number(s.value) === 2000,
            ),
          );
          assert.ok(r.extended.risks.some((s) => s.id === pending.id));
          assert.equal(r.extended.forecast.length, 6);
          assert.ok(r.extended.leaderboard.length);
          ok(
            await req("/analytics/benchmarks", "PUT", {
              month: "2026-10",
              currency: "PLN",
              stale_days: 0,
            }),
            400,
          );
          ok(
            await req(
              "/analytics/benchmarks",
              "PUT",
              { month: "2026-10", currency: "PLN" },
              1,
            ),
            403,
          );
          const other = (
            await db.query(
              "INSERT INTO sales_pipelines(workspace_id,name) VALUES($1,'Other tenant') RETURNING id",
              [f.other],
            )
          ).rows[0];
          ok(
            await req("/analytics?month=2026-10&pipeline_id=" + other.id),
            400,
          );
        },
      );
      await t.test(
        "DHL tracking is encrypted, scoped, cached, real-response based and never implies signed customer acceptance",
        async () => {
          const order = ok(
            await req("/operations/orders", "POST", {
              title: "Tracked delivery",
              kind: "customer",
              currency: "PLN",
              logistics: { carrier: "dhl", tracking_number: "1234567890" },
              items: [{ description: "Sensor", quantity: 1, unit_price: 100 }],
            }),
            201,
          ).order;
          ok(
            await req("/operations/tracking/connection", "PUT", {
              api_key: "tracking-test-key",
            }),
          );
          assert.doesNotMatch(
            JSON.stringify(ok(await req("/operations/tracking/status"))),
            /tracking-test-key/,
          );
          const original = global.fetch;
          let calls = 0;
          try {
            global.fetch = async (url, opts) => {
              if (String(url).startsWith("https://api-eu.dhl.com/")) {
                calls++;
                assert.equal(opts.headers["DHL-API-Key"], "tracking-test-key");
                return {
                  ok: true,
                  json: async () => ({
                    shipments: [
                      {
                        id: "1234567890",
                        status: {
                          statusCode: "delivered",
                          description: "Delivered",
                        },
                        events: [
                          { timestamp: "2026-10-16", description: "Delivered" },
                        ],
                      },
                    ],
                  }),
                };
              }
              return original(url, opts);
            };
            const r = ok(
              await req(
                "/operations/orders/" + order.id + "/tracking/refresh",
                "POST",
                {},
              ),
            );
            assert.equal(r.snapshot.status.status, "delivered");
            ok(
              await req(
                "/operations/orders/" + order.id + "/tracking/refresh",
                "POST",
                {},
              ),
            );
            assert.equal(calls, 1);
            assert.equal(
              ok(await req("/operations/orders/" + order.id)).order
                .delivery_acknowledged_at,
              null,
            );
            ok(
              await req(
                "/operations/orders/" + order.id + "/tracking/refresh",
                "POST",
                {},
                2,
              ),
              403,
            );
          } finally {
            global.fetch = original;
          }
        },
      );
      await t.test(
        "shared mailboxes verify delegated access and restrict Graph continuation to the selected mailbox",
        async () => {
          const C = require("../server/services/communications"),
            S = require("../server/services/sharepoint"),
            original = C.graph;
          const conn = (
            await db.query(
              "INSERT INTO communication_connections(workspace_id,user_id,provider,credentials,account_name,account_id) VALUES($1,$2,'microsoft_mail',$3,'Owner','owner') RETURNING *",
              [w, users[0].id, S.encrypt("mock-cache")],
            )
          ).rows[0];
          try {
            C.graph = async (c, path) => {
              assert.equal(c.mailbox, "info@example.test");
              return { id: "inbox" };
            };
            const r = ok(
              await req("/communications/mail/" + conn.id + "/shared", "POST", {
                mailbox: "info@example.test",
              }),
              201,
            );
            assert.ok(r.connection_id);
            ok(
              await req(
                "/communications/mail/" + conn.id + "/shared",
                "POST",
                { mailbox: "info@example.test" },
                1,
              ),
              404,
            );
            assert.throws(() =>
              C.graphURL(
                "https://graph.microsoft.com/v1.0/users/other@example.test/messages",
                { mailbox: "info@example.test" },
              ),
            );
            assert.match(
              C.graphURL("/v1.0/users/info%40example.test/messages", {
                mailbox: "info@example.test",
              }),
              /graph.microsoft.com/,
            );
          } finally {
            C.graph = original;
          }
        },
      );
    } finally {
      await f.close();
    }
  },
);
