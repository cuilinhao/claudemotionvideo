// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

afterEach(() => vi.unstubAllGlobals());

it('selects plans without checkout and sends each Get click once with its own plan and billing period', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const html = readFileSync('reference/pages/pricing/index.html', 'utf8');
  const page = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = page.body.innerHTML;
  const pricingScript = [...document.scripts].find(script => script.textContent.includes('document.querySelectorAll(`.pricing`)'))!;
  window.eval(pricingScript.textContent);
  const requests: { url: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/me') return Response.json({
      user: { id: 'buyer', email: 'buyer@example.com', credits: 0, singleVideoGenerations: 0, plan: 'free', subscriptionStatus: null },
      billingEnabled: true, singleVideoEnabled: true, providers: { email: true, google: false },
    });
    if (url === '/api/billing/checkout' && init?.method === 'POST') {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ error: 'Checkout intentionally stopped before payment.' }, { status: 503 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  await act(async () => { await import('../src/reference-main'); });
  const starter = document.querySelector<HTMLButtonElement>('[data-panel="year"] [data-checkout="starter"]')!;
  await act(async () => { starter.closest<HTMLElement>('.plan')!.click(); });
  expect(starter.closest('.plan')?.getAttribute('data-selected')).toBe('true');
  expect(requests).toEqual([]);
  await act(async () => { starter.click(); });
  expect(requests).toEqual([{ url: '/api/billing/checkout', body: { plan: 'starter', interval: 'year' } }]);

  document.querySelector<HTMLButtonElement>('[data-tab="month"]')!.click();
  const max = document.querySelector<HTMLButtonElement>('[data-panel="month"] [data-checkout="max"]')!;
  await act(async () => { max.click(); });
  expect(max.closest('.plan')?.getAttribute('data-selected')).toBe('true');
  expect(requests).toEqual([
    { url: '/api/billing/checkout', body: { plan: 'starter', interval: 'year' } },
    { url: '/api/billing/checkout', body: { plan: 'max', interval: 'month' } },
  ]);
});
