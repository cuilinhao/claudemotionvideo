import {transformHome} from './home.mjs';
import {effectContent} from './effect-content.mjs';
import {effectRoutes} from './effect-routes.mjs';
import {plainText,readFaqs,origin} from './shared.mjs';
export function generateLlmsFull(source) {
  const html=transformHome(source);
  const main=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1];
  if (!main) throw new Error('Homepage body is required for llms-full.txt');
  const withoutFaq=main.replace(/<section\b[^>]*id="faq"[^>]*>[\s\S]*?<\/section>/,'');
  // Gallery cards are third-party user submissions, not the site's English editorial copy.
  const editorial=withoutFaq.replace(/<button\b[^>]*class="card"[^>]*>[\s\S]*?<\/button>/g,'');
  const body=editorial.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g,'').replace(/<\/(?:h[1-6]|p|section|li|article|summary|figcaption)>/g,'\n').split('\n').map(plainText).filter(Boolean).join('\n\n');
  const effects=effectRoutes.map(route=>{
    const content=effectContent.find(x=>x.slug===route.slug);
    if (!content) throw new Error(`Missing ${route.slug} in full corpus`);
    return `## ${route.h1}\n\n${origin}/effects/${route.slug}\n\n${content.description}\n\nThe prompt: ${content.prompt}`;
  }).join('\n\n');
  const faq=readFaqs(html).map(({question,answer})=>`### ${question}\n\n${answer}`).join('\n\n');
  return `# Claude Motion Video — complete text\n\nIndependent product. Not affiliated with Anthropic.\n\nSource: ${origin}/\n\n## Homepage\n\n${body}\n\n# Effect descriptions\n\n${effects}\n\n# Frequently asked questions\n\n${faq}\n`;
}
