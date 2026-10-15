const db = require("../db"),
  S = require("../services/spaces"),
  C = require("../services/spaceCopy"),
  { requireAuth, requireTeamOwner } = require("../middleware/auth"),
  { requirePaidAccess } = require("../middleware/billing"),
  { invalid, optionalId, text } = require("../services/dealWorkspace");
const router = require("../middleware/safeRouter")();
router.use(requireAuth);
router.get("/", async (req, res) => {
  const personal = await S.personalSpace(req.account),
    primary = (
      await db.query(
        "SELECT id,name,space_type,owner_user_id FROM workspaces WHERE id=$1",
        [req.account.workspace_id],
      )
    ).rows[0];
  res.json({
    active: req.user.scope,
    personal: { id: personal.id, name: personal.name },
    team: primary?.space_type === "team" ? primary : null,
    is_team_owner: req.user.is_team_owner,
  });
});
router.get("/source", requirePaidAccess, async (req, res) => {
  const sid = await C.source(db, req.user),
    table = {
      products: "products",
      contacts: "contacts",
      companies: "companies",
    }[req.query.entity];
  if (!table) throw invalid("Choose products, contacts or companies.");
  res.json({
    records: (
      await db.query(
        `SELECT id,${table === "contacts" ? "full_name" : "name"} AS name FROM ${table} WHERE workspace_id=$1 ORDER BY 2,id`,
        [sid],
      )
    ).rows,
  });
});
router.post("/copy/preview", requirePaidAccess, async (req, res) =>
  res.json(await C.preview(db, req.user, req.body)),
);
router.post("/copy", requirePaidAccess, async (req, res) =>
  res.json(await C.copy(db.pool, req.user, req.body)),
);
router.get("/audit", requireTeamOwner, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100)),
    before = optionalId(req.query.before);
  const params = [req.user.workspace_id, limit];
  let clause = "";
  if (before) {
    params.push(before);
    clause = " AND a.id<$3";
  }
  res.json({
    entries: (
      await db.query(
        `SELECT a.*,u.name AS user_name FROM team_audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.workspace_id=$1${clause} ORDER BY a.id DESC LIMIT $2`,
        params,
      )
    ).rows,
  });
});
router.post("/ownership", requireTeamOwner, async (req, res) => {
  const id = optionalId(req.body.user_id);
  if (!id || id === req.user.id) throw invalid("Choose another teammate.");
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    const w = (
      await c.query(
        "SELECT owner_user_id FROM workspaces WHERE id=$1 FOR UPDATE",
        [req.user.workspace_id],
      )
    ).rows[0];
    if (w.owner_user_id !== req.user.id)
      throw invalid("Team ownership changed. Refresh and try again.", 403);
    if (
      !(
        await c.query("SELECT id FROM users WHERE id=$1 AND workspace_id=$2", [
          id,
          req.user.workspace_id,
        ])
      ).rows.length
    )
      throw invalid("User not found.", 404);
    await c.query("UPDATE users SET role='admin' WHERE id=$1", [id]);
    await c.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
      id,
      req.user.workspace_id,
    ]);
    // Delegated Microsoft access belongs to the connecting owner. The new owner reconnects.
    await c.query('DELETE FROM sharepoint_connections WHERE workspace_id=$1',[req.user.workspace_id]);
    await c.query('DELETE FROM sharepoint_uploads WHERE workspace_id=$1 AND completed_file_id IS NULL',[req.user.workspace_id]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  res.json({ ok: true });
});
router.post("/team", async (req, res) => {
  const primary = (
    await db.query("SELECT space_type FROM workspaces WHERE id=$1", [
      req.account.workspace_id,
    ])
  ).rows[0];
  if (primary?.space_type !== "personal")
    throw invalid("You already belong to a team.");
  const name = text(req.body.name, 150, "team name", true),
    c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    const current = (
      await c.query(
        "SELECT u.workspace_id,w.space_type FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=$1 FOR UPDATE OF u",
        [req.user.id],
      )
    ).rows[0];
    if (
      current?.space_type !== "personal" ||
      current.workspace_id !== req.account.workspace_id
    )
      throw invalid("Your team changed. Refresh and try again.", 409);
    const w = (
      await c.query(
        "INSERT INTO workspaces(name,invite_code,space_type,owner_user_id,trial_ends_at) VALUES($1,$2,'team',$3,now()+interval '7 days') RETURNING id",
        [
          name,
          require("crypto").randomBytes(10).toString("hex").toUpperCase(),
          req.user.id,
        ],
      )
    ).rows[0];
    await c.query("UPDATE users SET workspace_id=$1,role='admin' WHERE id=$2", [
      w.id,
      req.user.id,
    ]);
    await c.query("UPDATE workspaces SET billing_workspace_id=$1 WHERE id=$2", [
      w.id,
      req.account.workspace_id,
    ]);
    await c.query("COMMIT");
    res.json({ reauthenticate: true });
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});
module.exports = router;
