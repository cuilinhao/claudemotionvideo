import { MAX_AUDIO_BYTES, MUSIC_PRESETS, type AudioSettings, type MusicPreset } from '../../shared/audio';

export const AUDIO_SAMPLE_RATE = 48_000;
export interface PcmAudio { sampleRate: number; channels: Float32Array[] }
type OriginalPreset = Exclude<MusicPreset, 'none' | 'custom'>;

function validateDuration(duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 30) throw new Error('Audio duration must be between 0 and 30 seconds.');
}
function validateSettings(settings: AudioSettings): void {
  if (!MUSIC_PRESETS.includes(settings.music)) throw new Error('Choose a supported music preset.');
  if (![settings.musicVolume, settings.voiceVolume].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) {
    throw new Error('Audio volume must be between 0 and 1.');
  }
}
function validateSampleRate(sampleRate: number): void {
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 192_000) throw new Error('Invalid audio sample rate.');
}
function emptyPcm(duration: number, sampleRate: number): PcmAudio {
  validateDuration(duration); validateSampleRate(sampleRate);
  const length = Math.max(1, Math.round(duration * sampleRate));
  return { sampleRate, channels: [new Float32Array(length), new Float32Array(length)] };
}

/** Original, deterministic arrangements; no remote samples or copyrighted recordings. */
export function synthesizeMusic(preset: OriginalPreset, duration: number, sampleRate = AUDIO_SAMPLE_RATE): PcmAudio {
  if (!['pulse', 'ambient', 'uplift'].includes(preset)) throw new Error('Choose an original music preset.');
  const output = emptyPcm(duration, sampleRate);
  const [left, right] = output.channels;
  const bpm = { pulse: 108, ambient: 76, uplift: 120 }[preset];
  const beat = 60 / bpm;
  // Four voiced chords, with inversions keeping the melody in a compact register.
  const chords = preset === 'uplift'
    ? [[60, 64, 67, 71], [59, 62, 67, 69], [60, 64, 69, 72], [60, 65, 69, 72]]
    : [[57, 60, 64, 67], [57, 60, 65, 69], [55, 60, 64, 67], [55, 59, 62, 67]];
  const roots = preset === 'uplift' ? [36, 43, 45, 41] : [33, 41, 36, 43];
  type Tone = 'pad' | 'keys' | 'pluck' | 'bass';
  const note = (midi: number, start: number, seconds: number, volume: number, pan: number, tone: Tone) => {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const first = Math.max(0, Math.round(start * sampleRate));
    const last = Math.min(left.length, Math.round((start + seconds) * sampleRate));
    const gainLeft = Math.sqrt((1 - pan) / 2) * volume;
    const gainRight = Math.sqrt((1 + pan) / 2) * volume;
    const attack = tone === 'pad' ? 0.18 : tone === 'bass' ? 0.012 : 0.006;
    const release = Math.min(seconds * 0.4, tone === 'pad' ? 0.45 : 0.15);
    for (let i = first; i < last; i++) {
      const t = (i - first) / sampleRate;
      const phase = 2 * Math.PI * frequency * t;
      const envelope = Math.min(1, t / attack) * Math.min(1, (seconds - t) / release);
      let wave: number;
      if (tone === 'pad') wave = 0.7 * Math.sin(phase) + 0.25 * Math.sin(phase * 1.003 + 0.2) + 0.05 * Math.sin(phase * 2);
      else if (tone === 'bass') wave = 0.85 * Math.sin(phase) + 0.15 * Math.sin(phase * 2);
      else if (tone === 'keys') wave = (Math.sin(phase) + 0.28 * Math.sin(2 * phase) * Math.exp(-t * 4) + 0.12 * Math.sin(3 * phase) * Math.exp(-t * 7)) * Math.exp(-t * 2.1);
      else wave = (Math.sin(phase) + 0.22 * Math.sin(2 * phase) + 0.08 * Math.sin(3 * phase)) * Math.exp(-t * 6);
      const value = wave * envelope;
      left[i] += value * gainLeft; right[i] += value * gainRight;
    }
  };
  let seed = 0x61c88647;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 2147483648 - 1; };
  const drum = (start: number, kind: 'kick' | 'snare' | 'hat', volume: number, pan = 0) => {
    const seconds = kind === 'kick' ? 0.24 : kind === 'snare' ? 0.12 : 0.045;
    const first = Math.round(start * sampleRate);
    const last = Math.min(left.length, first + Math.round(seconds * sampleRate));
    let previousNoise = 0;
    for (let i = first; i < last; i++) {
      const t = (i - first) / sampleRate;
      const n = noise();
      const transient = n - previousNoise; previousNoise = n;
      // Integrated exponential pitch sweep gives a rounded kick instead of a click.
      const kick = Math.sin(2 * Math.PI * (48 * t + 90 * (1 - Math.exp(-35 * t)) / 35));
      const wave = kind === 'kick' ? kick * Math.exp(-18 * t)
        : kind === 'snare' ? (0.7 * transient + 0.3 * Math.sin(2 * Math.PI * 180 * t)) * Math.exp(-32 * t)
          : transient * Math.exp(-100 * t);
      const value = wave * volume * Math.min(1, t / 0.002);
      left[i] += value * Math.sqrt((1 - pan) / 2); right[i] += value * Math.sqrt((1 + pan) / 2);
    }
  };
  const barLength = beat * 4;
  for (let bar = 0; bar * barLength < duration; bar++) {
    const start = bar * barLength;
    const chord = chords[bar % 4];
    chord.forEach((pitch, i) => note(pitch, start, barLength + 0.2, preset === 'ambient' ? 0.075 : 0.045, [-0.65, 0.35, -0.3, 0.65][i], 'pad'));
    const melody = preset === 'uplift' ? [0, 2, 3, 2, 1, 2, 0, 1] : [0, 2, 1, 3, 2, 1, 3, 2];
    if (preset === 'ambient') {
      for (let step = 0; step < 2; step++) {
        note(chord[(bar + step + 2) % 4] + 12, start + step * beat * 2, beat * 2.6, 0.12, step ? 0.35 : -0.35, 'keys');
      }
      note(roots[bar % 4], start, barLength, 0.13, 0, 'bass');
      for (let step = 0; step < 4; step++) drum(start + step * beat, 'hat', 0.014, step % 2 ? 0.5 : -0.5);
    } else {
      for (let step = 0; step < 8; step++) {
        note(chord[melody[step]] + 12, start + step * beat / 2, beat * (preset === 'uplift' ? 0.85 : 0.6), step % 2 ? 0.1 : 0.14, step % 2 ? 0.3 : -0.3, preset === 'uplift' ? 'keys' : 'pluck');
        drum(start + step * beat / 2, 'hat', step % 2 ? 0.033 : 0.022, 0.4);
      }
      for (let step = 0; step < 4; step++) {
        note(roots[bar % 4] + (step === 3 ? 12 : 0), start + step * beat, beat * 0.82, 0.17, 0, 'bass');
        drum(start + step * beat, 'kick', preset === 'pulse' ? 0.3 : 0.24);
        if (step % 2) drum(start + step * beat, 'snare', 0.065, -0.15);
      }
    }
  }
  limitPeaks(output.channels, 0.85);
  return output;
}

function limitPeaks(channels: Float32Array[], ceiling: number): void {
  let peak = 0;
  for (const channel of channels) for (let i = 0; i < channel.length; i++) {
    if (!Number.isFinite(channel[i])) channel[i] = 0;
    peak = Math.max(peak, Math.abs(channel[i]));
  }
  if (peak > ceiling) for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i] *= ceiling / peak;
}
function sampler(audio: PcmAudio | undefined, loop: boolean): (time: number, channel: number) => number {
  if (!audio) return () => 0;
  validateSampleRate(audio.sampleRate);
  if (!audio.channels.length || !audio.channels[0].length || audio.channels.some(c => c.length !== audio.channels[0].length)) {
    throw new Error('The audio clip has no valid samples.');
  }
  const length = audio.channels[0].length;
  return (time, channel) => {
    let position = time * audio.sampleRate;
    if (loop) position %= length;
    else if (position >= length) return 0;
    const samples = audio.channels[Math.min(channel, audio.channels.length - 1)];
    const index = Math.floor(position);
    const next = loop ? (index + 1) % length : Math.min(index + 1, length - 1);
    const a = Number.isFinite(samples[index]) ? samples[index] : 0;
    const b = Number.isFinite(samples[next]) ? samples[next] : 0;
    return a + (b - a) * (position - index);
  };
}

/** Pure PCM mixer, also usable without browser APIs in tests. Music loops; voice never does. */
export function mixPcmAudio(duration: number, settings: AudioSettings, inputs: { music?: PcmAudio; voice?: PcmAudio } = {}, sampleRate = AUDIO_SAMPLE_RATE): PcmAudio {
  validateSettings(settings);
  const output = emptyPcm(duration, sampleRate);
  let music = settings.music === 'none' ? undefined : inputs.music;
  if (settings.music === 'custom' && !music) throw new Error('Upload a custom music file before playing or exporting.');
  if (!music && settings.music !== 'none' && settings.music !== 'custom') music = synthesizeMusic(settings.music, duration, sampleRate);
  const musicAt = sampler(music, true);
  const voiceAt = sampler(inputs.voice, false);
  const length = output.channels[0].length;
  const windowSize = Math.max(1, Math.round(sampleRate * 0.01));
  const speech = new Float32Array(Math.ceil(length / windowSize));
  // RMS windows prevent ducking from following individual waveform zero crossings.
  for (let i = 0; i < length; i++) {
    const l = voiceAt(i / sampleRate, 0) * settings.voiceVolume;
    const r = voiceAt(i / sampleRate, 1) * settings.voiceVolume;
    speech[Math.floor(i / windowSize)] += (l * l + r * r) / (2 * windowSize);
  }
  const attack = 1 - Math.exp(-1 / (sampleRate * 0.015));
  const release = 1 - Math.exp(-1 / (sampleRate * 0.2));
  let duck = 1;
  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;
    const active = speech[Math.floor(i / windowSize)] > 0.012 ** 2;
    const target = active ? 0.25 : 1;
    duck += (target - duck) * (target < duck ? attack : release);
    const fade = Math.max(0, Math.min(1, time / 0.15, (length - 1 - i) / (sampleRate * 0.5)));
    for (let channel = 0; channel < 2; channel++) {
      output.channels[channel][i] = (musicAt(time, channel) * settings.musicVolume * duck + voiceAt(time, channel) * settings.voiceVolume) * fade;
    }
  }
  limitPeaks(output.channels, 0.98);
  return output;
}

/** Decode in an offline context: no playback, microphone, or autoplay permission is needed. */
export async function decodeUploadedAudio(blob: Blob): Promise<AudioBuffer> {
  if (!blob.size || blob.size > MAX_AUDIO_BYTES) throw new Error('Upload a non-empty audio file up to 10 MB.');
  if (typeof OfflineAudioContext === 'undefined') throw new Error('Audio preparation needs a browser with Web Audio support.');
  let decoded: AudioBuffer;
  try {
    const context = new OfflineAudioContext(2, 1, AUDIO_SAMPLE_RATE);
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error('This audio file could not be decoded. Upload a supported, undamaged MP3, WAV, M4A or Ogg file.');
  }
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || !decoded.length) throw new Error('The audio file is empty or invalid.');
  if (decoded.duration > 120) throw new Error('Audio uploads must be 120 seconds or shorter.');
  return decoded;
}
const toPcm = (audio: AudioBuffer): PcmAudio => ({ sampleRate: audio.sampleRate, channels: Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)) });

export async function prepareAudio(duration: number, settings: AudioSettings, inputs: { music?: Blob; voice?: Blob } = {}): Promise<AudioBuffer | null> {
  validateDuration(duration); validateSettings(settings);
  if (settings.music === 'none' && !inputs.voice) return null;
  const [music, voice] = await Promise.all([
    settings.music === 'custom' && inputs.music ? decodeUploadedAudio(inputs.music) : undefined,
    inputs.voice ? decodeUploadedAudio(inputs.voice) : undefined,
  ]);
  const pcm = mixPcmAudio(duration, settings, { music: music ? toPcm(music) : undefined, voice: voice ? toPcm(voice) : undefined });
  if (typeof AudioBuffer === 'undefined') throw new Error('Audio preparation needs a browser with Web Audio support.');
  const buffer = new AudioBuffer({ numberOfChannels: 2, length: pcm.channels[0].length, sampleRate: AUDIO_SAMPLE_RATE });
  pcm.channels.forEach((channel, i) => buffer.getChannelData(i).set(channel));
  return buffer;
}

/** PCM16 WAV uses the same mixed samples that are passed to the MP4 encoder. */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const size = buffer.length * channels * 2;
  const bytes = new ArrayBuffer(44 + size);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + size, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, size, true);
  const pcm = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  for (let frame = 0; frame < buffer.length; frame++) for (let channel = 0; channel < channels; channel++) {
    const value = pcm[channel][frame];
    const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    view.setInt16(44 + (frame * channels + channel) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
