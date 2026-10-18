// iCloud CalDAV transport. Credentials and discovery data remain server-side.
const DAV = require("tsdav");
const ICAL = require("ical.js");
const S = require("./sharepoint"),
  E = require("./calendarEvents"),
  D = require("./dealWorkspace");
const root = "https://caldav.icloud.com";
function address(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw D.invalid("Invalid iCloud calendar address.");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.search ||
    u.hash ||
    !/^(caldav\.icloud\.com|p\d{2,3}-caldav\.icloud\.com)$/.test(u.hostname)
  )
    throw D.invalid("Only Apple iCloud CalDAV addresses are allowed.");
  return u.href;
}
function failure(status) {
  const e = D.invalid(
    [401, 403].includes(status)
      ? "iCloud access was denied. Reconnect using a new Apple app-specific password."
      : status === 412
        ? "This iCloud event changed. Refresh before updating."
        : status === 404 || status === 410
          ? "iCloud event is no longer available."
          : status === 429
            ? "iCloud rate limit reached. Try again later."
            : "iCloud could not complete this request.",
    [401, 403, 404, 410, 412, 429].includes(status) ? status : 502,
  );
  e.provider_status = status;
  return e;
}
async function transport(input, options = {}) {
  let target = address(String(input));
  const signal = AbortSignal.timeout(25000);
  for (let n = 0; n < 4; n++) {
    const r = await fetch(target, { ...options, redirect: "manual", signal });
    if ([301, 302, 307, 308].includes(r.status)) {
      target = address(new URL(r.headers.get("location"), target).href);
      await r.body?.cancel();
      continue;
    }
    // Bound DAV XML/ICS before handing it to the parsers. Never log Apple bodies.
    const chunks = [];
    let size = 0;
    if (r.body)
      for await (const chunk of r.body) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          throw D.invalid(
            "Too many iCloud events. Choose a shorter range.",
            413,
          );
        }
        chunks.push(chunk);
      }
    if (!r.ok && r.status !== 207) throw failure(r.status);
    return new Response(
      [204, 205, 304].includes(r.status) ? null : Buffer.concat(chunks),
      { status: r.status, headers: r.headers },
    );
  }
  throw D.invalid("iCloud redirected too many times.", 502);
}
async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.status) throw e;
    throw D.invalid(
      "Could not connect to iCloud. Check your Apple ID and app-specific password.",
      502,
    );
  }
}
function auth(conn) {
  const saved = JSON.parse(S.decrypt(conn.credentials));
  return {
    account: saved.account,
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(saved.username + ":" + saved.password).toString("base64"),
    },
    fetch: module.exports.transport,
  };
}
async function discover(username, password) {
  username = String(username || "")
    .trim()
    .toLowerCase();
  password = String(password || "").trim();
  if (
    !/^[^\s:@]+@[^\s@]+\.[^\s@]+$/.test(username) ||
    username.length > 254 ||
    !/^[a-z]{4}(?:-[a-z]{4}){3}$/i.test(password)
  )
    throw D.invalid(
      "Enter your Apple ID email and a 16-letter app-specific password (xxxx-xxxx-xxxx-xxxx).",
    );
  return guarded(async () => {
    const client = new DAV.DAVClient({
      serverUrl: root,
      credentials: { username, password },
      authMethod: "Basic",
      defaultAccountType: "caldav",
      fetch: module.exports.transport,
    });
    await client.login();
    const account = {
      rootUrl: address(client.account.rootUrl),
      homeUrl: address(client.account.homeUrl),
    };
    const credentials = S.encrypt(
      JSON.stringify({ username, password, account }),
    );
    const conn = { credentials };
    await module.exports.calendars(conn);
    return { credentials, account_id: username, account_name: username };
  });
}
async function calendars(conn) {
  return guarded(async () => {
    const rows = await DAV.fetchCalendars({
      ...auth(conn),
      props: {
        "d:displayname": {},
        "d:current-user-privilege-set": {},
        "c:supported-calendar-component-set": {},
      },
      projectedProps: { currentUserPrivilegeSet: true },
    });
    return rows
      .filter((x) => !x.components?.length || x.components.includes("VEVENT"))
      .slice(0, 100)
      .map((x) => {
        const privileges = JSON.stringify(
          x.projectedProps?.currentUserPrivilegeSet || {},
        );
        return {
          id: address(x.url),
          name: String(x.displayName || "iCloud calendar").slice(0, 300),
          can_write:
            /"(?:all|write)"/.test(privileges) ||
            (/"writeContent"/.test(privileges) &&
              /"bind"/.test(privileges) &&
              /"unbind"/.test(privileges)),
        };
      });
  });
}
function objectURL(conn, value) {
  const url = address(value),
    calendar = address(conn.calendar_id);
  const prefix = calendar.endsWith("/") ? calendar : calendar + "/";
  let name;
  try {
    name = decodeURIComponent(url.slice(prefix.length));
  } catch {}
  if (
    !url.startsWith(prefix) ||
    !name ||
    /[\\/]/.test(name) ||
    !name.endsWith(".ics")
  )
    throw D.invalid("This event is not in the selected iCloud calendar.");
  return url;
}
function id(url, recurrence = "") {
  return Buffer.from(JSON.stringify([address(url), recurrence])).toString(
    "base64url",
  );
}
function identity(conn, value) {
  try {
    if (typeof value !== "string" || value.length > 1500) throw Error();
    const [url, occurrence] = JSON.parse(
      Buffer.from(value, "base64url").toString(),
    );
    if (
      typeof occurrence !== "string" ||
      (occurrence &&
        !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z?)?$/.test(occurrence))
    )
      throw Error();
    return { url: objectURL(conn, url), occurrence };
  } catch {
    throw D.invalid("Invalid iCloud event identifier.");
  }
}
function parse(conn, raw) {
  try {
    return parseCalendar(conn, raw);
  } catch (e) {
    if (e.status) throw e;
    throw D.invalid(
      "The iCloud event could not be parsed. Review it in Apple Calendar.",
      422,
    );
  }
}
function parseCalendar(conn, raw) {
  if (typeof raw.data !== "string" || raw.data.length > 2000000)
    throw D.invalid("iCloud event data is unavailable.", 502);
  const calendar = new ICAL.Component(ICAL.parse(raw.data));
  for (const tz of calendar.getAllSubcomponents("vtimezone")) {
    // Component-local timezone resolution avoids registering account data globally.
    const tzid = tz.getFirstPropertyValue("tzid");
    if (!tzid) throw D.invalid("Invalid iCloud event timezone.", 422);
  }
  return calendar
    .getAllSubcomponents("vevent")
    .filter((comp) => comp.getFirstPropertyValue("status") !== "CANCELLED")
    .map((comp) => {
      const ev = new ICAL.Event(comp),
        start = ev.startDate,
        end = ev.endDate;
      if (!start || !end)
        throw D.invalid("iCloud event dates are unavailable.", 422);
      for (const [key, value] of [
        ["dtstart", start],
        ["dtend", end],
      ])
        if (
          comp.getFirstProperty(key)?.getParameter("tzid") &&
          value.zone?.tzid === "floating"
        )
          throw D.invalid(
            "This iCloud event uses an unavailable timezone. Review it in Apple Calendar.",
            422,
          );
      const occurrence =
        comp.getFirstPropertyValue("recurrence-id")?.toString() || "";
      const value = E.normalize({
        title: String(ev.summary || "(Untitled event)").slice(0, 300),
        description: String(ev.description || "").slice(0, 20000),
        location: String(ev.location || "").slice(0, 1000),
        all_day: start.isDate,
        start_date: start.isDate ? start.toString() : null,
        end_date: start.isDate ? end.toString() : null,
        start_at: start.isDate
          ? start.toString() + "T00:00:00Z"
          : start.toJSDate().toISOString(),
        end_at: start.isDate
          ? end.toString() + "T00:00:00Z"
          : end.compare(start) > 0
            ? end.toJSDate().toISOString()
            : new Date(start.toJSDate().getTime() + 3600000).toISOString(),
        time_zone: E.zone(start.zone?.tzid),
        color: "#db427d",
      });
      const external_id = id(objectURL(conn, raw.url), occurrence);
      return {
        ...value,
        id: "external:" + conn.id + ":" + external_id,
        external: true,
        external_id,
        provider: "icloud",
        connection_id: conn.id,
        calendar_name: conn.calendar_name,
        account_name: conn.account_name,
        etag: raw.etag || null,
        web_url: "https://www.icloud.com/calendar/",
        recurring: Boolean(occurrence || ev.isRecurring()),
        meeting: Boolean(ev.attendees.length || ev.organizer),
        uid: ev.uid,
      };
    });
}
async function objects(conn, params) {
  return guarded(() =>
    DAV.fetchCalendarObjects({
      ...auth(conn),
      calendar: { url: address(conn.calendar_id) },
      ...params,
    }),
  );
}
async function read(conn, range) {
  const rows = await objects(conn, { timeRange: range, expand: true });
  if (rows.length > 3000)
    throw D.invalid(
      "Too many iCloud events. Choose a shorter date range.",
      413,
    );
  const events = rows.flatMap((r) => parse(conn, r));
  return events.filter(
    (e) =>
      Date.parse(e.start_at) < Date.parse(range.end) &&
      Date.parse(e.end_at) > Date.parse(range.start),
  );
}
async function original(conn, externalId) {
  const key = identity(conn, externalId);
  try {
    const r = await module.exports.transport(key.url, {
      headers: auth(conn).headers,
    });
    return { url: key.url, etag: r.headers.get("etag"), data: await r.text() };
  } catch (e) {
    if ([404, 410].includes(e.provider_status)) return null;
    throw e;
  }
}
async function remote(conn, externalId) {
  const key = identity(conn, externalId),
    raw = await module.exports.original(conn, externalId);
  if (!raw) return null;
  if (!key.occurrence) return parse(conn, raw)[0] || null;
  // Apple expands recurrence, including moved exceptions, in its own timezone database.
  const time = ICAL.Time.fromString(key.occurrence).toJSDate().getTime();
  const rows = await objects(conn, {
    objectUrls: [key.url],
    expand: true,
    timeRange: {
      start: new Date(time - 86400000).toISOString(),
      end: new Date(time + 2 * 86400000).toISOString(),
    },
  });
  const found = rows
    .flatMap((r) => parse(conn, r))
    .find((e) => e.external_id === externalId);
  if (!found)
    throw D.invalid(
      "This recurring occurrence moved or was removed. Review it in Apple Calendar and unlink its CRM copy if needed.",
      409,
    );
  return found;
}
function data(event, uid, old) {
  const cal = old
    ? new ICAL.Component(ICAL.parse(old))
    : new ICAL.Component(["vcalendar", [], []]);
  if (!old) {
    cal.updatePropertyWithValue("version", "2.0");
    cal.updatePropertyWithValue("prodid", "-//Klyo//iCloud Calendar//EN");
  }
  let comp = cal.getFirstSubcomponent("vevent");
  if (comp) {
    const e = new ICAL.Event(comp);
    if (
      cal.getAllSubcomponents("vevent").length !== 1 ||
      e.isRecurring() ||
      e.isRecurrenceException() ||
      e.attendees.length ||
      e.organizer
    )
      throw D.invalid(
        "Recurring events and invitations must be edited in Apple Calendar.",
        409,
      );
  } else {
    comp = new ICAL.Component("vevent");
    cal.addSubcomponent(comp);
  }
  const ev = new ICAL.Event(comp);
  ev.uid = ev.uid || uid;
  ev.summary = event.title;
  ev.description = event.description || "";
  ev.location = event.location || "";
  ev.startDate = event.all_day
    ? ICAL.Time.fromDateString(
        E.date(
          event.start_date ||
            new Date(event.start_at).toISOString().slice(0, 10),
        ),
      )
    : ICAL.Time.fromJSDate(new Date(event.start_at), true);
  ev.endDate = event.all_day
    ? ICAL.Time.fromDateString(
        E.date(event.end_date || E.nextDay(ev.startDate.toString())),
      )
    : ICAL.Time.fromJSDate(
        new Date(event.end_at || Date.parse(event.start_at) + 3600000),
        true,
      );
  ev.sequence = (Number(ev.sequence) || 0) + 1;
  comp.updatePropertyWithValue("dtstamp", ICAL.Time.now());
  return cal.toString();
}
async function publish(conn, event, link) {
  return guarded(async () => {
    if (link.external_id) {
      const key = identity(conn, link.external_id),
        raw = await module.exports.original(conn, link.external_id);
      if (!raw)
        throw D.invalid(
          "External event was deleted. Unlink before publishing another.",
          409,
        );
      if (!raw.etag || raw.etag !== link.etag)
        throw D.invalid(
          "This event changed outside Klyo. Pull the calendar version before updating.",
          409,
        );
      if (key.occurrence)
        throw D.invalid(
          "Recurring events must be edited in Apple Calendar.",
          409,
        );
      await DAV.updateCalendarObject({
        ...auth(conn),
        calendarObject: { ...raw, data: data(event, null, raw.data) },
      });
      return remote(conn, link.external_id);
    }
    const url =
        address(conn.calendar_id).replace(/\/?$/, "/") +
        "klyo-" +
        link.operation_id +
        ".ics",
      uid = "klyo-" + link.operation_id + "@calendar.klyolabs.com";
    const content = data(link.request_payload || event, uid);
    try {
      await DAV.createCalendarObject({
        ...auth(conn),
        calendar: { url: address(conn.calendar_id) },
        filename: "klyo-" + link.operation_id + ".ics",
        iCalString: content,
      });
    } catch (e) {
      if (e.provider_status !== 412) throw e;
      const existing = await module.exports.original(conn, id(url));
      const parsed = existing && parse(conn, existing)[0];
      if (
        !parsed ||
        parsed.uid !== uid ||
        require("./calendarProviders").hash(parsed) !==
          require("./calendarProviders").hash(
            parse(conn, { url, data: content })[0],
          )
      )
        throw D.invalid(
          "An iCloud event already exists at this address. Reload before retrying.",
          409,
        );
    }
    return remote(conn, id(url));
  });
}
async function remove(conn, link) {
  const raw = await module.exports.original(conn, link.external_id);
  if (!raw) return;
  const key = identity(conn, link.external_id),
    parsed = parse(conn, raw)[0];
  if (key.occurrence || parsed?.recurring || parsed?.meeting)
    throw D.invalid(
      "Recurring events and invitations must be deleted in Apple Calendar.",
      409,
    );
  if (!raw.etag || raw.etag !== link.etag)
    throw D.invalid(
      "This iCloud event changed before deletion. Restore or unlink it first.",
      409,
    );
  await DAV.deleteCalendarObject({ ...auth(conn), calendarObject: raw });
}
module.exports = {
  address,
  transport,
  discover,
  calendars,
  objectURL,
  id,
  identity,
  parse,
  read,
  original,
  remote,
  data,
  publish,
  remove,
};
