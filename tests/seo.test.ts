import { describe, expect, it } from 'vitest';
import { applyPageSeo } from '../worker/seo';

const shell = '<!doctype html><html><head><link rel="canonical" href="https://claudemotionvideo.com/"/></head><body><div id="root"></div></body></html>';
const htmlResponse = (headers: Record<string, string> = {}) => new Response(shell, {
  headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
});

describe('HTML crawl metadata', () => {
  it('gives public pages their own production canonical without tracking parameters or fragments', async () => {
    const response = await applyPageSeo(htmlResponse(), new URL('https://preview.example/pricing/?utm_source=google#plans'));
    expect(await response.text()).toContain('<link rel="canonical" href="https://claudemotionvideo.com/pricing"/>');
    expect(response.headers.get('X-Robots-Tag')).toBeNull();
  });

  it.each([
    '/blogs/writing-a-motion-brief', '/blogs/from-screen-to-story',
    '/blogs/small-movements', '/blogs/social-formats', '/terms', '/privacy', '/refund',
  ])('allows the existing public page %s to be indexed', async (path) => {
    const response = await applyPageSeo(htmlResponse(), new URL(`https://claudemotionvideo.com${path}`));
    expect(await response.text()).toContain(`href="https://claudemotionvideo.com${path}"`);
    expect(response.headers.get('X-Robots-Tag')).toBeNull();
  });

  it('escapes path characters before placing a canonical URL into HTML', async () => {
    const response = await applyPageSeo(htmlResponse(), new URL("https://claudemotionvideo.com/blogs/a'&b?token=secret"));
    const html = await response.text();
    expect(html).toContain('href="https://claudemotionvideo.com/blogs/a&#39;&amp;b"');
    expect(html).not.toContain('secret');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it.each(['/studio', '/reset-password', '/blogs/nonexistent', '/nonexistent'])('keeps private or unknown page %s out of the index', async (path) => {
    const response = await applyPageSeo(htmlResponse(), new URL(`https://claudemotionvideo.com${path}?token=secret`));
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(await response.text()).not.toContain('secret');
  });

  it('keeps unrelated HTML headers while removing validators invalidated by rewriting the body', async () => {
    const response = await applyPageSeo(htmlResponse({
      ETag: '"shell-version"', 'Content-Length': String(shell.length),
      'Cache-Control': 'public, max-age=0, must-revalidate', 'X-Frame-Options': 'DENY',
    }), new URL('https://claudemotionvideo.com/examples'));
    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toBeNull();
    expect(response.headers.get('Content-Length')).toBeNull();
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it.each(['text/javascript', 'text/css', 'image/svg+xml', 'application/xml', 'application/json'])('leaves %s resources and their cache metadata untouched', async (contentType) => {
    const original = new Response(shell, { headers: { 'Content-Type': contentType, ETag: '"asset-version"' } });
    const response = await applyPageSeo(original, new URL('https://claudemotionvideo.com/assets/index.js'));
    expect(response).toBe(original);
    expect(await response.text()).toBe(shell);
    expect(response.headers.get('ETag')).toBe('"asset-version"');
    expect(response.headers.get('X-Robots-Tag')).toBeNull();
  });

  it.each([301, 304, 404, 500])('leaves status %s responses untouched', async (status) => {
    const original = new Response(status === 304 ? null : shell, { status, headers: { 'Content-Type': 'text/html' } });
    expect(await applyPageSeo(original, new URL('https://claudemotionvideo.com/pricing'))).toBe(original);
  });
});
