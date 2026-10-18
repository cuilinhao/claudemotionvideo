import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportMp4 } from '../src/lib/renderer';

const state = vi.hoisted(() => ({ events: [] as string[], audio: null as AudioBuffer | null, audioSupported: true, audioProbe: null as unknown, failAudio: false }));
vi.mock('mediabunny', () => ({
  Quality: class { constructor(public options: unknown) {} },
  canEncodeVideo: async () => true,
  canEncodeAudio: async (_codec: string, options: unknown) => { state.audioProbe = options; return state.audioSupported; },
  BufferTarget: class { buffer = new ArrayBuffer(16); },
  Mp4OutputFormat: class {},
  CanvasSource: class {
    async add(time: number) { state.events.push(`video:${time}`); }
    close() { state.events.push('video-close'); }
  },
  AudioBufferSource: class {
    constructor(options: { codec: string; quality: { options: { bitrate: number } } }) { state.events.push(`${options.codec}:${options.quality.options.bitrate}`); }
    async add(audio: AudioBuffer) { state.audio = audio; state.events.push('audio-add'); if (state.failAudio) throw new Error('Audio encoder failed'); }
    close() { state.events.push('audio-close'); }
  },
  Output: class {
    state = 'pending';
    addVideoTrack() { state.events.push('video-track'); }
    addAudioTrack() { state.events.push('audio-track'); }
    async start() { this.state = 'started'; state.events.push('start'); }
    async finalize() { this.state = 'finalized'; state.events.push('finalize'); }
    async cancel() { this.state = 'canceled'; state.events.push('cancel'); }
  },
}));
function fixture() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const source = { postMessage: (data: Record<string, unknown>) => {
    if (data.type === 'cmv:frame') queueMicrotask(() => {
      const response = { source, data: { ...data, width: 1920, height: 1080, bitmap: { close() {} } } } as unknown as MessageEvent;
      for (const listener of listeners) listener(response);
    });
  } };
  vi.stubGlobal('window', { addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.add(listener), removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.delete(listener) });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }) }) });
  const iframe = { sandbox: { contains: (token: string) => token === 'allow-scripts' }, contentWindow: source, isConnected: true } as unknown as HTMLIFrameElement;
  const audio = { numberOfChannels: 2, sampleRate: 48000, length: 4800, duration: 0.1 } as AudioBuffer;
  return { iframe, audio };
}
beforeEach(() => {
  state.events = []; state.audio = null; state.audioSupported = true; state.audioProbe = null; state.failAudio = false;
  vi.stubGlobal('isSecureContext', true); vi.stubGlobal('VideoEncoder', class {});
});
afterEach(() => vi.unstubAllGlobals());

describe('MP4 audio export', () => {
  it('fails explicitly when AAC cannot be encoded instead of exporting a silent video', async () => {
    const { iframe, audio } = fixture(); state.audioSupported = false;
    await expect(exportMp4(iframe, { channel: 'test-channel', duration: 0.1, aspect: '16:9', audio })).rejects.toThrow(/AAC|audio.*support/i);
    expect(state.events).not.toContain('start');
  });
  it('muxes the exact preview buffer as AAC 192k starting at zero alongside every video frame', async () => {
    const { iframe, audio } = fixture();
    const result = await exportMp4(iframe, { channel: 'test-channel', duration: 0.1, aspect: '16:9', audio });
    expect(result.type).toBe('video/mp4');
    expect(state.audio).toBe(audio);
    expect(state.audioProbe).toMatchObject({ numberOfChannels: 2, sampleRate: 48000 });
    expect(state.events).toContain('aac:192000');
    expect(state.events.indexOf('audio-track')).toBeLessThan(state.events.indexOf('start'));
    expect(state.events.indexOf('audio-close')).toBeLessThan(state.events.indexOf('finalize'));
    expect(state.events.filter(e => e.startsWith('video:'))).toEqual(['video:0', `video:${1 / 30}`, `video:${2 / 30}`]);
  });
  it('cancels a failed audio encode and releases the export lock for a retry', async () => {
    const { iframe, audio } = fixture(); state.failAudio = true;
    await expect(exportMp4(iframe, { channel: 'test-channel', duration: 0.1, aspect: '16:9', audio })).rejects.toThrow('Audio encoder failed');
    expect(state.events).toContain('cancel');
    expect(state.events).not.toContain('finalize');
    state.failAudio = false;
    await expect(exportMp4(iframe, { channel: 'test-channel', duration: 0.1, aspect: '16:9', audio })).resolves.toBeInstanceOf(Blob);
  });
  it('retains video-only export when no audio is requested', async () => {
    const { iframe } = fixture(); state.audioSupported = false;
    await expect(exportMp4(iframe, { channel: 'test-channel', duration: 0.1, aspect: '16:9' })).resolves.toBeInstanceOf(Blob);
    expect(state.events).not.toContain('audio-track');
    expect(state.audioProbe).toBeNull();
  });
  it('rejects stale audio from a different video duration', async () => {
    const { iframe, audio } = fixture();
    await expect(exportMp4(iframe, { channel: 'test-channel', duration: 10, aspect: '16:9', audio })).rejects.toThrow(/audio.*duration|prepare.*audio/i);
  });
});
