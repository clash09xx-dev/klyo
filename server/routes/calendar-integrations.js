const crypto = require("crypto"),
  db = require("../db"),
  P = require("../services/calendarProviders"),
  S = require("../services/sharepoint"),
  E = require("../services/calendarEvents"),
  D = require("../services/dealWorkspace"),
  { requireAuth, requireEditor } = require("../middleware/auth");
const router = require("../middleware/safeRouter")(),
  cookie = (p) => "klyo_calendar_" + p,
  opts = (p) => ({
    httpOnly: true,
    sameSite: "lax",
    secure: P.base().startsWith("https:"),
    path: "/api/calendar-integrations/oauth/" + p + "/callback",
    maxAge: 600000,
  });
router.get("/oauth/:provider/callback", async (req, res) => {
  const p = req.params.provider,
    state = req.query.state,
    proof = String(req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim().split("="))
      .find((v) => v[0] === cookie(p))?.[1];
  if (
    !["google", "microsoft"].includes(p) ||
    typeof state !== "string" ||
    proof !== state
  )
    return res.redirect(P.base() + "/app?calendar_connect=error");
  res.clearCookie(cookie(p), { ...opts(p), maxAge: undefined });
  const pending = (
    await db.query(
      "DELETE FROM calendar_oauth_states WHERE id=$1 AND provider=$2 AND expires_at>now() RETURNING *",
      [state, p],
    )
  ).rows[0];
  if (!pending || req.query.error || typeof req.query.code !== "string")
    return res.redirect(P.base() + "/app?calendar_connect=cancelled");
  try {
    const account = (
      await db.query(
        "SELECT u.workspace_id,w.space_type,w.owner_user_id FROM users u JOIN workspaces w ON w.id=$2 WHERE u.id=$1",
        [pending.user_id, pending.workspace_id],
      )
    ).rows[0];
    if (
      !account ||
      account.workspace_id !== pending.account_workspace_id ||
      (account.space_type === "personal" &&
        account.owner_user_id !== pending.user_id)
    )
      throw D.invalid("Workspace access changed.");
    const credentials = await P.exchange(
      p,
      req.query.code,
      S.decrypt(pending.verifier),
    );
    await E.transaction(async (c) => {
      const old = (
        await c.query(
          "SELECT id FROM calendar_connections WHERE workspace_id=$1 AND user_id=$2 AND provider=$3 FOR UPDATE",
          [pending.workspace_id, pending.user_id, p],
        )
      ).rows[0];
      if (old) {
        const held = (
          await c.query("SELECT pg_try_advisory_xact_lock(9186,$1) AS locked", [
            old.id,
          ])
        ).rows[0].locked;
        if (!held) throw D.invalid("Calendar is busy. Reconnect again.", 409);
      }
      await c.query(
        `INSERT INTO calendar_connections(workspace_id,user_id,provider,credentials,account_id,account_name,generation) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,user_id,provider) DO UPDATE SET credentials=EXCLUDED.credentials,account_name=EXCLUDED.account_name,calendar_id=CASE WHEN calendar_connections.account_id=EXCLUDED.account_id THEN calendar_connections.calendar_id END,calendar_name=CASE WHEN calendar_connections.account_id=EXCLUDED.account_id THEN calendar_connections.calendar_name END,can_write=CASE WHEN calendar_connections.account_id=EXCLUDED.account_id THEN calendar_connections.can_write ELSE false END,account_id=EXCLUDED.account_id,generation=EXCLUDED.generation`,
        [
          pending.workspace_id,
          pending.user_id,
          p,
          credentials.credentials,
          credentials.account_id,
          credentials.account_name,
          crypto.randomUUID(),
        ],
      );
    });
    res.redirect(
      P.base() +
        "/app?calendar_connect=connected&scope=" +
        (account.space_type === "personal" ? "personal" : "team"),
    );
  } catch {
    res.redirect(P.base() + "/app?calendar_connect=error");
  }
});
router.use(requireAuth, require("../middleware/billing").requirePaidAccess);
router.use((req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});
router.get("/status", async (req, res) =>
  res.json({
    providers: P.providers.map((provider) => ({
      provider,
      configured: P.configured(provider),
    })),
    connections: (
      await db.query(
        "SELECT id,provider,account_name,calendar_id,calendar_name,can_write,last_read_at,auto_sync,last_sync_at,sync_error FROM calendar_connections WHERE workspace_id=$1 AND user_id=$2 ORDER BY id",
        [req.user.workspace_id, req.user.id],
      )
    ).rows,
  }),
);
router.post("/connect", async (req, res) => {
  const p = req.body.provider;
  if (!["google", "microsoft"].includes(p))
    throw D.invalid("Choose Google or Microsoft.");
  const state = crypto.randomBytes(32).toString("hex"),
    verifier = crypto.randomBytes(48).toString("base64url"),
    url = await P.authorize(p, state, verifier);
  await db.query(
    "DELETE FROM calendar_oauth_states WHERE expires_at<now() OR (workspace_id=$1 AND user_id=$2 AND provider=$3)",
    [req.user.workspace_id, req.user.id, p],
  );
  await db.query(
    "INSERT INTO calendar_oauth_states(id,workspace_id,user_id,account_workspace_id,provider,verifier,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')",
    [
      state,
      req.user.workspace_id,
      req.user.id,
      req.account.workspace_id,
      p,
      S.encrypt(verifier),
    ],
  );
  res.cookie(cookie(p), state, opts(p)).json({ url });
});
// Apple uses an app-specific password, not the Google/Microsoft OAuth route.
router.post("/icloud/connect", requireEditor, async (req, res) => {
  res.set("Cache-Control", "no-store");
  await db.query(
    "DELETE FROM calendar_oauth_states WHERE provider='icloud_attempt' AND expires_at<now()",
  );
  const attempts = (
    await db.query(
      "SELECT count(*)::integer AS n FROM calendar_oauth_states WHERE user_id=$1 AND provider='icloud_attempt' AND expires_at>now()",
      [req.user.id],
    )
  ).rows[0].n;
  if (attempts >= 10)
    throw D.invalid(
      "Too many iCloud connection attempts. Try again in an hour.",
      429,
    );
  await db.query(
    "INSERT INTO calendar_oauth_states(id,workspace_id,user_id,account_workspace_id,provider,verifier,expires_at) VALUES($1,$2,$3,$4,'icloud_attempt','',now()+interval '1 hour')",
    [
      crypto.randomUUID(),
      req.user.workspace_id,
      req.user.id,
      req.account.workspace_id,
    ],
  );
  const credentials = await require("../services/icloudCalendar").discover(
    req.body.apple_id,
    req.body.app_password,
  );
  const record = await E.transaction(async (c) => {
    const old = (
      await c.query(
        "SELECT id FROM calendar_connections WHERE workspace_id=$1 AND user_id=$2 AND provider='icloud' FOR UPDATE",
        [req.user.workspace_id, req.user.id],
      )
    ).rows[0];
    if (
      old &&
      !(
        await c.query("SELECT pg_try_advisory_xact_lock(9186,$1) AS locked", [
          old.id,
        ])
      ).rows[0].locked
    )
      throw D.invalid("Calendar is busy. Try reconnecting again.", 409);
    return (
      await c.query(
        `INSERT INTO calendar_connections(workspace_id,user_id,provider,credentials,account_id,account_name,generation) VALUES($1,$2,'icloud',$3,$4,$5,$6) ON CONFLICT(workspace_id,user_id,provider) DO UPDATE SET credentials=EXCLUDED.credentials,account_id=EXCLUDED.account_id,account_name=EXCLUDED.account_name,generation=EXCLUDED.generation,calendar_id=CASE WHEN calendar_connections.account_id=EXCLUDED.account_id THEN calendar_connections.calendar_id END,calendar_name=CASE WHEN calendar_connections.account_id=EXCLUDED.account_id THEN calendar_connections.calendar_name END,can_write=false,auto_sync=false,sync_error=NULL RETURNING id,provider,account_name`,
        [
          req.user.workspace_id,
          req.user.id,
          credentials.credentials,
          credentials.account_id,
          credentials.account_name,
          crypto.randomUUID(),
        ],
      )
    ).rows[0];
  });
  res.json({ connection: record });
});
router.put("/connections/:id/sync", requireEditor, async (req, res) =>
  res.json(
    await P.lock(req.user, req.params.id, async (conn, c) => {
      if (conn.provider !== "icloud" || !conn.calendar_id)
        throw D.invalid("Choose an iCloud calendar first.");
      if (typeof req.body.auto_sync !== "boolean")
        throw D.invalid("Choose whether to enable automatic synchronization.");
      if (req.body.auto_sync && req.body.confirm_changes !== true)
        throw D.invalid(
          "Confirm that linked event changes and deletions synchronize both ways.",
        );
      await c.query(
        "UPDATE calendar_connections SET auto_sync=$1,sync_error=NULL WHERE id=$2",
        [req.body.auto_sync, conn.id],
      );
      return { ok: true };
    }),
  ),
);
router.post("/connections/:id/sync", requireEditor, async (req, res) =>
  res.json(
    await P.lock(req.user, req.params.id, (conn, c) => {
      if (req.body.confirm_changes !== true)
        throw D.invalid(
          "Confirm synchronizing linked events, including deletions.",
        );
      return require("../services/icloudSync").sync(conn, c, req.user);
    }),
  ),
);
router.get("/connections/:id/issues", async (req, res) =>
  res.json(
    await P.lock(req.user, req.params.id, async (conn, c) => ({
      issues: (
        await c.query(
          "SELECT l.id,l.event_id,l.external_id,l.sync_error,e.title FROM calendar_event_links l LEFT JOIN calendar_events e ON e.id=l.event_id AND e.workspace_id=l.workspace_id WHERE l.connection_id=$1 AND l.workspace_id=$2 AND l.account_id=$3 AND l.calendar_id=$4 AND l.sync_error IS NOT NULL ORDER BY l.id LIMIT 500",
          [conn.id, req.user.workspace_id, conn.account_id, conn.calendar_id],
        )
      ).rows,
    })),
  ),
);
router.get("/connections/:id/calendars", async (req, res) =>
  res.json({
    calendars: await P.lock(req.user, req.params.id, (conn, c) =>
      P.calendars(conn, c),
    ),
  }),
);
router.put("/connections/:id/calendar", async (req, res) =>
  res.json(
    await P.lock(req.user, req.params.id, async (conn, c) => {
      const calendars = await P.calendars(conn, c),
        selected = calendars.find((x) => x.id === req.body.calendar_id);
      if (!selected) throw D.invalid("Choose an accessible calendar.");
      await c.query(
        "UPDATE calendar_connections SET calendar_id=$1,calendar_name=$2,can_write=$3,last_read_at=NULL,auto_sync=false,sync_error=NULL WHERE id=$4",
        [selected.id, selected.name, selected.can_write, conn.id],
      );
      return { ok: true };
    }),
  ),
);
router.delete("/connections/:id", async (req, res) =>
  res.json(
    await P.lock(req.user, req.params.id, async (conn, c) => {
      await c.query("DELETE FROM calendar_connections WHERE id=$1", [conn.id]);
      return { ok: true };
    }),
  ),
);
router.get("/events", async (req, res) => {
  const range = E.range(req.query),
    cs = (
      await db.query(
        "SELECT id,provider FROM calendar_connections WHERE workspace_id=$1 AND user_id=$2 AND calendar_id IS NOT NULL ORDER BY id",
        [req.user.workspace_id, req.user.id],
      )
    ).rows,
    results = await Promise.all(
      cs.map(async (v) => {
        try {
          return await P.lock(req.user, v.id, async (conn, c) => {
            const events = await P.read(conn, c, range),
              links = (
                await c.query(
                  "SELECT l.id,l.event_id,l.external_id,l.etag FROM calendar_event_links l JOIN calendar_events e ON e.id=l.event_id AND e.workspace_id=l.workspace_id WHERE l.connection_id=$1 AND l.workspace_id=$2 AND l.calendar_id=$3 AND l.account_id=$4",
                  [
                    conn.id,
                    req.user.workspace_id,
                    conn.calendar_id,
                    conn.account_id,
                  ],
                )
              ).rows;
            return {
              events: events.filter(
                (e) => !links.some((l) => l.external_id === e.external_id),
              ),
              updates: links
                .filter((l) =>
                  events.some(
                    (e) => e.external_id === l.external_id && e.etag !== l.etag,
                  ),
                )
                .map((l) => ({ connection_id: conn.id, event_id: l.event_id })),
            };
          });
        } catch (e) {
          return {
            events: [],
            error: {
              connection_id: v.id,
              provider: v.provider,
              message: e.status
                ? e.message
                : "Calendar could not be loaded. Try again.",
            },
          };
        }
      }),
    );
  res.json({
    events: results.flatMap((r) => r.events),
    updates: results.flatMap((r) => r.updates || []),
    errors: results.flatMap((r) => (r.error ? [r.error] : [])),
  });
});
async function local(c, user, id) {
  const event = (
    await c.query(
      "SELECT * FROM calendar_events WHERE id=$1 AND workspace_id=$2",
      [D.optionalId(id), user.workspace_id],
    )
  ).rows[0];
  if (!event) throw D.invalid("CRM event not found.", 404);
  return event;
}
function revision(event, b) {
  if (
    !b.revision ||
    new Date(b.revision).getTime() !== new Date(event.updated_at).getTime()
  )
    throw D.invalid(
      "This CRM event changed. Save and reload it before synchronizing.",
      409,
    );
}
router.get("/events/:id/links", async (req, res) => {
  const event = await local(db, req.user, req.params.id),
    links = (
      await db.query(
        "SELECT l.id,l.kind,l.status,l.etag,l.web_url,l.synced_at,l.local_hash,l.sync_error,c.auto_sync,c.id AS connection_id,c.provider,c.calendar_name FROM calendar_event_links l JOIN calendar_connections c ON c.id=l.connection_id WHERE l.event_id=$1 AND l.workspace_id=$2 AND c.workspace_id=$2 AND c.user_id=$3 AND l.account_id=c.account_id AND l.calendar_id=c.calendar_id",
        [event.id, req.user.workspace_id, req.user.id],
      )
    ).rows;
  res.json({
    event,
    links: links.map((l) => ({
      ...l,
      local_changed: l.local_hash !== P.hash(event),
      local_hash: undefined,
      etag: undefined,
    })),
  });
});
router.post("/events/:id/publish", requireEditor, async (req, res) => {
  if (req.body.confirm_publish !== true)
    throw D.invalid("Confirm publishing this CRM event to your calendar.");
  res.json(
    await P.lock(
      req.user,
      D.optionalId(req.body.connection_id),
      async (conn, c) => {
        if (!conn.calendar_id || !conn.can_write)
          throw D.invalid("Choose a writable calendar first.", 403);
        const event = await local(c, req.user, req.params.id);
        revision(event, req.body);
        let link = (
          await c.query(
            "SELECT * FROM calendar_event_links WHERE connection_id=$1 AND event_id=$2 AND account_id=$3 AND calendar_id=$4",
            [conn.id, event.id, conn.account_id, conn.calendar_id],
          )
        ).rows[0];
        if (link && link.kind !== "published" && conn.provider !== "icloud")
          throw D.invalid(
            "Copied external meetings are read-only here. Open them in the provider calendar.",
            409,
          );
        if (!link)
          link = (
            await c.query(
              `INSERT INTO calendar_event_links(workspace_id,connection_id,event_id,account_id,calendar_id,operation_id,reserved_hash,request_payload,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'published') RETURNING *`,
              [
                req.user.workspace_id,
                conn.id,
                event.id,
                conn.account_id,
                conn.calendar_id,
                crypto.randomUUID(),
                P.hash(event),
                JSON.stringify(P.payload(conn, event)),
              ],
            )
          ).rows[0];
        if (conn.provider === "icloud") {
          const remote = await require("../services/icloudCalendar").publish(
            conn,
            event,
            link,
          );
          if (!remote) throw D.invalid("iCloud did not return the event.", 502);
          await c.query(
            "UPDATE calendar_event_links SET external_id=$1,etag=$2,local_hash=$3,web_url=$4,status='synced',sync_error=NULL,synced_at=now() WHERE id=$5",
            [
              remote.external_id,
              remote.etag,
              link.external_id ? P.hash(event) : link.reserved_hash,
              remote.web_url,
              link.id,
            ],
          );
          return { ok: true, web_url: remote.web_url };
        }
        let raw;
        if (link.status === "synced") {
          const existing = await P.remote(conn, c, link.external_id);
          if (!existing)
            throw D.invalid(
              "External event was cancelled. Unlink it before publishing another.",
              409,
            );
          if (existing.etag !== link.etag)
            throw D.invalid(
              "This event changed outside Klyo. Pull the calendar version before updating.",
              409,
            );
          const original = await P.call(
            conn,
            c,
            P.eventPath(conn, link.external_id),
          );
          if (
            (original.attendees || []).length ||
            original.recurrence ||
            original.recurringEventId ||
            (original.type && original.type !== "singleInstance")
          )
            throw D.invalid(
              "This is now a meeting or recurring event. Manage it in the provider calendar.",
              409,
            );
          raw = await P.call(
            conn,
            c,
            P.eventPath(conn, link.external_id) +
              (conn.provider === "google" ? "?sendUpdates=none" : ""),
            {
              method: "PATCH",
              headers: link.etag ? { "If-Match": link.etag } : {},
              body: JSON.stringify(P.payload(conn, event)),
            },
          );
        } else {
          const id = link.operation_id.replace(/-/g, ""),
            body = {
              ...link.request_payload,
              ...(conn.provider === "google"
                ? { id }
                : { transactionId: link.operation_id }),
            };
          try {
            raw = await P.call(
              conn,
              c,
              P.eventPath(conn) +
                (conn.provider === "google" ? "?sendUpdates=none" : ""),
              { method: "POST", body: JSON.stringify(body) },
            );
          } catch (e) {
            if (conn.provider === "google" && e.provider_status === 409)
              raw = await P.call(conn, c, P.eventPath(conn, id));
            else throw e;
          }
        }
        const remote = await P.normalize(conn, c, raw);
        if (!remote)
          throw D.invalid("External calendar rejected this event.", 502);
        await c.query(
          "UPDATE calendar_event_links SET external_id=$1,etag=$2,local_hash=$3,web_url=$4,status='synced',synced_at=now() WHERE id=$5",
          [
            remote.external_id,
            remote.etag,
            link.status === "synced" ? P.hash(event) : link.reserved_hash,
            remote.web_url,
            link.id,
          ],
        );
        return { ok: true, web_url: remote.web_url };
      },
    ),
  );
});
router.post("/connections/:id/copy", requireEditor, async (req, res) => {
  if (req.body.confirm_share !== true)
    throw D.invalid(
      "Confirm copying this private event into the active CRM workspace.",
    );
  res.json(
    await P.lock(req.user, req.params.id, async (conn, c) => {
      if (!conn.calendar_id) throw D.invalid("Choose a calendar.");
      const remote = await P.remote(
        conn,
        c,
        D.text(req.body.external_id, 1500, "event ID", true),
      );
      if (!remote) throw D.invalid("This event was cancelled.", 409);
      return E.transaction(async (tx) => {
        let link = (
          await tx.query(
            "SELECT * FROM calendar_event_links WHERE connection_id=$1 AND account_id=$2 AND calendar_id=$3 AND external_id=$4 FOR UPDATE",
            [conn.id, conn.account_id, conn.calendar_id, remote.external_id],
          )
        ).rows[0];
        if (link?.event_id)
          return {
            event: await local(tx, req.user, link.event_id),
            already_copied: true,
          };
        const event = await E.save(req.user, null, remote, tx);
        if (link)
          await tx.query(
            "UPDATE calendar_event_links SET event_id=$1,local_hash=$2,etag=$3,status='synced',sync_error=NULL,synced_at=now() WHERE id=$4",
            [event.id, P.hash(event), remote.etag, link.id],
          );
        else
          await tx.query(
            "INSERT INTO calendar_event_links(workspace_id,connection_id,event_id,account_id,calendar_id,external_id,operation_id,kind,status,etag,local_hash,web_url,synced_at) VALUES($1,$2,$3,$4,$5,$6,$7,'copied','synced',$8,$9,$10,now())",
            [
              req.user.workspace_id,
              conn.id,
              event.id,
              conn.account_id,
              conn.calendar_id,
              remote.external_id,
              crypto.randomUUID(),
              remote.etag,
              P.hash(event),
              remote.web_url,
            ],
          );
        return { event };
      });
    }),
  );
});
router.post("/links/:id/pull", requireEditor, async (req, res) => {
  if (req.body.confirm_pull !== true)
    throw D.invalid(
      "Confirm replacing CRM event details with the provider version.",
    );
  const record = (
    await db.query(
      "SELECT l.connection_id FROM calendar_event_links l JOIN calendar_connections c ON c.id=l.connection_id WHERE l.id=$1 AND l.workspace_id=$2 AND c.user_id=$3",
      [D.optionalId(req.params.id), req.user.workspace_id, req.user.id],
    )
  ).rows[0];
  if (!record) throw D.invalid("Link not found.", 404);
  res.json(
    await P.lock(req.user, record.connection_id, async (conn, c) => {
      const link = (
        await c.query(
          "SELECT * FROM calendar_event_links WHERE id=$1 AND account_id=$2 AND calendar_id=$3",
          [req.params.id, conn.account_id, conn.calendar_id],
        )
      ).rows[0];
      if (!link)
        throw D.invalid(
          "Choose the original calendar before pulling this event.",
          409,
        );
      const remote = await P.remote(conn, c, link.external_id);
      if (!remote)
        throw D.invalid(
          "External event was cancelled. The CRM event was retained.",
          409,
        );
      return E.transaction(async (tx) => {
        const event = await local(tx, req.user, link.event_id);
        revision(event, req.body);
        const saved = await E.save(
          req.user,
          event.id,
          {
            ...remote,
            id: undefined,
            contact_id: event.contact_id,
            company_id: event.company_id,
            deal_id: event.deal_id,
            task_id: event.task_id,
            revision: req.body.revision,
          },
          tx,
        );
        await tx.query(
          "UPDATE calendar_event_links SET etag=$1,local_hash=$2,status='synced',sync_error=NULL,web_url=$3,synced_at=now() WHERE id=$4",
          [remote.etag, P.hash(saved), remote.web_url, link.id],
        );
        return { event: saved };
      });
    }),
  );
});
router.delete("/links/:id", requireEditor, async (req, res) => {
  const record = (
    await db.query(
      "SELECT l.connection_id FROM calendar_event_links l JOIN calendar_connections c ON c.id=l.connection_id WHERE l.id=$1 AND l.workspace_id=$2 AND c.workspace_id=$2 AND c.user_id=$3",
      [D.optionalId(req.params.id), req.user.workspace_id, req.user.id],
    )
  ).rows[0];
  if (!record) throw D.invalid("Link not found.", 404);
  res.json(
    await P.lock(req.user, record.connection_id, async (conn, c) => {
      const result = await c.query(
        "DELETE FROM calendar_event_links WHERE id=$1 AND connection_id=$2 AND workspace_id=$3 RETURNING id",
        [D.optionalId(req.params.id), conn.id, req.user.workspace_id],
      );
      if (!result.rows.length) throw D.invalid("Link not found.", 404);
      return { ok: true };
    }),
  );
});
module.exports = router;
