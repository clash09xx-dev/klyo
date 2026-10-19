const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium, webkit } = require("playwright");
(async () => {
  const f = await require("./helpers/public-site-fixture")(),
    Site = require("../server/services/publicSite");
  const out = "/private/tmp/klyo-marketing-parity-qa";
  fs.mkdirSync(out, { recursive: true });
  try {
    for (const [name, engine, executablePath] of [
      ["chromium", chromium, process.env.KLYO_CHROMIUM_PATH],
      ["webkit", webkit, process.env.KLYO_WEBKIT_PATH],
    ]) {
      const browser = await engine.launch({ headless: true, executablePath });
      try {
        const page = await browser.newPage({
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
          }),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const skeleton = () =>
          [...document.querySelectorAll("main *")]
            .filter((el) => !el.closest("script"))
            .map((el) => [
              el.tagName,
              el.id,
              el.className,
              el.getAttribute("src"),
              el.getAttribute("role"),
            ]);
        for (const p of Site.pages) {
          await page.goto(f.base + p.en, { waitUntil: "networkidle" });
          const structure = await page.evaluate(skeleton);
          await page.locator(".seo-language a[lang=pl]").click();
          await page.waitForURL(f.base + p.pl);
          await page.waitForLoadState("networkidle");
          assert.deepEqual(
            await page.evaluate(skeleton),
            structure,
            p.key + ": English and Polish share the same component tree",
          );
          for (const width of [1440, 768, 390, 360, 320]) {
            await page.setViewportSize({ width, height: 1000 });
            assert.ok(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
              p.pl + " overflow at " + width,
            );
          }
          await page.setViewportSize({ width: 1440, height: 1000 });
          if (["home", "features", "why", "customization"].includes(p.key)) {
            if (["features", "why"].includes(p.key)) {
              for (const img of await page
                .locator(".product-chapter img")
                .all()) {
                await img.scrollIntoViewIfNeeded();
                await img.evaluate((el) => el.decode());
              }
              await page.evaluate(() => scrollTo(0, 0));
            }
            await page.screenshot({
              path: `${out}/${name}-${p.key}-pl-desktop.png`,
            });
            if (["features", "why"].includes(p.key))
              await page.screenshot({
                path: `${out}/${name}-${p.key}-pl-full.png`,
                fullPage: true,
              });
            await page.setViewportSize({ width: 390, height: 844 });
            await page.screenshot({
              path: `${out}/${name}-${p.key}-pl-mobile.png`,
            });
            await page.setViewportSize({ width: 1440, height: 1000 });
          }
        }
        // Exercise state changes, not just initial translated labels.
        await page.goto(f.base + "/pl", { waitUntil: "networkidle" });
        await page.locator("#demoPosition").click();
        assert.match(
          await page.locator("#demoCaption").innerText(),
          /Menu z prawej/,
        );
        assert.match(
          await page.locator("#demoPosition").innerText(),
          /z prawej/,
        );
        await page.selectOption("#demoDensity", "comfortable");
        assert.match(
          await page.locator("#demoCaption").innerText(),
          /Przestronnie/,
        );
        await page.locator("[data-demo-theme=forest]").first().click();
        assert.match(await page.locator("#demoCaption").innerText(), /Las/);
        assert.match(
          await page.locator("#emailInstruction").innerText(),
          /Napisz/,
        );
        await page.locator("#motionToggle").click();
        assert.ok(
          ["Wstrzymaj animacje", "Włącz animacje"].includes(
            await page.locator("#motionToggle").getAttribute("title"),
          ),
        );
        for (const route of ["/pl", "/pl/make-it-yours"]) {
          await page.goto(f.base + route, { waitUntil: "networkidle" });
          for (const layout of ["classic", "explorer", "notebook", "command"]) {
            await page.locator(`[data-demo-layout=${layout}]`).click();
            assert.equal(
              await page
                .locator("[data-layout-demo]")
                .getAttribute("data-layout-demo"),
              layout,
            );
            assert.doesNotMatch(
              await page.locator("#interfaceDemoCaption").innerText(),
              /sidebar|work surface|sections at the top|list of tools/,
            );
          }
        }
        await page.locator("#customDemoName").fill("Rodzaj urządzenia");
        await page.locator("#customDemoForm button").click();
        assert.match(
          await page.locator("#customDemoFeedback").innerText(),
          /Pole dodane/,
        );
        assert.equal(
          await page
            .locator("#customDemoFields input")
            .last()
            .getAttribute("placeholder"),
          "Wpisz wartość",
        );
        for (const lang of ["en", "pl"]) {
          await page.goto(
            f.base + (lang === "en" ? "/features" : "/pl/funkcje"),
            { waitUntil: "networkidle" },
          );
          for (const tab of ["quotes", "settings", "sales"]) {
            await page.locator(`#${tab}-preview-tab`).click();
            assert.equal(
              await page.locator(`#${tab}-preview`).isVisible(),
              true,
            );
            await page
              .locator(`#${tab}-preview img`)
              .evaluate((img) => img.decode());
            assert.equal(
              await page
                .locator(`#${tab}-preview img`)
                .evaluate((img) => img.complete && img.naturalWidth > 0),
              true,
            );
          }
          await page.keyboard.press("ArrowRight");
          assert.equal(
            await page
              .locator("#quotes-preview-tab")
              .getAttribute("aria-selected"),
            "true",
          );
          await page.locator(".feature-group summary").first().click();
          assert.equal(
            await page.locator(".feature-group[open] article").count(),
            4,
          );
          await page.screenshot({
            path: `${out}/${name}-features-${lang}-desktop.png`,
          });
          const sub = await page.evaluate(() => ({
            pink: getComputedStyle(document.body)
              .getPropertyValue("--miy-pink")
              .trim(),
            orange: getComputedStyle(document.body)
              .getPropertyValue("--miy-orange")
              .trim(),
          }));
          assert.equal(sub.pink, "#e0ead4");
          assert.equal(sub.orange, "#e9eee3");
        }
        assert.deepEqual(errors, []);
        console.log(
          name +
            ": EN/PL component parity for all 14 pages, 320/360/390/768/1440 bounds, localized interactive demos, screenshot tabs and feature library PASS",
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
