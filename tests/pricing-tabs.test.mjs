import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const windows = [];
afterEach(() => windows.splice(0).forEach(window => window.close()));

function openPricing(file, suffix = '') {
  const html = readFileSync(new URL(`../reference/pages/${file}`, import.meta.url), 'utf8');
  const { window } = new JSDOM(html, { url: `https://cmotionvideo.com/pricing${suffix}`, runScripts: 'outside-only' });
  windows.push(window);
  const script = [...window.document.scripts].find(script => script.textContent.includes('document.querySelectorAll(`.pricing`)'));
  window.eval(script.textContent);
  return { window, pricing: window.document.querySelector('.pricing') };
}

describe.each(['index.html', 'pricing/index.html'])('%s pricing choices', file => {
  it('shows only the chosen purchase type and keeps each checkout option intact', () => {
    const { pricing } = openPricing(file);
    const oneTime = pricing.querySelector('[data-tab="single-video"]');
    expect(oneTime, 'One-time must be available beside the subscription tabs').not.toBeNull();

    for (const choice of ['single-video', 'month', 'year', 'single-video']) {
      pricing.querySelector(`[data-tab="${choice}"]`).click();
      const visible = [...pricing.querySelectorAll('[data-panel]')].filter(panel => !panel.hidden);
      expect(visible).toHaveLength(1);
      expect(visible[0].dataset.panel).toBe(choice);
      expect(pricing.querySelector('[aria-selected="true"]').dataset.tab).toBe(choice);
      const checkout = visible[0].querySelector('[data-checkout]');
      expect(checkout.dataset.checkout).toBe(choice === 'single-video' ? 'single-video' : 'starter');
      if (choice !== 'single-video') expect(checkout.dataset.interval).toBe(choice);
    }
  });

  it('opens the one-time panel for the Studio purchase link, including after another tab was selected', () => {
    const { window, pricing } = openPricing(file, '#single-video');
    expect(pricing.querySelector('[aria-selected="true"]').dataset.tab).toBe('single-video');
    expect(pricing.querySelector('#single-video').hidden).toBe(false);
    pricing.querySelector('[data-tab="month"]').click();
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    expect(pricing.querySelector('[aria-selected="true"]').dataset.tab).toBe('single-video');
    expect(pricing.querySelector('[data-panel="month"]').hidden).toBe(true);
  });

  it('keeps the one-time offer visible when returning from sign-in to its checkout', () => {
    const { pricing } = openPricing(file, '?checkout=single-video');
    expect(pricing.querySelector('[aria-selected="true"]').dataset.tab).toBe('single-video');
    expect(pricing.querySelector('#single-video').hidden).toBe(false);
  });
});
