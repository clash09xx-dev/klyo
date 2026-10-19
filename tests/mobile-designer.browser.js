const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { chromium, webkit } = require("playwright");
(async () => {
  const f = await require("./helpers/calendar-fixture")(),
    P = require("../public/js/preferences-core");
  const out =
    process.env.KLYO_QA_SCREENSHOTS || "/private/tmp/klyo-mobile-designer-qa";
  fs.mkdirSync(out, { recursive: true });
  try {
    await f.req("/contacts", "POST", {
      first_name: "Alex",
      last_name: "Morgan",
      email: "alex@mobile.test",
      company: "Northline",
    });
    for (const [name, engine, executablePath] of [
      ["chromium", chromium, process.env.KLYO_CHROMIUM_PATH],
      ["webkit", webkit, process.env.KLYO_WEBKIT_PATH],
    ]) {
      if (process.env.KLYO_BROWSER && process.env.KLYO_BROWSER !== name)
        continue;
      const initial = P.defaults("day");
      await f.req("/auth/preferences", "PUT", initial);
      const browser = await engine.launch({ headless: true, executablePath });
      try {
        const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
        });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        for (const url of [
          "/",
          "/features",
          "/make-it-yours",
          "/pricing",
          "/pl",
          "/pl/funkcje",
        ]) {
          await page.goto(f.base + url, { waitUntil: "networkidle" });
          assert.equal(
            await page.locator(".login-link").isVisible(),
            true,
            url + " visible login",
          );
          const hb = await page.locator(".site-header").boundingBox();
          assert.ok(hb.height < 110, url + " compact header");
          await page.locator(".mobile-site-toggle").tap();
          assert.equal(await page.locator(".nav-center").isVisible(), true);
          assert.equal(await page.locator(".seo-language").isVisible(), true);
          await page.locator(".mobile-site-toggle").tap();
          assert.equal(await page.locator(".nav-center").isVisible(), false);
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            url + " fits",
          );
        }
        await page.goto(f.base + "/");
        await page.screenshot({ path: path.join(out, name + "-landing.png") });
        await page.addInitScript(
          (token) => localStorage.setItem("klyo_token", token),
          f.token(0),
        );
        await page.goto(f.base + "/app");
        await page.waitForSelector("#miyEditInterface", { state: "attached" });
        await page.waitForSelector("#contactsTable");
        await page.locator('#mobileHud [data-mobile-action="more"]').tap();
        await page.locator("#appearanceBtn").tap();
        await page.waitForSelector("#appearanceModalOverlay:not(.hidden)");
        await page.locator("#createInterfaceLayout").tap();
        await page.waitForSelector('#interfaceEditor[data-collapsed="true"]');
        const editor = await page.locator("#interfaceEditor").boundingBox();
        assert.ok(
          editor.height < 155,
          "controls do not cover the phone workspace",
        );
        const cdp =
          name === "chromium" ? await page.context().newCDPSession(page) : null;
        const drag = async (loc, dy) => {
          await loc.scrollIntoViewIfNeeded();
          let r = await loc.boundingBox();
          const dock = await page.locator("#interfaceEditor").boundingBox();
          if (r.y + r.height / 2 > dock.y - 40)
            await page.evaluate(
              (d) => window.scrollBy(0, d),
              r.y + r.height / 2 - dock.y + 95,
            );
          r = await loc.boundingBox();
          const x = r.x + r.width * 0.5,
            y = r.y + r.height * 0.5;
          if (cdp) {
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchStart",
              touchPoints: [{ x, y }],
            });
            for (let i = 1; i <= 16; i++) {
              await cdp.send("Input.dispatchTouchEvent", {
                type: "touchMove",
                touchPoints: [{ x, y: y + (dy * i) / 16 }],
              });
              await page.waitForTimeout(16);
            }
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchEnd",
              touchPoints: [],
            });
          } else {
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(x, y + dy, { steps: 16 });
            await page.waitForTimeout(80);
            await page.mouse.up();
          }
          await page.waitForTimeout(150);
        };
        const summary = page.locator("#pipelineView > .stat-grid");
        await drag(summary.locator("[data-part-grip]"), -180);
        assert.equal(
          await summary.evaluate((n) => getComputedStyle(n).order),
          "0",
          "touch reorders page panels",
        );
        const record = page.locator("#pipelineView > .table-card"),
          before = await record.boundingBox();
        await drag(record.locator(".miy-panel-resize"), 75);
        const after = await record.boundingBox();
        assert.ok(
          after.height > before.height + 35,
          "touch resizes a page panel",
        );
        await page.locator("#miyUndo").tap();
        assert.ok(
          Math.abs((await record.boundingBox()).height - before.height) < 3,
          "undo restores mobile height",
        );
        await page.locator("#miyRedo").tap();
        assert.ok(
          (await record.boundingBox()).height > before.height + 35,
          "redo reapplies mobile height",
        );
        await page.screenshot({
          path: path.join(out, name + "-contacts-edit.png"),
          fullPage: true,
        });
        await page.locator("#miySave").tap();
        await page.waitForSelector("#interfaceEditor", { state: "detached" });
        const saved = await page.evaluate(() => KlyoCustomize.getSaved());
        assert.equal(saved.layout.ui.mobile.pages.pipeline.order[0], "summary");
        assert.ok(saved.layout.ui.mobile.pages.pipeline.heights.records);
        assert.equal(
          saved.layout.ui.pages.pipeline,
          undefined,
          "phone positions do not change desktop positions",
        );
        await page.locator('#mobileHud [data-mobile-action="overview"]').tap();
        await page.waitForSelector('#dashboardGrid [data-widget-id="goal"]');
        await page.evaluate(() => KlyoInterface.open());
        await page.waitForSelector("#interfaceEditor");
        const goal = page.locator('[data-widget-id="goal"]');
        await drag(goal.locator(".widget-mobile-grip"), -330);
        assert.equal(
          await goal.evaluate((n) => getComputedStyle(n).order),
          "0",
          "touch reorders overview widgets",
        );
        const gb = await goal.boundingBox();
        await drag(goal.locator(".widget-resize"), 85);
        const ga = await goal.boundingBox();
        assert.ok(ga.height > gb.height + 35, "touch resizes overview widgets");
        await page.locator("#miyMobileToggle").tap();
        await page.locator('[data-editor-tab="structure"]').tap();
        for (const preset of ["command", "explorer", "notebook", "classic"]) {
          await page
            .locator(
              '#interfaceEditor [data-interface-preset="' + preset + '"]',
            )
            .tap();
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            preset + " editor fits",
          );
        }
        await page.locator('[data-editor-tab="shortcuts"]').tap();
        await page.locator('[data-shortcut="new_contact"]').check();
        await page
          .locator('[data-interface-control="quick_position"]')
          .selectOption("workspace");
        await page.locator("#miyMobileToggle").tap();
        await page.screenshot({
          path: path.join(out, name + "-overview-edit.png"),
          fullPage: true,
        });
        await page.locator("#miySave").tap();
        await page.waitForSelector("#interfaceEditor", { state: "detached" });
        await page.reload();
        await page.waitForSelector("#mobileHud");
        const persisted = await page.evaluate(() => KlyoCustomize.getSaved());
        assert.deepEqual(
          persisted.layout.dashboard,
          initial.layout.dashboard,
          "phone editing leaves desktop geometry intact",
        );
        assert.equal(persisted.layout.ui.mobile.dashboard_order[0], "goal");
        assert.ok(persisted.layout.ui.quick_actions.includes("new_contact"));
        await page.setViewportSize({ width: 320, height: 740 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        assert.deepEqual(errors, []);
        console.log(
          name +
            ": mobile login/menu, compact designer, panel and overview drag/resize, persistence, shortcuts and presets passed" +
            (cdp ? " with real touch events" : ""),
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
