import {escapeHtml as e, origin} from './shared.mjs';
import {pageShell,effectLinks} from './pages.mjs';
export function renderEffectPage(source, effect) {
  const {example}=effect;
  const name=effect.h1.replace(/\b[a-z]/g,c=>c.toUpperCase());
  const page={path:`/effects/${effect.slug}`,title:`${name} — Text Animation Effect`,description:effect.description,h1:effect.h1};
  const body=`<header class="seo-intro"><p class="kicker">Claude Motion Video · Effect library</p><h1>${e(effect.h1)}</h1><p class="seo-lede">${e(effect.description)}</p></header>
<section class="seo-section"><h2>The prompt</h2><blockquote class="seo-prompt">${e(effect.prompt)}</blockquote><button class="btn" type="button" data-copy="${e(effect.prompt)}">Copy prompt</button><p>Use this wording with your own text, then describe the colours, pace and reading pause you want.</p></section>
<section class="seo-section"><h2>See the motion</h2><div class="seo-preview"><figure><h3>Effect preview</h3><canvas data-fx="${effect.id}" aria-label="${e(effect.h1)} preview" role="img">${e(effect.description)}</canvas><figcaption>The live preview demonstrates the library effect described in the prompt.</figcaption></figure><figure><h3>Related community example</h3><video controls playsinline preload="none" src="${e(example.contentUrl)}" poster="${e(example.thumbnailUrl)}" aria-label="${e(effect.h1)} related community example"><a href="${e(example.sourceUrl)}">Watch the original example</a></video><figcaption>${e(example.caption)}<br>Shared by <a href="${e(example.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e(example.author)} on X</a>.${example.uploadDate ? ` <time datetime="${example.uploadDate}">Published ${example.uploadDate.slice(0,10)}</time>.` : ''} This is a community reference, not a claim that it was made with this website.</figcaption></figure></div></section>
<section class="seo-cta"><h2>Make the effect your own</h2><p>Learn how to turn your words into a video with the <a href="/text-animation-generator">text animation generator</a>, or return to the <a href="/effects">effects library</a>.</p><a class="btn cta" href="/">Try this effect →</a></section>
<section class="seo-section"><h2>Other effects</h2>${effectLinks(effect.slug)}</section>
<script type="module" src="/reference-assets/_astro/EffectsGrid.astro_astro_type_script_index_0_lang.Cbv7y4w2.js"></script>`;
  const video={'@type':'VideoObject',name:`${effect.h1} example`,description:example.caption,thumbnailUrl:origin+example.thumbnailUrl,contentUrl:example.contentUrl,...(example.uploadDate?{uploadDate:example.uploadDate}:{})};
  return pageShell(source,page,body,[video]);
}
