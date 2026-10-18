// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

afterEach(() => vi.unstubAllGlobals());

it('opens one-time checkout from the static pricing page when subscriptions are unavailable', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<button data-checkout="single-video">Buy one video</button><div id="cmv-account"></div>';
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url === '/api/me') return Response.json({
      user: {id:'buyer',email:'buyer@example.com',credits:0,singleVideoGenerations:0,plan:'free',subscriptionStatus:null},
      billingEnabled:false,singleVideoEnabled:true,providers:{email:true,google:false},
    });
    if (url === '/api/billing/checkout-single-video' && init?.method === 'POST') {
      return Response.json({error:'One-time payment service is temporarily unavailable.'}, {status:503});
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  await act(async () => { await import('../src/reference-main'); });
  await act(async () => { document.querySelector<HTMLButtonElement>('[data-checkout]')!.click(); });
  expect(calls).toContain('/api/billing/checkout-single-video');
  expect(calls).not.toContain('/api/billing/checkout');
  expect(document.querySelector('[role="status"]')?.textContent).toBe('One-time payment service is temporarily unavailable.');
});
