const test = require("node:test");
const assert = require("node:assert/strict");

test(
  "company groups and independent sales pipelines",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { Pool } = require("pg"),
      express = require("express"),
      jwt = require("jsonwebtoken");
    const schema = `klyo_groups_${process.pid}_${Date.now()}`,
      admin = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        ssl: false,
      });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.PGSSL = "false";
    process.env.JWT_SECRET = "groups-test-only";
    const db = require("../server/db");
    let server;
    try {
      await db.init();
      await db.query(
        "INSERT INTO workspaces(id,name,invite_code,is_comped) VALUES(1,'A','A',true),(2,'B','B',true)",
      );
      await db.query(
        "INSERT INTO users(id,workspace_id,name,email,password_hash,role) VALUES(1,1,'Admin','a@example.test','fixture','admin'),(2,2,'Other','b@example.test','fixture','admin')",
      );
      // Realistic pre-upgrade records: no pipeline ID and a custom stage.
      await db.query(
        "INSERT INTO pipeline_stages(workspace_id,name,color,sort_order) VALUES(1,'Custom existing stage','#123456',7)",
      );
      await db.query(
        "INSERT INTO deals(workspace_id,title,stage_id,value,currency,notes) VALUES(1,'Existing sale',1,4500,'PLN','Keep this')",
      );
      await require("../server/migrations/companyPipelines")(db.pool);
      await require("../server/migrations/companyPipelines")(db.pool);
      const app = express();
      app.use(express.json());
      for (const name of [
        "companies",
        "pipelines",
        "deals",
        "sales",
        "billing",
      ])
        app.use("/api/" + name, require("../server/routes/" + name));
      server = await new Promise((resolve) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      });
      async function req(path, method = "GET", body, options = {}) {
        await db.query("UPDATE users SET role=$1 WHERE id=$2", [
          options.role || "admin",
          options.workspace === 2 ? 2 : 1,
        ]);
        const workspace_id = options.workspace || 1,
          token = jwt.sign(
            {
              id: workspace_id === 2 ? 2 : 1,
              workspace_id,
              role: options.role || "admin",
            },
            process.env.JWT_SECRET,
          );
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}/api${path}`,
          {
            method,
            headers: {
              "Content-Type": "application/json",
              ...(options.anonymous
                ? {}
                : { Authorization: "Bearer " + token }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          },
        );
        const raw = await response.text();
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
        return { status: response.status, data };
      }
      let first,
        sensors,
        service,
        parent,
        child,
        grandchild,
        otherCompany,
        sensorStage,
        serviceStage;
      await t.test(
        "migration preserves existing custom stages, deal values and links; no duplicated defaults",
        async () => {
          const rows = (await req("/pipelines")).data.pipelines;
          assert.equal(rows.length, 1);
          first = rows[0];
          assert.equal(first.name, "Sales");
          assert.equal(first.deal_count, 1);
          const old = (await req("/deals/1")).data.deal;
          assert.equal(old.pipeline_id, first.id);
          assert.equal(old.stage_id, 1);
          assert.equal(old.value, "4500.00");
          assert.equal(old.currency, "PLN");
          assert.equal(old.notes, "Keep this");
          const stages = (await req("/deals/stages")).data.stages;
          assert.equal(stages.length, 1);
          assert.equal(stages[0].name, "Custom existing stage");
          assert.equal(stages[0].color, "#123456");
          assert.equal(stages[0].sort_order, 7);
        },
      );
      await t.test(
        "new pipelines clone only stages, have purposes, and remain workspace scoped",
        async () => {
          let result = await req("/pipelines", "POST", {
            name: "Sensors",
            description: "Sensor hardware sales",
            copy_from: first.id,
          });
          assert.equal(result.status, 201, JSON.stringify(result));
          sensors = result.data.pipeline;
          assert.equal(sensors.description, "Sensor hardware sales");
          const sensorStages = (
            await req(`/deals/stages?pipeline_id=${sensors.id}`)
          ).data.stages;
          assert.equal(sensorStages.length, 1);
          sensorStage = sensorStages[0];
          assert.notEqual(sensorStage.id, 1);
          assert.equal(sensorStage.name, "Custom existing stage");
          result = await req("/pipelines", "POST", {
            name: "Services",
            description: "Consulting and delivery",
          });
          assert.equal(result.status, 201);
          service = result.data.pipeline;
          const serviceStages = (
            await req(`/deals/stages?pipeline_id=${service.id}`)
          ).data.stages;
          assert.equal(serviceStages.length, 5);
          serviceStage = serviceStages[0];
          assert.equal(
            (await req("/pipelines", "POST", { name: "sensors" })).status,
            409,
          );
          assert.equal(
            (
              await req(
                `/deals/stages?pipeline_id=${sensors.id}`,
                "GET",
                undefined,
                { workspace: 2 },
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await req(
                `/pipelines/${sensors.id}`,
                "PUT",
                { name: "Other" },
                { workspace: 2 },
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await req(
                "/pipelines",
                "POST",
                { name: "Blocked" },
                { role: "viewer" },
              )
            ).status,
            403,
          );
          assert.equal(
            (await req("/pipelines", "GET", undefined, { anonymous: true }))
              .status,
            401,
          );
          assert.equal(
            (
              await req(
                "/pipelines",
                "POST",
                { name: "Foreign copy", copy_from: sensors.id },
                { workspace: 2 },
              )
            ).status,
            404,
          );
          assert.ok(
            !(
              await req("/pipelines", "GET", undefined, { workspace: 2 })
            ).data.pipelines.some((p) => p.name === "Foreign copy"),
          );
        },
      );
      let dealId;
      await t.test(
        "deal creation, filtered boards and cross-pipeline stages remain consistent",
        async () => {
          const result = await req("/deals", "POST", {
            title: "Temperature sensors",
            pipeline_id: sensors.id,
            stage_id: sensorStage.id,
            value: 2000,
          });
          assert.equal(result.status, 201, JSON.stringify(result));
          dealId = result.data.deal.id;
          assert.equal(
            (await req(`/deals?pipeline_id=${sensors.id}`)).data.deals.length,
            1,
          );
          assert.equal(
            (await req(`/deals?pipeline_id=${service.id}`)).data.deals.length,
            0,
          );
          assert.equal(
            (
              await req(`/deals/${dealId}/stage`, "PATCH", {
                stage_id: serviceStage.id,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await req("/deals", "POST", {
                title: "Wrong stage",
                pipeline_id: service.id,
                stage_id: sensorStage.id,
              })
            ).status,
            400,
          );
          assert.equal(
            (await req(`/pipelines/${sensors.id}`, "DELETE")).status,
            409,
          );
          const moved = await req(`/deals/${dealId}`, "PUT", {
            pipeline_id: service.id,
            stage_id: serviceStage.id,
          });
          assert.equal(moved.status, 200);
          assert.equal(moved.data.deal.pipeline_id, service.id);
          const history = (await req(`/deals/${dealId}/history`)).data.events;
          assert.equal(history.length, 2);
          assert.equal(history[0].from_pipeline, "Sensors");
          assert.equal(history[0].to_pipeline, "Services");
          assert.equal(
            (await req(`/deals?pipeline_id=${sensors.id}`)).data.deals.length,
            0,
          );
          assert.equal(
            (await req(`/deals?pipeline_id=${service.id}`)).data.deals.length,
            1,
          );
          const view = await req("/sales/views", "POST", {
            name: "Service work",
            filters: { pipeline_id: service.id, stage_id: serviceStage.id },
          });
          assert.equal(view.data.view.filters.pipeline_id, String(service.id));
          const summary = (await req("/sales/summary")).data;
          assert.ok(
            summary.stages.some(
              (s) => s.pipeline_name === "Services" && s.count === 1,
            ),
          );
        },
      );
      await t.test(
        "stage operations affect one pipeline and deleted stages leave deals safely unsorted",
        async () => {
          const added = await req("/deals/stages", "POST", {
            name: "Hardware approval",
            pipeline_id: sensors.id,
          });
          assert.equal(added.status, 201);
          assert.equal(added.data.stage.pipeline_id, sensors.id);
          assert.equal(
            (
              await req("/deals/stages/reorder", "PUT", {
                pipeline_id: sensors.id,
                order: [{ id: serviceStage.id, sort_order: 0 }],
              })
            ).status,
            400,
          );
          assert.equal(
            (await req(`/deals/stages/${serviceStage.id}`, "DELETE")).status,
            200,
          );
          const moved = (await req(`/deals/${dealId}`)).data.deal;
          assert.equal(moved.stage_id, null);
          assert.equal(moved.pipeline_id, service.id);
          assert.equal(
            (await req(`/pipelines/${sensors.id}`, "DELETE")).status,
            200,
          );
          assert.equal(
            (await req(`/pipelines/${first.id}`, "DELETE")).status,
            400,
          );
        },
      );
      await t.test(
        "companies form navigable parent / subsidiary / grandchild groups",
        async () => {
          const a = await req("/companies", "POST", { name: "Holding" });
          assert.equal(a.status, 201);
          parent = a.data.company;
          child = (
            await req("/companies", "POST", {
              name: "Branch",
              parent_company_id: parent.id,
            })
          ).data.company;
          grandchild = (
            await req("/companies", "POST", {
              name: "Local office",
              parent_company_id: child.id,
            })
          ).data.company;
          otherCompany = (
            await req(
              "/companies",
              "POST",
              { name: "Other workspace" },
              { workspace: 2 },
            )
          ).data.company;
          const detail = (await req(`/companies/${child.id}`)).data;
          assert.equal(detail.parent.name, "Holding");
          assert.equal(detail.children[0].id, grandchild.id);
          const companies = (await req("/companies")).data.companies;
          assert.equal(
            companies.find((c) => c.id === parent.id).subsidiary_count,
            1,
          );
          assert.equal(
            companies.find((c) => c.id === child.id).parent_company_name,
            "Holding",
          );
          assert.match((await req("/companies/export")).data, /Parent Company/);
        },
      );
      await t.test(
        "company links reject self, descendant cycles, other workspaces and viewers",
        async () => {
          assert.equal(
            (
              await req(`/companies/${parent.id}`, "PUT", {
                name: "Holding",
                parent_company_id: parent.id,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await req(`/companies/${parent.id}`, "PUT", {
                name: "Holding",
                parent_company_id: grandchild.id,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await req(`/companies/${parent.id}`, "PUT", {
                name: "Holding",
                parent_company_id: otherCompany.id,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await req(
                "/companies",
                "POST",
                { name: "Wrong", parent_company_id: parent.id },
                { workspace: 2 },
              )
            ).status,
            400,
          );
          for (const [method, path, body] of [
            ["POST", "/companies", { name: "Blocked" }],
            ["PUT", `/companies/${parent.id}`, { name: "Blocked" }],
            ["DELETE", `/companies/${parent.id}`],
          ])
            assert.equal(
              (await req(path, method, body, { role: "viewer" })).status,
              403,
            );
        },
      );
      await t.test("concurrent reparenting cannot create a cycle", async () => {
        const a = (await req("/companies", "POST", { name: "Concurrent A" }))
            .data.company,
          b = (await req("/companies", "POST", { name: "Concurrent B" })).data
            .company;
        const results = await Promise.all([
          req(`/companies/${a.id}`, "PUT", {
            name: a.name,
            parent_company_id: b.id,
          }),
          req(`/companies/${b.id}`, "PUT", {
            name: b.name,
            parent_company_id: a.id,
          }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
      });
      await t.test(
        "deleting a parent preserves subsidiaries, their descendants and contacts",
        async () => {
          await db.query(
            "INSERT INTO contacts(workspace_id,full_name,company_id) VALUES(1,'Keep contact',$1)",
            [parent.id],
          );
          assert.equal(
            (await req(`/companies/${parent.id}`, "DELETE")).status,
            200,
          );
          const branch = (await req(`/companies/${child.id}`)).data;
          assert.equal(branch.company.parent_company_id, null);
          assert.equal(branch.children[0].id, grandchild.id);
          assert.equal(
            (
              await db.query(
                "SELECT company_id FROM contacts WHERE full_name='Keep contact'",
              )
            ).rows[0].company_id,
            null,
          );
          assert.equal(
            (await req(`/companies/${otherCompany.id}`, "DELETE")).status,
            404,
          );
        },
      );
      await t.test(
        "new workspaces get one usable pipeline and tenant deletion still cascades safely",
        async () => {
          await db.query(
            "INSERT INTO workspaces(id,name,invite_code,is_comped) VALUES(3,'Fresh','C',true)",
          );
          const P = require("../server/services/pipelines");
          const pipeline = await P.transaction(
            db.pool,
            3,
            async (client, first) => first,
          );
          assert.equal(
            (
              await db.query(
                "SELECT COUNT(*)::int AS count FROM pipeline_stages WHERE workspace_id=3 AND pipeline_id=$1",
                [pipeline.id],
              )
            ).rows[0].count,
            5,
          );
          await P.transaction(db.pool, 3, async () => {});
          assert.equal(
            (
              await db.query(
                "SELECT COUNT(*)::int AS count FROM sales_pipelines WHERE workspace_id=3",
              )
            ).rows[0].count,
            1,
          );
          await db.query(
            "INSERT INTO deals(workspace_id,pipeline_id,title,stage_id) SELECT 3,$1,'Temporary',id FROM pipeline_stages WHERE workspace_id=3 LIMIT 1",
            [pipeline.id],
          );
          await db.query("DELETE FROM workspaces WHERE id=3");
          assert.equal(
            (
              await db.query(
                "SELECT COUNT(*)::int AS count FROM deals WHERE workspace_id=3",
              )
            ).rows[0].count,
            0,
          );
        },
      );
      await t.test(
        "public landing prices match the authoritative tier configuration and reveal no billing data",
        async () => {
          const response = await req("/billing/tiers", "GET", undefined, {
            anonymous: true,
          });
          assert.equal(response.status, 200);
          const { TIERS, TIER_ORDER } = require("../server/config/tiers");
          assert.deepEqual(response.data, {
            tiers: TIER_ORDER.map((key) => ({ key, ...TIERS[key] })),
            currency: "USD",
          });
          assert.deepEqual(
            response.data.tiers.map((t) => t.price),
            [9, 29, 79, 199],
          );
          assert.equal(
            (
              await req("/billing/status", "GET", undefined, {
                anonymous: true,
              })
            ).status,
            401,
          );
        },
      );
      await t.test(
        "delete populated and default pipelines preserves every deal, status, links and event history",
        async () => {
          const source = (
            await req("/pipelines", "POST", { name: "Retired sales" })
          ).data.pipeline;
          const target = (
            await req("/pipelines", "POST", { name: "Continuing sales" })
          ).data.pipeline;
          const foreign = (
            await req("/pipelines", "GET", undefined, { workspace: 2 })
          ).data.pipelines[0];
          const sourceStages = (
            await req("/deals/stages?pipeline_id=" + source.id)
          ).data.stages;
          const targetStages = (
            await req("/deals/stages?pipeline_id=" + target.id)
          ).data.stages;
          const unmatched = (
            await req("/deals/stages", "POST", {
              name: "Special old stage",
              pipeline_id: source.id,
            })
          ).data.stage;
          const created = [];
          for (const [status, stage] of [
            ["open", sourceStages[1]],
            ["won", unmatched],
            ["lost", null],
          ]) {
            const response = await req("/deals", "POST", {
              title: "Preserve " + status,
              pipeline_id: source.id,
              stage_id: stage?.id || null,
              status,
              value: 4500,
              currency: "PLN",
              lost_reason: status === "lost" ? "Budget" : null,
              notes: "Keep notes",
            });
            assert.equal(response.status, 201);
            created.push(response.data.deal);
          }
          assert.equal(
            (
              await req(
                "/pipelines/" + source.id,
                "DELETE",
                { move_to_pipeline_id: target.id },
                { role: "viewer" },
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await req("/pipelines/" + source.id, "DELETE", {
                move_to_pipeline_id: foreign.id,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await req("/pipelines/" + source.id, "DELETE", {
                move_to_pipeline_id: source.id,
              })
            ).status,
            400,
          );
          assert.equal(
            (await req("/pipelines/" + source.id, "DELETE")).status,
            409,
          );
          assert.equal(
            (
              await req("/pipelines/" + source.id, "DELETE", {
                move_to_pipeline_id: target.id,
              })
            ).status,
            200,
          );
          for (let i = 0; i < created.length; i++) {
            const original = created[i],
              current = (await req("/deals/" + original.id)).data.deal;
            assert.equal(current.pipeline_id, target.id);
            assert.equal(current.status, original.status);
            assert.equal(current.value, original.value);
            assert.equal(current.notes, "Keep notes");
            assert.equal(current.lost_reason, original.lost_reason);
            assert.equal(
              current.stage_id,
              i === 0
                ? targetStages[1].id
                : i === 1
                  ? targetStages[0].id
                  : null,
            );
            const history = (await req("/deals/" + original.id + "/history"))
              .data.events;
            assert.ok(
              history.some(
                (e) =>
                  e.from_pipeline === source.name &&
                  e.to_pipeline === target.name,
              ),
            );
          }
          assert.equal(
            (
              await db.query(
                "SELECT id FROM pipeline_stages WHERE pipeline_id=$1",
                [source.id],
              )
            ).rows.length,
            0,
          );
          assert.equal(
            (
              await req("/pipelines/" + first.id, "DELETE", {
                move_to_pipeline_id: target.id,
              })
            ).status,
            200,
          );
          assert.equal(
            (await req("/pipelines")).data.pipelines.find((p) => p.is_default)
              .id,
            target.id,
          );
          for (const p of (await req("/pipelines")).data.pipelines.filter(
            (p) => p.id !== target.id,
          ))
            assert.equal(
              (
                await req("/pipelines/" + p.id, "DELETE", {
                  move_to_pipeline_id: target.id,
                })
              ).status,
              200,
            );
          assert.equal(
            (await req("/pipelines/" + target.id, "DELETE")).status,
            400,
          );
          assert.equal((await req("/pipelines")).data.pipelines.length, 1);
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
