const express = require("express"),
  db = require("../db"),
  S = require("../services/operations"),
  { requireAuth, requireEditor } = require("../middleware/auth");
const router = express.Router();
router.use(requireAuth, require("../middleware/billing").requirePaidAccess);
const dateFields = new Set([
  "starts_on",
  "due_date",
  "last_calibration",
  "next_calibration",
  "confirmed_delivery_date",
  "invoice_issued_at",
  "invoice_due_date",
  "spent_on",
]);
function normalizeDates(value) {
  if (Array.isArray(value)) return value.map(normalizeDates);
  if (value && typeof value === "object" && !(value instanceof Date))
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        dateFields.has(key) && v ? S.date(v) : normalizeDates(v),
      ]),
    );
  return value;
}
router.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (value) => json(normalizeDates(value));
  next();
});
const run = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
};
router.get(
  "/lookup",
  run(async (req, res) => {
    const w = req.user.workspace_id,
      out = {};
    for (const [t, key, label] of [
      ["projects", "projects", "title"],
      ["deals", "deals", "title"],
      ["companies", "companies", "name"],
      ["contacts", "contacts", "full_name"],
      ["products", "products", "name"],
      ["quotes", "quotes", "title"],
      ["tasks", "tasks", "title"],
    ])
      out[key] = (
        await db.query(
          `SELECT id,${label} AS name${t === "deals" ? ",status" : ""} FROM ${t} WHERE workspace_id=$1${t === "deals" ? " AND deleted_at IS NULL" : ""} ORDER BY ${label} LIMIT 2000`,
          [w],
        )
      ).rows;
    out.users = (
      await db.query(
        `SELECT id,name FROM users WHERE workspace_id=$1${req.user.is_personal ? " OR id=$2" : ""} ORDER BY name`,
        req.user.is_personal ? [w, req.user.id] : [w],
      )
    ).rows;
    res.json(out);
  }),
);
router.get(
  "/projects",
  run(async (req, res) =>
    res.json({
      projects: (
        await db.query(
          `SELECT p.*,u.name AS assigned_name,c.name AS company_name,(SELECT count(*)::int FROM tasks t WHERE t.project_id=p.id AND t.workspace_id=p.workspace_id) AS task_count,(SELECT count(*)::int FROM tasks t WHERE t.project_id=p.id AND t.workspace_id=p.workspace_id AND t.status='done') AS done_count FROM projects p LEFT JOIN users u ON u.id=p.assigned_to LEFT JOIN companies c ON c.id=p.company_id WHERE p.workspace_id=$1 ORDER BY p.updated_at DESC`,
          [req.user.workspace_id],
        )
      ).rows,
    }),
  ),
);
router.post(
  "/projects",
  requireEditor,
  run(async (req, res) =>
    res
      .status(201)
      .json({ project: await S.project(req.user, null, req.body || {}) }),
  ),
);
router.put(
  "/projects/:id",
  requireEditor,
  run(async (req, res) =>
    res.json({
      project: await S.project(req.user, req.params.id, req.body || {}),
    }),
  ),
);
router.get(
  "/projects/:id",
  run(async (req, res) => {
    const w = req.user.workspace_id,
      p = await S.row(db, "projects", w, req.params.id);
    res.json({
      project: p,
      resources: (
        await db.query(
          "SELECT r.*,u.name AS user_name FROM project_resources r JOIN users u ON u.id=r.user_id WHERE r.project_id=$1 AND r.workspace_id=$2 ORDER BY u.name",
          [p.id, w],
        )
      ).rows,
      time_entries: (
        await db.query(
          "SELECT t.*,u.name AS user_name,ta.title AS task_title FROM project_time_entries t JOIN users u ON u.id=t.user_id LEFT JOIN tasks ta ON ta.id=t.task_id WHERE t.project_id=$1 AND t.workspace_id=$2 ORDER BY t.spent_on DESC,t.id DESC",
          [p.id, w],
        )
      ).rows,
      tasks: (
        await db.query(
          "SELECT t.*,u.name AS assigned_name FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.project_id=$1 AND t.workspace_id=$2 ORDER BY t.due_date NULLS LAST,t.id",
          [p.id, w],
        )
      ).rows,
      orders: (
        await db.query(
          "SELECT * FROM sales_orders WHERE project_id=$1 AND workspace_id=$2 ORDER BY id DESC",
          [p.id, w],
        )
      ).rows,
      equipment: (
        await db.query(
          "SELECT a.*,e.name,e.serial_number,u.name AS assigned_name FROM equipment_assignments a JOIN equipment e ON e.id=a.equipment_id LEFT JOIN users u ON u.id=a.assigned_to WHERE a.project_id=$1 AND a.workspace_id=$2 ORDER BY a.starts_at",
          [p.id, w],
        )
      ).rows,
      notes: (
        await db.query(
          "SELECT n.*,u.name AS author FROM project_notes n LEFT JOIN users u ON u.id=n.created_by WHERE n.project_id=$1 AND n.workspace_id=$2 ORDER BY n.id DESC",
          [p.id, w],
        )
      ).rows,
    });
  }),
);
router.post(
  "/projects/:id/resources",
  requireEditor,
  run(async (req, res) => {
    const p = await S.row(db, "projects", req.user.workspace_id, req.params.id),
      b = req.body || {},
      person = await S.link(db, req.user.workspace_id, "users", b.user_id),
      hours = Number(b.planned_hours ?? 0);
    if (!person || !Number.isFinite(hours) || hours < 0 || hours > 9999999)
      S.fail("Choose a person and valid planned hours.");
    const r = await db.query(
      "INSERT INTO project_resources(project_id,workspace_id,user_id,role,planned_hours,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,user_id) DO UPDATE SET role=EXCLUDED.role,planned_hours=EXCLUDED.planned_hours RETURNING *",
      [
        p.id,
        req.user.workspace_id,
        person,
        S.txt(b.role, 200),
        Math.round(hours * 100) / 100,
        req.user.id,
      ],
    );
    res.status(201).json({ resource: r.rows[0] });
  }),
);
router.delete(
  "/projects/:id/resources/:userId",
  requireEditor,
  run(async (req, res) => {
    await S.row(db, "projects", req.user.workspace_id, req.params.id);
    await db.query(
      "DELETE FROM project_resources WHERE project_id=$1 AND workspace_id=$2 AND user_id=$3",
      [S.id(req.params.id), req.user.workspace_id, S.id(req.params.userId)],
    );
    res.json({ ok: true });
  }),
);
router.post(
  "/projects/:id/time",
  requireEditor,
  run(async (req, res) => {
    const p = await S.row(db, "projects", req.user.workspace_id, req.params.id),
      b = req.body || {},
      person = await S.link(
        db,
        req.user.workspace_id,
        "users",
        b.user_id || req.user.id,
      ),
      task = await S.link(db, req.user.workspace_id, "tasks", b.task_id),
      hours = Number(b.hours),
      spent = S.date(b.spent_on);
    if (!spent || !Number.isFinite(hours) || hours <= 0 || hours > 24)
      S.fail("Enter a work date and between 0 and 24 hours.");
    if (
      task &&
      (await S.row(db, "tasks", req.user.workspace_id, task)).project_id !==
        p.id
    )
      S.fail("Choose a task from this project.");
    const r = await db.query(
      "INSERT INTO project_time_entries(workspace_id,project_id,task_id,user_id,spent_on,hours,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        req.user.workspace_id,
        p.id,
        task,
        person,
        spent,
        Math.round(hours * 100) / 100,
        S.txt(b.notes, 10000),
        req.user.id,
      ],
    );
    res.status(201).json({ entry: r.rows[0] });
  }),
);
router.delete(
  "/projects/:id/time/:entryId",
  requireEditor,
  run(async (req, res) => {
    const r = await db.query(
      "DELETE FROM project_time_entries WHERE project_id=$1 AND workspace_id=$2 AND id=$3 RETURNING id",
      [S.id(req.params.id), req.user.workspace_id, S.id(req.params.entryId)],
    );
    if (!r.rows.length) S.fail("Time entry not found.", 404);
    res.json({ ok: true });
  }),
);
router.get(
  "/projects/:id/protocol.pdf",
  run(async (req, res) => {
    const w = req.user.workspace_id,
      p = await S.row(db, "projects", w, req.params.id),
      tasks = (
        await db.query(
          "SELECT * FROM tasks WHERE project_id=$1 AND workspace_id=$2 ORDER BY due_date NULLS LAST,id",
          [p.id, w],
        )
      ).rows,
      notes = (
        await db.query(
          "SELECT * FROM project_notes WHERE project_id=$1 AND workspace_id=$2 ORDER BY id",
          [p.id, w],
        )
      ).rows,
      orders = (
        await db.query(
          "SELECT * FROM sales_orders WHERE project_id=$1 AND workspace_id=$2 ORDER BY id",
          [p.id, w],
        )
      ).rows,
      buffer = await require("../services/projectProtocol")(
        {
          ...p,
          resources: (
            await db.query(
              "SELECT r.*,u.name AS user_name FROM project_resources r JOIN users u ON u.id=r.user_id WHERE r.project_id=$1 AND r.workspace_id=$2",
              [p.id, w],
            )
          ).rows,
          time_entries: (
            await db.query(
              "SELECT t.*,u.name AS user_name FROM project_time_entries t JOIN users u ON u.id=t.user_id WHERE t.project_id=$1 AND t.workspace_id=$2 ORDER BY spent_on,id",
              [p.id, w],
            )
          ).rows,
        },
        tasks,
        notes,
        orders,
        req.user,
      );
    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="project-${p.id}-protocol.pdf"`,
        "Cache-Control": "private, no-store",
      })
      .send(buffer);
  }),
);
router.post(
  "/projects/:id/notes",
  requireEditor,
  run(async (req, res) => {
    await S.row(db, "projects", req.user.workspace_id, req.params.id);
    const b = req.body || {},
      kind = b.kind || "note";
    if (!["note", "agreement", "protocol", "document"].includes(kind))
      S.fail("Invalid project record type.");
    const title = S.txt(b.title, 300);
    if (!title) S.fail("Enter a title.");
    const n = await db.query(
      "INSERT INTO project_notes(workspace_id,project_id,kind,title,body,document_url,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        req.user.workspace_id,
        S.id(req.params.id),
        kind,
        title,
        S.txt(b.body, 30000),
        S.url(b.document_url),
        req.user.id,
      ],
    );
    res.status(201).json({ note: n.rows[0] });
  }),
);
router.get(
  "/tasks",
  run(async (req, res) => {
    const w = req.user.workspace_id;
    res.json({
      tasks: (
        await db.query(
          "SELECT t.*,u.name AS assigned_name,p.title AS project_title FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to LEFT JOIN projects p ON p.id=t.project_id WHERE t.workspace_id=$1 ORDER BY t.due_date NULLS LAST,t.id",
          [w],
        )
      ).rows,
    });
  }),
);
router.post(
  "/tasks",
  requireEditor,
  run(async (req, res) =>
    res
      .status(201)
      .json({ task: await S.task(req.user, null, req.body || {}) }),
  ),
);
router.put(
  "/tasks/:id",
  requireEditor,
  run(async (req, res) =>
    res.json({ task: await S.task(req.user, req.params.id, req.body || {}) }),
  ),
);
router.delete(
  "/tasks/:id",
  requireEditor,
  run(async (req, res) => {
    const r = await db.query(
      "DELETE FROM tasks WHERE id=$1 AND workspace_id=$2 RETURNING id",
      [S.id(req.params.id), req.user.workspace_id],
    );
    if (!r.rows.length) S.fail("Task not found.", 404);
    res.json({ ok: true });
  }),
);
router.get(
  "/reminders",
  run(async (req, res) =>
    res.json({
      reminders: (
        await db.query(
          `SELECT t.* FROM tasks t WHERE t.workspace_id=$1 AND t.status<>'done' AND t.reminder_at<=now() AND t.reminder_dismissed_at IS NULL AND (t.assigned_to=$2 OR t.assigned_to IS NULL) ORDER BY t.reminder_at LIMIT 100`,
          [req.user.workspace_id, req.user.id],
        )
      ).rows,
    }),
  ),
);
router.post(
  "/tasks/:id/dismiss-reminder",
  requireEditor,
  run(async (req, res) => {
    const r = await db.query(
      `UPDATE tasks SET reminder_dismissed_at=now() WHERE id=$1 AND workspace_id=$2 AND (assigned_to=$3 OR assigned_to IS NULL) RETURNING id`,
      [S.id(req.params.id), req.user.workspace_id, req.user.id],
    );
    if (!r.rows.length) S.fail("Reminder not found.", 404);
    res.json({ ok: true });
  }),
);
router.get(
  "/equipment",
  run(async (req, res) =>
    res.json({
      equipment: (
        await db.query(
          `SELECT e.*,u.name AS assigned_name,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'status',a.status,'starts_at',a.starts_at,'ends_at',a.ends_at,'assigned_name',au.name,'project_id',a.project_id,'task_id',a.task_id) ORDER BY a.starts_at) FROM equipment_assignments a LEFT JOIN users au ON au.id=a.assigned_to WHERE a.equipment_id=e.id AND a.status IN('reserved','checked_out')),'[]') AS assignments FROM equipment e LEFT JOIN users u ON u.id=e.assigned_to WHERE e.workspace_id=$1 ORDER BY e.retired,e.name`,
          [req.user.workspace_id],
        )
      ).rows,
    }),
  ),
);
router.post(
  "/equipment",
  requireEditor,
  run(async (req, res) =>
    res
      .status(201)
      .json({ equipment: await S.equipment(req.user, null, req.body || {}) }),
  ),
);
router.put(
  "/equipment/:id",
  requireEditor,
  run(async (req, res) =>
    res.json({
      equipment: await S.equipment(req.user, req.params.id, req.body || {}),
    }),
  ),
);
router.get(
  "/equipment/:id/history",
  run(async (req, res) => {
    await S.row(db, "equipment", req.user.workspace_id, req.params.id);
    res.json({
      assignments: (
        await db.query(
          "SELECT a.*,u.name AS assigned_name,p.title AS project_title FROM equipment_assignments a LEFT JOIN users u ON u.id=a.assigned_to LEFT JOIN projects p ON p.id=a.project_id WHERE a.equipment_id=$1 AND a.workspace_id=$2 ORDER BY a.created_at DESC",
          [S.id(req.params.id), req.user.workspace_id],
        )
      ).rows,
    });
  }),
);
router.post(
  "/equipment/:id/assignments",
  requireEditor,
  run(async (req, res) =>
    res
      .status(201)
      .json({
        assignment: await S.assignment(req.user, req.params.id, req.body || {}),
      }),
  ),
);
router.patch(
  "/assignments/:id",
  requireEditor,
  run(async (req, res) =>
    res.json({
      assignment: await S.moveAssignment(
        req.user,
        req.params.id,
        req.body || {},
      ),
    }),
  ),
);
router.get(
  "/orders",
  run(async (req, res) =>
    res.json({
      orders: (
        await db.query(
          "SELECT o.*,p.title AS project_title,c.name AS company_name FROM sales_orders o LEFT JOIN projects p ON p.id=o.project_id LEFT JOIN companies c ON c.id=o.company_id WHERE o.workspace_id=$1 ORDER BY o.updated_at DESC",
          [req.user.workspace_id],
        )
      ).rows,
    }),
  ),
);
router.get(
  "/orders/:id",
  run(async (req, res) =>
    res.json({
      order: await S.row(
        db,
        "sales_orders",
        req.user.workspace_id,
        req.params.id,
      ),
      events: (
        await db.query(
          "SELECT e.*,u.name AS user_name FROM order_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.order_id=$1 AND e.workspace_id=$2 ORDER BY e.id DESC",
          [S.id(req.params.id), req.user.workspace_id],
        )
      ).rows,
    }),
  ),
);
router.post(
  "/orders",
  requireEditor,
  run(async (req, res) =>
    res
      .status(201)
      .json({ order: await S.order(req.user, null, req.body || {}) }),
  ),
);
router.put(
  "/orders/:id",
  requireEditor,
  run(async (req, res) =>
    res.json({ order: await S.order(req.user, req.params.id, req.body || {}) }),
  ),
);
module.exports = router;
