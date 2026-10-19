import { afterEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { ensurePortalConfiguration, validateStripeKeyMode } from '../scripts/configure-stripe.mjs';

type Configuration = { id: string; metadata?: Record<string, string>; business_profile?: Record<string, string>; default_return_url?: string; livemode: boolean; [key: string]: unknown };
function stripeFixture(initial: Configuration[]) {
  const remote = new Map(initial.map(configuration => [configuration.id, configuration]));
  let creations = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const method = init.method ?? 'GET';
    let result: unknown;
    if (path === '/v1/billing_portal/configurations' && method === 'GET') {
      result = { object: 'list', data: [...remote.values()], has_more: false };
    } else if (method === 'POST' && path.startsWith('/v1/billing_portal/configurations')) {
      const id = path === '/v1/billing_portal/configurations' ? `bpc_created_${++creations}` : path.split('/').at(-1)!;
      const body = new URLSearchParams(String(init.body));
      result = { ...remote.get(id), id, livemode: true, metadata: { cmv_app: body.get('metadata[cmv_app]')! },
        subscriptionUpdate: body.get('features[subscription_update][enabled]'),
        cancellationMode: body.get('features[subscription_cancel][mode]'),
      };
      remote.set(id, result as Configuration);
    } else throw new Error(`Unexpected request ${method} ${path}`);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  });
  return { stripe: new Stripe('rk_live_fixture', { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 0 }), remote, creations: () => creations };
}
afterEach(() => vi.unstubAllGlobals());

describe('Stripe production configuration', () => {
  it('accepts restricted or secret keys only for the requested mode', () => {
    expect(() => validateStripeKeyMode('rk_live_fixture', 'live')).not.toThrow();
    expect(() => validateStripeKeyMode('sk_live_fixture', 'live')).not.toThrow();
    expect(() => validateStripeKeyMode('rk_test_fixture', 'test')).not.toThrow();
    expect(() => validateStripeKeyMode('rk_test_fixture', 'live')).toThrow('Key mode mismatch');
    expect(() => validateStripeKeyMode('pk_live_fixture', 'live')).toThrow('Key mode mismatch');
  });
  it('reuses the marked application configuration and enforces the intended portal features', async () => {
    const { stripe, remote, creations } = stripeFixture([
      { id: 'bpc_other_default', livemode: true },
      { id: 'bpc_cmv', metadata: { cmv_app: 'claudemotionvideo' }, livemode: true },
    ]);
    expect((await ensurePortalConfiguration(stripe, 'live')).id).toBe('bpc_cmv');
    expect(creations()).toBe(0);
    expect(remote.get('bpc_cmv')).toMatchObject({ subscriptionUpdate: 'false', cancellationMode: 'at_period_end' });
  });
  it('creates one marked configuration and reuses it on subsequent runs', async () => {
    const { stripe, remote, creations } = stripeFixture([]);
    const first = await ensurePortalConfiguration(stripe, 'live');
    const second = await ensurePortalConfiguration(stripe, 'live');
    expect(first.id).toBe(second.id);
    expect(creations()).toBe(1);
    expect(remote.get(first.id)?.metadata).toEqual({ cmv_app: 'claudemotionvideo' });
  });
  it('adopts the prior application configuration without duplicating it', async () => {
    const { stripe, remote, creations } = stripeFixture([{ id: 'bpc_legacy', livemode: true,
      business_profile: { headline: 'Manage your Claude Motion Video subscription', privacy_policy_url: 'https://claudemotionvideo.com/privacy', terms_of_service_url: 'https://claudemotionvideo.com/terms' },
      default_return_url: 'https://claudemotionvideo.com/studio',
    }]);
    expect((await ensurePortalConfiguration(stripe, 'live')).id).toBe('bpc_legacy');
    expect(creations()).toBe(0);
    expect(remote.get('bpc_legacy')?.metadata?.cmv_app).toBe('claudemotionvideo');
  });
});
