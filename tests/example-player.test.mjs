import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../public/reference-assets/app.js', import.meta.url), 'utf8');
const examples = {
  first: { id: 'first', name: 'First film', author: 'creatorA', postUrl: 'https://x.com/creatorA/status/1', poster: '/reference-assets/first.jpg', prompt: 'Animate the first image.', fullPrompt: true, tags: ['canvas'], catLabel: 'Motion graphics', duration: 10, format: '16:9' },
  second: { id: 'second', name: 'Second film', author: 'creatorB', postUrl: 'https://x.com/creatorB/status/2', poster: '/reference-assets/second.jpg', prompt: 'Animate the second image.', fullPrompt: true, tags: [], catLabel: 'Motion graphics', duration: 15, format: '9:16' },
};
const media = {
  first: { url: 'https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/first.mp4?tag=12', type: 'video/mp4', width: 1280, height: 720 },
  second: { url: 'https://video.twimg.com/ext_tw_video/2/pu/vid/720x1280/second.mp4', type: 'video/mp4', width: 720, height: 1280 },
};
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const windows = [];
afterEach(() => { windows.splice(0).forEach(window => window.close()); });

function browser(fetchResponse = path => Response.json(path.endsWith('/examples.json') ? examples : media), playResult) {
  const dom = new JSDOM(`<!doctype html><button class="card" data-id="first" data-fmt="16:9">First</button><button class="card" data-id="second" data-fmt="9:16">Second</button><dialog id="example-dlg"><button class="modal-close">Close</button><div class="modal-body"></div></dialog>`, { url: 'https://cmotionvideo.com/examples', runScripts: 'outside-only' });
  const { window } = dom;
  windows.push(window);
  // jsdom also lacks the native dialog methods. Model the open flag and the
  // queued close event, including its possible arrival after a quick reopen.
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () {
    if (!this.open) return;
    this.open = false;
    window.queueMicrotask(() => this.dispatchEvent(new window.Event('close')));
  };
  const states = new WeakMap();
  const state = video => {
    if (!states.has(video)) states.set(video, { playing: false, loads: 0, playAttempts: 0 });
    return states.get(video);
  };
  // jsdom has no decoder/network player. Keep the real DOM and events while
  // modelling only these browser media boundary effects.
  window.HTMLMediaElement.prototype.play = function () {
    state(this).playAttempts++;
    return Promise.resolve(playResult?.(this)).then(() => { state(this).playing = true; });
  };
  window.HTMLMediaElement.prototype.pause = function () { state(this).playing = false; };
  window.HTMLMediaElement.prototype.load = function () { state(this).loads++; };
  const fetch = vi.fn((path, options) => Promise.resolve(fetchResponse(path, options)));
  window.fetch = fetch;
  let copied = '';
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async text => { copied = text; } } });
  window.eval(source);
  // Prevent jsdom navigation for the preserved Studio CTA, while executing the
  // actual delegated handler that writes the selected prompt and aspect.
  window.document.addEventListener('click', event => {
    if (event.target.closest('a[href="/studio"]')) event.preventDefault();
  });
  const dialog = window.document.querySelector('dialog');
  return {
    window, dialog, fetch, state,
    query: selector => window.document.querySelector(selector),
    click: selector => window.document.querySelector(selector).click(),
    copied: () => copied,
  };
}

describe('shared example video dialog', () => {
  it('opens immediately, then plays a native unmuted video and retains prompt, attribution and Studio prefill', async () => {
    const dataRequest = deferred(), mediaRequest = deferred();
    const page = browser(path => path.endsWith('/examples.json') ? dataRequest.promise : mediaRequest.promise);
    page.click('[data-id="first"]');
    expect(page.dialog.open).toBe(true);
    expect(page.query('.ex-player-status')?.textContent).toMatch(/loading/i);
    dataRequest.resolve(Response.json(examples));
    mediaRequest.resolve(Response.json(media));
    await flush();
    const video = page.query('video');
    expect(video).not.toBeNull();
    expect(video.src).toBe(media.first.url);
    expect(video.poster).toBe('https://cmotionvideo.com/reference-assets/first.jpg');
    expect(video.controls).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.preload).toBe('metadata');
    expect(video.muted).toBe(false);
    expect(page.state(video).playing).toBe(true);
    expect(page.query('.ex-video').tagName).toBe('DIV');
    expect(page.query('.ex-video a')).toBeNull();
    expect(page.query('.ex-source a').href).toBe(examples.first.postUrl);
    page.click('[data-copy]');
    await flush();
    expect(page.copied()).toBe('Animate the first image.');
    page.click('[data-prefill]');
    await flush();
    expect(JSON.parse(page.window.sessionStorage.getItem('cmv.prefill'))).toEqual({ brief: 'Animate the first image.', aspect: '16:9' });
    expect(page.dialog.open).toBe(false);
    expect(page.state(video).playing).toBe(false);
    expect(video.hasAttribute('src')).toBe(false);
  });

  it('keeps native controls without an error when audible autoplay is denied', async () => {
    const page = browser(undefined, () => Promise.reject(new DOMException('Gesture required', 'NotAllowedError')));
    page.click('[data-id="first"]');
    await flush();
    const video = page.query('video');
    expect(video).not.toBeNull();
    expect(video.controls).toBe(true);
    expect(video.muted).toBe(false);
    expect(page.query('.ex-player-status')?.hidden).toBe(true);
    expect(page.query('.ex-player-error')).toBeNull();
    expect(page.state(video).playAttempts).toBe(1);
  });

  it('discards a data response after close and shares the two cached requests across fast card switches', async () => {
    const dataRequest = deferred(), mediaRequest = deferred();
    const page = browser(path => path.endsWith('/examples.json') ? dataRequest.promise : mediaRequest.promise);
    page.click('[data-id="first"]');
    page.click('.modal-close');
    dataRequest.resolve(Response.json(examples));
    mediaRequest.resolve(Response.json(media));
    await flush();
    expect(page.dialog.open).toBe(false);
    expect(page.query('video')).toBeNull();
    page.click('[data-id="first"]');
    page.click('[data-id="second"]');
    await flush();
    expect(page.query('video')?.src).toBe(media.second.url);
    expect(page.query('h3').textContent).toContain('Second film');
    expect(page.fetch.mock.calls.map(([path]) => path)).toEqual(['/reference-assets/data/examples.json', '/reference-assets/data/example-media.json']);
  });

  it('stops the old source during a card switch and a late play promise cannot restart it', async () => {
    const pendingPlay = deferred();
    const page = browser(undefined, () => pendingPlay.promise);
    page.click('[data-id="first"]');
    await flush();
    const first = page.query('video');
    expect(first).not.toBeNull();
    page.click('[data-id="second"]');
    await flush();
    expect(first.hasAttribute('src')).toBe(false);
    expect(page.state(first).loads).toBeGreaterThan(0);
    pendingPlay.resolve();
    await flush();
    expect(page.state(first).playing).toBe(false);
    expect(page.query('video').src).toBe(media.second.url);
  });

  it('does not let the queued close event clear a newly reopened dialog', async () => {
    const page = browser();
    page.click('[data-id="first"]');
    await flush();
    page.click('.modal-close');
    page.click('[data-id="second"]');
    await flush();
    expect(page.dialog.open).toBe(true);
    expect(page.query('video')?.src).toBe(media.second.url);
  });

  it.each(['close button', 'Escape'])('stops playback and releases the media source on %s', async action => {
    const page = browser();
    page.click('[data-id="first"]');
    await flush();
    const video = page.query('video');
    expect(video).not.toBeNull();
    if (action === 'Escape') page.dialog.dispatchEvent(new page.window.Event('cancel', { cancelable: true }));
    else page.click('.modal-close');
    expect(page.dialog.open).toBe(false);
    expect(page.state(video).playing).toBe(false);
    expect(video.hasAttribute('src')).toBe(false);
    expect(page.state(video).loads).toBeGreaterThan(0);
    expect(page.query('video')).toBeNull();
  });

  it('retries a failed media map without discarding the successful example-data cache', async () => {
    let mediaRequests = 0;
    const page = browser(path => {
      if (path.endsWith('/examples.json')) return Response.json(examples);
      mediaRequests++;
      return mediaRequests === 1 ? Response.json({}, { status: 503 }) : Response.json(media);
    });
    page.click('[data-id="first"]');
    await flush();
    expect(page.query('.ex-player-error')).not.toBeNull();
    expect(page.query('.prompt-box').textContent).toBe(examples.first.prompt);
    page.click('[data-example-retry]');
    await flush();
    expect(page.query('video')?.src).toBe(media.first.url);
    expect(page.fetch.mock.calls.filter(([path]) => path.endsWith('/examples.json'))).toHaveLength(1);
    expect(mediaRequests).toBe(2);
  });

  it('shows an in-site unavailable state for a missing source and preserves creator attribution', async () => {
    const page = browser(path => Response.json(path.endsWith('/examples.json') ? examples : {}));
    page.click('[data-id="first"]');
    await flush();
    expect(page.query('.ex-player-error')?.textContent || '').toMatch(/unavailable|not available/i);
    expect(page.query('video[src]')).toBeNull();
    expect(page.query('.ex-video a')).toBeNull();
    expect(page.query('.ex-source a').href).toBe(examples.first.postUrl);
  });

  it('releases a failed media source and retries playback without re-fetching either JSON', async () => {
    const page = browser();
    page.click('[data-id="first"]');
    await flush();
    const failed = page.query('video');
    failed.dispatchEvent(new page.window.Event('error'));
    expect(failed.hasAttribute('src')).toBe(false);
    expect(page.state(failed).playing).toBe(false);
    expect(page.query('.ex-player-error')).not.toBeNull();
    page.click('[data-example-retry]');
    await flush();
    expect(page.query('video')).not.toBe(failed);
    expect(page.state(page.query('video')).playing).toBe(true);
    expect(page.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['http://video.twimg.com/first.mp4', 'video/mp4'],
    ['https://video.twimg.com.evil.test/first.mp4', 'video/mp4'],
    ['https://user:password@video.twimg.com/first.mp4', 'video/mp4'],
    ['https://video.twimg.com:8443/first.mp4', 'video/mp4'],
    ['https://video.twimg.com:443/first.mp4', 'video/mp4'],
    ['https://video.twimg.com/first.m3u8', 'video/mp4'],
    ['https://video.twimg.com/first.mp4', 'text/html'],
    ['not a URL', 'video/mp4'],
  ])('never attaches an invalid media source: %s (%s)', async (url, type) => {
    const page = browser(path => Response.json(path.endsWith('/examples.json') ? examples : { first: { ...media.first, url, type } }));
    page.click('[data-id="first"]');
    await flush();
    expect(page.query('.ex-player-error')?.textContent || '').toMatch(/unavailable|not available/i);
    expect(page.query('video[src]')).toBeNull();
    expect(page.query('.ex-video a')).toBeNull();
  });
});
