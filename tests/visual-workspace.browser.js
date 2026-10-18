const assert = require("node:assert/strict"),
  fs = require("fs"),
  path = require("path"),
  bcrypt = require("bcryptjs"),
  { chromium, webkit } = require("playwright");
(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL");
  const f = await require("./helpers/calendar-fixture")(),
    M = require("../server/services/mfa"),
    originalProvider = M.provider;
  const out =
    process.env.KLYO_QA_SCREENSHOTS ||
    path.join(require("os").tmpdir(), "klyo-visual-qa");
  fs.mkdirSync(out, { recursive: true });
  Object.assign(process.env, {
    TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32),
    TWILIO_AUTH_TOKEN: "fixture-only",
    TWILIO_VERIFY_SERVICE_SID: "VA" + "2".repeat(32),
  });
  M.provider = async (p, b) =>
    p === "Verifications"
      ? { sid: "VE" + "3".repeat(32), status: "pending" }
      : { status: b.Code === "123456" ? "approved" : "pending" };
  const ok = (r) => {
      assert.ok(r.status < 400, JSON.stringify(r.data));
      return r.data;
    },
    api = async (p, m = "GET", b) => ok(await f.req(p, m, b));
  try {
    f.users[0].email = f.users[0].email.toLowerCase();
    await f.db.query(
      "UPDATE users SET email=lower(email),password_hash=$1 WHERE id=$2",
      [await bcrypt.hash("Strong-test-42", 4), f.users[0].id],
    );
    await f.db.query(
      "UPDATE workspaces SET default_currency='PLN' WHERE id=$1",
      [f.w],
    );
    const company = (
      await f.db.query(
        "INSERT INTO companies(workspace_id,name,tax_id) VALUES($1,'Northline Manufacturing','PL123456') RETURNING *",
        [f.w],
      )
    ).rows[0];
    const contact = (
      await f.db.query(
        "INSERT INTO contacts(workspace_id,full_name,first_name,email,company_id) VALUES($1,'Anna Buyer','Anna','anna@example.test',$2) RETURNING *",
        [f.w, company.id],
      )
    ).rows[0];
    const products = [];
    for (const [name, price] of [
      ["Motherboard", 100],
      ["RAM", 100],
      ["CPU", 200],
      ["GPU", 400],
    ]) {
      const p = (
        await f.db.query(
          "INSERT INTO products(workspace_id,name,unit_price,currency) VALUES($1,$2,$3,'PLN') RETURNING *",
          [f.w, name, price],
        )
      ).rows[0];
      products.push(p);
      await f.db.query(
        "INSERT INTO product_purchase_prices(workspace_id,product_id,currency,unit_cost) VALUES($1,$2,'PLN',$3)",
        [f.w, p.id, price / 2],
      );
    }
    const won = (
      await api("/deals", "POST", {
        title: "Won sensor rollout",
        value: 5000,
        currency: "PLN",
        status: "won",
        company_id: company.id,
        contact_id: contact.id,
      })
    ).deal;
    await api("/deals", "POST", {
      title: "Lost service contract",
      value: 3000,
      currency: "PLN",
      status: "lost",
      lost_reason: "Timing",
      company_id: company.id,
    });
    await api("/deals", "POST", {
      title: "New pilot",
      value: 8000,
      currency: "PLN",
      probability: 60,
    });
    for (const [name, engine, executablePath] of [
      ["chromium", chromium, process.env.KLYO_CHROMIUM_PATH],
      ["webkit", webkit, process.env.KLYO_WEBKIT_PATH],
    ]) {
      if (process.env.KLYO_BROWSER && process.env.KLYO_BROWSER !== name)
        continue;
      await f.db.query(
        "UPDATE users SET mfa_enabled=true,mfa_version=0,mfa_phone=$2,workspace_preferences='{}'::jsonb WHERE id=$1",
        [f.users[0].id,f.S.encrypt("+48123456789")],
      );
      await f.db.query("DELETE FROM mfa_challenges");
      await f.db.query("DELETE FROM mfa_recovery_codes");
      await f.db.query("DELETE FROM auth_rate_limits");
      const browser = await engine.launch({ headless: true, executablePath });
      try {
        const context = await browser.newContext({
          viewport: { width: 1680, height: 1100 },
          deviceScaleFactor: 1,
          timezoneId: "Europe/Warsaw",
          reducedMotion: "reduce",
        });
        await context.addInitScript(
          ({ token, user }) => {
            if (!localStorage.getItem("klyo_qa_initialized")) {
              localStorage.setItem("klyo_token", token);
              localStorage.setItem("klyo_user", JSON.stringify(user));
              localStorage.setItem("klyo_qa_initialized", "yes");
            }
          },
          { token: f.token(0), user: f.users[0] },
        );
        const page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => {
          errors.push(e.message);
          console.error(name, e.stack);
        });
        page.on("dialog", (d) => d.accept());
        page.on("response", async (r) => {
          if (r.url().includes("/api/") && r.status() >= 400)
            console.error(
              name,
              r.status(),
              r.url(),
              (await r.json().catch(() => ({}))).error,
            );
        });
        await page.goto(f.base + "/app", { waitUntil: "networkidle" });
        await page.locator(".nav [data-view=deals]").click();
        await page.locator("[data-outcome=won]").click();
        assert.equal(await page.locator("#outcomeAllDates").isChecked(), true);
        assert.equal(await page.locator("#outcomeMonth").isDisabled(), true);
        await page
          .locator("#outcomeContent")
          .filter({ hasText: "Won sensor rollout" })
          .waitFor()
          .catch(async (e) => {
            console.error(
              "Outcome error:",
              await page.locator("#outcomeError").innerText(),
              await page.locator("#outcomeCurrency").inputValue(),
            );
            throw e;
          });
        const monthly = page.waitForResponse(
          (r) =>
            r.url().includes("/api/deal-outcomes?") &&
            !r.url().includes("month=all"),
        );
        await page.locator("#outcomeAllDates").uncheck();
        await monthly;
        await page.locator("#outcomeContent[aria-busy=false]").waitFor();
        assert.equal(await page.locator("#outcomeMonth").isDisabled(), false);
        const allHistory = page.waitForResponse(
          (r) =>
            r.url().includes("/api/deal-outcomes?") &&
            r.url().includes("month=all"),
        );
        await page.locator("#outcomeAllDates").check();
        await allHistory;
        await page.locator("#outcomeContent[aria-busy=false]").waitFor();
        await page.locator(`[data-outcome-deal="${won.id}"]`).click();
        await page.locator("#closeDealPanelBtn").click();
        await page.locator("[data-outcome=lost]").click();
        await page
          .locator("#outcomeContent")
          .filter({ hasText: "Lost service contract" })
          .waitFor();
        assert.match(
          await page.locator("#outcomeContent").innerText(),
          /Timing/,
        );
        await page.locator("[data-outcome=results]").click();
        await page.locator("#outcomeContent svg").first().waitFor();
        assert.ok((await page.locator("#outcomeContent svg").count()) >= 3);
        await page.screenshot({
          path: path.join(out, name + "-won-lost.png"),
          fullPage: true,
        });
        await page.locator(".nav [data-view=pipeline]").click();
        await page.evaluate(() => openContactModal());
        await page.locator("#cCompanySelect").selectOption("__new__");
        await page.locator("#newCompanyInlineInput").waitFor();
        const companyInput = await page
          .locator("#newCompanyInlineInput")
          .boundingBox();
        assert.ok(
          companyInput.width >= 300,
          "Inline company name must be readable",
        );
        await page.screenshot({
          path: path.join(out, name + "-company-field.png"),
        });
        await page.locator("#contactModalOverlay .modal-close").click();
        await page.locator(".nav [data-view=overview]").click();
        await page.locator("#dashboardGrid [data-widget-id=metrics]").waitFor();
        await page.locator("#analyticsDashboard[aria-busy=false]").waitFor();
        assert.equal(await page.locator("#customizeDashboardNav").count(), 0);
        assert.equal(
          await page.locator("#customizeDashboardQuick").textContent(),
          "Make It Yours",
        );
        await page.locator("#appearanceBtn").click();
        assert.match(
          await page.locator("[data-settings-tab=personal]").innerText(),
          /Make It Yours/i,
        );
        await page.screenshot({
          path: path.join(out, name + "-make-it-yours-settings.png"),
        });
        await page.locator("#editOverviewWidgets").click();
        await page.locator("#dashboardOrganizer").waitFor();
        assert.equal(
          await page
            .locator("body")
            .evaluate((b) => b.classList.contains("dashboard-editing")),
          true,
        );
        await page.locator("[data-add-widget=shortcut_deal]").click();
        await page
          .locator('[data-widget-id=shortcut_deal] [data-size-widget="-1"]')
          .click();
        await page.locator("[data-widget-id=daily]").hover();
        await page
          .locator("[data-widget-id=daily] [data-remove-widget]")
          .click();
        await page.locator('[data-editor-tab="structure"]').click();
        await page.locator('[data-interface-control="nav_mode"]').selectOption("tiles");
        await page.locator('[data-interface-control="sidebar_width"]').fill("300");
        assert.equal(
          Math.round((await page.locator(".sidebar").boundingBox()).width),
          300,
        );
        assert.ok(
          (
            await page
              .locator(".personal-nav[data-mode=tiles] .nav-item")
              .first()
              .boundingBox()
          ).height >= 68,
        );
        await page.locator('[data-editor-tab="modules"]').click();
        await page.locator('[data-module-visible="equipment"]').uncheck();
        assert.equal(await page.locator('.personal-nav [data-view="equipment"]').isVisible(),false);
        await page.locator('[data-editor-tab="page"]').click();
        await page.locator("#organizerSnap").selectOption("free");
        const dragCard = page.locator("[data-widget-id=shortcut_deal]");
        await dragCard.locator("header strong").scrollIntoViewIfNeeded();
        const beforeDrag = await dragCard.boundingBox(),
          grip = await dragCard.locator("header strong").boundingBox();
        await page.mouse.move(grip.x + 10, grip.y + 8);
        await page.mouse.down();
        await page.mouse.move(grip.x + 83, grip.y + 41, { steps: 12 });
        await page.waitForTimeout(100);
        const live = await dragCard.boundingBox();
        assert.ok(
          live.x > beforeDrag.x + 20,
          "Pointer movement must update the existing widget live",
        );
        assert.equal(
          await dragCard.evaluate((el) =>
            el.classList.contains("widget-moving"),
          ),
          true,
        );
        await page.mouse.up();
        await dragCard.locator(".widget-resize").focus();
        await page.keyboard.press("ArrowDown");
        const beforeResize = await dragCard.boundingBox();
        await dragCard.locator(".widget-resize").scrollIntoViewIfNeeded();
        const resizeGrip = await dragCard
          .locator(".widget-resize")
          .boundingBox();
        await page.mouse.move(resizeGrip.x + 10, resizeGrip.y + 10);
        await page.mouse.down();
        await page.mouse.move(resizeGrip.x + 41, resizeGrip.y + 31, {
          steps: 10,
        });
        await page.mouse.up();
        const resized = await dragCard.boundingBox();
        assert.ok(resized.width > beforeResize.width + 15);
        assert.ok(resized.height > beforeResize.height + 10);
        await page.locator('[data-placement="tilt"]').fill("3.5");
        assert.equal(await dragCard.getAttribute("data-tilt"), "3.5");
        const beforeCount = (await api("/deals")).deals.length;
        await page
          .locator("[data-widget-id=shortcut_deal] .dashboard-shortcut")
          .click({ force: true });
        assert.equal(
          await page.locator("#dealModalOverlay:not(.hidden)").count(),
          0,
        );
        assert.equal((await api("/deals")).deals.length, beforeCount);
        await page.screenshot({
          path: path.join(out, name + "-dashboard-organizer.png"),
          fullPage: true,
        });
        await page.screenshot({
          path: path.join(out, name + "-make-it-yours-editor.png"),
        });
        await page.locator("#miySave").click();
        await page
          .locator("#dashboardOrganizer")
          .waitFor({ state: "detached" });
        await page.reload({ waitUntil: "networkidle" });
        await page.locator(".nav [data-view=overview]").click();
        await page.locator("[data-widget-id=shortcut_deal]").waitFor();
        const savedLayout = await page.evaluate(
            () => KlyoCustomize.getSaved().layout,
          ),
          savedWidget = savedLayout.dashboard.find(
            (w) => w.id === "shortcut_deal",
          );
        assert.equal(savedWidget.tilt, 3.5);
        assert.equal(savedLayout.dashboard_snap, "free");
        assert.ok(
          savedWidget.x % 1 !== 0,
          "Fine positions must persist after reload",
        );
        assert.equal(
          await page.locator("[data-widget-id=daily]").isVisible(),
          false,
        );
        assert.equal(
          await page.locator(".personal-nav").getAttribute("data-mode"),
          "tiles",
        );
        await page.locator("#customizeDashboardQuick").click();
        await page.locator("[data-editor-tab=page]").click();
        await page.locator('[data-placement="tilt"]').fill("-4");
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          "A tilted full-width widget must remain within the workspace",
        );
        await page.locator("[data-widget-id=shortcut_deal]").hover();
        await page
          .locator("[data-widget-id=shortcut_deal] [data-remove-widget]")
          .click();
        await page.locator("#miyCancelBottom").click();
        assert.equal(
          await page
            .locator("[data-widget-id=metrics]")
            .getAttribute("data-tilt"),
          "0",
        );
        assert.equal(
          await page.locator("[data-widget-id=shortcut_deal]").isVisible(),
          true,
        );
        await page
          .locator("[data-widget-id=shortcut_deal] .dashboard-shortcut")
          .click();
        await page.locator("#dealModalOverlay:not(.hidden)").waitFor();
        await page.locator("#closeDealModalBtn").click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: path.join(out, name + "-dashboard-mobile.png"),
          fullPage: true,
        });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.setViewportSize({ width: 1680, height: 1100 });
        const items = products.map((p, i) => ({
          product_id: p.id,
          description: p.name,
          quantity: 1,
          unit_price: p.unit_price,
          discount_percent: i === 2 ? 10 : 0,
          bundle_id: i < 2 ? "pc" : "cpu-gpu",
          show_component_price: i === 2,
        }));
        const groups = [
          {
            id: "pc",
            name: "Complete computer",
            discount_type: "percent",
            discount_value: 5,
          },
          {
            id: "cpu-gpu",
            name: "CPU and GPU",
            parent_id: "pc",
            discount_type: "percent",
            discount_value: 10,
          },
        ];
        const full = await api("/quotes", "POST", {
          contact_id: contact.id,
          company_id: company.id,
          title: "Nested quote " + name,
          currency: "PLN",
          line_items: items,
          discount_type: "percent",
          discount_value: 10,
          document: { pricing_groups: groups, language: "en" },
        });
        assert.equal(Number(full.quote.total), 617.31);
        const margin = await api(
          "/commercial/quotes/" + full.quote.id + "/margins",
        );
        assert.ok(Number.isFinite(margin.profit));
        await page.evaluate((id) => openQuotePanel(id), full.quote.id);
        await page.locator("#editQuoteBtn").click();
        await page.locator("#quoteMarginToggle").waitFor();
        assert.equal(
          await page.locator(".commercial-margins[open]").count(),
          0,
        );
        await page.locator("#quoteMarginToggle").click();
        await page.locator(".commercial-margins[open]").waitFor();
        await page.locator("#quoteMarginToggle").click();
        await page.locator("#quoteGroupsToggle").click();
        await page.locator('[data-pricing-group="cpu-gpu"]').waitFor();
        assert.equal(
          await page
            .locator(
              '[data-pricing-group="cpu-gpu"] [data-group-key=parent_id]',
            )
            .inputValue(),
          "pc",
        );
        assert.equal(
          await page
            .locator(
              '[data-pricing-item="2"] [data-item-key=show_component_price]',
            )
            .isChecked(),
          true,
        );
        await page.screenshot({
          path: path.join(out, name + "-nested-quote-groups.png"),
        });
        await page
          .locator('[data-pricing-group="pc"] [data-group-key=name]')
          .fill("Complete computer QA");
        await page.locator("#applyPricingGroups").click();
        await page.locator("#quoteSavePdfBtn").click();
        await page
          .locator("#quotePdfFrame[data-rendered=true]")
          .waitFor({ timeout: 20000 });
        await page.screenshot({
          path: path.join(out, name + "-nested-quote-pdf.png"),
        });
        fs.writeFileSync(
          path.join(out, name + "-nested-pdf-page.png"),
          Buffer.from(
            await page
              .locator("#quotePdfFrame canvas")
              .evaluate((c) => c.toDataURL("image/png").split(",")[1]),
            "base64",
          ),
        );
        const savedQuote = await api("/quotes/" + full.quote.id);
        assert.equal(
          savedQuote.quote.document.pricing_groups[0].name,
          "Complete computer QA",
        );
        assert.equal(Number(savedQuote.quote.total), 617.31);
        const response = await f.req("/quotes/" + full.quote.id + "/pdf");
        assert.equal(response.status, 200);
        await page.goto(f.base + "/app", { waitUntil: "networkidle" });
        await page.locator("#appearanceBtn").click();
        await page.locator("[data-settings-tab=account]").click();
        await page.locator("#securitySettings").click();
        const security = page.locator(".doc-overlay").last();
        assert.match(await security.innerText(),/SMS verification is always on/);
        assert.equal(await security.locator("form").count(),0,"SMS has no disable form");
        await page.evaluate(() => API.clearToken());
        await page.goto(f.base + "/login.html");
        await page.locator("#goLoginBtn").click();
        await page.locator("#loginEmail").fill(f.users[0].email);
        await page.locator("#loginPassword").fill("Strong-test-42");
        await f.db.query(
          "UPDATE mfa_challenges SET sent_at=now()-interval '61 seconds'",
        );
        await page.locator("#loginSubmitBtn").click();
        await page.locator("#mfaLogin").waitFor();
        await page.screenshot({
          path: path.join(out, name + "-sms-login.png"),
        });
        await page.locator("#mfaLogin input").fill("123456");
        await page.locator("#mfaLogin form button").click();
        await page.waitForURL(/\/app$/);
        await page.locator("#contactsBody tr").first().waitFor();
        for (const route of [
          "features",
          "pricing",
          "why-klyo",
          "make-it-yours",
        ]) {
          await page.goto(f.base + "/" + route, { waitUntil: "networkidle" });
          assert.equal(
            await page
              .locator(".nav-center a[aria-current=page]")
              .getAttribute("href"),
            "/" + route,
          );
          if (route === "features")
            assert.ok(
              (await page.locator(".feature-card-grid article").count()) >= 30,
            );
          if (route === "features")
            await page.locator("#quotes").screenshot({
              path: path.join(out, name + "-colourful-quotes.png"),
            });
          if (route === "why-klyo")
            await page.locator(".why-stories").screenshot({
              path: path.join(out, name + "-colourful-why.png"),
            });
          if (route === "pricing")
            await page.locator("#pricingGrid [data-plan]").first().waitFor();
          await page.screenshot({
            path: path.join(out, name + "-marketing-" + route + ".png"),
            fullPage: true,
          });
          await page.setViewportSize({ width: 390, height: 844 });
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
          if (route === "features")
            await page.screenshot({
              path: path.join(out, name + "-marketing-mobile.png"),
            });
          await page.setViewportSize({ width: 1680, height: 1100 });
        }
        assert.deepEqual(errors, []);
        await context.close();
        console.log(
          name +
            ": PASS Won/Lost, chart dashboard, company field, grid save/cancel/shortcuts/mobile, private margins, nested PDF quote and SMS enrollment/sign-in",
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    M.provider = originalProvider;
    await f.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
