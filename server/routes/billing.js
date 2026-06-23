// server/routes/billing.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const {
  createCheckoutSession,
  getSubscription,
  setSubscriptionCancellation,
  verifyWebhook,
} = require("../services/stripe");
const { TIERS, TIER_ORDER } = require("../config/tiers");
const { isCurrentlyComped } = require("../services/limits");

// Two Stripe Prices per tier: one recurring monthly, one one-time
// (same dollar amount, no auto-renewal). Both are optional per tier —
// if a price isn't set, that option just isn't offered for that tier.
const PRICE_ENV_KEYS = {
  personal: { subscription: "STRIPE_PRICE_ID_PERSONAL", one_time: "STRIPE_PRICE_ID_PERSONAL_ONETIME" },
  plus: { subscription: "STRIPE_PRICE_ID_PLUS", one_time: "STRIPE_PRICE_ID_PLUS_ONETIME" },
  pro: { subscription: "STRIPE_PRICE_ID_PRO", one_time: "STRIPE_PRICE_ID_PRO_ONETIME" },
  ultra: { subscription: "STRIPE_PRICE_ID_ULTRA", one_time: "STRIPE_PRICE_ID_ULTRA_ONETIME" },
};

const router = express.Router();

// GET /api/billing/tiers — the pricing menu the frontend renders
router.get("/tiers", requireAuth, (req, res) => {
  const tiers = TIER_ORDER.map((key) => ({ key, ...TIERS[key] }));
  res.json({ tiers });
});

// GET /api/billing/status — drives the trial banner, the Settings plan
// section, and whether to show Cancel vs Resume vs nothing.
router.get("/status", requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT plan, tier, is_comped, comped_until, trial_ends_at, current_period_end, cancel_at_period_end,
            billing_mode, stripe_subscription_id IS NOT NULL AS has_subscription
     FROM workspaces WHERE id = $1`,
    [req.user.workspace_id]
  );
  const workspace = result.rows[0];
  if (!workspace) return res.status(404).json({ error: "Workspace not found." });

  const comped = isCurrentlyComped(workspace);
  const trialActive =
    workspace.plan === "trial" && workspace.trial_ends_at && new Date(workspace.trial_ends_at) > new Date();
  const active = comped || workspace.plan === "active" || trialActive;

  res.json({
    plan: workspace.plan,
    tier: workspace.tier,
    is_comped: comped,
    comped_until: workspace.comped_until,
    trial_ends_at: workspace.trial_ends_at,
    current_period_end: workspace.current_period_end,
    cancel_at_period_end: workspace.cancel_at_period_end,
    billing_mode: workspace.billing_mode,
    has_subscription: workspace.has_subscription,
    active,
  });
});

// POST /api/billing/checkout — admin picks a tier + billing mode in the
// pricing modal, this returns a Stripe-hosted checkout URL to redirect to.
router.post("/checkout", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the workspace admin can manage billing." });
  }

  const { tier, billing_mode } = req.body || {};
  if (!TIER_ORDER.includes(tier)) {
    return res.status(400).json({ error: "Choose a valid plan to upgrade to." });
  }
  const billingMode = billing_mode === "one_time" ? "one_time" : "subscription";

  const result = await db.query("SELECT * FROM workspaces WHERE id = $1", [req.user.workspace_id]);
  const workspace = result.rows[0];
  if (!workspace) return res.status(404).json({ error: "Workspace not found." });

  const appUrl = process.env.APP_URL || "http://localhost:4000";
  const priceId = process.env[PRICE_ENV_KEYS[tier][billingMode]];

  try {
    const session = await createCheckoutSession(
      workspace,
      priceId,
      tier,
      billingMode,
      `${appUrl}/index.html?upgraded=1`,
      `${appUrl}/index.html`
    );
    res.json({ url: session.url });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/billing/cancel — graceful cancel: stays active until the
// period they already paid for runs out, then just doesn't renew.
router.post("/cancel", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the workspace admin can manage billing." });
  }
  const result = await db.query("SELECT stripe_subscription_id FROM workspaces WHERE id = $1", [
    req.user.workspace_id,
  ]);
  const subscriptionId = result.rows[0]?.stripe_subscription_id;
  if (!subscriptionId) {
    return res.status(400).json({ error: "There's no active subscription to cancel — a one-time purchase just expires on its own, nothing to turn off." });
  }

  try {
    const subscription = await setSubscriptionCancellation(subscriptionId, true);
    await db.query("UPDATE workspaces SET cancel_at_period_end = TRUE, current_period_end = $1 WHERE id = $2", [
      new Date(subscription.current_period_end * 1000),
      req.user.workspace_id,
    ]);
    res.json({ ok: true, current_period_end: new Date(subscription.current_period_end * 1000) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/billing/resume — undo a pending cancellation before it takes effect
router.post("/resume", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the workspace admin can manage billing." });
  }
  const result = await db.query("SELECT stripe_subscription_id FROM workspaces WHERE id = $1", [
    req.user.workspace_id,
  ]);
  const subscriptionId = result.rows[0]?.stripe_subscription_id;
  if (!subscriptionId) return res.status(400).json({ error: "No subscription to resume." });

  try {
    await setSubscriptionCancellation(subscriptionId, false);
    await db.query("UPDATE workspaces SET cancel_at_period_end = FALSE WHERE id = $1", [req.user.workspace_id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/billing/webhook — called directly by Stripe's servers, never
// by the browser. server/index.js mounts this with a raw body parser
// (not JSON) because Stripe's signature check needs the exact raw bytes.
router.post("/webhook", async (req, res) => {
  const signature = req.headers["stripe-signature"];
  let event;
  try {
    event = verifyWebhook(req.body, signature);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const purchasedTier = session.metadata?.tier && TIER_ORDER.includes(session.metadata.tier) ? session.metadata.tier : "personal";
      const billingMode = session.metadata?.billing_mode === "one_time" ? "one_time" : "subscription";

      if (billingMode === "subscription" && session.subscription) {
        const subscription = await getSubscription(session.subscription);
        await db.query(
          `UPDATE workspaces SET plan = 'active', tier = $1, billing_mode = 'subscription',
             stripe_customer_id = $2, stripe_subscription_id = $3, current_period_end = $4, cancel_at_period_end = FALSE
           WHERE id = $5`,
          [purchasedTier, session.customer, session.subscription, new Date(subscription.current_period_end * 1000), session.client_reference_id]
        );
      } else {
        // One-time purchase — exactly 30 days of access, no Stripe-managed renewal.
        const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await db.query(
          `UPDATE workspaces SET plan = 'active', tier = $1, billing_mode = 'one_time',
             stripe_customer_id = $2, stripe_subscription_id = NULL, current_period_end = $3, cancel_at_period_end = FALSE
           WHERE id = $4`,
          [purchasedTier, session.customer, periodEnd, session.client_reference_id]
        );
      }
    }

    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object;
      const newPlan = ["active", "trialing"].includes(subscription.status) ? "active" : "past_due";
      await db.query(
        "UPDATE workspaces SET plan = $1, current_period_end = $2, cancel_at_period_end = $3 WHERE stripe_subscription_id = $4",
        [newPlan, new Date(subscription.current_period_end * 1000), subscription.cancel_at_period_end, subscription.id]
      );
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      await db.query("UPDATE workspaces SET plan = 'past_due', cancel_at_period_end = FALSE WHERE stripe_subscription_id = $1", [
        subscription.id,
      ]);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handling error:", err);
    res.status(500).json({ error: "Webhook handler failed." });
  }
});

module.exports = router;
