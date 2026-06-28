// server/routes/tasks.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

const VALID_STATUS   = ["todo", "in_progress", "done"];
const VALID_PRIORITY = ["low", "medium", "high"];

// GET /api/tasks  — filter: assigned_to, status, priority, contact_id, deal_id, overdue
router.get("/", async (req, res) => {
  const { assigned_to, status, priority, contact_id, deal_id, overdue } = req.query;

  let sql = `
    SELECT t.*,
           u.name  AS assigned_name,
           cu.name AS created_by_name,
           c.full_name AS contact_name,
           co.name     AS company_name,
           d.title     AS deal_title
    FROM tasks t
    LEFT JOIN users u  ON u.id  = t.assigned_to
    LEFT JOIN users cu ON cu.id = t.created_by
    LEFT JOIN contacts c  ON c.id  = t.contact_id
    LEFT JOIN companies co ON co.id = t.company_id
    LEFT JOIN deals d  ON d.id  = t.deal_id
    WHERE t.workspace_id = $1
  `;
  const params = [req.user.workspace_id];

  if (assigned_to) { params.push(assigned_to); sql += ` AND t.assigned_to = $${params.length}`; }
  if (status)      { params.push(status);       sql += ` AND t.status = $${params.length}`; }
  if (priority)    { params.push(priority);     sql += ` AND t.priority = $${params.length}`; }
  if (contact_id)  { params.push(contact_id);   sql += ` AND t.contact_id = $${params.length}`; }
  if (deal_id)     { params.push(deal_id);      sql += ` AND t.deal_id = $${params.length}`; }
  if (overdue === "1") sql += ` AND t.status != 'done' AND t.due_date < CURRENT_DATE`;

  sql += " ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.due_date NULLS LAST, t.created_at DESC";

  const result = await db.query(sql, params);
  res.json({ tasks: result.rows });
});

// POST /api/tasks
router.post("/", async (req, res) => {
  const { title, description, assigned_to, contact_id, company_id, deal_id, due_date, priority, status, reminder_at } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: "Task title is required." });

  const result = await db.query(
    `INSERT INTO tasks (workspace_id, title, description, assigned_to, created_by, contact_id, company_id, deal_id, due_date, priority, status, reminder_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      req.user.workspace_id,
      title.trim(),
      description?.trim() || null,
      assigned_to || null,
      req.user.id,
      contact_id || null,
      company_id || null,
      deal_id || null,
      due_date || null,
      VALID_PRIORITY.includes(priority) ? priority : "medium",
      VALID_STATUS.includes(status) ? status : "todo",
      reminder_at || null,
    ]
  );
  res.status(201).json({ task: result.rows[0] });
});

// PUT /api/tasks/:id
router.put("/:id", async (req, res) => {
  const existing = await db.query("SELECT id FROM tasks WHERE id = $1 AND workspace_id = $2", [req.params.id, req.user.workspace_id]);
  if (!existing.rows.length) return res.status(404).json({ error: "Task not found." });

  const { title, description, assigned_to, contact_id, company_id, deal_id, due_date, priority, status, reminder_at } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: "Task title is required." });

  const result = await db.query(
    `UPDATE tasks SET title=$1, description=$2, assigned_to=$3, contact_id=$4, company_id=$5,
       deal_id=$6, due_date=$7, priority=$8, status=$9, reminder_at=$10,
       reminder_sent_at = CASE WHEN $10::timestamptz IS DISTINCT FROM reminder_at THEN NULL ELSE reminder_sent_at END,
       updated_at=now()
     WHERE id=$11 RETURNING *`,
    [
      title.trim(),
      description?.trim() || null,
      assigned_to || null,
      contact_id || null,
      company_id || null,
      deal_id || null,
      due_date || null,
      VALID_PRIORITY.includes(priority) ? priority : "medium",
      VALID_STATUS.includes(status) ? status : "todo",
      reminder_at || null,
      req.params.id,
    ]
  );
  res.json({ task: result.rows[0] });
});

// PATCH /api/tasks/:id/status — quick status toggle
router.patch("/:id/status", async (req, res) => {
  const { status } = req.body || {};
  if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: "Invalid status." });

  const existing = await db.query("SELECT id FROM tasks WHERE id = $1 AND workspace_id = $2", [req.params.id, req.user.workspace_id]);
  if (!existing.rows.length) return res.status(404).json({ error: "Task not found." });

  await db.query("UPDATE tasks SET status=$1, updated_at=now() WHERE id=$2", [status, req.params.id]);
  res.json({ ok: true });
});

// DELETE /api/tasks/:id
router.delete("/:id", async (req, res) => {
  const existing = await db.query("SELECT id FROM tasks WHERE id = $1 AND workspace_id = $2", [req.params.id, req.user.workspace_id]);
  if (!existing.rows.length) return res.status(404).json({ error: "Task not found." });

  await db.query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
