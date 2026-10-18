import { MAX_AUDIO_BYTES } from "../../shared/audio";

const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/vorbis",
  "application/ogg",
]);
const AUDIO_FILE_EXTENSIONS = /\.(mp3|wav|m4a|ogg)$/i;

export function validateAudioFile(file: Pick<File, "name" | "type" | "size">) {
  if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) {
    throw new Error("Choose an audio file that is 10 MiB or smaller.");
  }
  const mime = file.type.toLowerCase().split(";")[0].trim();
  const supportedType = AUDIO_MIME_TYPES.has(mime) || (!mime && AUDIO_FILE_EXTENSIONS.test(file.name));
  if (!supportedType) {
    throw new Error("Use an MP3, WAV, M4A or OGG audio file.");
  }
}

export function validateAudioDuration(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not read the audio duration. Try another file.");
  }
  if (duration > 120) {
    throw new Error("Audio files must be 120 seconds or shorter.");
  }
}
