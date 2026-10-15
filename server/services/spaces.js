const crypto = require("crypto");
const db = require("../db");
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
async function personalSpace(user) {
  const existing = (
    await db.query(
      "SELECT * FROM workspaces WHERE owner_user_id=$1 AND space_type='personal'",
      [user.id],
    )
  ).rows[0];
  if (existing) return existing;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      user.id,
    ]);
    let row = (
      await client.query(
        "SELECT * FROM workspaces WHERE owner_user_id=$1 AND space_type='personal'",
        [user.id],
      )
    ).rows[0];
    if (!row) {
      const base =
        (
          await client.query(
            "SELECT default_currency,quote_defaults,trial_ends_at FROM workspaces WHERE id=$1",
            [user.workspace_id],
          )
        ).rows[0] || {};
      row = (
        await client.query(
          `INSERT INTO workspaces(name,invite_code,space_type,owner_user_id,billing_workspace_id,default_currency,quote_defaults,plan,trial_ends_at) VALUES($1,$2,'personal',$3,$4,$5,$6,'trial',$7) RETURNING *`,
          [
            `${user.name}'s personal CRM`,
            crypto.randomBytes(16).toString("hex"),
            user.id,
            user.workspace_id,
            base.default_currency || "USD",
            JSON.stringify(base.quote_defaults || {}),
            base.trial_ends_at || new Date(Date.now() + 7 * 864e5),
          ],
        )
      ).rows[0];
    }
    await client.query("COMMIT");
    return row;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function ensureTeamOwner(wid, client = db) {
  let row = (
    await client.query(
      "SELECT owner_user_id,space_type,billing_workspace_id FROM workspaces WHERE id=$1",
      [wid],
    )
  ).rows[0];
  if (row && !row.owner_user_id)
    row = (
      await client.query(
        `UPDATE workspaces w SET owner_user_id=COALESCE(w.owner_user_id,(SELECT id FROM users u WHERE u.workspace_id=w.id ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,created_at,id LIMIT 1)) WHERE w.id=$1 RETURNING owner_user_id,space_type,billing_workspace_id`,
        [wid],
      )
    ).rows[0];
  return row;
}
async function account(id) {
  return (
    await db.query(
      "SELECT id,workspace_id,name,email,role FROM users WHERE id=$1",
      [id],
    )
  ).rows[0];
}
async function canLinkUser(client, id, wid) {
  return (
    (
      await client.query(
        "SELECT u.id FROM users u WHERE u.id=$1 AND (u.workspace_id=$2 OR EXISTS(SELECT 1 FROM workspaces w WHERE w.id=$2 AND w.space_type='personal' AND w.owner_user_id=u.id))",
        [id, wid],
      )
    ).rows.length > 0
  );
}
module.exports = { personalSpace, ensureTeamOwner, account, canLinkUser, fail };

// Joining is serialized with seat purchases and other joins; private records never move.
module.exports.joinTeam = async (user, invite) => {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    const target = (
      await c.query(
        "SELECT * FROM workspaces WHERE invite_code=$1 AND space_type='team'",
        [invite.trim().toUpperCase()],
      )
    ).rows[0];
    if (!target) throw fail("That invite does not match a team.");
    const current = (
      await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [user.id])
    ).rows[0];
    if (!current || current.workspace_id !== user.workspace_id)
      throw fail("Your team changed. Sign in again.", 401);
    if (target.id === current.workspace_id)
      throw fail("You already belong to this team.");
    const locked = (
      await c.query(
        "SELECT * FROM workspaces WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE",
        [[current.workspace_id, target.id]],
      )
    ).rows;
    const dest = locked.find((w) => w.id === target.id),
      old = locked.find((w) => w.id === current.workspace_id);
    if (dest.invite_code !== invite.trim().toUpperCase())
      throw fail("This invitation has been revoked.");
    if (old.owner_user_id === user.id) {
      const count = (
        await c.query(
          "SELECT COUNT(*)::int AS n FROM users WHERE workspace_id=$1",
          [old.id],
        )
      ).rows[0].n;
      if (count > 1) throw fail("Transfer team ownership before leaving.", 409);
      if (old.stripe_subscription_id && !old.cancel_at_period_end)
        throw fail(
          "Cancel the current team subscription renewal or transfer ownership before leaving.",
          409,
        );
    }
    await require("./limits").assertWithinLimit(dest.id, "seats", c);
    const owner = old.owner_user_id === user.id ? null : old.owner_user_id;
    for (const [table, field] of [
      ["contacts", "owner_id"],
      ["deals", "assigned_to"],
      ["tasks", "assigned_to"],
    ])
      await c.query(
        `UPDATE ${table} SET ${field}=$1 WHERE workspace_id=$2 AND ${field}=$3`,
        [owner, old.id, user.id],
      );
    const changed = (
      await c.query(
        "UPDATE users SET workspace_id=$1,role=$2 WHERE id=$3 RETURNING *",
        [dest.id, dest.owner_user_id === user.id ? "admin" : "member", user.id],
      )
    ).rows[0];
    await c.query(
      "UPDATE workspaces SET billing_workspace_id=$1 WHERE owner_user_id=$2 AND space_type='personal'",
      [dest.id, user.id],
    );
    await c.query("COMMIT");
    return { user: changed, name: dest.name };
  } catch (e) {
    await c.query("ROLLBACK");
    if (e instanceof require("./limits").LimitExceededError)
      throw fail(e.message, 403);
    throw e;
  } finally {
    c.release();
  }
};
