const db = require("../db"),
  W = require("../services/warranty"),
  {
    invalid,
    optionalId,
    text,
    validDate,
  } = require("../services/dealWorkspace"),
  { requireAuth, requireEditor } = require("../middleware/auth"),
  { requirePaidAccess } = require("../middleware/billing");
const router = require("../middleware/safeRouter")();
router.use(requireAuth, requirePaidAccess);
const select = `SELECT (now() AT TIME ZONE $2)::date::text AS current_local_day,w.*,w.purchased_on::text,w.warranty_until::text,w.next_review_on::text,c.full_name AS contact_name,c.email AS contact_email,c.phone AS contact_phone FROM warranty_items w JOIN contacts c ON c.id=w.contact_id AND c.workspace_id=w.workspace_id`;
router.get("/", async (req, res) => {
  const params = [req.user.workspace_id, req.user.time_zone];
  let sql = select + " WHERE w.workspace_id=$1";
  if (req.query.due === "1")
    sql +=
      " AND w.status='active' AND w.next_review_on<=(now() AT TIME ZONE $2)::date";
  if (req.query.contact_id) {
    params.push(optionalId(req.query.contact_id));
    sql += ` AND w.contact_id=$${params.length}`;
  }
  res.json({
    items: (
      await db.query(
        sql + " ORDER BY w.next_review_on NULLS LAST,w.id DESC",
        params,
      )
    ).rows,
    today: W.today(req.user.time_zone),
  });
});
router.get("/notifications", async (req, res) => {
  const items = (
    await db.query(
      select +
        " WHERE w.workspace_id=$1 AND w.status='active' AND w.next_review_on<=(now() AT TIME ZONE $2)::date ORDER BY w.next_review_on,w.id",
      [req.user.workspace_id, req.user.time_zone],
    )
  ).rows;
  res.json({ items, count: items.length, today: W.today(req.user.time_zone) });
});
async function tx(fn) {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
router.post("/", requireEditor, async (req, res) =>
  res
    .status(201)
    .json({ item: await tx((c) => W.save(c, req.user, null, req.body)) }),
);
router.put("/:id", requireEditor, async (req, res) =>
  res.json({
    item: await tx((c) => W.save(c, req.user, req.params.id, req.body)),
  }),
);
router.get("/:id/reviews", async (req, res) => {
  if (
    !(
      await db.query(
        "SELECT id FROM warranty_items WHERE id=$1 AND workspace_id=$2",
        [optionalId(req.params.id), req.user.workspace_id],
      )
    ).rows.length
  )
    throw invalid("Warranty item not found.", 404);
  res.json({
    reviews: (
      await db.query(
        "SELECT r.*,r.performed_on::text,r.next_review_on::text,u.name AS user_name FROM warranty_reviews r LEFT JOIN users u ON u.id=r.user_id WHERE r.workspace_id=$1 AND r.warranty_id=$2 ORDER BY r.created_at DESC,r.id DESC",
        [req.user.workspace_id, req.params.id],
      )
    ).rows,
  });
});
router.post("/:id/review", requireEditor, async (req, res) => {
  const item = await tx(async (c) => {
    const old = (
      await c.query(
        "SELECT *,purchased_on::text,warranty_until::text,next_review_on::text FROM warranty_items WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [optionalId(req.params.id), req.user.workspace_id],
      )
    ).rows[0];
    if (!old) throw invalid("Warranty item not found.", 404);
    if (old.status !== "active")
      throw invalid("This warranty record is closed.");
    const performed = validDate(
      req.body.performed_on || W.today(req.user.time_zone),
    );
    if (performed > W.today(req.user.time_zone) || performed < old.purchased_on)
      throw invalid(
        "Choose a completed review date between the purchase and today.",
      );
    let next = Object.hasOwn(req.body, "next_review_on")
      ? validDate(req.body.next_review_on)
      : old.review_interval_months
        ? W.addMonths(performed, old.review_interval_months)
        : null;
    if (next && next > old.warranty_until) next = null;
    if (next && next <= performed)
      throw invalid("The next review must be after this review.");
    await c.query(
      "INSERT INTO warranty_reviews(workspace_id,warranty_id,user_id,performed_on,next_review_on,notes) VALUES($1,$2,$3,$4,$5,$6)",
      [
        req.user.workspace_id,
        old.id,
        req.user.id,
        performed,
        next,
        text(req.body.notes || "", 5000, "review notes"),
      ],
    );
    return (
      await c.query(
        "UPDATE warranty_items SET next_review_on=$1,updated_at=now() WHERE id=$2 AND workspace_id=$3 RETURNING *",
        [next, old.id, req.user.workspace_id],
      )
    ).rows[0];
  });
  res.json({ item });
});
router.delete("/:id", requireEditor, async (req, res) => {
  if (
    !(
      await db.query(
        "DELETE FROM warranty_items WHERE id=$1 AND workspace_id=$2 RETURNING id",
        [optionalId(req.params.id), req.user.workspace_id],
      )
    ).rows.length
  )
    throw invalid("Warranty item not found.", 404);
  res.json({ ok: true });
});
module.exports = router;
