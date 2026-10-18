import {describe,it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {effectContent} from '../scripts/seo/effect-content.mjs';
import {effectRoutes} from '../scripts/seo/effect-routes.mjs';
import {renderEffectPage} from '../scripts/seo/effect-pages.mjs';
import {PUBLIC_PAGE_PATHS,siteAssetPath} from '../worker/site-routes';
const source=readFileSync('reference/pages/index.html','utf8');
const effects=readFileSync('reference/pages/effects/index.html','utf8');
const examples=JSON.parse(readFileSync('public/reference-assets/data/examples.json','utf8'));
describe('eight real effect pages',()=>{
 it('keeps remote community videos playable without relying on uncommitted template changes',()=>{
  const cleanSource=source.replace(/<meta\b(?=[^>]*name="referrer")[^>]*>/g,'');
  const html=renderEffectPage(cleanSource,{...effectRoutes[0],...effectContent[0]});
  expect(html).toContain('<meta name="referrer" content="same-origin">');
 });
 it('has exactly the requested routes',()=>{expect(effectContent.map(x=>x.slug).sort()).toEqual(effectRoutes.map(x=>x.slug).sort());});
 it.each(effectRoutes)('renders source-backed $slug',route=>{
  const content=effectContent.find(x=>x.slug===route.slug), html=renderEffectPage(source,{...route,...content});
  const words=content.description.split(/\s+/).length;
  expect(words).toBeGreaterThanOrEqual(50);expect(words).toBeLessThanOrEqual(80);
  expect(effects).toContain(`data-copy="${content.prompt}"`);
  expect(html).toContain(content.prompt);expect(html).toContain('Try this effect →');
  expect(html).toContain(`data-fx="${route.id}"`);
  expect(html).toContain('<video controls');
  expect(PUBLIC_PAGE_PATHS.has(`/effects/${route.slug}`)).toBe(true);
  expect(siteAssetPath(`/effects/${route.slug}`)).toBe(`/effects/${route.slug}/index.html`);
  expect(examples[content.example.id]).toBeDefined();
  expect(existsSync('public'+content.example.thumbnailUrl)).toBe(true);
  const video=[...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(m=>JSON.parse(m[1])).find(x=>x['@type']==='VideoObject');
  expect(video.contentUrl).toBe(content.example.contentUrl);
  expect(video.thumbnailUrl).toBe('https://claudemotionvideo.com'+content.example.thumbnailUrl);
  expect(html).toContain(content.example.sourceUrl);
  if(video.uploadDate) expect(Number.isNaN(Date.parse(video.uploadDate))).toBe(false);
  expect(html).not.toMatch(/aggregateRating|reviewCount/);
 });
});
