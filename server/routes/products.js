// server/routes/products.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");

const router = express.Router();
router.use(requireAuth);
router.use(requirePaidAccess);

// GET /api/products — the catalog quotes are built from
router.get("/", async (req, res) => {
  const result = await db.query("SELECT * FROM products WHERE workspace_id = $1 ORDER BY name", [
    req.user.workspace_id,
  ]);
  res.json({ products: result.rows });
});

// POST /api/products
router.post("/", async (req, res) => {
  const { name, description, unit_price, unit_label, service_interval_months } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Product name is required." });

  const result = await db.query(
    `INSERT INTO products (workspace_id, name, description, unit_price, unit_label, service_interval_months)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      req.user.workspace_id,
      name.trim(),
      description?.trim() || null,
      Number(unit_price) || 0,
      unit_label?.trim() || "unit",
      service_interval_months ? Number(service_interval_months) : null,
    ]
  );
  res.status(201).json({ product: result.rows[0] });
});

// PUT /api/products/:id
router.put("/:id", async (req, res) => {
  const existing = await db.query("SELECT id FROM products WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  if (!existing.rows.length) return res.status(404).json({ error: "Product not found." });

  const { name, description, unit_price, unit_label, service_interval_months } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Product name is required." });

  const result = await db.query(
    `UPDATE products SET name=$1, description=$2, unit_price=$3, unit_label=$4, service_interval_months=$5
     WHERE id=$6 RETURNING *`,
    [
      name.trim(),
      description?.trim() || null,
      Number(unit_price) || 0,
      unit_label?.trim() || "unit",
      service_interval_months ? Number(service_interval_months) : null,
      req.params.id,
    ]
  );
  res.json({ product: result.rows[0] });
});

// DELETE /api/products/:id
router.delete("/:id", async (req, res) => {
  const existing = await db.query("SELECT id FROM products WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  if (!existing.rows.length) return res.status(404).json({ error: "Product not found." });

  await db.query("DELETE FROM products WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
