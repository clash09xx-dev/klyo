// Real routes + disposable PostgreSQL. Provider credentials and outbound sends are never used.
const assert = require("node:assert/strict"),
  fs = require("fs"),
  path = require("path"),
  { Pool } = require("pg"),
  express = require("express"),
  jwt = require("jsonwebtoken"),
  { chromium, webkit } = require("playwright");
(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL");
  const schema = `klyo_ops_ui_${process.pid}_${Date.now()}`,
    admin = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      ssl: false,
    });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  Object.assign(process.env, {
    DATABASE_URL: url.toString(),
    PGSSL: "false",
    JWT_SECRET: "operations-ui-only",
    STRIPE_SECRET_KEY: "",
    PLATFORM_ADMIN_EMAIL: "platform-owner@example.test",
  });
  const db = require("../server/db"),
    out =
      process.env.KLYO_QA_SCREENSHOTS ||
      require("node:path").join(
        require("node:os").tmpdir(),
        "klyo-operations-qa",
      );
  fs.mkdirSync(out, { recursive: true });
  let server;
  try {
    await db.init();
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    for (const name of fs
      .readdirSync(path.join(__dirname, "../server/routes"))
      .filter(
        (n) =>
          n.endsWith(".js") &&
          !n.includes(" ") &&
          !["publicQuotes.js", "webhooks.js"].includes(n),
      )
      .map((n) => n.slice(0, -3)))
      app.use("/api/" + name, require("../server/routes/" + name));
    app.use(express.static(path.join(__dirname, "../public")));
    app.get("/app", (req, res) =>
      res.sendFile(path.join(__dirname, "../public/app.html")),
    );
    app.use((e, req, res, next) => {
      console.error(e.message);
      res.status(e.status || 500).json({ error: e.message });
    });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, engine, exe] of [
      ["chromium", chromium, process.env.KLYO_CHROMIUM_PATH],
      ["webkit", webkit, process.env.KLYO_WEBKIT_PATH],
    ]) {
      if (process.env.KLYO_BROWSER && process.env.KLYO_BROWSER !== name)
        continue;
      const ws = (
          await db.query(
            "INSERT INTO workspaces(name,invite_code,is_comped,default_currency) VALUES($1,$2,true,'PLN') RETURNING *",
            ["Operations demo", name],
          )
        ).rows[0],
        user = (
          await db.query(
            "INSERT INTO users(workspace_id,name,email,password_hash,role,language,has_seen_onboarding,terms_accepted_at) VALUES($1,'Demo owner',$2,'fixture','admin','en',true,now()) RETURNING *",
            [ws.id, name + "@ops.test"],
          )
        ).rows[0];
      await db.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
        user.id,
        ws.id,
      ]);
      const token = jwt.sign(
          { id: user.id, workspace_id: ws.id },
          process.env.JWT_SECRET,
        ),
        browser = await engine.launch({ headless: true, executablePath: exe });
      try {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            deviceScaleFactor: 2,
            timezoneId: "Europe/Warsaw",
            reducedMotion: "reduce",
          }),
          page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => {
          errors.push(e.message);
          console.error(e.message);
        });
        page.on("dialog", (d) => d.accept());
        await context.addInitScript(
          ({ token, user }) => {
            if (!localStorage.getItem("klyo_token")) {
              localStorage.setItem("klyo_token", token);
              localStorage.setItem("klyo_user", JSON.stringify(user));
            }
          },
          { token, user },
        );
        await page.goto(base + "/app");
        await page.locator(".nav [data-view=projects]").waitFor();
        await page.locator(".nav [data-view=projects]").click();
        await page.locator("[data-op-new=projects]").click();
        let d = page.getByRole("dialog", { name: "New project", exact: true });
        await d.locator("[name=title]").fill("Power plant service");
        await d.locator("[name=kind]").selectOption("service");
        await d.locator("[name=assigned_to]").selectOption(String(user.id));
        await d.locator("[name=starts_on]").fill("2030-01-01");
        await d.locator("[name=due_date]").fill("2030-06-01");
        await d
          .locator("[name=description]")
          .fill("Scheduled industrial measurements and customer acceptance.");
        await d.locator("[type=submit]").click();
        d = page.getByRole("dialog", {
          name: "Power plant service",
          exact: true,
        });
        await d.waitFor();
        await d.locator("#opProjectTask").click();
        d = page.getByRole("dialog", { name: "New task / milestone" });
        await d.locator("[name=title]").fill("Initial vibration measurements");
        await d.locator("[name=due_date]").fill("2030-01-15");
        await d.locator("[name=urgent]").check();
        await d.locator("[name=is_milestone]").check();
        await d.locator("[type=submit]").click();
        await page
          .getByRole("dialog", { name: "Power plant service", exact: true })
          .waitFor();
        await page.keyboard.press("Escape");
        await page.locator(".nav [data-view=tasks]").click();
        await page.locator("[data-task-mode=matrix]").click();
        await page
          .locator(
            "[data-task-drop=quadrant][data-urgent=true][data-important=true] [data-task]",
          )
          .waitFor();
        await page
          .locator("#tasksView")
          .screenshot({ path: path.join(out, name + "-task-matrix.png") });
        await page.locator("[data-task-mode=kanban]").click();
        const taskCard = page
          .locator("[data-task-drop=todo] [data-task]")
          .filter({ hasText: "Initial vibration measurements" });
        await taskCard.dragTo(page.locator("[data-task-drop=in_progress]"));
        await page
          .locator("[data-task-drop=in_progress] [data-task]")
          .filter({ hasText: "Initial vibration measurements" })
          .waitFor();
        await page.locator(".nav [data-view=equipment]").click();
        await page.locator("[data-op-new=equipment]").click();
        d = page.getByRole("dialog", { name: "New equipment", exact: true });
        await d.locator("[name=name]").fill("Vibration analyzer");
        await d.locator("[name=manufacturer]").fill("Adash");
        await d.locator("[name=model]").fill("VA5");
        await d.locator("[name=serial_number]").fill("VA5-0001");
        await d.locator("[name=last_calibration]").fill("2026-08-31");
        await d.locator("[name=assigned_to]").selectOption(String(user.id));
        await d.locator("[type=submit]").click();
        await page
          .locator("[data-equipment]")
          .filter({ hasText: "Vibration analyzer" })
          .click();
        d = page.getByRole("dialog", {
          name: "Vibration analyzer",
          exact: true,
        });
        await d.locator("#opReserveEquipment").click();
        let reservation = page.getByRole("dialog", {
          name: "Reserve equipment · Vibration analyzer",
        });
        await reservation
          .locator("[name=assigned_to]")
          .selectOption(String(user.id));
        await reservation
          .locator("[name=project_id]")
          .selectOption({ label: "Power plant service" });
        await reservation.locator("[name=starts_at]").fill("2030-01-15T08:00");
        await reservation.locator("[name=ends_at]").fill("2030-01-16T18:00");
        await reservation.locator("[type=submit]").click();
        d = page.getByRole("dialog", {
          name: "Vibration analyzer",
          exact: true,
        });
        await d.locator("[data-action=checked_out]").click();
        let ad = page.getByRole("dialog", { name: "Checked out", exact: true });
        await ad
          .locator("[name=condition]")
          .fill("Good, inspected before departure");
        await ad.locator("[type=submit]").click();
        d = page.getByRole("dialog", {
          name: "Vibration analyzer",
          exact: true,
        });
        await d.locator("[data-action=returned]").waitFor();
        await d.screenshot({
          path: path.join(out, name + "-equipment-custody.png"),
        });
        await page.keyboard.press("Escape");
        await page.locator(".nav [data-view=orders]").click();
        await page.locator("[data-op-new=orders]").click();
        d = page.getByRole("dialog", { name: "New order", exact: true });
        await d.locator("[name=title]").fill("Calibration supplier order");
        await d.locator("[name=kind]").selectOption("supplier");
        await d
          .locator("[name=project_id]")
          .selectOption({ label: "Power plant service" });
        await d.locator("[name=supplier_name]").fill("Adash");
        await d.locator("#opAddOrderItem").click();
        await d.locator("[data-item-field=name]").fill("VA5 calibration");
        await d.locator("[data-item-field=quantity]").fill("1");
        await d.locator("[data-item-field=unit_price]").fill("1200");
        await d.locator("[name=total]").fill("1100");
        await d.locator("[name=confirmed_delivery_date]").fill("2030-02-01");
        await d.locator("[name=invoice_number]").fill("INV-2030-001");
        await d.locator("[name=invoice_issued_at]").fill("2030-01-15");
        await d.locator("[name=invoice_due_date]").fill("2030-02-15");
        await d.locator("[type=submit]").click();
        d = page
          .getByRole("dialog")
          .filter({ hasText: "Calibration supplier order" });
        await d.waitFor();
        assert.match(await d.innerText(), /1,100/);
        await d.screenshot({
          path: path.join(out, name + "-order-progress.png"),
        });
        await page.keyboard.press("Escape");
        const confirmedDeal = (
          await db.query(
            "INSERT INTO deals(workspace_id,title,status,currency,value) VALUES($1,'Customer order source','won','PLN',180) RETURNING id",
            [ws.id],
          )
        ).rows[0];
        const customerOrder = (
          await db.query(
            "INSERT INTO sales_orders(workspace_id,deal_id,title,number,kind,status,currency,total,subtotal,items) VALUES($1,$2,'Customer sensor kit',$3,'customer','confirmed','PLN',180,200,$4) RETURNING *",
            [
              ws.id,
              confirmedDeal.id,
              "CUST-" + name,
              JSON.stringify([
                {
                  name: "Sensor kit",
                  description: "Precision instruments",
                  quantity: 2,
                  unit_price: 100,
                  discount_percent: 10,
                },
              ]),
            ],
          )
        ).rows[0];
        await page.evaluate(() => KlyoOperations.onView("orders"));
        await page
          .locator("[data-order]")
          .filter({ hasText: "Customer sensor kit" })
          .click();
        d = page
          .getByRole("dialog")
          .filter({ has: page.locator("#opConfirmationSettings") });
        await d.locator("#opConfirmationSettings").click();
        d = page.getByRole("dialog", {
          name: "Customize order confirmation",
          exact: true,
        });
        await d.locator("[name=language]").selectOption("en");
        await d.locator("[name=layout]").selectOption("executive");
        await d
          .locator("[name=seller_name]")
          .fill("Industrial measurement group");
        await d.locator("[name=buyer_name]").fill("Steel plant");
        await d.locator("[name=footer]").fill("Custom customer confirmation");
        await d.locator("[type=submit]").click();
        d = page
          .getByRole("dialog")
          .filter({ has: page.locator("#opConfirmationSettings") });
        await d.locator("#opConfirmation").waitFor();
        assert.equal(
          (
            await db.query(
              "SELECT customer_confirmation FROM sales_orders WHERE id=$1",
              [customerOrder.id],
            )
          ).rows[0].customer_confirmation.footer,
          "Custom customer confirmation",
        );
        const confirmationDownload = page.waitForEvent("download");
        await d.locator("#opConfirmation").click();
        await (
          await confirmationDownload
        ).saveAs(path.join(out, name + "-custom-confirmation.pdf"));
        await page.keyboard.press("Escape");
        await page.reload();
        await page.locator(".nav [data-view=projects]").click();
        await page
          .locator("[data-project]")
          .filter({ hasText: "Power plant service" })
          .click();
        d = page.getByRole("dialog", {
          name: "Power plant service",
          exact: true,
        });
        assert.match(await d.innerText(), /Initial vibration measurements/);
        assert.match(await d.innerText(), /Calibration supplier order/);
        assert.match(await d.innerText(), /Vibration analyzer/);
        await d.locator("#opProjectResource").click();
        let resourceDialog = page.getByRole("dialog", {
          name: "Plan project resources",
          exact: true,
        });
        await resourceDialog
          .locator("[name=user_id]")
          .selectOption(String(user.id));
        await resourceDialog.locator("[name=role]").fill("Service engineer");
        await resourceDialog.locator("[name=planned_hours]").fill("16");
        await resourceDialog.locator("[type=submit]").click();
        d = page.getByRole("dialog", {
          name: "Power plant service",
          exact: true,
        });
        await d.getByText("0.00 / 16.00 h", { exact: true }).waitFor();
        await d.locator("#opProjectTime").click();
        let timeDialog = page.getByRole("dialog", {
          name: "Log project work",
          exact: true,
        });
        await timeDialog.locator("[name=spent_on]").fill("2030-01-15");
        await timeDialog.locator("[name=hours]").fill("4");
        await timeDialog.locator("[name=notes]").fill("Site survey");
        await timeDialog.locator("[type=submit]").click();
        d = page.getByRole("dialog", {
          name: "Power plant service",
          exact: true,
        });
        await d.getByText("4.00 / 16.00 h", { exact: true }).waitFor();
        await d.screenshot({
          path: path.join(out, name + "-project-worklog.png"),
        });
        const download = page.waitForEvent("download");
        await d.locator("#opProtocolDownload").click();
        await (
          await download
        ).saveAs(path.join(out, name + "-project-protocol.pdf"));
        await page.keyboard.press("Escape");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => switchView("equipment"));
        await page.locator("#equipmentContent [data-equipment]").waitFor();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.screenshot({
          path: path.join(out, name + "-equipment-mobile.png"),
          fullPage: true,
        });
        const viewer = (
            await db.query(
              "INSERT INTO users(workspace_id,name,email,password_hash,role,language,has_seen_onboarding,terms_accepted_at) VALUES($1,'Read-only viewer',$2,'fixture','viewer','en',true,now()) RETURNING *",
              [ws.id, name + "-viewer@ops.test"],
            )
          ).rows[0],
          viewerToken = jwt.sign(
            { id: viewer.id, workspace_id: ws.id },
            process.env.JWT_SECRET,
          );
        await page.evaluate(
          ({ token, user }) => {
            localStorage.setItem("klyo_token", token);
            localStorage.setItem("klyo_user", JSON.stringify(user));
          },
          { token: viewerToken, user: viewer },
        );
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.reload();
        await page.locator(".nav [data-view=projects]").click();
        await page.waitForFunction(
          () =>
            document.querySelector("[data-op-new=projects]")?.disabled === true,
        );
        await page
          .locator("[data-project]")
          .filter({ hasText: "Power plant service" })
          .click();
        d = page.getByRole("dialog", {
          name: "Power plant service",
          exact: true,
        });
        assert.equal(await d.locator("#opProjectEdit").isDisabled(), true);
        assert.equal(await d.locator("#opProjectResource").isDisabled(), true);
        assert.equal(await d.locator("#opProjectTime").isDisabled(), true);
        await page.keyboard.press("Escape");
        await page.locator(".nav [data-view=tasks]").click();
        await page.waitForFunction(
          () => document.getElementById("opNewTask")?.disabled === true,
        );
        await page.locator("#opTasksContent [data-task]").first().click();
        d = page.getByRole("dialog", { name: "Edit task", exact: true });
        assert.equal(await d.locator("[name=title]").isDisabled(), true);
        assert.equal(await d.locator("[type=submit]").isDisabled(), true);
        await page.keyboard.press("Escape");
        assert.deepEqual(errors, []);
        console.log(
          name +
            ": project creation, milestone, task matrix/Kanban drag, equipment reservation/check-out, supplier order invoice register, persistence and real protocol PDF passed",
        );
        await context.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await db.pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
