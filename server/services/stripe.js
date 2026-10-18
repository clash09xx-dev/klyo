// server/services/stripe.js
// ---------------------------------------------------------
// All Stripe calls live here. Until you add STRIPE_SECRET_KEY
// to .env, these throw clear "not configured yet" errors instead
// of failing in a confusing way.
// ---------------------------------------------------------
const Stripe = require("stripe");

let client = null;
function getClient() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

/**
 * Creates a Stripe Checkout session for a workspace to subscribe to a
 * specific tier. client_reference_id carries the workspace id, and
 * metadata carries which tier + billing mode were purchased — the
 * webhook reads both to know what to activate.
 *
 * @param {"subscription"|"one_time"} billingMode
 */
async function createCheckoutSession(
  workspace,
  priceId,
  tierKey,
  billingMode,
  successUrl,
  cancelUrl,
) {
  const stripe = getClient();
  if (!stripe) {
    throw new Error(
      "Stripe is not configured on the server yet. Add STRIPE_SECRET_KEY to your .env file.",
    );
  }
  if (!priceId) {
    throw new Error(
      `No Stripe price is configured for the "${tierKey}" tier (${billingMode}) yet. Add it to your .env file.`,
    );
  }

  await verifyPlanPrice(priceId, tierKey, billingMode);
  const lineItems = [{ price: priceId, quantity: 1 }];
  return stripe.checkout.sessions.create(
    {
      mode: billingMode === "one_time" ? "payment" : "subscription",
      line_items: lineItems,
      ...(billingMode === "subscription" ? { payment_method_collection: "always" } : {}),
      customer: workspace.stripe_customer_id || undefined,
      client_reference_id: String(workspace.id),
      metadata: {
        tier: tierKey,
        billing_mode: billingMode,
      },
      ...(billingMode === "subscription"
        ? {
            subscription_data: {
              metadata: { workspace_id: String(workspace.id), tier: tierKey },
              ...(workspace.onboarding_payment_required && !workspace.trial_used ? { trial_period_days: 7 } : {}),
            },
          }
        : {}),
      success_url: successUrl,
      cancel_url: cancelUrl,
    },
    {
      idempotencyKey: `klyo-checkout-${workspace.onboarding_payment_required ? (workspace.checkout_session_id || "signup-initial") : "standard"}-${workspace.id}-${tierKey}-${billingMode}-${workspace.current_period_end || "initial"}-${new Date().toISOString().slice(0, 10)}`,
    },
  );
}

/** Fetches a subscription's current period end + cancellation state from Stripe. */
async function getSubscription(subscriptionId) {
  const stripe = getClient();
  if (!stripe) throw new Error("Stripe is not configured.");
  return stripe.subscriptions.retrieve(subscriptionId);
}

/**
 * Cancels (or un-cancels) a subscription. Always at-period-end by
 * default — they already paid for the current period, so access
 * shouldn't be cut off mid-period; it just won't renew.
 */
async function setSubscriptionCancellation(subscriptionId, shouldCancel) {
  const stripe = getClient();
  if (!stripe) throw new Error("Stripe is not configured.");
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: shouldCancel,
  });
}

/**
 * Verifies that a webhook request really came from Stripe, using the
 * raw request body and the signature Stripe sends in the header.
 */
function verifyWebhook(rawBody, signature) {
  const stripe = getClient();
  if (!stripe) throw new Error("Stripe is not configured.");
  if (!process.env.STRIPE_WEBHOOK_SECRET)
    throw new Error("STRIPE_WEBHOOK_SECRET is not set.");
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET,
  );
}

async function verifyPlanPrice(priceId, tier, mode = "subscription") {
  const stripe = getClient();
  if (!stripe) throw new Error("Stripe is not configured.");
  const price = await stripe.prices.retrieve(priceId);
  if (
    price.currency !== "usd" ||
    price.unit_amount !==
      require("../config/tiers").getTier(tier).price * 100 ||
    (mode === "subscription" &&
      (price.recurring?.interval !== "month" ||
        price.recurring?.interval_count !== 1)) ||
    (mode === "one_time" && price.recurring)
  )
    throw new Error(
      "The configured Stripe price does not match the published plan. Contact the workspace provider.",
    );
}
async function changePlan(workspace, priceId, tier) {
  const stripe = getClient();
  if (!stripe) throw new Error("Stripe is not configured.");
  await verifyPlanPrice(priceId, tier);
  const sub = await stripe.subscriptions.retrieve(
    workspace.stripe_subscription_id,
  );
  if (sub.pending_update)
    throw Object.assign(new Error("Complete the pending payment first."), {
      status: 409,
    });
  const base = sub.items.data.find(
      (i) => i.price?.metadata?.klyo_extra_seat !== "1",
    ),
    legacySeats = sub.items.data.filter(
      (i) => i.price?.metadata?.klyo_extra_seat === "1",
    );
  if (!base) throw new Error("Base plan not found.");
  if (base.price.id === priceId && !legacySeats.length)
    return { sub, url: null };
  const items = [{ id: base.id, price: priceId, quantity: 1 }];
  // Remove retired add-ons when changing an existing subscription.
  items.push(...legacySeats.map((item) => ({ id: item.id, deleted: true })));
  const updated = await stripe.subscriptions.update(
    sub.id,
    {
      items,
      payment_behavior: "pending_if_incomplete",
      proration_behavior: "always_invoice",
      expand: ["latest_invoice"],
    },
    {
      idempotencyKey: `klyo-plan-${workspace.id}-${priceId}-${require("crypto").randomUUID()}`,
    },
  );
  return {
    sub: updated,
    url: updated.pending_update
      ? updated.latest_invoice?.hosted_invoice_url || null
      : null,
  };
}
module.exports = {
  verifyPlanPrice,
  changePlan,
  getClient,
  createCheckoutSession,
  getSubscription,
  setSubscriptionCancellation,
  verifyWebhook,
};
