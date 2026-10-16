const db = require("../db"),
  D = require("./dealWorkspace");
function zone(v) {
  try {
    if (typeof v === "string" && v.length <= 100) {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return v;
    }
  } catch {}
  return "UTC";
}
function stamp(v) {
  if (v instanceof Date && Number.isFinite(v.getTime())) v = v.toISOString();
  if (
    typeof v !== "string" ||
    v.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
      v,
    ) ||
    !Number.isFinite(Date.parse(v))
  )
    throw D.invalid("Choose a valid date and time.");
  D.validDate(v.slice(0, 10));
  if (
    Number(v.slice(11, 13)) > 23 ||
    Number(v.slice(14, 16)) > 59 ||
    (v.slice(17, 19) && Number(v.slice(17, 19)) > 59)
  )
    throw D.invalid("Choose a valid time.");
  return new Date(/[Zz]|[+-]\d{2}:\d{2}$/.test(v) ? v : v + "Z").toISOString();
}
function date(v) {
  return D.validDate(v);
}
function nextDay(v) {
  return new Date(Date.parse(v + "T00:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
}
function normalize(b, old = {}, timezone = "UTC") {
  const v = { ...old, ...b },
    all = Boolean(v.all_day),
    startDate = all
      ? date(
          v.start_date ||
            (v.start_at instanceof Date
              ? v.start_at.toISOString()
              : String(v.start_at || "")
            ).slice(0, 10),
        )
      : null;
  if (all && !startDate) throw D.invalid("Choose an all-day start date.");
  if (!v.title || typeof v.title !== "string")
    throw D.invalid("Title is required.");
  let endDate = all
    ? date(
        v.end_date ||
          (v.end_at instanceof Date
            ? v.end_at.toISOString()
            : String(v.end_at || "")
          ).slice(0, 10),
      ) || nextDay(startDate)
    : null;
  if (all && (!startDate || endDate <= startDate))
    throw D.invalid(
      "All-day end date must be after the start date (exclusive).",
    );
  const start = all ? startDate + "T00:00:00.000Z" : stamp(v.start_at),
    end = all ? endDate + "T00:00:00.000Z" : v.end_at ? stamp(v.end_at) : null;
  if (end && Date.parse(end) <= Date.parse(start))
    throw D.invalid("End must be after the start.");
  return {
    title: D.text(v.title, 300, "title", true),
    description: D.text(v.description || "", 20000, "description"),
    location: D.text(v.location || "", 1000, "location"),
    start_at: start,
    end_at: end,
    all_day: all,
    start_date: startDate,
    end_date: endDate,
    time_zone: zone(v.time_zone || timezone),
    color: /^#[a-f\d]{6}$/i.test(v.color || "") ? v.color : "#6366f1",
    ...Object.fromEntries(
      ["contact_id", "company_id", "deal_id", "task_id"].map((k) => [
        k,
        D.optionalId(v[k]),
      ]),
    ),
  };
}
async function links(client, wid, v) {
  for (const [k, t] of Object.entries({
    contact_id: "contacts",
    company_id: "companies",
    deal_id: "deals",
    task_id: "tasks",
  }))
    if (
      v[k] &&
      !(
        await client.query(
          `SELECT id FROM ${t} WHERE id=$1 AND workspace_id=$2${t === "deals" ? " AND deleted_at IS NULL" : ""}`,
          [v[k], wid],
        )
      ).rows.length
    )
      throw D.invalid("A linked record is not in this workspace.");
}
async function save(user, id, b, client = db) {
  const old = id
    ? (
        await client.query(
          "SELECT * FROM calendar_events WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
          [D.optionalId(id), user.workspace_id],
        )
      ).rows[0]
    : {};
  if (id && !old) throw D.invalid("Event not found.", 404);
  if (
    b.revision &&
    new Date(b.revision).getTime() !== new Date(old.updated_at).getTime()
  )
    throw D.invalid("This event changed. Reload it before saving.", 409);
  const v = normalize(b, old, user.time_zone);
  await links(client, user.workspace_id, v);
  const keys = Object.keys(v),
    values = Object.values(v);
  if (id) {
    values.push(id, user.workspace_id);
    return (
      await client.query(
        `UPDATE calendar_events SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")},updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$${values.length - 1} AND workspace_id=$${values.length} RETURNING *`,
        values,
      )
    ).rows[0];
  }
  values.push(user.workspace_id, user.id);
  return (
    await client.query(
      `INSERT INTO calendar_events(${keys.join(",")},workspace_id,created_by) VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
      values,
    )
  ).rows[0];
}
async function transaction(fn) {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
function range(query) {
  const start = stamp(query.start),
    end = stamp(query.end);
  if (
    Date.parse(end) <= Date.parse(start) ||
    Date.parse(end) - Date.parse(start) > 93 * 86400000
  )
    throw D.invalid("Choose a calendar range of up to 93 days.");
  return { start, end };
}
function ics(events) {
  const esc = (v) =>
      String(v || "")
        .replace(/\\/g, "\\\\")
        .replace(/\r?\n|\r/g, "\\n")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,"),
    utc = (v) =>
      new Date(v)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z"),
    lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Klyo//CRM Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      "UID:klyo-" + e.workspace_id + "-" + e.id + "@calendar.klyolabs.com",
      "DTSTAMP:" + utc(e.updated_at || new Date()),
      "SUMMARY:" + esc(e.title),
    );
    if (e.all_day) {
      lines.push(
        "DTSTART;VALUE=DATE:" +
          date(
            e.start_date || new Date(e.start_at).toISOString().slice(0, 10),
          ).replace(/-/g, ""),
        "DTEND;VALUE=DATE:" +
          date(
            e.end_date ||
              nextDay(new Date(e.start_at).toISOString().slice(0, 10)),
          ).replace(/-/g, ""),
      );
    } else {
      lines.push("DTSTART:" + utc(e.start_at));
      if (e.end_at) lines.push("DTEND:" + utc(e.end_at));
    }
    if (e.description) lines.push("DESCRIPTION:" + esc(e.description));
    if (e.location) lines.push("LOCATION:" + esc(e.location));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return (
    lines
      .map((line) => {
        const chunks = [];
        let part = "",
          bytes = 0;
        for (const ch of line) {
          const len = Buffer.byteLength(ch);
          if (bytes + len > 73) {
            chunks.push(part);
            part = " " + ch;
            bytes = 1 + len;
          } else {
            part += ch;
            bytes += len;
          }
        }
        chunks.push(part);
        return chunks.join("\r\n");
      })
      .join("\r\n") + "\r\n"
  );
}
module.exports = {
  zone,
  stamp,
  date,
  nextDay,
  normalize,
  links,
  save,
  transaction,
  range,
  ics,
};
