const assert = require("node:assert/strict"),
  fs = require("fs"),
  { chromium, webkit } = require("playwright");
(async () => {
  const f = await require("./helpers/public-site-fixture")(),
    Site = require("../server/services/publicSite"),
    out = "/private/tmp/klyo-seo-qa";
  fs.mkdirSync(out, { recursive: true });
  try {
    for (const [name, engine, executablePath] of [
      ["chromium", chromium, process.env.KLYO_CHROMIUM_PATH],
      ["webkit", webkit, process.env.KLYO_WEBKIT_PATH],
    ]) {
      const browser = await engine.launch({ headless: true, executablePath });
      try {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
          }),
          page = await context.newPage(),
          errors = [],
          failed = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("response", (r) => {
          if (r.status() >= 400 && new URL(r.url()).origin === f.base)
            failed.push(r.url());
        });
        for (const p of Site.pages)
          for (const lang of ["en", "pl"]) {
            await page.goto(f.base + p[lang], { waitUntil: "networkidle" });
            assert.equal(await page.locator("html").getAttribute("lang"), lang);
            assert.equal(await page.locator("h1").count(), 1);
            await page.locator("h1").waitFor();
            assert.equal(
              await page
                .locator(".seo-language a[aria-current=page]")
                .getAttribute("lang"),
              lang,
            );
            if (p.key === "home" || p.key === "pricing")
              assert.equal(await page.locator(".price-card").count(), 4);
            await page.setViewportSize({ width: 390, height: 844 });
            assert.ok(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
              p[lang] + " mobile overflow",
            );
            const header = await page.locator(".site-nav").boundingBox();
            assert.ok(header.width <= 390);
            if (["home", "quotes", "pricing"].includes(p.key))
              await page.screenshot({
                path:
                  out + "/" + name + "-" + p.key + "-" + lang + "-mobile.png",
                fullPage: false,
              });
            await page.setViewportSize({ width: 1440, height: 1000 });
            if (["home", "quotes"].includes(p.key))
              await page.screenshot({
                path:
                  out + "/" + name + "-" + p.key + "-" + lang + "-desktop.png",
                fullPage: false,
              });
          }
        await page.goto(f.base + "/pl/oferty-pdf");
        await page.locator(".seo-language a[lang=en]").click();
        await page.waitForURL(f.base + "/pdf-quotes");
        assert.deepEqual(errors, []);
        assert.deepEqual(failed, []);
        const nojs = await browser.newContext({
            javaScriptEnabled: false,
            viewport: { width: 390, height: 844 },
          }),
          plain = await nojs.newPage();
        await plain.goto(f.base + "/pricing");
        assert.equal(await plain.locator(".price-card").count(), 4);
        assert.match(
          await plain.locator(".price-card").first().innerText(),
          /\$9/,
        );
        await plain.goto(f.base + "/pl/cennik");
        assert.match(await plain.locator("h1").innerText(), /plan CRM/);
        assert.equal(await plain.locator(".price-card").count(), 4);
        console.log(
          name +
            ": 14 public pages, language links, mobile bounds, working assets and no-JS pricing PASS",
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
  process.exit(1);
});
