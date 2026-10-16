process.env.DATABASE_URL ||= "postgresql://unit:unit@127.0.0.1:1/unused";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  E = require("../server/services/calendarEvents"),
  P = require("../server/services/calendarProviders");
test("calendar DST offsets, all-day exclusive end and UTF8 ICS are preserved", () => {
  const e = E.normalize({
    title: "Measurement",
    start_at: "2026-10-25T02:30:00+02:00",
    end_at: "2026-10-25T02:30:00+01:00",
  });
  assert.equal(e.start_at, "2026-10-25T00:30:00.000Z");
  assert.equal(e.end_at, "2026-10-25T01:30:00.000Z");
  for (const start_at of [
    "oops",
    "2026-02-31T10:00:00Z",
    "2026-10-01T24:00:00Z",
  ])
    assert.throws(() => E.normalize({ title: "Invalid", start_at }));
  const all = E.normalize({
    title: "Zażółć, test;\nEND:VEVENT",
    all_day: true,
    start_date: "2026-10-25",
    end_date: "2026-10-28",
  });
  assert.equal(all.end_at, "2026-10-28T00:00:00.000Z");
  const ics = E.ics([
    { ...all, id: 1, workspace_id: 1, description: "Ż".repeat(100) },
  ]);
  assert.match(ics, /DTSTART;VALUE=DATE:20261025/);
  assert.match(ics, /DTEND;VALUE=DATE:20261028/);
  assert.equal((ics.match(/\r\nEND:VEVENT/g) || []).length, 1);
  for (const line of ics.split("\r\n"))
    assert.ok(Buffer.byteLength(line) <= 75);
  assert.throws(() =>
    E.range({ start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z" }),
  );
});
test("calendar APIs reject hostile continuations and outbound appointments have no attendees", () => {
  for (const provider of ["google", "microsoft"]) {
    const c = { provider, calendar_id: "my/calendar@example.test" },
      body = P.payload(
        c,
        E.normalize({ title: "Appointment", start_at: "2026-10-16T10:00Z" }),
      );
    assert.equal(body.attendees, undefined);
    assert.throws(() => P.url(c, "https://attacker.example/steal"));
    assert.throws(() =>
      P.url(c, "https://graph.microsoft.com/v1.0/users/other/events"),
    );
  }
  assert.equal(P.safeURL("javascript:alert(1)"), "");
  assert.equal(P.safeURL("https://attacker.example/"), "");
});
