// server/routes/products.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");

const router = express.Router();
router.use(requireAuth);
router.use(requirePaidAccess);

// GET /api/products — optionally filter by ?category=
router.get("/", async (req, res) => {
  const { category } = req.query;
  let sql = "SELECT * FROM products WHERE workspace_id = $1";
  const params = [req.user.workspace_id];
  if (category) { params.push(category); sql += ` AND category = $${params.length}`; }
  sql += " ORDER BY COALESCE(category,'') ASC, name ASC";
  const result = await db.query(sql, params);
  res.json({ products: result.rows });
});

// GET /api/products/categories — distinct category list for this workspace
router.get("/categories", async (req, res) => {
  const result = await db.query(
    "SELECT DISTINCT category FROM products WHERE workspace_id = $1 AND category IS NOT NULL ORDER BY category",
    [req.user.workspace_id]
  );
  res.json({ categories: result.rows.map(r => r.category) });
});

// POST /api/products
router.post("/", async (req, res) => {
  const { name, description, unit_price, unit_label, service_interval_months, category, currency, image_url, notes } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Product name is required." });

  const result = await db.query(
    `INSERT INTO products
       (workspace_id, name, description, unit_price, unit_label, service_interval_months, category, currency, image_url, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      req.user.workspace_id,
      name.trim(),
      description?.trim() || null,
      Number(unit_price) || 0,
      unit_label?.trim() || "unit",
      service_interval_months ? Number(service_interval_months) : null,
      category?.trim() || null,
      currency?.trim() || "USD",
      image_url?.trim() || null,
      notes?.trim() || null,
    ]
  );
  res.status(201).json({ product: result.rows[0] });
});

// POST /api/products/:id/duplicate — clone a product
router.post("/:id/duplicate", async (req, res) => {
  const src = await db.query("SELECT * FROM products WHERE id = $1 AND workspace_id = $2", [
    req.params.id, req.user.workspace_id,
  ]);
  if (!src.rows.length) return res.status(404).json({ error: "Product not found." });
  const p = src.rows[0];

  const result = await db.query(
    `INSERT INTO products
       (workspace_id, name, description, unit_price, unit_label, service_interval_months, category, currency, image_url, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      req.user.workspace_id,
      `${p.name} (copy)`,
      p.description, p.unit_price, p.unit_label, p.service_interval_months, p.category,
      p.currency || "USD", p.image_url, p.notes,
    ]
  );
  res.status(201).json({ product: result.rows[0] });
});

// PUT /api/products/:id
router.put("/:id", async (req, res) => {
  const existing = await db.query("SELECT id FROM products WHERE id = $1 AND workspace_id = $2", [
    req.params.id, req.user.workspace_id,
  ]);
  if (!existing.rows.length) return res.status(404).json({ error: "Product not found." });

  const { name, description, unit_price, unit_label, service_interval_months, category, currency, image_url, notes } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Product name is required." });

  const result = await db.query(
    `UPDATE products
     SET name=$1, description=$2, unit_price=$3, unit_label=$4, service_interval_months=$5,
         category=$6, currency=$7, image_url=$8, notes=$9
     WHERE id=$10 RETURNING *`,
    [
      name.trim(),
      description?.trim() || null,
      Number(unit_price) || 0,
      unit_label?.trim() || "unit",
      service_interval_months ? Number(service_interval_months) : null,
      category?.trim() || null,
      currency?.trim() || "USD",
      image_url?.trim() || null,
      notes?.trim() || null,
      req.params.id,
    ]
  );
  res.json({ product: result.rows[0] });
});

// DELETE /api/products/:id
router.delete("/:id", async (req, res) => {
  const existing = await db.query("SELECT id FROM products WHERE id = $1 AND workspace_id = $2", [
    req.params.id, req.user.workspace_id,
  ]);
  if (!existing.rows.length) return res.status(404).json({ error: "Product not found." });

  await db.query("DELETE FROM products WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
