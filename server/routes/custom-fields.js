const db = require("../db"),
  F = require("../services/customFields"),
  { requireAuth, requireEditor } = require("../middleware/auth"),
  { requirePaidAccess } = require("../middleware/billing");
const router = require("../middleware/safeRouter")();
router.use(requireAuth, requirePaidAccess);
router.get("/", async (req, res) =>
  res.json({
    fields: await F.definitions(
      db,
      req.user.workspace_id,
      req.query.entity,
      req.query.archived === "1",
    ),
  }),
);
router.post("/", requireEditor, async (req, res) =>
  res
    .status(201)
    .json({ field: await F.save(db, req.user.workspace_id, null, req.body) }),
);
router.put("/:id", requireEditor, async (req, res) =>
  res.json({
    field: await F.save(db, req.user.workspace_id, req.params.id, req.body),
  }),
);
router.delete("/:id", requireEditor, async (req, res) => {
  const result = await db.query(
    "UPDATE custom_field_definitions SET archived=true WHERE id=$1 AND workspace_id=$2 RETURNING id",
    [req.params.id, req.user.workspace_id],
  );
  res
    .status(result.rows.length ? 200 : 404)
    .json(result.rows.length ? { ok: true } : { error: "Field not found." });
});
module.exports = router;
