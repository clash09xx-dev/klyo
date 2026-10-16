const assert = require("node:assert/strict"),
  fs = require("fs"),
  path = require("path"),
  { chromium, webkit } = require("playwright");
(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error("Use a disposable TEST_DATABASE_URL");
  const f = await require("./helpers/calendar-fixture")(),
    out =
      process.env.KLYO_QA_SCREENSHOTS ||
      path.join(require("os").tmpdir(), "klyo-calendar-qa");
  fs.mkdirSync(out, { recursive: true });
  try {
    for (const [name, engine, executablePath] of [
      ["chromium", chromium, process.env.KLYO_CHROMIUM_PATH],
      ["webkit", webkit, process.env.KLYO_WEBKIT_PATH],
    ]) {
      if (process.env.KLYO_BROWSER && process.env.KLYO_BROWSER !== name)
        continue;
      await f.db.query("DELETE FROM calendar_event_links");
      await f.db.query("DELETE FROM calendar_events");
      await f.db.query("UPDATE users SET role='admin' WHERE id=$1", [
        f.users[0].id,
      ]);
      f.remote.get("google:private").summary = "Private appointment";
      const created = await f.req("/calendar", "POST", {
        title: "CRM workshop " + name,
        start_at: "2026-10-20T09:00:00Z",
        end_at: "2026-10-20T10:00:00Z",
        location: "Factory",
      });
      assert.equal(created.status, 201);
      const event = created.data.event;
      const dst = (
        await f.req("/calendar", "POST", {
          title: "Clock-change appointment " + name,
          start_at: "2026-10-25T01:30:00Z",
          end_at: "2026-10-25T02:30:00Z",
        })
      ).data.event;
      const browser = await engine.launch({ headless: true, executablePath });
      try {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            timezoneId: "Europe/Warsaw",
            reducedMotion: "reduce",
          }),
          page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => {
          errors.push(e.message);
          console.error(e.message);
        });
        page.on("dialog", (d) => d.accept());
        await context.addInitScript(
          ({ token, user }) => {
            localStorage.setItem("klyo_token", token);
            localStorage.setItem("klyo_user", JSON.stringify(user));
          },
          { token: f.token(0), user: f.users[0] },
        );
        await page.goto(f.base + "/app", { waitUntil: "networkidle" });
        await page.locator(".nav [data-view=calendar]").click();
        await page.evaluate(() => {
          calendarDate = new Date(2026, 9, 1);
          return loadCalendar();
        });
        await page
          .locator("#calendarGrid [data-event-id]")
          .filter({ hasText: "Private appointment" })
          .waitFor();
        assert.equal(
          await page
            .locator("#calendarGrid [data-event-id]")
            .filter({ hasText: "Trade fair" })
            .count(),
          3,
        );
        await page.locator("#calendarConnections").click();
        let d = page.getByRole("dialog", {
          name: "Calendar integrations",
          exact: true,
        });
        assert.match(await d.innerText(), /private to your account/);
        await d.locator("[data-calendar-choose]").first().click();
        d = page.getByRole("dialog", { name: "Choose calendar", exact: true });
        await d.locator("select").selectOption("work");
        await d.locator("button[type=submit],form button").click();
        await page
          .getByRole("dialog", { name: "Calendar integrations", exact: true })
          .waitFor();
        await page.keyboard.press("Escape");
        await page
          .locator("#calendarGrid [data-event-id]")
          .filter({ hasText: "Private appointment" })
          .click();
        d = page.getByRole("dialog", {
          name: "Private appointment",
          exact: true,
        });
        await d.locator("#copyExternalCalendarEvent").click();
        await page.locator("#eventModalOverlay:not(.hidden)").waitFor();
        assert.equal(
          await page.locator("#eventStart").inputValue(),
          "2026-10-20T09:00",
        );
        await page.locator("#closeEventModalBtn").click();
        await page
          .locator(`#calendarGrid [data-event-id="${event.id}"]`)
          .click();
        assert.equal(
          await page.locator("#eventStart").inputValue(),
          "2026-10-20T11:00",
        );
        await page.locator("#eventTitle").fill("CRM workshop updated " + name);
        await page.locator("#eventSubmitBtn").click();
        await page.locator("#eventModalOverlay").waitFor({ state: "hidden" });
        await page
          .locator(`#calendarGrid [data-event-id="${event.id}"]`)
          .click();
        await page.locator("#eventProviderLinks").click();
        d = page.getByRole("dialog", {
          name: "Event calendar links",
          exact: true,
        });
        await d
          .locator(`[data-publish-calendar="${f.connections[0].id}"]`)
          .click();
        await page
          .getByRole("dialog", { name: "Event calendar links", exact: true })
          .getByText("Last synchronized version", { exact: true })
          .waitFor();
        const link = (
          await f.db.query(
            "SELECT * FROM calendar_event_links WHERE event_id=$1 AND kind='published'",
            [event.id],
          )
        ).rows[0];
        assert.ok(link.external_id);
        const raw = f.remote.get("google:" + link.external_id);
        raw.summary = "Edited in Google " + name;
        raw.etag = '"external-edit-' + name + '"';
        d = page.getByRole("dialog", {
          name: "Event calendar links",
          exact: true,
        });
        await d.locator("[data-publish-calendar]").first().click();
        await d
          .locator(".doc-error")
          .filter({ hasText: "changed outside Klyo" })
          .waitFor();
        const previousLinks = await d.elementHandle();
        await d.locator("[data-pull-calendar]").click();
        await previousLinks.waitForElementState("hidden");
        await page
          .getByRole("dialog", { name: "Event calendar links", exact: true })
          .getByText("Last synchronized version", { exact: true })
          .waitFor();
        await page.keyboard.press("Escape");
        await page
          .locator("#calendarGrid [data-event-id]")
          .filter({ hasText: "Edited in Google " + name })
          .waitFor();
        if (await page.locator("#eventModalOverlay").isVisible())
          await page.locator("#closeEventModalBtn").click();
        const [download] = await Promise.all([
          page.waitForEvent("download").catch(async (e) => {
            console.error("Export UI:", await page.locator("body").innerText());
            throw e;
          }),
          page.locator("#calendarExport").click(),
        ]);
        await download.saveAs(path.join(out, name + "-calendar.ics"));
        assert.match(
          fs.readFileSync(path.join(out, name + "-calendar.ics"), "utf8"),
          /Edited in Google/,
        );
        await page.locator(`#calendarGrid [data-event-id="${dst.id}"]`).click();
        assert.equal(
          await page.locator("#eventStart").inputValue(),
          "2026-10-25T02:30",
        );
        await page.locator("#eventStart").fill("2026-03-29T02:30");
        await page.locator("#eventSubmitBtn").click();
        await page
          .locator("#eventFormError")
          .filter({ hasText: "daylight saving" })
          .waitFor();
        await page.locator("#eventStart").fill("2026-10-25T02:30");
        await page.locator("#eventTitle").fill("Clock-change edited " + name);
        await page.locator("#eventSubmitBtn").click();
        await page.locator("#eventModalOverlay").waitFor({ state: "hidden" });
        assert.equal(
          (await f.req("/calendar")).data.events.find((e) => e.id === dst.id)
            .start_at,
          "2026-10-25T01:30:00.000Z",
        );
        await page
          .locator("#calendarView")
          .screenshot({ path: path.join(out, name + "-calendar.png") });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.screenshot({
          path: path.join(out, name + "-calendar-mobile.png"),
          fullPage: true,
        });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.reload({ waitUntil: "networkidle" });
        await page.evaluate(() => {
          calendarDate = new Date(2026, 9, 1);
          return switchView("calendar");
        });
        await page
          .locator("#calendarGrid [data-event-id]")
          .filter({ hasText: "Edited in Google " + name })
          .waitFor();
        await f.db.query("UPDATE users SET role='viewer' WHERE id=$1", [
          f.users[0].id,
        ]);
        await page.reload({ waitUntil: "networkidle" });
        await page.locator(".nav [data-view=calendar]").click();
        await page.evaluate(() => {
          calendarDate = new Date(2026, 9, 1);
          return loadCalendar();
        });
        await page
          .locator(`#calendarGrid [data-event-id="${event.id}"]`)
          .click();
        assert.equal(await page.locator("#eventSubmitBtn").isDisabled(), true);
        assert.equal(await page.locator("#deleteEventBtn").isDisabled(), true);
        assert.deepEqual(errors, []);
        console.log(
          name +
            ": private calendar overlay, choice, all-day dates, timezone edit, copy, publication/conflict/pull, ICS, persistence, mobile and viewer PASS",
        );
        await context.close();
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
