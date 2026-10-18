const test = require("node:test"),
  assert = require("node:assert/strict");
test(
  "iCloud CalDAV discovery, tenant privacy and two-way synchronization",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await require("./helpers/calendar-fixture")(),
      cloud = require("./helpers/icloud-fixture")(),
      I = require("../server/services/icloudCalendar"),
      Sync = require("../server/services/icloudSync");
    const ok = (r, status = 200) => {
      assert.equal(r.status, status, JSON.stringify(r.data));
      return r.data;
    };
    const get = async (id) =>
      (await f.db.query("SELECT * FROM calendar_events WHERE id=$1", [id]))
        .rows[0];
    let conn, event, external;
    try {
      await t.test(
        "real DAV discovery verifies encrypted app password; endpoints do not disclose it",
        async () => {
          ok(
            await f.req("/calendar-integrations/icloud/connect", "POST", {
              apple_id: "owner@icloud.test",
              app_password: "mainPassword",
            }),
            400,
          );
          conn = ok(
            await f.req("/calendar-integrations/icloud/connect", "POST", {
              apple_id: "owner@icloud.test",
              app_password: "aaaa-bbbb-cccc-dddd",
            }),
          ).connection;
          assert.doesNotMatch(JSON.stringify(conn), /aaaa-bbbb|credentials/);
          const saved = (
            await f.db.query(
              "SELECT credentials FROM calendar_connections WHERE id=$1",
              [conn.id],
            )
          ).rows[0];
          assert.doesNotMatch(saved.credentials, /aaaa-bbbb/);
          const calendars = ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id + "/calendars",
            ),
          ).calendars;
          assert.equal(calendars[0].can_write, true);
          assert.equal(calendars[1].can_write, false);
          ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id + "/calendar",
              "PUT",
              { calendar_id: cloud.cal },
            ),
          );
          ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id + "/calendars",
              "GET",
              undefined,
              1,
            ),
            404,
          );
          ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id + "/calendars",
              "GET",
              undefined,
              0,
              "personal",
            ),
            404,
          );
          ok(
            await f.req(
              "/calendar-integrations/icloud/connect",
              "POST",
              {
                apple_id: "viewer@icloud.test",
                app_password: "aaaa-bbbb-cccc-dddd",
              },
              2,
            ),
            403,
          );
          const status = ok(await f.req("/calendar-integrations/status"));
          assert.ok(
            status.providers.find(
              (p) => p.provider === "icloud" && p.configured,
            ),
          );
          assert.doesNotMatch(
            JSON.stringify(status),
            /aaaa-bbbb|credentials|Authorization/,
          );
        },
      );
      await t.test(
        "private overlay does not create shared records; explicit copy links once",
        async () => {
          external = cloud.put("private");
          const list = ok(
            await f.req(
              "/calendar-integrations/events?start=2026-10-01T00:00:00Z&end=2026-11-01T00:00:00Z",
            ),
          ).events;
          assert.ok(
            list.some(
              (e) =>
                e.provider === "icloud" &&
                e.title === "Private iCloud appointment",
            ),
          );
          assert.equal(ok(await f.req("/calendar")).events.length, 0);
          event = ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id + "/copy",
              "POST",
              { external_id: external, confirm_share: true },
            ),
          ).event;
          assert.equal(
            ok(
              await f.req(
                "/calendar-integrations/connections/" + conn.id + "/copy",
                "POST",
                { external_id: external, confirm_share: true },
              ),
            ).event.id,
            event.id,
          );
          assert.equal(
            ok(await f.req("/calendar", "GET", undefined, 1)).events.length,
            1,
          );
          assert.equal(
            ok(
              await f.req("/calendar-integrations/status", "GET", undefined, 1),
            ).connections.length,
            0,
          );
          ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id + "/sync",
              "PUT",
              { auto_sync: true },
            ),
            400,
          );
          ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id + "/sync",
              "PUT",
              { auto_sync: true, confirm_changes: true },
            ),
          );
        },
      );
      const sync = () =>
        f.req(
          "/calendar-integrations/connections/" + conn.id + "/sync",
          "POST",
          { confirm_changes: true },
        );
      await t.test(
        "iCloud changes pull; CRM changes push using ETags; no repeat creates",
        async () => {
          cloud.put("private", { title: "Changed in Apple" });
          assert.equal(ok(await sync()).pulled, 1);
          event = await get(event.id);
          assert.equal(event.title, "Changed in Apple");
          event = ok(
            await f.req("/calendar/" + event.id, "PUT", {
              title: "Changed in CRM",
              revision: event.updated_at,
            }),
          ).event;
          assert.equal(ok(await sync()).pushed, 1);
          assert.equal(
            (
              await I.remote(
                (
                  await f.db.query(
                    "SELECT * FROM calendar_connections WHERE id=$1",
                    [conn.id],
                  )
                ).rows[0],
                external,
              )
            ).title,
            "Changed in CRM",
          );
          assert.equal(ok(await sync()).pushed, 0);
          assert.equal(cloud.files.size, 1);
          assert.ok(
            cloud.calls.some(
              (c) => c.method === "PUT" && c.headers.get("If-Match"),
            ),
          );
        },
      );
      await t.test(
        "simultaneous changes require a decision; manual pull resolves conflict",
        async () => {
          event = ok(
            await f.req("/calendar/" + event.id, "PUT", {
              title: "Local conflict",
            }),
          ).event;
          cloud.put("private", { title: "Remote conflict" });
          assert.equal(ok(await sync()).conflicts, 1);
          assert.equal((await get(event.id)).title, "Local conflict");
          const links = ok(
            await f.req("/calendar-integrations/events/" + event.id + "/links"),
          ).links;
          assert.equal(links[0].status, "conflict");
          assert.equal(
            ok(
              await f.req(
                "/calendar-integrations/connections/" + conn.id + "/issues",
              ),
            ).issues.length,
            1,
          );
          ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id + "/issues",
              "GET",
              undefined,
              1,
            ),
            404,
          );
          ok(
            await f.req(
              "/calendar-integrations/links/" + links[0].id + "/pull",
              "POST",
              { confirm_pull: true, revision: event.updated_at },
            ),
          );
          assert.equal((await get(event.id)).title, "Remote conflict");
        },
      );
      await t.test(
        "linked deletions propagate both ways; unrelated events and unlink are retained",
        async () => {
          cloud.files.delete(cloud.cal + "private.ics");
          assert.equal(ok(await sync()).deleted, 1);
          assert.equal(await get(event.id), undefined);
          external = cloud.put("delete-local");
          event = ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id + "/copy",
              "POST",
              { external_id: external, confirm_share: true },
            ),
          ).event;
          cloud.put("unrelated");
          ok(await f.req("/calendar/" + event.id, "DELETE"));
          assert.equal(ok(await sync()).deleted, 1);
          assert.ok(!cloud.files.has(cloud.cal + "delete-local.ics"));
          assert.ok(cloud.files.has(cloud.cal + "unrelated.ics"));
          external = cloud.put("unlink");
          event = ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id + "/copy",
              "POST",
              { external_id: external, confirm_share: true },
            ),
          ).event;
          const link = ok(
            await f.req("/calendar-integrations/events/" + event.id + "/links"),
          ).links[0];
          ok(await f.req("/calendar-integrations/links/" + link.id, "DELETE"));
          ok(await f.req("/calendar/" + event.id, "DELETE"));
          await sync();
          assert.ok(cloud.files.has(cloud.cal + "unlink.ics"));
        },
      );
      await t.test(
        "deletion conflicts can restore a CRM copy without destroying the Apple revision",
        async () => {
          external = cloud.put("restore");
          event = ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id + "/copy",
              "POST",
              { external_id: external, confirm_share: true },
            ),
          ).event;
          ok(await f.req("/calendar/" + event.id, "DELETE"));
          cloud.put("restore", { title: "Apple changed after local delete" });
          assert.equal(ok(await sync()).conflicts, 1);
          const issue = ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id + "/issues",
            ),
          ).issues.find((x) => !x.event_id);
          assert.ok(issue);
          const restored = ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id + "/copy",
              "POST",
              { external_id: issue.external_id, confirm_share: true },
            ),
          ).event;
          assert.equal(restored.title, "Apple changed after local delete");
          assert.equal(ok(await sync()).conflicts, 0);
        },
      );
      await t.test(
        "publishing retries a lost response without duplicate events",
        async () => {
          event = ok(
            await f.req("/calendar", "POST", {
              title: "New CRM appointment",
              start_at: "2026-10-22T09:00:00Z",
              end_at: "2026-10-22T10:00:00Z",
            }),
            201,
          ).event;
          const body = {
            connection_id: conn.id,
            revision: event.updated_at,
            confirm_publish: true,
          };
          cloud.failAfterPut = true;
          ok(
            await f.req(
              "/calendar-integrations/events/" + event.id + "/publish",
              "POST",
              body,
            ),
            502,
          );
          const count = cloud.files.size;
          ok(
            await f.req(
              "/calendar-integrations/events/" + event.id + "/publish",
              "POST",
              body,
            ),
          );
          assert.equal(cloud.files.size, count);
        },
      );
      await t.test(
        "background worker revalidates membership and syncs; revoked password is visible",
        async () => {
          event = ok(
            await f.req("/calendar/" + event.id, "PUT", {
              title: "Background edit",
            }),
          ).event;
          await f.db.query(
            "UPDATE calendar_connections SET last_sync_at=NULL WHERE id=$1",
            [conn.id],
          );
          await Sync.tick();
          const links = ok(
            await f.req("/calendar-integrations/events/" + event.id + "/links"),
          ).links;
          assert.equal(links[0].local_changed, false);
          event = ok(
            await f.req("/calendar/" + event.id, "PUT", {
              title: "Blocked while viewer",
            }),
          ).event;
          await f.db.query("UPDATE users SET role='viewer' WHERE id=$1", [
            f.users[0].id,
          ]);
          await f.db.query(
            "UPDATE calendar_connections SET last_sync_at=NULL WHERE id=$1",
            [conn.id],
          );
          await Sync.tick();
          assert.doesNotMatch(
            [...cloud.files.values()].map((v) => v.data).join(""),
            /Blocked while viewer/,
          );
          await f.db.query("UPDATE users SET role='admin' WHERE id=$1", [
            f.users[0].id,
          ]);
          await f.db.query(
            "UPDATE workspaces SET is_comped=false,plan='past_due' WHERE id=$1",
            [f.w],
          );
          await Sync.tick();
          assert.doesNotMatch(
            [...cloud.files.values()].map((v) => v.data).join(""),
            /Blocked while viewer/,
          );
          await f.db.query("UPDATE workspaces SET is_comped=true WHERE id=$1", [
            f.w,
          ]);
          cloud.deny = true;
          const result = ok(await sync());
          assert.ok(result.errors);
          const status = ok(await f.req("/calendar-integrations/status"));
          assert.ok(
            status.connections.find((c) => c.id === conn.id).sync_error,
          );
          cloud.deny = false;
          ok(
            await f.req(
              "/calendar-integrations/connections/" + conn.id,
              "DELETE",
            ),
          );
          assert.ok(cloud.files.size);
        },
      );
      await t.test(
        "Personal synchronization remains private and works independently of Team viewer role",
        async () => {
          await f.db.query("UPDATE users SET role='viewer' WHERE id=$1", [
            f.users[0].id,
          ]);
          const personal = ok(
            await f.req(
              "/calendar-integrations/icloud/connect",
              "POST",
              {
                apple_id: "owner@icloud.test",
                app_password: "aaaa-bbbb-cccc-dddd",
              },
              0,
              "personal",
            ),
          ).connection;
          ok(
            await f.req(
              "/calendar-integrations/connections/" + personal.id + "/calendar",
              "PUT",
              { calendar_id: cloud.cal },
              0,
              "personal",
            ),
          );
          const external = cloud.put("personal");
          const copied = ok(
            await f.req(
              "/calendar-integrations/connections/" + personal.id + "/copy",
              "POST",
              { external_id: external, confirm_share: true },
              0,
              "personal",
            ),
          ).event;
          ok(
            await f.req(
              "/calendar-integrations/connections/" + personal.id + "/sync",
              "PUT",
              { auto_sync: true, confirm_changes: true },
              0,
              "personal",
            ),
          );
          ok(
            await f.req(
              "/calendar/" + copied.id,
              "PUT",
              { title: "Personal edit" },
              0,
              "personal",
            ),
          );
          await Sync.tick();
          assert.ok(
            [...cloud.files.values()].some((v) =>
              v.data.includes("SUMMARY:Personal edit"),
            ),
          );
          ok(
            await f.req(
              "/calendar-integrations/connections/" + personal.id + "/issues",
              "GET",
              undefined,
              1,
              "personal",
            ),
            404,
          );
          assert.ok(
            !ok(await f.req("/calendar", "GET", undefined, 1)).events.some(
              (e) => e.id === copied.id,
            ),
          );
        },
      );
    } finally {
      cloud.restore();
      await f.close();
    }
  },
);
