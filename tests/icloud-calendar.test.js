const test = require("node:test"),
  assert = require("node:assert/strict");
process.env.DATABASE_URL ||= "postgresql://unused";
const I = require("../server/services/icloudCalendar"),
  E = require("../server/services/calendarEvents");
const cal = "https://p01-caldav.icloud.com/123/calendars/work/",
  conn = {
    id: 9,
    calendar_id: cal,
    calendar_name: "Private",
    account_name: "fixture",
  };
test("iCloud rejects non-Apple hosts, redirects and event path traversal before a request", async () => {
  for (const url of [
    "http://caldav.icloud.com/",
    "https://caldav.icloud.com.evil.test/",
    "https://localhost/",
    "https://p01-caldav.icloud.com:8443/",
    "https://a:b@caldav.icloud.com/",
  ])
    assert.throws(() => I.address(url));
  for (const url of [
    cal + "../other/a.ics",
    cal + "%2e%2e%2fother%2fa.ics",
    cal + "a%2fb.ics",
    "https://p01-caldav.icloud.com/other/a.ics",
  ])
    assert.throws(() => I.objectURL(conn, url));
  const saved = global.fetch;
  let requests = 0;
  global.fetch = async () => {
    requests++;
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    });
  };
  try {
    await assert.rejects(
      I.transport("https://caldav.icloud.com/"),
      /Only Apple/,
    );
    assert.equal(requests, 1);
  } finally {
    global.fetch = saved;
  }
});
test("CalDAV payload escapes text, round-trips all-day dates and keeps alarms and metadata", () => {
  const event = E.normalize({
    title: "Quote, parts; next\nMeeting",
    description: "Line one\nLine two",
    location: "A;B",
    all_day: true,
    start_date: "2026-10-25",
    end_date: "2026-10-28",
  });
  const data = I.data(event, "fixture");
  let parsed = I.parse(conn, { url: cal + "a.ics", data, etag: '"1"' })[0];
  assert.equal(parsed.title, event.title);
  assert.equal(parsed.end_date, "2026-10-28");
  assert.equal(parsed.start_at, "2026-10-25T00:00:00.000Z");
  const extra = data.replace(
    "END:VEVENT",
    "X-FIXTURE:retained\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT",
  );
  const updated = I.data({ ...event, title: "Revised" }, null, extra);
  assert.match(updated, /X-FIXTURE:retained/);
  assert.match(updated, /BEGIN:VALARM/);
  assert.match(updated, /UID:fixture/);
});
test("iCloud uses embedded DST zones and assigns separate IDs to expanded occurrences", () => {
  const data = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Warsaw\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700329T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nEND:DAYLIGHT\r\nBEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:series\r\nRECURRENCE-ID:20261020T070000Z\r\nDTSTART;TZID=Europe/Warsaw:20261020T090000\r\nDTEND;TZID=Europe/Warsaw:20261020T100000\r\nSUMMARY:Before DST\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:series\r\nRECURRENCE-ID:20261027T080000Z\r\nDTSTART;TZID=Europe/Warsaw:20261027T090000\r\nDTEND;TZID=Europe/Warsaw:20261027T100000\r\nSUMMARY:After DST\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  const rows = I.parse(conn, { url: cal + "series.ics", data, etag: '"2"' });
  assert.equal(rows[0].start_at, "2026-10-20T07:00:00.000Z");
  assert.equal(rows[1].start_at, "2026-10-27T08:00:00.000Z");
  assert.notEqual(rows[0].external_id, rows[1].external_id);
  assert.ok(rows.every((r) => r.recurring));
  assert.throws(
    () => I.data({ ...rows[0], title: "Unsafe series edit" }, null, data),
    /Recurring/,
  );
  assert.throws(
    () =>
      I.data(
        rows[0],
        null,
        I.data(rows[0], "invite").replace(
          "END:VEVENT",
          "ATTENDEE:mailto:guest@example.test\r\nEND:VEVENT",
        ),
      ),
    /invitations/,
  );
});
