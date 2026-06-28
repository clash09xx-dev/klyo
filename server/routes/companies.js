// server/routes/companies.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");

const router = express.Router();
router.use(requireAuth);
router.use(requirePaidAccess);

// GET /api/companies — list, with contact counts
router.get("/", async (req, res) => {
  const { search } = req.query;
  let sql = `
    SELECT c.*, COUNT(ct.id) AS contact_count
    FROM companies c
    LEFT JOIN contacts ct ON ct.company_id = c.id
    WHERE c.workspace_id = $1
  `;
  const params = [req.user.workspace_id];
  if (search) {
    params.push(`%${search}%`);
    sql += ` AND c.name ILIKE $${params.length}`;
  }
  sql += ` GROUP BY c.id ORDER BY c.name`;

  const result = await db.query(sql, params);
  res.json({ companies: result.rows.map((r) => ({ ...r, contact_count: Number(r.contact_count) })) });
});

// GET /api/companies/export — download all companies as CSV
router.get("/export", async (req, res) => {
  const result = await db.query(
    `SELECT c.name, c.industry, c.notes, COUNT(ct.id) AS contact_count, c.created_at
     FROM companies c
     LEFT JOIN contacts ct ON ct.company_id = c.id
     WHERE c.workspace_id = $1
     GROUP BY c.id
     ORDER BY c.name`,
    [req.user.workspace_id]
  );

  const header = ["Company Name","Industry","Contacts","Notes","Created At"];
  const csvRows = [header, ...result.rows.map((r) => [
    r.name, r.industry, r.contact_count, r.notes,
    r.created_at ? new Date(r.created_at).toISOString() : "",
  ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`))];

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="companies.csv"');
  res.send(csvRows.map((r) => r.join(",")).join("\n"));
});

// POST /api/companies — create
router.post("/", async (req, res) => {
  const { name, industry, notes } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Company name is required." });

  const result = await db.query(
    "INSERT INTO companies (workspace_id, name, industry, notes) VALUES ($1, $2, $3, $4) RETURNING *",
    [req.user.workspace_id, name.trim(), industry?.trim() || null, notes?.trim() || null]
  );
  res.status(201).json({ company: result.rows[0] });
});

// GET /api/companies/:id — detail + its contacts (decision-makers first)
router.get("/:id", async (req, res) => {
  const companyResult = await db.query("SELECT * FROM companies WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  const company = companyResult.rows[0];
  if (!company) return res.status(404).json({ error: "Company not found." });

  const contactsResult = await db.query(
    `SELECT id, full_name, email, phone, title, is_decision_maker, status
     FROM contacts WHERE company_id = $1 AND workspace_id = $2
     ORDER BY is_decision_maker DESC, full_name`,
    [req.params.id, req.user.workspace_id]
  );

  res.json({ company, contacts: contactsResult.rows });
});

// PUT /api/companies/:id
router.put("/:id", async (req, res) => {
  const existing = await db.query("SELECT id FROM companies WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  if (!existing.rows.length) return res.status(404).json({ error: "Company not found." });

  const { name, industry, notes } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Company name is required." });

  const result = await db.query(
    "UPDATE companies SET name=$1, industry=$2, notes=$3, updated_at=now() WHERE id=$4 RETURNING *",
    [name.trim(), industry?.trim() || null, notes?.trim() || null, req.params.id]
  );
  res.json({ company: result.rows[0] });
});

// DELETE /api/companies/:id — contacts stay, just lose their company link
router.delete("/:id", async (req, res) => {
  const existing = await db.query("SELECT id FROM companies WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  if (!existing.rows.length) return res.status(404).json({ error: "Company not found." });

  await db.query("DELETE FROM companies WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
