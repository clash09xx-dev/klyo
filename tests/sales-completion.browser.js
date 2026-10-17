// Exercise the completion workflows against a disposable real database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, webkit } = require("playwright");
(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL");
  const f = await require("./helpers/calendar-fixture")();
  const out =
    process.env.KLYO_QA_SCREENSHOTS ||
    path.join(require("node:os").tmpdir(), "klyo-completion-qa");
  fs.mkdirSync(out, { recursive: true });
  const api = async (route, method = "GET", body) => {
    const r = await f.req(route, method, body);
    assert.ok(r.status < 400, JSON.stringify(r.data));
    return r.data;
  };
  try {
    await f.db.query(
      "UPDATE workspaces SET default_currency='PLN' WHERE id=$1",
      [f.w],
    );
    const company = (
      await f.db.query(
        "INSERT INTO companies(workspace_id,name,tax_id,address,city,country) VALUES($1,'Good','PL123456','Factory 10','Warsaw','Poland') RETURNING *",
        [f.w],
      )
    ).rows[0];
    const contact = (
      await f.db.query(
        "INSERT INTO contacts(workspace_id,full_name,first_name,email,company_id) VALUES($1,'Good','Good','buyer@example.test',$2) RETURNING *",
        [f.w, company.id],
      )
    ).rows[0];
    const product = (
      await f.db.query(
        "INSERT INTO products(workspace_id,name,sku,unit_price,currency) VALUES($1,'Temperature sensor','TEMP-QA',1000,'PLN') RETURNING *",
        [f.w],
      )
    ).rows[0];
    await f.db.query(
      "INSERT INTO product_purchase_prices(workspace_id,product_id,currency,unit_cost) VALUES($1,$2,'PLN',400)",
      [f.w, product.id],
    );
    const month = new Date().toISOString().slice(0, 7);
    await api("/analytics/target", "PUT", {
      month,
      currency: "PLN",
      amount: 10000,
    });
    const won = (
      await api("/deals", "POST", {
        title: "Completed sensor delivery",
        status: "won",
        value: 5000,
        currency: "PLN",
        source: "Referral",
        company_id: company.id,
        contact_id: contact.id,
        assigned_to: f.users[0].id,
      })
    ).deal;
    await api("/deals", "POST", {
      title: "Sensor installation",
      value: 12000,
      currency: "PLN",
      probability: 60,
      source: "Website",
      expected_close_date: month + "-28",
      assigned_to: f.users[0].id,
    });
    await api("/deals", "POST", {
      title: "Needs attention",
      value: 800,
      currency: "PLN",
      probability: 0,
      source: "Referral",
    });
    const project = (
      await f.db.query("SELECT * FROM projects WHERE deal_id=$1", [won.id])
    ).rows[0];
    await api("/operations/projects/" + project.id + "/resources", "POST", {
      user_id: f.users[0].id,
      planned_hours: 8,
      hourly_cost: 100,
    });
    await api("/operations/projects/" + project.id + "/time", "POST", {
      hours: 2,
      spent_on: month + "-10",
    });
    for (const [kind, total, paid] of [
      ["customer", 5000, 2000],
      ["supplier", 1600, 600],
    ])
      await api("/operations/orders", "POST", {
        title: kind,
        kind,
        status: "confirmed",
        currency: "PLN",
        project_id: project.id,
        total,
        paid_amount: paid,
        items: [{ description: kind, quantity: 1, unit_price: total }],
      });
    await api("/commercial/cases", "POST", {
      title: "Sensor procurement",
      company_id: company.id,
      contact_id: contact.id,
      main_products: "Temperature sensor",
      value: 1000,
      currency: "PLN",
      payment_terms: "30 days after invoice",
      delivery_terms: "Delivery within 14 days",
    });
    for (const [name, engine, executablePath] of [
      ["chromium", chromium, process.env.KLYO_CHROMIUM_PATH],
      ["webkit", webkit, process.env.KLYO_WEBKIT_PATH],
    ]) {
      if (process.env.KLYO_BROWSER && process.env.KLYO_BROWSER !== name)
        continue;
      const browser = await engine.launch({ headless: true, executablePath });
      try {
        const context = await browser.newContext({
          viewport: { width: 1680, height: 1100 },
          timezoneId: "Europe/Warsaw",
          reducedMotion: "reduce",
        });
        await context.addInitScript(
          ({ token, user }) => {
            localStorage.setItem("klyo_token", token);
            localStorage.setItem("klyo_user", JSON.stringify(user));
          },
          { token: f.token(0), user: f.users[0] },
        );
        const page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(f.base + "/app", { waitUntil: "networkidle" });
        await page.locator(".nav [data-view=overview]").click();
        await page.locator("#salesForecast svg").waitFor();
        await page.locator("#analyticsCurrency").selectOption("PLN");
        await page.locator("#analyticsFilters button").click();
        await page
          .locator("#dashboardGrid")
          .filter({ hasText: "Website" })
          .waitFor();
        assert.equal(await page.locator("#salesDaily svg").count(), 1);
        assert.match(
          await page.locator(".analytics-risk").innerText(),
          /Needs attention/,
        );
        await page.locator("#analyticsBenchmarks").click();
        await page.locator(".doc-overlay [name=pipeline_goal]").fill("20000");
        await page.locator(".doc-overlay [name=meeting_goal]").fill("10");
        await page.locator(".doc-overlay [name=win_rate_goal]").fill("65");
        await page.locator(".doc-overlay [name=stale_days]").fill("7");
        await page.locator(".doc-overlay form button").click();
        await page.locator(".analytics-scorecard.is-behind").first().waitFor();
        const report = await api("/analytics?month=" + month + "&currency=PLN");
        assert.equal(Number(report.extended.benchmark.pipeline_goal), 20000);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: path.join(out, name + "-completion-dashboard.png"),
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: path.join(out, name + "-completion-dashboard-mobile.png"),
          fullPage: true,
        });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          "Dashboard overflows the viewport",
        );
        await page.setViewportSize({ width: 1680, height: 1100 });
        await page.locator(".nav [data-view=projects]").click();
        await page.locator('[data-project="' + project.id + '"]').click();
        await page.locator("#projectFinance").click();
        await page.locator("#projectExpenseAdd").waitFor();
        assert.match(
          await page.locator(".doc-overlay").last().innerText(),
          /5,000/,
        );
        await page.locator("#projectExpenseAdd").click();
        const expense = page.locator(".doc-overlay").last();
        await expense.locator("[name=description]").fill("Travel QA " + name);
        await expense.locator("[name=spent_on]").fill(month + "-10");
        await expense.locator("[name=amount]").fill("100");
        await expense.locator("form button").click();
        await page.locator("#projectExpenseAdd").waitFor();
        await page
          .locator(".doc-overlay")
          .last()
          .filter({ hasText: "Travel QA " + name })
          .waitFor();
        await page.screenshot({
          path: path.join(out, name + "-project-settlement.png"),
        });
        while (await page.locator(".doc-overlay").count())
          await page
            .locator(".doc-overlay")
            .last()
            .locator("header button")
            .click();
        await page.locator(".nav [data-view=commercial]").click();
        await page
          .locator("#commercialRows")
          .filter({ hasText: "PL123456" })
          .waitFor();
        assert.match(
          await page.locator("#commercialRows").innerText(),
          /30 days after invoice/,
        );
        assert.match(
          await page.locator("#commercialRows").innerText(),
          /Delivery within 14 days/,
        );
        assert.match(
          await page.locator("#commercialRows").innerText(),
          /Factory 10/,
        );
        await page.locator("[data-new-case-quote]").first().click();
        await page.locator("#quoteModalOverlay:not(.hidden)").waitFor();
        await page
          .locator(".line-product-select")
          .first()
          .selectOption(String(product.id));
        await page.locator(".commercial-margins summary").click();
        await page
          .locator("#commercialMarginData")
          .filter({ hasText: "60.0%" })
          .waitFor();
        const bounds = await page.locator(".commercial-margins").boundingBox();
        assert.ok(
          Math.abs(bounds.x + bounds.width - 1680) < 2 &&
            bounds.y < 2 &&
            bounds.height >= 1098,
          "Margin analysis must be a full height right drawer",
        );
        const assertMarginContrast = async () => {
          const ratio = await page.evaluate(() => {
            const style = getComputedStyle(
              document.querySelector(".commercial-margin-summary"),
            );
            const hex = (c) =>
              "#" +
              c
                .match(/[\d.]+/g)
                .slice(0, 3)
                .map((n) => Number(n).toString(16).padStart(2, "0"))
                .join("");
            return KlyoPreferences.contrast(
              hex(style.color),
              hex(style.backgroundColor),
            );
          });
          assert.ok(
            ratio >= 4.5,
            "Margin summary contrast must be readable: " + ratio,
          );
        };
        await assertMarginContrast();
        await page.screenshot({
          path: path.join(out, name + "-margin-drawer.png"),
        });
        await page.evaluate(() => {
          for (const [k, v] of Object.entries(
            KlyoPreferences.tokens(KlyoPreferences.defaults("day").palette),
          ))
            document.documentElement.style.setProperty(k, v);
        });
        await assertMarginContrast();
        await page.screenshot({
          path: path.join(out, name + "-margin-drawer-light.png"),
        });
        await page.evaluate(() => {
          for (const [k, v] of Object.entries(
            KlyoPreferences.tokens(
              KlyoPreferences.defaults("graphite").palette,
            ),
          ))
            document.documentElement.style.setProperty(k, v);
        });
        await page.keyboard.press("Escape");
        assert.equal(
          await page.locator(".commercial-margins[open]").count(),
          0,
        );
        assert.equal(
          await page.locator("#quoteModalOverlay:not(.hidden)").count(),
          1,
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator(".commercial-margins summary").click();
        await page
          .locator(".commercial-margins summary")
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(out, name + "-margin-drawer-mobile.png"),
        });
        await page.locator(".commercial-margins summary").click();
        await page.keyboard.press("Escape");
        await page.setViewportSize({ width: 1680, height: 1100 });
        // Switching locale must translate authored labels without changing a record called "Good".
        for (const [lang, title] of [
          ["pl", "Rejestr handlowy"],
          ["en", "Commercial register"],
        ]) {
          await page.evaluate((lang) => KlyoI18n.setLang(lang, true), lang);
          await page
            .locator("#commercialView h2")
            .filter({ hasText: title })
            .waitFor();
          assert.match(
            await page.locator("#commercialRows").innerText(),
            /Good/,
          );
          assert.equal(
            await page
              .locator("#commercialRows")
              .getByText("Gut", { exact: true })
              .count(),
            0,
          );
        }
        assert.deepEqual(errors, []);
        await context.close();
        console.log(
          name +
            ": PASS completion dashboards, benchmarks, finance, register, responsive margin drawer and Polish/English",
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    await f.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
