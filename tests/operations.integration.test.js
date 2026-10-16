const test = require("node:test"),
  assert = require("node:assert/strict");
test(
  "projects, tasks, equipment custody and fulfillment are scoped and transactional",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { Pool } = require("pg"),
      express = require("express"),
      jwt = require("jsonwebtoken"),
      schema = `klyo_ops_${process.pid}_${Date.now()}`,
      admin = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        ssl: false,
      });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.PGSSL = "false";
    process.env.JWT_SECRET = "operations-test-only";
    const db = require("../server/db");
    let server;
    try {
      await db.init();
      await require("../server/migrations/operations")(db.pool);
      if (
        require("fs").existsSync(
          require("path").join(__dirname, "../server/migrations/commercial.js"),
        )
      )
        await require("../server/migrations/commercial")(db.pool);
      await db.query(
        `INSERT INTO workspaces(id,name,invite_code,is_comped) VALUES(1,'A','A',true),(2,'B','B',true)`,
      );
      await db.query(
        `INSERT INTO users(id,workspace_id,name,email,password_hash,role) VALUES(1,1,'Owner','ops1@example.test','fixture','admin'),(2,2,'Other','ops2@example.test','fixture','admin'),(3,1,'Editor','ops3@example.test','fixture','editor'),(4,1,'Viewer','ops4@example.test','fixture','viewer')`,
      );
      await db.query(
        "SELECT setval(pg_get_serial_sequence('workspaces','id'),(SELECT max(id) FROM workspaces))",
      );
      const app = express();
      app.use(express.json());
      app.use("/api/operations", require("../server/routes/operations"));
      app.use("/api/commercial", require("../server/routes/commercial"));
      app.use((e, req, res, next) =>
        res.status(e.status || 500).json({ error: e.message }),
      );
      server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      const base = `http://127.0.0.1:${server.address().port}/api/operations`;
      async function req(path, method = "GET", body, user = 1, scope = "team") {
        const r = await fetch(base + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization:
              "Bearer " +
              jwt.sign(
                { id: user, workspace_id: user === 2 ? 2 : 1 },
                process.env.JWT_SECRET,
              ),
            "x-klyo-scope": scope,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: r.status, data: await r.json() };
      }
      let project, parent, child, equip, assignment, order;
      await t.test(
        "projects are editable by members, isolated across workspaces and private spaces",
        async () => {
          let r = await req(
            "/projects",
            "POST",
            {
              title: "Energy service",
              kind: "service",
              budget: 10000,
              currency: "PLN",
              assigned_to: 3,
            },
            3,
          );
          assert.equal(r.status, 201, JSON.stringify(r.data));
          project = r.data.project;
          assert.equal((await req("/projects")).data.projects.length, 1);
          assert.equal(
            (await req("/projects/" + project.id, "GET", undefined, 2)).status,
            404,
          );
          assert.equal(
            (
              await req(
                "/projects/" + project.id,
                "GET",
                undefined,
                1,
                "personal",
              )
            ).status,
            404,
          );
          assert.equal(
            (await req("/projects", "POST", { title: "forbidden" }, 4)).status,
            403,
          );
          assert.equal(
            (
              await req("/projects", "POST", {
                title: "foreign",
                assigned_to: 2,
              })
            ).status,
            400,
          );
        },
      );
      await t.test(
        "task hierarchy, milestone, reminder and matrix attributes persist without cycles",
        async () => {
          let r = await req("/tasks", "POST", {
            title: "Commissioning",
            project_id: project.id,
            is_milestone: true,
            due_date: "2030-10-01",
            urgent: true,
            important: true,
          });
          assert.equal(r.status, 201, JSON.stringify(r.data));
          parent = r.data.task;
          r = await req("/tasks", "POST", {
            title: "Measurement",
            parent_id: parent.id,
            assigned_to: 3,
            reminder_at: "2020-01-01T12:00:00Z",
            important: false,
          });
          assert.equal(r.status, 201, JSON.stringify(r.data));
          child = r.data.task;
          assert.equal(child.project_id, project.id);
          assert.equal(child.important, false);
          assert.equal(
            (await req("/tasks/" + parent.id, "PUT", { parent_id: child.id }))
              .status,
            400,
          );
          assert.equal(
            (await req("/reminders", "GET", undefined, 3)).data.reminders
              .length,
            1,
          );
          assert.equal(
            (
              await req(
                "/tasks/" + child.id + "/dismiss-reminder",
                "POST",
                {},
                3,
              )
            ).status,
            200,
          );
          assert.equal(
            (await req("/reminders", "GET", undefined, 3)).data.reminders
              .length,
            0,
          );
          r = await req("/tasks/" + child.id, "PUT", { status: "done" });
          assert.equal(r.data.task.title, "Measurement");
          assert.equal(r.data.task.status, "done");
          assert.equal(
            (
              await req(
                "/tasks",
                "POST",
                { title: "foreign project", project_id: project.id },
                2,
              )
            ).status,
            400,
          );
        },
      );
      await t.test(
        "project resource plans and work logs retain real hours and reject foreign people/tasks",
        async () => {
          let r = await req("/projects/" + project.id + "/resources", "POST", {
            user_id: 3,
            role: "Measurement specialist",
            planned_hours: 24,
          });
          assert.equal(r.status, 201, JSON.stringify(r.data));
          r = await req("/projects/" + project.id + "/time", "POST", {
            user_id: 3,
            task_id: child.id,
            spent_on: "2030-01-02",
            hours: 3.5,
            notes: "Initial site survey",
          });
          assert.equal(r.status, 201, JSON.stringify(r.data));
          assert.equal(r.data.entry.spent_on, "2030-01-02");
          assert.equal(
            (
              await req("/projects/" + project.id + "/time", "POST", {
                user_id: 2,
                spent_on: "2030-01-02",
                hours: 1,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await req("/projects/" + project.id + "/time", "POST", {
                spent_on: "2030-01-02",
                hours: 25,
              })
            ).status,
            400,
          );
          const p = (await req("/projects/" + project.id)).data;
          assert.equal(p.resources.length, 1);
          assert.equal(Number(p.resources[0].planned_hours), 24);
          assert.equal(Number(p.time_entries[0].hours), 3.5);
        },
      );
      await t.test(
        "calibration tasks are created exactly once and rolled forward after calibration",
        async () => {
          let r = await req("/equipment", "POST", {
            name: "Vibration analyzer",
            manufacturer: "Adash",
            model: "VA5",
            serial_number: "SN1",
            last_calibration: "2026-08-31",
            calibration_months: 6,
            assigned_to: 3,
          });
          assert.equal(r.status, 201, JSON.stringify(r.data));
          equip = r.data.equipment;
          assert.equal(
            String(equip.next_calibration).slice(0, 10),
            "2027-02-28",
          );
          await req("/equipment/" + equip.id, "PUT", { notes: "inspection" });
          let rows = (
            await db.query(
              "SELECT * FROM tasks WHERE source_key LIKE 'equipment-calibration:%' AND workspace_id=1",
            )
          ).rows;
          assert.equal(rows.length, 1);
          r = await req("/equipment/" + equip.id, "PUT", {
            last_calibration: "2027-02-28",
          });
          assert.equal(r.status, 200, JSON.stringify(r.data));
          rows = (
            await db.query(
              "SELECT * FROM tasks WHERE source_key LIKE 'equipment-calibration:%' AND workspace_id=1 ORDER BY id",
            )
          ).rows;
          assert.equal(rows.length, 2);
          assert.equal(rows[0].status, "done");
          assert.equal(rows[1].status, "todo");
          assert.equal(
            (
              await req("/equipment", "POST", {
                name: "duplicate",
                serial_number: "sn1",
              })
            ).status,
            409,
          );
        },
      );
      await t.test(
        "concurrent equipment reservations cannot double book and checkout-return is auditable",
        async () => {
          const b = {
            assigned_to: 3,
            project_id: project.id,
            task_id: child.id,
            starts_at: "2030-01-01T10:00:00Z",
            ends_at: "2030-01-02T10:00:00Z",
          };
          const results = await Promise.all([
            req("/equipment/" + equip.id + "/assignments", "POST", b),
            req("/equipment/" + equip.id + "/assignments", "POST", b),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
          assignment = results.find((r) => r.status === 201).data.assignment;
          assert.equal(
            (
              await req(
                "/assignments/" + assignment.id,
                "PATCH",
                { status: "checked_out", condition: "Good" },
                3,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await req("/equipment/" + equip.id + "/assignments", "POST", {
                ...b,
                starts_at: "2031-01-01T10:00:00Z",
                ends_at: "2031-01-02T10:00:00Z",
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await req(
                "/assignments/" + assignment.id,
                "PATCH",
                { status: "returned", condition: "Clean" },
                3,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await req("/assignments/" + assignment.id, "PATCH", {
                status: "returned",
              })
            ).status,
            400,
          );
          const history = (await req("/equipment/" + equip.id + "/history"))
            .data.assignments;
          assert.equal(history[0].return_condition, "Clean");
          assert.ok(history[0].checked_out_at);
          assert.ok(history[0].returned_at);
          assert.equal(
            (
              await req("/equipment/" + equip.id + "/assignments", "POST", {
                ...b,
                assigned_to: 2,
              })
            ).status,
            400,
          );
        },
      );
      await t.test(
        "orders preserve negotiated total, logistics, invoice and payment register",
        async () => {
          let r = await req("/orders", "POST", {
            title: "Supplier instruments",
            kind: "supplier",
            project_id: project.id,
            supplier_name: "Adash",
            currency: "PLN",
            items: [{ name: "VA5", quantity: 2, unit_price: 1000 }],
            total: 1900,
            logistics: { carrier: "dhl", tracking_number: "12345" },
            invoice_number: "FV/1",
            invoice_issued_at: "2030-01-01",
            invoice_due_date: "2030-01-15",
          });
          assert.equal(r.status, 201, JSON.stringify(r.data));
          order = r.data.order;
          assert.equal(Number(order.subtotal), 2000);
          assert.equal(order.items[0].description, "VA5");
          assert.equal(Number(order.total), 1900);
          r = await req("/orders/" + order.id, "PUT", { status: "ordered" });
          assert.equal(r.status, 200, JSON.stringify(r.data));
          assert.equal(Number(r.data.order.total), 1900);
          assert.equal(r.data.order.invoice_number, "FV/1");
          assert.equal(
            (
              await req("/orders/" + order.id, "PUT", {
                paid_at: "2030-01-10T10:00:00Z",
                paid_amount: 100,
              })
            ).status,
            400,
          );
          r = await req("/orders/" + order.id, "PUT", {
            paid_at: "2030-01-10T10:00:00Z",
            paid_amount: 1900,
            delivery_acknowledged_at: "2030-01-08T12:00:00Z",
            delivery_acknowledged_by: "Customer",
            delivery_document_url: "https://example.test/signed.pdf",
            status: "completed",
          });
          assert.equal(r.status, 200, JSON.stringify(r.data));
          assert.equal(
            (await req("/orders/" + order.id, "GET", undefined, 2)).status,
            404,
          );
          assert.equal(
            (
              await req(
                "/orders/" + order.id,
                "PUT",
                { status: "cancelled" },
                4,
              )
            ).status,
            403,
          );
          const detail = (await req("/projects/" + project.id)).data;
          assert.equal(detail.orders.length, 1);
          assert.equal(detail.tasks.length, 2);
          assert.equal(detail.equipment.length, 1);
        },
      );
      await t.test(
        "customer confirmation enforces serials and synchronizes won/paid register colors",
        async () => {
          const product = (
              await db.query(
                "INSERT INTO products(workspace_id,name,unit_price,serial_required) VALUES(1,'Serial sensor',100,true) RETURNING *",
              )
            ).rows[0],
            deal = (
              await db.query(
                "INSERT INTO deals(workspace_id,title,status,value,currency) VALUES(1,'Won sensors','won',180,'PLN') RETURNING *",
              )
            ).rows[0];
          await require("../server/services/commercial").statuses(db, 1);
          const salesCase = (
            await db.query(
              "INSERT INTO commercial_cases(workspace_id,number,title,deal_id,value,currency) VALUES(1,'CASE-001','Sensors',$1,180,'PLN') RETURNING *",
              [deal.id],
            )
          ).rows[0];
          const item = {
            product_id: product.id,
            name: "Sensor kit",
            description: "Precision sensors",
            quantity: 2,
            unit_price: 100,
            discount_percent: 10,
            bundle_id: "kit",
            bundle_name: "Measurement kit",
          };
          let r = await req("/orders", "POST", {
            title: "Sensor delivery",
            deal_id: deal.id,
            case_id: salesCase.id,
            currency: "PLN",
            items: [item],
          });
          assert.equal(r.status, 201, JSON.stringify(r.data));
          const o = r.data.order;
          assert.equal(Number(o.total), 180);
          assert.equal(
            (await req("/orders/" + o.id, "PUT", { status: "confirmed" }))
              .status,
            400,
          );
          r = await req("/orders/" + o.id, "PUT", {
            status: "confirmed",
            items: [{ ...item, serial_numbers: ["SN-A", "SN-B"] }],
          });
          assert.equal(r.status, 200, JSON.stringify(r.data));
          assert.equal(r.data.order.items[0].bundle_name, "Measurement kit");
          let c = (
            await db.query(
              "SELECT s.* FROM commercial_cases c JOIN commercial_statuses s ON s.id=c.status_id WHERE c.id=$1",
              [salesCase.id],
            )
          ).rows[0];
          assert.equal(c.outcome, "won");
          assert.equal(c.paid, false);
          r = await req("/orders/" + o.id, "PUT", {
            paid_amount: 180,
            paid_at: "2030-01-01T12:00:00Z",
          });
          assert.equal(r.status, 200, JSON.stringify(r.data));
          c = (
            await db.query(
              "SELECT s.* FROM commercial_cases c JOIN commercial_statuses s ON s.id=c.status_id WHERE c.id=$1",
              [salesCase.id],
            )
          ).rows[0];
          assert.equal(c.paid, true);
          const confirmation = {
            layout: "executive",
            language: "en",
            accent: "#123456",
            seller: {
              name: "Calibration Group",
              details: "Industrial service",
            },
            buyer: { name: "Steel works" },
            scope: "Confirmed measurement kit",
            footer: "Custom confirmation footer",
          };
          r = await req("/orders/" + o.id, "PUT", {
            customer_confirmation: confirmation,
          });
          assert.equal(r.status, 200, JSON.stringify(r.data));
          assert.equal(
            r.data.order.customer_confirmation.footer,
            "Custom confirmation footer",
          );
          assert.equal(r.data.order.customer_confirmation.layout, "executive");
          const token = jwt.sign(
              { id: 1, workspace_id: 1 },
              process.env.JWT_SECRET,
            ),
            response = await fetch(
              `http://127.0.0.1:${server.address().port}/api/commercial/orders/${o.id}/confirmation.pdf`,
              { headers: { Authorization: "Bearer " + token } },
            );
          assert.equal(response.status, 200);
          const bytes = Buffer.from(await response.arrayBuffer());
          assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
          require("fs").writeFileSync(
            require("node:path").join(
              require("node:os").tmpdir(),
              "klyo-customer-confirmation-test.pdf",
            ),
            bytes,
          );
        },
      );
      await t.test(
        "serial allocation is unique across concurrent confirmed customer orders and released on cancellation",
        async () => {
          const product = (
              await db.query(
                "INSERT INTO products(workspace_id,name,unit_price,serial_required) VALUES(1,'Physical analyzer',100,true) RETURNING *",
              )
            ).rows[0],
            body = {
              title: "Analyzer",
              kind: "customer",
              status: "confirmed",
              items: [
                {
                  product_id: product.id,
                  name: "Analyzer",
                  quantity: 1,
                  unit_price: 100,
                  serial_numbers: ["PHYSICAL-1"],
                },
              ],
            },
            results = await Promise.all([
              req("/orders", "POST", body),
              req("/orders", "POST", body),
            ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
          const first = results.find((r) => r.status === 201).data.order;
          assert.equal(
            (
              await req("/orders/" + first.id, "PUT", {
                notes: "Keep allocation",
              })
            ).status,
            200,
          );
          assert.equal(
            Number(
              (
                await db.query(
                  "SELECT count(*) FROM product_serial_allocations WHERE order_id=$1",
                  [first.id],
                )
              ).rows[0].count,
            ),
            1,
          );
          assert.equal(
            (await req("/orders/" + first.id, "PUT", { status: "cancelled" }))
              .status,
            200,
          );
          assert.equal((await req("/orders", "POST", body)).status, 201);
        },
      );
      await t.test(
        "source quote tax is excluded from the net order total to avoid applying VAT twice",
        async () => {
          const c = (
              await db.query(
                "INSERT INTO contacts(workspace_id,full_name) VALUES(1,'Quote buyer') RETURNING id",
              )
            ).rows[0],
            q = (
              await db.query(
                "INSERT INTO quotes(workspace_id,contact_id,title,currency,subtotal,total,tax_total,tax_rate) VALUES(1,$1,'Taxed quote','PLN',100,123,23,23) RETURNING id",
                [c.id],
              )
            ).rows[0];
          await db.query(
            "INSERT INTO quote_line_items(quote_id,description,quantity,unit_price,line_total) VALUES($1,'Service',1,100,100)",
            [q.id],
          );
          const r = await req("/orders", "POST", { quote_id: q.id });
          assert.equal(r.status, 201, JSON.stringify(r.data));
          assert.equal(Number(r.data.order.total), 100);
          assert.equal(r.data.order.items[0].description, "Service");
        },
      );
      await t.test(
        "invoiced or uncertain orders lock financial items and buyer while keeping logistics editable",
        async () => {
          let r = await req("/orders", "POST", {
            title: "Invoice snapshot",
            kind: "customer",
            currency: "PLN",
            items: [{ name: "Service", quantity: 1, unit_price: 500 }],
          });
          assert.equal(r.status, 201, JSON.stringify(r.data));
          const o = r.data.order;
          await db.query(
            "INSERT INTO invoice_provider_links(order_id,workspace_id,provider_subdomain,external_ref,status) VALUES($1,1,'fixture',$2,'needs_reconciliation')",
            [o.id, "test-order-" + o.id],
          );
          assert.equal(
            (await req("/orders/" + o.id, "PUT", { total: 400 })).status,
            409,
          );
          assert.equal(
            (await req("/orders/" + o.id, "PUT", { currency: "EUR" })).status,
            409,
          );
          assert.equal(
            (
              await req("/orders/" + o.id, "PUT", {
                items: [
                  { name: "Changed service", quantity: 1, unit_price: 500 },
                ],
              })
            ).status,
            409,
          );
          r = await req("/orders/" + o.id, "PUT", {
            logistics: { carrier: "dhl", tracking_number: "TRACK-1" },
            notes: "Delivery information",
          });
          assert.equal(r.status, 200, JSON.stringify(r.data));
          assert.equal(r.data.order.logistics.tracking_number, "TRACK-1");
        },
      );
      await t.test(
        "project documentation and protocol PDF are real exports with scoped access",
        async () => {
          let r = await req("/projects/" + project.id + "/notes", "POST", {
            title: "Acceptance conditions",
            kind: "protocol",
            body: "Measurements approved by customer.",
            document_url: "https://example.test/acceptance.pdf",
          });
          assert.equal(r.status, 201, JSON.stringify(r.data));
          assert.equal(
            (
              await req("/projects/" + project.id + "/notes", "POST", {
                title: "unsafe",
                document_url: "javascript:alert(1)",
              })
            ).status,
            400,
          );
          const token = jwt.sign(
              { id: 1, workspace_id: 1 },
              process.env.JWT_SECRET,
            ),
            pdf = await fetch(
              base + "/projects/" + project.id + "/protocol.pdf",
              { headers: { Authorization: "Bearer " + token } },
            );
          assert.equal(pdf.status, 200);
          assert.equal(pdf.headers.get("content-type"), "application/pdf");
          const bytes = Buffer.from(await pdf.arrayBuffer());
          assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
          require("fs").writeFileSync(
            require("node:path").join(
              require("node:os").tmpdir(),
              "klyo-project-protocol-test.pdf",
            ),
            bytes,
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
