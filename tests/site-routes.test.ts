import { describe, expect, it } from 'vitest';
import { PUBLIC_PAGE_PATHS, siteAssetPath } from '../worker/site-routes';

describe('static page routing', () => {
  it('serves every public page through its generated HTML file', () => {
    expect(PUBLIC_PAGE_PATHS.size).toBe(13);
    for (const path of PUBLIC_PAGE_PATHS) expect(siteAssetPath(path)).toBe(`${path === '/' ? '' : path}/index.html`);
  });
  it.each(['/studio', '/my-videos', '/account', '/sign-in', '/reset-password'])('serves the app entry for %s', path => {
    expect(siteAssetPath(path)).toBe(`${path}/index.html`);
    expect(siteAssetPath(`${path}/`)).toBe(`${path}/index.html`);
  });
  it('keeps project deep links in the Studio shell', () => {
    expect(siteAssetPath('/studio/v/project_123-ab')).toBe('/studio/index.html');
  });
  it.each(['/blogs/missing', '/missing', '/studio/v/id/extra', '/reference-assets/missing.mp4'])('leaves unknown path %s to the asset 404 handler', path => {
    expect(siteAssetPath(path)).toBe(path);
  });
});
