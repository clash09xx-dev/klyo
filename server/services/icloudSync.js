// Only explicitly linked events participate; unrelated private calendar data is never imported.
const db = require("../db"),
  P = require("./calendarProviders"),
  I = require("./icloudCalendar"),
  E = require("./calendarEvents"),
  D = require("./dealWorkspace");
async function sync(conn, c, user) {
  if (conn.provider !== "icloud" || !conn.calendar_id)
    throw D.invalid("Choose an iCloud calendar first.");
  const result = { pushed: 0, pulled: 0, deleted: 0, conflicts: 0, errors: 0 };
  const links = (
    await c.query(
      "SELECT * FROM calendar_event_links WHERE connection_id=$1 AND workspace_id=$2 AND account_id=$3 AND calendar_id=$4 AND status NOT IN('pending','deleted') ORDER BY id LIMIT 501",
      [conn.id, user.workspace_id, conn.account_id, conn.calendar_id],
    )
  ).rows;
  if (links.length > 500)
    throw D.invalid(
      "Too many linked events for one synchronization. Unlink older events.",
      413,
    );
  for (const link of links) {
    try {
      const event = (
        await c.query(
          "SELECT * FROM calendar_events WHERE id=$1 AND workspace_id=$2",
          [link.event_id, user.workspace_id],
        )
      ).rows[0];
      const remote = await I.remote(conn, link.external_id);
      if (!event && !remote) {
        await c.query(
          "UPDATE calendar_event_links SET status='deleted',sync_error=NULL,synced_at=now() WHERE id=$1",
          [link.id],
        );
        continue;
      }
      const localChanged = event && P.hash(event) !== link.local_hash;
      const remoteChanged = remote && remote.etag !== link.etag;
      if (
        (localChanged && remoteChanged) ||
        (!remote && localChanged) ||
        (!event && remoteChanged)
      ) {
        result.conflicts++;
        await c.query(
          "UPDATE calendar_event_links SET status='conflict',sync_error='Both versions changed. Choose the CRM or iCloud version before synchronizing.' WHERE id=$1",
          [link.id],
        );
        continue;
      }
      if (!event) {
        if (!conn.can_write)
          throw D.invalid("This iCloud calendar is read-only.", 403);
        await I.remove(conn, link);
        await c.query(
          "UPDATE calendar_event_links SET status='deleted',sync_error=NULL,synced_at=now() WHERE id=$1",
          [link.id],
        );
        result.deleted++;
        continue;
      }
      if (!remote || remoteChanged) {
        await c.query("BEGIN");
        try {
          const current = (
            await c.query(
              "SELECT * FROM calendar_events WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
              [event.id, user.workspace_id],
            )
          ).rows[0];
          if (!current || P.hash(current) !== P.hash(event))
            throw D.invalid(
              "CRM event changed while synchronizing. Retry.",
              409,
            );
          if (!remote) {
            await c.query(
              "DELETE FROM calendar_events WHERE id=$1 AND workspace_id=$2",
              [event.id, user.workspace_id],
            );
            await c.query(
              "UPDATE calendar_event_links SET status='deleted',sync_error=NULL,synced_at=now() WHERE id=$1",
              [link.id],
            );
            result.deleted++;
          } else {
            const saved = await E.save(
              user,
              event.id,
              {
                ...remote,
                contact_id: event.contact_id,
                company_id: event.company_id,
                deal_id: event.deal_id,
                task_id: event.task_id,
                revision: event.updated_at,
              },
              c,
            );
            await c.query(
              "UPDATE calendar_event_links SET etag=$1,local_hash=$2,status='synced',sync_error=NULL,synced_at=now() WHERE id=$3",
              [remote.etag, P.hash(saved), link.id],
            );
            result.pulled++;
          }
          await c.query("COMMIT");
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        }
      } else if (localChanged) {
        if (!conn.can_write)
          throw D.invalid("This iCloud calendar is read-only.", 403);
        const saved = await I.publish(conn, event, link);
        if (!saved)
          throw D.invalid("iCloud did not return the updated event.", 502);
        await c.query(
          "UPDATE calendar_event_links SET etag=$1,local_hash=$2,status='synced',sync_error=NULL,synced_at=now() WHERE id=$3",
          [saved.etag, P.hash(event), link.id],
        );
        result.pushed++;
      } else
        await c.query(
          "UPDATE calendar_event_links SET status='synced',sync_error=NULL,synced_at=now() WHERE id=$1",
          [link.id],
        );
    } catch (e) {
      result.errors++;
      await c.query(
        "UPDATE calendar_event_links SET sync_error=$1 WHERE id=$2",
        [
          e.status
            ? e.message
            : "iCloud synchronization failed. Reconnect or retry.",
          link.id,
        ],
      );
      if (
        [401, 403, 429].includes(e.provider_status) ||
        e.status >= 500 ||
        !e.status
      )
        break;
    }
  }
  await c.query(
    "UPDATE calendar_connections SET last_sync_at=now(),sync_error=$1 WHERE id=$2",
    [
      result.conflicts || result.errors
        ? "Some linked events need attention. Open Event calendar links."
        : null,
      conn.id,
    ],
  );
  return result;
}
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    // Revalidate membership, role and billing on every background run, including Personal billing parent.
    const rows = (
      await db.query(
        `SELECT c.id,c.user_id,c.workspace_id,CASE WHEN w.space_type='personal' THEN 'admin' ELSE u.role END AS role FROM calendar_connections c JOIN users u ON u.id=c.user_id JOIN workspaces w ON w.id=c.workspace_id JOIN workspaces b ON b.id=COALESCE(w.billing_workspace_id,w.id) WHERE c.provider='icloud' AND c.auto_sync=true AND c.calendar_id IS NOT NULL AND (c.last_sync_at IS NULL OR c.last_sync_at<now()-interval '2 minutes') AND (w.space_type='personal' OR u.role!='viewer') AND ((w.space_type='personal' AND w.owner_user_id=u.id) OR (w.space_type!='personal' AND u.workspace_id=w.id)) AND ((b.is_comped AND (b.comped_until IS NULL OR b.comped_until>now())) OR (NOT b.onboarding_payment_required AND ((b.plan='active' AND (b.stripe_subscription_id IS NOT NULL OR b.current_period_end IS NULL OR b.current_period_end>now())) OR (b.plan='trial' AND b.trial_ends_at>now())))) ORDER BY c.last_sync_at NULLS FIRST,c.id LIMIT 20`,
      )
    ).rows;
    for (const row of rows) {
      const user = {
        id: row.user_id,
        workspace_id: row.workspace_id,
        role: row.role,
      };
      try {
        await P.lock(user, row.id, (conn, c) => sync(conn, c, user));
      } catch (e) {
        if (e.status !== 409)
          await db.query(
            "UPDATE calendar_connections SET last_sync_at=now(),sync_error=$1 WHERE id=$2",
            [
              e.status
                ? e.message
                : "iCloud synchronization is unavailable. Retry later.",
              row.id,
            ],
          );
      }
    }
  } finally {
    running = false;
  }
}
function start() {
  const timer = setInterval(
    () =>
      tick().catch(() => console.error("iCloud synchronization job failed.")),
    60000,
  );
  timer.unref();
}
module.exports = { sync, tick, start };
