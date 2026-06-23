// server/routes/stats.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");

const router = express.Router();
router.use(requireAuth);
router.use(requirePaidAccess);

// GET /api/stats — numbers for the dashboard cards, scoped to this workspace
router.get("/", async (req, res) => {
  const wsId = req.user.workspace_id;

  const [total, leads, negotiating, customers, offersSent, trend] = await Promise.all([
    db.query("SELECT COUNT(*) AS n FROM contacts WHERE workspace_id = $1", [wsId]),
    db.query("SELECT COUNT(*) AS n FROM contacts WHERE workspace_id = $1 AND status = 'lead'", [wsId]),
    db.query("SELECT COUNT(*) AS n FROM contacts WHERE workspace_id = $1 AND status = 'negotiating'", [wsId]),
    db.query("SELECT COUNT(*) AS n FROM contacts WHERE workspace_id = $1 AND status = 'customer'", [wsId]),
    db.query(
      "SELECT COUNT(*) AS n FROM offers WHERE workspace_id = $1 AND status = 'sent' AND sent_at >= now() - interval '30 days'",
      [wsId]
    ),
    db.query(
      `SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*) AS n
       FROM contacts WHERE workspace_id = $1 AND created_at >= now() - interval '6 days'
       GROUP BY day`,
      [wsId]
    ),
  ]);

  const trendMap = Object.fromEntries(trend.rows.map((r) => [r.day, Number(r.n)]));
  const series = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push(trendMap[key] || 0);
  }

  res.json({
    total: Number(total.rows[0].n),
    leads: Number(leads.rows[0].n),
    negotiating: Number(negotiating.rows[0].n),
    customers: Number(customers.rows[0].n),
    offersSent: Number(offersSent.rows[0].n),
    series,
  });
});

module.exports = router;
