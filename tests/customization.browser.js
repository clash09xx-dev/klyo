// End-to-end UI against real Express routes and isolated PostgreSQL. No real email, AI or Stripe calls.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { Pool } = require("pg"),
  express = require("express"),
  jwt = require("jsonwebtoken"),
  { chromium, webkit } = require("playwright");
const publicDir = path.join(__dirname, "../public"),
  out =
    process.env.KLYO_QA_SCREENSHOTS || path.join(__dirname, "../../qa-custom");
(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error(
      "Set TEST_DATABASE_URL to the disposable PostgreSQL instance.",
    );
  fs.mkdirSync(out, { recursive: true });
  const schema = `klyo_ui_${process.pid}_${Date.now()}`,
    admin = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      ssl: false,
    });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.PGSSL = "false";
  process.env.JWT_SECRET = "local-real-ui-test";
  process.env.STRIPE_SECRET_KEY = "";
  process.env.PLATFORM_ADMIN_EMAIL = "platform-owner@example.test";
  const mailer = require.resolve("../server/services/mailer");
  require.cache[mailer] = {
    id: mailer,
    filename: mailer,
    loaded: true,
    exports: {
      sendOfferEmail: async () => {
        throw new Error("Unexpected email send during browser QA");
      },
    },
  };
  const db = require("../server/db");
  let server;
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
      "quotes",
      "quote-templates",
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
    ])
      app.use("/api/" + name, require("../server/routes/" + name));
    app.use(express.static(publicDir));
    app.get("/app", (req, res) =>
      res.sendFile(path.join(publicDir, "app.html")),
    );
    app.get("/customization", (req, res) =>
      res.sendFile(path.join(publicDir, "customization.html")),
    );
    app.get(["/signup", "/login"], (req, res) =>
      res.sendFile(path.join(publicDir, "login.html")),
    );
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, engine] of [
      ["chromium", chromium],
      ["webkit", webkit],
    ]) {
      if (process.env.KLYO_BROWSER && process.env.KLYO_BROWSER !== name)
        continue;
      const ws = (
        await db.query(
          "INSERT INTO workspaces(name,invite_code,is_comped,default_currency) VALUES($1,$2,true,'PLN') RETURNING *",
          ["Demo team " + name, "UI-" + name],
        )
      ).rows[0];
      const user = (
        await db.query(
          "INSERT INTO users(workspace_id,name,email,password_hash,role,language,has_seen_onboarding,terms_accepted_at) VALUES($1,'Demo owner',$2,'fixture','admin','en',true,now()) RETURNING *",
          [ws.id, "owner-" + name + "@example.test"],
        )
      ).rows[0];
      await db.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
        user.id,
        ws.id,
      ]);
      const token = jwt.sign(
          {
            id: user.id,
            workspace_id: ws.id,
            name: user.name,
            email: user.email,
            role: user.role,
          },
          process.env.JWT_SECRET,
        ),
        browser = await engine.launch({
          headless: true,
          executablePath:
            process.env["KLYO_" + name.toUpperCase() + "_PATH"] || undefined,
        });
      try {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            locale: "en-GB",
            timezoneId: "Europe/Warsaw",
          }),
          page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => {
          errors.push(e.message);
          console.error("Browser error:", e.message);
        });
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
        await page.locator("#emptyState:not(.hidden)").waitFor();
        assert.equal(
          await page
            .locator("[data-switch-space=team]")
            .getAttribute("aria-pressed"),
          "true",
        );
        // Create a real product and its own typed custom field through the UI.
        await page.locator(".nav-item[data-view=products]").click();
        await page.locator("#addProductViewBtn").click();
        await page.locator("#productSubmitBtn:not([disabled])").waitFor();
        await page.locator("#productName").fill("Precision sensor");
        await page.locator("#productPrice").fill("1000");
        await page.locator("#productWarrantyMonths").fill("60");
        await page.locator("#productInterval").fill("12");
        await page.locator("[data-manage-fields=product]").click();
        await page.locator("#fieldName").fill("Rated power W");
        await page.selectOption("#fieldType", "number");
        await page.locator("#customFieldForm button:not([type])").click();
        await page.waitForFunction(
          () =>
            document.querySelectorAll("#productCustomFields [data-custom-key]")
              .length === 1,
        );
        await page
          .locator("[data-close-tool=customFieldOverlay]")
          .last()
          .click();
        await page
          .locator("#productCustomFields input[type=number]")
          .fill("250");
        await page.locator("#productSubmitBtn").click();
        await page
          .locator("#productModalOverlay.hidden")
          .waitFor({ state: "attached" });
        await page.locator("#productsBody tr").first().waitFor();
        // Create a client and a choice field; the value is visible in the detail panel.
        await page.locator(".nav-item[data-view=pipeline]").click();
        await page.locator("#addContactBtn").click();
        await page.locator("#contactSubmitBtn:not([disabled])").waitFor();
        await page.locator("#cFirstName").fill("Northline");
        await page.locator("#cLastName").fill("Labs");
        await page.locator("[data-manage-fields=contact]").click();
        await page.locator("#fieldName").fill("Installation site");
        await page.selectOption("#fieldType", "select");
        await page.locator("#fieldOptions").fill("Lab\nFactory");
        await page.locator("#fieldRequired").check();
        await page.locator("#customFieldForm button:not([type])").click();
        await page.waitForFunction(
          () =>
            document.querySelectorAll("#contactCustomFields [data-custom-key]")
              .length === 1,
        );
        await page
          .locator("[data-close-tool=customFieldOverlay]")
          .last()
          .click();
        await page
          .locator("#contactCustomFields select")
          .selectOption("Factory");
        await page.locator("#contactSubmitBtn").click();
        await page
          .locator("#contactModalOverlay.hidden")
          .waitFor({ state: "attached" });
        await page.locator("#contactsBody tr").first().waitFor();
        await page.locator("#contactsBody tr").first().click();
        await page
          .locator("#contactCustomDetails")
          .getByText("Factory", { exact: true })
          .waitFor();
        await page.screenshot({
          path: path.join(out, `${name}-custom-client.png`),
          animations: "disabled",
        });
        await page.locator("[data-close-panel]").first().click();
        // A saved custom proposal template and global discount create a real multi-page PDF.
        await page.locator(".nav-item[data-view=quotes]").click();
        await page.locator("#addQuoteBtn").click();
        await page.locator("#quoteModalOverlay:not(.hidden)").waitFor();
        await page
          .locator("#quoteContactSelect")
          .selectOption({ label: "Northline Labs" });
        await page
          .locator("#quoteTitleInput")
          .fill("Oferta — sensory i wdrożenie");
        await page.selectOption("#doc-language", "pl");
        await page.selectOption("#doc-layout", "executive");
        await page
          .locator(".line-desc-input")
          .fill("Dostawa i konfiguracja sensora");
        await page.locator(".line-price-input").fill("1000");
        await page.locator(".line-qty-input").fill("2");
        await page.locator(".line-discount-input").fill("10");
        await page.locator("#quoteDiscountType").selectOption("percent");
        await page.locator("#quoteDiscountAmount").fill("10");
        await page.locator("#quoteTaxRate").fill("23");
        const terms = page
          .locator(".quote-document-details")
          .filter({ has: page.locator("#doc-terms") });
        await terms.locator("summary").click();
        await page
          .locator("#doc-terms")
          .fill("Warunki współpracy i przeglądów gwarancyjnych. ".repeat(65));
        await page
          .locator("#doc-scope")
          .fill("Dostawa dwóch sensorów i konfiguracja u klienta.");
        const layout = page
          .locator(".quote-document-details")
          .filter({ has: page.locator("#quoteSectionOrder") });
        await layout.locator("summary").click();
        await page
          .locator("[data-section=items] [data-section-heading]")
          .fill("Wycena przygotowana dla Ciebie");
        await page.locator("#quoteBodySize").fill("11");
        await page.locator("#quoteTemplateName").fill("Mój szablon sensorów");
        await page.locator("#saveQuoteTemplate").click();
        await page.waitForFunction(
          () => document.querySelector("#quoteTemplateSelect").value !== "",
        );
        assert.match(
          await page.locator("#quoteTotalValue").textContent(),
          /1[\s,.]?992[,.]60|1,992.60/,
        );
        await page.locator("#quoteSavePdfBtn").click();
        await page.waitForFunction(
          () =>
            document.querySelector("#quotePdfFrame").dataset.rendered ===
            "true",
        );
        await page.screenshot({
          path: path.join(out, `${name}-custom-template-pdf.png`),
          animations: "disabled",
        });
        const pdf = await page.evaluate(async () => {
          const id = document.querySelector("#quoteId").value,
            r = await fetch("/api/quotes/" + id + "/pdf", {
              headers: API.headers(),
            });
          return [...new Uint8Array(await r.arrayBuffer())];
        });
        assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), "%PDF-");
        if (name === "chromium")
          fs.writeFileSync(
            path.join(out, "custom-template.pdf"),
            Buffer.from(pdf),
          );
        await page.locator("#closeQuotePdfBtn").click();
        await page.locator("#closeQuoteModalBtn").click();
        await page.locator("#addQuoteBtn").click();
        await page
          .locator("#quoteTemplateSelect option")
          .nth(1)
          .waitFor({ state: "attached" });
        await page
          .locator("#quoteTemplateSelect")
          .selectOption({ label: "Mój szablon sensorów" });
        await page.locator("#applyQuoteTemplate").click();
        assert.equal(
          await page.locator("#quoteDiscountType").inputValue(),
          "percent",
        );
        assert.equal(
          await page.locator("#doc-layout").inputValue(),
          "executive",
        );
        assert.equal(await page.locator("#doc-buyer-name").inputValue(), "");
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(
          await page
            .locator(".quote-modal")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        );
        await page.screenshot({
          path: path.join(out, `${name}-custom-template-mobile.png`),
          animations: "disabled",
        });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.locator("#closeQuoteModalBtn").click();
        // A due warranty item produces a coloured alert, and a completed review advances it.
        await page.locator(".nav-item[data-view=reminders]").click();
        await page.locator("#addWarrantyBtn").click();
        await page.locator("#warrantySave:not([disabled])").waitFor();
        await page
          .locator("#warrantyContact")
          .selectOption({ label: "Northline Labs" });
        await page
          .locator("#warrantyProduct")
          .selectOption({ label: "Precision sensor" });
        const today = await page.evaluate(() =>
          new Intl.DateTimeFormat("en-CA").format(new Date()),
        );
        const yearAgo = String(Number(today.slice(0, 4)) - 1) + today.slice(4);
        await page.locator("#warrantyPurchased").fill(yearAgo);
        await page.locator("#warrantyNext").fill(today);
        await page.locator("#warrantySerial").fill("SN-QA-001");
        await page.locator("#warrantySave").click();
        await page
          .locator("#warrantyOverlay.hidden")
          .waitFor({ state: "attached" });
        await page.locator(".warranty-card.is-due").waitFor();
        assert.equal(
          await page.locator("#warrantyBellCount").textContent(),
          "1",
        );
        await page.locator("#warrantyBell").click();
        await page.locator(".warranty-alert").waitFor();
        assert.match(
          await page.locator(".warranty-alert").textContent(),
          /Northline Labs/,
        );
        await page.screenshot({
          path: path.join(out, `${name}-warranty-notification.png`),
          animations: "disabled",
        });
        await page.locator("[data-close-tool=warrantyNotifications]").click();
        await page.locator("[data-review-warranty]").click();
        await page
          .locator("#reviewNotes")
          .fill("Przegląd i kalibracja wykonane.");
        await page.locator("#reviewSave").click();
        await page
          .locator("#warrantyReviewOverlay.hidden")
          .waitFor({ state: "attached" });
        await page.waitForFunction(
          () => document.querySelector("#warrantyBellCount").hidden,
        );
        assert.equal(await page.locator(".warranty-card.is-due").count(), 0);
        // Personal is empty, copies selected products, and stays independent of Team.
        await page.locator("[data-switch-space=personal]").click();
        await page.waitForFunction(
          () => document.body && document.body.dataset.space === "personal",
        );
        await page.locator("#emptyState:not(.hidden)").waitFor();
        assert.equal(
          await page.locator(".nav-item[data-view=team]").isVisible(),
          false,
        );
        await page.locator("#copyTeamBtn").click();
        await page.locator("#copyRecordList input").first().waitFor();
        await page.locator("#copyAllRecords").uncheck();
        await page.locator("#copyRecordList input").first().check();
        await page.locator("#copyRunBtn:not([disabled])").click();
        await page.waitForFunction(
          () =>
            document.body &&
            document.body.dataset.space === "personal" &&
            document.querySelector("#copyTeamBtn") &&
            !document.querySelector("#copyTeamBtn").hidden,
        );
        await page.locator(".nav-item[data-view=products]").click();
        await page.locator("#productsBody tr").first().waitFor();
        assert.equal(await page.locator("#productsBody tr").count(), 1);
        await page.locator("[data-edit-product]").first().click();
        await page.locator("#productSubmitBtn:not([disabled])").waitFor();
        assert.equal(
          await page.locator("#productWarrantyMonths").inputValue(),
          "60",
        );
        assert.equal(
          await page
            .locator("#productCustomFields input[type=number]")
            .inputValue(),
          "250",
        );
        await page.locator("#productName").fill("My private sensor");
        await page.locator("#productPrice").fill("1800");
        await page.locator("#productSubmitBtn").click();
        await page
          .locator("#productModalOverlay.hidden")
          .waitFor({ state: "attached" });
        await page.locator("#copyTeamBtn").click();
        await page.locator("#copyMode").selectOption("everything");
        await page.locator("#copyRunBtn:not([disabled])").click();
        await page.waitForFunction(
          () =>
            document.body &&
            document.body.dataset.space === "personal" &&
            document.querySelector("#copyTeamBtn") &&
            !document.querySelector("#copyTeamBtn").hidden,
        );
        await page.locator("#contactsBody tr").first().waitFor();
        await page.locator(".nav-item[data-view=products]").click();
        await page.locator("#productsBody tr").first().waitFor();
        assert.match(
          await page.locator("#productsBody").textContent(),
          /My private sensor/,
        );
        assert.equal(await page.locator("#productsBody tr").count(), 1);
        await page.screenshot({
          path: path.join(out, `${name}-personal-products.png`),
          animations: "disabled",
        });
        await page.locator("[data-switch-space=team]").click();
        await page.waitForFunction(
          () => document.body && document.body.dataset.space === "team",
        );
        await page.locator(".nav-item[data-view=products]").click();
        await page.locator("#productsBody tr").first().waitFor();
        assert.match(
          await page.locator("#productsBody").textContent(),
          /Precision sensor/,
        );
        assert.doesNotMatch(
          await page.locator("#productsBody").textContent(),
          /My private sensor/,
        );
        await page.locator(".nav-item[data-view=team]").click();
        await page.locator("#teamAuditRows tr").first().waitFor();
        assert.match(
          await page.locator("#teamAuditRows").textContent(),
          /POST|PUT/,
        );
        await page.screenshot({
          path: path.join(out, `${name}-owner-audit.png`),
          animations: "disabled",
        });
        // The landing customization tab and actual demo remain usable at narrow widths.
        await page.goto(base + "/customization");
        await page.locator("#customDemoName").fill("Fleet size");
        await page.locator("#customDemoForm button").click();
        await page.locator("#customDemoFields input").fill("14");
        assert.match(
          await page.locator("#customDemoFields").textContent(),
          /Fleet size/,
        );
        for (const width of [1440, 1100, 760, 390, 360]) {
          await page.setViewportSize({ width, height: 1000 });
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            name + " customization overflow " + width,
          );
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.screenshot({
          path: path.join(out, `${name}-customization-landing.png`),
          fullPage: true,
          animations: "disabled",
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: path.join(out, `${name}-customization-landing-mobile.png`),
          fullPage: true,
          animations: "disabled",
        });
        assert.deepEqual(errors, [], name + " uncaught browser errors");
        console.log(
          name +
            ": PASS — real PostgreSQL: custom record fields, own editable proposal template, global discount and rendered PDF, warranty notification and review, Team/Personal switching, selective and full independent copies, owner audit, responsive customization page.",
        );
      } catch (e) {
        const p = browser.contexts()[0]?.pages()[0];
        if (p) {
          await p
            .screenshot({
              path: path.join(out, `${name}-failure.png`),
              fullPage: true,
            })
            .catch(() => {});
          console.error(
            "UI at failure:",
            (await p.locator("body").innerText()).slice(-1800),
          );
        }
        throw e;
      } finally {
        await browser.close();
      }
    }
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await new Promise((r) => setTimeout(r, 20));
    await db.pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
