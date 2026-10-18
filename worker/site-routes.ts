export const PUBLIC_PAGE_PATHS = new Set([
  '/text-animation-generator', '/animated-title-generator',
  '/', '/pricing', '/examples', '/effects', '/blogs', '/contact', '/terms', '/privacy', '/refunds',
  '/featured', '/opus-5-5-video-generator',
  '/blogs/opus-5-5-video-prompt-guide', '/blogs/opus-5-5-video-examples',
]);
const APP_PAGE_PATHS = new Set(['/studio', '/my-videos', '/account', '/sign-in', '/reset-password']);

/** Resolve known pages only. Unknown paths must stay 404, never fall back to home. */
export function siteAssetPath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (PUBLIC_PAGE_PATHS.has(normalized) || APP_PAGE_PATHS.has(normalized)) {
    return `${normalized === '/' ? '' : normalized}/index.html`;
  }
  if (/^\/studio\/v\/[\w-]{1,160}$/.test(normalized)) return '/studio/index.html';
  return pathname;
}
