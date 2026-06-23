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
async function createCheckoutSession(workspace, priceId, tierKey, billingMode, successUrl, cancelUrl) {
  const stripe = getClient();
  if (!stripe) {
    throw new Error("Stripe is not configured on the server yet. Add STRIPE_SECRET_KEY to your .env file.");
  }
  if (!priceId) {
    throw new Error(`No Stripe price is configured for the "${tierKey}" tier (${billingMode}) yet. Add it to your .env file.`);
  }

  return stripe.checkout.sessions.create({
    mode: billingMode === "one_time" ? "payment" : "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: workspace.stripe_customer_id || undefined,
    client_reference_id: String(workspace.id),
    metadata: { tier: tierKey, billing_mode: billingMode },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
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
  return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: shouldCancel });
}

/**
 * Verifies that a webhook request really came from Stripe, using the
 * raw request body and the signature Stripe sends in the header.
 */
function verifyWebhook(rawBody, signature) {
  const stripe = getClient();
  if (!stripe) throw new Error("Stripe is not configured.");
  if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is not set.");
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

module.exports = { getClient, createCheckoutSession, getSubscription, setSubscriptionCancellation, verifyWebhook };
