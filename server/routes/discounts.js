// server/routes/discounts.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");

const router = express.Router();
router.use(requireAuth);
router.use(requirePaidAccess);

// GET /api/discounts?contact_id=&company_id= — used by the quote builder to
// suggest/auto-apply a standing discount when a product is added for a customer
router.get("/", async (req, res) => {
  const { contact_id, company_id } = req.query;
  let sql = `
    SELECT d.*, p.name AS product_name
    FROM customer_discounts d
    JOIN products p ON p.id = d.product_id
    WHERE d.workspace_id = $1
  `;
  const params = [req.user.workspace_id];
  if (contact_id) {
    params.push(contact_id);
    sql += ` AND d.contact_id = $${params.length}`;
  }
  if (company_id) {
    params.push(company_id);
    sql += ` AND d.company_id = $${params.length}`;
  }
  sql += ` ORDER BY d.created_at DESC`;

  const result = await db.query(sql, params);
  res.json({ discounts: result.rows });
});

// POST /api/discounts — either contact_id or company_id, plus a product + percent
router.post("/", async (req, res) => {
  const { contact_id, company_id, product_id, discount_percent, notes } = req.body || {};
  if (!contact_id && !company_id) {
    return res.status(400).json({ error: "Pick a customer or a company to attach this discount to." });
  }
  if (!product_id) return res.status(400).json({ error: "Pick a product for this discount." });

  const result = await db.query(
    `INSERT INTO customer_discounts (workspace_id, contact_id, company_id, product_id, discount_percent, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.user.workspace_id, contact_id || null, company_id || null, product_id, Number(discount_percent) || 0, notes?.trim() || null]
  );
  res.status(201).json({ discount: result.rows[0] });
});

// DELETE /api/discounts/:id
router.delete("/:id", async (req, res) => {
  const existing = await db.query("SELECT id FROM customer_discounts WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  if (!existing.rows.length) return res.status(404).json({ error: "Discount not found." });

  await db.query("DELETE FROM customer_discounts WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
