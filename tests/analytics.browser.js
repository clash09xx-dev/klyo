// Real application and API with isolated PostgreSQL; no outbound providers.
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const express = require("express");
const jwt = require("jsonwebtoken");
const { chromium, webkit } = require("playwright");
(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL");
  const schema = `klyo_analytics_ui_${process.pid}_${Date.now()}`;
  const admin = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    ssl: false,
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  Object.assign(process.env, {
    DATABASE_URL: url.toString(),
    PGSSL: "false",
    JWT_SECRET: "analytics-browser-only",
    STRIPE_SECRET_KEY: "",
  });
  const db = require("../server/db");
  const out =
    process.env.KLYO_QA_SCREENSHOTS ||
    require("node:path").join(require("node:os").tmpdir(), "klyo-analytics-qa");
  fs.mkdirSync(out, { recursive: true });
  let server;
  try {
    await db.init();
    await db.query("ALTER TABLE users ALTER COLUMN mfa_enabled SET DEFAULT true");
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    for (const file of fs
      .readdirSync(path.join(__dirname, "../server/routes"))
      .filter(
        (n) =>
          n.endsWith(".js") &&
          !n.includes(" ") &&
          !["publicQuotes.js", "webhooks.js"].includes(n),
      )) {
      app.use("/api/" + file.slice(0, -3), require("../server/routes/" + file));
    }
    app.use(express.static(path.join(__dirname, "../public")));
    app.get("/app", (req, res) =>
      res.sendFile(path.join(__dirname, "../public/app.html")),
    );
    app.use((e, req, res, next) =>
      res.status(e.status || 500).json({ error: e.message }),
    );
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const now = new Date(),
      month =
        now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    for (const [name, engine, exe] of [
      ["chromium", chromium, process.env.KLYO_CHROMIUM_PATH],
      ["webkit", webkit, process.env.KLYO_WEBKIT_PATH],
    ]) {
      if (process.env.KLYO_BROWSER && process.env.KLYO_BROWSER !== name)
        continue;
      const ws = (
        await db.query(
          "INSERT INTO workspaces(name,invite_code,is_comped,default_currency) VALUES($1,$2,true,'PLN') RETURNING *",
          ["Reporting QA", name],
        )
      ).rows[0];
      const user = (
        await db.query(
          "INSERT INTO users(workspace_id,name,email,password_hash,role,language,has_seen_onboarding,terms_accepted_at) VALUES($1,'Sales owner',$2,'fixture','admin','en',true,now()) RETURNING *",
          [ws.id, name + "@analytics.test"],
        )
      ).rows[0];
      await db.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
        user.id,
        ws.id,
      ]);
      const token = jwt.sign(
        { sms_verified: true, id: user.id, workspace_id: ws.id },
        process.env.JWT_SECRET,
      );
      async function api(route, method = "GET", body) {
        const res = await fetch(base + "/api" + route, {
          method,
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
            "X-Klyo-Timezone": "Europe/Warsaw",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await res.json();
        assert.ok(res.ok, JSON.stringify(data));
        return data;
      }
      const opportunity = (
        await api("/deals", "POST", {
          title: "Sensor rollout",
          value: 10000,
          currency: "PLN",
          probability: 30,
          expected_close_date: month + "-20",
          assigned_to: user.id,
        })
      ).deal;
      await api("/deals", "POST", {
        title: "Completed sensor sale",
        value: 4000,
        currency: "PLN",
        status: "won",
        assigned_to: user.id,
      });
      const euroDeal = (
        await api("/deals", "POST", {
          title: "Euro contract",
          value: 900000,
          currency: "EUR",
          status: "won",
        })
      ).deal;
      const browser = await engine.launch({
        headless: true,
        executablePath: exe,
      });
      try {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          deviceScaleFactor: 2,
          timezoneId: "Europe/Warsaw",
          reducedMotion: "reduce",
        });
        await context.addInitScript(
          ({ token, user }) => {
            localStorage.setItem("klyo_token", token);
            localStorage.setItem("klyo_user", JSON.stringify(user));
          },
          { token, user },
        );
        const page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("response", async (r) => {
          if (r.url().includes("/api/") && r.status() >= 400)
            console.error(name, r.status(), r.url(), await r.text());
        });
        page.on("console", (m) => {
          if (m.type() === "error") console.error(name, m.text());
        });
        page.on("dialog", (d) => d.accept());
        await page.goto(base + "/app");
        await page.locator(".nav [data-view=overview]").click();
        await page
          .locator("#analyticsDashboard[aria-busy=false] .analytics-metric")
          .first()
          .waitFor();
        await page.locator("#analyticsMonth").fill(month);
        await page.locator("#analyticsCurrency").selectOption("PLN");
        await page.locator("#analyticsFilters button").click();
        await page.waitForFunction(() =>
          document
            .querySelector("#analyticsMetrics")
            .textContent.includes("3,000"),
        );
        assert.match(
          await page.locator("#analyticsMetrics").innerText(),
          /4,000/,
        );
        await page.locator("#analyticsEditTarget").click();
        await page.locator("#analyticsTargetAmount").fill("10000");
        await page.locator("[data-save-target]").click();
        await page.waitForFunction(() =>
          document
            .querySelector("#analyticsMetrics")
            .textContent.includes("40%"),
        );
        assert.equal(
          Number(
            (await api("/analytics?month=" + month + "&currency=PLN")).metrics
              .weighted_forecast,
          ),
          3000,
        );
        let download = page.waitForEvent("download");
        await page.locator("#analyticsExport").click();
        let file = await download;
        await file.saveAs(path.join(out, name + "-report.csv"));
        assert.match(
          fs.readFileSync(path.join(out, name + "-report.csv"), "utf8"),
          /weighted_forecast.*3000/,
        );
        await page
          .locator("#analyticsDashboard")
          .screenshot({ path: path.join(out, name + "-analytics.png") });
        await page.locator("#analyticsCurrency").selectOption("EUR");
        await page.locator("#analyticsFilters button").click();
        await page.waitForFunction(() =>
          document
            .querySelector("#analyticsMetrics")
            .textContent.includes("900,000"),
        );
        assert.doesNotMatch(
          await page.locator("#analyticsMetrics").innerText(),
          /40%/,
        );
        await page.locator(".nav [data-view=deals]").click();
        await page.locator("#dealsTableMode").click();
        await page.locator(`[data-select-deal="${opportunity.id}"]`).check();
        download = page.waitForEvent("download");
        await page.locator("#exportSelectedDeals").click();
        file = await download;
        await file.saveAs(path.join(out, name + "-selected.csv"));
        const csv = fs.readFileSync(
          path.join(out, name + "-selected.csv"),
          "utf8",
        );
        assert.match(csv, /Sensor rollout/);
        assert.doesNotMatch(csv, /Completed sensor sale|Euro contract/);
        await page.locator(`[data-open-deal="${opportunity.id}"]`).click();
        await page.locator("#editDealBtn").click();
        await page.locator("#dealProbability").fill("40");
        await page.locator("#dealForm [type=submit]").click();
        await page.waitForFunction(() =>
          document
            .querySelector("#dealModalOverlay")
            .classList.contains("hidden"),
        );
        assert.equal(
          Number((await api("/deals/" + opportunity.id)).deal.probability),
          40,
        );
        await page.locator(`[data-open-deal="${euroDeal.id}"]`).click();
        await page.locator("#editDealBtn").click();
        assert.equal(await page.locator("#dealCurrency").inputValue(), "EUR");
        await page.locator("#dealNotes").fill("Keep euro contract currency");
        await page.locator("#dealSubmitBtn").waitFor({ state: "visible" });
        assert.deepEqual(
          await page
            .locator("#dealForm")
            .evaluate((f) =>
              [...f.elements]
                .filter((e) => e.willValidate && !e.checkValidity())
                .map((e) => ({
                  id: e.id,
                  value: e.value,
                  message: e.validationMessage,
                })),
            ),
          [],
        );
        await page.locator("#dealForm [type=submit]").click();
        await page.waitForFunction(() =>
          document
            .querySelector("#dealModalOverlay")
            .classList.contains("hidden"),
        );
        assert.equal((await api("/deals/" + euroDeal.id)).deal.currency, "EUR");
        await page.locator(`[data-open-deal="${opportunity.id}"]`).click();
        await page.locator("#deleteDealBtn").click();
        await page.locator("#dealStatusFilter").selectOption("deleted");
        await page.locator(`[data-restore-deal="${opportunity.id}"]`).waitFor();
        await page.locator(`[data-restore-deal="${opportunity.id}"]`).click();
        await page.waitForFunction(
          (id) => !document.querySelector(`[data-restore-deal="${id}"]`),
          opportunity.id,
        );
        await page.locator("#dealStatusFilter").selectOption("all");
        await page.locator("#dealsBoardMode").click();
        const card = page.locator(`.deal-card[data-id="${opportunity.id}"]`);
        await card.waitFor();
        // Native drag reveals persistent bottom outcomes; loss requires a typed reason.
        await card.dispatchEvent("dragstart", {
          dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
        });
        const transfer = await page.evaluateHandle((id) => {
          const d = new DataTransfer();
          d.setData("dealId", String(id));
          return d;
        }, opportunity.id);
        await page
          .locator("[data-deal-outcome=lost]")
          .dispatchEvent("drop", { dataTransfer: transfer });
        await page.locator("#lostDropReason").fill("Project postponed");
        await page.locator("#lostDropForm button").click();
        await page.waitForFunction(
          () => !document.querySelector("#lostDropForm"),
        );
        assert.equal(
          (await api("/deals/" + opportunity.id)).deal.lost_reason,
          "Project postponed",
        );
        await page.locator(".nav [data-view=overview]").click();
        await page.locator("#analyticsCurrency").selectOption("PLN");
        await page.locator("#analyticsFilters button").click();
        await page.waitForFunction(
          () =>
            document
              .querySelector("#analyticsDashboard")
              .getAttribute("aria-busy") === "false",
        );
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.screenshot({
          path: path.join(out, name + "-analytics-mobile.png"),
          fullPage: true,
        });
        assert.deepEqual(errors, []);
        console.log(
          name +
            ": real analytics filters/targets/currency, CSV selection, probability edit, soft delete/restore and lost drop passed",
        );
        await context.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
