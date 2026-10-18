const db = require('../db');
const Stripe = require('./stripe');
const { TIER_ORDER } = require('../config/tiers');
const fail = (message,status=400) => Object.assign(new Error(message),{status});
async function checkout(workspaceId, tier) {
  if (!TIER_ORDER.includes(tier)) throw fail('Choose a subscription plan.');
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const w = (await c.query('SELECT * FROM workspaces WHERE id=$1 FOR UPDATE',[workspaceId])).rows[0];
    if (!w || !w.onboarding_payment_required || w.stripe_subscription_id) throw fail('This workspace does not need signup checkout.',409);
    const stripe = Stripe.getClient();
    if (!stripe) throw fail('Subscription checkout is temporarily unavailable.',503);
    if (w.checkout_session_id) {
      const previous = await stripe.checkout.sessions.retrieve(w.checkout_session_id);
      if (previous.status === 'complete') {
        await activate(previous,c);await c.query('COMMIT');return {url:(process.env.APP_URL || 'http://localhost:4000')+'/app'};
      }
      if (previous.status === 'open' && w.checkout_tier === tier) {
        await c.query('COMMIT'); return {url:previous.url};
      }
      if (previous.status === 'open') await stripe.checkout.sessions.expire(previous.id);
    }
    const url = process.env.APP_URL || 'http://localhost:4000';
    const session = await Stripe.createCheckoutSession(w, process.env['STRIPE_PRICE_ID_'+tier.toUpperCase()], tier, 'subscription',
      url+'/onboarding?session_id={CHECKOUT_SESSION_ID}',url+'/onboarding?cancelled=1');
    await c.query('UPDATE workspaces SET checkout_session_id=$1,checkout_tier=$2 WHERE id=$3',[session.id,tier,w.id]);
    await c.query('COMMIT'); return {url:session.url};
  } catch(e) {await c.query('ROLLBACK'); throw e;} finally{c.release();}
}
// Called only with a server-retrieved session or a signature-verified webhook object.
async function activate(session, c=db) {
  if (!session || session.status !== 'complete' || session.mode !== 'subscription' || !['paid','no_payment_required'].includes(session.payment_status) || !session.subscription)
    throw fail('Checkout is not complete yet.',409);
  const w = (await c.query('SELECT * FROM workspaces WHERE id=$1 FOR UPDATE',[session.client_reference_id])).rows[0];
  if (!w || w.checkout_session_id !== session.id) throw fail('Checkout does not match this workspace.',403);
  const sub = await Stripe.getSubscription(typeof session.subscription === 'string' ? session.subscription : session.subscription.id);
  const tier = session.metadata?.tier;
  if (!TIER_ORDER.includes(tier) || !['active','trialing'].includes(sub.status) || sub.metadata?.workspace_id !== String(w.id) ||
      !sub.items?.data?.some(i=>i.price.id === process.env['STRIPE_PRICE_ID_'+tier.toUpperCase()]) || sub.pending_update)
    throw fail('Subscription is not ready for this workspace.',409);
  if (w.stripe_subscription_id && w.stripe_subscription_id !== sub.id) throw fail('A subscription already exists.',409);
  await c.query(`UPDATE workspaces SET onboarding_payment_required=false,plan='active',tier=$1,billing_mode='subscription',
    stripe_customer_id=$2,stripe_subscription_id=$3,current_period_end=$4,trial_ends_at=$5,trial_used=true,
    cancel_at_period_end=$6 WHERE id=$7`, [tier,typeof session.customer === 'string'?session.customer:session.customer?.id,
    sub.id,new Date(sub.current_period_end*1000),sub.trial_end?new Date(sub.trial_end*1000):null,Boolean(sub.cancel_at_period_end),w.id]);
  return {ok:true};
}
async function complete(workspaceId, sessionId) {
  if (typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw fail('Invalid checkout session.');
  const stripe = Stripe.getClient();
  if (!stripe) throw fail('Stripe is not configured.',503);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.client_reference_id !== String(workspaceId)) throw fail('Checkout does not belong to this workspace.',403);
  const c = await db.pool.connect();
  try{await c.query('BEGIN'); const r=await activate(session,c);await c.query('COMMIT');return r;}
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
module.exports={checkout,complete,activate};
