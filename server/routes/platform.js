// server/routes/platform.js
// ---------------------------------------------------------
// The developer's view across every workspace — not visible or
// reachable by any customer, regardless of their role. Shows who's
// using Klyo, who's paying, and lets you grant any workspace free
// access at any tier, for a limited time or forever, with no CLI
// or database access needed.
// ---------------------------------------------------------
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePlatformAdmin } = require("../middleware/platformAdmin");
const { getTier, TIER_ORDER } = require("../config/tiers");
const { isCurrentlyComped } = require("../services/limits");

const router = express.Router();
router.use(requireAuth);
router.use(requirePlatformAdmin);

const GRANT_DURATIONS = {
  "1_month": 1,
  "3_months": 3,
  "6_months": 6,
  "1_year": 12,
  forever: null,
};

function computeCompedUntil(duration) {
  const months = GRANT_DURATIONS[duration];
  if (months == null) return null;
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}

router.get("/overview", async (req, res) => {
  const [workspaceCounts, userCount, contactCount, quotesSent, offersSent, signups7d, signups30d, activeWorkspaces] =
    await Promise.all([
      db.query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE plan = 'trial') AS trial,
           COUNT(*) FILTER (WHERE plan = 'active') AS active,
           COUNT(*) FILTER (WHERE plan = 'past_due') AS past_due,
           COUNT(*) FILTER (WHERE is_comped AND (comped_until IS NULL OR comped_until > now())) AS comped
         FROM workspaces`
      ),
      db.query("SELECT COUNT(*) AS n FROM users"),
      db.query("SELECT COUNT(*) AS n FROM contacts"),
      db.query("SELECT COUNT(*) AS n FROM quotes WHERE status IN ('sent','accepted','declined')"),
      db.query("SELECT COUNT(*) AS n FROM offers WHERE status = 'sent'"),
      db.query("SELECT COUNT(*) AS n FROM workspaces WHERE created_at >= now() - interval '7 days'"),
      db.query("SELECT COUNT(*) AS n FROM workspaces WHERE created_at >= now() - interval '30 days'"),
      db.query(
        "SELECT tier FROM workspaces WHERE plan = 'active' AND NOT (is_comped AND (comped_until IS NULL OR comped_until > now()))"
      ),
    ]);

  const estimatedMrr = activeWorkspaces.rows.reduce((sum, row) => sum + getTier(row.tier).price, 0);

  res.json({
    workspaces: {
      total: Number(workspaceCounts.rows[0].total),
      trial: Number(workspaceCounts.rows[0].trial),
      active: Number(workspaceCounts.rows[0].active),
      past_due: Number(workspaceCounts.rows[0].past_due),
      comped: Number(workspaceCounts.rows[0].comped),
    },
    total_users: Number(userCount.rows[0].n),
    total_contacts: Number(contactCount.rows[0].n),
    quotes_sent: Number(quotesSent.rows[0].n),
    offers_sent: Number(offersSent.rows[0].n),
    signups_7d: Number(signups7d.rows[0].n),
    signups_30d: Number(signups30d.rows[0].n),
    estimated_mrr: estimatedMrr,
  });
});

router.get("/workspaces", async (req, res) => {
  const result = await db.query(
    `SELECT w.id, w.name, w.plan, w.tier, w.is_comped, w.comped_until, w.trial_ends_at, w.created_at,
            COUNT(DISTINCT u.id) AS user_count,
            COUNT(DISTINCT c.id) AS contact_count
     FROM workspaces w
     LEFT JOIN users u ON u.workspace_id = w.id
     LEFT JOIN contacts c ON c.workspace_id = w.id
     GROUP BY w.id
     ORDER BY w.created_at DESC`
  );
  res.json({
    workspaces: result.rows.map((r) => ({
      ...r,
      user_count: Number(r.user_count),
      contact_count: Number(r.contact_count),
      is_comped: isCurrentlyComped(r),
    })),
  });
});

router.get("/users", async (req, res) => {
  const result = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.created_at, u.google_id IS NOT NULL AS via_google,
            w.name AS workspace_name, w.plan, w.tier
     FROM users u
     JOIN workspaces w ON w.id = u.workspace_id
     ORDER BY u.created_at DESC`
  );
  res.json({ users: result.rows });
});

// POST /api/platform/workspaces/:id/grant — give any workspace free
// access at any tier, for a limited time or forever. This is the
// dashboard replacement for the comp-workspace CLI script.
router.post("/workspaces/:id/grant", async (req, res) => {
  const { tier, duration } = req.body || {};
  if (!TIER_ORDER.includes(tier)) return res.status(400).json({ error: "Pick a valid tier." });
  if (!Object.keys(GRANT_DURATIONS).includes(duration)) return res.status(400).json({ error: "Pick a valid duration." });

  const existing = await db.query("SELECT id FROM workspaces WHERE id = $1", [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: "Workspace not found." });

  const compedUntil = computeCompedUntil(duration);
  await db.query("UPDATE workspaces SET is_comped = TRUE, tier = $1, comped_until = $2 WHERE id = $3", [
    tier,
    compedUntil,
    req.params.id,
  ]);

  res.json({ ok: true, tier, comped_until: compedUntil });
});

// POST /api/platform/workspaces/:id/revoke — end a grant early
router.post("/workspaces/:id/revoke", async (req, res) => {
  const existing = await db.query("SELECT id FROM workspaces WHERE id = $1", [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: "Workspace not found." });

  await db.query("UPDATE workspaces SET is_comped = FALSE, comped_until = NULL WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// GET /api/platform/page-views — the simple built-in visit counter
router.get("/page-views", async (req, res) => {
  const [today, week, month, total, byPath] = await Promise.all([
    db.query("SELECT COUNT(*) AS n FROM page_views WHERE created_at >= now() - interval '1 day'"),
    db.query("SELECT COUNT(*) AS n FROM page_views WHERE created_at >= now() - interval '7 days'"),
    db.query("SELECT COUNT(*) AS n FROM page_views WHERE created_at >= now() - interval '30 days'"),
    db.query("SELECT COUNT(*) AS n FROM page_views"),
    db.query(
      `SELECT path, COUNT(*) AS n FROM page_views
       WHERE created_at >= now() - interval '30 days'
       GROUP BY path ORDER BY n DESC LIMIT 10`
    ),
  ]);

  res.json({
    today: Number(today.rows[0].n),
    last_7_days: Number(week.rows[0].n),
    last_30_days: Number(month.rows[0].n),
    all_time: Number(total.rows[0].n),
    by_path: byPath.rows.map((r) => ({ path: r.path, count: Number(r.n) })),
  });
});

module.exports = router;
