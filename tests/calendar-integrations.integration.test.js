const test = require("node:test"),
  assert = require("node:assert/strict");
test(
  "calendar API privacy, publication, conflicts, copying and OAuth",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await require("./helpers/calendar-fixture")(),
      { db, P, S, w, other, users, remote, calls, req } = f,
      [g, m] = f.connections;
    let event, pending;
    const ok = (r, status = 200) => {
      assert.equal(r.status, status, JSON.stringify(r.data));
      return r.data;
    };
    try {
      await t.test(
        "OAuth uses PKCE and one-time browser-bound state without mailbox permissions",
        async () => {
          const auth = new URL(
            ok(
              await req("/calendar-integrations/connect", "POST", {
                provider: "google",
              }),
            ).url,
          );
          assert.match(auth.searchParams.get("scope"), /calendar.events/);
          assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
          assert.doesNotMatch(auth.searchParams.get("scope"), /gmail/);
          const state = auth.searchParams.get("state");
          let bad = await req(
            "/calendar-integrations/oauth/google/callback?code=fake&state=" +
              state,
          );
          assert.match(bad.headers.get("location"), /calendar_connect=error/);
          assert.equal(
            (await db.query("SELECT count(*) FROM calendar_oauth_states"))
              .rows[0].count,
            "1",
          );
          P.exchange = async () => ({
            credentials: S.encrypt("fake"),
            account_id: g.account_id,
            account_name: g.account_name,
          });
          let good = await req(
            "/calendar-integrations/oauth/google/callback?code=fake&state=" +
              state,
            "GET",
            undefined,
            0,
            "team",
            { Cookie: "klyo_calendar_google=" + state },
          );
          assert.match(
            good.headers.get("location"),
            /calendar_connect=connected/,
          );
          assert.equal(
            (await db.query("SELECT count(*) FROM calendar_oauth_states"))
              .rows[0].count,
            "0",
          );
        },
      );
      await t.test(
        "calendar selection, credentials and external events remain private to user and space",
        async () => {
          for (const c of [g, m])
            ok(
              await req(
                "/calendar-integrations/connections/" + c.id + "/calendar",
                "PUT",
                { calendar_id: "work" },
              ),
            );
          const status = ok(await req("/calendar-integrations/status"));
          assert.equal(status.connections.length, 2);
          assert.doesNotMatch(
            JSON.stringify(status),
            /credentials|fake|refresh_token/,
          );
          assert.equal(
            ok(await req("/calendar-integrations/status", "GET", undefined, 1))
              .connections.length,
            0,
          );
          ok(
            await req(
              "/calendar-integrations/connections/" + g.id + "/calendars",
              "GET",
              undefined,
              1,
            ),
            404,
          );
          ok(
            await req(
              "/calendar-integrations/connections/" + g.id + "/calendars",
              "GET",
              undefined,
              0,
              "personal",
            ),
            404,
          );
          const result = ok(
            await req(
              "/calendar-integrations/events?start=2026-10-01T00:00Z&end=2026-11-01T00:00Z",
            ),
          );
          assert.equal(result.events.length, 3);
          assert.equal(
            result.events.find((e) => e.external_id === "all-day").end_date,
            "2026-10-28",
          );
          assert.equal(
            ok(
              await req(
                "/calendar-integrations/events?start=2026-10-01T00:00Z&end=2026-11-01T00:00Z",
                "GET",
                undefined,
                1,
              ),
            ).events.length,
            0,
          );
        },
      );
      await t.test(
        "local events validate scope, time offsets, overlap and ICS dates",
        async () => {
          const ct = (
            await db.query(
              "INSERT INTO contacts(workspace_id,full_name) VALUES($1,'Other') RETURNING id",
              [other],
            )
          ).rows[0];
          ok(
            await req("/calendar", "POST", {
              title: "Bad",
              start_at: "2026-10-20T10:00Z",
              contact_id: ct.id,
            }),
            400,
          );
          event = ok(
            await req("/calendar", "POST", {
              title: "Customer inspection",
              start_at: "2026-10-20T11:00:00+02:00",
              end_at: "2026-10-20T12:00:00+02:00",
              location: "Plant A",
            }),
            201,
          ).event;
          assert.equal(event.start_at, "2026-10-20T09:00:00.000Z");
          ok(
            await req(
              "/calendar/" + event.id,
              "PUT",
              { title: "Viewer edit" },
              2,
            ),
            403,
          );
          ok(
            await req(
              "/calendar/" + event.id,
              "PUT",
              { title: "Other edit" },
              3,
            ),
            404,
          );
          const all = ok(
            await req("/calendar", "POST", {
              title: "Conference",
              all_day: true,
              start_date: "2026-10-25",
              end_date: "2026-10-28",
            }),
            201,
          ).event;
          assert.ok(
            ok(
              await req(
                "/calendar?start=2026-10-26T00:00Z&end=2026-10-27T00:00Z",
              ),
            ).events.some((e) => e.id === all.id),
          );
          const file = await req(
            "/calendar/export.ics?start=2026-10-01T00:00Z&end=2026-11-01T00:00Z",
          );
          assert.equal(file.status, 200);
          assert.match(file.data, /DTSTART:20261020T090000Z/);
          assert.match(file.data, /DTEND;VALUE=DATE:20261028/);
        },
      );
      await t.test(
        "publishing is explicit, idempotent and rejects stale versions or meetings",
        async () => {
          ok(
            await req(
              "/calendar-integrations/events/" + event.id + "/publish",
              "POST",
              { connection_id: g.id, revision: event.updated_at },
            ),
            400,
          );
          ok(
            await req(
              "/calendar-integrations/events/" + event.id + "/publish",
              "POST",
              {
                connection_id: g.id,
                revision: event.updated_at,
                confirm_publish: true,
              },
              1,
            ),
            404,
          );
          ok(
            await req(
              "/calendar-integrations/events/" + event.id + "/publish",
              "POST",
              {
                connection_id: g.id,
                revision: event.updated_at,
                confirm_publish: true,
              },
              2,
            ),
            403,
          );
          for (let n = 0; n < 2; n++)
            ok(
              await req(
                "/calendar-integrations/events/" + event.id + "/publish",
                "POST",
                {
                  connection_id: g.id,
                  revision: event.updated_at,
                  confirm_publish: true,
                },
              ),
            );
          let links = ok(
            await req("/calendar-integrations/events/" + event.id + "/links"),
          );
          assert.equal(links.links.length, 1);
          assert.equal(links.links[0].local_changed, false);
          const link = (
              await db.query(
                "SELECT * FROM calendar_event_links WHERE event_id=$1",
                [event.id],
              )
            ).rows[0],
            raw = remote.get("google:" + link.external_id);
          raw.summary = "Changed in Google";
          raw.etag = '"remote edit"';
          ok(
            await req(
              "/calendar-integrations/events/" + event.id + "/publish",
              "POST",
              {
                connection_id: g.id,
                revision: event.updated_at,
                confirm_publish: true,
              },
            ),
            409,
          );
          const pulled = ok(
            await req(
              "/calendar-integrations/links/" + link.id + "/pull",
              "POST",
              { confirm_pull: true, revision: event.updated_at },
            ),
          ).event;
          assert.equal(pulled.title, "Changed in Google");
          ok(
            await req(
              "/calendar-integrations/events/" + event.id + "/publish",
              "POST",
              {
                connection_id: g.id,
                revision: event.updated_at,
                confirm_publish: true,
              },
            ),
            409,
          );
          event = pulled;
          raw.attendees = [{ email: "someone@test" }];
          ok(
            await req(
              "/calendar-integrations/events/" + event.id + "/publish",
              "POST",
              {
                connection_id: g.id,
                revision: event.updated_at,
                confirm_publish: true,
              },
            ),
            409,
          );
          delete raw.attendees;
        },
      );
      await t.test(
        "uncertain creation retries the same operation and detects later local edits",
        async () => {
          pending = ok(
            await req("/calendar", "POST", {
              title: "Before timeout",
              start_at: "2026-10-23T10:00Z",
            }),
            201,
          ).event;
          f.failNextCreation();
          ok(
            await req(
              "/calendar-integrations/events/" + pending.id + "/publish",
              "POST",
              {
                connection_id: g.id,
                revision: pending.updated_at,
                confirm_publish: true,
              },
            ),
            500,
          );
          pending = ok(
            await req("/calendar/" + pending.id, "PUT", {
              title: "After timeout",
            }),
          ).event;
          ok(
            await req(
              "/calendar-integrations/events/" + pending.id + "/publish",
              "POST",
              {
                connection_id: g.id,
                revision: pending.updated_at,
                confirm_publish: true,
              },
            ),
          );
          assert.equal(
            ok(
              await req(
                "/calendar-integrations/events/" + pending.id + "/links",
              ),
            ).links[0].local_changed,
            true,
          );
          assert.equal(
            [...remote.values()].filter((e) => e.summary === "Before timeout")
              .length,
            1,
          );
        },
      );
      await t.test(
        "copying is explicit and repeat-safe; Team colleagues see only shared CRM copies",
        async () => {
          ok(
            await req(
              "/calendar-integrations/connections/" + g.id + "/copy",
              "POST",
              { external_id: "private" },
            ),
            400,
          );
          const body = { external_id: "private", confirm_share: true },
            first = ok(
              await req(
                "/calendar-integrations/connections/" + g.id + "/copy",
                "POST",
                body,
              ),
            ),
            again = ok(
              await req(
                "/calendar-integrations/connections/" + g.id + "/copy",
                "POST",
                body,
              ),
            );
          assert.equal(first.event.id, again.event.id);
          assert.equal(again.already_copied, true);
          assert.ok(
            ok(
              await req(
                "/calendar?start=2026-10-01T00:00Z&end=2026-11-01T00:00Z",
                "GET",
                undefined,
                1,
              ),
            ).events.some((e) => e.id === first.event.id),
          );
          assert.equal(
            ok(
              await req(
                "/calendar-integrations/events?start=2026-10-01T00:00Z&end=2026-11-01T00:00Z",
              ),
            ).events.some((e) => e.external_id === "private"),
            false,
          );
          const link = (
            await db.query(
              "SELECT * FROM calendar_event_links WHERE event_id=$1",
              [first.event.id],
            )
          ).rows[0];
          ok(
            await req(
              "/calendar-integrations/events/" + first.event.id + "/publish",
              "POST",
              {
                connection_id: g.id,
                confirm_publish: true,
                revision: first.event.updated_at,
              },
            ),
            409,
          );
          const before = calls.length;
          ok(
            await req(
              "/calendar-integrations/links/" + link.id,
              "DELETE",
              undefined,
              1,
            ),
            404,
          );
          ok(await req("/calendar-integrations/links/" + link.id, "DELETE"));
          assert.equal(calls.length, before);
          assert.ok(remote.has("google:private"));
        },
      );
      await t.test(
        "publication and unlink refuse concurrent mutations of a calendar connection",
        async () => {
          const link = (
            await db.query(
              "SELECT id FROM calendar_event_links WHERE event_id=$1 AND connection_id=$2",
              [event.id, g.id],
            )
          ).rows[0];
          await P.lock(users[0], g.id, async () => {
            ok(
              await req(
                "/calendar-integrations/events/" + event.id + "/publish",
                "POST",
                {
                  connection_id: g.id,
                  revision: event.updated_at,
                  confirm_publish: true,
                },
              ),
              409,
            );
            ok(
              await req("/calendar-integrations/links/" + link.id, "DELETE"),
              409,
            );
          });
          assert.equal(
            (
              await db.query(
                "SELECT count(*) FROM calendar_event_links WHERE id=$1",
                [link.id],
              )
            ).rows[0].count,
            "1",
          );
        },
      );
      await t.test(
        "Google token refresh rotates encrypted credentials and reuses an unexpired token",
        async () => {
          const conn = (
            await db.query("SELECT * FROM calendar_connections WHERE id=$1", [
              g.id,
            ])
          ).rows[0];
          conn.credentials = S.encrypt(
            JSON.stringify({ refresh_token: "unit-refresh", expires_at: 0 }),
          );
          await db.query(
            "UPDATE calendar_connections SET credentials=$1 WHERE id=$2",
            [conn.credentials, conn.id],
          );
          const originalFetch = global.fetch;
          let refreshes = 0;
          try {
            global.fetch = async (url, options) => {
              assert.equal(url, "https://oauth2.googleapis.com/token");
              assert.equal(options.body.get("refresh_token"), "unit-refresh");
              refreshes++;
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  access_token: "unit-access",
                  refresh_token: "rotated",
                  expires_in: 3600,
                }),
              };
            };
            assert.equal(await P.token(conn, db), "unit-access");
            assert.equal(await P.token(conn, db), "unit-access");
            assert.equal(refreshes, 1);
            const saved = (
              await db.query(
                "SELECT credentials FROM calendar_connections WHERE id=$1",
                [g.id],
              )
            ).rows[0].credentials;
            assert.notEqual(saved, "rotated");
            assert.equal(JSON.parse(S.decrypt(saved)).refresh_token, "rotated");
          } finally {
            global.fetch = originalFetch;
          }
        },
      );
      await t.test(
        "Outlook all-day dates use the event original timezone, and changed links are flagged",
        async () => {
          const original = P.call;
          try {
            P.call = async (c, client, uri, options) => {
              assert.match(
                options.headers.Prefer,
                /outlook.timezone="Central European Standard Time"/,
              );
              return {
                id: "day",
                subject: "Warsaw all-day",
                isAllDay: true,
                start: { dateTime: "2026-10-25T00:00:00" },
                end: { dateTime: "2026-10-27T00:00:00" },
              };
            };
            const e = await P.normalize(m, db, {
              id: "day",
              isAllDay: true,
              originalStartTimeZone: "Central European Standard Time",
            });
            assert.equal(e.start_date, "2026-10-25");
            assert.equal(e.end_date, "2026-10-27");
          } finally {
            P.call = original;
          }
          const link = (
            await db.query(
              "SELECT * FROM calendar_event_links WHERE event_id=$1 AND kind='published'",
              [event.id],
            )
          ).rows[0];
          remote.get("google:" + link.external_id).etag = '"new-drift"';
          const data = ok(
            await req(
              "/calendar-integrations/events?start=2026-10-01T00:00Z&end=2026-11-01T00:00Z",
            ),
          );
          assert.ok(
            data.updates.some(
              (u) => u.event_id === event.id && u.connection_id === g.id,
            ),
          );
        },
      );
      await t.test(
        "Microsoft publishes without attendees; disconnect retains local and remote events",
        async () => {
          ok(
            await req(
              "/calendar-integrations/events/" + pending.id + "/publish",
              "POST",
              {
                connection_id: m.id,
                revision: pending.updated_at,
                confirm_publish: true,
              },
            ),
          );
          const body = JSON.parse(
            calls.find((c) => c.provider === "microsoft" && c.method === "POST")
              .body,
          );
          assert.ok(body.transactionId);
          assert.equal(body.attendees, undefined);
          ok(await req("/calendar-integrations/connections/" + m.id, "DELETE"));
          assert.ok(
            ok(await req("/calendar")).events.some((e) => e.id === pending.id),
          );
          assert.ok(
            [...remote].some(
              ([k]) =>
                k.startsWith("microsoft:") && k !== "microsoft:m-private",
            ),
          );
        },
      );
    } finally {
      await f.close();
    }
  },
);
