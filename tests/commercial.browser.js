// Real API/browser checks. Disposable PostgreSQL schema; no external email, AI or billing calls.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { Pool } = require("pg"),
  express = require("express"),
  jwt = require("jsonwebtoken"),
  { chromium, webkit } = require("playwright");
(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error("Use an isolated TEST_DATABASE_URL.");
  const schema = "commercial_ui_" + process.pid + "_" + Date.now(),
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
    JWT_SECRET: "commercial-ui-only",
    STRIPE_SECRET_KEY: "",
  });
  const db = require("../server/db");
  let server;
  const out = require("node:path").join(
    require("node:os").tmpdir(),
    "klyo-commercial-qa",
  );
  fs.mkdirSync(out, { recursive: true });
  try {
    await db.init();
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    for (const name of [
      "auth",
      "spaces",
      "contacts",
      "companies",
      "products",
      "deals",
      "pipelines",
      "sales",
      "analytics",
      "quotes",
      "quote-templates",
      "price-lists",
      "sharepoint",
      "custom-fields",
      "warranty",
      "tasks",
      "calendar",
      "history",
      "team-stats",
      "billing",
      "offers",
      "reminders",
      "clients",
      "stats",
      "discounts",
      "integrations",
      "platform",
      "operations",
      "commercial",
      "communications",
    ])
      app.use("/api/" + name, require("../server/routes/" + name));
    app.use("/q", require("../server/routes/publicQuotes"));
    app.use(express.static(path.join(__dirname, "../public")));
    app.get("/app", (req, res) =>
      res.sendFile(path.join(__dirname, "../public/app.html")),
    );
    server = await new Promise((r) => {
      const s = app.listen(0, "127.0.0.1", () => r(s));
    });
    const base = "http://127.0.0.1:" + server.address().port;
    for (const [name, engine] of [
      ["chromium", chromium],
      ["webkit", webkit],
    ]) {
      if (process.env.KLYO_BROWSER && process.env.KLYO_BROWSER !== name)
        continue;
      const wid = (
          await db.query(
            "INSERT INTO workspaces(name,invite_code,is_comped,default_currency)VALUES($1,$2,true,'PLN')RETURNING id",
            ["Commercial UI " + name, "commercial-ui-" + name],
          )
        ).rows[0].id,
        user = (
          await db.query(
            "INSERT INTO users(workspace_id,name,email,password_hash,role,language,has_seen_onboarding,terms_accepted_at)VALUES($1,'Demo owner',$2,'test','admin','en',true,now())RETURNING *",
            [wid, name + "@commercial-ui.test"],
          )
        ).rows[0];
      await db.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
        user.id,
        wid,
      ]);
      const company = (
          await db.query(
            "INSERT INTO companies(workspace_id,name)VALUES($1,'Steelworks Europe')RETURNING *",
            [wid],
          )
        ).rows[0],
        contact = (
          await db.query(
            "INSERT INTO contacts(workspace_id,full_name,first_name,email,company_id)VALUES($1,'Anna Buyer','Anna','anna@example.test',$2)RETURNING *",
            [wid, company.id],
          )
        ).rows[0];
      const products = [];
      for (const [sku, name, price] of [
        ["CPU", "Processor", 200],
        ["RAM", "Memory", 50],
      ]) {
        const p = (
          await db.query(
            "INSERT INTO products(workspace_id,name,sku,unit_price,currency)VALUES($1,$2,$3,$4,'PLN')RETURNING *",
            [wid, name, sku, price],
          )
        ).rows[0];
        products.push(p);
        await db.query(
          "INSERT INTO product_purchase_prices(workspace_id,product_id,currency,unit_cost)VALUES($1,$2,'PLN',$3)",
          [wid, p.id, price / 2],
        );
      }
      const token = jwt.sign(
          { id: user.id, workspace_id: wid, role: "admin" },
          process.env.JWT_SECRET,
        ),
        browser = await engine.launch({
          headless: true,
          executablePath: process.env["KLYO_" + name.toUpperCase() + "_PATH"],
        });
      try {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            deviceScaleFactor: 1,
            locale: "en-GB",
            timezoneId: "Europe/Warsaw",
          }),
          page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await context.addInitScript(
          ({ token, user }) => {
            localStorage.setItem("klyo_token", token);
            localStorage.setItem("klyo_user", JSON.stringify(user));
          },
          { token, user },
        );
        await page.goto(base + "/app");
        await page.locator("#contactsBody tr").first().waitFor();
        // Company structure and extra fields through the actual detail panel.
        await page.locator('[data-view="companies"]').click();
        await page.locator("#companiesBody tr").first().click();
        await page.locator("#companyStructureBtn").click();
        await page.locator("#companyAddUnit").click();
        await page
          .locator("#commercialUnitForm [name=name]")
          .fill("Warszawa works");
        await page
          .locator("#commercialUnitForm [name=kind]")
          .selectOption("branch");
        await page.locator("#commercialUnitForm button").last().click();
        await page
          .locator(".commercial-unit")
          .filter({ hasText: "Warszawa works" })
          .waitFor();
        await page.locator("#companyAddCustom").click();
        await page
          .locator("#commercialFieldForm [name=name]")
          .fill("Annual output");
        await page
          .locator("#commercialFieldForm [name=type]")
          .selectOption("number");
        await page.locator("#commercialFieldForm button").click();
        await page
          .locator("#companyCommercialForm input[data-custom]")
          .fill("24000");
        await page
          .locator("#companyCommercialForm [name=tax_id]")
          .fill("PL123456");
        await page
          .locator(
            "#companyCommercialForm button[type=submit],#companyCommercialForm button:not([type])",
          )
          .first()
          .click();
        await page.locator("#companyCommercialForm [name=tax_id]").waitFor();
        assert.equal(
          await page
            .locator("#companyCommercialForm [name=tax_id]")
            .inputValue(),
          "PL123456",
        );
        await page.locator("#commercialDialog [data-close]").click();
        await page.locator("#closeCompanyPanelBtn").click();
        // New commercial case creates one deal; the generated offer uses the same case number.
        await page.locator('[data-view="commercial"]').click();
        await page.locator("#commercialAdd").click();
        await page
          .locator("#commercialCaseForm [name=title]")
          .fill("Industrial measurement station");
        await page
          .locator("#commercialCaseForm [name=contact_id]")
          .selectOption(String(contact.id));
        await page
          .locator("#commercialCaseForm [name=company_unit_id] option")
          .filter({ hasText: "Warszawa works" })
          .waitFor({ state: "attached" });
        const unitValue = await page
          .locator("#commercialCaseForm [name=company_unit_id] option")
          .filter({ hasText: "Warszawa works" })
          .getAttribute("value");
        await page
          .locator("#commercialCaseForm [name=company_unit_id]")
          .selectOption(unitValue);
        await page.locator("#commercialCaseForm [name=value]").fill("300");
        await page.locator("#commercialCaseForm [name=currency]").fill("PLN");
        await page.locator("#commercialCaseForm button[type=submit]").click();
        await page.locator("[data-new-case-quote]").waitFor();
        const caseNumber = await page
          .locator("[data-edit-case]")
          .first()
          .innerText();
        await page.locator("[data-new-case-quote]").first().click();
        await page.locator("#quoteModalOverlay:not(.hidden)").waitFor();
        assert.equal(
          await page.locator("[data-doc=reference]").inputValue(),
          caseNumber,
        );
        // Bundle rows and private margin panel; switch client PDF to total-only.
        await page
          .locator(".line-product-select")
          .first()
          .selectOption(String(products[0].id));
        await page.locator("#addLineItemBtn").click();
        await page
          .locator(".line-product-select")
          .nth(1)
          .selectOption(String(products[1].id));
        await page.locator(".line-qty-input").nth(1).fill("2");
        await page.locator(".commercial-quote-options summary").click();
        await page.locator('[data-bundle-index="0"]').check();
        await page.locator('[data-bundle-index="1"]').check();
        await page
          .locator("#commercialBundleName")
          .fill("Industrial workstation");
        await page.locator("#commercialBundleBtn").click();
        await page.locator("#commercialPricingMode").selectOption("total_only");
        await page.locator(".commercial-margins summary").click();
        await page
          .locator("#commercialMarginData")
          .filter({ hasText: "50.0%" })
          .waitFor();
        await page.screenshot({
          path: path.join(out, name + "-margin-bundle.png"),
        });
        await page.locator("#quoteSavePdfBtn").click();
        await page
          .locator("#quotePdfFrame[data-rendered=true]")
          .waitFor({ timeout: 20000 });
        await page.screenshot({
          path: path.join(out, name + "-quote-pdf.png"),
        });
        const q = (
          await db.query(
            "SELECT * FROM quotes WHERE workspace_id=$1 ORDER BY id DESC LIMIT 1",
            [wid],
          )
        ).rows[0];
        assert.equal(q.document.reference, caseNumber);
        assert.equal(q.document.pricing_mode, "total_only");
        assert.equal(q.total, "300.00");
        assert.ok(q.company_unit_id);
        const lineItems = (
          await db.query("SELECT * FROM quote_line_items WHERE quote_id=$1", [
            q.id,
          ])
        ).rows;
        assert.equal(lineItems[0].bundle_id, lineItems[1].bundle_id);
        assert.equal(lineItems[0].bundle_name, "Industrial workstation");
        const caseRow = (
          await db.query("SELECT * FROM commercial_cases WHERE id=$1", [
            q.commercial_case_id,
          ])
        ).rows[0];
        assert.equal(caseRow.quote_id, q.id);
        assert.equal(
          Number(
            (
              await db.query(
                "SELECT count(*) FROM deals WHERE workspace_id=$1",
                [wid],
              )
            ).rows[0].count,
          ),
          1,
        );
        await page.locator("#closeQuotePdfBtn").click();
        await page.locator("#closeQuoteModalBtn").click();
        await page.locator('[data-view="quotes"]').click();
        await page.locator("#quotesBody tr").first().click();
        await db.query(
          "UPDATE product_purchase_prices SET unit_cost=0 WHERE workspace_id=$1",
          [wid],
        );
        await page.locator("#editQuoteBtn").click();
        await page.locator(".commercial-margins summary").click();
        await page
          .locator("#commercialMarginSource")
          .filter({ hasText: "original purchase-cost snapshot" })
          .waitFor();
        await page
          .locator("#commercialMarginData")
          .filter({ hasText: "50.0%" })
          .waitFor();
        await page.locator(".line-price-input").first().fill("210");
        await page
          .locator("#commercialMarginSource")
          .filter({ hasText: "Live draft preview" })
          .waitFor();
        await page
          .locator("#commercialMarginData")
          .filter({ hasText: "100.0%" })
          .waitFor();
        assert.deepEqual(errors, []);
        console.log(
          name +
            ": company fields/branches, register→offer→margin→bundle→total-only PDF, saved/live margin costs passed",
        );
        await context.close();
        const viewerUser = (
            await db.query(
              "INSERT INTO users(workspace_id,name,email,password_hash,role,language,has_seen_onboarding,terms_accepted_at)VALUES($1,'Viewer',$2,'test','viewer','en',true,now())RETURNING *",
              [wid, "viewer-" + name + "@commercial-ui.test"],
            )
          ).rows[0],
          viewerToken = jwt.sign(
            { id: viewerUser.id, workspace_id: wid, role: "viewer" },
            process.env.JWT_SECRET,
          ),
          viewerContext = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
          });
        await viewerContext.addInitScript(
          ({ token, user }) => {
            localStorage.setItem("klyo_token", token);
            localStorage.setItem("klyo_user", JSON.stringify(user));
          },
          { token: viewerToken, user: viewerUser },
        );
        const vp = await viewerContext.newPage();
        await vp.goto(base + "/app");
        await vp.locator("#contactsBody tr").first().waitFor();
        await vp.locator('[data-view="commercial"]').click();
        await vp.locator("[data-edit-case]").first().waitFor();
        assert.equal(await vp.locator("#commercialAdd").isVisible(), false);
        assert.equal(await vp.locator("#commercialStages").isVisible(), false);
        assert.equal(await vp.locator("[data-new-case-quote]").count(), 0);
        await vp.locator("[data-edit-case]").first().click();
        await vp.locator("#commercialCaseForm").waitFor();
        assert.equal(
          await vp.locator("#commercialCaseForm [name=title]").isDisabled(),
          true,
        );
        assert.equal(
          await vp.locator("#commercialCaseForm [type=submit]").isVisible(),
          false,
        );
        await vp.locator("#commercialDialog [data-close]").click();
        await vp.locator('[data-view="companies"]').click();
        await vp.locator("#companiesBody tr").first().click();
        await vp.locator("#companyStructureBtn").click();
        await vp.locator("#companyCommercialForm").waitFor();
        assert.equal(
          await vp.locator("#companyCommercialForm [name=tax_id]").isDisabled(),
          true,
        );
        assert.equal(await vp.locator("#companyAddUnit").isVisible(), false);
        console.log(name + ": commercial viewer controls are read-only");
        await viewerContext.close();
      } catch (e) {
        const page = browser.contexts()[0]?.pages()[0];
        if (page) {
          await page.screenshot({
            path: path.join(out, name + "-failure.png"),
            fullPage: true,
          });
          console.error((await page.locator("body").innerText()).slice(-2200));
        }
        throw e;
      } finally {
        await browser.close();
      }
    }
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await db.pool.end();
    await admin.query("DROP SCHEMA " + schema + " CASCADE");
    await admin.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
