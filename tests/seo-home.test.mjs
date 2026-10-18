import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {transformHome, homeMetadata} from '../scripts/seo/home.mjs';
import {readFaqs, plainText} from '../scripts/seo/shared.mjs';
import {effectRoutes} from '../scripts/seo/effect-routes.mjs';
import {plans} from '../src/lib/content.ts';
const source=readFileSync('reference/pages/index.html','utf8');
const schemas=(html)=>[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1]));
describe('homepage SEO output',()=>{
 it('renders exact metadata and one natural legacy phrase',()=>{
  const html=transformHome(source);
  expect(plainText(html.match(/<title>(.*?)<\/title>/)[1])).toBe('Text Animation Generator — Animate Text & Titles With AI');
  expect(html).toContain('<h1>Text animation generator</h1>');
  expect(html).toContain('name="twitter:title"');
  expect(homeMetadata.description).toBe('Turn a sentence, a screenshot or a title into an animated video. Describe the motion in chat, review the new version, and export a 1080p MP4 — no timeline editing.');
  expect((plainText(html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)[1]).match(/ai motion graphics/gi)||[]).length).toBe(1);
 });
 it('links the eight named effects as list items and preserves specifications',()=>{
  const html=transformHome(source);
  for(const e of effectRoutes) expect(html).toContain(`<a href="/effects/${e.slug}">${e.name}</a>`);
  expect(html).toContain('<ul class="fx-grid"');
  expect(html).not.toMatch(/<h3>(Letter drop|Masked rise|Typewriter cursor)<\/h3>/);
  for(const text of ['Up to 30s','1080p MP4',"Change it, don't re-roll it",'16:9']) expect(html).toContain(text);
 });
 it('maps precisely the eight visible questions and real monthly prices',()=>{
  const html=transformHome(source), data=schemas(html), faqs=readFaqs(html);
  expect(faqs).toHaveLength(8);
  expect(faqs[0].question).toBe('What is a text animation generator?');
  const faq=data.find(x=>x['@type']==='FAQPage');
  expect(faq.mainEntity.map(x=>({question:x.name,answer:x.acceptedAnswer.text}))).toEqual(faqs);
  const app=data.find(x=>x['@type']==='SoftwareApplication');
  expect(app.offers).toEqual({'@type':'AggregateOffer',priceCurrency:'USD',lowPrice:plans[0].monthly,highPrice:plans[2].monthly,offerCount:plans.length});
  expect(JSON.stringify(data)).not.toMatch(/aggregateRating|reviewCount/);
  expect(data.find(x=>x['@type']==='HowTo').step.map(x=>x.name)).toEqual(['Add a screenshot or a sentence','Watch it get made','Change any part, then export']);
 });
});
