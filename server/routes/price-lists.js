const db = require("../db"),
  S = require("../services/priceLists"),
  { optionalId, invalid } = require("../services/dealWorkspace"),
  { requireAuth, requireEditor } = require("../middleware/auth"),
  { requirePaidAccess } = require("../middleware/billing");
const router = require("../middleware/safeRouter")();
router.use(requireAuth, requirePaidAccess);
router.get("/", async (req, res) =>
  res.json({
    price_lists: (
      await db.query(
        "SELECT l.*,(SELECT COUNT(*)::int FROM price_list_items i WHERE i.price_list_id=l.id) AS item_count FROM price_lists l WHERE workspace_id=$1 ORDER BY updated_at DESC,id DESC",
        [req.user.workspace_id],
      )
    ).rows,
  }),
);
router.post("/preview", requireEditor, async (req, res) =>
  res.json(await S.preview(db, req.user.workspace_id, req.body)),
);
router.post("/import", requireEditor, async (req, res) =>
  res.status(201).json(await S.importRows(db.pool, req.user, req.body)),
);
router.get("/:id", async (req, res) => {
  const list = (
    await db.query(
      "SELECT * FROM price_lists WHERE id=$1 AND workspace_id=$2",
      [optionalId(req.params.id), req.user.workspace_id],
    )
  ).rows[0];
  if (!list) throw invalid("Price list not found.", 404);
  res.json({
    price_list: list,
    products: (
      await db.query(
        "SELECT p.*,i.unit_price FROM price_list_items i JOIN products p ON p.id=i.product_id AND p.workspace_id=$2 WHERE i.price_list_id=$1 ORDER BY p.name",
        [list.id, req.user.workspace_id],
      )
    ).rows,
  });
});
router.delete("/:id", requireEditor, async (req, res) => {
  if (
    !(
      await db.query(
        "DELETE FROM price_lists WHERE id=$1 AND workspace_id=$2 RETURNING id",
        [optionalId(req.params.id), req.user.workspace_id],
      )
    ).rows.length
  )
    throw invalid("Price list not found.", 404);
  res.json({ ok: true });
});
module.exports = router;
