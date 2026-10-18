const test = require("node:test"),
  assert = require("node:assert/strict"),
  { normalizeDeal } = require("../server/services/dealWorkspace");
test("probability is bounded, cents-safe and defaults unknown forecasts to zero", () => {
  assert.equal(normalizeDeal({ title: "Sensor" }).probability, 0);
  assert.equal(
    normalizeDeal({ title: "Sensor", probability: "37.25" }).probability,
    37.25,
  );
  for (const probability of [-1, 101, "foo", Infinity, 0.001])
    assert.throws(() => normalizeDeal({ title: "Sensor", probability }), {
      status: 400,
    });
});
test(
  "analytics targets, monthly results, forecast, activity and trash remain scoped",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { Pool } = require("pg"),
      express = require("express"),
      jwt = require("jsonwebtoken"),
      schema = "klyo_analytics_" + process.pid + "_" + Date.now(),
      admin = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        ssl: false,
      });
    await admin.query("CREATE SCHEMA " + schema);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", "-c search_path=" + schema);
    Object.assign(process.env, {
      DATABASE_URL: url.toString(),
      PGSSL: "false",
      JWT_SECRET: "analytics-tests-only",
    });
    const db = require("../server/db");
    let server;
    try {
      await db.init();
    await db.query("ALTER TABLE users ALTER COLUMN mfa_enabled SET DEFAULT true");
      await db.init();
    await db.query("ALTER TABLE users ALTER COLUMN mfa_enabled SET DEFAULT true");
      const workspaces = [];
      for (const name of ["Team", "Other"])
        workspaces.push(
          (
            await db.query(
              "INSERT INTO workspaces(name,invite_code,is_comped,default_currency) VALUES($1,$1,true,'PLN') RETURNING id",
              [name],
            )
          ).rows[0].id,
        );
      const users = [];
      for (const [wid, name, role] of [
        [workspaces[0], "Owner", "admin"],
        [workspaces[0], "Member", "member"],
        [workspaces[0], "Viewer", "viewer"],
        [workspaces[1], "Other", "admin"],
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
        workspaces[0],
      ]);
      const app = express();
      app.use(express.json());
      for (const name of ["analytics", "deals", "spaces", "sales"])
        app.use("/api/" + name, require("../server/routes/" + name));
      server = await new Promise((r) => {
        const s = app.listen(0, "127.0.0.1", () => r(s));
      });
      const tokens = users.map((u) =>
        jwt.sign(
          { sms_verified: true, id: u.id, workspace_id: u.workspace_id, role: u.role },
          process.env.JWT_SECRET,
        ),
      );
      async function req(
        route,
        method = "GET",
        body,
        user = 0,
        scope = "team",
      ) {
        const response = await fetch(
          "http://127.0.0.1:" + server.address().port + "/api" + route,
          {
            method,
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + tokens[user],
              "X-Klyo-Scope": scope,
              "X-Klyo-Timezone": "Europe/Warsaw",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          },
        );
        return { status: response.status, data: await response.json() };
      }
      function check(r, status) {
        assert.equal(r.status, status, JSON.stringify(r.data));
        return r.data;
      }
      const query = "/analytics?month=2026-10&currency=PLN";
      let open, won, lost;
      await t.test(
        "weighted amounts use configured chance, actual wins use closed date, currencies and trash never mix",
        async () => {
          open = check(
            await req("/deals", "POST", {
              title: "Weighted opportunity",
              value: 10000,
              currency: "PLN",
              probability: 30,
              expected_close_date: "2026-10-20",
              assigned_to: users[1].id,
            }),
            201,
          ).deal;
          won = check(
            await req("/deals", "POST", {
              title: "Won",
              value: 4000,
              currency: "PLN",
              status: "won",
              probability: 15,
              assigned_to: users[1].id,
            }),
            201,
          ).deal;
          lost = check(
            await req("/deals", "POST", {
              title: "Lost",
              value: 2000,
              currency: "PLN",
              status: "lost",
              lost_reason: "Budget",
              probability: 80,
            }),
            201,
          ).deal;
          await db.query(
            "UPDATE deals SET closed_at='2026-10-10T12:00:00Z' WHERE id=ANY($1::int[])",
            [[won.id, lost.id]],
          );
          check(
            await req("/deals", "POST", {
              title: "Foreign currency",
              value: 999999,
              currency: "EUR",
              status: "won",
            }),
            201,
          );
          const report = check(await req(query), 200);
          assert.equal(Number(report.metrics.weighted_forecast), 3000);
          assert.equal(Number(report.metrics.won_value), 4000);
          assert.equal(Number(report.metrics.lost_value), 2000);
          assert.equal(report.metrics.weighted_outlook, 7000);
          assert.equal(report.metrics.win_rate, 50);
          assert.equal(report.months.length, 6);
          assert.equal(
            report.stages.reduce((sum, r) => sum + Number(r.weighted_value), 0),
            3000,
          );
          assert.equal(Number(report.months.at(-1).won_value), 4000);
          assert.equal(
            Number(
              check(await req("/deals/" + won.id), 200).deal
                .effective_probability,
            ),
            100,
          );
          assert.equal(
            Number(
              check(await req("/deals/" + lost.id), 200).deal.weighted_value,
            ),
            0,
          );
          assert.equal(
            Number(
              check(await req(query + "&user_id=" + users[1].id), 200).metrics
                .won_value,
            ),
            4000,
          );
          check(await req(query + "&user_id=" + users[3].id), 400);
          check(await req("/deals/" + open.id, "DELETE"), 200);
          assert.equal(
            Number(check(await req(query), 200).metrics.weighted_forecast),
            0,
          );
          check(await req("/deals/" + open.id), 404);
          check(
            await req("/deals/" + open.id, "PUT", {
              title: "Cannot edit trash",
            }),
            404,
          );
          assert.equal(
            check(await req("/deals?status=deleted"), 200).deals.length,
            1,
          );
          assert.equal(
            check(await req("/deals?status=all"), 200).deals.some(
              (d) => d.id === open.id,
            ),
            false,
          );
          check(await req("/deals/" + open.id + "/restore", "POST", {}), 200);
          assert.equal(
            Number(check(await req(query), 200).metrics.weighted_forecast),
            3000,
          );
        },
      );
      await t.test(
        "targets have owner-only writes, separate personal/team and user goals, zero target is not infinity",
        async () => {
          check(
            await req("/analytics/target", "PUT", {
              month: "2026-10",
              currency: "PLN",
              amount: 10000,
            }),
            200,
          );
          let report = check(await req(query), 200);
          assert.equal(report.metrics.goal, 10000);
          assert.equal(report.metrics.goal_attainment, 40);
          assert.equal(report.metrics.gap_to_goal, 6000);
          check(
            await req("/analytics/target", "PUT", {
              month: "2026-10",
              currency: "PLN",
              amount: 6000,
              user_id: users[1].id,
            }),
            200,
          );
          assert.equal(
            check(await req(query + "&user_id=" + users[1].id), 200).metrics
              .goal,
            6000,
          );
          assert.equal(check(await req(query), 200).metrics.goal, 10000);
          check(
            await req(
              "/analytics/target",
              "PUT",
              { month: "2026-10", currency: "PLN", amount: 999 },
              1,
            ),
            403,
          );
          check(
            await req(
              "/analytics/target",
              "PUT",
              { month: "2026-10", currency: "PLN", amount: 999 },
              2,
            ),
            403,
          );
          check(
            await req("/analytics/target", "PUT", {
              month: "2026-10",
              currency: "PLN",
              amount: 0,
            }),
            200,
          );
          report = check(await req(query), 200);
          assert.equal(report.metrics.goal_attainment, null);
          assert.equal(
            check(await req(query, "GET", undefined, 0, "personal"), 200)
              .metrics.goal,
            null,
          );
          check(
            await req(
              "/analytics/target",
              "PUT",
              { month: "2026-10", currency: "PLN", amount: 500 },
              0,
              "personal",
            ),
            200,
          );
          assert.equal(
            check(await req(query, "GET", undefined, 0, "personal"), 200)
              .metrics.goal,
            500,
          );
          check(await req("/analytics?month=bad"), 400);
          check(await req("/analytics?month=2026-10&currency=BAD"), 400);
          check(
            await req("/analytics/target", "PUT", {
              month: "2026-10",
              currency: "PLN",
              amount: -1,
            }),
            400,
          );
          check(
            await req("/analytics/target?month=2026-10&currency=PLN", "DELETE"),
            200,
          );
          assert.equal(check(await req(query), 200).metrics.goal, null);
        },
      );
      for (const wid of workspaces)
        await db.query(
          "INSERT INTO contacts(workspace_id,full_name) VALUES($1,'Activity test')",
          [wid],
        );
      await t.test(
        "activity counts only scoped logged events and is not exposed to nonowners",
        async () => {
          for (const [wid, uid, type] of [
            [workspaces[0], users[1].id, "meeting_logged"],
            [workspaces[0], users[1].id, "call_logged"],
            [workspaces[0], users[0].id, "quote_sent"],
            [workspaces[1], users[3].id, "meeting_logged"],
          ])
            await db.query(
              "INSERT INTO activity_log(workspace_id,user_id,contact_id,type,description,created_at) VALUES($1,$2,(SELECT id FROM contacts WHERE workspace_id=$1 LIMIT 1),$3,'Test','2026-10-10T12:00:00Z')",
              [wid, uid, type],
            );
          const report = check(await req(query), 200);
          assert.equal(
            report.activity.find((r) => r.id === users[1].id).meetings,
            1,
          );
          assert.equal(
            report.activity.find((r) => r.id === users[1].id).calls,
            1,
          );
          assert.equal(
            report.activity.some((r) => r.id === users[3].id),
            false,
          );
          assert.deepEqual(
            check(await req(query, "GET", undefined, 1), 200).activity,
            [],
          );
          assert.equal(
            check(await req(query, "GET", undefined, 3), 200).metrics.goal,
            null,
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
