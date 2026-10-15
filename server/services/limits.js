// server/services/limits.js
// ---------------------------------------------------------
// Checks a workspace against its tier's limits before letting it
// add a seat, a contact, or generate another AI draft. Trial and
// comped workspaces are never limited — only workspaces on an
// active paid plan are checked, against whichever tier they
// subscribed to.
// ---------------------------------------------------------
const db = require("../db");
const { getTier } = require("../config/tiers");

class LimitExceededError extends Error {}

// A grant from the Platform dashboard can be time-limited
// (comped_until set) or permanent (comped_until null). This is the
// one place that decides whether a comp is still in effect —
// both this file and the billing-access middleware use it, so a
// grant expires consistently everywhere, not just in one gate.
function isCurrentlyComped(workspace) {
  if (!workspace.is_comped) return false;
  if (!workspace.comped_until) return true;
  return new Date(workspace.comped_until) > new Date();
}

async function assertWithinLimit(workspaceId, kind, client = db) {
  const wsResult = await client.query(
    "SELECT id, plan, is_comped, comped_until, tier, extra_seats FROM workspaces WHERE id = (SELECT COALESCE(billing_workspace_id,id) FROM workspaces WHERE id=$1)",
    [workspaceId],
  );
  const workspace = wsResult.rows[0];
  if (!workspace) throw new Error("Workspace not found.");

  // Trials and comped workspaces get full access, no caps.
  if (isCurrentlyComped(workspace) || workspace.plan !== "active") return;

  const tier = getTier(workspace.tier);
  const billingId = workspace.id;

  if (kind === "seats") {
    if (tier.maxSeats == null) return;
    const { rows } = await client.query(
      "SELECT COUNT(*) AS n FROM users WHERE workspace_id = $1",
      [billingId],
    );
    if (
      Number(rows[0].n) >=
      tier.maxSeats + Number(workspace.extra_seats || 0)
    ) {
      throw new LimitExceededError(
        `Your ${tier.label} plan allows up to ${tier.maxSeats + Number(workspace.extra_seats || 0)} team member${tier.maxSeats === 1 ? "" : "s"}. Upgrade to add more.`,
      );
    }
  }

  if (kind === "contacts") {
    if (tier.maxContacts == null) return;
    const { rows } = await client.query(
      "SELECT COUNT(*) AS n FROM contacts WHERE workspace_id=$1 OR workspace_id IN(SELECT id FROM workspaces WHERE billing_workspace_id=$1)",
      [billingId],
    );
    if (Number(rows[0].n) >= tier.maxContacts) {
      throw new LimitExceededError(
        `Your ${tier.label} plan allows up to ${tier.maxContacts} contacts. Upgrade to add more.`,
      );
    }
  }

  if (kind === "ai_drafts") {
    if (tier.maxAiDraftsPerMonth == null) return;
    const { rows } = await client.query(
      `SELECT COUNT(*) AS n FROM offers
       WHERE (workspace_id=$1 OR workspace_id IN(SELECT id FROM workspaces WHERE billing_workspace_id=$1)) AND ai_generated = TRUE AND created_at >= date_trunc('month', now())`,
      [billingId],
    );
    if (Number(rows[0].n) >= tier.maxAiDraftsPerMonth) {
      throw new LimitExceededError(
        `Your ${tier.label} plan includes ${tier.maxAiDraftsPerMonth} AI drafts a month, and you've used them all. Upgrade for more, or wait until next month.`,
      );
    }
  }
}

module.exports = { assertWithinLimit, LimitExceededError, isCurrentlyComped };
