const db = require("../db"),
  E = require("../services/calendarEvents"),
  { requireAuth, requireEditor } = require("../middleware/auth");
const router = require("../middleware/safeRouter")();
router.use(requireAuth, require("../middleware/billing").requirePaidAccess);
async function list(req) {
  const params = [req.user.workspace_id];
  let where = "";
  if (req.query.start && req.query.end) {
    const r = E.range(req.query);
    params.push(r.start, r.end);
    where =
      " AND COALESCE(e.end_at,e.start_at+interval '1 hour')>$2 AND e.start_at<$3";
  }
  return (
    await db.query(
      `SELECT e.*,u.name AS creator_name,c.full_name AS contact_name,co.name AS company_name,d.title AS deal_title,t.title AS task_title FROM calendar_events e LEFT JOIN users u ON u.id=e.created_by LEFT JOIN contacts c ON c.id=e.contact_id AND c.workspace_id=e.workspace_id LEFT JOIN companies co ON co.id=e.company_id AND co.workspace_id=e.workspace_id LEFT JOIN deals d ON d.id=e.deal_id AND d.workspace_id=e.workspace_id LEFT JOIN tasks t ON t.id=e.task_id AND t.workspace_id=e.workspace_id WHERE e.workspace_id=$1${where} ORDER BY e.start_at,e.id LIMIT 5000`,
      params,
    )
  ).rows;
}
router.get("/", async (req, res) => res.json({ events: await list(req) }));
router.get("/export.ics", async (req, res) =>
  res
    .set({
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="Klyo-calendar.ics"',
      "Cache-Control": "private, no-store",
    })
    .send(E.ics(await list(req))),
);
router.post("/", requireEditor, async (req, res) =>
  res
    .status(201)
    .json({
      event: await E.transaction((c) =>
        E.save(req.user, null, req.body || {}, c),
      ),
    }),
);
router.put("/:id", requireEditor, async (req, res) =>
  res.json({
    event: await E.transaction((c) =>
      E.save(req.user, req.params.id, req.body || {}, c),
    ),
  }),
);
router.delete("/:id", requireEditor, async (req, res) => {
  const result = await db.query(
    "DELETE FROM calendar_events WHERE id=$1 AND workspace_id=$2 RETURNING id",
    [
      require("../services/dealWorkspace").optionalId(req.params.id),
      req.user.workspace_id,
    ],
  );
  if (!result.rows.length)
    throw require("../services/dealWorkspace").invalid("Event not found.", 404);
  res.json({ ok: true });
});
module.exports = router;
