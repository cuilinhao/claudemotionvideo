import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {PUBLIC_PAGE_PATHS} from '../worker/site-routes';
import {toolPages} from '../scripts/seo/tool-content.mjs';
import {effectRoutes} from '../scripts/seo/effect-routes.mjs';
import {effectContent} from '../scripts/seo/effect-content.mjs';
import {renderToolPage} from '../scripts/seo/pages.mjs';
import {renderEffectPage} from '../scripts/seo/effect-pages.mjs';
import {transformHome} from '../scripts/seo/home.mjs';
const source=readFileSync('reference/pages/index.html','utf8');
const pages=[...toolPages.map(p=>({path:p.path,html:renderToolPage(source,p)})),...effectRoutes.map(p=>({path:`/effects/${p.slug}`,html:renderEffectPage(source,{...p,...effectContent.find(c=>c.slug===p.slug)})}))];
describe('crawler discovery',()=>{
 it('keeps all twenty-three sitemap routes with dates and frequencies',()=>{
  const xml=readFileSync('public/sitemap.xml','utf8'),urls=[...xml.matchAll(/<url>(.*?)<\/url>/g)].map(m=>m[1]);
  expect(urls).toHaveLength(23);
  expect(urls.map(x=>new URL(x.match(/<loc>(.*?)<\/loc>/)[1]).pathname).sort()).toEqual([...PUBLIC_PAGE_PATHS].sort());
  for(const url of urls){expect(url).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);const p=new URL(url.match(/<loc>(.*?)<\/loc>/)[1]).pathname;expect(url).toContain(`<changefreq>${['/','/pricing','/examples','/effects'].includes(p)?'weekly':'monthly'}</changefreq>`);}
 });
 it.each(pages)('adds truthful breadcrumbs and raster sharing to $path',({path,html})=>{
  const schemas=[...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(m=>JSON.parse(m[1]));
  const crumbs=schemas.find(s=>s['@type']==='BreadcrumbList');
  expect(crumbs.itemListElement.at(-1).item).toBe('https://claudemotionvideo.com'+path);
  expect(html).toContain('aria-current="page"');
  expect(html).toContain(`content="https://claudemotionvideo.com/og/${path.split('/').at(-1)}.png"`);
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).toContain('rel="apple-touch-icon" href="/favicon.svg"');
  if(path.startsWith('/effects/')) for(const route of effectRoutes.filter(r=>!path.endsWith(r.slug))) expect(html).toContain(`href="/effects/${route.slug}"`);
 });
 it('provides all eleven actual 1200 by 630 PNGs',()=>{
  const names=['home',...toolPages.map(p=>p.path.slice(1)),...effectRoutes.map(p=>p.slug)];
  for(const name of names){const png=readFileSync(`public/og/${name}.png`);expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(png.readUInt32BE(16)).toBe(1200);expect(png.readUInt32BE(20)).toBe(630);}
 });
 it('links both tools once after the homepage steps',()=>{
  const html=transformHome(source);for(const p of toolPages) expect(html.match(new RegExp(`href="${p.path}"`,'g'))).toHaveLength(1);
  expect(html.indexOf('class="seo-home-links"')).toBeGreaterThan(html.indexOf('id="how"'));
 });
});
