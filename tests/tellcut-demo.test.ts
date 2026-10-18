import { describe, expect, it } from 'vitest';
import { applyDemoPresets, buildDemoDocument, demo, composeGenerationPrompt } from '../src/lib/tellcut-demo';
import { buildPreviewDocument } from '../src/lib/renderer';

describe('source-backed Lucky spin example', () => {
  it('keeps the actual source animation and applies all three original changes cumulatively', () => {
    expect(applyDemoPresets([])).toBe(demo.code);
    const code = applyDemoPresets(['land-200', 'more-coins', 'green-prize']);
    expect(code).toContain('const FINAL=270+360*4;');
    expect(code).toContain('"endBalance":"400"');
    expect(code).toContain('"prizeText":"+200"');
    expect(code).not.toBe(applyDemoPresets(['land-200']));
    expect(() => applyDemoPresets(['made-up'])).toThrow(/Unknown/);
    expect(() => applyDemoPresets(['land-200', 'land-200'])).toThrow(/already/);
  });
  it('embeds exactly the six original images with fonts inside the network-denying sandbox', () => {
    const assets = Object.fromEntries(Object.keys(demo.assets).map(id => [id, 'data:image/png;base64,aGVsbG8=']));
    const doc = buildDemoDocument([], assets, '@font-face{font-family:"Baloo 2";src:url(data:font/woff2;base64,aGVsbG8=)}', 'demo-channel-123');
    expect(doc).toContain('window.opus6');
    expect(doc).toContain('font-src data:');
    expect(doc).toContain("media-src 'none'");
    expect(doc).not.toContain('fonts.googleapis.com');
    expect(doc).not.toContain('<link');
    expect(() => buildDemoDocument([], { ...assets, unexpected: assets.a1 }, '', 'demo-channel-123')).toThrow(/assets/);
    expect(() => buildDemoDocument([], assets, '@import url(https://evil.test/font);', 'demo-channel-123')).toThrow(/font/);
    expect(() => buildPreviewDocument(demo.code.replace(/<link[^>]*>/g, ''), assets, 'demo-channel-123')).toThrow(/Too many/);
  });
  it('includes chosen settings and stable image IDs in the real generation request', () => {
    const result = composeGenerationPrompt('Move @Image1 into view', { styleId: 'clean', effectIds: ['mask-rise'], brandColors: ['#123456'], assets: ['image-id'] });
    expect(result).toContain('Move @Image1 into view');
    expect(result).toContain('Clean and minimal');
    expect(result).toContain('clip a rectangle');
    expect(result).toContain('#123456');
    expect(result).toContain('@Image1 is image asset image-id');
  });
});
