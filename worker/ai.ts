type AnimationAsset = { id: string; mediaType: string; base64: string };
type AnimationInput = {
  prompt: string;
  aspect: string;
  duration: number;
  assets: AnimationAsset[];
  previousHtml?: string;
  selectedShot?: string;
};
type AnimationResult = { html: string; storyboard: string; usage: Record<string, number> };
type Shot = { id: string; title: string; start: number; end: number; description: string };

const PROVIDER_TIMEOUT = 180_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_HTML_LENGTH = 180_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateHtml(html: unknown, duration: number): asserts html is string {
  if (typeof html !== 'string' || html.length < 100 || html.length > MAX_HTML_LENGTH
    || !/<canvas\b[^>]*\bid\s*=\s*["']stage["']/i.test(html)
    || !/window\s*\.\s*seek\s*=/.test(html)
    || !/window\s*\.\s*DURATION\s*=/.test(html)
    || !/<\/html>\s*$/i.test(html)
    || (html.match(/<script\b/gi)?.length ?? 0) !== (html.match(/<\/script\s*>/gi)?.length ?? 0)) {
    throw new Error('The provider returned an invalid animation document. Please try again.');
  }
  // This is an output-quality gate, not the security boundary. The browser also runs
  // this document in an opaque-origin sandbox with a network-denying CSP.
  if (/<(?:iframe|object|embed|base|form|link)\b/i.test(html)
    || /<script\b[^>]*\bsrc\s*=/i.test(html)
    || /<meta\b[^>]*http-equiv\s*=/i.test(html)
    || /\b(?:src|href|action)\s*=\s*["']\s*(?:https?:|\/\/|javascript:)/i.test(html)) {
    throw new Error('The provider returned an animation with unsupported external resources.');
  }
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(m => m[1]).join('\n');
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|postMessage|eval)\b|\bimport\s*\(|\bnew\s+Function\b|\b(?:window|document)\s*\.\s*(?:location|cookie|domain|parent|top|opener)\b|\b(?:parent|opener)\s*\.|\blocation\s*[.=[]|\b(?:localStorage|sessionStorage|indexedDB|navigator)\b/.test(scripts)) {
    throw new Error('The provider returned animation code outside the supported canvas environment.');
  }
  let ast: unknown;
  try { ast = parse(scripts, { ecmaVersion: 2022, sourceType: 'script' }); }
  catch { throw new Error('The provider returned animation code with invalid JavaScript syntax.'); }
  const pending: unknown[] = [ast];
  let hasDuration = false;
  const forbidden = new Set(['location', 'cookie', 'domain', 'parent', 'top', 'opener', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB']);
  while (pending.length) {
    const node = pending.pop();
    if (!record(node)) continue;
    if (node.type === 'MemberExpression' && record(node.object) && record(node.property)) {
      const property = node.computed ? node.property.value : node.property.name;
      if (property === 'constructor' || property === '__proto__'
        || (['window', 'self', 'globalThis', 'document'].includes(String(node.object.name))
          && (typeof property !== 'string' || forbidden.has(property)))) {
        throw new Error('The provider returned animation code outside the supported canvas environment.');
      }
    }
    if (node.type === 'AssignmentExpression' && record(node.left) && node.left.type === 'MemberExpression'
      && record(node.left.object) && node.left.object.name === 'window' && record(node.left.property)
      && (node.left.property.name === 'DURATION' || node.left.property.value === 'DURATION')) {
      if (node.operator !== '=' || !record(node.right) || node.right.type !== 'Literal' || node.right.value !== duration) {
        throw new Error('The provider returned an animation with the wrong duration.');
      }
      hasDuration = true;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) pending.push(...value);
      else if (record(value) && typeof value.type === 'string') pending.push(value);
    }
  }
  if (!hasDuration) throw new Error('The provider returned an animation without a declared duration.');
}

/** Parse only a complete native Anthropic Messages response; never salvage truncated code. */
export function parseAnimationResponse(value: unknown, duration: number): AnimationResult {
  if (!record(value) || value.stop_reason !== 'end_turn') {
    throw new Error('The provider returned an incomplete animation. Please try again.');
  }
  if (!Array.isArray(value.content)) throw new Error('The provider returned an invalid animation response.');
  const text = value.content.filter(record).filter(block => block.type === 'text')
    .map(block => typeof block.text === 'string' ? block.text : '').join('\n').trim();
  const json = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
  let result: unknown;
  try { result = JSON.parse(json); } catch { throw new Error('The provider returned malformed animation data. Please try again.'); }
  if (!record(result)) throw new Error('The provider returned invalid animation data.');
  validateHtml(result.html, duration);
  if (!Array.isArray(result.storyboard) || result.storyboard.length < 1 || result.storyboard.length > 12) {
    throw new Error('The provider returned an invalid storyboard.');
  }
  const shots: Shot[] = [];
  let end = 0;
  const ids = new Set<string>();
  for (const shot of result.storyboard) {
    if (!record(shot) || typeof shot.id !== 'string' || !/^[\w-]{1,64}$/.test(shot.id) || ids.has(shot.id)
      || typeof shot.title !== 'string' || !shot.title.trim() || shot.title.length > 160
      || typeof shot.description !== 'string' || shot.description.length > 2000
      || typeof shot.start !== 'number' || typeof shot.end !== 'number'
      || !Number.isFinite(shot.start) || !Number.isFinite(shot.end)
      || Math.abs(shot.start - end) > 0.02 || shot.end <= shot.start || shot.end > duration + 0.02) {
      throw new Error('The provider returned invalid storyboard timing.');
    }
    shots.push({ id: shot.id, title: shot.title, start: shot.start, end: shot.end, description: shot.description });
    ids.add(shot.id);
    end = shot.end;
  }
  if (Math.abs(end - duration) > 0.02) throw new Error('The provider returned incomplete storyboard timing.');
  const usage: Record<string, number> = {};
  if (record(value.usage)) for (const [key, count] of Object.entries(value.usage)) {
    if (/^[a-z_]{1,64}$/.test(key) && typeof count === 'number' && Number.isFinite(count) && count >= 0) usage[key] = count;
  }
  return { html: result.html, storyboard: JSON.stringify(shots), usage };
}

const SYSTEM_PROMPT = `You are the motion design engine for Claude Motion Video. Produce polished, original typography, graphical storytelling and product animations, implemented entirely with native Canvas 2D JavaScript. This is a silent video: do not invent audio support.
Return ONLY one valid JSON object with keys "storyboard" and "html", no Markdown. storyboard is an array of 1-8 objects {"id":"shot-1","title":"...","start":0,"end":3,"description":"..."}. Times are seconds, must be contiguous from 0 to the exact requested duration, and IDs are stable across edits. html is a complete self-contained HTML document including closing </html>. Keep the complete JSON under 14000 tokens.
HTML contract:
- One canvas id="stage", with exact requested pixel width/height attributes. All visible content is drawn on this canvas, including text. CSS may only style the canvas/page. No external libraries, CSS/fonts, network, links, audio, iframe, SVG, form, eval, dynamic import or other resources. Do not add a CSP or http-equiv meta tag; the host supplies it.
- Set window.DURATION = <requested seconds>; using a numeric literal, never a variable. Define window.seek = function(t) {...} or an async function. Every call redraws the entire frame deterministically from t alone. Use explicit timeline segments and eased progress; no timers, requestAnimationFrame, Date, performance, or Math.random. Repeated or backwards seeks must reproduce the same frame. Clear/reset canvas transforms and alpha each call. No autoplay.
- User asset IDs are supplied below. Their ORIGINAL image pixels are available at window.ASSETS[id] as a data URL. For each supplied asset, create a new Image(), assign its src to window.ASSETS[id], wait for image.decode() using window.READY = Promise.all(...), and use ctx.drawImage(image,...) in seek. Never embed Base64 bytes in your output. Preserve the actual product/photo pixels; animate positions, scaling, rotation, masks and rectangular source crops. Do not replace an uploaded image with an illustration. There is no automatic subject segmentation; never describe a crop as a segmented layer.
- window.READY can be a Promise for image loading. The host waits for it. Draw all text with built-in system fonts and fit text to the canvas. Keep important content inside a 6% safe margin.
- No access to window.parent, window.top, opener, postMessage, storage, cookies, navigator or navigation. The host owns playback and frame export. No event listeners needed.
- Use high-contrast colors, thoughtful hierarchy and legible pacing. Follow the user's requested language for visible text. Use a coherent visual idea, multiple timed scenes and meaningful transitions rather than a generic static title slide.
For edits, the prior accepted HTML is supplied in the conversation. Its CMV_STORYBOARD comment contains the accepted shot IDs and exact time intervals. Modify that exact composition, retaining images, branding and unaffected scenes. If selectedShot is supplied, look up that ID in CMV_STORYBOARD and limit the visual change to that shot's time interval unless the instruction expressly requires a global change. Always return the complete updated HTML and complete storyboard, never a patch.`;

async function readResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The animation provider returned an empty response.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('The animation provider returned an oversized response.');
    }
    chunks.push(part.value);
  }
  const all = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(all)); }
  catch { throw new Error('The animation provider returned an unreadable response.'); }
}

export async function generateAnimation(
  env: { APIMART_API_KEY: string; APIMART_MODEL?: string }, input: AnimationInput,
): Promise<AnimationResult> {
  if (!env.APIMART_API_KEY) throw new Error('Animation generation is not configured yet.');
  if (!input.prompt?.trim() || input.prompt.length > 6000 || ![10, 15, 30].includes(input.duration)
    || !['16:9', '9:16', '1:1'].includes(input.aspect) || input.assets.length > 4) {
    throw new Error('Invalid animation request.');
  }
  if (input.previousHtml && input.previousHtml.length > MAX_HTML_LENGTH) throw new Error('The previous animation is too large to edit.');
  const [width, height] = input.aspect === '9:16' ? [1080, 1920] : input.aspect === '1:1' ? [1080, 1080] : [1920, 1080];
  const content: Array<Record<string, unknown>> = [];
  for (const asset of input.assets) {
    if (!/^[\w-]{1,128}$/.test(asset.id) || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mediaType)
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(asset.base64) || asset.base64.length > 11_200_000) {
      throw new Error('An uploaded image cannot be used for animation.');
    }
    content.push({ type: 'text', text: `Original uploaded image; asset ID: ${asset.id}. Render with window.ASSETS[${JSON.stringify(asset.id)}].` });
    content.push({ type: 'image', source: { type: 'base64', media_type: asset.mediaType, data: asset.base64 } });
  }
  content.push({ type: 'text', text: JSON.stringify({
    task: input.previousHtml ? 'Edit this existing animation' : 'Create a new animation',
    prompt: input.prompt, duration: input.duration, aspect: input.aspect, width, height,
    assetIds: input.assets.map(asset => asset.id), selectedShot: input.selectedShot ?? null,
  }) });
  const messages: Array<{ role: string; content: unknown }> = [];
  if (input.previousHtml) {
    messages.push({ role: 'user', content: 'Here is the currently accepted animation. Preserve its composition when applying my next edit.' });
    messages.push({ role: 'assistant', content: input.previousHtml });
  }
  messages.push({ role: 'user', content });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT);
  try {
    const response = await fetch('https://api.apimart.ai/v1/messages', {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': env.APIMART_API_KEY, 'anthropic-version': '2025-10-01' },
      body: JSON.stringify({ model: env.APIMART_MODEL || 'claude-opus-5-5', max_tokens: 16000, stream: false, system: SYSTEM_PROMPT, messages }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const message = response.status === 429 || response.status >= 500
        ? 'The animation provider is busy. Please try again later.'
        : 'The animation provider could not complete this request. Please try again later.';
      throw new Error(`${message} (HTTP ${response.status})`);
    }
    const result = parseAnimationResponse(await readResponse(response), input.duration);
    if (input.assets.length && (!/\bdrawImage\s*\(/.test(result.html) || !/window\s*\.\s*ASSETS\b/.test(result.html))) {
      throw new Error('The animation provider did not include the uploaded images. Please try again.');
    }
    // Persist timing with the editable source so a later request with only an HTML
    // version and selected shot ID still has the original scene boundaries.
    const metadata = result.storyboard.replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    const cleanHtml = result.html.replace(/<!--\s*CMV_STORYBOARD\b[\s\S]*?-->/g, '');
    result.html = cleanHtml.replace(/<\/html>\s*$/i, `<!--CMV_STORYBOARD\n${metadata}\n--></html>`);
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Animation generation timed out. Please try again.');
    if (error instanceof TypeError) throw new Error('Could not connect to the animation provider. Please try again later.');
    throw error;
  } finally { clearTimeout(timeout); }
}
import { parse } from 'acorn';
