const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { chromium, webkit } = require("playwright");
(async () => {
  const f = await require("./helpers/calendar-fixture")();
  const out =
    process.env.KLYO_QA_SCREENSHOTS ||
    path.join(require("os").tmpdir(), "klyo-language-qa");
  fs.mkdirSync(out, { recursive: true });
  try {
    // These names deliberately collide with English UI labels: records must never be translated.
    await f.db.query(
      "INSERT INTO contacts(workspace_id,full_name,first_name,email,notes) VALUES($1,'Save','Save','save@example.test','Cancel — this is my own note')",
      [f.w],
    );
    await f.db.query(
      "INSERT INTO products(workspace_id,name,unit_price,currency) VALUES($1,'Delete',123,'PLN')",
      [f.w],
    );
    for (const [name, engine, executablePath] of [
      ["chromium", chromium, process.env.KLYO_CHROMIUM_PATH],
      ["webkit", webkit, process.env.KLYO_WEBKIT_PATH],
    ]) {
      if (process.env.KLYO_BROWSER && process.env.KLYO_BROWSER !== name)
        continue;
      await f.db.query("UPDATE users SET language='pl' WHERE id=$1", [
        f.users[0].id,
      ]);
      const browser = await engine.launch({ headless: true, executablePath });
      try {
        const context = await browser.newContext({
          viewport: { width: 1500, height: 1000 },
          locale: "en-US",
          reducedMotion: "reduce",
        });
        await context.addInitScript(
          ({ token, user }) => {
            if (!localStorage.getItem("languageQa")) {
              localStorage.setItem("klyo_token", token);
              localStorage.setItem("klyo_user", JSON.stringify(user));
              localStorage.setItem("klyo_lang", "en");
              localStorage.setItem("languageQa", "1");
            }
          },
          { token: f.token(0), user: f.users[0] },
        );
        const page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("dialog", (d) => d.accept());
        await page.goto(f.base + "/app", { waitUntil: "networkidle" });
        await page.waitForFunction(() => KlyoI18n.getLang() === "pl");
        const untranslated = {};
        for (const view of [
          "pipeline",
          "companies",
          "deals",
          "quotes",
          "products",
          "clients",
          "tasks",
          "calendar",
          "reminders",
          "files",
          "commercial",
          "projects",
          "orders",
          "equipment",
          "inbox",
          "rfq",
          "history",
          "team",
          "overview",
        ]) {
          await page.evaluate((v) => switchView(v), view);
          await page.waitForLoadState("networkidle");
          untranslated[view] = await page.evaluate(() =>
            [...document.querySelectorAll("body *")]
              .filter(
                (n) =>
                  !n.children.length &&
                  n.getClientRects().length &&
                  getComputedStyle(n).visibility !== "hidden",
              )
              .map((n) => n.textContent.trim())
              .filter((s) => s && KlyoCopy.has(s) && KlyoCopy.text(s) !== s),
          );
        }
        fs.writeFileSync(
          path.join(out, name + "-language-audit.json"),
          JSON.stringify(untranslated, null, 2),
        );
        await page.locator("#appearanceBtn").click();
        await page.locator("[data-settings-tab=account]").click();
        assert.equal(await page.locator("#appLangPicker option").count(), 2);
        assert.equal(
          await page
            .locator("[data-language-choice=pl]")
            .getAttribute("aria-pressed"),
          "true",
        );
        assert.equal(
          await page
            .locator("[data-language-choice=pl] img")
            .getAttribute("src"),
          "/images/flag-pl.svg",
        );
        await page.screenshot({
          path: path.join(out, name + "-settings-pl.png"),
        });
        // A failed account save must not change the language or reload away from the form.
        await page.route("**/api/auth/language", (r) =>
          r.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Could not save language." }),
          }),
        );
        await page.locator("[data-language-choice=en]").click();
        await page
          .getByText("Nie udało się zapisać języka.", { exact: true })
          .waitFor();
        assert.equal(await page.evaluate(() => KlyoI18n.getLang()), "pl");
        await page.unroute("**/api/auth/language");
        await Promise.all([
          page.waitForEvent("load"),
          page.locator("[data-language-choice=en]").click(),
        ]);
        await page.waitForLoadState("networkidle");
        assert.equal(
          (
            await f.db.query("SELECT language FROM users WHERE id=$1", [
              f.users[0].id,
            ])
          ).rows[0].language,
          "en",
        );
        assert.equal(await page.locator("html").getAttribute("lang"), "en");
        await page.locator("#appearanceBtn").click();
        await page.locator("[data-settings-tab=account]").click();
        assert.equal(
          await page
            .locator("[data-language-choice=en]")
            .getAttribute("aria-pressed"),
          "true",
        );
        await page.screenshot({
          path: path.join(out, name + "-settings-en.png"),
        });
        await Promise.all([
          page.waitForEvent("load"),
          page.locator("[data-language-choice=pl]").click(),
        ]);
        await page.waitForLoadState("networkidle");
        await page.locator(".nav [data-view=pipeline]").click();
        assert.ok(
          (await page.locator("#contactsBody").innerText()).includes("Save"),
        );
        await page.locator("#addContactBtn").click();
        await page.screenshot({
          path: path.join(out, name + "-contact-pl.png"),
        });
        await page.keyboard.press("Escape");
        // Each guide has complete separate language bodies and follows the selected preference.
        for (const guide of [
          "sales-and-operations",
          "calendar-setup",
          "communications-setup",
          "sharepoint-setup",
          "sms-security",
          "visual-workspace",
        ]) {
          await page.goto(f.base + "/docs/" + guide + ".html", {
            waitUntil: "networkidle",
          });
          assert.equal(
            await page.locator("main:visible").getAttribute("data-doc-lang"),
            "pl",
          );
          assert.ok(
            (await page.locator("main:visible").innerText()).length > 800,
          );
          await page.locator("[data-language-choice=en]").click();
          assert.equal(
            await page.locator("main:visible").getAttribute("data-doc-lang"),
            "en",
          );
          await page.reload();
          assert.equal(
            await page.locator("main:visible").getAttribute("data-doc-lang"),
            "en",
          );
          await page.locator("[data-language-choice=pl]").click();
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: path.join(out, name + "-guide-mobile-pl.png"),
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.goto(f.base + "/login", { waitUntil: "networkidle" });
        // Login retains the selected language without adding language controls to the card.
        await page.evaluate(() => {
          API.clearToken();
        });
        await page.goto(f.base + "/login", { waitUntil: "networkidle" });
        assert.equal(await page.locator("[data-language-choice]").count(), 0);
        assert.equal(await page.locator("html").getAttribute("lang"), "pl");
        await page.locator("#goSignupBtn").click();
        await page.locator("#signupScreen:not(.hidden)").waitFor();
        await page.locator("#joinModeBtn").click();
        assert.equal(await page.locator("#signupInvite").isVisible(), true);
        await page.screenshot({ path: path.join(out, name + "-login-pl.png") });
        assert.deepEqual(errors, []);
        assert.equal(
          (
            await f.db.query(
              "SELECT notes FROM contacts WHERE full_name='Save' AND workspace_id=$1",
              [f.w],
            )
          ).rows[0].notes,
          "Cancel — this is my own note",
        );
        assert.equal(
          (
            await f.db.query(
              "SELECT name FROM products WHERE name='Delete' AND workspace_id=$1",
              [f.w],
            )
          ).rows[0].name,
          "Delete",
        );
        await context.close();
        const noJS = await browser.newContext({ javaScriptEnabled: false });
        const plain = await noJS.newPage();
        await plain.goto(f.base + "/docs/sales-and-operations.html");
        assert.equal(
          await plain.locator("main:visible").getAttribute("data-doc-lang"),
          "en",
        );
        await noJS.close();
        console.log(
          "PASS",
          name,
          "account language persistence, rollback, record integrity, SVG flags and bilingual guides",
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
