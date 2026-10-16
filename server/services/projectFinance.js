const db = require("../db"),
  D = require("./dealWorkspace");
const owner = (u) => !!(u.is_personal || u.is_team_owner);
function requireOwner(u) {
  if (!owner(u))
    throw D.invalid(
      "Only the workspace owner can view project costs and settlement.",
      403,
    );
}
function cost(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n > 999999999 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 0.001
  )
    throw D.invalid("Enter a non-negative cost with two decimal places.");
  return n;
}
async function summary(user, id) {
  requireOwner(user);
  const project = (
    await db.query("SELECT * FROM projects WHERE workspace_id=$1 AND id=$2", [
      user.workspace_id,
      D.optionalId(id),
    ])
  ).rows[0];
  if (!project) throw D.invalid("Project not found.", 404);
  const [orders, work, expenses] = await Promise.all([
    db.query(
      "SELECT * FROM sales_orders WHERE project_id=$1 AND workspace_id=$2 AND status NOT IN('draft','cancelled')",
      [project.id, user.workspace_id],
    ),
    db.query(
      "SELECT hours,hourly_cost FROM project_time_entries WHERE project_id=$1 AND workspace_id=$2",
      [project.id, user.workspace_id],
    ),
    db.query(
      "SELECT * FROM project_expenses WHERE project_id=$1 AND workspace_id=$2 ORDER BY spent_on DESC,id DESC",
      [project.id, user.workspace_id],
    ),
  ]);
  const groups = new Map();
  const group = (c) => {
    if (!groups.has(c))
      groups.set(c, {
        currency: c,
        revenue: 0,
        received: 0,
        purchases: 0,
        paid_suppliers: 0,
        labor: 0,
        expenses: 0,
        unpriced_hours: 0,
      });
    return groups.get(c);
  };
  const local = group(project.currency);
  for (const o of orders.rows) {
    const g = group(o.currency);
    if (o.kind === "customer") {
      g.revenue += Number(o.total);
      g.received += Number(o.paid_amount);
    }
    if (o.kind === "supplier") {
      g.purchases += Number(o.total);
      g.paid_suppliers += Number(o.paid_amount);
    }
  }
  for (const t of work.rows) {
    if (t.hourly_cost == null) local.unpriced_hours += Number(t.hours);
    else local.labor += Number(t.hours) * Number(t.hourly_cost);
  }
  for (const e of expenses.rows) group(e.currency).expenses += Number(e.amount);
  const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  return {
    project_id: project.id,
    budget: Number(project.budget),
    budget_currency: project.currency,
    expenses: expenses.rows,
    groups: [...groups.values()].map((g) => ({
      ...Object.fromEntries(
        Object.entries(g).map(([k, v]) => [
          k,
          typeof v === "number" ? round(v) : v,
        ]),
      ),
      outstanding: round(Math.max(0, g.revenue - g.received)),
      suppliers_due: round(Math.max(0, g.purchases - g.paid_suppliers)),
      total_cost: g.unpriced_hours
        ? null
        : round(g.purchases + g.labor + g.expenses),
      profit: g.unpriced_hours
        ? null
        : round(g.revenue - g.purchases - g.labor - g.expenses),
      margin_percent:
        g.unpriced_hours || !g.revenue
          ? null
          : round(
              ((g.revenue - g.purchases - g.labor - g.expenses) / g.revenue) *
                100,
            ),
      cash_balance: round(g.received - g.paid_suppliers - g.expenses),
    })),
  };
}
module.exports = { owner, requireOwner, cost, summary };
