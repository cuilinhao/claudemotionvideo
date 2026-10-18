import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { LoaderCircle, Music2, Upload, Volume2, WandSparkles } from "lucide-react";
import {
  DEFAULT_AUDIO_SETTINGS,
  MAX_VOICE_CHARACTERS,
  MUSIC_PRESETS,
  VOICES,
  type AudioAsset,
  type AudioSettings,
  type MusicPreset,
  type Voice,
} from "../shared/audio";
import { ApiRequestError, api, type User } from "./lib/api";
import { validateAudioDuration, validateAudioFile } from "./lib/audio-files";
import {
  audioBufferToWav,
  decodeUploadedAudio,
  prepareAudio,
} from "./lib/audio-engine";

export type PreparedAudio = {
  buffer: AudioBuffer | null;
  wav: Blob | null;
  musicDuration: number | null;
  voiceDuration: number | null;
};

type Props = {
  projectId: string;
  userId: string;
  duration: number;
  disabled: boolean;
  onAudioPrepared: (audio: PreparedAudio) => void;
  onPreparing: (preparing: boolean) => void;
  onRevision: (revision: number) => void;
  onCredits: () => void;
};

type VoiceAttempt = { fingerprint: string; key: string };

function assetDuration(duration: number | null, videoDuration: number) {
  if (!duration) return null;
  if (duration > videoDuration) return `Trimmed to ${videoDuration}s in this video`;
  if (duration < videoDuration) return `Audio ends at ${duration.toFixed(1)}s`;
  return `Matches ${videoDuration}s video`;
}

export function AudioPanel({
  projectId,
  userId,
  duration,
  disabled,
  onAudioPrepared,
  onPreparing,
  onRevision,
  onCredits,
}: Props) {
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [musicAsset, setMusicAsset] = useState<AudioAsset | null>(null);
  const [voiceAsset, setVoiceAsset] = useState<AudioAsset | null>(null);
  const [musicBlob, setMusicBlob] = useState<Blob | null>(null);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [musicDuration, setMusicDuration] = useState<number | null>(null);
  const [voiceDuration, setVoiceDuration] = useState<number | null>(null);
  const [resolvedAssetKey, setResolvedAssetKey] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [uploading, setUploading] = useState<"music" | "voice" | null>(null);
  const [generatingVoice, setGeneratingVoice] = useState(false);
  const [voiceText, setVoiceText] = useState("");
  const [voice, setVoice] = useState<Voice>("alloy");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const epochRef = useRef(0);
  const assetEpochRef = useRef(0);
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const voiceAttemptRef = useRef<VoiceAttempt | null>(null);
  const settingsRef = useRef(settings);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadKindRef = useRef<"music" | "voice">("music");
  settingsRef.current = settings;

  useEffect(() => {
    const epoch = ++epochRef.current;
    assetEpochRef.current++;
    let live = true;
    setSettings(DEFAULT_AUDIO_SETTINGS);
    setMusicAsset(null);
    setVoiceAsset(null);
    setMusicBlob(null);
    setVoiceBlob(null);
    setMusicDuration(null);
    setVoiceDuration(null);
    setHydrated(false);
    setLoading(true);
    setError("");
    setNotice("");
    setVoiceText("");
    voiceAttemptRef.current = null;
    onPreparing(true);

    api
      .projectAudio(projectId)
      .then((result) => {
        if (!live || epoch !== epochRef.current) return;
        setSettings(result.settings);
        onRevision(result.revision);
        setMusicAsset(result.musicAsset);
        setVoiceAsset(result.voiceAsset);
        setHydrated(true);
      })
      .catch((cause) => {
        if (!live || epoch !== epochRef.current) return;
        setError(cause instanceof Error ? cause.message : "Could not load project audio.");
      })
      .finally(() => {
        if (!live || epoch !== epochRef.current) return;
        setLoading(false);
      });

    return () => {
      live = false;
      epochRef.current++;
      assetEpochRef.current++;
      onPreparing(false);
    };
  }, [projectId, userId, loadAttempt]);

  useEffect(() => {
    onPreparing(loading || saving || dirty || uploading !== null || generatingVoice || preparing);
  }, [loading, saving, dirty, uploading, generatingVoice, preparing, onPreparing]);

  useEffect(() => {
    if (!hydrated) return;
    const epoch = ++assetEpochRef.current;
    let live = true;
    const musicId = settings.music === "custom" ? settings.musicAssetId : null;
    const voiceId = settings.voiceAssetId;
    const assetKey = `${musicId ?? ""}:${voiceId ?? ""}`;
    if (!musicId && !voiceId) {
      setResolvedAssetKey(assetKey);
      setMusicBlob(null);
      setVoiceBlob(null);
      setMusicDuration(null);
      setVoiceDuration(null);
      return () => {
        live = false;
      };
    }

    async function loadTracks() {
      setPreparing(true);
      try {
        const [music, voiceTrack] = await Promise.all([
          musicId ? api.audioAsset(musicId) : Promise.resolve(null),
          voiceId ? api.audioAsset(voiceId) : Promise.resolve(null),
        ]);
        const [musicDecoded, voiceDecoded] = await Promise.all([
          music ? decodeUploadedAudio(music) : Promise.resolve(null),
          voiceTrack ? decodeUploadedAudio(voiceTrack) : Promise.resolve(null),
        ]);
        if (!live || epoch !== assetEpochRef.current) return;
        setMusicBlob(music);
        setVoiceBlob(voiceTrack);
        setMusicDuration(musicDecoded?.duration ?? null);
        setVoiceDuration(voiceDecoded?.duration ?? null);
        setResolvedAssetKey(assetKey);
        setError("");
      } catch (cause) {
        if (!live || epoch !== assetEpochRef.current) return;
        setError(cause instanceof Error ? cause.message : "Could not load project audio assets.");
      }
    }
    void loadTracks();
    return () => {
      live = false;
    };
  }, [hydrated, settings.music, settings.musicAssetId, settings.voiceAssetId, retryToken]);

  useEffect(() => {
    if (!hydrated || loading) return;
    const epoch = epochRef.current;
    const assetKey = `${settings.music === "custom" ? settings.musicAssetId ?? "" : ""}:${settings.voiceAssetId ?? ""}`;
    if (resolvedAssetKey !== assetKey) {
      setPreparing(true);
      return;
    }
    const customMusicMissing = settings.music === "custom" && !musicBlob;
    if (customMusicMissing || (settings.voiceAssetId && !voiceBlob)) {
      setPreparing(true);
      return;
    }
    let live = true;
    setPreparing(true);
    const timer = setTimeout(() => {
      void prepareAudio(duration, settings, {
        ...(settings.music === "custom" && musicBlob ? { music: musicBlob } : {}),
        ...(voiceBlob ? { voice: voiceBlob } : {}),
      })
        .then((buffer) => {
          if (!live || epoch !== epochRef.current) return;
          const wav = buffer ? audioBufferToWav(buffer) : null;
          onAudioPrepared({ buffer, wav, musicDuration, voiceDuration });
          setPreparing(false);
        })
        .catch((cause) => {
          if (!live || epoch !== epochRef.current) return;
          setError(cause instanceof Error ? cause.message : "Could not prepare audio tracks.");
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    hydrated,
    loading,
    duration,
    settings,
    musicBlob,
    voiceBlob,
    musicDuration,
    voiceDuration,
    resolvedAssetKey,
    retryToken,
  ]);

  useEffect(() => {
    if (!hydrated || loading) return;
    const epoch = epochRef.current;
    const snapshot = settings;
    const timer = setTimeout(() => {
      setSaving(true);
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(() => {
          if (epoch !== epochRef.current) return;
          return api.saveProjectAudio(projectId, snapshot);
        })
        .then((saved) => {
          if (!saved || epoch !== epochRef.current) return;
          setMusicAsset(saved.musicAsset);
          setVoiceAsset(saved.voiceAsset);
          onRevision(saved.revision);
          if (settingsRef.current === snapshot) {
            setSaving(false);
            setDirty(false);
          }
        })
        .catch((cause) => {
          if (epoch !== epochRef.current) return;
          setSaving(false);
          setError(cause instanceof Error ? cause.message : "Could not save audio settings.");
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [hydrated, loading, projectId, settings, onRevision, retryToken]);

  function updateSettings(next: AudioSettings) {
    setError("");
    setNotice("");
    setSettings(next);
    setDirty(true);
  }

  async function uploadTrack(file: File, kind: "music" | "voice") {
    const epoch = epochRef.current;
    try {
      validateAudioFile(file);
      const decoded = await decodeUploadedAudio(file);
      validateAudioDuration(decoded.duration);
      const result = await api.uploadAudio(projectId, file);
      if (epoch !== epochRef.current) return;
      if (kind === "music") {
        setMusicAsset(result.asset);
        setMusicBlob(file);
        setMusicDuration(decoded.duration);
        updateSettings({ ...settingsRef.current, music: "custom", musicAssetId: result.asset.id });
      } else {
        setVoiceAsset(result.asset);
        setVoiceBlob(file);
        setVoiceDuration(decoded.duration);
        updateSettings({ ...settingsRef.current, voiceAssetId: result.asset.id });
      }
      setNotice(kind === "music" ? "Music added to this project." : "Voice track added to this project.");
    } catch (cause) {
      if (epoch === epochRef.current)
        setError(cause instanceof Error ? cause.message : "Could not upload audio.");
    }
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const kind = uploadKindRef.current;
    event.target.value = "";
    if (!file || uploading || disabled || (kind === "voice" && generatingVoice)) return;
    const epoch = epochRef.current;
    setUploading(kind);
    setError("");
    try {
      await uploadTrack(file, kind);
    } finally {
      if (epoch === epochRef.current) setUploading(null);
    }
  }

  async function generateVoice() {
    if (!voiceText.trim() || voiceText.length > MAX_VOICE_CHARACTERS || generatingVoice || disabled) return;
    const epoch = epochRef.current;
    const text = voiceText.trim();
    const fingerprint = `${text}\u0000${voice}`;
    const attempt = voiceAttemptRef.current?.fingerprint === fingerprint
      ? voiceAttemptRef.current
      : { fingerprint, key: crypto.randomUUID() };
    voiceAttemptRef.current = attempt;
    setGeneratingVoice(true);
    setError("");
    setNotice("");
    try {
      const result = await api.generateVoice({
        projectId,
        text,
        voice,
        idempotencyKey: attempt.key,
      });
      if (epoch !== epochRef.current) return;
      voiceAttemptRef.current = null;
      setVoiceAsset(result.asset);
      updateSettings({ ...settingsRef.current, voiceAssetId: result.asset.id });
      setNotice(`AI-generated voice added · ${result.cost} credits used.`);
      onCredits();
    } catch (cause) {
      if (epoch !== epochRef.current) return;
      if (cause instanceof ApiRequestError && (
        cause.code === "VOICE_FAILED" ||
        (cause.status < 500 && cause.code !== "VOICE_IN_PROGRESS")
      )) {
        voiceAttemptRef.current = null;
      }
      setError(cause instanceof Error ? cause.message : "Could not generate voice.");
    } finally {
      if (epoch === epochRef.current) setGeneratingVoice(false);
    }
  }

  function choosePreset(preset: MusicPreset) {
    updateSettings({ ...settingsRef.current, music: preset });
  }

  function selectFile(kind: "music" | "voice") {
    uploadKindRef.current = kind;
    inputRef.current?.click();
  }

  const selectedMusicDuration = settings.music === "custom" ? musicDuration : null;
  const controlsDisabled = disabled || loading || !hydrated;

  return (
    <section className="audio-panel" aria-labelledby="audio-panel-title">
      <div className="audio-panel-heading">
        <div>
          <span className="panel-kicker">SOUND / MIX</span>
          <h3 id="audio-panel-title"><Music2 size={15} /> Audio</h3>
        </div>
        {(loading || saving || uploading || generatingVoice) && (
          <span className="audio-saving" role="status">
            <LoaderCircle size={12} className="spin" />
            {loading ? "Loading" : saving ? "Saving" : generatingVoice ? "Creating voice" : "Uploading"}
          </span>
        )}
        {!loading && !hydrated && (
          <button className="button button-outline button-xs" onClick={() => setLoadAttempt((n) => n + 1)}>
            Retry load
          </button>
        )}
      </div>

      <div className="audio-field">
        <label htmlFor="music-preset">MUSIC</label>
        <select
          id="music-preset"
          value={settings.music}
          onChange={(event) => {
            const preset = event.target.value as MusicPreset;
            if (preset === "custom" && !settings.musicAssetId) selectFile("music");
            else choosePreset(preset);
          }}
          disabled={controlsDisabled}
        >
          {MUSIC_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset === "pulse" ? "Pulse · default" : preset[0].toUpperCase() + preset.slice(1)}
            </option>
          ))}
        </select>
        {settings.music === "custom" && musicAsset && (
          <div className="audio-custom-name">
            <small className="audio-file-name">{musicAsset.name}</small>
            <button type="button" className="audio-remove" onClick={() => {
              setMusicAsset(null); setMusicBlob(null); setMusicDuration(null);
              updateSettings({ ...settingsRef.current, music: "none", musicAssetId: null });
            }} disabled={controlsDisabled}>Remove</button>
          </div>
        )}
      </div>

      {settings.music === "custom" && (
        <div className="audio-upload-row">
          <span className="audio-duration">
            {assetDuration(selectedMusicDuration, duration) ?? "Add a music track"}
          </span>
          <button type="button" className="button button-outline button-xs" onClick={() => selectFile("music")} disabled={controlsDisabled || !!uploading}>
            <Upload size={13} /> {musicAsset ? "Replace music" : "Upload music"}
          </button>
        </div>
      )}

      {settings.music !== "none" && (
        <label className="audio-volume">
          <span><Volume2 size={13} /> Music volume</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(settings.musicVolume * 100)}
            onChange={(event) => updateSettings({ ...settingsRef.current, musicVolume: Number(event.target.value) / 100 })}
            disabled={controlsDisabled}
            aria-label="Music volume"
          />
          <output>{Math.round(settings.musicVolume * 100)}%</output>
        </label>
      )}

      <div className="audio-separator" />
      <div className="audio-voice-heading">
        <div>
          <label htmlFor="voiceover-text">VOICEOVER</label>
          <small>{voiceAsset ? voiceAsset.name : "Optional spoken narration"}</small>
        </div>
        <button type="button" className="button button-outline button-xs" onClick={() => selectFile("voice")} disabled={controlsDisabled || !!uploading || generatingVoice}>
          <Upload size={13} /> Upload
        </button>
      </div>
      {voiceAsset && (
        <div className="audio-voice-file">
          <small className="audio-duration">{assetDuration(voiceDuration, duration)}</small>
          <button type="button" className="audio-remove" onClick={() => {
            setVoiceAsset(null); setVoiceBlob(null); setVoiceDuration(null);
            updateSettings({ ...settingsRef.current, voiceAssetId: null });
          }} disabled={controlsDisabled || generatingVoice}>Remove</button>
        </div>
      )}
      <label className="audio-text-label" htmlFor="voiceover-text">Text to speech · up to 600 characters</label>
      <textarea
        id="voiceover-text"
        className="audio-voice-text"
        rows={3}
        maxLength={MAX_VOICE_CHARACTERS}
        value={voiceText}
        onChange={(event) => setVoiceText(event.target.value)}
        placeholder="Write a short narration…"
        disabled={controlsDisabled || generatingVoice}
      />
      <div className="audio-voice-controls">
        <select value={voice} onChange={(event) => setVoice(event.target.value as Voice)} disabled={controlsDisabled || generatingVoice} aria-label="AI voice">
          {VOICES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <span className="audio-character-count">{voiceText.length}/{MAX_VOICE_CHARACTERS}</span>
        <button type="button" className="button button-primary button-xs" onClick={() => void generateVoice()} disabled={controlsDisabled || generatingVoice || !voiceText.trim()}>
          {generatingVoice ? <LoaderCircle size={13} className="spin" /> : <WandSparkles size={13} />}
          AI-generated voice · 20 credits
        </button>
      </div>
      {settings.voiceAssetId && (
        <label className="audio-volume">
          <span><Volume2 size={13} /> Voice volume</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(settings.voiceVolume * 100)}
            onChange={(event) => updateSettings({ ...settingsRef.current, voiceVolume: Number(event.target.value) / 100 })}
            disabled={controlsDisabled}
            aria-label="Voice volume"
          />
          <output>{Math.round(settings.voiceVolume * 100)}%</output>
        </label>
      )}

      {error && <p className="audio-error" role="alert">{error}</p>}
      {error && hydrated && (
        <button type="button" className="button button-outline button-xs audio-retry" onClick={() => {
          setError("");
          setPreparing(true);
          setRetryToken((value) => value + 1);
        }} disabled={controlsDisabled}>Retry audio setup</button>
      )}
      {notice && <p className="audio-notice" role="status">{notice}</p>}
      {settings.music !== "none" && selectedMusicDuration !== null && selectedMusicDuration > duration && (
        <p className="audio-duration-warning">Music is longer than this video and will be trimmed to {duration} seconds.</p>
      )}
      {voiceDuration !== null && voiceDuration > duration && (
        <p className="audio-duration-warning">Voiceover is longer than this video and will be trimmed to {duration} seconds.</p>
      )}
      <input ref={inputRef} type="file" accept=".mp3,.wav,.m4a,.ogg,audio/mpeg,audio/wav,audio/mp4,audio/ogg" hidden onChange={(event) => void onFileChange(event)} />
    </section>
  );
}
