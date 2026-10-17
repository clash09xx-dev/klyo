const { Pool } = require("pg"),
  express = require("express"),
  jwt = require("jsonwebtoken"),
  path = require("path"),
  fs = require("fs");
module.exports = async function setup() {
  const schema = `klyo_calendar_${process.pid}_${Date.now()}`,
    admin = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      ssl: false,
    });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  Object.assign(process.env, {
    DATABASE_URL: url.toString(),
    PGSSL: "false",
    JWT_SECRET: "calendar-api-test",
    GOOGLE_CLIENT_ID: "calendar-fixture-client",
    GOOGLE_CLIENT_SECRET: "calendar-fixture-secret",
    MICROSOFT_CLIENT_ID: "calendar-fixture-microsoft",
    MICROSOFT_CLIENT_SECRET: "calendar-fixture-secret",
  });
  const db = require("../../server/db"),
    P = require("../../server/services/calendarProviders"),
    S = require("../../server/services/sharepoint"),
    originalCall = P.call,
    originalExchange = P.exchange;
  let server;
  try {
    await db.init();
    const w = (
        await db.query(
          "INSERT INTO workspaces(name,invite_code,is_comped) VALUES('Calendar','calendar',true) RETURNING id",
        )
      ).rows[0].id,
      other = (
        await db.query(
          "INSERT INTO workspaces(name,invite_code,is_comped) VALUES('Other','other',true) RETURNING id",
        )
      ).rows[0].id,
      users = [];
    for (const [name, wid, role] of [
      ["Owner", w, "admin"],
      ["Colleague", w, "member"],
      ["Viewer", w, "viewer"],
      ["Other", other, "admin"],
    ])
      users.push(
        (
          await db.query(
            "INSERT INTO users(workspace_id,name,email,password_hash,role,language,has_seen_onboarding,terms_accepted_at) VALUES($1,$2,$3,'fixture',$4,'en',true,now()) RETURNING *",
            [wid, name, name + "@calendar.test", role],
          )
        ).rows[0],
      );
    await db.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
      users[0].id,
      w,
    ]);
    const connections = [];
    for (const provider of ["google", "microsoft"])
      connections.push(
        (
          await db.query(
            "INSERT INTO calendar_connections(workspace_id,user_id,provider,credentials,account_id,account_name,calendar_id,calendar_name,can_write,generation) VALUES($1,$2,$3,$4,$5,$6,'work','Work',true,'generation') RETURNING *",
            [
              w,
              users[0].id,
              provider,
              S.encrypt("fake"),
              provider + "-owner",
              "owner@" + provider + ".test",
            ],
          )
        ).rows[0],
      );
    const remote = new Map(),
      calls = [];
    let counter = 0,
      failAfterCreate = false;
    const googleEvent = (id, title = "Private appointment") => ({
      id,
      summary: title,
      start: { dateTime: "2026-10-20T09:00:00+02:00" },
      end: { dateTime: "2026-10-20T10:00:00+02:00" },
      description: "Private text",
      location: "Office",
      etag: '"g1"',
      htmlLink: "https://calendar.google.com/calendar/event?eid=" + id,
    });
    remote.set("google:private", googleEvent("private"));
    remote.set("google:all-day", {
      id: "all-day",
      summary: "Trade fair",
      start: { date: "2026-10-25" },
      end: { date: "2026-10-28" },
      etag: '"a1"',
    });
    remote.set("microsoft:m-private", {
      id: "m-private",
      subject: "Outlook visit",
      start: { dateTime: "2026-10-21T07:00:00", timeZone: "UTC" },
      end: { dateTime: "2026-10-21T08:00:00", timeZone: "UTC" },
      body: { contentType: "text", content: "Visit details" },
      "@odata.etag": '"m1"',
      webLink: "https://outlook.office.com/calendar/item/test",
    });
    P.call = async (conn, c, uri, options = {}) => {
      calls.push({ provider: conn.provider, path: uri, ...options });
      const u = new URL(P.url(conn, uri)),
        method = options.method || "GET";
      if (u.pathname.endsWith("calendarList"))
        return {
          items: [
            { id: "work", summary: "Work", accessRole: "owner" },
            { id: "readonly", summary: "Read only", accessRole: "reader" },
          ],
        };
      if (u.pathname.endsWith("/me/calendars"))
        return { value: [{ id: "work", name: "Office", canEdit: true }] };
      if (
        (u.pathname.endsWith("/events") ||
          u.pathname.endsWith("/calendarView")) &&
        method === "GET"
      )
        return conn.provider === "google"
          ? {
              items: [...remote]
                .filter(([k]) => k.startsWith("google:"))
                .map(([, v]) => v),
            }
          : {
              value: [...remote]
                .filter(([k]) => k.startsWith("microsoft:"))
                .map(([, v]) => v),
            };
      const id = decodeURIComponent(u.pathname.split("/").at(-1)),
        key = (eid) => conn.provider + ":" + eid;
      if (method === "POST") {
        const body = JSON.parse(options.body),
          eid = conn.provider === "google" ? body.id : body.transactionId,
          existing = remote.get(key(eid));
        if (existing) {
          if (conn.provider === "google")
            throw Object.assign(new Error("exists"), {
              status: 409,
              provider_status: 409,
            });
          return existing;
        }
        const v =
          conn.provider === "google"
            ? { ...body, id: eid, etag: '"created' + ++counter + '"' }
            : { ...body, id: eid, "@odata.etag": '"created' + ++counter + '"' };
        remote.set(key(eid), v);
        if (failAfterCreate) {
          failAfterCreate = false;
          throw new Error("Provider timeout after committing");
        }
        return v;
      }
      const v = remote.get(key(id));
      if (!v)
        throw Object.assign(new Error("Gone"), {
          status: 404,
          provider_status: 404,
        });
      if (method === "PATCH") {
        if (options.headers?.["If-Match"] !== (v.etag || v["@odata.etag"]))
          throw Object.assign(new Error("Conflict"), {
            status: 412,
            provider_status: 412,
          });
        const value = {
          ...v,
          ...JSON.parse(options.body),
          ...(conn.provider === "google"
            ? { etag: '"updated' + ++counter + '"' }
            : { "@odata.etag": '"updated' + ++counter + '"' }),
        };
        remote.set(key(id), value);
        return value;
      }
      return v;
    };
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    for (const file of fs
      .readdirSync(path.join(__dirname, "../../server/routes"))
      .filter(
        (n) =>
          n.endsWith(".js") &&
          !n.includes(" ") &&
          !["publicQuotes.js", "webhooks.js"].includes(n),
      ))
      app.use(
        "/api/" + file.slice(0, -3),
        require("../../server/routes/" + file),
      );
    for(const name of ["features","pricing","why-klyo","login"])app.get("/"+name,(_,res)=>res.sendFile(path.join(__dirname,"../../public/"+name+".html")));
    app.get("/make-it-yours",(_,res)=>res.sendFile(path.join(__dirname,"../../public/customization.html")));
    app.get("/customization",(_,res)=>res.redirect(301,"/make-it-yours"));
    app.use(express.static(path.join(__dirname, "../../public")));
    app.get("/app", (req, res) =>
      res.sendFile(path.join(__dirname, "../../public/app.html")),
    );
    server = await new Promise((r) => {
      const s = app.listen(0, "127.0.0.1", () => r(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`,
      token = (u) =>
        jwt.sign(
          { id: users[u].id, workspace_id: users[u].workspace_id },
          process.env.JWT_SECRET,
        );
    async function req(
      uri,
      method = "GET",
      body,
      u = 0,
      scope = "team",
      headers = {},
    ) {
      const r = await fetch(base + "/api" + uri, {
          method,
          headers: {
            Authorization: "Bearer " + token(u),
            "Content-Type": "application/json",
            "X-Klyo-Scope": scope,
            "X-Klyo-Timezone": "Europe/Warsaw",
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "manual",
        }),
        text = await r.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: r.status, data, headers: r.headers };
    }
    return {
      db,
      P,
      S,
      w,
      other,
      users,
      connections,
      remote,
      calls,
      base,
      token,
      req,
      failNextCreation() {
        failAfterCreate = true;
      },
      async close() {
        P.call = originalCall;
        P.exchange = originalExchange;
        await new Promise((r) => server.close(r));
        await db.pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      },
    };
  } catch (e) {
    P.call = originalCall;
    P.exchange = originalExchange;
    if (server) await new Promise((r) => server.close(r));
    await db.pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    throw e;
  }
};
