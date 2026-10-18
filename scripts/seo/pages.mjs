import {escapeHtml as e, metadata, jsonLd, faqSchema, howToSchema} from './shared.mjs';
import {effectRoutes} from './effect-routes.mjs';
export function pageShell(source, page, body, schemas=[]) {
  const main = `<main class="seo-page" id="main-content">${body}</main>`;
  let html = source.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '').replace(/<main\b[^>]*>[\s\S]*?<\/main>/, main);
  if (!html.includes(main)) throw new Error('Page shell must contain a main element');
  html = metadata(html, page);
  return html.replace('</head>', `<link rel="stylesheet" href="/seo.css">${schemas.map(jsonLd).join('')}</head>`);
}
export const effectLinks = (exclude) => `<ul class="seo-effect-links">${effectRoutes.filter(x=>x.slug!==exclude).map(x=>`<li><a href="/effects/${x.slug}">${e(x.name)}</a></li>`).join('')}</ul>`;
export function renderToolPage(source, page) {
  const body = `<header class="seo-intro"><p class="kicker">Claude Motion Video · Text &amp; titles</p><h1>${e(page.h1)}</h1><p class="seo-lede">${e(page.introduction)}</p><a class="btn cta" href="/#create">Create your animation →</a></header>
<section class="seo-section"><h2>How it works</h2><ol class="seo-steps">${page.steps.map(step=>`<li><h3>${e(step.name)}</h3><p>${e(step.text)}</p></li>`).join('')}</ol></section>
<section class="seo-section"><h2>Made for your message</h2><div class="seo-scenarios">${page.sections.map(s=>`<article><h3>${e(s.heading)}</h3><p>${e(s.text)}</p></article>`).join('')}</div></section>
<section class="seo-section"><h2>Video specifications</h2><table class="seo-specs"><caption>Available output and account requirements</caption><tbody><tr><th scope="row">Maximum clip length</th><td>30 seconds</td></tr><tr><th scope="row">Aspect ratios</th><td>16:9 / 9:16 / 1:1</td></tr><tr><th scope="row">Export</th><td>1080p MP4</td></tr><tr><th scope="row">Account</th><td>No Claude subscription or API key required</td></tr></tbody></table></section>
<section class="seo-section"><h2>Text effects you can ask for</h2><p>Give the motion a name, then adjust the pace and emphasis for your own words.</p>${effectLinks()}</section>
<section class="seo-section faq" id="faq"><h2>Frequently asked questions</h2>${page.faqs.map((faq,i)=>`<details><summary><span class="faq-n">${String(i+1).padStart(2,'0')}</span><h3>${e(faq.question)}</h3></summary><p>${e(faq.answer)}</p></details>`).join('')}</section>
<section class="seo-cta"><p class="kicker">Put your words in motion</p><h2>Start with a sentence. Refine it in chat.</h2><p>Browse <a href="/examples">real animation examples</a> or compare <a href="/pricing">plans and credits</a>.</p><a class="btn cta" href="/#pricing">Choose a plan →</a></section>`;
  return pageShell(source,page,body,[faqSchema(page.faqs),howToSchema(`How to make ${page.path.includes('title')?'animated titles':'animated text'} with AI`,page.steps)]);
}
