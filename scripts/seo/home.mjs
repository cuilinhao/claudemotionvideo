import {plans} from '../../src/lib/content.ts';
import {effectRoutes} from './effect-routes.mjs';
import {metadata, plainText, jsonLd, faqSchema, howToSchema, readFaqs, origin} from './shared.mjs';
export const homeMetadata = {
  title:'Text Animation Generator — Animate Text & Titles With AI',
  description:'Turn a sentence, a screenshot or a title into an animated video. Describe the motion in chat, review the new version, and export a 1080p MP4 — no timeline editing.',
};
const firstAnswer = 'A text animation generator turns typed words into animated video without a timeline editor. You write the text, describe the motion you want in chat, and export a 1080p MP4. Claude Motion Video renders every frame as code, so your text and UI stay perfectly sharp and you can change one line without re-rendering the whole clip.';
export function transformHome(source) {
  let html = source.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  // Remove the old primary phrase from repeated headings; retain it once in visible prose.
  html = html.replace(/AI motion graphics/g, 'Motion graphics');
  html = html.replace(/<h1>[\s\S]*?<\/h1>/, '<h1>Text animation generator</h1>');
  html = html.replace('Motion graphics generator</p>', 'Animate text and titles with AI</p>');
  html = html.replace('Describe an edit by chat and review the new version.</p>', 'Describe an edit by chat and review the new version. Unlike most AI motion graphics tools, every frame is code.</p>');
  html = html.replace('Motion graphics effects you can ask for</h2>', 'Animated text and title effects you can ask for</h2>');
  html = html.replace('How to make Motion graphics</h2>', 'How to make animated text with AI</h2>');
  html = html.replace('Start your Motion graphics', 'Start your text animation');
  html = html.replace('Motion graphics work the other way.', 'Code-based animation works the other way.');
  html = html.replace('An Motion graphics generator', 'A motion graphics generator');
  html = html.replace('How are Motion graphics different', 'How are code-based animations different');
  html = html.replace(/<section\b[^>]*id="effects"[^>]*>[\s\S]*?<\/section>/, section => {
    section = section.replace('<div class="fx-grid">', '<ul class="fx-grid" style="list-style:none;padding:0;margin:0">');
    for (const effect of effectRoutes) {
      section = section.replace(`<h3>${effect.name}</h3>`, `<p class="effect-name"><a href="/effects/${effect.slug}">${effect.name}</a></p>`);
    }
    return section.replace(/<article\b/g, '<li').replace(/<\/article>/g,'</li>').replace(/<\/div><\/div><\/section>$/, '</ul></div></section>');
  });
  html = html.replace(/(<section\b[^>]*id="faq"[^>]*>[\s\S]*?<details>[\s\S]*?<h3>)[\s\S]*?<\/h3><\/summary><p>[\s\S]*?<\/p>/, `$1What is a text animation generator?</h3></summary><p>${firstAnswer}</p>`);
  html = metadata(html, homeMetadata);
  const faqs = readFaqs(html);
  if (faqs.length !== 8) throw new Error('Expected exactly eight visible homepage FAQs');
  const how = html.match(/<section\b[^>]*id="how"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? '';
  const steps = [...how.matchAll(/<h3>(.*?)<\/h3><p>([\s\S]*?)<\/p>/g)].map(([,name,text])=>({name:plainText(name),text:plainText(text)}));
  if (steps.length !== 3) throw new Error('Expected three visible homepage steps');
  const starter=plans.find(p=>p.id==='starter'), max=plans.find(p=>p.id==='max');
  if (!starter || !max) throw new Error('Starter and Max pricing must exist');
  const schema = jsonLd({'@type':'SoftwareApplication',name:'Claude Motion Video',description:homeMetadata.description,url:origin+'/',applicationCategory:'MultimediaApplication',operatingSystem:'Web',offers:{'@type':'AggregateOffer',priceCurrency:'USD',lowPrice:starter.monthly,highPrice:max.monthly,offerCount:plans.length},featureList:[
    'Text and title animation from a sentence or screenshot','Every frame rendered as code','Edit a single line without re-rendering the clip','Export 1080p MP4 in 16:9, 9:16 or 1:1',
  ]}) + jsonLd(faqSchema(faqs)) + jsonLd(howToSchema('How to make animated text with AI',steps));
  return html.replace('</head>', `${schema}</head>`);
}
