const SITE_ORIGIN = 'https://claudemotionvideo.com';
const PUBLIC_PATHS = new Set([
  '/', '/pricing', '/examples', '/effects', '/blogs', '/contact', '/terms', '/privacy', '/refund',
  '/blogs/writing-a-motion-brief', '/blogs/from-screen-to-story',
  '/blogs/small-movements', '/blogs/social-formats',
]);

export async function applyPageSeo(response: Response, url: URL): Promise<Response> {
  if (response.status !== 200 || !/^text\/html(?:;|$)/i.test(response.headers.get('Content-Type') ?? '')) {
    return response;
  }

  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const publicPath = pathname.toLowerCase();
  const indexable = PUBLIC_PATHS.has(publicPath);
  const canonical = `${SITE_ORIGIN}${indexable ? publicPath : pathname}`
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const headers = new Headers(response.headers);
  if (!indexable) headers.set('X-Robots-Tag', 'noindex');
  headers.delete('Content-Length');
  headers.delete('ETag');

  // This is the small, controlled Vite HTML shell, shared by all SPA routes.
  const body = response.body === null ? null : (await response.text()).replace(
    /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi,
    () => `<link rel="canonical" href="${canonical}"/>`,
  );
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
