import { describe, expect, it } from "vitest";
import { validateAudioDuration, validateAudioFile } from "../src/lib/audio-files";

describe("audio upload validation", () => {
  it("accepts the supported audio types within the size limit", () => {
    expect(() => validateAudioFile({ name: "music.mp3", type: "audio/mpeg", size: 1024 })).not.toThrow();
    expect(() => validateAudioFile({ name: "music.m4a", type: "audio/mp4", size: 1024 })).not.toThrow();
    expect(() => validateAudioFile({ name: "music.ogg", type: "", size: 1024 })).not.toThrow();
  });

  it("rejects unsupported, empty and oversized files", () => {
    expect(() => validateAudioFile({ name: "sound.webm", type: "audio/webm", size: 1024 })).toThrow(/MP3, WAV, M4A or OGG/);
    expect(() => validateAudioFile({ name: "music.wav", type: "audio/wav", size: 0 })).toThrow(/10 MiB/);
    expect(() => validateAudioFile({ name: "music.wav", type: "audio/wav", size: 10 * 1024 * 1024 + 1 })).toThrow(/10 MiB/);
  });

  it("requires valid audio no longer than two minutes", () => {
    expect(() => validateAudioDuration(120)).not.toThrow();
    expect(() => validateAudioDuration(120.01)).toThrow(/120 seconds/);
    expect(() => validateAudioDuration(0)).toThrow(/duration/);
  });
});
