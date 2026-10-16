const db = require("../db");
async function report(f) {
  const args = [
    f.wid,
    f.currency,
    f.start,
    f.end,
    f.userId,
    f.zone,
    f.pipelineId || null,
  ];
  const scope = `WITH scoped AS (SELECT * FROM deals WHERE workspace_id=$1 AND currency=$2 AND deleted_at IS NULL AND ($5::int IS NULL OR assigned_to=$5) AND ($7::int IS NULL OR pipeline_id=$7) AND $6::text IS NOT NULL), bounds AS (SELECT $3::date AS starts,$4::date AS ends,LEAST(GREATEST((now() AT TIME ZONE $6)::date,$3::date),$4::date-1) AS as_of)`;
  const q = (sql) => db.query(scope + " " + sql, args);
  const benchmark = (
    await db.query(
      "SELECT pipeline_goal,meeting_goal,win_rate_goal,stale_days FROM analytics_benchmarks WHERE workspace_id=$1 AND user_id IS NOT DISTINCT FROM $2::int AND month=$3 AND currency=$4",
      [f.wid, f.userId, f.start, f.currency],
    )
  ).rows[0] || {
    pipeline_goal: null,
    meeting_goal: null,
    win_rate_goal: null,
    stale_days: 14,
  };
  const [summary, daily, forecast, sources, risks, closing, leaderboard] =
    await Promise.all([
      q(
        `SELECT COUNT(*) FILTER(WHERE (created_at AT TIME ZONE $6)>=b.starts AND (created_at AT TIME ZONE $6)<b.ends)::int AS new_count,COALESCE(SUM(value) FILTER(WHERE (created_at AT TIME ZONE $6)>=b.starts AND (created_at AT TIME ZONE $6)<b.ends),0) AS new_value,COALESCE(SUM(value) FILTER(WHERE status='won' AND (closed_at AT TIME ZONE $6)>=b.starts-interval '1 month' AND (closed_at AT TIME ZONE $6)<b.starts),0) AS previous_won,COALESCE(SUM(value) FILTER(WHERE status='open' AND expected_close_date>=b.starts AND expected_close_date<b.ends),0) AS period_pipeline FROM scoped CROSS JOIN bounds b`,
      ),
      q(
        `, days AS (SELECT generate_series($3::date,$4::date-1,interval '1 day')::date AS day), created AS (SELECT (created_at AT TIME ZONE $6)::date AS day,count(*)::int AS count FROM scoped GROUP BY 1), closed AS (SELECT (closed_at AT TIME ZONE $6)::date AS day,count(*)::int AS count FROM scoped WHERE status IN('won','lost') GROUP BY 1) SELECT to_char(d.day,'YYYY-MM-DD') AS day,COALESCE(c.count,0)::int created,COALESCE(x.count,0)::int closed FROM days d LEFT JOIN created c ON c.day=d.day LEFT JOIN closed x ON x.day=d.day ORDER BY d.day`,
      ),
      q(
        `, months AS (SELECT generate_series($3::date,$3::date+interval '5 months',interval '1 month')::date AS month) SELECT to_char(m.month,'YYYY-MM') AS month,COALESCE((SELECT SUM(value) FROM scoped WHERE status='won' AND (closed_at AT TIME ZONE $6)>=m.month AND (closed_at AT TIME ZONE $6)<m.month+interval '1 month'),0) AS won,COALESCE((SELECT SUM(ROUND(COALESCE(value,0)*probability/100,2)) FROM scoped WHERE status='open' AND expected_close_date>=m.month AND expected_close_date<m.month+interval '1 month'),0) AS forecast,(SELECT amount FROM sales_targets WHERE workspace_id=$1 AND currency=$2 AND user_id IS NOT DISTINCT FROM $5::int AND month=m.month) AS target FROM months m ORDER BY m.month`,
      ),
      q(
        `SELECT COALESCE(NULLIF(source,''),'Unspecified') AS source,count(*)::int AS count,COALESCE(SUM(value),0) AS value FROM scoped CROSS JOIN bounds b WHERE (created_at AT TIME ZONE $6)>=b.starts AND (created_at AT TIME ZONE $6)<b.ends GROUP BY source ORDER BY value DESC,source LIMIT 20`,
      ),
      q(
        `SELECT d.id,d.title,d.value,d.probability,d.expected_close_date,COALESCE(u.name,'—') AS owner,(b.as_of-(d.stage_entered_at AT TIME ZONE $6)::date)::int AS stage_days,(d.expected_close_date<b.as_of) AS overdue,EXISTS(SELECT 1 FROM tasks t WHERE t.workspace_id=$1 AND t.deal_id=d.id AND t.status<>'done' AND t.due_date<b.as_of) AS overdue_task FROM scoped d CROSS JOIN bounds b LEFT JOIN users u ON u.id=d.assigned_to WHERE d.status='open' AND (d.expected_close_date<b.as_of OR d.expected_close_date IS NULL OR d.value IS NULL OR d.probability=0 OR (d.stage_entered_at AT TIME ZONE $6)::date<=b.as_of-${Number(benchmark.stale_days) || 14} OR EXISTS(SELECT 1 FROM tasks t WHERE t.workspace_id=$1 AND t.deal_id=d.id AND t.status<>'done' AND t.due_date<b.as_of)) ORDER BY d.expected_close_date NULLS FIRST,d.id LIMIT 30`,
      ),
      q(
        `SELECT d.id,d.title,d.value,d.probability,d.expected_close_date FROM scoped d CROSS JOIN bounds b WHERE d.status='open' AND d.expected_close_date>=b.as_of AND d.expected_close_date<b.as_of+31 ORDER BY d.expected_close_date,d.id LIMIT 10`,
      ),
      f.manage
        ? q(
            `SELECT u.id,u.name,COALESCE(SUM(d.value) FILTER(WHERE d.status='won' AND (d.closed_at AT TIME ZONE $6)>=b.starts AND (d.closed_at AT TIME ZONE $6)<b.ends),0) AS won_value,COUNT(d.id) FILTER(WHERE d.status='won' AND (d.closed_at AT TIME ZONE $6)>=b.starts AND (d.closed_at AT TIME ZONE $6)<b.ends)::int AS won_count FROM users u CROSS JOIN bounds b LEFT JOIN scoped d ON d.assigned_to=u.id WHERE ${f.personal ? "u.id=" + Number(f.currentUser) : "u.workspace_id=$1"} AND ($5::int IS NULL OR u.id=$5) GROUP BY u.id ORDER BY won_value DESC,u.name`,
          )
        : Promise.resolve({ rows: [] }),
    ]);
  const normalize = (rows) =>
    rows.map((r) => ({
      ...r,
      expected_close_date: r.expected_close_date
        ? require("./dealWorkspace").validDate(r.expected_close_date)
        : null,
    }));
  return {
    benchmark,
    summary: summary.rows[0],
    daily: daily.rows,
    forecast: forecast.rows,
    sources: sources.rows,
    risks: normalize(risks.rows),
    closing: normalize(closing.rows),
    leaderboard: leaderboard.rows,
  };
}
module.exports = { report };
