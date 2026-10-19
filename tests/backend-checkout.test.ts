import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBillingPortal, createCheckout, createSingleVideoCheckout } from '../worker/billing';
import { makeDb, seedUser } from './backend-db';
import type { Env, UserRow } from '../worker/types';

async function setup() {
  const { db } = makeDb(); await seedUser(db);
  const submissions: URLSearchParams[] = [];
  const sessions = new Map<string, { id: string; url: string | null; status: string; expires_at: number; metadata: Record<string, string> }>();
  const idempotency = new Map<string, string>();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname; const method = init.method ?? 'GET';
    let result: unknown;
    if (path === '/v1/customers' && method === 'POST') result = { id: 'cus_alice', object: 'customer', email: 'alice@example.com' };
    else if (path === '/v1/subscriptions') result = { object: 'list', data: [], has_more: false };
    else if (path === '/v1/checkout/sessions' && method === 'POST') {
      const key = new Headers(init.headers).get('Idempotency-Key')!;
      const prior = idempotency.get(key);
      if (prior) result = sessions.get(prior);
      else {
        const body = new URLSearchParams(String(init.body)); submissions.push(body);
        const id = `cs_${sessions.size + 1}`;
        result = { id, object: 'checkout.session', url: `https://checkout.stripe.com/${id}`, status: 'open', expires_at: Number(body.get('expires_at')), metadata: { billingPolicy: body.get('metadata[billingPolicy]') ?? '' } };
        sessions.set(id, result as never); idempotency.set(key, id);
      }
    } else if (/^\/v1\/checkout\/sessions\/cs_\d+\/expire$/.test(path)) {
      const session = sessions.get(path.split('/')[4])!; session.status = 'expired'; session.url = null; result = session;
    } else if (/^\/v1\/checkout\/sessions\/cs_\d+$/.test(path)) result = sessions.get(path.split('/')[4]);
    else throw new Error(`Unexpected Stripe request ${method} ${path}`);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const env = { DB: db, APP_URL: 'https://cmotionvideo.com', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PRICES: JSON.stringify({ starter: { month: 'price_sm', year: 'price_sy' }, pro: { month: 'price_pm', year: 'price_py' }, max: { month: 'price_mm', year: 'price_my' } }) } as Env;
  const user = (await db.prepare("SELECT * FROM users WHERE id='alice'").first<UserRow>())!;
  return { db, env, user, submissions, sessions };
}
afterEach(() => vi.unstubAllGlobals());
describe('Stripe checkout request contract', () => {
  it('uses the explicitly configured production portal instead of the account default', async () => {
    const { env, user } = await setup();
    env.STRIPE_PORTAL_CONFIGURATION = 'bpc_cmv_live';
    user.stripe_customer_id = 'cus_alice';
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(new URL(url).pathname).toBe('/v1/billing_portal/sessions');
      const body = new URLSearchParams(String(init.body));
      if (body.get('configuration') !== 'bpc_cmv_live') return new Response(JSON.stringify({ error: { message: 'Explicit portal configuration required', type: 'invalid_request_error' } }), { status: 400 });
      return new Response(JSON.stringify({ id: 'bps_fixture', object: 'billing_portal.session', configuration: 'bpc_cmv_live', url: 'https://billing.stripe.com/p/session/fixture' }), { status: 200 });
    });
    expect(await createBillingPortal(env, user)).toEqual({ url: 'https://billing.stripe.com/p/session/fixture' });
  });
  it('keeps account-default portal behavior when no explicit configuration is provided', async () => {
    const { env, user } = await setup();
    user.stripe_customer_id = 'cus_alice';
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = new URLSearchParams(String(init.body));
      if (body.has('configuration')) return new Response(JSON.stringify({ error: { message: 'Unexpected configuration', type: 'invalid_request_error' } }), { status: 400 });
      return new Response(JSON.stringify({ id: 'bps_fixture', url: 'https://billing.stripe.com/p/session/default' }), { status: 200 });
    });
    expect(await createBillingPortal(env, user)).toEqual({ url: 'https://billing.stripe.com/p/session/default' });
  });
  it('charges the configured monthly price immediately without a trial', async () => {
    const { env, user, submissions } = await setup();
    expect(await createCheckout(env, user, 'starter', 'month')).toEqual({ url: 'https://checkout.stripe.com/cs_1' });
    expect(submissions[0].get('allowed_payment_method_types[0]')).toBe('card');
    expect(submissions[0].get('payment_method_collection')).toBe('always');
    expect(submissions[0].get('subscription_data[trial_period_days]')).toBeNull();
    expect(submissions[0].get('line_items[0][price]')).toBe('price_sm');
    expect(submissions[0].get('subscription_data[metadata][userId]')).toBe('alice');
  });
  it('creates a separate $5 video payment for an active subscriber without saving a card', async () => {
    const { env, user, submissions } = await setup();
    env.STRIPE_SINGLE_VIDEO_PRICE = 'price_video';
    user.subscription_status = 'active';
    await env.DB.prepare("UPDATE users SET subscription_status='active' WHERE id='alice'").run();
    expect(await createSingleVideoCheckout(env, user)).toEqual({ url: 'https://checkout.stripe.com/cs_1' });
    const body = submissions[0];
    expect(body.get('mode')).toBe('payment');
    expect(body.get('line_items[0][price]')).toBe('price_video');
    expect(body.get('line_items[0][quantity]')).toBe('1');
    expect(body.get('adaptive_pricing[enabled]')).toBe('false');
    expect(body.get('customer')).toBe('cus_alice');
    expect(body.get('client_reference_id')).toBe('alice');
    expect(body.get('metadata[purchaseType]')).toBe('single_video');
    expect(body.has('payment_intent_data[setup_future_usage]')).toBe(false);
    expect(body.has('saved_payment_method_options[payment_method_save]')).toBe(false);
    expect(body.has('payment_method_collection')).toBe(false);
    expect(body.has('subscription_data[trial_period_days]')).toBe(false);
    expect(await createSingleVideoCheckout(env, user)).toEqual({ url: 'https://checkout.stripe.com/cs_1' });
    expect(submissions).toHaveLength(1);
  });
  it('lets a subscriber buy a video after their completed subscription checkout', async () => {
    const { env, user, sessions } = await setup();
    env.STRIPE_SINGLE_VIDEO_PRICE = 'price_video';
    await createCheckout(env, user, 'starter', 'month');
    Object.assign(sessions.get('cs_1')!, { mode: 'subscription', status: 'complete' });
    await env.DB.prepare("UPDATE users SET subscription_status='active' WHERE id='alice'").run();
    expect(await createSingleVideoCheckout(env, user)).toEqual({ url: 'https://checkout.stripe.com/cs_2' });
  });
  it('does not attach a trial to annual checkout', async () => {
    const { env, user, submissions } = await setup();
    await createCheckout(env, user, 'max', 'year');
    expect(submissions[0].get('subscription_data[trial_period_days]')).toBeNull();
    expect(submissions[0].get('line_items[0][price]')).toBe('price_my');
  });
  it('expires a predeployment checkout so the removed trial cannot start', async () => {
    const { env, user, sessions, submissions } = await setup();
    await createCheckout(env, user, 'starter', 'month');
    sessions.get('cs_1')!.metadata = {};
    expect(await createCheckout(env, user, 'starter', 'month')).toEqual({ url: 'https://checkout.stripe.com/cs_2' });
    expect(sessions.get('cs_1')!.status).toBe('expired');
    expect(submissions[1].get('subscription_data[trial_period_days]')).toBeNull();
  });
  it('reuses open checkout and safely creates a new one when switching back to a prior plan', async () => {
    const { env, user, submissions } = await setup();
    expect(await createCheckout(env, user, 'starter', 'month')).toEqual({ url: 'https://checkout.stripe.com/cs_1' });
    expect(await createCheckout(env, user, 'starter', 'month')).toEqual({ url: 'https://checkout.stripe.com/cs_1' });
    expect(await createCheckout(env, user, 'pro', 'month')).toEqual({ url: 'https://checkout.stripe.com/cs_2' });
    expect(await createCheckout(env, user, 'starter', 'month')).toEqual({ url: 'https://checkout.stripe.com/cs_3' });
    expect(submissions.length).toBe(3);
  });
});
