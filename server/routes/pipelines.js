const express = require("express");
const db = require("../db");
const { requireAuth, requireEditor } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");
const { text, optionalId, invalid } = require("../services/dealWorkspace");
const P = require("../services/pipelines");
const router = express.Router();
router.use(requireAuth, requirePaidAccess);
const action = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (!e.status && e.code !== "23505") console.error("Pipeline:", e.message);
    res
      .status(e.code === "23505" ? 409 : e.status || 500)
      .json({
        error:
          e.code === "23505"
            ? "A pipeline with this name already exists."
            : e.status
              ? e.message
              : "Could not save or load pipelines.",
      });
  }
};
router.get(
  "/",
  action(async (req, res) => {
    const pipelines = await P.transaction(
      db.pool,
      req.user.workspace_id,
      async (client) =>
        (
          await client.query(
            `SELECT p.*,(SELECT COUNT(*)::int FROM deals d WHERE d.pipeline_id=p.id AND d.workspace_id=p.workspace_id) AS deal_count FROM sales_pipelines p WHERE p.workspace_id=$1 ORDER BY p.is_default DESC,p.created_at,p.id`,
            [req.user.workspace_id],
          )
        ).rows,
    );
    res.json({ pipelines });
  }),
);
router.post(
  "/",
  requireEditor,
  action(async (req, res) => {
    const name = text(req.body.name, 100, "pipeline name", true),
      description = text(
        req.body.description || "",
        2000,
        "pipeline description",
      );
    const pipeline = await P.transaction(
      db.pool,
      req.user.workspace_id,
      async (client, first) => {
        const p = (
          await client.query(
            "INSERT INTO sales_pipelines(workspace_id,name,description) VALUES($1,$2,$3) RETURNING *",
            [req.user.workspace_id, name, description],
          )
        ).rows[0];
        if (req.body.copy_from) {
          const source = await P.selected(
            client,
            req.user.workspace_id,
            req.body.copy_from,
          );
          await client.query(
            "INSERT INTO pipeline_stages(workspace_id,pipeline_id,name,color,sort_order) SELECT workspace_id,$1,name,color,sort_order FROM pipeline_stages WHERE workspace_id=$2 AND pipeline_id=$3",
            [p.id, req.user.workspace_id, source.id],
          );
        } else await P.seed(client, req.user.workspace_id, p.id);
        return p;
      },
    );
    res.status(201).json({ pipeline });
  }),
);
router.put(
  "/:id",
  requireEditor,
  action(async (req, res) => {
    const name = text(req.body.name, 100, "pipeline name", true),
      description = text(
        req.body.description || "",
        2000,
        "pipeline description",
      );
    const pipeline = await P.transaction(
      db.pool,
      req.user.workspace_id,
      async (client) => {
        const p = await P.selected(
          client,
          req.user.workspace_id,
          optionalId(req.params.id),
        );
        return (
          await client.query(
            "UPDATE sales_pipelines SET name=$1,description=$2 WHERE id=$3 AND workspace_id=$4 RETURNING *",
            [name, description, p.id, req.user.workspace_id],
          )
        ).rows[0];
      },
    );
    res.json({ pipeline });
  }),
);
router.delete(
  "/:id",
  requireEditor,
  action(async (req, res) => {
    await P.transaction(db.pool, req.user.workspace_id, async (client) => {
      const p = await P.selected(
        client,
        req.user.workspace_id,
        optionalId(req.params.id),
      );
      if (p.is_default)
        throw invalid(
          "The original pipeline cannot be deleted. You can rename it.",
        );
      if (
        (
          await client.query(
            "SELECT id FROM deals WHERE pipeline_id=$1 AND workspace_id=$2 LIMIT 1",
            [p.id, req.user.workspace_id],
          )
        ).rows.length
      )
        throw invalid("Move or delete the deals in this pipeline first.", 409);
      await client.query(
        "DELETE FROM pipeline_stages WHERE pipeline_id=$1 AND workspace_id=$2",
        [p.id, req.user.workspace_id],
      );
      await client.query(
        "DELETE FROM sales_pipelines WHERE id=$1 AND workspace_id=$2",
        [p.id, req.user.workspace_id],
      );
    });
    res.json({ ok: true });
  }),
);
module.exports = router;
