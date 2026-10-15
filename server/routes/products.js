const db = require("../db"),
  { requireAuth, requireEditor } = require("../middleware/auth"),
  { requirePaidAccess } = require("../middleware/billing");
const F = require("../services/customFields"),
  { invalid, text, optionalId } = require("../services/dealWorkspace"),
  { normalizeCurrency } = require("../services/workspaceCurrency");
const router = require("../middleware/safeRouter")();
router.use(requireAuth, requirePaidAccess);
router.get("/", async (req, res) => {
  const params = [req.user.workspace_id];
  let sql = "SELECT * FROM products WHERE workspace_id=$1";
  if (req.query.category) {
    params.push(req.query.category);
    sql += " AND category=$2";
  }
  res.json({
    products: (
      await db.query(sql + " ORDER BY COALESCE(category,''),name", params)
    ).rows,
  });
});
router.get("/categories", async (req, res) =>
  res.json({
    categories: (
      await db.query(
        "SELECT DISTINCT category FROM products WHERE workspace_id=$1 AND category IS NOT NULL ORDER BY category",
        [req.user.workspace_id],
      )
    ).rows.map((r) => r.category),
  }),
);
async function save(user, id, input) {
  const old = id
    ? (
        await db.query(
          "SELECT * FROM products WHERE id=$1 AND workspace_id=$2",
          [optionalId(id), user.workspace_id],
        )
      ).rows[0]
    : null;
  if (id && !old) throw invalid("Product not found.", 404);
  const b = { ...old, ...input },
    price = Number(b.unit_price ?? 0);
  if (!Number.isFinite(price) || price < 0 || price > 9999999999.99)
    throw invalid("Enter a valid product price.");
  const months = (v, name) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 1200)
      throw invalid(`Choose 1–1200 months for ${name}.`);
    return n;
  };
  const currency = normalizeCurrency(
    b.currency ||
      (
        await db.query("SELECT default_currency FROM workspaces WHERE id=$1", [
          user.workspace_id,
        ])
      ).rows[0]?.default_currency ||
      "USD",
  );
  if (!currency) throw invalid("Choose a supported currency.");
  const values = {
    name: text(b.name, 300, "product name", true),
    sku: text(b.sku||"",100,"SKU"),
    description: text(b.description || "", 10000, "description"),
    unit_price: price,
    unit_label: text(b.unit_label || "unit", 100, "unit"),
    service_interval_months: months(
      b.service_interval_months,
      "review interval",
    ),
    warranty_months: months(b.warranty_months, "warranty"),
    category: text(b.category || "", 200, "category"),
    currency,
    image_url: text(b.image_url || "", 2000, "image URL"),
    notes: text(b.notes || "", 20000, "notes"),
    custom_fields: JSON.stringify(
      await F.validate(
        db,
        user.workspace_id,
        "product",
        input.custom_fields,
        old?.custom_fields,
      ),
    ),
  };
  const keys = Object.keys(values),
    params = Object.values(values);
  params.push(user.workspace_id);
  try {
  if (id) {
    params.push(id);
    return (
      await db.query(
        `UPDATE products SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")} WHERE workspace_id=$${params.length - 1} AND id=$${params.length} RETURNING *`,
        params,
      )
    ).rows[0];
  }
  return (
    await db.query(
      `INSERT INTO products(${keys.join(",")},workspace_id) VALUES(${params.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
      params,
    )
  ).rows[0];
  }catch(e){if(e.code==="23505")throw invalid("A product with this SKU already exists.",409);throw e;}
}
router.post("/", requireEditor, async (req, res) =>
  res.status(201).json({ product: await save(req.user, null, req.body) }),
);
router.put("/:id", requireEditor, async (req, res) =>
  res.json({ product: await save(req.user, req.params.id, req.body) }),
);
router.post("/:id/duplicate", requireEditor, async (req, res) => {
  const old = (
    await db.query("SELECT * FROM products WHERE id=$1 AND workspace_id=$2", [
      optionalId(req.params.id),
      req.user.workspace_id,
    ])
  ).rows[0];
  if (!old) throw invalid("Product not found.", 404);
  res
    .status(201)
    .json({
      product: await save(req.user, null, {
        ...old,
        sku: "",
        name: old.name.slice(0, 290) + " (copy)",
      }),
    });
});
router.delete("/:id", requireEditor, async (req, res) => {
  const result = await db.query(
    "DELETE FROM products WHERE id=$1 AND workspace_id=$2 RETURNING id",
    [optionalId(req.params.id), req.user.workspace_id],
  );
  if (!result.rows.length) throw invalid("Product not found.", 404);
  res.json({ ok: true });
});
module.exports = router;
