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
