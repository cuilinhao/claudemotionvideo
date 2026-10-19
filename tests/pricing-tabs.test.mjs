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

  it('moves the selected border and primary checkout to the clicked plan without moving the popular badge', () => {
    const { pricing } = openPricing(file);
    const yearly = pricing.querySelector('[data-panel="year"]');
    expect(yearly.querySelector('[data-selected="true"] [data-checkout]')?.dataset.checkout).toBe('pro');

    yearly.querySelector('[data-checkout="starter"]').closest('.plan').querySelector('h3').click();
    expect(yearly.querySelectorAll('[data-selected="true"]')).toHaveLength(1);
    expect(yearly.querySelector('[data-selected="true"] [data-checkout]').dataset.checkout).toBe('starter');
    expect([...yearly.querySelectorAll('[data-checkout].primary')].map(button => button.dataset.checkout)).toEqual(['starter']);
    expect(yearly.querySelector('.badge').closest('.plan').querySelector('[data-checkout]').dataset.checkout).toBe('pro');
  });

  it('preserves the chosen subscription through month, year and one-time switches', () => {
    const { pricing } = openPricing(file);
    pricing.querySelector('[data-panel="year"] [data-checkout="max"]').closest('.plan').click();
    for (const interval of ['month', 'single-video', 'year', 'month']) {
      pricing.querySelector(`[data-tab="${interval}"]`).click();
      if (interval === 'single-video') {
        expect(pricing.querySelector('#single-video [data-checkout]').classList.contains('primary')).toBe(true);
      } else {
        const panel = pricing.querySelector(`[data-panel="${interval}"]`);
        expect(panel.querySelector('[data-selected="true"] [data-checkout]')?.dataset.checkout).toBe('max');
        expect(panel.querySelector('input[type="radio"]:checked')?.value).toBe('max');
      }
    }
  });

  it('updates both billing periods when the native radio changes without nesting checkout in its label', () => {
    const { window, pricing } = openPricing(file);
    const card = pricing.querySelector('[data-panel="year"] [data-checkout="starter"]').closest('.plan');
    const radio = card.querySelector('input[type="radio"]');
    expect(radio, 'Each plan needs a keyboard-operable native selection control').not.toBeNull();
    expect(radio.labels[0].textContent).toContain('Starter');
    expect(card.querySelector('[data-checkout]').closest('label, [role="radio"], [role="button"]')).toBeNull();
    radio.focus();
    expect(window.document.activeElement).toBe(radio);
    radio.checked = true;
    radio.dispatchEvent(new window.Event('change', { bubbles: true }));
    for (const interval of ['month', 'year']) {
      const panel = pricing.querySelector(`[data-panel="${interval}"]`);
      expect(panel.querySelector('input[type="radio"]:checked').value).toBe('starter');
      expect(panel.querySelector('[data-selected="true"] [data-checkout]').dataset.checkout).toBe('starter');
    }
  });
});
