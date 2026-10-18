import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUDIO_SETTINGS } from '../shared/audio';
import { audioBufferToWav, decodeUploadedAudio, mixPcmAudio, prepareAudio, synthesizeMusic, type PcmAudio } from '../src/lib/audio-engine';

const settings = { ...DEFAULT_AUDIO_SETTINGS, music: 'custom' as const, musicVolume: 1 };
const pcm = (values: number[], sampleRate = 1000): PcmAudio => ({ sampleRate, channels: [Float32Array.from(values)] });
const constant = (value: number, seconds = 2, sampleRate = 1000) => pcm(Array(Math.round(seconds * sampleRate)).fill(value), sampleRate);
const rms = (values: Float32Array, start = 0, end = values.length) => Math.sqrt(values.slice(start, end).reduce((sum, value) => sum + value * value, 0) / (end - start));
const fakeBuffer = (channels: Float32Array[], sampleRate: number): AudioBuffer => ({
  numberOfChannels: channels.length, length: channels[0].length, sampleRate,
  duration: channels[0].length / sampleRate, getChannelData: (channel: number) => channels[channel],
}) as AudioBuffer;
afterEach(() => vi.unstubAllGlobals());

describe('original music and PCM mixing', () => {
  it('generates three deterministic, distinct stereo music beds with sustained energy and no invalid samples', () => {
    const fingerprints: number[] = [];
    for (const preset of ['pulse', 'ambient', 'uplift'] as const) {
      const audio = synthesizeMusic(preset, 8, 8000);
      expect(audio.sampleRate).toBe(8000);
      expect(audio.channels.map(c => c.length)).toEqual([64000, 64000]);
      expect(audio.channels[0]).toEqual(synthesizeMusic(preset, 8, 8000).channels[0]);
      expect(audio.channels[0].every(n => Number.isFinite(n) && Math.abs(n) <= 1)).toBe(true);
      expect(rms(audio.channels[0], 8000, 56000)).toBeGreaterThan(0.03);
      expect(audio.channels[0].some((sample, i) => Math.abs(sample - audio.channels[1][i]) > 0.001)).toBe(true);
      fingerprints.push(audio.channels[0].slice(1234, 2234).reduce((sum, n) => sum + Math.abs(n), 0));
    }
    expect(new Set(fingerprints).size).toBe(3);
  });
  it.each(['pulse', 'ambient', 'uplift'] as const)('prepares %s at production sample rate for 10, 15 and 30 seconds', preset => {
    for (const duration of [10, 15, 30]) {
      const audio = mixPcmAudio(duration, { ...DEFAULT_AUDIO_SETTINGS, music: preset });
      expect(audio.sampleRate).toBe(48000);
      expect(audio.channels.map(c => c.length)).toEqual([duration * 48000, duration * 48000]);
      for (const channel of audio.channels) {
        expect(channel.every(value => Number.isFinite(value) && Math.abs(value) <= 0.981)).toBe(true);
        expect(rms(channel, 48000, channel.length - 48000)).toBeGreaterThan(0.01);
      }
    }
  });
  it('loops music, linearly resamples mono to stereo, and fades the exact output boundaries', () => {
    const audio = mixPcmAudio(2, settings, { music: pcm([0.1, 0.3, 0.5, 0.3], 4) }, 8);
    expect(audio.channels.map(c => c.length)).toEqual([16, 16]);
    expect(audio.channels[0][3]).toBeCloseTo(0.4);
    expect(audio.channels[0][8]).toBeCloseTo(0.1);
    expect(audio.channels[0][10]).toBeCloseTo(0.3);
    expect(audio.channels[0]).toEqual(audio.channels[1]);
    expect(audio.channels[0][0]).toBe(0);
    expect(audio.channels[0][15]).toBe(0);
  });
  it('does not loop a voice clip and pads the remainder with silence', () => {
    const output = mixPcmAudio(2, { ...settings, music: 'none' }, { voice: constant(0.2, 0.6) }, 1000);
    expect(output.channels[0][300]).toBeCloseTo(0.2);
    expect(output.channels[0][1000]).toBe(0);
    expect(output.channels[0].length).toBe(2000);
  });
  it('ducks background only while the voice is active and recovers smoothly', () => {
    const voice = pcm([...Array(500).fill(0), ...Array(500).fill(0.1), ...Array(1000).fill(0)]);
    const output = mixPcmAudio(2, settings, { music: constant(0.2), voice }, 1000).channels[0];
    expect(output[300]).toBeCloseTo(0.2, 2);
    expect(output[800] - 0.1).toBeLessThan(0.075);
    expect(output[1400]).toBeGreaterThan(0.15);
    expect(Math.abs(output[1001] - output[1000])).toBeLessThan(0.01);
  });
  it('limits stereo peaks together, preserves channel balance, and sanitizes nonfinite PCM', () => {
    const loud: PcmAudio = { sampleRate: 1000, channels: [new Float32Array(2000).fill(2), new Float32Array(2000).fill(1)] };
    loud.channels[0][600] = NaN;
    const output = mixPcmAudio(2, settings, { music: loud }, 1000);
    expect(output.channels.flatMap(c => [...c]).every(n => Number.isFinite(n) && Math.abs(n) <= 0.981)).toBe(true);
    expect(output.channels[0][300]).toBeCloseTo(0.98);
    expect(output.channels[1][300]).toBeCloseTo(0.49);
  });
  it('uses the configured 0.3 default music level and rejects invalid durations or missing custom music', () => {
    const output = mixPcmAudio(2, { ...DEFAULT_AUDIO_SETTINGS, music: 'custom' }, { music: constant(0.5) }, 1000);
    expect(output.channels[0][400]).toBeCloseTo(0.15);
    for (const duration of [0, -1, NaN, Infinity, 31]) expect(() => mixPcmAudio(duration, settings, { music: constant(0.1) })).toThrow(/duration/i);
    expect(() => mixPcmAudio(2, settings)).toThrow(/upload|custom/i);
    expect(() => mixPcmAudio(2, { ...settings, musicVolume: NaN }, { music: constant(0.1) })).toThrow(/volume/i);
  });
});

describe('browser audio boundaries', () => {
  it('does not require Web Audio when both music and voice are disabled', async () => {
    expect(await prepareAudio(10, { ...DEFAULT_AUDIO_SETTINGS, music: 'none' })).toBeNull();
  });
  it('creates the exact 48k stereo AudioBuffer shared by the preview and exporter', async () => {
    vi.stubGlobal('AudioBuffer', class {
      readonly numberOfChannels: number; readonly length: number; readonly sampleRate: number;
      readonly duration: number; readonly channels: Float32Array[];
      constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
        Object.assign(this, options); this.numberOfChannels = options.numberOfChannels;
        this.length = options.length; this.sampleRate = options.sampleRate;
        this.duration = this.length / this.sampleRate;
        this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
      }
      getChannelData(channel: number) { return this.channels[channel]; }
    });
    const output = await prepareAudio(1.25, DEFAULT_AUDIO_SETTINGS);
    expect(output).toMatchObject({ sampleRate: 48000, numberOfChannels: 2, length: 60000, duration: 1.25 });
    expect(rms(output!.getChannelData(0), 10000, 30000)).toBeGreaterThan(0.01);
  });
  it('rejects oversized uploads before attempting to decode them', async () => {
    const decodeAudioData = vi.fn();
    vi.stubGlobal('OfflineAudioContext', class { decodeAudioData = decodeAudioData; });
    await expect(decodeUploadedAudio(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]))).rejects.toThrow(/10 MB/);
    expect(decodeAudioData).not.toHaveBeenCalled();
  });
  it('writes a standards-compliant stereo PCM16 WAV with interleaved samples and clipping', async () => {
    const blob = audioBufferToWav(fakeBuffer([Float32Array.from([0, 1, -1]), Float32Array.from([0.5, -0.5, 2])], 48000));
    expect(blob.type).toBe('audio/wav');
    const bytes = await blob.arrayBuffer();
    const view = new DataView(bytes);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE');
    expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(40, true)).toBe(12);
    expect(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([0, 16384, 32767, -16384, -32768, 32767]);
  });
  it('rejects decoded audio longer than 120 seconds and reports unsupported or damaged files', async () => {
    const decodeAudioData = vi.fn().mockResolvedValue(fakeBuffer([new Float32Array(121)], 1));
    vi.stubGlobal('OfflineAudioContext', class { decodeAudioData = decodeAudioData; });
    await expect(decodeUploadedAudio(new Blob(['audio']))).rejects.toThrow(/120/);
    decodeAudioData.mockRejectedValueOnce(new Error('native decoder error'));
    await expect(decodeUploadedAudio(new Blob(['broken']))).rejects.toThrow(/decode|supported|damaged/i);
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
  });
});
