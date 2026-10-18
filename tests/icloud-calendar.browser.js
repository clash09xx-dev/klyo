const assert = require("node:assert/strict"),
  fs = require("fs"),
  { chromium, webkit } = require("playwright");
(async () => {
  const f = await require("./helpers/calendar-fixture")(),
    cloud = require("./helpers/icloud-fixture")();
  const out = "/private/tmp/klyo-icloud-qa";
  fs.mkdirSync(out, { recursive: true });
  try {
    for (const [name, engine, executablePath] of [
      ["chromium", chromium, process.env.KLYO_CHROMIUM_PATH],
      ["webkit", webkit, process.env.KLYO_WEBKIT_PATH],
    ]) {
      await f.db.query("UPDATE users SET language='en' WHERE id=$1", [
        f.users[0].id,
      ]);
      await f.db.query(
        "DELETE FROM calendar_connections WHERE provider='icloud'",
      );
      await f.db.query("DELETE FROM calendar_events");
      cloud.files.clear();
      const browser = await engine.launch({ headless: true, executablePath });
      try {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            timezoneId: "Europe/Warsaw",
          }),
          page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("dialog", (d) => d.accept());
        await context.addInitScript(
          ({ token, user }) => {
            localStorage.setItem("klyo_token", token);
            localStorage.setItem("klyo_user", JSON.stringify(user));
          },
          { token: f.token(0), user: f.users[0] },
        );
        await page.goto(f.base + "/app", { waitUntil: "networkidle" });
        await page.evaluate(() => KlyoCalendar.settings());
        await page.locator("[data-calendar-connect=icloud]").click();
        let d = page.getByRole("dialog", {
          name: "Connect iCloud",
          exact: true,
        });
        await d.locator("[name=apple_id]").fill("owner@icloud.test");
        await d.locator("[name=app_password]").fill("aaaa-bbbb-cccc-dddd");
        await d.locator("button[type=submit]").click();
        d = page.getByRole("dialog", {
          name: "Calendar integrations",
          exact: true,
        });
        await d.waitFor();
        let card = d
          .locator(".calendar-provider")
          .filter({ hasText: "Apple Calendar / iCloud" });
        await card.locator("[data-calendar-choose]").click();
        d = page.getByRole("dialog", { name: "Choose calendar", exact: true });
        await d.locator("select").selectOption(cloud.cal);
        await d.locator("form button").click();
        d = page.getByRole("dialog", {
          name: "Calendar integrations",
          exact: true,
        });
        await d.waitFor();
        card = d
          .locator(".calendar-provider")
          .filter({ hasText: "Apple Calendar / iCloud" });
        await card.locator("[data-calendar-auto]").click();
        d = page.getByRole("dialog", {
          name: "Calendar integrations",
          exact: true,
        });
        await d.waitFor();
        await page
          .locator('[data-calendar-auto][data-enabled="true"]')
          .waitFor();
        assert.match(await d.innerText(), /Automatic two-way sync: On/);
        await page.screenshot({
          path: out + "/" + name + "-connected.png",
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        cloud.put("browser-" + name);
        await page.locator(".nav [data-view=calendar]").click();
        await page.evaluate(() => {
          calendarDate = new Date(2026, 9, 1);
          return loadCalendar();
        });
        await page
          .locator("#calendarGrid [data-event-id]")
          .filter({ hasText: "Private iCloud appointment" })
          .first()
          .click();
        d = page.getByRole("dialog", {
          name: "Private iCloud appointment",
          exact: true,
        });
        await d.locator("#copyExternalCalendarEvent").click();
        await page.locator("#eventModalOverlay:not(.hidden)").waitFor();
        await page.locator("#closeEventModalBtn").click();
        await page.evaluate(() => KlyoI18n.setLang("pl"));
        await page.evaluate(() => KlyoCalendar.settings());
        d = page.getByRole("dialog", {
          name: "Integracje kalendarzy",
          exact: true,
        });
        await d.waitFor();
        assert.match(
          await d.innerText(),
          /Automatyczna synchronizacja w obie strony/,
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: out + "/" + name + "-pl-mobile.png",
          fullPage: true,
        });
        assert.ok(
          await d.evaluate(
            (el) => el.getBoundingClientRect().width <= window.innerWidth,
          ),
        );
        await page.keyboard.press("Escape");
        await page.evaluate(() => KlyoCalendar.connectICloud());
        d = page.getByRole("dialog", { name: "Połącz iCloud", exact: true });
        await d.waitFor();
        assert.match(await d.innerText(), /Hasło aplikacji/);
        await page.screenshot({
          path: out + "/" + name + "-form-pl.png",
          fullPage: true,
        });
        assert.deepEqual(errors, []);
        console.log(
          name +
            ": iCloud connect, calendar selection, automatic sync, private copy, Polish and mobile PASS",
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    cloud.restore();
    await f.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
