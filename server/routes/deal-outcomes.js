const db = require("../db"),
  D = require("../services/dealWorkspace"),
  { normalizeCurrency } = require("../services/workspaceCurrency"),
  { requireAuth } = require("../middleware/auth");
const router = require("../middleware/safeRouter")();
router.use(requireAuth, require("../middleware/billing").requirePaidAccess);
router.get("/", async (req, res) => {
  const w = req.user.workspace_id,
    month = String(req.query.month || "all"),
    allDates = month === "all",
    anchor = allDates ? new Date().toISOString().slice(0, 7) : month,
    currency = normalizeCurrency(
      req.query.currency ||
        (
          await db.query(
            "SELECT default_currency FROM workspaces WHERE id=$1",
            [w],
          )
        ).rows[0].default_currency,
    ),
    pid = D.optionalId(req.query.pipeline_id),
    uid = D.optionalId(req.query.user_id);
  if ((!allDates && !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) || !currency)
    throw D.invalid("Choose a reporting month and currency.");
  if (
    pid &&
    !(
      await db.query(
        "SELECT id FROM sales_pipelines WHERE id=$1 AND workspace_id=$2",
        [pid, w],
      )
    ).rows.length
  )
    throw D.invalid("Pipeline not found.", 404);
  if (uid && !(await require("../services/spaces").canLinkUser(db, uid, w)))
    throw D.invalid("Choose a person in this workspace.");
  const start = anchor + "-01",
    end = new Date(
      Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), 1),
    )
      .toISOString()
      .slice(0, 10),
    status = req.query.status === "lost" ? "lost" : "won",
    page = Number(req.query.page || 0);
  if (!Number.isInteger(page) || page < 0 || page > 10000)
    throw D.invalid("Invalid page.");
  const scope = `WITH scoped AS(SELECT * FROM deals WHERE workspace_id=$1 AND currency=$2 AND deleted_at IS NULL AND ($5::int IS NULL OR pipeline_id=$5) AND ($6::int IS NULL OR assigned_to=$6) AND $7::text IS NOT NULL AND $3::date IS NOT NULL AND $4::date IS NOT NULL),period AS(SELECT * FROM scoped WHERE status IN('won','lost') AND ${allDates ? "true" : "(closed_at AT TIME ZONE $7)>=$3::date AND (closed_at AT TIME ZONE $7)<$4::date"}) `;
  const args = [w, currency, start, end, pid, uid, req.user.time_zone || "UTC"],
    q = (sql) => db.query(scope + sql, args);
  const [summary, trend, reasons, bands, aging, sources, list] =
    await Promise.all([
      q(
        "SELECT count(*) FILTER(WHERE status='won')::int AS won_count,count(*) FILTER(WHERE status='lost')::int AS lost_count,COALESCE(sum(value) FILTER(WHERE status='won'),0) AS won_value,COALESCE(sum(value) FILTER(WHERE status='lost'),0) AS lost_value,round(avg(GREATEST(0,extract(epoch from(closed_at-created_at))/86400)) FILTER(WHERE status='won' AND closed_at IS NOT NULL)::numeric,1) AS days_to_win FROM period",
      ),
      q(
        ", months AS(SELECT generate_series($3::date-interval '5 months',$3::date,interval '1 month')::date AS month) SELECT to_char(m.month,'YYYY-MM') AS label,count(d.id) FILTER(WHERE d.status='won')::int AS won,count(d.id) FILTER(WHERE d.status='lost')::int AS lost,COALESCE(sum(d.value) FILTER(WHERE d.status='won'),0) AS won_value,COALESCE(sum(d.value) FILTER(WHERE d.status='lost'),0) AS lost_value FROM months m LEFT JOIN scoped d ON (d.closed_at AT TIME ZONE $7)>=m.month AND (d.closed_at AT TIME ZONE $7)<m.month+interval '1 month' AND d.status IN('won','lost') GROUP BY m.month ORDER BY m.month",
      ),
      q(
        "SELECT COALESCE(NULLIF(lost_reason,''),'Unspecified') AS label,count(*)::int AS count,COALESCE(sum(value),0) AS value FROM period WHERE status='lost' GROUP BY 1 ORDER BY count DESC,label LIMIT 12",
      ),
      q(
        "SELECT CASE WHEN value<1000 THEN '< 1,000' WHEN value<5000 THEN '1,000–4,999' WHEN value<20000 THEN '5,000–19,999' ELSE '20,000+' END AS label,count(*) FILTER(WHERE status='won')::int AS won,count(*) FILTER(WHERE status='lost')::int AS lost FROM period WHERE value IS NOT NULL GROUP BY 1 ORDER BY min(value)",
      ),
      q(
        "SELECT CASE WHEN now()-created_at<interval '7 days' THEN '0–6 days' WHEN now()-created_at<interval '30 days' THEN '7–29 days' WHEN now()-created_at<interval '90 days' THEN '30–89 days' ELSE '90+ days' END AS label,count(*)::int AS count,COALESCE(sum(value),0) AS value FROM scoped WHERE status='open' GROUP BY 1 ORDER BY min(created_at) DESC",
      ),
      q(
        "SELECT COALESCE(NULLIF(source,''),'Unspecified') AS label,count(*) FILTER(WHERE status='won')::int AS won,count(*) FILTER(WHERE status='lost')::int AS lost FROM period GROUP BY 1 ORDER BY count(*) DESC LIMIT 12",
      ),
      db.query(
        scope +
          "SELECT d.id,d.title,d.value,d.currency,d.status,d.lost_reason,to_char(d.closed_at AT TIME ZONE $7,'YYYY-MM-DD') AS closed_on,c.name AS company_name,u.name AS owner,count(*) OVER()::int AS total_count FROM period d LEFT JOIN companies c ON c.id=d.company_id AND c.workspace_id=$1 LEFT JOIN users u ON u.id=d.assigned_to WHERE d.status=$8 ORDER BY d.closed_at DESC NULLS LAST,d.id DESC LIMIT 50 OFFSET $9",
        [...args, status, page * 50],
      ),
    ]);
  res.json({
    filters: { month, currency, pipeline_id: pid, user_id: uid, status, page },
    summary: summary.rows[0],
    trend: trend.rows,
    reasons: reasons.rows,
    bands: bands.rows,
    aging: aging.rows,
    sources: sources.rows,
    deals: list.rows,
    total: list.rows[0]?.total_count || 0,
  });
});
module.exports = router;
