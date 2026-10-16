const express = require("express");
const db = require("../db");
const { requireAuth, requireEditor } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");
const {
  invalid,
  text,
  optionalId,
  validDate,
  saveDeal,
} = require("../services/dealWorkspace");
const P = require("../services/pipelines");
const router = express.Router();
router.use(requireAuth, requirePaidAccess);
const action = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    if (!error.status) console.error("Deal operation failed:", error.message);
    res
      .status(error.status || 500)
      .json({
        error: error.status
          ? error.message
          : "Could not save or load this deal. Please try again.",
      });
  }
};
router.get(
  "/stages",
  action(async (req, res) => {
    const stages = await P.transaction(
      db.pool,
      req.user.workspace_id,
      async (client) => {
        const pipeline = await P.selected(
          client,
          req.user.workspace_id,
          req.query.pipeline_id,
        );
        return (
          await client.query(
            "SELECT * FROM pipeline_stages WHERE workspace_id=$1 AND pipeline_id=$2 ORDER BY sort_order,id",
            [req.user.workspace_id, pipeline.id],
          )
        ).rows;
      },
    );
    res.json({ stages });
  }),
);
router.post(
  "/stages",
  requireEditor,
  action(async (req, res) => {
    const name = text(req.body.name, 120, "stage name", true);
    const color = /^#[0-9a-f]{6}$/i.test(req.body.color || "")
      ? req.body.color
      : "#64748b";
    const stage = await P.transaction(
      db.pool,
      req.user.workspace_id,
      async (client) => {
        const pipeline = await P.selected(
          client,
          req.user.workspace_id,
          req.body.pipeline_id,
        );
        return (
          await client.query(
            `INSERT INTO pipeline_stages(workspace_id,pipeline_id,name,color,sort_order)
      SELECT $1,$2,$3,$4,COALESCE(MAX(sort_order),-1)+1 FROM pipeline_stages WHERE workspace_id=$1 AND pipeline_id=$2 RETURNING *`,
            [req.user.workspace_id, pipeline.id, name, color],
          )
        ).rows[0];
      },
    );
    res.status(201).json({ stage });
  }),
);
router.put(
  "/stages/reorder",
  requireEditor,
  action(async (req, res) => {
    if (!Array.isArray(req.body.order) || req.body.order.length > 200)
      throw invalid("Invalid stage order.");
    const order = req.body.order.map((item) => ({
      id: optionalId(item.id),
      order: Number(item.sort_order),
    }));
    if (
      order.some((item) => !item.id || !Number.isSafeInteger(item.order)) ||
      new Set(order.map((i) => i.id)).size !== order.length
    )
      throw invalid("Invalid stage order.");
    await P.transaction(db.pool, req.user.workspace_id, async (client) => {
      const pipeline = await P.selected(
        client,
        req.user.workspace_id,
        req.body.pipeline_id,
      );
      const ids = (
        await client.query(
          "SELECT id FROM pipeline_stages WHERE workspace_id=$1 AND pipeline_id=$2",
          [req.user.workspace_id, pipeline.id],
        )
      ).rows.map((s) => s.id);
      if (ids.length !== order.length || order.some((i) => !ids.includes(i.id)))
        throw invalid("Reload this pipeline before reordering stages.");
      for (const item of order)
        await client.query(
          "UPDATE pipeline_stages SET sort_order=$1 WHERE id=$2 AND workspace_id=$3 AND pipeline_id=$4",
          [item.order, item.id, req.user.workspace_id, pipeline.id],
        );
    });
    res.json({ ok: true });
  }),
);
router.put(
  "/stages/:id",
  requireEditor,
  action(async (req, res) => {
    const name = text(req.body.name, 120, "stage name", true);
    const color = /^#[0-9a-f]{6}$/i.test(req.body.color || "")
      ? req.body.color
      : "#64748b";
    const order =
      req.body.sort_order == null ? null : Number(req.body.sort_order);
    if (order !== null && !Number.isSafeInteger(order))
      throw invalid("Invalid stage order.");
    const stage = await P.transaction(
      db.pool,
      req.user.workspace_id,
      async (client) => {
        const result = await client.query(
          "UPDATE pipeline_stages SET name=$1,color=$2,sort_order=COALESCE($3,sort_order) WHERE id=$4 AND workspace_id=$5 RETURNING *",
          [
            name,
            color,
            order,
            optionalId(req.params.id),
            req.user.workspace_id,
          ],
        );
        if (!result.rows.length) throw invalid("Stage not found.", 404);
        return result.rows[0];
      },
    );
    res.json({ stage });
  }),
);
router.delete(
  "/stages/:id",
  requireEditor,
  action(async (req, res) => {
    await P.transaction(db.pool, req.user.workspace_id, async (client) => {
      const stage = (
        await client.query(
          "SELECT * FROM pipeline_stages WHERE id=$1 AND workspace_id=$2",
          [optionalId(req.params.id), req.user.workspace_id],
        )
      ).rows[0];
      if (!stage) throw invalid("Stage not found.", 404);
      await client.query(
        `INSERT INTO deal_events(workspace_id,deal_id,user_id,event_type,from_stage,from_status,to_status)
      SELECT workspace_id,id,$3,'changed',$4,status,status FROM deals WHERE stage_id=$1 AND workspace_id=$2`,
        [stage.id, req.user.workspace_id, req.user.id, stage.name],
      );
      await client.query(
        "UPDATE deals SET stage_id=NULL,stage_entered_at=now(),updated_at=now() WHERE stage_id=$1 AND workspace_id=$2",
        [stage.id, req.user.workspace_id],
      );
      await client.query(
        "DELETE FROM pipeline_stages WHERE id=$1 AND workspace_id=$2",
        [stage.id, req.user.workspace_id],
      );
    });
    res.json({ ok: true });
  }),
);
const dealSelect = `SELECT d.*, CASE WHEN d.status='won' THEN 100 WHEN d.status='lost' THEN 0 ELSE d.probability END AS effective_probability, ROUND(COALESCE(d.value,0)*(CASE WHEN d.status='won' THEN 100 WHEN d.status='lost' THEN 0 ELSE d.probability END)/100,2) AS weighted_value, c.full_name AS contact_name, co.name AS company_name, p.name AS product_name,
  ps.name AS stage_name, ps.color AS stage_color, sp.name AS pipeline_name, u.name AS assigned_name,
  next_step.id AS next_task_id, next_step.title AS next_task_title, next_step.due_date::text AS next_task_due,
  (SELECT COUNT(*)::int FROM tasks t WHERE t.deal_id=d.id AND t.workspace_id=d.workspace_id AND t.status!='done' AND t.due_date<CURRENT_DATE) AS overdue_tasks
  FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id AND c.workspace_id=d.workspace_id
  LEFT JOIN companies co ON co.id=d.company_id AND co.workspace_id=d.workspace_id
  LEFT JOIN products p ON p.id=d.product_id AND p.workspace_id=d.workspace_id
  LEFT JOIN pipeline_stages ps ON ps.id=d.stage_id AND ps.workspace_id=d.workspace_id
  LEFT JOIN sales_pipelines sp ON sp.id=d.pipeline_id AND sp.workspace_id=d.workspace_id
  LEFT JOIN users u ON u.id=d.assigned_to AND u.workspace_id=d.workspace_id
  LEFT JOIN LATERAL (SELECT t.id,t.title,t.due_date FROM tasks t WHERE t.deal_id=d.id AND t.workspace_id=d.workspace_id AND t.status!='done'
    ORDER BY t.due_date NULLS LAST,t.created_at LIMIT 1) next_step ON true`;
router.get(
  "/",
  action(async (req, res) => {
    let sql = dealSelect + " WHERE d.workspace_id=$1 AND d.deleted_at IS "+(req.query.status==="deleted"?"NOT NULL":"NULL");
    const params = [req.user.workspace_id];
    for (const field of [
      "pipeline_id",
      "stage_id",
      "assigned_to",
      "contact_id",
    ]) {
      if (req.query[field]) {
        params.push(optionalId(req.query[field]));
        sql += ` AND d.${field}=$${params.length}`;
      }
    }
    if (req.query.status) {
      if (!["open", "won", "lost", "all", "deleted"].includes(req.query.status))
        throw invalid("Invalid status.");
      if (!["all","deleted"].includes(req.query.status)) {
        params.push(req.query.status);
        sql += ` AND d.status=$${params.length}`;
      }
    } else {
      sql += " AND d.status!='lost'";
    }
    if (req.query.search) {
      params.push("%" + String(req.query.search).slice(0, 200) + "%");
      sql += ` AND (d.title ILIKE $${params.length} OR c.full_name ILIKE $${params.length} OR co.name ILIKE $${params.length})`;
    }
    sql += " ORDER BY next_step.due_date NULLS LAST,d.updated_at DESC";
    res.json({ deals: (await db.query(sql, params)).rows });
  }),
);
router.post(
  "/",
  requireEditor,
  action(async (req, res) => {
    res
      .status(201)
      .json({ deal: await saveDeal(db.pool, req.user, null, req.body) });
  }),
);
router.get(
  "/:id/history",
  action(async (req, res) => {
    const deal = await db.query(
      "SELECT id FROM deals WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL",
      [optionalId(req.params.id), req.user.workspace_id],
    );
    if (!deal.rows.length) throw invalid("Deal not found.", 404);
    res.json({
      events: (
        await db.query(
          `SELECT e.*,u.name AS user_name FROM deal_events e LEFT JOIN users u ON u.id=e.user_id
    WHERE e.deal_id=$1 AND e.workspace_id=$2 ORDER BY e.created_at DESC,e.id DESC LIMIT 100`,
          [req.params.id, req.user.workspace_id],
        )
      ).rows,
    });
  }),
);
router.post(
  "/:id/next-step",
  requireEditor,
  action(async (req, res) => {
    const deal = (
      await db.query("SELECT * FROM deals WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL", [
        optionalId(req.params.id),
        req.user.workspace_id,
      ])
    ).rows[0];
    if (!deal) throw invalid("Deal not found.", 404);
    const title = text(req.body.title, 300, "task title", true);
    const due = validDate(req.body.due_date);
    if (!due) throw invalid("Choose a due date.");
    const owner = deal.assigned_to || req.user.id;
    const result = await db.query(
      `INSERT INTO tasks (workspace_id,title,assigned_to,created_by,contact_id,company_id,deal_id,due_date,status,priority)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'todo','medium') RETURNING *`,
      [
        req.user.workspace_id,
        title,
        owner,
        req.user.id,
        deal.contact_id,
        deal.company_id,
        deal.id,
        due,
      ],
    );
    res.status(201).json({ task: result.rows[0] });
  }),
);
router.get(
  "/:id",
  action(async (req, res) => {
    const deal = (
      await db.query(dealSelect + " WHERE d.id=$1 AND d.workspace_id=$2 AND d.deleted_at IS NULL", [
        optionalId(req.params.id),
        req.user.workspace_id,
      ])
    ).rows[0];
    if (!deal) throw invalid("Deal not found.", 404);
    res.json({ deal });
  }),
);
router.put(
  "/:id",
  requireEditor,
  action(async (req, res) => {
    res.json({
      deal: await saveDeal(db.pool, req.user, req.params.id, req.body),
    });
  }),
);
router.patch(
  "/:id/stage",
  requireEditor,
  action(async (req, res) => {
    res.json({
      deal: await saveDeal(db.pool, req.user, req.params.id, {
        stage_id: req.body.stage_id,
      }),
    });
  }),
);
router.delete(
  "/:id",
  requireEditor,
  action(async (req, res) => {
    const result = await db.query(
      "UPDATE deals SET deleted_at=now(),updated_at=now() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL RETURNING id",
      [optionalId(req.params.id), req.user.workspace_id],
    );
    if (!result.rows.length) throw invalid("Deal not found.", 404);
    res.json({ ok: true });
  }),
);
router.post('/:id/restore',requireEditor,action(async(req,res)=>{const result=await db.query('UPDATE deals SET deleted_at=NULL,updated_at=now() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NOT NULL RETURNING *',[optionalId(req.params.id),req.user.workspace_id]);if(!result.rows.length)throw invalid('Deleted deal not found.',404);res.json({deal:result.rows[0]});}));
module.exports = router;
