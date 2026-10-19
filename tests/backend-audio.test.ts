import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../worker/app';
import { createSession } from '../worker/auth';
import { recoverStaleSpeech } from '../worker/audio';
import { DEFAULT_AUDIO_SETTINGS, MAX_AUDIO_BYTES } from '../shared/audio';
import { makeDb, seedUser } from './backend-db';
import type { Env } from '../worker/types';

const origin = 'https://cmotionvideo.com';
function wav() {
  const bytes = new Uint8Array(48); const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => bytes.set(new TextEncoder().encode(text), offset);
  write(0, 'RIFF'); view.setUint32(4, 40, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, 4, true); return bytes;
}
function compressedAudio() {
  const mp3 = new Uint8Array(417); mp3.set([0xff, 0xfb, 0x90, 0x00]);
  const ogg = new Uint8Array(47); ogg.set(new TextEncoder().encode('OggS')); ogg[26] = 1; ogg[27] = 19; ogg.set(new TextEncoder().encode('OpusHead'), 28);
  const box = (kind: string, ...parts: Uint8Array[]) => {
    const bytes = new Uint8Array(8 + parts.reduce((n, part) => n + part.length, 0));
    new DataView(bytes.buffer).setUint32(0, bytes.length); bytes.set(new TextEncoder().encode(kind), 4);
    let offset = 8; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
  };
  const handler = new Uint8Array(20); handler.set(new TextEncoder().encode('soun'), 8);
  const m4a = new Uint8Array([
    ...box('ftyp', new TextEncoder().encode('M4A '), new Uint8Array(4), new TextEncoder().encode('isom')),
    ...box('moov', box('trak', box('mdia', box('hdlr', handler)))), ...box('mdat', new Uint8Array(4)),
  ]);
  return [{ bytes: mp3, type: 'audio/mpeg' }, { bytes: m4a, type: 'audio/mp4' }, { bytes: ogg, type: 'audio/ogg' }];
}

describe('private audio assets, settings and paid speech', () => {
  let env: Env; let cookie: string; let bobCookie: string;
  let objects: Map<string, { bytes: Uint8Array; type: string }>;
  const request = (path: string, init: RequestInit = {}) => app.request(origin + path, {
    ...init, headers: { Origin: origin, Cookie: cookie, ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  }, env);
  const upload = (bytes = wav(), type = 'audio/wav', projectId = 'mine') => {
    const form = new FormData(); form.set('file', new File([bytes], 'track.wav', { type })); form.set('projectId', projectId);
    return request('/api/audio/assets', { method: 'POST', body: form });
  };
  const voice = (overrides: Record<string, unknown> = {}) => request('/api/projects/mine/voice', {
    method: 'POST', body: JSON.stringify({ text: 'Welcome to our new product.', voice: 'alloy', idempotencyKey: 'speech-request-one', ...overrides }),
  });
  const balance = () => env.DB.prepare("SELECT credits FROM users WHERE id='alice'").first('credits');
  beforeEach(async () => {
    const { db } = makeDb(); await seedUser(db, 'alice', 40); await seedUser(db, 'bob', 40);
    cookie = `cmv_session=${await createSession(db, 'alice')}`; bobCookie = `cmv_session=${await createSession(db, 'bob')}`;
    for (const [id, user] of [['mine', 'alice'], ['second', 'alice'], ['bobs', 'bob']]) {
      await db.prepare('INSERT INTO projects (id,user_id,title,aspect,duration,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .bind(id, user, 'Demo', '16:9', 10, '2026-01-01', '2026-01-01').run();
    }
    objects = new Map();
    env = { DB: db, APP_URL: origin, APIMART_API_KEY: 'fixture-only', BUCKET: {
      async put(key: string, data: Uint8Array | ArrayBuffer, options?: { httpMetadata?: { contentType: string } }) {
        objects.set(key, { bytes: new Uint8Array(data), type: options?.httpMetadata?.contentType ?? '' });
      },
      async get(key: string) { const item = objects.get(key); return item ? { body: item.bytes, size: item.bytes.length, arrayBuffer: async () => item.bytes.buffer } : null; },
      async delete(key: string) { objects.delete(key); },
    } } as unknown as Env;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const input = JSON.parse(String(init.body));
      if (input.model !== 'gpt-4o-mini-tts' || input.response_format !== 'wav') return new Response('Invalid provider contract', { status: 400 });
      return new Response(wav(), { headers: { 'Content-Type': 'audio/wav' } });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns defaults only for an owned project', async () => {
    const response = await request('/api/projects/mine/audio');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settings: DEFAULT_AUDIO_SETTINGS, musicAsset: null, voiceAsset: null, revision: 0 });
    expect((await request('/api/projects/bobs/audio')).status).toBe(404);
  });
  it('stores a validated upload privately and binds it to its project', async () => {
    const response = await upload(); expect(response.status).toBe(201);
    const { asset } = await response.json();
    expect(asset).toMatchObject({ name: 'track.wav', mediaType: 'audio/wav', size: 48, url: `/api/audio/assets/${asset.id}` });
    const download = await request(asset.url); expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(wav());
    expect((await request(asset.url, { headers: { Cookie: bobCookie } })).status).toBe(404);
    expect((await upload(wav(), 'audio/wav', 'bobs')).status).toBe(404);
    expect((await request('/api/projects/second/audio', { method: 'PUT', body: JSON.stringify({ ...DEFAULT_AUDIO_SETTINGS, voiceAssetId: asset.id }) })).status).toBe(404);
  });
  it('rejects forged media, wrong MIME and oversized files without storing them', async () => {
    expect((await upload(new TextEncoder().encode('<html>not audio</html>'))).status).toBe(415);
    expect((await upload(wav(), 'audio/mpeg')).status).toBe(415);
    expect((await upload(new Uint8Array(MAX_AUDIO_BYTES + 1))).status).toBe(413);
    expect(objects.size).toBe(0);
  });
  it('accepts MP3, M4A audio and OGG containers after validating their headers', async () => {
    for (const fixture of compressedAudio()) {
      const response = await upload(fixture.bytes, fixture.type);
      expect(response.status).toBe(201);
      expect((await response.json()).asset.mediaType).toBe(fixture.type);
    }
  });
  it('enforces the 50-file quota before uploading or charging for speech', async () => {
    for (let index = 0; index < 50; index++) await env.DB.prepare('INSERT INTO audio_assets VALUES (?,?,?,?,?,?,?,?)')
      .bind(`seed-${index}`, 'alice', 'mine', 'existing.wav', 'audio/wav', 48, `existing/${index}`, '2026-01-01').run();
    expect((await upload()).status).toBe(413);
    expect((await voice()).status).toBe(413);
    expect(await balance()).toBe(40); expect(objects.size).toBe(0);
  });
  it('enforces the 200 MB aggregate quota even when fewer than 50 files exist', async () => {
    for (let index = 0; index < 20; index++) await env.DB.prepare('INSERT INTO audio_assets VALUES (?,?,?,?,?,?,?,?)')
      .bind(`seed-${index}`, 'alice', 'mine', 'existing.wav', 'audio/wav', MAX_AUDIO_BYTES, `existing/${index}`, '2026-01-01').run();
    expect((await upload()).status).toBe(413); expect(objects.size).toBe(0);
  });
  it('does not let concurrent uploads exceed the last remaining storage slot', async () => {
    for (let index = 0; index < 49; index++) await env.DB.prepare('INSERT INTO audio_assets VALUES (?,?,?,?,?,?,?,?)')
      .bind(`seed-${index}`, 'alice', 'mine', 'existing.wav', 'audio/wav', 48, `existing/${index}`, '2026-01-01').run();
    let release!: () => void; let waiting = 0;
    const bothReady = new Promise<void>(resolve => { release = resolve; });
    const put = env.BUCKET.put.bind(env.BUCKET);
    env.BUCKET.put = (async (...args: Parameters<typeof put>) => {
      await put(...args); waiting++;
      if (waiting === 2) release();
      await bothReady;
    }) as typeof env.BUCKET.put;
    const results = await Promise.all([upload(), upload()]);
    expect(results.map(response => response.status).sort()).toEqual([201, 413]);
    expect(objects.size).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audio_assets WHERE user_id='alice'").first('n')).toBe(50);
  });
  it('persists audio settings and invalidates prior exports only when settings change', async () => {
    const uploaded = await upload(); expect(uploaded.status).toBe(201); const { asset } = await uploaded.json();
    await env.DB.prepare("INSERT INTO versions (id,project_id,user_id,html,storyboard,prompt,asset_ids,mp4_key,created_at) VALUES ('v1','mine','alice','html','story','prompt','[]','old.mp4','2026-01-01')").run();
    const settings = { ...DEFAULT_AUDIO_SETTINGS, music: 'custom', musicAssetId: asset.id, musicVolume: 0.2 };
    const saved = await request('/api/projects/mine/audio', { method: 'PUT', body: JSON.stringify(settings) });
    expect(saved.status).toBe(200); expect(await saved.json()).toMatchObject({ settings, revision: 1 });
    expect(await env.DB.prepare("SELECT mp4_key FROM versions WHERE id='v1'").first('mp4_key')).toBeNull();
    await env.DB.prepare("UPDATE versions SET mp4_key='fresh.mp4' WHERE id='v1'").run();
    expect((await (await request('/api/projects/mine/audio', { method: 'PUT', body: JSON.stringify(settings) })).json()).revision).toBe(1);
    expect(await env.DB.prepare("SELECT mp4_key FROM versions WHERE id='v1'").first('mp4_key')).toBe('fresh.mp4');
    expect((await (await request('/api/projects/mine/audio')).json()).musicAsset.id).toBe(asset.id);
    expect((await request('/api/projects/mine/audio', { method: 'PUT', body: JSON.stringify({ ...settings, musicVolume: 1.1 }) })).status).toBe(400);
  });
  it('rejects an export rendered with stale audio settings and stores each fresh export under a unique key', async () => {
    await env.DB.prepare("INSERT INTO versions (id,project_id,user_id,html,storyboard,prompt,asset_ids,created_at) VALUES ('v1','mine','alice','html','story','prompt','[]','2026-01-01')").run();
    const bytes = new Uint8Array(16); bytes.set(new TextEncoder().encode('ftyp'), 4);
    const save = (revision?: number) => request('/api/projects/mine/versions/v1/mp4', { method: 'PUT', body: bytes,
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length), ...(revision === undefined ? {} : { 'X-Audio-Revision': String(revision) }) } });
    expect((await save()).status).toBe(200);
    const originalKey = await env.DB.prepare("SELECT mp4_key FROM versions WHERE id='v1'").first('mp4_key');
    await request('/api/projects/mine/audio', { method: 'PUT', body: JSON.stringify({ ...DEFAULT_AUDIO_SETTINGS, music: 'none' }) });
    expect((await save()).status).toBe(409); expect((await save(0)).status).toBe(409);
    expect((await save(1)).status).toBe(200);
    const currentKey = await env.DB.prepare("SELECT mp4_key FROM versions WHERE id='v1'").first('mp4_key');
    expect(currentKey).not.toBe(originalKey);
    const put = env.BUCKET.put.bind(env.BUCKET);
    env.BUCKET.put = (async (...args: Parameters<typeof put>) => {
      await put(...args);
      await request('/api/projects/mine/audio', { method: 'PUT', body: JSON.stringify({ ...DEFAULT_AUDIO_SETTINGS, music: 'ambient' }) });
    }) as typeof env.BUCKET.put;
    expect((await save(1)).status).toBe(409);
    expect(await env.DB.prepare("SELECT mp4_key FROM versions WHERE id='v1'").first('mp4_key')).toBeNull();
    expect([...objects.keys()].filter(key => key !== originalKey && key !== currentKey)).toHaveLength(0);
  });
  it('keeps only the winning object when two MP4 exports race for the same version', async () => {
    await env.DB.prepare("INSERT INTO versions (id,project_id,user_id,html,storyboard,prompt,asset_ids,created_at) VALUES ('v1','mine','alice','html','story','prompt','[]','2026-01-01')").run();
    const bytes = new Uint8Array(16); bytes.set(new TextEncoder().encode('ftyp'), 4);
    const save = () => request('/api/projects/mine/versions/v1/mp4', { method: 'PUT', body: bytes,
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length), 'X-Audio-Revision': '0' } });
    let release!: () => void; let waiting = 0;
    const bothReady = new Promise<void>(resolve => { release = resolve; });
    const put = env.BUCKET.put.bind(env.BUCKET);
    env.BUCKET.put = (async (...args: Parameters<typeof put>) => {
      await put(...args); if (++waiting === 2) release(); await bothReady;
    }) as typeof env.BUCKET.put;
    const responses = await Promise.all([save(), save()]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(objects.size).toBe(1);
    expect(objects.has(await env.DB.prepare("SELECT mp4_key FROM versions WHERE id='v1'").first<string>('mp4_key') ?? '')).toBe(true);
    env.BUCKET.put = (async (...args: Parameters<typeof put>) => { await put(...args); throw new Error('R2 acknowledgement lost'); }) as typeof env.BUCKET.put;
    expect((await save()).status).toBe(503); expect(objects.size).toBe(1);
  });
  it('charges once, returns the same asset on replay and never binds a late voice response automatically', async () => {
    const first = await voice(); expect(first.status).toBe(200); const result = await first.json();
    expect(result.cost).toBe(20); expect(await balance()).toBe(20);
    vi.stubGlobal('fetch', () => { throw new Error('A duplicate provider call is forbidden'); });
    expect(await (await voice()).json()).toEqual(result); expect(await balance()).toBe(20);
    expect((await (await request('/api/projects/mine/audio')).json()).settings.voiceAssetId).toBeNull();
    expect((await voice({ text: 'Different work on the same key' })).status).toBe(409);
  });
  it('does not make two paid provider calls when identical requests overlap', async () => {
    let release!: () => void; let submitted!: () => void;
    const started = new Promise<void>(resolve => { submitted = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', async () => { submitted(); await pending; return new Response(wav()); });
    const first = voice();
    expect(await Promise.race([started.then(() => null), first])).toBeNull();
    const second = await voice(); expect(second.status).toBe(409); expect(await balance()).toBe(20);
    release(); expect((await first).status).toBe(200); expect(await balance()).toBe(20);
  });
  it('does not allow deleting a project while its billed voiceover is running', async () => {
    let release!: () => void; let submitted!: () => void;
    const started = new Promise<void>(resolve => { submitted = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', async () => { submitted(); await pending; return new Response(wav()); });
    const first = voice(); expect(await Promise.race([started.then(() => null), first])).toBeNull();
    expect((await request('/api/projects/mine', { method: 'DELETE' })).status).toBe(409);
    release(); expect((await first).status).toBe(200);
    expect((await request('/api/projects/mine', { method: 'DELETE' })).status).toBe(200);
  });
  it('rolls back speech payment if a project disappears between validation and the debit transaction', async () => {
    const batch = env.DB.batch.bind(env.DB); let first = true;
    env.DB.batch = (async (...args: Parameters<typeof batch>) => {
      if (first) { first = false; await env.DB.prepare("DELETE FROM projects WHERE id='mine'").run(); }
      return batch(...args);
    }) as typeof env.DB.batch;
    vi.stubGlobal('fetch', () => { throw new Error('A deleted project must not trigger provider billing'); });
    expect((await voice()).status).toBe(404); expect(await balance()).toBe(40);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM speech_requests').first('n')).toBe(0);
  });
  it('refunds provider failure exactly once and preserves the failed request tombstone', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":"provider failed"}', { status: 502 }));
    expect((await voice()).status).toBe(503); expect(await balance()).toBe(40);
    vi.stubGlobal('fetch', () => { throw new Error('Failed key must not be retried'); });
    expect((await voice()).status).toBe(409); expect(await balance()).toBe(40);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE reason='Failed voiceover refund'").first('n')).toBe(1);
  });
  it('accepts a completed streamed WAV whose RIFF and data lengths use the unknown-size sentinel', async () => {
    const bytes = wav(); const view = new DataView(bytes.buffer);
    view.setUint32(4, 0xffffffff, true); view.setUint32(40, 0xffffffff, true);
    vi.stubGlobal('fetch', async () => new Response(bytes, { headers: { 'Content-Type': 'audio/wav' } }));
    expect((await voice()).status).toBe(200); expect(await balance()).toBe(20);
    const stored = [...objects.values()][0].bytes; const storedView = new DataView(stored.buffer);
    expect(storedView.getUint32(4, true)).toBe(stored.length - 8);
    expect(storedView.getUint32(40, true)).toBe(4);
  });
  it('refunds a successful HTTP response containing invalid audio instead of storing it', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":"invalid audio"}', { status: 200 }));
    expect((await voice()).status).toBe(503); expect(await balance()).toBe(40); expect(objects.size).toBe(0);
  });
  it('refunds storage failure and removes any partially stored audio object', async () => {
    const put = env.BUCKET.put.bind(env.BUCKET);
    env.BUCKET.put = (async (...args: Parameters<typeof put>) => { await put(...args); throw new Error('Uncertain R2 failure'); }) as typeof env.BUCKET.put;
    expect((await voice()).status).toBe(503); expect(await balance()).toBe(40); expect(objects.size).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM audio_assets').first('n')).toBe(0);
  });
  it('recovers a committed voice asset when the database acknowledgement is lost', async () => {
    const batch = env.DB.batch.bind(env.DB); let calls = 0;
    env.DB.batch = (async (...args: Parameters<typeof batch>) => {
      const result = await batch(...args);
      if (++calls === 2) throw new Error('D1 acknowledgement lost after commit');
      return result;
    }) as typeof env.DB.batch;
    const response = await voice(); expect(response.status).toBe(200);
    const { asset } = await response.json(); expect((await request(asset.url)).status).toBe(200);
    expect(await balance()).toBe(20); expect(objects.size).toBe(1);
  });
  it('rejects invalid speech or insufficient credits before contacting APIMart', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('No paid request should be sent'); });
    expect((await voice({ text: 'x'.repeat(601) })).status).toBe(400);
    expect((await voice({ voice: 'unapproved' })).status).toBe(400);
    await env.DB.prepare("INSERT INTO credit_ledger VALUES ('spent','alice',-40,'test','spent','2026-01-01')").run();
    expect((await voice()).status).toBe(402); expect(await balance()).toBe(0);
  });
  it('refunds abandoned requests once and refuses to publish a late provider result', async () => {
    let release!: () => void; let submitted!: () => void;
    const started = new Promise<void>(resolve => { submitted = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', async () => { submitted(); await pending; return new Response(wav()); });
    const first = voice(); expect(await Promise.race([started.then(() => null), first])).toBeNull();
    await env.DB.prepare("UPDATE speech_requests SET updated_at='2026-01-01' WHERE status='running'").run();
    await recoverStaleSpeech(env); await recoverStaleSpeech(env); expect(await balance()).toBe(40);
    release(); expect((await first).status).toBe(503); expect(await balance()).toBe(40);
    expect(objects.size).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM audio_assets').first('n')).toBe(0);
  });
  it('deletes project audio files while retaining the paid request tombstone', async () => {
    const first = await voice(); expect(first.status).toBe(200);
    expect((await request('/api/projects/mine', { method: 'DELETE' })).status).toBe(200);
    expect(objects.size).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM speech_requests').first('n')).toBe(1);
    expect(await balance()).toBe(20);
  });
});
