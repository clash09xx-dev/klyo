// server/routes/team-stats.js
// ---------------------------------------------------------
// Admin-only performance breakdown per team member. Almost
// entirely derived from activity_log, which already records who
// did what — this just counts it by type, per person, over a
// date range.
// ---------------------------------------------------------
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");

const router = express.Router();
router.use(requireAuth);
router.use(requirePaidAccess);

router.get("/", async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the workspace admin can view team performance." });
  }

  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await db.query(
    `SELECT
       u.id AS user_id,
       u.name AS user_name,
       COUNT(*) FILTER (WHERE a.type = 'contact_created') AS leads_generated,
       COUNT(*) FILTER (WHERE a.type = 'offer_drafted') AS offers_created,
       COUNT(*) FILTER (WHERE a.type = 'offer_sent') AS offers_sent,
       COUNT(*) FILTER (WHERE a.type = 'quote_created') AS quotes_created,
       COUNT(*) FILTER (WHERE a.type = 'quote_sent') AS quotes_sent,
       COUNT(*) FILTER (WHERE a.type = 'quote_accepted') AS quotes_accepted,
       COUNT(*) FILTER (WHERE a.type = 'call_logged') AS calls_logged,
       COUNT(*) FILTER (WHERE a.type = 'meeting_logged') AS meetings_logged,
       COUNT(DISTINCT a.contact_id) FILTER (WHERE a.type IN ('offer_sent','quote_sent','call_logged','meeting_logged')) AS clients_contacted
     FROM users u
     LEFT JOIN activity_log a ON a.user_id = u.id AND a.created_at >= $2
     WHERE u.workspace_id = $1
     GROUP BY u.id, u.name
     ORDER BY u.name`,
    [req.user.workspace_id, since]
  );

  const rows = result.rows.map((r) => ({
    user_id: r.user_id,
    user_name: r.user_name,
    leads_generated: Number(r.leads_generated),
    offers_created: Number(r.offers_created),
    offers_sent: Number(r.offers_sent),
    quotes_created: Number(r.quotes_created),
    quotes_sent: Number(r.quotes_sent),
    quotes_accepted: Number(r.quotes_accepted),
    calls_logged: Number(r.calls_logged),
    meetings_logged: Number(r.meetings_logged),
    clients_contacted: Number(r.clients_contacted),
  }));

  res.json({ days, team: rows });
});

module.exports = router;
