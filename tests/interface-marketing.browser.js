const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { chromium, webkit } = require("playwright");
(async () => {
  const f = await require("./helpers/public-site-fixture")(),
    out =
      process.env.KLYO_QA_SCREENSHOTS ||
      path.join(require("node:os").tmpdir(), "klyo-interface-marketing");
  fs.mkdirSync(out, { recursive: true });
  try {
    for (const [name, engine, executablePath] of [
      ["chromium", chromium, process.env.KLYO_CHROMIUM_PATH],
      ["webkit", webkit, process.env.KLYO_WEBKIT_PATH],
    ]) {
      const browser = await engine.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
      });
      try {
        const p = await browser.newPage({
            viewport: { width: 1440, height: 1000 },
            reducedMotion: "reduce",
          }),
          errors = [];
        p.on("pageerror", (e) => errors.push(e.message));
        for (const route of ["/", "/make-it-yours"]) {
          await p.goto(f.base + route, { waitUntil: "networkidle" });
          const section = p.locator("#workspace-layouts");
          await section.scrollIntoViewIfNeeded();
          assert.equal(await section.isVisible(), true);
          assert.equal(await p.locator("[data-demo-layout]").count(), 4);
          for (const layout of ["classic", "explorer", "notebook", "command"]) {
            await p.locator('[data-demo-layout="' + layout + '"]').click();
            assert.equal(
              await p.getAttribute("[data-layout-demo]", "data-layout-demo"),
              layout,
            );
            await section.screenshot({
              path: path.join(
                out,
                name +
                  "-" +
                  (route === "/" ? "home" : "miy") +
                  "-" +
                  layout +
                  ".png",
              ),
            });
          }
          await p.locator("[data-demo-layout=classic]").click();
          await p.keyboard.press("ArrowRight");
          assert.equal(
            await p.getAttribute("[data-layout-demo]", "data-layout-demo"),
            "explorer",
          );
          await p.setViewportSize({ width: 390, height: 844 });
          for (const layout of ["classic", "explorer", "notebook", "command"]) {
            await p.locator('[data-demo-layout="' + layout + '"]').click();
            assert.ok(
              await p.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
              "Mobile bounds " + route + " " + layout,
            );
          }
          await section.screenshot({
            path: path.join(
              out,
              name + "-" + (route === "/" ? "home" : "miy") + "-mobile.png",
            ),
          });
          await p.setViewportSize({ width: 1440, height: 1000 });
        }
        assert.deepEqual(errors, []);
        console.log(
          name +
            ": home and Make It Yours, four interactive layouts, keyboard tabs and mobile bounds PASS",
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
