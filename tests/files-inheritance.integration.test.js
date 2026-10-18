const test = require("node:test");
const assert = require("node:assert/strict");
test(
  "record files inherit through deal/company/contact/project without crossing workspace or unrelated contacts",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const { Pool } = require("pg"),
      express = require("express"),
      jwt = require("jsonwebtoken"),
      schema = `klyo_file_links_${process.pid}_${Date.now()}`,
      admin = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        ssl: false,
      });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const u = new URL(process.env.TEST_DATABASE_URL);
    u.searchParams.set("options", `-c search_path=${schema}`);
    Object.assign(process.env, {
      DATABASE_URL: u.toString(),
      PGSSL: "false",
      JWT_SECRET: "file-inheritance-test",
    });
    const db = require("../server/db");
    let server;
    try {
      await db.init();
    await db.query("ALTER TABLE users ALTER COLUMN mfa_enabled SET DEFAULT true");
      const w = (
          await db.query(
            "INSERT INTO workspaces(name,invite_code,is_comped) VALUES('Files','files',true) RETURNING id",
          )
        ).rows[0].id,
        other = (
          await db.query(
            "INSERT INTO workspaces(name,invite_code,is_comped) VALUES('Other','other',true) RETURNING id",
          )
        ).rows[0].id,
        user = (
          await db.query(
            "INSERT INTO users(workspace_id,name,email,password_hash,role) VALUES($1,'Owner','files@example.test','fixture','admin') RETURNING *",
            [w],
          )
        ).rows[0];
      await db.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
        user.id,
        w,
      ]);
      const company = (
          await db.query(
            "INSERT INTO companies(workspace_id,name) VALUES($1,'Steel works') RETURNING id",
            [w],
          )
        ).rows[0].id,
        contact = (
          await db.query(
            "INSERT INTO contacts(workspace_id,company_id,full_name) VALUES($1,$2,'Assigned person') RETURNING id",
            [w, company],
          )
        ).rows[0].id,
        unrelated = (
          await db.query(
            "INSERT INTO contacts(workspace_id,company_id,full_name) VALUES($1,$2,'Another person') RETURNING id",
            [w, company],
          )
        ).rows[0].id,
        deal = (
          await db.query(
            "INSERT INTO deals(workspace_id,company_id,contact_id,title) VALUES($1,$2,$3,'Measurement') RETURNING id",
            [w, company, contact],
          )
        ).rows[0].id,
        project = (
          await db.query(
            "INSERT INTO projects(workspace_id,company_id,contact_id,deal_id,title) VALUES($1,$2,$3,$4,'Delivery') RETURNING id",
            [w, company, contact, deal],
          )
        ).rows[0].id,
        order = (
          await db.query(
            "INSERT INTO sales_orders(workspace_id,company_id,contact_id,deal_id,project_id,number,title) VALUES($1,$2,$3,$4,$5,'O1','Order') RETURNING id",
            [w, company, contact, deal, project],
          )
        ).rows[0].id;
      for (const [wid, entity, id, name] of [
        [w, "company", company, "company.pdf"],
        [w, "deal", deal, "deal.pdf"],
        [w, "project", project, "project.pdf"],
        [w, "order", order, "order.pdf"],
        [w, "contact", unrelated, "other-person.pdf"],
        [other, "deal", deal, "foreign.pdf"],
      ])
        await db.query(
          "INSERT INTO workspace_files(workspace_id,drive_id,item_id,name,size,entity,entity_id) VALUES($1,'drive',$2,$2,100,$3,$4)",
          [wid, name, entity, id],
        );
      const app = express();
      app.use("/api/sharepoint", require("../server/routes/sharepoint"));
      server = await new Promise((r) => {
        const s = app.listen(0, "127.0.0.1", () => r(s));
      });
      const token = jwt.sign(
        { sms_verified: true, id: user.id, workspace_id: w },
        process.env.JWT_SECRET,
      );
      async function files(entity, id, scope = "team") {
        const res = await fetch(
          `http://127.0.0.1:${server.address().port}/api/sharepoint/files?entity=${entity}&entity_id=${id}`,
          {
            headers: {
              Authorization: "Bearer " + token,
              "X-Klyo-Scope": scope,
            },
          },
        );
        return { status: res.status, data: await res.json() };
      }
      let r = await files("company", company);
      assert.equal(r.status, 200);
      assert.deepEqual(
        r.data.files.map((f) => f.name).sort(),
        [
          "company.pdf",
          "deal.pdf",
          "other-person.pdf",
          "project.pdf",
          "order.pdf",
        ].sort(),
      );
      r = await files("contact", contact);
      assert.deepEqual(
        r.data.files.map((f) => f.name).sort(),
        ["deal.pdf", "project.pdf", "order.pdf"].sort(),
      );
      r = await files("contact", unrelated);
      assert.deepEqual(
        r.data.files.map((f) => f.name),
        ["other-person.pdf"],
      );
      r = await files("deal", deal);
      assert.deepEqual(
        r.data.files.map((f) => f.name).sort(),
        ["deal.pdf", "project.pdf", "order.pdf"].sort(),
      );
      r = await files("project", project);
      assert.deepEqual(
        r.data.files.map((f) => f.name).sort(),
        ["project.pdf", "order.pdf"].sort(),
      );
      assert.equal((await files("deal", deal, "personal")).status, 400);
    } finally {
      if (server) await new Promise((r) => server.close(r));
      await db.pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
