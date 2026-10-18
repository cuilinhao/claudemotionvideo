import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../worker/app';
import { createSession } from '../worker/auth';
import { completeJob } from '../worker/jobs';
import type { JobRow } from '../worker/types';
import { makeDb, seedUser } from './backend-db';
import type { Env } from '../worker/types';

const origin = 'https://claudemotionvideo.com';
describe('authenticated resource boundaries and durable job creation', () => {
  let env: Env; let cookie: string;
  const request = (path: string, init: RequestInit = {}) => app.request(origin + path, {
    ...init, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...init.headers },
  }, env);
  beforeEach(async () => {
    const { db } = makeDb(); await seedUser(db, 'alice', 80); await seedUser(db, 'bob', 100);
    cookie = `cmv_session=${await createSession(db, 'alice')}`;
    env = { DB: db, APP_URL: origin, APIMART_API_KEY: 'test-not-a-secret', GENERATION: { create: async () => ({ id: 'workflow' }) }, BUCKET: {}, ASSETS: {} } as unknown as Env;
    await db.prepare("INSERT INTO projects (id,user_id,title,aspect,duration,created_at,updated_at) VALUES ('bobs','bob','Private','16:9',15,'2026-01-01','2026-01-01')").run();
    await db.prepare("INSERT INTO assets (id,user_id,name,media_type,size,r2_key,created_at) VALUES ('bobasset','bob','photo.png','image/png',10,'private/bob','2026-01-01')").run();
    await db.prepare("INSERT INTO versions (id,project_id,user_id,html,storyboard,prompt,asset_ids,created_at) VALUES ('bobversion','bobs','bob','private code','shots','secret prompt','[]','2026-01-01')").run();
  });
  it('returns no private project, image, or MP4 belonging to another account', async () => {
    for (const path of ['/api/projects/bobs', '/api/assets/bobasset', '/api/projects/bobs/versions/bobversion/mp4']) {
      expect((await request(path)).status).toBe(404);
    }
    expect((await request('/api/projects/bobs', { method: 'DELETE' })).status).toBe(404);
    expect(await env.DB.prepare("SELECT id FROM projects WHERE id='bobs'").first('id')).toBe('bobs');
  });
  it('rejects cross-origin writes before authenticating or mutating anything', async () => {
    expect((await request('/api/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.test' } })).status).toBe(403);
    expect((await request('/api/me')).status).toBe(200);
  });
  it('renames only owned projects and rejects empty, oversized, or extra fields', async () => {
    await env.DB.prepare("INSERT INTO projects (id,user_id,title,aspect,duration,created_at,updated_at) VALUES ('mine','alice','Old name','16:9',15,'2026-01-01','2026-01-01')").run();
    const renamed = await request('/api/projects/mine', { method: 'PATCH', body: JSON.stringify({ title: '  New title  ' }) });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).project).toMatchObject({ id: 'mine', title: 'New title', aspect: '16:9', duration: 15 });
    expect(await env.DB.prepare("SELECT updated_at FROM projects WHERE id='mine'").first('updated_at')).not.toBe('2026-01-01');
    expect((await request('/api/projects/bobs', { method: 'PATCH', body: JSON.stringify({ title: 'Hijacked' }) })).status).toBe(404);
    for (const body of [{ title: ' ' }, { title: 'x'.repeat(121) }, { title: 'Changed', user_id: 'bob' }, { title: 'Changed', duration: 30 }]) {
      expect((await request('/api/projects/mine', { method: 'PATCH', body: JSON.stringify(body) })).status).toBe(400);
    }
    expect(await env.DB.prepare("SELECT title FROM projects WHERE id='mine'").first('title')).toBe('New title');
    expect(await env.DB.prepare("SELECT title FROM projects WHERE id='bobs'").first('title')).toBe('Private');
  });
  it('lists the real version count and only marks an export on the latest version', async () => {
    await env.DB.prepare("INSERT INTO projects (id,user_id,title,aspect,duration,latest_version_id,created_at,updated_at) VALUES ('mine','alice','Demo','16:9',15,'latest','2026-01-01','2026-01-01')").run();
    await env.DB.prepare("INSERT INTO versions (id,project_id,user_id,html,storyboard,prompt,asset_ids,mp4_key,created_at) VALUES ('older','mine','alice','html','[]','old','[]','old.mp4','2026-01-01'),('latest','mine','alice','html','[]','new','[]',NULL,'2026-01-02')").run();
    const first = await (await request('/api/projects')).json();
    expect(first.projects).toHaveLength(1);
    expect(first.projects[0]).toMatchObject({ id: 'mine', title: 'Demo', versionCount: 2, hasMp4: false, latestVersionId: 'latest' });
    await env.DB.prepare("UPDATE versions SET mp4_key='latest.mp4' WHERE id='latest'").run();
    expect((await (await request('/api/projects')).json()).projects[0].hasMp4).toBe(true);
  });
  it('creates one job and one debit across a retry with an exhausted balance', async () => {
    const body = JSON.stringify({ prompt: 'Make a sunrise', aspect: '16:9', duration: 10, assetIds: [], idempotencyKey: 'same-request-key' });
    const first = await request('/api/jobs', { method: 'POST', body });
    expect(first.status).toBe(202);
    const result = await first.json();
    const second = await request('/api/jobs', { method: 'POST', body });
    expect(second.status).toBe(202); expect(await second.json()).toEqual(result);
    expect(await env.DB.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id='alice'").first('n')).toBe(1);
    const insufficient = await request('/api/jobs', { method: 'POST', body: body.replace('same-request-key', 'new-request-key') });
    expect(insufficient.status).toBe(402);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM projects WHERE user_id='alice'").first('n')).toBe(1);
  });
  it('does not overspend when two independent job requests race for the same balance', async () => {
    const data = { prompt: 'Make a sunrise', aspect: '16:9', duration: 10, assetIds: [] };
    const responses = await Promise.all(['concurrent-key-one', 'concurrent-key-two'].map(idempotencyKey => request('/api/jobs', { method: 'POST', body: JSON.stringify({ ...data, idempotencyKey }) })));
    expect(responses.map(response => response.status).sort()).toEqual([202, 402]);
    expect(await env.DB.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id='alice'").first('n')).toBe(1);
  });
  it('returns the same job for simultaneous identical requests after rolling back the duplicate debit', async () => {
    const body = JSON.stringify({ prompt: 'Make a sunrise', aspect: '16:9', duration: 10, assetIds: [], idempotencyKey: 'simultaneous-same-key' });
    const responses = await Promise.all([request('/api/jobs', { method: 'POST', body }), request('/api/jobs', { method: 'POST', body })]);
    expect(responses.map(response => response.status)).toEqual([202, 202]);
    expect(await responses[0].json()).toEqual(await responses[1].json());
    expect(await env.DB.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id='alice'").first('n')).toBe(1);
  });
  it('rejects a reused idempotency key carrying different work', async () => {
    const data = { prompt: 'Make a sunrise', aspect: '16:9', duration: 10, assetIds: [], idempotencyKey: 'same-request-key' };
    await request('/api/jobs', { method: 'POST', body: JSON.stringify(data) });
    expect((await request('/api/jobs', { method: 'POST', body: JSON.stringify({ ...data, prompt: 'Different task' }) })).status).toBe(409);
  });
  it('does not recreate a deleted project from its historical billed request key', async () => {
    const data = { prompt: 'Make a sunrise', aspect: '16:9', duration: 10, assetIds: [], idempotencyKey: 'historical-request-key' };
    const first = await request('/api/jobs', { method: 'POST', body: JSON.stringify(data) });
    const created = await first.json();
    const job = (await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(created.jobId).first<JobRow>())!;
    await env.DB.prepare("UPDATE jobs SET status='running' WHERE id=?").bind(job.id).run();
    await completeJob(env.DB, job, { html: 'saved animation', storyboard: 'scene' });
    expect((await request(`/api/projects/${created.projectId}`, { method: 'DELETE' })).status).toBe(200);
    const replay = await request('/api/jobs', { method: 'POST', body: JSON.stringify({ ...data, duration: 30 }) });
    expect(replay.status).toBe(409);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id='alice'").first('n')).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM projects WHERE user_id='alice'").first('n')).toBe(0);
    expect(await env.DB.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(0);
  });
  it('keeps project duration and aspect stable so old versions remain exportable', async () => {
    await env.DB.prepare("INSERT INTO projects (id,user_id,title,aspect,duration,created_at,updated_at) VALUES ('mine','alice','Demo','16:9',10,'2026-01-01','2026-01-01')").run();
    const data = { prompt: 'Make a sunrise', projectId: 'mine', aspect: '9:16', duration: 10, assetIds: [], idempotencyKey: 'resized-request-key' };
    expect((await request('/api/jobs', { method: 'POST', body: JSON.stringify(data) })).status).toBe(400);
    expect(await env.DB.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(80);
  });
  it('does not permit generation from another user’s project, asset, or version', async () => {
    const data = { prompt: 'Make a sunrise', aspect: '16:9', duration: 10, assetIds: [], idempotencyKey: 'private-request-key' };
    for (const extra of [{ projectId: 'bobs' }, { assetIds: ['bobasset'] }, { versionId: 'bobversion' }]) {
      const response = await request('/api/jobs', { method: 'POST', body: JSON.stringify({ ...data, ...extra }) });
      expect([400, 404]).toContain(response.status);
    }
    expect(await env.DB.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(80);
  });
  it('refunds the debit when Workflow dispatch definitely fails', async () => {
    env.GENERATION = { create: async () => { throw new Error('unavailable'); }, get: async () => { throw new Error('not found'); } } as unknown as Env['GENERATION'];
    const response = await request('/api/jobs', { method: 'POST', body: JSON.stringify({ prompt: 'Make a sunrise', aspect: '16:9', duration: 10, assetIds: [], idempotencyKey: 'dispatch-failure-key' }) });
    expect(response.status).toBe(503);
    expect(await env.DB.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(80);
    expect(await env.DB.prepare("SELECT status FROM jobs WHERE user_id='alice'").first('status')).toBe('failed');
  });
  it('registers with zero credits and a HttpOnly session, then logs in and out', async () => {
    const payload = JSON.stringify({ email: ' New@Example.com ', password: 'a sufficiently long password' });
    const registration = await request('/api/auth/register', { method: 'POST', body: payload });
    expect(registration.status).toBe(201);
    expect((await registration.json()).user).toMatchObject({ email: 'new@example.com', credits: 0, plan: 'free' });
    expect(registration.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect(registration.headers.get('set-cookie')).toMatch(/Secure/);
    const login = await request('/api/auth/login', { method: 'POST', body: payload });
    expect(login.status).toBe(200);
    cookie = login.headers.get('set-cookie')!.split(';')[0];
    await request('/api/auth/logout', { method: 'POST' });
    expect((await (await request('/api/me')).json()).user).toBeNull();
  });
});
