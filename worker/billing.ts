import Stripe from 'stripe';
import { z } from 'zod';
import { addMonths, monthlyCreditStatement, PLAN_CREDITS, type Plan } from './credits';
import { ApiError } from './errors';
import type { Env, UserRow } from './types';

export interface SubscriptionSnapshot {
  id: string; userId: string; customerId: string; plan: Plan; interval: 'month'|'year'; status: string;
  periodStart: number; periodEnd: number; hasPaymentMethod: boolean;
}
interface InvoiceSnapshot { id: string; plan: Plan; interval: 'month' | 'year'; amountPaid: number; periodStart: number; periodEnd: number; billingReason: string }
const pricesSchema = z.object({ starter: z.object({ month: z.string().startsWith('price_'), year: z.string().startsWith('price_') }), pro: z.object({ month: z.string().startsWith('price_'), year: z.string().startsWith('price_') }), max: z.object({ month: z.string().startsWith('price_'), year: z.string().startsWith('price_') }) });
export function configuredPrices(env: Env) {
  try { return pricesSchema.parse(JSON.parse(env.STRIPE_PRICES ?? '{}')); } catch { return null; }
}
function pricePlan(env: Env, priceId: string | undefined) {
  const prices = configuredPrices(env);
  if (!prices || !priceId) return null;
  for (const plan of Object.keys(PLAN_CREDITS) as Plan[]) {
    for (const interval of ['month', 'year'] as const) {
      if (prices[plan][interval] === priceId) return { plan, interval };
    }
  }
  return null;
}
export const billingEnabled = (env: Env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && configuredPrices(env));
function stripeClient(env: Env) {
  if (!billingEnabled(env)) throw new ApiError(503, 'Billing is being configured. Please try again later.', 'BILLING_UNAVAILABLE');
  return new Stripe(env.STRIPE_SECRET_KEY!, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20_000 });
}
const objectId = (value: string | { id: string } | null | undefined) => typeof value === 'string' ? value : value?.id;

export async function verifyStripeEvent(raw: string, signature: string, secret: string) {
  const stripe = new Stripe('sk_test_signature_verification', { httpClient: Stripe.createFetchHttpClient() });
  return stripe.webhooks.constructEventAsync(raw, signature, secret, 300, Stripe.createSubtleCryptoProvider());
}

/** Receives the canonical subscription fetched from Stripe, never client input.
 * Event recording and all related credit grants commit in a single transaction. */
export async function applySubscriptionEvent(db: D1Database, eventId: string, eventType: string, subscription: SubscriptionSnapshot, invoice?: InvoiceSnapshot, eventCreated = 0) {
  if (await db.prepare('SELECT id FROM stripe_events WHERE id=?').bind(eventId).first()) return;
  const user = await db.prepare('SELECT * FROM users WHERE id=?').bind(subscription.userId).first<UserRow>();
  if (!user) throw new Error('Stripe subscription references an unknown user');
  if (user.stripe_customer_id && user.stripe_customer_id !== subscription.customerId) throw new Error('Stripe customer does not match this user');
  // A delayed deletion of an old subscription must not overwrite a newer one.
  if (user.subscription_id && user.subscription_id !== subscription.id && (['active', 'trialing', 'past_due', 'unpaid'].includes(user.subscription_status) || subscription.status === 'canceled')) {
    await db.prepare('INSERT INTO stripe_events (id,type,processed_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind(eventId, eventType, new Date().toISOString()).run();
    return;
  }
  const now = new Date().toISOString();
  const statements = [
    db.prepare('INSERT INTO stripe_events (id,type,processed_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind(eventId, eventType, now),
    db.prepare(`UPDATE users SET stripe_customer_id=?,subscription_id=?,subscription_status=?,subscription_interval=?,plan=?,period_start=?,period_end=?,billing_event_created=?
      WHERE id=? AND billing_event_created<=?`)
      .bind(subscription.customerId, subscription.id, subscription.status, subscription.interval, subscription.plan, subscription.periodStart, subscription.periodEnd, eventCreated, user.id, eventCreated),
  ];
  if (subscription.status === 'trialing' && subscription.hasPaymentMethod && subscription.interval === 'month') {
    statements.push(db.prepare(`INSERT INTO credit_ledger (id,user_id,amount,reason,external_key,created_at)
      SELECT ?,id,300,'Three-day trial credits',?,? FROM users WHERE id=? AND trial_used=0
      ON CONFLICT(external_key) DO NOTHING`).bind(crypto.randomUUID(), `trial:${user.id}`, now, user.id));
    statements.push(db.prepare('UPDATE users SET trial_used=1 WHERE id=?').bind(user.id));
  }
  const eligibleInvoice = eventType === 'invoice.paid' && invoice && invoice.amountPaid > 0 && subscription.status === 'active'
    && ['subscription_create', 'subscription_cycle', 'subscription_update'].includes(invoice.billingReason)
    && invoice.periodStart === subscription.periodStart && invoice.periodEnd > invoice.periodStart;
  if (eligibleInvoice && invoice) {
    // The invoice is the paid entitlement. The live subscription may already
    // have changed plans by the time a delayed webhook arrives.
    const allowance = PLAN_CREDITS[invoice.plan];
    statements.push(monthlyCreditStatement(db, user.id, allowance, `${subscription.id}:${invoice.periodStart}`));
    statements.push(db.prepare(`UPDATE users SET trial_used=1,monthly_credits=?,paid_period_start=?,paid_period_end=?,refill_index=1,next_refill_at=?
      WHERE id=? AND (paid_period_start IS NULL OR paid_period_start<?)`)
      .bind(allowance, invoice.periodStart, invoice.periodEnd, invoice.interval === 'year' ? addMonths(invoice.periodStart, 1) : null, user.id, invoice.periodStart));
  }
  await db.batch(statements);
}

export async function applyAnnualRefills(db: D1Database, userId: string, now = Math.floor(Date.now() / 1000)) {
  // A missed cron catches up at most the eleven remaining grants in a paid year.
  for (let count = 0; count < 11; count++) {
    const user = await db.prepare('SELECT * FROM users WHERE id=?').bind(userId).first<UserRow>();
    if (!user || user.subscription_interval !== 'year' || user.subscription_status !== 'active' || !user.subscription_id
      || !user.paid_period_start || !user.paid_period_end || !user.next_refill_at
      || user.next_refill_at > now || user.next_refill_at >= user.paid_period_end || user.refill_index >= 12) return;
    const index = user.refill_index; const period = user.next_refill_at;
    const next = addMonths(user.paid_period_start, index + 1);
    await db.batch([
      // Guard against a concurrent webhook cancel/renewal between SELECT and batch.
      db.prepare(`INSERT INTO credit_ledger (id,user_id,amount,reason,external_key,created_at)
        SELECT ?,id,MAX(0,MIN(monthly_credits,monthly_credits*2-credits)),'Monthly subscription credits',?,?
        FROM users WHERE id=? AND subscription_status='active' AND subscription_interval='year' AND subscription_id=? AND next_refill_at=? AND paid_period_end>?
        ON CONFLICT(external_key) DO NOTHING`)
        .bind(crypto.randomUUID(), `grant:${user.subscription_id}:${period}`, new Date().toISOString(), user.id, user.subscription_id, period, period),
      db.prepare("UPDATE users SET refill_index=?,next_refill_at=? WHERE id=? AND subscription_status='active' AND subscription_id=? AND next_refill_at=?")
        .bind(index + 1, next < user.paid_period_end ? next : null, user.id, user.subscription_id, period),
    ]);
  }
}

async function subscriptionSnapshot(env: Env, stripe: Stripe, subscription: Stripe.Subscription): Promise<SubscriptionSnapshot | null> {
  const item = subscription.items.data[0];
  if (!item) return null;
  const matched = pricePlan(env, item.price.id);
  if (!matched || subscription.items.data.length !== 1) return null;
  const customerId = objectId(subscription.customer);
  if (!customerId) return null;
  const known = await env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id=?').bind(customerId).first<{ id: string }>();
  const userId = subscription.metadata.userId ?? known?.id;
  if (!userId) return null;
  let hasPaymentMethod = !!subscription.default_payment_method;
  if (subscription.status === 'trialing' && !hasPaymentMethod) {
    const customer = await stripe.customers.retrieve(customerId);
    hasPaymentMethod = !customer.deleted && !!customer.invoice_settings.default_payment_method;
  }
  return { id: subscription.id, userId, customerId, ...matched, status: subscription.status, periodStart: item.current_period_start, periodEnd: item.current_period_end, hasPaymentMethod };
}

export async function processStripeEvent(env: Env, event: Stripe.Event) {
  if (await env.DB.prepare('SELECT id FROM stripe_events WHERE id=?').bind(event.id).first()) return;
  const stripe = stripeClient(env);
  let subscriptionId: string | undefined; let invoice: Stripe.Invoice | undefined;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode === 'subscription' && session.status === 'complete') subscriptionId = objectId(session.subscription);
  } else if (event.type.startsWith('customer.subscription.')) {
    subscriptionId = (event.data.object as Stripe.Subscription).id;
  } else if (['invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required'].includes(event.type)) {
    invoice = event.data.object as Stripe.Invoice;
    subscriptionId = objectId(invoice.parent?.subscription_details?.subscription);
  }
  if (!subscriptionId) {
    await env.DB.prepare('INSERT INTO stripe_events (id,type,processed_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind(event.id, event.type, new Date().toISOString()).run(); return;
  }
  // Fetch current state: Stripe can deliver lifecycle events out of order.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const snapshot = await subscriptionSnapshot(env, stripe, subscription);
  if (!snapshot) {
    await env.DB.prepare('INSERT INTO stripe_events (id,type,processed_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind(event.id, event.type, new Date().toISOString()).run(); return;
  }
  let invoiceSnapshot: InvoiceSnapshot | undefined;
  if (invoice && event.type === 'invoice.paid') {
    // Prefer the actual non-proration subscription line's period.
    const line = invoice.lines.data.find(line => line.parent?.type === 'subscription_item_details'
      && line.parent.subscription_item_details?.subscription === subscriptionId && !line.parent.subscription_item_details.proration);
    const paidPrice = pricePlan(env, line ? objectId(line.pricing?.price_details?.price) : undefined);
    if (line && paidPrice) invoiceSnapshot = { id: invoice.id, ...paidPrice, amountPaid: invoice.amount_paid, billingReason: invoice.billing_reason ?? '', periodStart: line.period.start, periodEnd: line.period.end };
  }
  await applySubscriptionEvent(env.DB, event.id, event.type, snapshot, invoiceSnapshot, event.created);
}

export async function createCheckout(env: Env, user: UserRow, plan: Plan, interval: 'month' | 'year') {
  const stripe = stripeClient(env); const prices = configuredPrices(env)!; const now = Math.floor(Date.now() / 1000);
  if (['active', 'trialing', 'past_due', 'unpaid'].includes(user.subscription_status)) throw new ApiError(409, 'Manage your existing subscription in the billing portal.', 'SUBSCRIPTION_EXISTS');
  // Serialize Checkout creation per user; an existing open session is reused.
  const leaseUntil = now + 300;
  const lease = await env.DB.prepare('UPDATE users SET checkout_lease=? WHERE id=? AND checkout_lease<? RETURNING id').bind(leaseUntil, user.id, now).first();
  if (!lease) throw new ApiError(409, 'A checkout is already being prepared. Please try again shortly.');
  try {
    user = (await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first<UserRow>())!;
    if (user.checkout_session_id && (user.checkout_expires_at ?? 0) > now) {
      const existing = await stripe.checkout.sessions.retrieve(user.checkout_session_id);
      if (existing.status === 'open' && existing.url) {
        if (user.checkout_plan === plan && user.checkout_interval === interval) return { url: existing.url };
        await stripe.checkout.sessions.expire(existing.id);
      } else if (existing.status === 'complete') throw new ApiError(409, 'Your payment is processing. Refresh your account in a moment.');
    }
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } }, { idempotencyKey: `cmv-customer:${user.id}` });
      customerId = customer.id;
      await env.DB.prepare('UPDATE users SET stripe_customer_id=? WHERE id=? AND stripe_customer_id IS NULL').bind(customerId, user.id).run();
    }
    const active = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    if (active.has_more || active.data.some(item => ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'].includes(item.status))) throw new ApiError(409, 'Manage your existing billing history in the billing portal.', 'SUBSCRIPTION_EXISTS');
    const firstMonthlyTrial = !user.trial_used && active.data.length === 0 && interval === 'month';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', customer: customerId, client_reference_id: user.id,
      line_items: [{ price: prices[plan][interval], quantity: 1 }], payment_method_collection: 'always', allowed_payment_method_types: ['card'],
      subscription_data: { metadata: { userId: user.id, plan, interval }, ...(firstMonthlyTrial ? { trial_period_days: 3, trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } } } : {}) },
      metadata: { userId: user.id }, success_url: `${env.APP_URL}/studio?billing=success`, cancel_url: `${env.APP_URL}/pricing?billing=canceled`,
      expires_at: now + 1800,
    }, { idempotencyKey: `cmv-checkout:${user.id}:${plan}:${interval}:${user.checkout_session_id ?? 'first'}:${Math.floor(now / 1800)}` });
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    await env.DB.prepare('UPDATE users SET checkout_session_id=?,checkout_expires_at=?,checkout_plan=?,checkout_interval=? WHERE id=?').bind(session.id, session.expires_at, plan, interval, user.id).run();
    return { url: session.url };
  } finally { await env.DB.prepare('UPDATE users SET checkout_lease=0 WHERE id=? AND checkout_lease=?').bind(user.id, leaseUntil).run(); }
}
export async function createBillingPortal(env: Env, user: UserRow) {
  const stripe = stripeClient(env);
  if (!user.stripe_customer_id) throw new ApiError(400, 'Choose a plan before opening the billing portal.');
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${env.APP_URL}/studio`,
    ...(env.STRIPE_PORTAL_CONFIGURATION ? { configuration: env.STRIPE_PORTAL_CONFIGURATION } : {}),
  });
  return { url: session.url };
}

export async function refillAnnualSubscribers(env: Env) {
  const now = Math.floor(Date.now() / 1000);
  const due = await env.DB.prepare("SELECT * FROM users WHERE subscription_interval='year' AND subscription_status='active' AND next_refill_at<=? ORDER BY next_refill_at LIMIT 100").bind(now).all<UserRow>();
  for (const user of due.results) {
    try {
      // Reconcile against Stripe before an annual grant; missed cancellation
      // webhooks must not issue credits for an inactive subscription.
      const stripe = stripeClient(env);
      const live = await stripe.subscriptions.retrieve(user.subscription_id!);
      const snapshot = await subscriptionSnapshot(env, stripe, live);
      if (!snapshot) continue;
      await applySubscriptionEvent(env.DB, `sync:${live.id}:${now}`, 'scheduled.sync', snapshot, undefined, now);
      await applyAnnualRefills(env.DB, user.id, now);
    } catch (error) { console.error('Annual credit sync failed', { userId: user.id, type: error instanceof Error ? error.name : 'Unknown' }); }
  }
}
