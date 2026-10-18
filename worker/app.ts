import { Hono } from 'hono';
import { audioRoutes } from './audio';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { allowedOrigin, createSession, digest, getSessionUser, hashPassword, rateLimit, SESSION_AGE, SESSION_COOKIE, verifyPassword } from './auth';
import { ApiError } from './errors';
import { createJob, jobInputSchema, publicJob } from './jobs';
import { billingEnabled, createBillingPortal, createCheckout, processStripeEvent, verifyStripeEvent } from './billing';
import { requestPasswordReset, resetPassword } from './password-reset';
import { publicUser, type ApiEnv, type AssetRow, type JobRow, type ProjectRow, type UserRow, type VersionRow } from './types';

export const app = new Hono<ApiEnv>();
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.path !== '/api/billing/webhook') {
    if (!allowedOrigin(c.req.header('Origin') ?? null, c.env.APP_URL)) throw new ApiError(403, 'This request must come from this website.', 'ORIGIN_REJECTED');
  }
  const user = c.req.path === '/api/billing/webhook' ? null : await getSessionUser(c.env.DB, getCookie(c, SESSION_COOKIE));
  c.set('user', user);
  if (!user && c.req.path !== '/api/me' && !c.req.path.startsWith('/api/auth/') && c.req.path !== '/api/billing/webhook') throw new ApiError(401, 'Please sign in to continue.', 'AUTH_REQUIRED');
  await next();
});
app.use('/api/auth/*', bodyLimit({ maxSize: 4096, onError: c => c.json({ error: 'Request too large.' }, 413) }));
app.use('/api/jobs', bodyLimit({ maxSize: 32_768, onError: c => c.json({ error: 'Request too large.' }, 413) }));
app.get('/api/me', c => c.json({ user: c.get('user') ? publicUser(c.get('user')!) : null, billingEnabled: billingEnabled(c.env) }));

const credentials = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(10).max(128) });
for (const action of ['register', 'login'] as const) {
  app.post(`/api/auth/${action}`, async c => {
    const ip = c.req.header('CF-Connecting-IP') ?? 'local';
    if (!await rateLimit(c.env.DB, `auth:ip:${await digest(ip)}`, 25, 900)) throw new ApiError(429, 'Too many attempts. Try again in 15 minutes.', 'RATE_LIMITED');
    const parsed = credentials.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, 'Enter a valid email and a password between 10 and 128 characters.', 'INVALID_INPUT');
    const { email, password } = parsed.data;
    if (!await rateLimit(c.env.DB, `auth:email:${await digest(email)}`, 10, 900)) throw new ApiError(429, 'Too many attempts. Try again in 15 minutes.', 'RATE_LIMITED');
    let user = await c.env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first<UserRow>();
    if (action === 'register') {
      if (user) throw new ApiError(409, 'An account already exists for this email. Sign in instead.', 'ACCOUNT_EXISTS');
      const id = crypto.randomUUID();
      try { await c.env.DB.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').bind(id, email, await hashPassword(password), new Date().toISOString()).run(); }
      catch (error) { if (String(error).includes('UNIQUE')) throw new ApiError(409, 'An account already exists for this email.', 'ACCOUNT_EXISTS'); throw error; }
      user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first<UserRow>();
    } else {
      // Equal expensive work for unknown accounts avoids a fast email oracle.
      const valid = user ? await verifyPassword(password, user.password_hash) : (await hashPassword(password), false);
      if (!valid) throw new ApiError(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS');
    }
    if (!user) throw new Error('Account creation failed');
    const token = await createSession(c.env.DB, user.id);
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: new URL(c.env.APP_URL).protocol === 'https:', sameSite: 'Lax', path: '/', maxAge: SESSION_AGE });
    return c.json({ user: publicUser(user) }, action === 'register' ? 201 : 200);
  });
}
app.post('/api/auth/logout', async c => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' }); return c.json({ ok: true });
});
app.post('/api/auth/forgot-password', async c => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  if (!await rateLimit(c.env.DB, `reset:ip:${await digest(ip)}`, 10, 900)) throw new ApiError(429, 'Too many reset requests. Try again in 15 minutes.');
  const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, 'Enter a valid email address.');
  if (!await rateLimit(c.env.DB, `reset:email:${await digest(parsed.data.email)}`, 3, 900)) throw new ApiError(429, 'Too many reset requests. Try again in 15 minutes.');
  return c.json(await requestPasswordReset(c.env, parsed.data.email));
});
app.post('/api/auth/reset-password', async c => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  if (!await rateLimit(c.env.DB, `reset:complete:${await digest(ip)}`, 10, 900)) throw new ApiError(429, 'Too many reset attempts. Try again in 15 minutes.');
  const parsed = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: z.string().min(10).max(128) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, 'Enter a valid link token and a password between 10 and 128 characters.');
  const result = await resetPassword(c.env.DB, parsed.data.token, parsed.data.password);
  deleteCookie(c, SESSION_COOKIE, { path: '/' }); return c.json(result);
});

const publicProject = (project: ProjectRow) => ({ id: project.id, title: project.title, aspect: project.aspect, duration: project.duration, createdAt: project.created_at, updatedAt: project.updated_at, ...(project.latest_version_id ? { latestVersionId: project.latest_version_id } : {}) });
app.get('/api/projects', async c => {
  const rows = await c.env.DB.prepare('SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 200').bind(c.get('user')!.id).all<ProjectRow>();
  return c.json({ projects: rows.results.map(publicProject) });
});
app.get('/api/projects/:id', async c => {
  const userId = c.get('user')!.id;
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').bind(c.req.param('id'), userId).first<ProjectRow>();
  if (!project) throw new ApiError(404, 'Project not found.');
  const [versions, jobs] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM versions WHERE project_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100').bind(project.id, userId).all<VersionRow>(),
    c.env.DB.prepare('SELECT * FROM jobs WHERE project_id=? AND user_id=? ORDER BY created_at DESC LIMIT 30').bind(project.id, userId).all<JobRow>(),
  ]);
  return c.json({ project: publicProject(project), versions: versions.results.map(v => ({ id: v.id, html: v.html, storyboard: v.storyboard, prompt: v.prompt, createdAt: v.created_at, assetIds: JSON.parse(v.asset_ids) as string[] })), jobs: jobs.results.map(publicJob) });
});
app.delete('/api/projects/:id', async c => {
  const userId = c.get('user')!.id;
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').bind(c.req.param('id'), userId).first<ProjectRow>();
  if (!project) throw new ApiError(404, 'Project not found.');
  if (await c.env.DB.prepare("SELECT id FROM jobs WHERE project_id=? AND status IN ('queued','running')").bind(project.id).first()) throw new ApiError(409, 'Wait for this project’s generation to finish before deleting it.');
  if (await c.env.DB.prepare("SELECT id FROM speech_requests WHERE project_id=? AND user_id=? AND status='running'").bind(project.id, userId).first()) throw new ApiError(409, 'Wait for this project’s voiceover to finish before deleting it.');
  const versions = await c.env.DB.prepare('SELECT mp4_key FROM versions WHERE project_id=? AND mp4_key IS NOT NULL').bind(project.id).all<{ mp4_key: string }>();
  const audio = await c.env.DB.prepare('SELECT r2_key FROM audio_assets WHERE project_id=? AND user_id=?').bind(project.id, userId).all<{ r2_key: string }>();
  const removed = await c.env.DB.prepare("DELETE FROM projects WHERE id=? AND user_id=? AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running')) AND NOT EXISTS(SELECT 1 FROM speech_requests WHERE project_id=? AND user_id=? AND status='running')").bind(project.id, userId, project.id, project.id, userId).run();
  if (!removed.meta.changes) throw new ApiError(409, 'A generation is active. Please try again later.');
  for (const v of versions.results) await c.env.BUCKET.delete(v.mp4_key);
  for (const asset of audio.results) await c.env.BUCKET.delete(asset.r2_key);
  return c.json({ ok: true });
});
app.post('/api/jobs', async c => {
  const parsed = jobInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, 'Choose a prompt, a supported aspect ratio and duration, and up to four images.', 'INVALID_INPUT');
  if (!await rateLimit(c.env.DB, `jobs:${c.get('user')!.id}`, 30, 60)) throw new ApiError(429, 'Please wait before submitting more requests.');
  return c.json(await createJob(c.env, c.get('user')!, parsed.data), 202);
});
app.get('/api/jobs/:id', async c => {
  const job = await c.env.DB.prepare('SELECT * FROM jobs WHERE id=? AND user_id=?').bind(c.req.param('id'), c.get('user')!.id).first<JobRow>();
  if (!job) throw new ApiError(404, 'Job not found.'); return c.json(publicJob(job));
});
app.get('/api/credits', async c => {
  const ledger = await c.env.DB.prepare('SELECT amount,reason,created_at FROM credit_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(c.get('user')!.id).all<{ amount: number; reason: string; created_at: string }>();
  return c.json({ credits: c.get('user')!.credits, ledger: ledger.results.map(row => ({ amount: row.amount, reason: row.reason, createdAt: row.created_at })) });
});

app.use('/api/billing/*', bodyLimit({ maxSize: 1024 * 1024, onError: c => c.json({ error: 'Request too large.' }, 413) }));
app.post('/api/billing/checkout', async c => {
  if (!await rateLimit(c.env.DB, `billing:${c.get('user')!.id}`, 10, 60)) throw new ApiError(429, 'Please wait before trying again.');
  const parsed = z.object({ plan: z.enum(['starter', 'pro', 'max']), interval: z.enum(['month', 'year']) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, 'Choose a valid plan and billing interval.');
  return c.json(await createCheckout(c.env, c.get('user')!, parsed.data.plan, parsed.data.interval));
});
app.post('/api/billing/portal', async c => {
  if (!await rateLimit(c.env.DB, `billing:${c.get('user')!.id}`, 10, 60)) throw new ApiError(429, 'Please wait before trying again.');
  return c.json(await createBillingPortal(c.env, c.get('user')!));
});
app.post('/api/billing/webhook', async c => {
  if (!c.env.STRIPE_WEBHOOK_SECRET) throw new ApiError(503, 'Billing webhook is unavailable.');
  const raw = await c.req.text(); const signature = c.req.header('Stripe-Signature') ?? '';
  let event;
  try { event = await verifyStripeEvent(raw, signature, c.env.STRIPE_WEBHOOK_SECRET); }
  catch { throw new ApiError(400, 'Invalid webhook signature.', 'INVALID_SIGNATURE'); }
  await processStripeEvent(c.env, event); return c.json({ received: true });
});

app.use('/api/assets', bodyLimit({ maxSize: 8 * 1024 * 1024, onError: c => c.json({ error: 'Images must be under 5 MB.' }, 413) }));
app.post('/api/assets', async c => {
  const userId = c.get('user')!.id;
  if (!await rateLimit(c.env.DB, `uploads:${userId}`, 30, 60)) throw new ApiError(429, 'Too many uploads. Please wait a minute.');
  const form = await c.req.formData().catch(() => null); const file = form?.get('file');
  if (!file || typeof file === 'string' || file.size < 12 || file.size > 5 * 1024 * 1024) throw new ApiError(400, 'Upload a PNG, JPEG or WebP image under 5 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mediaType = sniffImage(bytes);
  if (!mediaType || mediaType !== file.type) throw new ApiError(415, 'Only valid PNG, JPEG and WebP images are supported.');
  const used = await c.env.DB.prepare('SELECT COALESCE(SUM(size),0) AS bytes,COUNT(*) AS count FROM assets WHERE user_id=?').bind(userId).first<{ bytes: number; count: number }>();
  if (used && (used.bytes + bytes.length > 500 * 1024 * 1024 || used.count >= 200)) throw new ApiError(413, 'Your image storage limit has been reached.');
  const id = crypto.randomUUID(); const key = `users/${userId}/assets/${id}`; const name = file.name.replace(/[\r\n\x00-\x1f]/g, '').slice(0, 160) || 'image';
  await c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: mediaType } });
  try { await c.env.DB.prepare('INSERT INTO assets (id,user_id,name,media_type,size,r2_key,created_at) VALUES (?,?,?,?,?,?,?)').bind(id, userId, name, mediaType, bytes.length, key, new Date().toISOString()).run(); }
  catch (error) { await c.env.BUCKET.delete(key); throw error; }
  return c.json({ asset: { id, url: `/api/assets/${id}`, name } }, 201);
});
app.get('/api/assets/:id', async c => {
  const asset = await c.env.DB.prepare('SELECT * FROM assets WHERE id=? AND user_id=?').bind(c.req.param('id'), c.get('user')!.id).first<AssetRow>();
  if (!asset) throw new ApiError(404, 'Image not found.');
  const object = await c.env.BUCKET.get(asset.r2_key); if (!object) throw new ApiError(404, 'Image not found.');
  return new Response(object.body, { headers: { 'Content-Type': asset.media_type, 'Content-Length': String(object.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});

app.put('/api/projects/:id/versions/:vid/mp4', async c => {
  const userId = c.get('user')!.id;
  const version = await c.env.DB.prepare('SELECT * FROM versions WHERE id=? AND project_id=? AND user_id=?').bind(c.req.param('vid'), c.req.param('id'), userId).first<VersionRow>();
  if (!version) throw new ApiError(404, 'Version not found.');
  if (!await rateLimit(c.env.DB, `exports:${userId}`, 10, 60)) throw new ApiError(429, 'Please wait before uploading more exports.');
  const requestedRevision = c.req.header('X-Audio-Revision') ?? '0';
  if (!/^\d+$/.test(requestedRevision) || !Number.isSafeInteger(Number(requestedRevision))) throw new ApiError(400, 'Invalid audio revision.');
  const revision = Number(requestedRevision);
  const currentRevision = await c.env.DB.prepare('SELECT revision FROM project_audio WHERE project_id=? AND user_id=?').bind(version.project_id, userId).first<number>('revision') ?? 0;
  if (revision !== currentRevision) throw new ApiError(409, 'Audio settings changed. Export the video again.', 'AUDIO_REVISION_CHANGED');
  const size = Number(c.req.header('Content-Length'));
  if (c.req.header('Content-Type')?.split(';')[0] !== 'video/mp4') throw new ApiError(415, 'Upload an MP4 video.');
  if (!Number.isSafeInteger(size) || size < 12 || size > 64 * 1024 * 1024) throw new ApiError(413, 'MP4 exports must be under 64 MB.');
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength !== size || new TextDecoder().decode(new Uint8Array(bytes, 4, 4)) !== 'ftyp') throw new ApiError(400, 'The export is not a valid MP4 file.');
  const key = `users/${userId}/videos/${version.id}/${crypto.randomUUID()}.mp4`;
  try {
    await c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: 'video/mp4' } });
    const saved = await c.env.DB.prepare('UPDATE versions SET mp4_key=? WHERE id=? AND user_id=? AND mp4_key IS ? AND COALESCE((SELECT revision FROM project_audio WHERE project_id=versions.project_id),0)=?').bind(key, version.id, userId, version.mp4_key, revision).run();
    if (!saved.meta.changes) throw new ApiError(409, 'This project changed while exporting. Export the video again.', 'EXPORT_CHANGED');
  } catch (error) {
    // Reconcile a possibly committed UPDATE before removing its media object.
    const storedKey = await c.env.DB.prepare('SELECT mp4_key FROM versions WHERE id=? AND user_id=?').bind(version.id, userId).first<string>('mp4_key');
    if (storedKey !== key) {
      await c.env.BUCKET.delete(key);
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'The export could not be saved. Please try exporting again.');
    }
  }
  if (version.mp4_key) await c.env.BUCKET.delete(version.mp4_key);
  return c.json({ url: `/api/projects/${version.project_id}/versions/${version.id}/mp4` });
});
app.get('/api/projects/:id/versions/:vid/mp4', async c => {
  const version = await c.env.DB.prepare('SELECT * FROM versions WHERE id=? AND project_id=? AND user_id=?').bind(c.req.param('vid'), c.req.param('id'), c.get('user')!.id).first<VersionRow>();
  if (!version?.mp4_key) throw new ApiError(404, 'Export not found. Export this version first.');
  const object = await c.env.BUCKET.get(version.mp4_key); if (!object) throw new ApiError(404, 'Export not found.');
  return new Response(object.body, { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(object.size), 'Content-Disposition': `attachment; filename="claude-motion-${version.id}.mp4"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});

export function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
app.route('/', audioRoutes);
app.notFound(c => c.json({ error: 'Not found.', code: 'NOT_FOUND' }, 404));
app.onError((error, c) => {
  if (error instanceof ApiError) return c.json({ error: error.message, code: error.code }, error.status);
  // Do not expose database internals or provider responses to clients or logs.
  console.error('API request failed', { path: c.req.path, type: error.name });
  return c.json({ error: 'Something went wrong. Please try again.', code: 'INTERNAL_ERROR' }, 500);
});
