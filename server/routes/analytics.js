const db = require("../db"),
  { requireAuth } = require("../middleware/auth"),
  { requirePaidAccess } = require("../middleware/billing"),
  { invalid, optionalId } = require("../services/dealWorkspace"),
  { normalizeCurrency } = require("../services/workspaceCurrency"),
  { canLinkUser } = require("../services/spaces");
const router = require("../middleware/safeRouter")();
router.use(requireAuth, requirePaidAccess);
const manage = (user) => user.is_personal || user.is_team_owner;
async function filters(req) {
  const wid = req.user.workspace_id,
    userId = optionalId(req.query.user_id || req.body?.user_id);
  if (userId && !(await canLinkUser(db, userId, wid)))
    throw invalid("Choose a person in this workspace.");
  let zone = String(req.headers["x-klyo-timezone"] || "UTC");
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
  } catch {
    zone = "UTC";
  }
  const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
    }).format(new Date()),
    month = req.query.month || req.body?.month || local.slice(0, 7);
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    Number(month.slice(0, 4)) < 2000 ||
    Number(month.slice(0, 4)) > 2100
  )
    throw invalid("Choose a valid reporting month (2000–2100).");
  const start = month + "-01",
    end = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1),
    )
      .toISOString()
      .slice(0, 10),
    currency = normalizeCurrency(
      req.query.currency ||
        req.body?.currency ||
        (
          await db.query(
            "SELECT default_currency FROM workspaces WHERE id=$1",
            [wid],
          )
        ).rows[0]?.default_currency ||
        "USD",
    );
  if (!currency) throw invalid("Choose a supported currency.");
  const pipelineId = optionalId(req.query.pipeline_id || req.body?.pipeline_id);
  if (
    pipelineId &&
    !(
      await db.query(
        "SELECT id FROM sales_pipelines WHERE workspace_id=$1 AND id=$2",
        [wid, pipelineId],
      )
    ).rows.length
  )
    throw invalid("Choose a pipeline in this workspace.");
  return {
    wid,
    userId,
    month,
    start,
    end,
    currency,
    zone,
    pipelineId,
    manage: manage(req.user),
    personal: req.user.is_personal,
    currentUser: req.user.id,
  };
}
router.get("/", async (req, res) => {
  const f = await filters(req),
    p = [f.wid, f.currency, f.start, f.end, f.userId, f.zone, f.pipelineId],
    own =
      " AND ($5::int IS NULL OR assigned_to=$5) AND ($7::int IS NULL OR pipeline_id=$7)",
    date =
      "(closed_at AT TIME ZONE $6)>= $3::date AND (closed_at AT TIME ZONE $6)<$4::date";
  const [metrics, stages, months, target, owners] = await Promise.all([
    db.query(
      `SELECT COUNT(*) FILTER(WHERE status='open')::int open_count,COALESCE(SUM(value) FILTER(WHERE status='open'),0) open_value,COALESCE(SUM(ROUND(COALESCE(value,0)*probability/100,2)) FILTER(WHERE status='open' AND expected_close_date>=$3::date AND expected_close_date<$4::date),0) weighted_forecast,COUNT(*) FILTER(WHERE status='open' AND expected_close_date IS NULL)::int missing_close_date,COUNT(*) FILTER(WHERE status='open' AND probability=0)::int zero_probability,COALESCE(SUM(value) FILTER(WHERE status='won' AND ${date}),0) won_value,COALESCE(SUM(value) FILTER(WHERE status='lost' AND ${date}),0) lost_value,COUNT(*) FILTER(WHERE status='won' AND ${date})::int won_count,COUNT(*) FILTER(WHERE status='lost' AND ${date})::int lost_count,COALESCE(AVG(value) FILTER(WHERE status='won' AND ${date}),0) average_won_value,AVG(EXTRACT(EPOCH FROM (closed_at-created_at))/86400) FILTER(WHERE status='won' AND ${date}) average_days_to_win FROM deals WHERE workspace_id=$1 AND deleted_at IS NULL AND currency=$2${own}`,
      p,
    ),
    db.query(
      `SELECT ps.id,ps.name,ps.color,sp.name pipeline_name,COUNT(d.id)::int count,COALESCE(SUM(d.value),0) value,COALESCE(SUM(ROUND(COALESCE(d.value,0)*d.probability/100,2)),0) weighted_value FROM pipeline_stages ps JOIN sales_pipelines sp ON sp.id=ps.pipeline_id AND sp.workspace_id=ps.workspace_id LEFT JOIN deals d ON d.stage_id=ps.id AND d.workspace_id=ps.workspace_id AND d.currency=$2 AND d.deleted_at IS NULL AND d.status='open' AND ($5::int IS NULL OR d.assigned_to=$5) AND d.expected_close_date>=$3::date AND d.expected_close_date<$4::date WHERE ps.workspace_id=$1 AND $6::text IS NOT NULL AND ($7::int IS NULL OR ps.pipeline_id=$7) GROUP BY ps.id,sp.name ORDER BY sp.name,ps.sort_order,ps.id`,
      p,
    ),
    db.query(
      `WITH months AS (SELECT generate_series($3::date-interval '5 months',$3::date,interval '1 month')::date AS starts) SELECT to_char(m.starts,'YYYY-MM') AS month,COALESCE(SUM(d.value) FILTER(WHERE d.status='won'),0) won_value,COUNT(d.id) FILTER(WHERE d.status='won')::int won_count,COUNT(d.id) FILTER(WHERE d.status='lost')::int lost_count FROM months m LEFT JOIN deals d ON d.workspace_id=$1 AND d.deleted_at IS NULL AND d.currency=$2 AND ($5::int IS NULL OR d.assigned_to=$5) AND ($7::int IS NULL OR d.pipeline_id=$7) AND (d.closed_at AT TIME ZONE $6)>=m.starts AND (d.closed_at AT TIME ZONE $6)<m.starts+interval '1 month' AND (d.closed_at AT TIME ZONE $6)<$4::date GROUP BY m.starts ORDER BY m.starts`,
      p,
    ),
    db.query(
      "SELECT id,amount FROM sales_targets WHERE workspace_id=$1 AND currency=$2 AND month=$3::date AND user_id IS NOT DISTINCT FROM $4::int",
      [f.wid, f.currency, f.start, f.userId],
    ),
    req.user.is_personal
      ? db.query("SELECT id,name FROM users WHERE id=$1", [req.user.id])
      : db.query(
          "SELECT id,name FROM users WHERE workspace_id=$1 ORDER BY name,id",
          [f.wid],
        ),
  ]);
  const unstaged = await db.query(
    `SELECT NULL::int AS id,'No stage' AS name,'#64748b' AS color,sp.name AS pipeline_name,COUNT(d.id)::int AS count,COALESCE(SUM(d.value),0) AS value,COALESCE(SUM(ROUND(COALESCE(d.value,0)*d.probability/100,2)),0) AS weighted_value FROM deals d JOIN sales_pipelines sp ON sp.id=d.pipeline_id AND sp.workspace_id=d.workspace_id WHERE d.workspace_id=$1 AND d.currency=$2 AND d.deleted_at IS NULL AND d.status='open' AND d.stage_id IS NULL AND $6::text IS NOT NULL AND ($7::int IS NULL OR d.pipeline_id=$7) AND ($5::int IS NULL OR d.assigned_to=$5) AND d.expected_close_date>=$3::date AND d.expected_close_date<$4::date GROUP BY sp.id,sp.name ORDER BY sp.name`,
    p,
  );
  stages.rows.push(...unstaged.rows);
  let activity = [];
  if (manage(req.user)) {
    activity = (
      await db.query(
        `SELECT u.id,u.name,COUNT(a.id) FILTER(WHERE a.type='meeting_logged')::int meetings,COUNT(a.id) FILTER(WHERE a.type='call_logged')::int calls,COUNT(a.id) FILTER(WHERE a.type IN ('offer_sent','quote_sent'))::int offers_sent FROM users u LEFT JOIN activity_log a ON a.user_id=u.id AND a.workspace_id=$1 AND (a.created_at AT TIME ZONE $6)>=$3::date AND (a.created_at AT TIME ZONE $6)<$4::date WHERE ${req.user.is_personal ? "u.id=$7" : "u.workspace_id=$1"} AND ($5::int IS NULL OR u.id=$5) AND $2::text IS NOT NULL GROUP BY u.id,u.name ORDER BY meetings DESC,u.name`,
        req.user.is_personal ? [...p.slice(0, 6), req.user.id] : p.slice(0, 6),
      )
    ).rows;
  }
  const m = metrics.rows[0],
    closed = m.won_count + m.lost_count,
    goal = target.rows[0] ? Number(target.rows[0].amount) : null,
    won = Number(m.won_value),
    forecast = Number(m.weighted_forecast);
  res.json({
    extended: await require("../services/salesDashboard").report(f),
    pipelines: (
      await db.query(
        "SELECT id,name FROM sales_pipelines WHERE workspace_id=$1 ORDER BY name",
        [f.wid],
      )
    ).rows,
    filters: {
      pipeline_id: f.pipelineId,
      month: f.month,
      currency: f.currency,
      user_id: f.userId,
      timezone: f.zone,
    },
    metrics: {
      ...m,
      win_rate: closed
        ? Math.round((m.won_count / closed) * 10000) / 100
        : null,
      goal,
      goal_attainment: goal > 0 ? Math.round((won / goal) * 10000) / 100 : null,
      weighted_outlook: Math.round((won + forecast) * 100) / 100,
      gap_to_goal:
        goal === null
          ? null
          : Math.max(0, Math.round((goal - won) * 100) / 100),
    },
    stages: stages.rows,
    months: months.rows,
    activity,
    owners: owners.rows,
    can_manage: !!manage(req.user),
  });
});
router.put("/benchmarks", async (req, res) => {
  if (!manage(req.user))
    throw invalid("Only the owner can set benchmarks.", 403);
  const f = await filters(req),
    b = req.body;
  const amount = (v, max) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (
      !Number.isFinite(n) ||
      n < 0 ||
      n > max ||
      Math.abs(n * 100 - Math.round(n * 100)) > 0.001
    )
      throw invalid("Invalid benchmark.");
    return n;
  };
  const pipeline = amount(b.pipeline_goal, 999999999999),
    meetings = amount(b.meeting_goal, 1000000),
    rate = amount(b.win_rate_goal, 100),
    days = Number(b.stale_days ?? 14);
  if (
    (meetings != null && !Number.isInteger(meetings)) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 365
  )
    throw invalid(
      "Choose whole meeting counts and a stale threshold from 1 to 365 days.",
    );
  await db.query(
    "INSERT INTO analytics_benchmarks(workspace_id,user_id,month,currency,pipeline_goal,meeting_goal,win_rate_goal,stale_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,COALESCE(user_id,0),month,currency) DO UPDATE SET pipeline_goal=EXCLUDED.pipeline_goal,meeting_goal=EXCLUDED.meeting_goal,win_rate_goal=EXCLUDED.win_rate_goal,stale_days=EXCLUDED.stale_days,updated_at=now()",
    [f.wid, f.userId, f.start, f.currency, pipeline, meetings, rate, days],
  );
  res.json({ ok: true });
});
router.put("/target", async (req, res) => {
  if (!manage(req.user))
    throw invalid("Only the team owner can manage sales targets.", 403);
  const f = await filters(req),
    amount = Number(req.body.amount);
  if (
    req.body.amount == null ||
    req.body.amount === "" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > 999999999999 ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > 0.0001
  )
    throw invalid("Enter a non-negative target with up to two decimal places.");
  const result = await db.query(
    "INSERT INTO sales_targets(workspace_id,user_id,month,currency,amount,updated_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,COALESCE(user_id,0),month,currency) DO UPDATE SET amount=EXCLUDED.amount,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *",
    [f.wid, f.userId, f.start, f.currency, amount, req.user.id],
  );
  res.json({ target: result.rows[0] });
});
router.delete("/target", async (req, res) => {
  if (!manage(req.user))
    throw invalid("Only the team owner can manage sales targets.", 403);
  const f = await filters(req);
  await db.query(
    "DELETE FROM sales_targets WHERE workspace_id=$1 AND user_id IS NOT DISTINCT FROM $2::int AND month=$3 AND currency=$4",
    [f.wid, f.userId, f.start, f.currency],
  );
  res.json({ ok: true });
});
module.exports = router;
