import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { DEFAULT_AUDIO_SETTINGS, MAX_AUDIO_BYTES, MAX_VOICE_CHARACTERS, MUSIC_PRESETS, VOICES, VOICE_CREDITS } from '../shared/audio';
import type { AudioAsset, AudioSettings, ProjectAudio } from '../shared/audio';
import { digest, rateLimit } from './auth';
import { creditStatement } from './credits';
import { ApiError } from './errors';
import type { ApiEnv, Env } from './types';

interface AudioRow {
  id: string; user_id: string; project_id: string; name: string; media_type: string;
  size: number; r2_key: string; created_at: string;
}
interface SpeechRow {
  id: string; user_id: string; project_id: string; request_hash: string;
  status: 'running' | 'completed' | 'failed'; asset_id: string | null;
}
const audioSettingsSchema = z.object({
  music: z.enum(MUSIC_PRESETS), musicVolume: z.number().min(0).max(1), voiceVolume: z.number().min(0).max(1),
  musicAssetId: z.string().min(1).max(100).nullable(), voiceAssetId: z.string().min(1).max(100).nullable(),
}).strict().refine(value => value.music !== 'custom' || !!value.musicAssetId);
const speechSchema = z.object({
  text: z.string().trim().min(1).max(MAX_VOICE_CHARACTERS), voice: z.enum(VOICES),
  idempotencyKey: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
const publicAudio = (row: AudioRow): AudioAsset => ({ id: row.id, name: row.name, mediaType: row.media_type, size: row.size, url: `/api/audio/assets/${row.id}` });
const textAt = (bytes: Uint8Array, offset: number, length: number) => new TextDecoder().decode(bytes.subarray(offset, offset + length));

/** Validate audio container headers, never trust a filename or supplied MIME. */
export function sniffAudio(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (textAt(bytes, 0, 4) === 'RIFF' && textAt(bytes, 8, 4) === 'WAVE') {
    const declaredEnd = view.getUint32(4, true);
    const end = declaredEnd === 0xffffffff ? bytes.length : declaredEnd + 8;
    if (end > bytes.length || end < 44) return null;
    let format = false; let data = false;
    for (let offset = 12; offset + 8 <= end;) {
      const tag = textAt(bytes, offset, 4); const declaredLength = view.getUint32(offset + 4, true);
      const length = declaredLength === 0xffffffff && tag === 'data' ? end - offset - 8 : declaredLength;
      if (offset + 8 + length > end) return null;
      if (tag === 'fmt ' && length >= 16) {
        const codec = view.getUint16(offset + 8, true); const channels = view.getUint16(offset + 10, true);
        const rate = view.getUint32(offset + 12, true); const bits = view.getUint16(offset + 22, true);
        format = [1, 3, 65534].includes(codec) && channels >= 1 && channels <= 8 && rate >= 8000 && rate <= 192000 && [8, 16, 24, 32, 64].includes(bits);
      }
      if (tag === 'data' && length > 0) data = true;
      offset += 8 + length + length % 2;
    }
    return format && data ? 'audio/wav' : null;
  }
  if (textAt(bytes, 0, 4) === 'OggS' && bytes.length >= 28 && bytes[4] === 0) {
    const segments = bytes[26]; const start = 27 + segments;
    if (!segments || start > bytes.length) return null;
    const pageLength = bytes.subarray(27, start).reduce((sum, length) => sum + length, 0);
    if (start + pageLength > bytes.length) return null;
    if ((pageLength >= 19 && textAt(bytes, start, 8) === 'OpusHead') ||
      (pageLength >= 30 && bytes[start] === 1 && textAt(bytes, start + 1, 6) === 'vorbis')) return 'audio/ogg';
    return null;
  }
  if (textAt(bytes, 4, 4) === 'ftyp') {
    let audio = false; let video = false; let data = false; let boxes = 0;
    const walk = (start: number, end: number, depth: number): boolean => {
      if (depth > 6) return false;
      for (let offset = start; offset < end;) {
        if (offset + 8 > end || ++boxes > 20_000) return false;
        let size = view.getUint32(offset); let header = 8;
        if (size === 1) {
          if (offset + 16 > end) return false;
          const largeSize = view.getBigUint64(offset + 8);
          if (largeSize > BigInt(end - offset)) return false;
          size = Number(largeSize); header = 16;
        } else if (size === 0) size = end - offset;
        if (size < header || offset + size > end) return false;
        const type = textAt(bytes, offset + 4, 4);
        if (['moov', 'trak', 'mdia'].includes(type) && !walk(offset + header, offset + size, depth + 1)) return false;
        if (type === 'hdlr' && size >= header + 12) {
          const handler = textAt(bytes, offset + header + 8, 4);
          if (handler === 'soun') audio = true;
          if (handler === 'vide') video = true;
        }
        if (type === 'mdat' && size > header) data = true;
        offset += size;
      }
      return true;
    };
    return walk(0, bytes.length, 0) && audio && data && !video ? 'audio/mp4' : null;
  }
  let offset = 0;
  if (textAt(bytes, 0, 3) === 'ID3') {
    if (bytes[3] < 2 || bytes[3] > 4 || bytes.subarray(6, 10).some(value => value & 128)) return null;
    offset = 10 + (bytes[6] << 21 | bytes[7] << 14 | bytes[8] << 7 | bytes[9]) + ((bytes[5] & 16) ? 10 : 0);
  }
  if (offset + 4 <= bytes.length && bytes[offset] === 255 && (bytes[offset + 1] & 224) === 224) {
    const version = (bytes[offset + 1] >> 3) & 3; const layer = (bytes[offset + 1] >> 1) & 3;
    const rateIndex = (bytes[offset + 2] >> 2) & 3; const bitIndex = bytes[offset + 2] >> 4;
    if (version === 1 || !layer || rateIndex === 3 || !bitIndex || bitIndex === 15) return null;
    const rates = version === 3
      ? layer === 3 ? [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448] : layer === 2 ? [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384] : [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]
      : layer === 3 ? [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
    const sampleRate = [44100,48000,32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const padding = (bytes[offset + 2] >> 1) & 1;
    const length = layer === 3 ? (Math.floor(12 * rates[bitIndex] * 1000 / sampleRate) + padding) * 4
      : Math.floor((layer === 1 && version !== 3 ? 72 : 144) * rates[bitIndex] * 1000 / sampleRate) + padding;
    if (offset + length <= bytes.length) return 'audio/mpeg';
  }
  return null;
}

async function requireProject(env: Env, userId: string, projectId: string) {
  if (!await env.DB.prepare('SELECT id FROM projects WHERE id=? AND user_id=?').bind(projectId, userId).first()) throw new ApiError(404, 'Project not found.');
}
async function ownedAudio(env: Env, userId: string, id: string, projectId?: string) {
  const row = await env.DB.prepare('SELECT * FROM audio_assets WHERE id=? AND user_id=?').bind(id, userId).first<AudioRow>();
  if (!row || (projectId && row.project_id !== projectId)) throw new ApiError(404, 'Audio not found.');
  return row;
}
export async function getProjectAudio(env: Env, userId: string, projectId: string): Promise<ProjectAudio> {
  await requireProject(env, userId, projectId);
  const saved = await env.DB.prepare('SELECT settings,revision FROM project_audio WHERE project_id=? AND user_id=?').bind(projectId, userId).first<{ settings: string; revision: number }>();
  const settings: AudioSettings = saved ? JSON.parse(saved.settings) : { ...DEFAULT_AUDIO_SETTINGS };
  const [music, voice] = await Promise.all([
    settings.musicAssetId ? ownedAudio(env, userId, settings.musicAssetId, projectId) : null,
    settings.voiceAssetId ? ownedAudio(env, userId, settings.voiceAssetId, projectId) : null,
  ]);
  return { settings, revision: saved?.revision ?? 0, musicAsset: music ? publicAudio(music) : null, voiceAsset: voice ? publicAudio(voice) : null };
}
async function saveProjectAudio(env: Env, userId: string, projectId: string, settings: AudioSettings) {
  await requireProject(env, userId, projectId);
  for (const id of [settings.musicAssetId, settings.voiceAssetId]) if (id) await ownedAudio(env, userId, id, projectId);
  const json = JSON.stringify(settings); const now = new Date().toISOString();
  const previousExports = await env.DB.prepare('SELECT mp4_key FROM versions WHERE project_id=? AND user_id=? AND mp4_key IS NOT NULL').bind(projectId, userId).all<{ mp4_key: string }>();
  const results = await env.DB.batch([
    env.DB.prepare('UPDATE versions SET mp4_key=NULL WHERE project_id=? AND user_id=? AND COALESCE((SELECT settings FROM project_audio WHERE project_id=?),?)<>?')
      .bind(projectId, userId, projectId, JSON.stringify(DEFAULT_AUDIO_SETTINGS), json),
    env.DB.prepare(`INSERT INTO project_audio (project_id,user_id,settings,revision,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET settings=excluded.settings,revision=project_audio.revision+1,updated_at=excluded.updated_at WHERE project_audio.settings<>excluded.settings`)
      .bind(projectId, userId, json, json === JSON.stringify(DEFAULT_AUDIO_SETTINGS) ? 0 : 1, now),
  ]);
  if (results[0].meta.changes) for (const version of previousExports.results) await env.BUCKET.delete(version.mp4_key);
  return getProjectAudio(env, userId, projectId);
}

async function checkAudioQuota(env: Env, userId: string, size = 0) {
  const usage = await env.DB.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS bytes FROM audio_assets WHERE user_id=?').bind(userId).first<{ count: number; bytes: number }>();
  if (usage && (usage.count >= 50 || usage.bytes >= 200 * 1024 * 1024 || usage.bytes + size > 200 * 1024 * 1024)) {
    throw new ApiError(413, 'Your audio storage limit has been reached. Delete an unused project to free space.', 'AUDIO_STORAGE_FULL');
  }
}

async function storeAudio(env: Env, userId: string, projectId: string, name: string, mediaType: string, bytes: Uint8Array, speechId?: string) {
  const id = speechId ? `audio_${speechId.slice(7)}` : crypto.randomUUID();
  const key = `users/${userId}/audio/${id}`; const now = new Date().toISOString();
  const row: AudioRow = { id, user_id: userId, project_id: projectId, name, media_type: mediaType, size: bytes.length, r2_key: key, created_at: now };
  try {
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: mediaType } });
    const values = [id, userId, projectId, name, mediaType, bytes.length, key, now];
    if (speechId) {
      const results = await env.DB.batch([
        env.DB.prepare(`INSERT INTO audio_assets (id,user_id,project_id,name,media_type,size,r2_key,created_at)
          SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM speech_requests WHERE id=? AND status='running')`).bind(...values, speechId),
        env.DB.prepare("UPDATE speech_requests SET status='completed',asset_id=?,updated_at=? WHERE id=? AND status='running'").bind(id, now, speechId),
      ]);
      if (!results[0].meta.changes) throw new Error('Speech request no longer active');
    } else {
      await env.DB.prepare('INSERT INTO audio_assets (id,user_id,project_id,name,media_type,size,r2_key,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(...values).run();
    }
  } catch (error) {
    // D1 may commit successfully even if its acknowledgement is interrupted.
    // Reconcile before deleting the file backing a successfully charged result.
    const saved = await env.DB.prepare('SELECT * FROM audio_assets WHERE id=? AND user_id=?').bind(id, userId).first<AudioRow>();
    if (saved?.r2_key === key) return publicAudio(saved);
    await env.BUCKET.delete(key);
    if (String(error).includes('AUDIO_STORAGE_FULL')) throw new ApiError(413, 'Your audio storage limit has been reached.', 'AUDIO_STORAGE_FULL');
    throw error;
  }
  return publicAudio(row);
}

export async function refundSpeech(env: Env, id: string) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE speech_requests SET status='failed',updated_at=? WHERE id=? AND status='running'").bind(now, id),
    env.DB.prepare(`INSERT INTO credit_ledger (id,user_id,amount,reason,external_key,created_at)
      SELECT ?,speech_requests.user_id,-debit.amount,'Failed voiceover refund',?,? FROM speech_requests
      JOIN credit_ledger AS debit ON debit.user_id=speech_requests.user_id AND debit.external_key=? AND debit.amount<0
      WHERE speech_requests.id=? AND speech_requests.status='failed' ON CONFLICT(external_key) DO NOTHING`)
      .bind(crypto.randomUUID(), `refund:${id}`, now, `speech:${id}`, id),
  ]);
}
async function priorSpeech(env: Env, request: SpeechRow, hash: string) {
  if (request.request_hash !== hash) throw new ApiError(409, 'This request key has already been used for different work.', 'IDEMPOTENCY_CONFLICT');
  if (request.status === 'running') throw new ApiError(409, 'This voiceover is still being generated. Try this request again shortly.', 'VOICE_IN_PROGRESS');
  if (request.status === 'failed') throw new ApiError(409, 'This voiceover request failed and was refunded. Start a new request.', 'VOICE_FAILED');
  const asset = await ownedAudio(env, request.user_id, request.asset_id!, request.project_id);
  return { asset: publicAudio(asset), cost: VOICE_CREDITS };
}
async function readAudioResponse(response: Response) {
  if (!response.ok || !response.body) throw new Error('Speech provider failed');
  const declared = Number(response.headers.get('Content-Length'));
  if (declared > MAX_AUDIO_BYTES) throw new Error('Audio too large');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > MAX_AUDIO_BYTES) throw new Error('Audio too large');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (sniffAudio(bytes) !== 'audio/wav') throw new Error('Speech provider returned invalid audio');
  // Streaming WAV encoders cannot know the size when writing the first header.
  // Finalize their sentinel sizes so browser decoders receive a regular WAV.
  const view = new DataView(bytes.buffer);
  if (view.getUint32(4, true) === 0xffffffff) view.setUint32(4, bytes.length - 8, true);
  for (let cursor = 12; cursor + 8 <= bytes.length;) {
    const length = view.getUint32(cursor + 4, true);
    if (length === 0xffffffff && textAt(bytes, cursor, 4) === 'data') {
      view.setUint32(cursor + 4, bytes.length - cursor - 8, true); break;
    }
    cursor += 8 + length + length % 2;
  }
  return bytes;
}
async function generateSpeech(env: Env, userId: string, projectId: string, input: z.infer<typeof speechSchema>) {
  await requireProject(env, userId, projectId);
  const id = `speech_${(await digest(`${userId}:${input.idempotencyKey}`)).slice(0, 48)}`;
  const hash = await digest(JSON.stringify({ projectId, text: input.text, voice: input.voice }));
  const existing = await env.DB.prepare('SELECT * FROM speech_requests WHERE id=? AND user_id=?').bind(id, userId).first<SpeechRow>();
  if (existing) return priorSpeech(env, existing, hash);
  if (!env.APIMART_API_KEY) throw new ApiError(503, 'AI voiceover is being configured. Please try again later.');
  await checkAudioQuota(env, userId);
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      creditStatement(env.DB, userId, -VOICE_CREDITS, 'AI voiceover', `speech:${id}`, false),
      env.DB.prepare("INSERT INTO speech_requests (id,user_id,project_id,request_hash,status,created_at,updated_at) VALUES (?,?,?,?,'running',?,?)").bind(id, userId, projectId, hash, now, now),
    ]);
  } catch (error) {
    if (String(error).includes('PROJECT_NOT_FOUND')) throw new ApiError(404, 'Project not found.');
    if (String(error).includes('INSUFFICIENT_CREDITS')) throw new ApiError(402, `Voiceover needs ${VOICE_CREDITS} credits. Choose a plan to continue.`, 'INSUFFICIENT_CREDITS');
    const prior = await env.DB.prepare('SELECT * FROM speech_requests WHERE id=? AND user_id=?').bind(id, userId).first<SpeechRow>();
    if (prior) return priorSpeech(env, prior, hash);
    throw error;
  }
  try {
    // One paid POST per permanent request record. Never retry an uncertain result.
    const response = await fetch('https://api.apimart.ai/v1/audio/speech', {
      method: 'POST', headers: { Authorization: `Bearer ${env.APIMART_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', input: input.text, voice: input.voice, response_format: 'wav', speed: 1 }),
      signal: AbortSignal.timeout(120_000),
    });
    const bytes = await readAudioResponse(response);
    const asset = await storeAudio(env, userId, projectId, `Voiceover (${input.voice}).wav`, 'audio/wav', bytes, id);
    return { asset, cost: VOICE_CREDITS };
  } catch {
    await refundSpeech(env, id);
    const settled = await env.DB.prepare('SELECT * FROM speech_requests WHERE id=? AND user_id=?').bind(id, userId).first<SpeechRow>();
    if (settled?.status === 'completed') return priorSpeech(env, settled, hash);
    throw new ApiError(503, 'We could not complete this voiceover. Your credits were refunded. Please start a new request.', 'VOICE_FAILED');
  }
}

export const audioRoutes = new Hono<ApiEnv>();
export async function recoverStaleSpeech(env: Env) {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const abandoned = await env.DB.prepare("SELECT id FROM speech_requests WHERE status='running' AND updated_at<? LIMIT 100").bind(cutoff).all<{ id: string }>();
  for (const request of abandoned.results) await refundSpeech(env, request.id);
}
audioRoutes.use('/api/projects/:id/audio', bodyLimit({ maxSize: 4096, onError: c => c.json({ error: 'Request too large.' }, 413) }));
audioRoutes.use('/api/projects/:id/voice', bodyLimit({ maxSize: 8192, onError: c => c.json({ error: 'Request too large.' }, 413) }));
audioRoutes.get('/api/projects/:id/audio', async c => c.json(await getProjectAudio(c.env, c.get('user')!.id, c.req.param('id'))));
audioRoutes.put('/api/projects/:id/audio', async c => {
  const parsed = audioSettingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, 'Choose valid audio settings and volume levels.');
  return c.json(await saveProjectAudio(c.env, c.get('user')!.id, c.req.param('id'), parsed.data));
});
audioRoutes.use('/api/audio/assets', bodyLimit({ maxSize: MAX_AUDIO_BYTES + 64 * 1024, onError: c => c.json({ error: 'Audio files must be under 10 MB.' }, 413) }));
audioRoutes.post('/api/audio/assets', async c => {
  const userId = c.get('user')!.id;
  if (!await rateLimit(c.env.DB, `audio:upload:${userId}`, 20, 60)) throw new ApiError(429, 'Too many uploads. Please wait a minute.');
  const form = await c.req.formData().catch(() => null); const file = form?.get('file'); const projectId = form?.get('projectId');
  if (typeof projectId !== 'string' || !projectId || projectId.length > 100) throw new ApiError(400, 'Choose a project for this audio.');
  await requireProject(c.env, userId, projectId);
  if (!file || typeof file === 'string' || file.size < 12) throw new ApiError(400, 'Upload a WAV, MP3, M4A or OGG audio file.');
  if (file.size > MAX_AUDIO_BYTES) throw new ApiError(413, 'Audio files must be under 10 MB.');
  await checkAudioQuota(c.env, userId, file.size);
  const bytes = new Uint8Array(await file.arrayBuffer()); const mediaType = sniffAudio(bytes);
  const aliases: Record<string, string> = { 'audio/wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/x-wav': 'audio/wav', 'audio/mpeg': 'audio/mpeg', 'audio/mp3': 'audio/mpeg', 'audio/mp4': 'audio/mp4', 'audio/x-m4a': 'audio/mp4', 'audio/ogg': 'audio/ogg', 'application/ogg': 'audio/ogg' };
  if (!mediaType || (file.type && aliases[file.type] !== mediaType)) throw new ApiError(415, 'Only valid WAV, MP3, M4A or OGG audio files are supported.');
  const name = file.name.replace(/[\r\n\x00-\x1f]/g, '').slice(0, 160) || 'Audio';
  return c.json({ asset: await storeAudio(c.env, userId, projectId, name, mediaType, bytes) }, 201);
});
audioRoutes.get('/api/audio/assets/:id', async c => {
  const asset = await ownedAudio(c.env, c.get('user')!.id, c.req.param('id'));
  const object = await c.env.BUCKET.get(asset.r2_key); if (!object) throw new ApiError(404, 'Audio not found.');
  return new Response(object.body, { headers: { 'Content-Type': asset.media_type, 'Content-Length': String(object.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});
audioRoutes.post('/api/projects/:id/voice', async c => {
  const userId = c.get('user')!.id;
  if (!await rateLimit(c.env.DB, `audio:voice:${userId}`, 10, 60)) throw new ApiError(429, 'Please wait before generating more voiceovers.');
  const parsed = speechSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, `Enter up to ${MAX_VOICE_CHARACTERS} characters and choose a supported voice.`, 'INVALID_INPUT');
  return c.json(await generateSpeech(c.env, userId, c.req.param('id'), parsed.data));
});
