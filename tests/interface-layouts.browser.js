const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { chromium, webkit } = require("playwright");
(async () => {
  const f = await require("./helpers/calendar-fixture")(),
    out =
      process.env.KLYO_QA_SCREENSHOTS ||
      path.join(require("node:os").tmpdir(), "klyo-interface-qa");
  fs.mkdirSync(out, { recursive: true });
  const req = async (p, m = "GET", b, u = 0, scope = "team") => {
    const r = await f.req(p, m, b, u, scope);
    assert.ok(r.status < 400, JSON.stringify(r));
    return r.data;
  };
  try {
    await f.db.query(
      "INSERT INTO companies(workspace_id,name) VALUES($1,'Northline'),($1,'Atlas Studio')",
      [f.w],
    );
    for (const name of ["Anna Reed", "Oliver Chen", "Maya Green"])
      await req("/contacts", "POST", {
        full_name: name,
        email: name.split(" ")[0].toLowerCase() + "@sample.test",
        status: "contacted",
      });
    for (const [engineName, engine, executablePath] of [
      ["chromium", chromium, process.env.KLYO_CHROMIUM_PATH],
      ["webkit", webkit, process.env.KLYO_WEBKIT_PATH],
    ]) {
      if (process.env.KLYO_BROWSER && process.env.KLYO_BROWSER !== engineName)
        continue;
      await req(
        "/auth/preferences",
        "PUT",
        require("../public/js/preferences-core").defaults("day"),
      );
      const browser = await engine.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
      });
      try {
        const page = await browser.newPage({
            viewport: { width: 1512, height: 982 },
          }),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route(
          /^https:\/\/(fonts\.googleapis|fonts\.gstatic)\./,
          (route) => route.abort(),
        );
        await page.addInitScript(
          (token) => localStorage.setItem("klyo_token", token),
          f.token(0),
        );
        await page.goto(f.base + "/app");
        await page.waitForSelector("#miyEditInterface");
        await page.waitForSelector(".workspace-switch-wrap");
        await page.waitForFunction(
          () => document.body.dataset.view === "pipeline",
        );
        const snap = async (name) =>
          page.screenshot({
            path: path.join(out, engineName + "-" + name + ".png"),
            fullPage: true,
          });
        assert.equal(await page.locator("#platformNavItem").isVisible(), false);
        console.log(engineName + ": boot ready");
        for (const preset of ["classic", "explorer", "notebook", "command"]) {
          await page.locator("#miyEditInterface").click();
          await page
            .locator(
              '#interfaceEditor [data-interface-preset="' + preset + '"]',
            )
            .click();
          await page.locator("#miySave").click();
          await page.waitForSelector("#interfaceEditor", { state: "detached" });
          assert.equal(
            await page.getAttribute("body", "data-interface"),
            preset,
          );
          assert.equal(
            await page.locator("#signOutBtn").isVisible(),
            true,
            "Sign out stays accessible: " + preset,
          );
          assert.equal(
            await page.locator("#helpFab").isVisible(),
            true,
            "Help stays accessible: " + preset,
          );

          await page.waitForTimeout(100);
          await snap("layout-" + preset);
          console.log(engineName + ": preset " + preset);
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            "Desktop overflow: " + preset,
          );
          if (preset === "command") {
            assert.equal(
              await page.getAttribute("body", "data-sidebar"),
              "top",
            );
            assert.ok(
              await page
                .locator(".sidebar")
                .evaluate((n) => n.getBoundingClientRect().height < 180),
            );
            await page
              .locator('.personal-nav details[data-section="sales"] summary')
              .click();
            await page.locator('.personal-nav [data-view="companies"]').click();
            await page.waitForFunction(
              () => document.body.dataset.view === "companies",
            );
          }
        }
        console.log(engineName + ": preset checks passed");
        // Customize real working pages, navigation, shortcuts and a named layout.
        await page.locator("#miyEditInterface").click();
        await page
          .locator('#interfaceEditor [data-interface-preset="explorer"]')
          .click();
        await page.locator('[data-editor-tab="modules"]').click();
        await page.locator('[data-module-visible="rfq"]').uncheck();
        await page.locator('[data-module-group="inbox"]').selectOption("sales");
        await page.locator('[data-group-name="sales"]').fill("My sales desk");
        await page.locator('[data-group-name="sales"]').dispatchEvent("change");
        await page.locator('[data-editor-tab="page"]').click();
        await page.locator("#miyPageSelect").selectOption("pipeline");
        await page.waitForFunction(
          () => document.body.dataset.view === "pipeline",
        );
        await page.locator('[data-page-visible="summary"]').uncheck();
        await page.locator('[data-page-span="toolbar"]').selectOption("6");
        await page
          .locator('[data-page-move="records"][data-step="-1"]')
          .click();
        assert.equal(
          await page.locator("#pipelineView>.stat-grid").isVisible(),
          false,
        );
        assert.equal(await page.locator("#contactsTable").isVisible(), true);
        await page.locator('[data-editor-tab="shortcuts"]').click();
        await page.locator('[data-shortcut="new_deal"]').check();
        await page.locator('[data-shortcut="integrations"]').check();
        await page
          .locator('[data-interface-control="quick_position"]')
          .selectOption("workspace");
        // Native drag/drop uses the same code path as pointer interaction in the canvas.
        await page
          .locator('[data-shortcut-drag="new_contact"]')
          .dragTo(page.locator('[data-drop-zone="header"]'));
        assert.equal(
          await page.getAttribute("#miyQuickActions", "data-position"),
          "header",
        );
        await page.locator('[data-editor-tab="structure"]').click();
        await page.locator("#miySaveNamed input").fill("My daily workspace");
        await page.locator("#miySaveNamedBtn").click();
        assert.ok(
          (await page.locator("#miySavedList").innerText()).includes(
            "My daily workspace",
          ),
        );
        await snap("workspace-designer");
        await page.locator("#miySave").click();
        await page.waitForSelector("#interfaceEditor", { state: "detached" });
        let stored = (await req("/auth/preferences")).preferences;
        assert.ok(stored.layout.hidden_nav.includes("rfq"));
        assert.equal(stored.layout.ui.module_groups.inbox, "sales");
        assert.equal(stored.layout.ui.section_names.sales, "My sales desk");
        assert.ok(stored.layout.ui.pages.pipeline.hidden.includes("summary"));
        assert.equal(stored.layout.ui.saved.length, 1);
        assert.ok(stored.layout.ui.quick_actions.includes("new_contact"));
        assert.equal(
          (await req("/auth/preferences", "GET", undefined, 1)).preferences
            .layout.ui.preset,
          "classic",
        );
        assert.equal((await req("/auth/me")).user.is_platform_admin, false);
        const platform = await req("/integrations/platform/status");
        assert.deepEqual(Object.keys(platform).sort(), [
          "ai_configured",
          "billing_configured",
          "google_signin_configured",
        ]);
        assert.ok(Object.values(platform).every((v) => typeof v === "boolean"));
        await page.reload();
        await page.waitForSelector("#miyEditInterface");
        await page.waitForFunction(
          () => document.body.dataset.view === "pipeline",
        );
        assert.equal(
          await page.locator("#pipelineView>.stat-grid").isVisible(),
          false,
        );
        // Named layouts reload structure, and navigation resizing has a keyboard equivalent.
        await page.locator("#miyEditInterface").click();
        await page.locator(".miy-nav-resize").focus();
        await page.keyboard.press("ArrowRight");
        assert.equal(
          await page
            .locator(".sidebar")
            .evaluate((n) => Math.round(n.getBoundingClientRect().width)),
          308,
        );
        await page.locator("#miyUndo").click();
        assert.equal(
          await page
            .locator(".sidebar")
            .evaluate((n) => Math.round(n.getBoundingClientRect().width)),
          300,
        );
        await page
          .locator("[data-interface-control=sidebar]")
          .selectOption("right");
        await page.locator("[data-load-layout]").click();
        assert.equal(await page.getAttribute("body", "data-sidebar"), "left");
        await page.locator("#miySave").click();
        await page.waitForSelector("#interfaceEditor", { state: "detached" });

        // Hidden feature can still be found without changing visibility or permissions.
        await page.locator("#miyModuleDirectory").click();
        await page.locator('[data-open-module="rfq"]').click();
        await page.waitForFunction(() => document.body.dataset.view === "rfq");
        await page.locator("#miyModuleDirectory").click();
        await page.locator('[data-open-module="pipeline"]').click();
        // Editor blocks record creation. Cancel and failed saves keep persisted preferences unchanged.
        await page.locator("#miyEditInterface").click();
        const blocked = await page.evaluate(() =>
          API.post("/contacts", { full_name: "Must not be created" })
            .then(() => false)
            .catch((e) => e.message),
        );
        assert.match(blocked, /Save or cancel your layout/);
        await page.locator("[data-editor-tab=page]").click();
        for (const view of [
          "companies",
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
          "deals",
        ]) {
          await page.locator("#miyPageSelect").selectOption(view);
          await page.waitForFunction(
            (v) => document.body.dataset.view === v,
            view,
          );
          await page.locator("[data-page-visible=records]").waitFor();
          assert.equal(
            await page.locator("[data-page-visible=records]").isDisabled(),
            true,
            "Main records remain available: " + view,
          );
        }
        await page.locator("#miyPageSelect").selectOption("pipeline");

        await page.locator("#addContactBtn").click({ force: true });
        assert.equal(
          await page.locator("#contactModalOverlay").isVisible(),
          false,
        );
        await page.locator("[data-editor-tab=structure]").click();
        await page
          .locator('#interfaceEditor [data-interface-preset="notebook"]')
          .click();
        await page.locator("#miyCancelBottom").click();
        assert.equal(
          await page.getAttribute("body", "data-interface"),
          "explorer",
        );
        await page.locator("#miyEditInterface").click();
        await page
          .locator('#interfaceEditor [data-interface-preset="command"]')
          .click();
        await page.route("**/api/auth/preferences", (route) =>
          route.request().method() === "PUT"
            ? route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({ error: "Fixture save failure" }),
              })
            : route.continue(),
        );
        await page.locator("#miySave").click();
        await page.waitForFunction(() =>
          document
            .getElementById("miyEditorError")
            .textContent.includes("Fixture save failure"),
        );
        await page.locator("#miyCancelBottom").click();
        await page.unroute("**/api/auth/preferences");
        assert.equal(
          (await req("/auth/preferences")).preferences.layout.ui.base,
          "explorer",
        );
        console.log(engineName + ": layout persistence and rollback passed");
        // Integration directory: every existing integration, honest states and actual credential forms.
        await page.locator("#appearanceBtn").click();
        await page.locator("#integrationsSettingsTab").click();
        await page.waitForSelector('[data-integration="fakturownia"]');
        assert.equal(await page.locator("[data-integration]").count(), 16);
        assert.match(
          await page.locator('[data-integration="dropbox"]').innerText(),
          /Operator setup needed/,
        );
        await snap("integrations");
        await page.locator('[data-integration-action="fakturownia"]').click();
        const dialog = page.locator(".doc-overlay").last();
        await dialog.locator('[name="subdomain"]').fill("sample-firm");
        await dialog.locator('[name="key"]').fill("fixture-secret-fakturownia");
        await dialog.locator('button[type="submit"]').click();
        await page.waitForFunction(() =>
          document
            .querySelector('[data-integration="fakturownia"]')
            ?.textContent.includes("Credentials saved"),
        );
        assert.equal(
          (await req("/communications/invoice-provider")).subdomain,
          "sample-firm",
        );
        assert.ok(
          !(await page.locator("#integrationDirectory").innerText()).includes(
            "fixture-secret-fakturownia",
          ),
        );
        await page.locator('[data-integration-action="apollo"]').click();
        await page
          .locator(".doc-overlay")
          .last()
          .locator('[name="key"]')
          .fill("fixture-apollo-key");
        await page
          .locator(".doc-overlay")
          .last()
          .locator('button[type="submit"]')
          .click();
        await page.waitForFunction(() =>
          document
            .querySelector('[data-integration="apollo"]')
            ?.textContent.includes("Credentials saved"),
        );
        assert.equal(
          (await req("/communications/status")).apollo_connected,
          true,
        );
        await page.locator('[data-integration-action="dhl"]').click();
        await page
          .locator(".doc-overlay")
          .last()
          .locator('[name="key"]')
          .fill("fixture-dhl-key");
        await page
          .locator(".doc-overlay")
          .last()
          .locator('button[type="submit"]')
          .click();
        await page.waitForFunction(() =>
          document
            .querySelector('[data-integration="dhl"]')
            ?.textContent.includes("Credentials saved"),
        );
        assert.equal(
          (await req("/operations/tracking/status")).configured,
          true,
        );

        assert.equal(
          (await req("/communications/status", "GET", undefined, 0, "personal"))
            .apollo_connected,
          false,
        );
        assert.equal(
          (
            await req(
              "/communications/invoice-provider",
              "GET",
              undefined,
              0,
              "personal",
            )
          ).connected,
          false,
        );
        assert.equal(
          (
            await req(
              "/operations/tracking/status",
              "GET",
              undefined,
              0,
              "personal",
            )
          ).configured,
          false,
        );
        await page.locator('[data-integration-action="smtp"]').click();
        assert.equal(await page.locator("#smtpHost").isVisible(), true);
        await page.locator("#closeAppearanceBtn").click();
        // Real client form and Quote Creator remain usable after arranging the shell.
        await page.locator('[data-quick-action="new_contact"]').click();
        await page.waitForSelector("#contactModalOverlay:not(.hidden)");
        await page.locator("#contactModalOverlay .modal-close").click();
        await page.locator("#miyModuleDirectory").click();
        await page.locator('[data-open-module="quotes"]').click();
        await page.locator("#addQuoteBtn").click();
        await page.waitForSelector("#quoteModalOverlay:not(.hidden)");
        await page.locator("#closeQuoteModalBtn").click();
        console.log(engineName + ": integration forms passed");
        // Polish labels, dark palette and compact mobile remain functional.
        await req("/auth/language", "PUT", { language: "pl" });
        await page.reload();
        await page.waitForSelector("#miyEditInterface");
        await page.locator("#appearanceBtn").click();
        assert.equal(
          await page.locator("#integrationsSettingsTab").innerText(),
          "Integracje",
        );
        await page.locator("#integrationsSettingsTab").click();
        await page.waitForSelector('[data-integration="apollo"]');
        await page.locator("#integrationSearch").fill("Fakturownia");
        assert.equal(
          await page.locator(".integration-card:visible").count(),
          1,
        );
        await snap("integrations-polish");
        await page.locator("#closeAppearanceBtn").click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator("#miyEditInterface").click();
        await page
          .locator('#interfaceEditor [data-interface-preset="command"]')
          .click();
        await snap("designer-mobile");
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.locator("#miyCancelBottom").click();
        // No privilege shortcuts for a viewer; private calendar/security remain available.
        const viewer = await browser.newPage({
          viewport: { width: 1360, height: 900 },
        });
        await viewer.addInitScript(
          (token) => localStorage.setItem("klyo_token", token),
          f.token(2),
        );
        await viewer.goto(f.base + "/app");
        await viewer.waitForSelector("#miyEditInterface");
        await viewer.locator("#appearanceBtn").click();
        await viewer.locator("#integrationsSettingsTab").click();
        await viewer.waitForSelector('[data-integration="fakturownia"]');
        assert.equal(
          await viewer
            .locator('[data-integration-action="fakturownia"]')
            .isDisabled(),
          true,
        );
        assert.equal(
          await viewer
            .locator('[data-integration-action="apollo"]')
            .isDisabled(),
          true,
        );
        assert.equal(
          await viewer
            .locator('[data-integration-action="google_calendar"]')
            .isDisabled(),
          false,
        );
        assert.equal(
          await viewer.locator("#platformNavItem").isVisible(),
          false,
        );
        await viewer.close();
        assert.deepEqual(errors, []);
        console.log(
          engineName +
            ": all presets, live page edits, native shortcut drag, hide/restore, named layouts, rollback, integration forms, permissions, EN/PL and mobile PASS",
        );
        await page.close();
        await req("/auth/language", "PUT", { language: "en" });
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
