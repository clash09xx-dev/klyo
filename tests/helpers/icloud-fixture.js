const I = require("../../server/services/icloudCalendar");
module.exports = function install() {
  const native = global.fetch,
    files = new Map(),
    calls = [];
  let rev = 1,
    failAfterPut = false,
    deny = false;
  const home = "https://p01-caldav.icloud.com/123/calendars/",
    cal = home + "work/";
  const xml = (rows) =>
    new Response(
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${rows.map(([href, props]) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("")}</d:multistatus>`,
      {
        status: 207,
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      },
    );
  global.fetch = async (input, options = {}) => {
    const url = String(input),
      u = new URL(url);
    if (!u.hostname.endsWith("icloud.com")) return native(input, options);
    const method = options.method || "GET",
      body = String(options.body || ""),
      headers = new Headers(options.headers);
    calls.push({ url, method, body, headers });
    if (deny) return new Response("denied", { status: 401 });
    if (method === "PROPFIND") {
      if (body.includes("current-user-principal"))
        return xml([
          [
            u.href,
            "<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>",
          ],
        ]);
      if (body.includes("calendar-home-set"))
        return xml([
          [
            u.href,
            `<c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set>`,
          ],
        ]);
      if (body.includes("supported-report-set"))
        return xml([[u.href, "<d:supported-report-set/>"]]);
      if (u.href === home)
        return xml([
          [
            cal,
            '<d:displayname>Work iCloud</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:all/></d:privilege></d:current-user-privilege-set>',
          ],
          [
            home + "readonly/",
            "<d:displayname>Read only</d:displayname><d:resourcetype><c:calendar/></d:resourcetype><d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>",
          ],
        ]);
      return xml([[u.href, "<d:resourcetype/>"]]);
    }
    if (method === "REPORT")
      return xml(
        [...files]
          .filter(
            ([url]) =>
              !body.includes("calendar-multiget") ||
              body.includes(new URL(url).pathname),
          )
          .map(([url, r]) => [
            url,
            `<d:getetag>${r.etag}</d:getetag><c:calendar-data><![CDATA[${r.data}]]></c:calendar-data>`,
          ]),
      );
    const old = files.get(url);
    if (method === "GET")
      return old
        ? new Response(old.data, { headers: { etag: old.etag } })
        : new Response(null, { status: 404 });
    if (method === "PUT") {
      if (
        (headers.get("If-None-Match") === "*" && old) ||
        (headers.get("If-Match") && headers.get("If-Match") !== old?.etag)
      )
        return new Response(null, { status: 412 });
      const value = { data: body, etag: '"' + ++rev + '"' };
      files.set(url, value);
      if (failAfterPut) {
        failAfterPut = false;
        throw Error("fixture interrupted response");
      }
      return new Response(null, {
        status: old ? 204 : 201,
        headers: { etag: value.etag },
      });
    }
    if (method === "DELETE") {
      if (headers.get("If-Match") !== old?.etag)
        return new Response(null, { status: 412 });
      files.delete(url);
      return new Response(null, { status: 204 });
    }
    throw Error("Unexpected fixture request");
  };
  function put(name, event) {
    const url = cal + name + ".ics";
    files.set(url, {
      data: I.data(
        {
          title: "Private iCloud appointment",
          start_at: "2026-10-20T09:00:00Z",
          end_at: "2026-10-20T10:00:00Z",
          ...event,
        },
        name + "@fixture",
      ),
      etag: '"' + ++rev + '"',
    });
    return I.id(url);
  }
  return {
    home,
    cal,
    files,
    calls,
    put,
    get failAfterPut() {
      return failAfterPut;
    },
    set failAfterPut(v) {
      failAfterPut = v;
    },
    set deny(v) {
      deny = v;
    },
    restore() {
      global.fetch = native;
    },
  };
};
