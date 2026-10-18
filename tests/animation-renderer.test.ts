import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildPreviewDocument, isPreviewMessage, videoDimensions } from '../src/lib/renderer';

const html = '<html><head></head><body><canvas id="stage" width="1920" height="1080"></canvas><script>window.DURATION=10;window.seek=function(t){window.lastTime=t};</script></body></html>';
const channel = 'test-channel-123';

describe('isolated animation renderer', () => {
  it('places network-denying CSP before any model content and never accepts remote asset URLs', () => {
    const doc = buildPreviewDocument(html, { a: 'data:image/png;base64,aGVsbG8=' }, channel);
    const csp = doc.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain('img-src data: blob:');
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<script'));
    expect(() => buildPreviewDocument(html, { a: 'https://example.com/private.png' }, channel)).toThrow(/asset/i);
    expect(() => buildPreviewDocument(html, { a: 'data:image/svg+xml;base64,PHN2Zz4=' }, channel)).toThrow(/asset/i);
  });
  it('cannot inject script through a caller-provided channel', () => {
    expect(() => buildPreviewDocument(html, {}, '</script><script>alert(1)</script>')).toThrow(/channel/i);
  });
  it('matches both iframe window and channel before accepting a message', () => {
    const frameWindow = {};
    const good = { source: frameWindow, data: { type: 'cmv:ready', channel } } as MessageEvent;
    expect(isPreviewMessage(good, frameWindow as Window, channel)).toBe(true);
    expect(isPreviewMessage({ ...good, source: {} } as MessageEvent, frameWindow as Window, channel)).toBe(false);
    expect(isPreviewMessage({ ...good, data: { type: 'cmv:ready', channel: 'other' } } as MessageEvent, frameWindow as Window, channel)).toBe(false);
  });
  it('runs the bridge, ignores spoofed seeks, and clamps authorized seek times', async () => {
    const listeners: Record<string, Function[]> = {};
    const messages: any[] = [];
    const parent = { postMessage: (message: any) => messages.push(message) };
    const stage = { width: 1920, height: 1080 };
    const context: any = {
      parent, document: { getElementById: () => stage, images: [], fonts: { ready: Promise.resolve() }, readyState: 'complete' },
      addEventListener: (type: string, fn: Function) => (listeners[type] ??= []).push(fn),
      setTimeout, clearTimeout, console, Promise, Object, Number, Math,
      createImageBitmap: async () => ({ kind: 'frame-bitmap' }),
    };
    context.window = context;
    const doc = buildPreviewDocument(html, {}, channel);
    const scripts = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    for (const script of scripts) runInNewContext(script, context);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(messages.some(m => m.type === 'cmv:ready' && m.channel === channel)).toBe(true);
    const dispatch = async (data: any, source: any = parent) => {
      for (const fn of listeners.message) fn({ source, data });
      await new Promise(resolve => setTimeout(resolve, 0));
    };
    await dispatch({ type: 'cmv:seek', time: 4, channel }, {});
    expect(context.lastTime).toBe(0);
    await dispatch({ type: 'cmv:seek', time: 4, channel: 'other' });
    expect(context.lastTime).toBe(0);
    await dispatch({ type: 'cmv:seek', time: 99, channel });
    expect(context.lastTime).toBe(10);
    await dispatch({ type: 'cmv:seek', time: -7, channel });
    expect(context.lastTime).toBe(0);
    await dispatch({ type: 'cmv:export-start', exportId: 'export-1', channel });
    await dispatch({ type: 'cmv:seek', time: 6, channel });
    expect(context.lastTime).toBe(0);
    await dispatch({ type: 'cmv:frame', time: 2, requestId: 'frame-1', exportId: 'wrong-export', channel });
    expect(messages.some(m => m.requestId === 'frame-1')).toBe(false);
    await dispatch({ type: 'cmv:frame', time: 2, requestId: 'frame-2', exportId: 'export-1', channel });
    expect(context.lastTime).toBe(2);
    expect(messages.find(m => m.requestId === 'frame-2')).toMatchObject({
      type: 'cmv:frame', channel, width: 1920, height: 1080, bitmap: { kind: 'frame-bitmap' },
    });
    await dispatch({ type: 'cmv:export-end', exportId: 'export-1', channel });
    await dispatch({ type: 'cmv:seek', time: 3, channel });
    expect(context.lastTime).toBe(3);
  });
  it('coalesces preview seeks to the newest time while a slow frame is rendering', async () => {
    const listeners: Record<string, Function[]> = {};
    const parent = { postMessage() {} };
    let release: (() => void) | undefined;
    const times: number[] = [];
    const context: any = {
      parent, document: { getElementById: () => ({ width: 1920, height: 1080 }), images: [], readyState: 'complete' },
      addEventListener: (type: string, fn: Function) => (listeners[type] ??= []).push(fn),
      setTimeout, clearTimeout, Promise, Object, Number, Math,
      DURATION: 10,
      seek: (time: number) => { times.push(time); if (time === 1) return new Promise<void>(resolve => { release = resolve; }); },
    };
    context.window = context;
    const doc = buildPreviewDocument('<canvas id="stage"></canvas>', {}, channel);
    for (const match of doc.matchAll(/<script>([\s\S]*?)<\/script>/g)) runInNewContext(match[1], context);
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    await tick();
    const seek = (time: number) => listeners.message.forEach(fn => fn({ source: parent, data: { type: 'cmv:seek', time, channel } }));
    seek(1); await tick();
    seek(2); seek(3); seek(4);
    release?.(); await tick();
    expect(times).toEqual([0, 1, 4]);
  });
  it('uses fixed, even 1080p output sizes and rejects unknown aspect ratios', () => {
    expect(videoDimensions('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(videoDimensions('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(videoDimensions('1:1')).toEqual({ width: 1080, height: 1080 });
    expect(() => videoDimensions('3:2')).toThrow();
  });
});
