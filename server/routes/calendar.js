// server/routes/calendar.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/calendar?start=&end=
router.get("/", async (req, res) => {
  try {
    const { start, end } = req.query;
    let sql = `
      SELECT e.*,
        u.name  AS creator_name,
        c.full_name AS contact_name,
        co.name AS company_name,
        d.title AS deal_title,
        t.title AS task_title
      FROM calendar_events e
      LEFT JOIN users    u  ON u.id  = e.created_by
      LEFT JOIN contacts c  ON c.id  = e.contact_id
      LEFT JOIN companies co ON co.id = e.company_id
      LEFT JOIN deals    d  ON d.id  = e.deal_id
      LEFT JOIN tasks    t  ON t.id  = e.task_id
      WHERE e.workspace_id = $1
    `;
    const params = [req.user.workspace_id];
    if (start) { params.push(start); sql += ` AND e.start_at >= $${params.length}`; }
    if (end)   { params.push(end);   sql += ` AND e.start_at <= $${params.length}`; }
    sql += " ORDER BY e.start_at ASC";
    const result = await db.query(sql, params);
    res.json({ events: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load calendar events." });
  }
});

// POST /api/calendar
router.post("/", async (req, res) => {
  try {
    const { title, description, start_at, end_at, all_day, color, contact_id, company_id, deal_id, task_id } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: "Title is required." });
    if (!start_at)      return res.status(400).json({ error: "Start date is required." });

    const result = await db.query(
      `INSERT INTO calendar_events
         (workspace_id, created_by, title, description, start_at, end_at, all_day, color, contact_id, company_id, deal_id, task_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.user.workspace_id, req.user.id,
        title.trim(), description?.trim() || null,
        start_at, end_at || null,
        all_day || false,
        color || "#6366f1",
        contact_id || null, company_id || null, deal_id || null, task_id || null,
      ]
    );
    res.status(201).json({ event: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create event." });
  }
});

// PUT /api/calendar/:id
router.put("/:id", async (req, res) => {
  try {
    const existing = await db.query(
      "SELECT id FROM calendar_events WHERE id = $1 AND workspace_id = $2",
      [req.params.id, req.user.workspace_id]
    );
    if (!existing.rows.length) return res.status(404).json({ error: "Event not found." });

    const { title, description, start_at, end_at, all_day, color, contact_id, company_id, deal_id, task_id } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: "Title is required." });

    const result = await db.query(
      `UPDATE calendar_events
       SET title=$1, description=$2, start_at=$3, end_at=$4, all_day=$5, color=$6,
           contact_id=$7, company_id=$8, deal_id=$9, task_id=$10, updated_at=now()
       WHERE id=$11 RETURNING *`,
      [
        title.trim(), description?.trim() || null,
        start_at, end_at || null,
        all_day || false, color || "#6366f1",
        contact_id || null, company_id || null, deal_id || null, task_id || null,
        req.params.id,
      ]
    );
    res.json({ event: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update event." });
  }
});

// DELETE /api/calendar/:id
router.delete("/:id", async (req, res) => {
  try {
    const existing = await db.query(
      "SELECT id FROM calendar_events WHERE id = $1 AND workspace_id = $2",
      [req.params.id, req.user.workspace_id]
    );
    if (!existing.rows.length) return res.status(404).json({ error: "Event not found." });
    await db.query("DELETE FROM calendar_events WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete event." });
  }
});

module.exports = router;
