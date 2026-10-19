import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {generateLlmsFull} from '../scripts/seo/llms.mjs';
import {transformHome} from '../scripts/seo/home.mjs';
import {readFaqs} from '../scripts/seo/shared.mjs';
import {effectContent} from '../scripts/seo/effect-content.mjs';
const source=readFileSync('reference/pages/index.html','utf8');
describe('LLM readable corpus',()=>{
 it('contains complete visible homepage FAQs and all effect descriptions and prompts',()=>{
  const full=generateLlmsFull(source);
  for(const f of readFaqs(transformHome(source))) {expect(full).toContain(f.question);expect(full).toContain(f.answer);}
  for(const e of effectContent) {expect(full).toContain(e.description);expect(full).toContain(e.prompt);}
  expect(full).not.toMatch(/<script|<div|aria-hidden|[\u4e00-\u9fff]/);
  expect(full).toContain('Independent product. Not affiliated with Anthropic.');
 });
 it('preserves required concise entry point',()=>{
  const brief=readFileSync('public/llms.txt','utf8');
  for(const p of ['text-animation-generator','animated-title-generator','examples','effects','pricing']) expect(brief).toContain(`https://cmotionvideo.com/${p}`);
  expect(brief).toContain('Max clip length: 30 seconds');
  expect(brief).not.toMatch(/\[占位\]/);
 });
});
