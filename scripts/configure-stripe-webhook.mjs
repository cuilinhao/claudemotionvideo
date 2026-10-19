import fs from 'node:fs';
import Stripe from 'stripe';

const mode = process.argv[2] ?? 'test';
if (!['test', 'live'].includes(mode)) throw new Error('Use test or live');
const key = fs.readFileSync(`.secrets/stripe-${mode}-key`, 'utf8').trim();
if (!new RegExp(`^(sk|rk)_${mode}_`).test(key)) throw new Error('Key mode mismatch');
const stripe = new Stripe(key);
const url = 'https://cmotionvideo.com/api/billing/webhook';
const apiVersion = '2026-09-30.endive';
const enabledEvents = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
];
const file = `.secrets/stripe-${mode}-webhook.json`;
const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
const matching = endpoints.data.filter(endpoint => endpoint.url === url);
if (matching.length > 1) throw new Error('Multiple matching endpoints: review them before configuring');
let endpoint = matching[0];
let saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
if (endpoint) {
  if (endpoint.api_version !== apiVersion) throw new Error('Existing webhook API version differs; review it in Stripe');
  if (saved?.id !== endpoint.id || !saved.secret?.startsWith('whsec_')) {
    throw new Error('Existing endpoint found but its signing secret is not saved locally; retrieve it from Stripe before continuing');
  }
  endpoint = await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: enabledEvents, disabled: false });
} else {
  endpoint = await stripe.webhookEndpoints.create({
    url, api_version: apiVersion, enabled_events: enabledEvents,
    description: 'Claude Motion Video subscriptions and one-time video purchases',
    metadata: { cmv_app: 'claudemotionvideo' },
  }, { idempotencyKey: 'cmv-webhook-v1' });
  if (!endpoint.secret) throw new Error('Stripe did not return the new signing secret');
  saved = { id: endpoint.id, secret: endpoint.secret, mode, url, apiVersion };
  fs.writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
}
console.log(JSON.stringify({ mode, id: endpoint.id, url, status: endpoint.status, apiVersion, enabledEvents }));
