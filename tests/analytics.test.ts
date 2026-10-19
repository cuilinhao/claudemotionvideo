import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const measurementId = 'G-ABC1234567';

function browser(url = 'https://claudemotionvideo.com/', referrer = '') {
  const scripts: Record<string, unknown>[] = [];
  const page: {
    location: URL;
    dataLayer?: Array<ArrayLike<unknown>>;
    [key: string]: unknown;
  } = { location: new URL(url) };
  vi.stubGlobal('window', page);
  vi.stubGlobal('document', {
    referrer,
    createElement: () => ({}),
    head: { appendChild: (script: Record<string, unknown>) => scripts.push(script) },
  });
  return {
    page,
    scripts,
    commands: () => (page.dataLayer ?? []).map(command => Array.from(command)),
    views: () => (page.dataLayer ?? []).map(command => Array.from(command))
      .filter(command => command[0] === 'event' && command[1] === 'page_view')
      .map(command => command[2] as Record<string, unknown>),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('PROD', true);
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', measurementId);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('production analytics', () => {
  it.each(['', 'UA-123456-1', 'G-bad', 'G-ABC1234567&secret=value'])('does not load a tag for invalid measurement ID %s', async id => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', id);
    const state = browser();
    const { trackPageView } = await import('../src/lib/analytics');
    trackPageView('/');
    expect(state.scripts).toEqual([]);
    expect(state.commands()).toEqual([]);
  });

  it.each([
    [false, 'https://claudemotionvideo.com/'],
    [true, 'http://localhost:5173/'],
    [true, 'https://preview.workers.dev/'],
    [true, 'https://claudemotionvideo.com.example.org/'],
    [true, 'http://claudemotionvideo.com/'],
  ])('does not collect outside production HTTPS origins (%s, %s)', async (production, url) => {
    vi.stubEnv('PROD', production);
    const state = browser(url);
    const { trackPageView } = await import('../src/lib/analytics');
    trackPageView('/');
    expect(state.scripts).toEqual([]);
    expect(state.commands()).toEqual([]);
  });

  it('initializes one tag and counts each pathname transition once across repeated mounts', async () => {
    const state = browser();
    const { trackPageView } = await import('../src/lib/analytics');
    trackPageView('/');
    trackPageView('/');
    trackPageView('/pricing');
    trackPageView('/pricing');
    const remounted = await import('../src/lib/analytics');
    remounted.trackPageView('/pricing');
    remounted.trackPageView('/');

    expect(state.scripts).toHaveLength(1);
    expect(state.scripts[0]).toMatchObject({
      async: true,
      src: 'https://www.googletagmanager.com/gtag/js?id=G-ABC1234567',
    });
    expect(state.commands().filter(command => command[0] === 'config')).toEqual([
      ['config', measurementId, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      }],
    ]);
    expect(state.views().map(view => view.page_location)).toEqual([
      'https://claudemotionvideo.com/',
      'https://claudemotionvideo.com/pricing',
      'https://claudemotionvideo.com/',
    ]);
  });

  it('cleans initial and subsequent analytics context before any configuration or page view', async () => {
    const state = browser(
      'https://claudemotionvideo.com/studio?prompt=PRIVATE_PROMPT#token=PRIVATE_TOKEN',
      'https://www.google.com/search?q=PRIVATE_EMAIL#PRIVATE_FRAGMENT',
    );
    const { trackPageView } = await import('../src/lib/analytics');
    trackPageView('/studio');
    state.page.location = new URL('https://claudemotionvideo.com/pricing?email=PRIVATE_EMAIL#PRIVATE_FRAGMENT');
    trackPageView('/pricing');
    const commands = state.commands();
    const initialContext = commands.findIndex(command => command[0] === 'set');
    const configuration = commands.findIndex(command => command[0] === 'config');
    expect(initialContext).toBeGreaterThanOrEqual(0);
    expect(initialContext).toBeLessThan(configuration);
    expect(state.views()).toMatchObject([
      { page_location: 'https://claudemotionvideo.com/studio', page_referrer: 'https://www.google.com/', page_title: expect.stringContaining('Studio') },
      { page_location: 'https://claudemotionvideo.com/pricing', page_referrer: 'https://claudemotionvideo.com/studio', page_title: expect.stringContaining('Pricing') },
    ]);
    expect(JSON.stringify(commands)).not.toContain('PRIVATE_');
    expect(commands.filter(command => command[0] === 'set').at(-1)?.[1]).toMatchObject({
      page_location: 'https://claudemotionvideo.com/pricing',
      page_referrer: 'https://claudemotionvideo.com/studio',
    });
  });

  it.each(['/reset-password', '/blogs/PRIVATE_PAYLOAD', '/PRIVATE_EMAIL'])('does not load a tag on private or unknown path %s', async pathname => {
    const state = browser(`https://claudemotionvideo.com${pathname}?secret=PRIVATE_QUERY#token=PRIVATE_TOKEN`);
    const { trackPageView } = await import('../src/lib/analytics');
    trackPageView(pathname);
    expect(state.scripts).toEqual([]);
    expect(state.commands()).toEqual([]);
  });

  it('suspends an already loaded tag on private routes and resumes on a public route', async () => {
    const state = browser();
    const { trackPageView } = await import('../src/lib/analytics');
    trackPageView('/');
    trackPageView('/reset-password');
    expect(state.page[`ga-disable-${measurementId}`]).toBe(true);
    expect(state.views()).toHaveLength(1);
    trackPageView('/');
    expect(state.page[`ga-disable-${measurementId}`]).toBe(false);
    expect(state.views()).toHaveLength(2);
    expect(state.scripts).toHaveLength(1);
  });

  it('supports the www production hostname with a safe static blog title', async () => {
    const state = browser('https://www.claudemotionvideo.com/blogs/small-movements');
    const { trackPageView } = await import('../src/lib/analytics');
    trackPageView('/blogs/small-movements');
    expect(state.views()).toMatchObject([{
      page_location: 'https://www.claudemotionvideo.com/blogs/small-movements',
      page_title: expect.stringContaining('Small movements'),
    }]);
  });
});
