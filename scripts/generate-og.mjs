#!/usr/bin/env node
/**
 * Regenerate the tracked 1200 × 630 Open Graph cards with local Chrome.
 * Run after npm ci: node scripts/generate-og.mjs [home|page-slug ...]
 * Set CHROME_PATH if Chrome/Chromium is not installed in a standard location.
 * This optional authoring command is deliberately separate from npm run build.
 * It uses the site's existing font packages and no extra npm dependencies.
 */
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { toolPages } from './seo/tool-content.mjs';
import { effectRoutes } from './seo/effect-routes.mjs';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public', 'og');
const width = 1200;
const height = 630;
const palette = { paper: '#faf9f5', ink: '#141413', coral: '#d97757', muted: '#5e5d59', line: '#dad4c6' };
const cards = [
  { slug: 'home', title: 'Animate text and titles with AI', label: 'AI MOTION GRAPHICS' },
  ...toolPages.map(page => ({ slug: page.path.slice(1), title: page.h1, label: 'CREATE WITH AI' })),
  ...effectRoutes.map(effect => ({ slug: effect.slug, title: effect.h1, label: 'TEXT ANIMATION EFFECT' })),
];

async function findChrome() {
  const standardPaths = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
        .filter(Boolean).map(base => path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : standardPaths;
  for (const candidate of candidates) {
    try {
      await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch { /* Try the next standard location. */ }
  }
  throw new Error('Chrome/Chromium was not found. Set CHROME_PATH to its executable, then rerun this command.');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

async function fontFace(family, packageName, weight) {
  const filename = `${packageName}-latin-${weight}-normal.woff2`;
  const file = path.join(root, 'node_modules', '@fontsource', packageName, 'files', filename);
  const bytes = await readFile(file).catch(() => {
    throw new Error(`Missing ${filename}. Run npm ci before regenerating the cards.`);
  });
  return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${bytes.toString('base64')}) format("woff2")}`;
}

function cardHtml(card, fonts, mark) {
  // Deliberate line breaks keep the exact page H1 readable at feed thumbnail sizes.
  const words = card.title.split(' ');
  const breakBefore = card.slug === 'home' ? 2 : words.length - 1;
  const firstLine = words.slice(0, breakBefore).join(' ');
  const secondLine = words.slice(breakBefore).join(' ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(card.title)}</title>
<style>${fonts}
*{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:${palette.paper};color:${palette.ink}}
body{font-family:"Instrument Sans",sans-serif;font-synthesis:none;-webkit-font-smoothing:antialiased}
.card{width:${width}px;height:${height}px;padding:48px 64px 40px;display:flex;flex-direction:column;position:relative}
.brand{display:flex;align-items:center;gap:15px;font-size:28px;font-weight:600;letter-spacing:-.7px;height:50px}
.brand img{width:46px;height:46px}.top-rule{height:1px;background:${palette.line};margin-top:28px}
.content{padding-top:51px;flex:1}.label{font:400 15px/1.2 "DM Mono",monospace;letter-spacing:2.1px;color:${palette.muted};margin-bottom:26px}
h1{font:400 78px/1.08 "Source Serif 4",serif;letter-spacing:-2.7px;margin:0;max-width:1050px}
h1 span{display:block;white-space:nowrap}h1 .accent{color:${palette.coral}}
.footer{display:flex;align-items:center;justify-content:space-between;border-top:1px solid ${palette.line};padding-top:25px}
.domain{font:400 18px/1.2 "DM Mono",monospace;color:${palette.muted};letter-spacing:-.4px}
.format{display:flex;align-items:center;gap:13px;font-size:18px;font-weight:600;letter-spacing:.3px}
.format::before{content:"";width:8px;height:8px;border-radius:50%;background:${palette.coral}}
.motion{position:absolute;right:67px;top:63px;display:flex;align-items:center;gap:9px}
.motion i{display:block;width:7px;height:22px;border-radius:2px;background:${palette.coral};transform:skewX(-14deg)}
.motion i:nth-child(1){opacity:.22}.motion i:nth-child(2){opacity:.5}
</style></head><body><main class="card">
<div class="brand"><img alt="" src="${mark}"><span>Claude Motion Video</span></div>
<div class="motion" aria-hidden="true"><i></i><i></i><i></i></div><div class="top-rule"></div>
<section class="content"><div class="label">${escapeHtml(card.label)}</div>
<h1><span>${escapeHtml(firstLine)}</span><span class="accent">${escapeHtml(secondLine)}</span></h1></section>
<footer class="footer"><span class="domain">claudemotionvideo.com</span><span class="format">1080p MP4</span></footer>
</main><script>
// All fonts are embedded, so generation never depends on a network font service.
document.fonts.ready.then(() => {
  const title = document.querySelector('h1');
  while ([...title.children].some(line => line.scrollWidth > title.clientWidth)) {
    const size = parseFloat(getComputedStyle(title).fontSize);
    if (size <= 56) throw new Error('Share card title does not fit.');
    title.style.fontSize = (size - 1) + 'px';
  }
});
</script></body></html>`;
}

function verifyDimensions(bytes, slug) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)
    || bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height) {
    throw new Error(`${slug}.png is not a ${width} × ${height} PNG.`);
  }
}

async function main() {
  const requested = process.argv.slice(2);
  for (const slug of requested) {
    if (!cards.some(card => card.slug === slug)) throw new Error(`Unknown card: ${slug}. Valid names: ${cards.map(card => card.slug).join(', ')}`);
  }
  const selected = requested.length ? cards.filter(card => requested.includes(card.slug)) : cards;
  const chrome = await findChrome();
  const fonts = (await Promise.all([
    fontFace('Source Serif 4', 'source-serif-4', 400),
    fontFace('Instrument Sans', 'instrument-sans', 600),
    fontFace('DM Mono', 'dm-mono', 400),
  ])).join('\n');
  const mark = `data:image/svg+xml;base64,${(await readFile(path.join(root, 'public', 'favicon.svg'))).toString('base64')}`;
  const temporary = await mkdtemp(path.join(tmpdir(), 'cmv-og-'));
  await mkdir(output, { recursive: true });
  try {
    for (const card of selected) {
      const html = path.join(temporary, `${card.slug}.html`);
      const png = path.join(temporary, `${card.slug}.png`);
      await writeFile(html, cardHtml(card, fonts, mark));
      await run(chrome, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--disable-background-networking', '--hide-scrollbars',
        '--force-device-scale-factor=1', '--font-render-hinting=none', '--disable-lcd-text',
        `--user-data-dir=${path.join(temporary, 'chrome-profile')}`,
        `--window-size=${width},${height}`, '--virtual-time-budget=1500', '--timeout=10000',
        `--screenshot=${png}`, pathToFileURL(html).href,
      ], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      const bytes = await readFile(png);
      verifyDimensions(bytes, card.slug);
      await writeFile(path.join(output, `${card.slug}.png`), bytes);
      console.log(`public/og/${card.slug}.png — ${width} × ${height}, ${bytes.length} bytes`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
