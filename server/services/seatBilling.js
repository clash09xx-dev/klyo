const db = require("../db"),
  { getTier } = require("../config/tiers"),
  { invalid } = require("./dealWorkspace"),
  { isCurrentlyComped } = require("./limits");
const EXTRA_SEAT_USD = 5;
function quantity(value) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 1000)
    throw invalid("Choose 0–1000 additional seats.");
  return n;
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
    extra: quantity(w.extra_seats),
    unit_price: EXTRA_SEAT_USD,
    currency: "USD",
    base_price: tier.price,
    total_monthly: isCurrentlyComped(w)
      ? 0
      : tier.price + quantity(w.extra_seats) * EXTRA_SEAT_USD,
    unlimited:
      tier.maxSeats == null || isCurrentlyComped(w) || w.plan === "trial",
  };
}
function subscriptionSeats(sub) {
  if (sub.pending_update || !["active", "trialing"].includes(sub.status))
    return null;
  const item = sub.items?.data?.find(
    (i) => i.price?.metadata?.klyo_extra_seat === "1",
  );
  return quantity(item?.quantity || 0);
}
async function applySubscription(sub, client = db) {
  const extra = subscriptionSeats(sub);
  if (extra === null) return;
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
    "UPDATE workspaces SET extra_seats=$1 WHERE stripe_subscription_id=$2",
    [extra, sub.id],
  );
}
module.exports = {
  EXTRA_SEAT_USD,
  quantity,
  summary,
  subscriptionSeats,
  applySubscription,
};
