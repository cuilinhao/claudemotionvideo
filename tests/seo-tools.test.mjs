import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {toolPages} from '../scripts/seo/tool-content.mjs';
import {renderToolPage} from '../scripts/seo/pages.mjs';
import {PUBLIC_PAGE_PATHS,siteAssetPath} from '../worker/site-routes';
const source=readFileSync('reference/pages/index.html','utf8');
describe('indexable tool pages',()=>{
 it.each(toolPages)('builds complete $path', page=>{
  const html=renderToolPage(source,page);
  expect(PUBLIC_PAGE_PATHS.has(page.path)).toBe(true);
  expect(siteAssetPath(page.path)).toBe(`${page.path}/index.html`);
  expect(html).toContain(`<h1>${page.h1}</h1>`);
  expect(html).toContain(`href="https://cmotionvideo.com${page.path}"`);
  expect(html.match(/<h1>/g)).toHaveLength(1);
  expect(html).toContain('<ol class="seo-steps">');
  expect(page.introduction.split(/\s+/).length).toBeGreaterThanOrEqual(80);
  expect(page.introduction.split(/\s+/).length).toBeLessThanOrEqual(120);
  expect(page.faqs).toHaveLength(5);
  const schemas=[...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(m=>JSON.parse(m[1]));
  expect(schemas.find(x=>x['@type']==='FAQPage').mainEntity.map(x=>x.acceptedAnswer.text)).toEqual(page.faqs.map(x=>x.answer));
  expect(schemas.find(x=>x['@type']==='HowTo').step.map(x=>x.name)).toEqual(page.steps.map(x=>x.name));
  for(const value of ['30 seconds','16:9 / 9:16 / 1:1','1080p MP4','No Claude subscription or API key required','href="/#pricing"']) expect(html).toContain(value);
 });
 it('keeps scenarios and FAQs distinct',()=>{
  expect(toolPages[0].introduction).not.toEqual(toolPages[1].introduction);
  const first=toolPages[0].faqs.map(f=>f.question);for(const f of toolPages[1].faqs) expect(first).not.toContain(f.question);
 });
});
