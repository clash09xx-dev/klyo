// server/routes/clients.js
// Clients = contacts who are at "customer" stage or have at least one accepted quote.
// This is a read-optimised view — mutations still go through /api/contacts.
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/clients — list all clients with aggregated stats
router.get("/", async (req, res) => {
  try {
    const { search, owner_id } = req.query;

    let sql = `
      SELECT c.*,
             COALESCE(c.first_name || ' ' || c.last_name, c.full_name) AS full_name,
             co.name AS company_name,
             u.name  AS owner_name,
             COUNT(DISTINCT q.id) FILTER (WHERE q.status = 'accepted') AS accepted_quotes,
             COALESCE(SUM(q.total) FILTER (WHERE q.status = 'accepted'), 0) AS total_revenue,
             COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'won') AS deals_won,
             MAX(q.accepted_at) AS last_purchase_at
      FROM contacts c
      LEFT JOIN companies co ON co.id = c.company_id
      LEFT JOIN users     u  ON u.id  = c.owner_id
      LEFT JOIN quotes    q  ON q.contact_id = c.id AND q.workspace_id = c.workspace_id
      LEFT JOIN deals     d  ON d.contact_id = c.id AND d.workspace_id = c.workspace_id
      WHERE c.workspace_id = $1
        AND (c.status = 'customer' OR EXISTS (
          SELECT 1 FROM quotes q2 WHERE q2.contact_id = c.id AND q2.status = 'accepted'
        ))
    `;
    const params = [req.user.workspace_id];

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (c.full_name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR co.name ILIKE $${params.length})`;
    }
    if (owner_id) {
      params.push(owner_id);
      sql += ` AND c.owner_id = $${params.length}`;
    }

    sql += " GROUP BY c.id, co.name, u.name ORDER BY last_purchase_at DESC NULLS LAST, c.full_name ASC";

    const result = await db.query(sql, params);
    res.json({ clients: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load clients." });
  }
});

// GET /api/clients/:id — single client profile with full history
router.get("/:id", async (req, res) => {
  try {
    const clientRes = await db.query(
      `SELECT c.*, co.name AS company_name, u.name AS owner_name
       FROM contacts c
       LEFT JOIN companies co ON co.id = c.company_id
       LEFT JOIN users     u  ON u.id  = c.owner_id
       WHERE c.id = $1 AND c.workspace_id = $2`,
      [req.params.id, req.user.workspace_id]
    );
    if (!clientRes.rows.length) return res.status(404).json({ error: "Client not found." });

    const [quotesRes, dealsRes, tasksRes] = await Promise.all([
      db.query(
        "SELECT * FROM quotes WHERE contact_id = $1 AND workspace_id = $2 ORDER BY created_at DESC",
        [req.params.id, req.user.workspace_id]
      ),
      db.query(
        "SELECT * FROM deals WHERE contact_id = $1 AND workspace_id = $2 ORDER BY created_at DESC",
        [req.params.id, req.user.workspace_id]
      ),
      db.query(
        "SELECT t.*, u.name AS assigned_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to WHERE t.contact_id = $1 AND t.workspace_id = $2 ORDER BY t.due_date NULLS LAST",
        [req.params.id, req.user.workspace_id]
      ),
    ]);

    res.json({
      client: clientRes.rows[0],
      quotes: quotesRes.rows,
      deals: dealsRes.rows,
      tasks: tasksRes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load client." });
  }
});

module.exports = router;
