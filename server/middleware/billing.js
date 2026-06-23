// server/middleware/billing.js
// ---------------------------------------------------------
// Sits behind requireAuth on every "core product" route
// (contacts, offers, stats). Lets a request through if the
// workspace is comped, actively paying, or still inside its
// trial window — otherwise it asks them to upgrade.
//
// One-time purchases need a little extra care here: a real Stripe
// subscription tells us via webhook the moment it lapses, but a
// one-time payment has no ongoing Stripe object to watch — so this
// is the one place that actually notices a one-time purchase's 30
// days have run out, checked lazily on each request rather than
// via a background job.
// ---------------------------------------------------------
const db = require("../db");
const { isCurrentlyComped } = require("../services/limits");

async function requirePaidAccess(req, res, next) {
  try {
    const result = await db.query(
      "SELECT plan, is_comped, comped_until, trial_ends_at, current_period_end, stripe_subscription_id FROM workspaces WHERE id = $1",
      [req.user.workspace_id]
    );
    const workspace = result.rows[0];
    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found." });
    }

    if (isCurrentlyComped(workspace)) return next();

    // A time-limited grant just lapsed — clear the flag so the
    // Platform dashboard and Settings stop reporting it as comped.
    if (workspace.is_comped) {
      await db.query("UPDATE workspaces SET is_comped = FALSE WHERE id = $1", [req.user.workspace_id]);
    }

    if (workspace.plan === "active") {
      const isOneTime = !workspace.stripe_subscription_id;
      const lapsed = workspace.current_period_end && new Date(workspace.current_period_end) < new Date();
      if (isOneTime && lapsed) {
        await db.query("UPDATE workspaces SET plan = 'past_due' WHERE id = $1", [req.user.workspace_id]);
        return res.status(402).json({
          error: "Your one-month access has run out. Buy another month or switch to a monthly plan to keep going.",
          code: "PAYMENT_REQUIRED",
        });
      }
      return next();
    }

    if (workspace.plan === "trial" && workspace.trial_ends_at && new Date(workspace.trial_ends_at) > new Date()) {
      return next();
    }

    return res.status(402).json({
      error: "Your free trial has ended. Upgrade to keep using Klyo.",
      code: "PAYMENT_REQUIRED",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not verify your subscription status." });
  }
}

module.exports = { requirePaidAccess };
