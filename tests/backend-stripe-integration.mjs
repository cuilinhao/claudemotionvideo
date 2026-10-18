// Explicit, opt-in local integration acceptance. Never reads production secrets.
// Run: STRIPE_TEST_INTEGRATION=1 node tests/backend-stripe-integration.mjs
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import Stripe from 'stripe';

if (process.env.STRIPE_TEST_INTEGRATION !== '1') throw new Error('Explicit test-mode opt-in required');
const key = readFileSync('.secrets/stripe-test-key', 'utf8').trim();
assert(key.startsWith('sk_test_'), 'Only a test API key is allowed');
const prices = JSON.parse(readFileSync('.secrets/stripe-test-prices.json', 'utf8'));
let qa = JSON.parse(readFileSync('.secrets/local-qa.json', 'utf8'));
// Read exactly the authorized setting; no other .dev.vars value is inspected.
const webhookLine = readFileSync('.dev.vars', 'utf8').split(/\r?\n/).find(line => /^STRIPE_WEBHOOK_SECRET\s*=/.test(line));
const webhookSecret = webhookLine?.slice(webhookLine.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
assert(webhookSecret?.startsWith('whsec_'), 'Local webhook signing secret required');
const stripe = new Stripe(key, { maxNetworkRetries: 1, timeout: 20_000 });
const origin = 'http://127.0.0.1:5173';
const backend = 'http://127.0.0.1:8787';
const report = (stage, data) => console.log(JSON.stringify({ stage, ...data }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function api(path, method = 'GET', body) {
  const response = await fetch(backend + path, { method, headers: { Origin: origin, Cookie: qa.cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  let data;
  try { data = await response.json(); }
  catch { throw Object.assign(new Error('Local API returned non-JSON'), { code: 'INVALID_JSON_RESPONSE', statusCode: response.status, stage: path }); }
  if (!response.ok) throw Object.assign(new Error('Local API request failed'), { code: data.code ?? 'LOCAL_API_FAILURE', statusCode: response.status, stage: path });
  return data;
}
function eventFor(type, object) {
  assert.equal(object.livemode, false, 'Refuse live Stripe objects');
  return { id: `evt_cmvqa_${randomUUID().replaceAll('-', '')}`, object: 'event', type, api_version: '2026-09-30.endive', created: Math.floor(Date.now() / 1000), livemode: false, data: { object }, pending_webhooks: 1, request: null };
}
async function deliver(event) {
  const body = JSON.stringify(event); const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', webhookSecret).update(`${timestamp}.${body}`).digest('hex');
  const response = await fetch(`${backend}/api/billing/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${signature}` }, body, signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, 200, `Signed local webhook ${event.type} failed with status ${response.status}`);
  assert.equal((await response.json()).received, true);
}

let subscription; let checkout; let customerId;
try {
  if (process.env.STRIPE_QA_FRESH === '1') {
    const credentials = { email: `cmv-stripe-qa-${randomUUID()}@example.com`, password: `QA-${randomUUID()}-Aa1` };
    const registration = await fetch(`${backend}/api/auth/register`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
    assert.equal(registration.status, 201);
    const registered = await registration.json();
    qa = { ...credentials, userId: registered.user.id, cookie: registration.headers.get('set-cookie').split(';')[0] };
  }
  const initial = await api('/api/me');
  assert.equal(initial.user.id, qa.userId); assert.equal(initial.user.credits, 0); assert.equal(initial.billingEnabled, true);
  report('local-account', { userId: initial.user.id, credits: initial.user.credits, billingEnabled: true });
  const checkoutResponse = await api('/api/billing/checkout', 'POST', { plan: 'starter', interval: 'month' });
  assert.equal(new URL(checkoutResponse.url).hostname, 'checkout.stripe.com');
  // The opaque session URL stays in memory. Locate the session by our known user.
  const customers = await stripe.customers.list({ email: qa.email, limit: 10 });
  const customer = customers.data.find(customer => customer.metadata.userId === qa.userId);
  assert(customer); assert.equal(customer.livemode, false); customerId = customer.id;
  const sessions = await stripe.checkout.sessions.list({ customer: customerId, limit: 10 });
  checkout = sessions.data.find(session => session.url === checkoutResponse.url);
  assert(checkout); assert.equal(checkout.livemode, false); assert.equal(checkout.mode, 'subscription');
  assert.equal(checkout.payment_method_collection, 'always');
  assert.equal(checkout.amount_total, 0, 'First monthly Checkout must start with a free trial');
  const items = await stripe.checkout.sessions.listLineItems(checkout.id);
  assert.equal(items.data[0].price.id, prices.starter.month); assert.equal(items.data[0].quantity, 1);
  assert.deepEqual(checkout.allowed_payment_method_types ?? checkout.payment_method_types, ['card']);
  report('checkout', { sessionId: checkout.id, customerId, priceId: items.data[0].price.id, cardRequired: true, quantity: 1, livemode: checkout.livemode });

  const paymentMethod = await stripe.paymentMethods.attach('pm_card_visa', { customer: customerId });
  assert.equal(paymentMethod.livemode, false);
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethod.id } });
  subscription = await stripe.subscriptions.create({ customer: customerId, items: [{ price: prices.starter.month }], default_payment_method: paymentMethod.id, trial_period_days: 3, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } }, metadata: { userId: qa.userId, plan: 'starter', interval: 'month' } }, { idempotencyKey: `cmv-qa-trial:${qa.userId}` });
  assert.equal(subscription.livemode, false); assert.equal(subscription.status, 'trialing');
  assert.equal(subscription.trial_end - subscription.trial_start, 3 * 86400);
  const trialEvent = eventFor('customer.subscription.created', subscription);
  await deliver(trialEvent); await deliver(trialEvent); await deliver(eventFor('customer.subscription.updated', subscription));
  let account = await api('/api/me'); assert.equal(account.user.credits, 300); assert.equal(account.user.subscriptionStatus, 'trialing');
  report('trial', { subscriptionId: subscription.id, eventId: trialEvent.id, credits: account.user.credits, duplicateSafe: true, days: 3, livemode: false });

  subscription = await stripe.subscriptions.update(subscription.id, { trial_end: 'now', proration_behavior: 'none', expand: ['latest_invoice'] });
  let invoice = typeof subscription.latest_invoice === 'string' ? await stripe.invoices.retrieve(subscription.latest_invoice) : subscription.latest_invoice;
  assert(invoice); assert.equal(invoice.livemode, false);
  for (let attempt = 0; invoice.status !== 'paid' && attempt < 15; attempt++) {
    if (invoice.status === 'open' && attempt === 2) {
      try { invoice = await stripe.invoices.pay(invoice.id); } catch (error) { if (error.code !== 'invoice_already_paid') throw error; }
    }
    await pause(1000); invoice = await stripe.invoices.retrieve(invoice.id);
  }
  assert.equal(invoice.status, 'paid'); assert.equal(invoice.amount_paid, 1990);
  const invoiceEvent = eventFor('invoice.paid', invoice);
  await deliver(invoiceEvent); await deliver(invoiceEvent); await deliver(eventFor('invoice.paid', invoice));
  account = await api('/api/me'); assert.equal(account.user.credits, 1800); assert.equal(account.user.subscriptionStatus, 'active');
  const credits = await api('/api/credits');
  assert.equal(credits.ledger.filter(entry => entry.reason === 'Monthly subscription credits').length, 1);
  assert.equal(credits.ledger.filter(entry => entry.reason === 'Three-day trial credits').length, 1);
  report('invoice', { invoiceId: invoice.id, eventId: invoiceEvent.id, amountPaid: invoice.amount_paid, currency: invoice.currency, credits: account.user.credits, duplicateSafe: true, paidLedgerRows: 1, livemode: false });

  const portal = await api('/api/billing/portal', 'POST');
  assert.equal(new URL(portal.url).hostname, 'billing.stripe.com');
  report('portal', { created: true, origin: new URL(portal.url).origin });
  report('result', { passed: true });
} catch (error) {
  // Stripe errors may carry request headers and secret-bearing URLs; never log them.
  report('failure', { name: error.name, type: error.type ?? null, code: error.code ?? null, statusCode: error.statusCode ?? null, stage: error.stage ?? null, assertion: error.name === 'AssertionError' ? error.message : undefined });
  process.exitCode = 1;
} finally {
  if (subscription?.id) {
    try {
      const canceled = await stripe.subscriptions.cancel(subscription.id);
      assert.equal(canceled.livemode, false);
      await deliver(eventFor('customer.subscription.deleted', canceled));
      report('cleanup-subscription', { subscriptionId: subscription.id, status: canceled.status, livemode: false });
    } catch (error) { report('cleanup-failure', { object: 'subscription', id: subscription.id, code: error.code ?? error.name }); process.exitCode = 1; }
  }
  if (checkout?.status === 'open') {
    try { await stripe.checkout.sessions.expire(checkout.id); report('cleanup-checkout', { sessionId: checkout.id, expired: true }); }
    catch (error) { report('cleanup-failure', { object: 'checkout', id: checkout.id, code: error.code ?? error.name }); process.exitCode = 1; }
  }
}
