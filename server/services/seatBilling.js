const db = require("../db"),
  { getTier } = require("../config/tiers"),
  { invalid } = require("./dealWorkspace"),
  { isCurrentlyComped } = require("./limits");
// Retired add-on input is rejected even when sent by an older browser.
function assertPlanOnly(value) {
  if (value != null && Number(value) !== 0)
    throw invalid(
      "Additional user purchases are no longer available. Upgrade to a higher plan to add more users.",
    );
}
async function summary(wid, client = db) {
  const w = (await client.query("SELECT * FROM workspaces WHERE id=$1", [wid]))
    .rows[0];
  if (!w) throw invalid("Workspace not found.", 404);
  const tier = getTier(w.tier),
    used = (
      await client.query(
        "SELECT COUNT(*)::int AS n FROM users WHERE workspace_id=$1",
        [wid],
      )
    ).rows[0].n;
  return {
    workspace: w,
    used,
    included: tier.maxSeats,
    currency: "USD",
    base_price: tier.price,
    total_monthly: isCurrentlyComped(w) ? 0 : tier.price,
    limit_reached:
      tier.maxSeats != null &&
      !isCurrentlyComped(w) &&
      w.plan === "active" &&
      Number(used) >= tier.maxSeats,
    unlimited:
      tier.maxSeats == null || isCurrentlyComped(w) || w.plan === "trial",
  };
}
async function applySubscription(sub, client = db) {
  if (sub.pending_update || !["active", "trialing"].includes(sub.status))
    return;
  const tier = Object.keys(require("../config/tiers").TIERS).find((key) =>
    sub.items?.data?.some(
      (i) => i.price.id === process.env["STRIPE_PRICE_ID_" + key.toUpperCase()],
    ),
  );
  if (tier)
    await client.query(
      "UPDATE workspaces SET tier=$1 WHERE stripe_subscription_id=$2",
      [tier, sub.id],
    );
  await client.query(
    "UPDATE workspaces SET extra_seats=0 WHERE stripe_subscription_id=$1",
    [sub.id],
  );
}
module.exports = { assertPlanOnly, summary, applySubscription };
