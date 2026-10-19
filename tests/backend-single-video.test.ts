import { afterEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { app } from '../worker/app';
import { createSession, digest } from '../worker/auth';
import { processStripeEvent } from '../worker/billing';
import { refundJob } from '../worker/credits';
import { createJob, type JobInput } from '../worker/jobs';
import type { Env, UserRow } from '../worker/types';
import { executeGeneration } from '../worker/workflow-runner';
import { makeDb, seedUser } from './backend-db';

const input: JobInput = { prompt: 'Animate this example', aspect: '16:9', duration: 30, assetIds: [], idempotencyKey: 'single_video_1' };
async function setup(credits = 0) {
  const { db, sqlite } = makeDb(); await seedUser(db, 'alice', credits);
  await db.prepare("UPDATE users SET stripe_customer_id='cus_alice' WHERE id='alice'").run();
  const env = { DB: db, APP_URL: 'https://cmotionvideo.com', APIMART_API_KEY: 'fixture', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_SINGLE_VIDEO_PRICE: 'price_video', GENERATION: { create: async () => ({}), get: async () => ({ status: async () => ({ status: 'queued' }) }) } } as unknown as Env;
  const user = (await db.prepare("SELECT * FROM users WHERE id='alice'").first<UserRow>())!;
  const session = { id: 'cs_video', mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 500, customer: 'cus_alice', client_reference_id: 'alice', metadata: { userId: 'alice', purchaseType: 'single_video' } };
  const lines = { object: 'list', has_more: false, data: [{ id: 'li_video', quantity: 1, price: { id: 'price_video', currency: 'usd', unit_amount: 500, type: 'one_time' } }] };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    if (path === '/v1/checkout/sessions/cs_video') return Response.json(session);
    if (path === '/v1/checkout/sessions/cs_video/line_items') return Response.json(lines);
    throw new Error(`Unexpected Stripe request ${path}`);
  });
  const event = (id: string, type = 'checkout.session.completed') => ({ id, type, data: { object: { id: 'cs_video', mode: 'payment', status: 'complete' } } }) as Stripe.Event;
  const me = async () => {
    const token = await createSession(db, 'alice');
    return (await app.request('/api/me', { headers: { Cookie: `cmv_session=${token}` } }, env)).json();
  };
  return { db, sqlite, env, user, session, lines, event, me };
}
afterEach(() => vi.unstubAllGlobals());

describe('single video purchases', () => {
  it('grants one video once per canonical paid Checkout across repeated and distinct event IDs, without credits', async () => {
    const { db, env, event, me } = await setup();
    await processStripeEvent(env, event('evt_1')); await processStripeEvent(env, event('evt_1')); await processStripeEvent(env, event('evt_2', 'checkout.session.async_payment_succeeded'));
    expect((await me()).user).toMatchObject({ credits: 0, singleVideoGenerations: 1 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM credit_ledger').first('n')).toBe(0);
  });
  it.each(['unpaid', 'currency', 'amount', 'price', 'quantity', 'customer', 'user', 'recurring', 'extra_items'] as const)('rejects a paid checkout with invalid %s', async invalid => {
    const { env, event, session, lines, me } = await setup();
    if (invalid === 'unpaid') session.payment_status = 'unpaid';
    if (invalid === 'currency') session.currency = 'eur';
    if (invalid === 'amount') session.amount_total = 499;
    if (invalid === 'price') lines.data[0].price.id = 'price_other';
    if (invalid === 'quantity') lines.data[0].quantity = 2;
    if (invalid === 'customer') session.customer = 'cus_someone_else';
    if (invalid === 'user') session.metadata.userId = 'bob';
    if (invalid === 'recurring') lines.data[0].price.type = 'recurring';
    if (invalid === 'extra_items') lines.has_more = true;
    await processStripeEvent(env, event('evt_bad'));
    expect((await me()).user).toMatchObject({ credits: 0, singleVideoGenerations: 0 });
  });
  it('consumes a video before credits and returns the same charge on retries', async () => {
    const { db, env, user, event, me } = await setup(500); await processStripeEvent(env, event('evt_paid'));
    for (const id of ['image1', 'image2', 'image3', 'image4']) await db.prepare('INSERT INTO assets(id,user_id,name,media_type,size,r2_key,created_at) VALUES (?,?,?,?,?,?,?)').bind(id, user.id, 'reference.png', 'image/png', 10, id, 'now').run();
    const maximumInput = { ...input, assetIds: ['image1', 'image2', 'image3', 'image4'] };
    const result = await createJob(env, user, maximumInput);
    expect(result).toMatchObject({ cost: 0, paymentType: 'single_video' });
    expect(await createJob(env, user, maximumInput)).toEqual(result);
    expect((await me()).user).toMatchObject({ credits: 500, singleVideoGenerations: 0 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM credit_ledger WHERE amount<0').first('n')).toBe(0);
  });
  it('cannot spend one video twice when two requests race and rolls back unpaid project creation', async () => {
    const { db, env, user, event, me } = await setup(); await processStripeEvent(env, event('evt_paid'));
    const results = await Promise.allSettled([createJob(env, user, input), createJob(env, user, { ...input, idempotencyKey: 'single_video_2' })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM projects').first('n')).toBe(1);
    expect((await me()).user).toMatchObject({ credits: 0, singleVideoGenerations: 0 });
  });
  it('refunds the original video once on failure and preserves its tombstone after project deletion', async () => {
    const { db, env, user, event, me } = await setup(); await processStripeEvent(env, event('evt_paid'));
    const job = await createJob(env, user, input);
    await refundJob(db, job.jobId, 'Provider failed'); await refundJob(db, job.jobId, 'Provider failed');
    expect((await me()).user).toMatchObject({ credits: 0, singleVideoGenerations: 1 });
    await db.prepare('DELETE FROM projects WHERE id=?').bind(job.projectId).run();
    await expect(createJob(env, user, input)).rejects.toMatchObject({ status: 409 });
    expect((await me()).user.singleVideoGenerations).toBe(1);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM projects').first('n')).toBe(0);
  });
  it('does not refund a completed video and uses credits for edits', async () => {
    const { db, env, user, event, me } = await setup(100); await processStripeEvent(env, event('evt_paid'));
    const job = await createJob(env, user, input);
    await db.prepare("UPDATE jobs SET status='completed' WHERE id=?").bind(job.jobId).run();
    await refundJob(db, job.jobId, 'Late error');
    await db.prepare("INSERT INTO versions (id,project_id,user_id,html,storyboard,prompt,asset_ids,created_at) VALUES ('v',?,'alice','','','demo','[]','now')").bind(job.projectId).run();
    const edit = await createJob(env, user, { ...input, projectId: job.projectId, versionId: 'v', idempotencyKey: 'single_edit_1' });
    expect(edit).toMatchObject({ cost: 20, paymentType: 'credits' });
    expect((await me()).user).toMatchObject({ credits: 80, singleVideoGenerations: 0 });
  });
  it('returns the purchased generation if workflow dispatch cannot start', async () => {
    const { db, env, user, event, me } = await setup(); await processStripeEvent(env, event('evt_paid'));
    env.GENERATION = { create: async () => { throw new Error('unavailable'); }, get: async () => { throw new Error('not found'); } } as unknown as Env['GENERATION'];
    await expect(createJob(env, user, input)).rejects.toMatchObject({ status: 503 });
    expect((await me()).user).toMatchObject({ credits: 0, singleVideoGenerations: 1 });
    expect(await db.prepare("SELECT status FROM jobs WHERE user_id='alice'").first('status')).toBe('failed');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM credit_ledger').first('n')).toBe(0);
  });
  it('returns one purchased generation after a provider failure even if the workflow retries', async () => {
    const { env, user, event, me } = await setup(); await processStripeEvent(env, event('evt_paid'));
    const job = await createJob(env, user, input);
    const step = { do: async (_name: string, optionsOrCallback: unknown, callback?: () => Promise<unknown>) => (callback ?? optionsOrCallback as () => Promise<unknown>)() };
    const fail = async () => { throw new Error('private provider message'); };
    await executeGeneration(env, step, job.jobId, fail); await executeGeneration(env, step, job.jobId, fail);
    expect((await me()).user).toMatchObject({ credits: 0, singleVideoGenerations: 1 });
    const stored = await env.DB.prepare('SELECT error FROM jobs WHERE id=?').bind(job.jobId).first<{ error: string }>();
    expect(stored!.error).not.toContain('private');
  });
  it('does not turn a purchased generation into AI voiceover credits', async () => {
    const { db, env, event, me } = await setup(); await processStripeEvent(env, event('evt_paid'));
    await db.prepare("INSERT INTO projects (id,user_id,title,aspect,duration,created_at,updated_at) VALUES ('p','alice','Demo','16:9',10,'now','now')").run();
    const token = await createSession(db, 'alice');
    const response = await app.request('/api/projects/p/voice', { method: 'POST', headers: { Origin: env.APP_URL, Cookie: `cmv_session=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Please speak this line.', voice: 'alloy', idempotencyKey: 'voice_request_1' }) }, env);
    expect(response.status).toBe(402);
    expect((await me()).user).toMatchObject({ credits: 0, singleVideoGenerations: 1 });
  });
  it('keeps old credit debit tombstones effective after a video purchase', async () => {
    const { db, env, user, event, me } = await setup(80);
    const id = `job_${(await digest(`${user.id}:${input.idempotencyKey}`)).slice(0, 48)}`;
    await db.prepare("INSERT INTO credit_ledger(id,user_id,amount,reason,external_key,created_at) VALUES ('legacy','alice',-80,'Animation generation',?,'now')").bind(`job:${id}`).run();
    await processStripeEvent(env, event('evt_paid'));
    await expect(createJob(env, user, input)).rejects.toMatchObject({ status: 409 });
    expect((await me()).user).toMatchObject({ credits: 0, singleVideoGenerations: 1 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM projects').first('n')).toBe(0);
  });
  it('returns zero videos for a new account and exposes public payment availability', async () => {
    const { env, me } = await setup();
    expect((await me()).user).toMatchObject({ credits: 0, singleVideoGenerations: 0 });
    expect(await (await app.request('/api/config', undefined, env)).json()).toMatchObject({ singleVideoEnabled: true });
  });
});
