import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectRoutes } from './seo/effect-routes.mjs';
import { toolPages } from './seo/tool-content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const expectedStaticRoutes = [
  '/', '/pricing', '/blogs', '/terms', '/privacy', '/opus-5-5-video-generator',
  '/examples', '/effects', '/featured', '/contact', '/refunds',
  '/blogs/opus-5-5-video-prompt-guide', '/blogs/opus-5-5-video-examples',
];
const expectedReactRoutes = ['/studio', '/my-videos', '/reset-password', '/sign-in', '/account'];
const problems = [];
const checked = new Set();
let resourceCount = 0;
let staticPageCount = 0;

function fail(message) { problems.push(message); }
function trimUrl(value) { return value.split('#', 1)[0].split('?', 1)[0]; }
function isExternal(value) { return /^(?:https?:)?\/\//i.test(value); }
function isSkippable(value) {
  return !value || value.startsWith('#') || /^(?:data:|blob:|javascript:|mailto:|tel:)/i.test(value);
}
function localFile(urlPath) {
  const decoded = decodeURIComponent(trimUrl(urlPath));
  const clean = decoded.startsWith('/') ? decoded.slice(1) : decoded;
  const normalized = path.resolve(dist, clean);
  if (!normalized.startsWith(`${dist}${path.sep}`) && normalized !== dist) return null;
  return normalized.endsWith(path.sep) || !path.extname(normalized)
    ? path.join(normalized, 'index.html')
    : normalized;
}

async function requireLocal(ref, containingFile, label, isNavigation = false) {
  if (isSkippable(ref)) return null;
  if (isExternal(ref)) {
    if (isNavigation) return null;
    fail(`${label} still loads an external resource: ${ref}`);
    return null;
  }
  let file;
  if (ref.startsWith('/')) file = localFile(ref);
  else file = path.resolve(path.dirname(containingFile), trimUrl(ref));
  if (!file || (!file.startsWith(`${dist}${path.sep}`) && file !== dist)) {
    fail(`${label} escapes dist: ${ref}`);
    return null;
  }
  try {
    await stat(file);
    resourceCount++;
    return file;
  } catch {
    fail(`${label} is missing: ${ref} (from ${path.relative(dist, containingFile)})`);
    return null;
  }
}

function attrMap(tag) {
  const attrs = new Map();
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? '');
  }
  return attrs;
}

async function inspectCss(file) {
  if (checked.has(file)) return;
  checked.add(file);
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?/gi)) {
    const importFile = await requireLocal(match[1], file, 'CSS @import');
    if (importFile?.endsWith('.css')) await inspectCss(importFile);
  }
  for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const target = match[1].trim();
    const resource = await requireLocal(target, file, target.includes('.woff') ? 'Font' : 'CSS URL');
    if (resource?.endsWith('.css')) await inspectCss(resource);
  }
}

async function inspectJs(file) {
  if (checked.has(file)) return;
  checked.add(file);
  const text = await readFile(file, 'utf8');
  if (/umami\.mcpgood\.com|G-Z658WTJCB4|90324e5e-d536-4777-aeab-c43672adf0e9|api\.tellcut\.app|tellcut\.app\/api/i.test(text)) {
    fail(`Original tracking or Tellcut API reference remains in ${path.relative(dist, file)}`);
  }
  await inspectJsSource(text, file);
}

async function inspectJsSource(text, file) {
  // Covers static imports, side-effect imports and literal dynamic imports emitted by Vite/Astro.
  for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (isExternal(specifier) || specifier.startsWith('node:')) {
      fail(`JavaScript bundle has an external module import: ${specifier}`);
      continue;
    }
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
    const target = await requireLocal(specifier, file, 'JavaScript import');
    if (target?.endsWith('.js') || target?.endsWith('.mjs')) await inspectJs(target);
    if (target?.endsWith('.css')) await inspectCss(target);
  }
}

async function inspectHtml(file, route) {
  const html = await readFile(file, 'utf8');
  if (/data-id="\d+"/.test(html) && !/<meta\b[^>]*name="referrer"[^>]*content="(?:same-origin|no-referrer)"/i.test(html)) {
    fail(`${route}: inline video pages must omit the cross-origin Referer required by the media CDN`);
  }
  if (/umami\.mcpgood\.com|G-Z658WTJCB4|90324e5e-d536-4777-aeab-c43672adf0e9/i.test(html)) {
    fail(`${route}: original Umami/Google tracking remains`);
  }
  if (/tellcut\.app|api\.tellcut|Tellcut/i.test(html)) fail(`${route}: original Tellcut identity/API remains`);
  if (/component-url="[^"]*(?:AccountMenu|SupportChat)/i.test(html)) fail(`${route}: original auth/support island remains`);

  for (const tagMatch of html.matchAll(/<(script|link|img|source|video|audio|iframe|image|use|a)\b[^>]*>/gi)) {
    const tagName = tagMatch[1].toLowerCase();
    const tag = tagMatch[0];
    const attrs = attrMap(tag);
    const rel = (attrs.get('rel') ?? '').toLowerCase();
    for (const attribute of ['src', 'poster', 'href', 'xlink:href', 'data-src']) {
      const ref = attrs.get(attribute);
      if (ref === undefined) continue;
      const navigation = tagName === 'a' || (tagName === 'link' && /^(?:canonical|alternate|author|license)$/i.test(rel));
      const target = await requireLocal(ref, file, `${tagName}[${attribute}]`, navigation);
      if (!target) continue;
      if (target.endsWith('.css')) await inspectCss(target);
      if (target.endsWith('.js') || target.endsWith('.mjs')) await inspectJs(target);
    }
    const srcset = attrs.get('srcset');
    if (srcset) {
      for (const candidate of srcset.split(',')) {
        const ref = candidate.trim().split(/\s+/, 1)[0];
        const target = await requireLocal(ref, file, `${tagName}[srcset]`);
        if (target?.endsWith('.css')) await inspectCss(target);
        if (target?.endsWith('.js') || target?.endsWith('.mjs')) await inspectJs(target);
      }
    }
  }
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = attrMap(`<script ${script[1]}>`);
    if (attrs.get('type')?.toLowerCase() === 'module' && !attrs.has('src')) {
      await inspectJsSource(script[2], file);
    }
  }
  for (const match of html.matchAll(/style\s*=\s*(["'])(.*?)\1/gi)) {
    for (const url of match[2].matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      const target = await requireLocal(url[1].trim(), file, 'Inline CSS URL');
      if (target?.endsWith('.css')) await inspectCss(target);
    }
  }
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const url of match[1].matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      const target = await requireLocal(url[1].trim(), file, 'Inline stylesheet URL');
      if (target?.endsWith('.css')) await inspectCss(target);
    }
  }
  return html;
}

async function checkRouteSet() {
  const staticRoutes = [];
  for (const route of expectedStaticRoutes) {
    const file = localFile(route);
    try { await stat(file); staticRoutes.push(route); }
    catch { fail(`Missing static route ${route}`); }
  }
  for (const route of expectedReactRoutes) {
    try { await stat(localFile(route)); }
    catch { fail(`Missing React route shell ${route}`); }
  }
  try { await stat(path.join(dist, '404.html')); }
  catch { fail('Missing Cloudflare 404 shell (dist/404.html)'); }
  const files = [];
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name);
      if (item.isDirectory()) await walk(full);
      else if (item.name.endsWith('.html')) files.push(full);
    }
  }
  await walk(dist);
  const htmlRoutes = files.map((file) => `/${path.relative(dist, file).replace(/\/index\.html$/, '').replace(/\.html$/, '')}`).map((x) => x === '/index' ? '/' : x);
  const expected = [...expectedStaticRoutes, ...expectedReactRoutes, ...toolPages.map(page => page.path), ...effectRoutes.map(effect => `/effects/${effect.slug}`), '/refund', '/404'];
  const unexpected = htmlRoutes.filter((route) => !expected.includes(route));
  const duplicated = htmlRoutes.filter((route, i) => htmlRoutes.indexOf(route) !== i);
  if (unexpected.length) fail(`Unexpected HTML routes: ${unexpected.join(', ')}`);
  if (duplicated.length) fail(`Duplicate HTML routes: ${duplicated.join(', ')}`);
  return staticRoutes;
}

async function checkProductCopy() {
  const pages = [
    ['/', 'index.html'],
    ['/pricing', 'pricing/index.html'],
    ['/refunds', 'refunds/index.html'],
    ['/privacy', 'privacy/index.html'],
    ['/opus-5-5-video-generator', 'opus-5-5-video-generator/index.html'],
  ];
  const forbidden = [
    /app for iPhone/i,
    /automated safety filter/i,
    /finds its parts/i,
    /cuts those parts out/i,
    /frames of the result are also sent back/i,
    /deleted automatically after about a day/i,
    /delete your account yourself/i,
    /point at a part of your image/i,
    /checked against your image/i,
    /pixel-exact/i,
    /one trial per person and card/i,
    /we email you a day before/i,
    /within 7 days and we(?:&#39;|')ll refund/i,
    /comes back incomplete.{0,180}credits.{0,80}automatically/i,
  ];
  for (const [route, rel] of pages) {
    try {
      const html = await readFile(path.join(dist, rel), 'utf8');
      for (const pattern of forbidden) {
        if (pattern.test(html)) fail(`${route}: unsupported product/legal claim remains (${pattern})`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') fail(`${route}: unable to verify product copy: ${error.message}`);
    }
  }
}

async function checkExamplesAndEffects() {
  const examplesPath = path.join(dist, 'reference-assets/data/examples.json');
  let exampleData;
  try { exampleData = JSON.parse(await readFile(examplesPath, 'utf8')); }
  catch { fail('Missing or invalid reference-assets/data/examples.json'); return { examples: 0, effects: 0 }; }
  const examples = Object.values(exampleData);
  if (examples.length !== 470) fail(`Expected 470 X examples, found ${examples.length}`);
  for (const example of examples) {
    if (!example.postUrl || !/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(example.postUrl)) {
      fail(`Example ${example.id ?? '(unknown)'} is missing a public X attribution URL`);
    }
    if (!example.poster?.startsWith('/reference-assets/')) {
      fail(`Example ${example.id ?? '(unknown)'} poster is not local: ${example.poster}`);
      continue;
    }
    try { await stat(localFile(example.poster)); }
    catch { fail(`Example ${example.id ?? '(unknown)'} poster file is missing: ${example.poster}`); }
  }

  // Playback is resolved ahead of time; visitors only fetch this same-origin map.
  let media = {};
  try { media = JSON.parse(await readFile(path.join(dist, 'reference-assets/data/example-media.json'), 'utf8')); }
  catch { fail('Missing or invalid reference-assets/data/example-media.json'); }
  for (const [id, item] of Object.entries(media)) {
    if (!Object.hasOwn(exampleData, id)) fail(`Video source has no matching example: ${id}`);
    try {
      const url = new URL(item.url);
      if (url.protocol !== 'https:' || url.hostname !== 'video.twimg.com' || url.port || url.username || url.password || !url.pathname.endsWith('.mp4') || item.type !== 'video/mp4') {
        fail(`Example ${id} has an unsupported video source`);
      }
    } catch { fail(`Example ${id} has an invalid video source URL`); }
    if (!(Number.isFinite(item.width) && item.width > 0 && Number.isFinite(item.height) && item.height > 0)) {
      fail(`Example ${id} has invalid video dimensions`);
    }
  }
  const missingMedia = examples.filter(example => !Object.hasOwn(media, example.id));
  if (missingMedia.length) fail(`Missing inline video sources for ${missingMedia.length} examples: ${missingMedia.map(example => example.id).join(', ')}`);
  console.log(`Inline video sources: ${Object.keys(media).length}/${examples.length} examples.`);

  let ticker;
  const assets = path.join(dist, 'reference-assets/_astro');
  async function findTicker(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name);
      if (item.isDirectory()) { const result = await findTicker(full); if (result) return result; }
      else if (/effect-ticker.*\.js$/i.test(item.name)) return full;
    }
    return null;
  }
  try { ticker = await findTicker(assets); }
  catch { /* reported below */ }
  if (!ticker) { fail('Missing effects ticker JavaScript bundle'); return { examples: examples.length, effects: 0 }; }
  const source = await readFile(ticker, 'utf8');
  const effects = new Set([...source.matchAll(/\{id:`([^`]+)`,name:`/g)].map((m) => m[1])).size;
  if (effects !== 21) fail(`Expected 21 effects, found ${effects}`);
  return { examples: examples.length, effects };
}

async function main() {
  await checkRouteSet();
  const staticHtmlFiles = expectedStaticRoutes.map(localFile);
  for (let index = 0; index < staticHtmlFiles.length; index++) {
    try { await inspectHtml(staticHtmlFiles[index], expectedStaticRoutes[index]); }
    catch (error) { fail(`${expectedStaticRoutes[index]}: ${error.message}`); }
    staticPageCount++;
  }
  const { examples, effects } = await checkExamplesAndEffects();
  await checkProductCopy();
  console.log(`Reference audit: ${staticPageCount} static routes, ${expectedStaticRoutes.filter((route) => route.startsWith('/blogs/')).length} blog articles, ${examples} examples, ${effects} effects, ${resourceCount} local resource references checked.`);
  if (problems.length) {
    console.error(`Audit failed (${problems.length} issue${problems.length === 1 ? '' : 's'}):`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
  } else {
    console.log('Reference build closure and route/content checks passed.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
