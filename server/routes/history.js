// server/routes/history.js
// Workspace-wide activity feed — every entry in activity_log for this
// workspace, most recent first, with optional filters.
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");

const router = express.Router();
router.use(requireAuth);
router.use(requirePaidAccess);

// GET /api/history?user_id=&type=&limit=&offset=
router.get("/", async (req, res) => {
  const { user_id, type, limit = 100, offset = 0 } = req.query;

  let sql = `
    SELECT a.id, a.type, a.description, a.created_at,
           u.name AS user_name,
           c.id   AS contact_id,
           c.full_name AS contact_name
    FROM activity_log a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN contacts c ON c.id = a.contact_id
    WHERE a.workspace_id = $1
  `;
  const params = [req.user.workspace_id];

  if (user_id) {
    params.push(user_id);
    sql += ` AND a.user_id = $${params.length}`;
  }
  if (type) {
    params.push(type);
    sql += ` AND a.type = $${params.length}`;
  }

  sql += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(Number(limit), Number(offset));

  const result = await db.query(sql, params);

  // Total count (for pagination)
  let countSql = `SELECT COUNT(*) AS n FROM activity_log a WHERE a.workspace_id = $1`;
  const countParams = [req.user.workspace_id];
  if (user_id) { countParams.push(user_id); countSql += ` AND a.user_id = $${countParams.length}`; }
  if (type)    { countParams.push(type);    countSql += ` AND a.type = $${countParams.length}`; }
  const countResult = await db.query(countSql, countParams);

  res.json({ entries: result.rows, total: Number(countResult.rows[0].n) });
});

module.exports = router;
