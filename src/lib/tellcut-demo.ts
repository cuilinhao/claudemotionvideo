import originalDemo from './tellcut-lucky-spin.json';
import originalStudio from './tellcut-studio-data.json';
import { buildTrustedDemoDocument } from './renderer';

// Public source fixtures, extracted as literal data from Studio.DQsOOOob.js,
// Scenarios.BaeqU6wS.js and effect-ticker.CCyLZTl6.js. No remote code is evaluated.
export const demo = originalDemo;
export const studioScenarios = originalStudio.scenarios;
export const studioPalettes = originalStudio.palettes;
export const studioEffects = originalStudio.effects;
export type StudioScenario = typeof studioScenarios[number];

export function applyDemoPresets(ids: string[]): string {
  let html = demo.code;
  const applied = new Set<string>();
  for (const id of ids) {
    const preset = demo.presets.find(p => p.id === id);
    if (!preset) throw new Error('Unknown example change.');
    if (applied.has(id)) throw new Error('This example change was already applied.');
    for (const block of preset.blocks) {
      if (html.split(block.search).length !== 2) throw new Error('The original example change no longer matches.');
      html = html.replace(block.search, block.replace);
    }
    applied.add(id);
  }
  return html;
}

export function buildDemoDocument(ids: string[], assets: Record<string, string>, fontCss: string, channel: string): string {
  if (fontCss.length > 1_300_000 || /<|>|@import/i.test(fontCss)
    || [...fontCss.matchAll(/url\(([^)]+)\)/g)].some(m => !/^['"]?data:font\/woff2;base64,[A-Za-z0-9+/]+={0,2}['"]?$/.test(m[1]))) {
    throw new Error('Invalid example font resource.');
  }
  const html = applyDemoPresets(ids).replace(/<link\b[^>]*>/gi, '')
    .replace('<script>', `<style>${fontCss}</style><script>window.__ASSETS__=window.ASSETS;${originalStudio.assetHelper}</script><script>`);
  return buildTrustedDemoDocument(html, assets, channel);
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The example resource could not be read.'));
    reader.readAsDataURL(blob);
  });
}

let resources: Promise<{ assets: Record<string, string>; fontCss: string }> | undefined;
export function loadDemoResources() {
  if (!resources) {
    resources = (async () => {
      const read = async (url: string) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error('The example resources could not load. Please retry.');
        return response;
      };
      const [assets, css] = await Promise.all([
        Promise.all(Object.entries(demo.assets).map(async ([id, url]) => [id, await dataUrl(await (await read(`/reference-assets${url}`)).blob())])),
        read('/reference-assets/fonts/baloo-2.css').then(r => r.text()),
      ]);
      // The original demo uses Latin text. Keep the original Latin font face;
      // embedding its bytes avoids all network access from the opaque iframe.
      const latinFaces = [...css.matchAll(/\/\* latin \*\/\s*(@font-face\s*\{[^}]+\})/g)].map(m => m[1]).join('\n');
      if (!latinFaces) throw new Error('The example font could not load.');
      let fontCss = latinFaces;
      for (const url of new Set([...latinFaces.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]))) {
        if (!url.startsWith('/reference-assets/fonts/')) throw new Error('Invalid example font location.');
        const blob = await (await read(url)).blob();
        const embedded = await dataUrl(new Blob([blob], { type: 'font/woff2' }));
        fontCss = fontCss.replaceAll(url, embedded);
      }
      return { assets: Object.fromEntries(assets), fontCss };
    })();
    resources.catch(() => { resources = undefined; });
  }
  return resources;
}

export function composeGenerationPrompt(prompt: string, options: {
  styleId: string; effectIds: string[]; brandColors: string[]; assets: string[];
}): string {
  const lines = [prompt.trim()];
  const style = studioPalettes.find(p => p.id === options.styleId);
  if (style?.phrase) lines.push(`Visual style: ${style.phrase}.`);
  if (options.brandColors.length) lines.push(`Brand colours: ${options.brandColors.join(', ')}.`);
  for (const id of options.effectIds) {
    const effect = studioEffects.find(e => e.id === id);
    if (effect) lines.push(`Motion effect: ${effect.name}. ${effect.recipe}.`);
  }
  if (options.assets.length) lines.push(options.assets.map((id, index) => `@Image${index + 1} is image asset ${id}`).join('; ') + '.');
  return lines.join('\n\n');
}
