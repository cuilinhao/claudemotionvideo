export const origin = 'https://cmotionvideo.com';
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const plainText = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
export const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org', ...data}).replace(/</g, '\\u003c')}</script>`;
export function metadata(html, {title, description, path = '/'}) {
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  for (const [attribute, key, value] of [
    ['name','description',description], ['property','og:title',title], ['property','og:description',description],
    ['property','og:url',origin + path], ['name','twitter:title',title], ['name','twitter:description',description],
  ]) {
    const tag = `<meta ${attribute}="${key}" content="${escapeHtml(value)}">`;
    const pattern = new RegExp(`<meta\\b(?=[^>]*${attribute}=["']${key}["'])[^>]*>`, 'i');
    html = pattern.test(html) ? html.replace(pattern, tag) : html.replace('</head>', `${tag}</head>`);
  }
  return html.replace(/<link\b(?=[^>]*rel=["']canonical["'])[^>]*>/i, `<link rel="canonical" href="${origin + path}">`);
}
export const faqSchema = (faqs) => ({'@type':'FAQPage',mainEntity:faqs.map(({question,answer})=>({'@type':'Question',name:question,acceptedAnswer:{'@type':'Answer',text:answer}}))});
export const howToSchema = (name, steps) => ({'@type':'HowTo', name, step:steps.map(({name,text})=>({'@type':'HowToStep',name,...(text ? {text} : {})}))});
export function readFaqs(html) {
  const faq = html.match(/<section\b[^>]*id="faq"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  if (!faq) throw new Error('Missing visible FAQ section');
  return [...faq.matchAll(/<details\b[^>]*>[\s\S]*?<h3>([\s\S]*?)<\/h3>[\s\S]*?<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map(([,q,a])=>({question:plainText(q),answer:plainText(a)}));
}
