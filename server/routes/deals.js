// server/routes/deals.js
// Sales Opportunities (Deals) — CRUD for deals and pipeline stage management.
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");

const router = express.Router();
router.use(requireAuth);
router.use(requirePaidAccess);

// ---- Pipeline stages ----

// GET /api/deals/stages
router.get("/stages", async (req, res) => {
  const result = await db.query(
    "SELECT * FROM pipeline_stages WHERE workspace_id = $1 ORDER BY sort_order, id",
    [req.user.workspace_id]
  );
  res.json({ stages: result.rows });
});

// POST /api/deals/stages
router.post("/stages", async (req, res) => {
  const { name, color } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Stage name is required." });

  // Place at the end
  const maxOrder = await db.query(
    "SELECT COALESCE(MAX(sort_order), -1) AS m FROM pipeline_stages WHERE workspace_id = $1",
    [req.user.workspace_id]
  );
  const sortOrder = Number(maxOrder.rows[0].m) + 1;

  const result = await db.query(
    "INSERT INTO pipeline_stages (workspace_id, name, color, sort_order) VALUES ($1,$2,$3,$4) RETURNING *",
    [req.user.workspace_id, name.trim(), color || "#6b7280", sortOrder]
  );
  res.status(201).json({ stage: result.rows[0] });
});

// PUT /api/deals/stages/:id
router.put("/stages/:id", async (req, res) => {
  const existing = await db.query(
    "SELECT id FROM pipeline_stages WHERE id = $1 AND workspace_id = $2",
    [req.params.id, req.user.workspace_id]
  );
  if (!existing.rows.length) return res.status(404).json({ error: "Stage not found." });

  const { name, color, sort_order } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Stage name is required." });

  const result = await db.query(
    "UPDATE pipeline_stages SET name=$1, color=$2, sort_order=COALESCE($3, sort_order) WHERE id=$4 RETURNING *",
    [name.trim(), color || "#6b7280", sort_order ?? null, req.params.id]
  );
  res.json({ stage: result.rows[0] });
});

// PUT /api/deals/stages/reorder — accepts [{id, sort_order}]
router.put("/stages/reorder", async (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: "order must be an array." });

  for (const { id, sort_order } of order) {
    await db.query(
      "UPDATE pipeline_stages SET sort_order=$1 WHERE id=$2 AND workspace_id=$3",
      [sort_order, id, req.user.workspace_id]
    );
  }
  res.json({ ok: true });
});

// DELETE /api/deals/stages/:id — moves deals in this stage to null
router.delete("/stages/:id", async (req, res) => {
  const existing = await db.query(
    "SELECT id FROM pipeline_stages WHERE id = $1 AND workspace_id = $2",
    [req.params.id, req.user.workspace_id]
  );
  if (!existing.rows.length) return res.status(404).json({ error: "Stage not found." });

  await db.query("UPDATE deals SET stage_id = NULL WHERE stage_id = $1", [req.params.id]);
  await db.query("DELETE FROM pipeline_stages WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// ---- Deals ----

// GET /api/deals
router.get("/", async (req, res) => {
  const { stage_id, assigned_to, contact_id, status, search } = req.query;

  let sql = `
    SELECT d.*,
           c.full_name  AS contact_name,
           co.name      AS company_name,
           p.name       AS product_name,
           ps.name      AS stage_name, ps.color AS stage_color,
           u.name       AS assigned_name
    FROM deals d
    LEFT JOIN contacts c ON c.id = d.contact_id
    LEFT JOIN companies co ON co.id = d.company_id
    LEFT JOIN products p ON p.id = d.product_id
    LEFT JOIN pipeline_stages ps ON ps.id = d.stage_id
    LEFT JOIN users u ON u.id = d.assigned_to
    WHERE d.workspace_id = $1
  `;
  const params = [req.user.workspace_id];

  if (stage_id) { params.push(stage_id); sql += ` AND d.stage_id = $${params.length}`; }
  if (assigned_to) { params.push(assigned_to); sql += ` AND d.assigned_to = $${params.length}`; }
  if (contact_id) { params.push(contact_id); sql += ` AND d.contact_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND d.status = $${params.length}`; }
  if (search) {
    params.push(`%${search}%`);
    sql += ` AND (d.title ILIKE $${params.length} OR c.full_name ILIKE $${params.length} OR co.name ILIKE $${params.length})`;
  }

  sql += " ORDER BY d.updated_at DESC";
  const result = await db.query(sql, params);
  res.json({ deals: result.rows });
});

// POST /api/deals
router.post("/", async (req, res) => {
  const { title, contact_id, company_id, product_id, stage_id, assigned_to, value, currency, quantity, expected_close_date, notes } =
    req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: "Deal title is required." });

  const result = await db.query(
    `INSERT INTO deals (workspace_id, title, contact_id, company_id, product_id, stage_id, assigned_to, value, currency, quantity, expected_close_date, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      req.user.workspace_id,
      title.trim(),
      contact_id || null,
      company_id || null,
      product_id || null,
      stage_id || null,
      assigned_to || null,
      value || null,
      currency || "USD",
      quantity || 1,
      expected_close_date || null,
      notes?.trim() || null,
    ]
  );
  res.status(201).json({ deal: result.rows[0] });
});

// GET /api/deals/:id
router.get("/:id", async (req, res) => {
  const result = await db.query(
    `SELECT d.*,
            c.full_name AS contact_name,
            co.name     AS company_name,
            p.name      AS product_name,
            ps.name     AS stage_name, ps.color AS stage_color,
            u.name      AS assigned_name
     FROM deals d
     LEFT JOIN contacts c ON c.id = d.contact_id
     LEFT JOIN companies co ON co.id = d.company_id
     LEFT JOIN products p ON p.id = d.product_id
     LEFT JOIN pipeline_stages ps ON ps.id = d.stage_id
     LEFT JOIN users u ON u.id = d.assigned_to
     WHERE d.id = $1 AND d.workspace_id = $2`,
    [req.params.id, req.user.workspace_id]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Deal not found." });
  res.json({ deal: result.rows[0] });
});

// PUT /api/deals/:id
router.put("/:id", async (req, res) => {
  const existing = await db.query("SELECT id FROM deals WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  if (!existing.rows.length) return res.status(404).json({ error: "Deal not found." });

  const { title, contact_id, company_id, product_id, stage_id, assigned_to, value, currency, quantity, expected_close_date, notes, status } =
    req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: "Deal title is required." });

  const result = await db.query(
    `UPDATE deals SET title=$1, contact_id=$2, company_id=$3, product_id=$4, stage_id=$5,
       assigned_to=$6, value=$7, currency=$8, quantity=$9, expected_close_date=$10,
       notes=$11, status=COALESCE($12, status), updated_at=now()
     WHERE id=$13 RETURNING *`,
    [
      title.trim(),
      contact_id || null,
      company_id || null,
      product_id || null,
      stage_id || null,
      assigned_to || null,
      value || null,
      currency || "USD",
      quantity || 1,
      expected_close_date || null,
      notes?.trim() || null,
      status || null,
      req.params.id,
    ]
  );
  res.json({ deal: result.rows[0] });
});

// PATCH /api/deals/:id/stage — quick stage move (from kanban drag)
router.patch("/:id/stage", async (req, res) => {
  const { stage_id } = req.body || {};
  const existing = await db.query("SELECT id FROM deals WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  if (!existing.rows.length) return res.status(404).json({ error: "Deal not found." });

  await db.query("UPDATE deals SET stage_id=$1, updated_at=now() WHERE id=$2", [stage_id || null, req.params.id]);
  res.json({ ok: true });
});

// DELETE /api/deals/:id
router.delete("/:id", async (req, res) => {
  const existing = await db.query("SELECT id FROM deals WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  if (!existing.rows.length) return res.status(404).json({ error: "Deal not found." });

  await db.query("DELETE FROM deals WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
