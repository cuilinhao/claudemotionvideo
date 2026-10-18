export const MUSIC_PRESETS = ['pulse', 'ambient', 'uplift', 'none', 'custom'] as const;
export type MusicPreset = typeof MUSIC_PRESETS[number];
export const VOICES = ['alloy', 'nova', 'onyx'] as const;
export type Voice = typeof VOICES[number];
export const VOICE_CREDITS = 20;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_VOICE_CHARACTERS = 600;
export interface AudioSettings {
  music: MusicPreset;
  musicVolume: number;
  voiceVolume: number;
  musicAssetId: string | null;
  voiceAssetId: string | null;
}
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  music: 'pulse', musicVolume: 0.3, voiceVolume: 1,
  musicAssetId: null, voiceAssetId: null,
};
export interface AudioAsset {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  url: string;
}
export interface ProjectAudio {
  revision: number;
  settings: AudioSettings;
  musicAsset: AudioAsset | null;
  voiceAsset: AudioAsset | null;
}
