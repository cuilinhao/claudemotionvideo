import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { transformHome } from './seo/home.mjs';
import { toolPages } from './seo/tool-content.mjs';
import { renderToolPage } from './seo/pages.mjs';
import { effectRoutes } from './seo/effect-routes.mjs';
import { effectContent } from './seo/effect-content.mjs';
import { renderEffectPage } from './seo/effect-pages.mjs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const templates = path.join(root, 'reference', 'pages');
const reactEntry = path.join(dist, 'index.html');
const referenceEntry = path.join(dist, 'reference.html');
const staticRoutes = [
  'index.html',
  'pricing/index.html',
  'blogs/index.html',
  'terms/index.html',
  'privacy/index.html',
  'opus-5-5-video-generator/index.html',
  'examples/index.html',
  'effects/index.html',
  'featured/index.html',
  'contact/index.html',
  'refunds/index.html',
  'blogs/opus-5-5-video-prompt-guide/index.html',
  'blogs/opus-5-5-video-examples/index.html',
];
const appRoutes = [
  'studio/index.html',
  'my-videos/index.html',
  'reset-password/index.html',
  'sign-in/index.html',
  'account/index.html',
  '404.html',
];

function extractAppTags(html) {
  const script = html.match(/<script\b(?=[^>]*type="module")(?=[^>]*\bsrc="[^"]+")[^>]*><\/script>/i)?.[0];
  const styles = [...html.matchAll(/<link\b(?=[^>]*rel="stylesheet")(?=[^>]*\bhref="[^"]+")[^>]*>/gi)].map((m) => m[0]);
  if (!script || styles.length === 0) {
    throw new Error('Vite reference.html must contain the built module script and stylesheet link.');
  }
  return { script, styles };
}

function injectAppTags(html, tags) {
  if (html.includes('data-cmv-app-bundle')) return html;
  const bundle = `${tags.styles.join('\n')}\n${tags.script.replace('<script ', '<script data-cmv-app-bundle ')}\n`;
  if (!/<\/head>/i.test(html)) throw new Error('Static page is missing </head>.');
  return html.replace(/<\/head>/i, `${bundle}</head>`);
}

async function ensureReactShells() {
  const shell = await readFile(reactEntry, 'utf8');
  for (const route of appRoutes) {
    const destination = path.join(dist, route);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(reactEntry, destination);
  }
  return shell;
}

async function build() {
  let entries;
  try {
    entries = await readdir(templates, { withFileTypes: true });
  } catch {
    throw new Error(`Reference templates not found: ${templates}`);
  }
  if (!entries.length) throw new Error('Reference template directory is empty.');
  let appHtml;
  try {
    appHtml = await readFile(referenceEntry, 'utf8');
  } catch {
    throw new Error('Expected dist/reference.html from the Vite multi-page build; refusing to build static pages without the React bridge entry.');
  }
  const tags = extractAppTags(appHtml);
  await ensureReactShells();

  for (const route of staticRoutes) {
    const source = path.join(templates, route);
    const html = await readFile(source, 'utf8');
    if (/<script\b[^>]*(?:umami|googletagmanager|google-analytics)/i.test(html)) {
      throw new Error(`Tracking script remains in ${source}`);
    }
    if (/component-url="[^"]*(?:AccountMenu|SupportChat)/.test(html)) {
      throw new Error(`Dynamic original account/support island remains in ${source}`);
    }
    const destination = path.join(dist, route);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, injectAppTags(route === 'index.html' ? transformHome(html) : html, tags));
  }

  const homepageSource = await readFile(path.join(templates, 'index.html'), 'utf8');
  for (const page of toolPages) {
    const destination = path.join(dist, page.path.slice(1), 'index.html');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, injectAppTags(renderToolPage(homepageSource, page), tags));
  }

  for (const route of effectRoutes) {
    const content = effectContent.find(effect => effect.slug === route.slug);
    if (!content) throw new Error(`Missing effect content for ${route.slug}`);
    const destination = path.join(dist, 'effects', route.slug, 'index.html');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, injectAppTags(renderEffectPage(homepageSource, { ...route, ...content }), tags));
  }

  const alias = path.join(dist, 'refund', 'index.html');
  await mkdir(path.dirname(alias), { recursive: true });
  await writeFile(alias, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/refunds"><link rel="canonical" href="https://claudemotionvideo.com/refunds"><title>Redirecting…</title></head><body><p>Redirecting to <a href="/refunds">Refund Policy</a>.</p><script>location.replace("/refunds"+location.search+location.hash)</script></body></html>\n');
  await unlink(referenceEntry);
  console.log(`Built ${staticRoutes.length} reference pages, ${toolPages.length} tool pages, ${effectRoutes.length} effect pages, ${appRoutes.length} React route shells, and /refund redirect.`);
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
