import { describe, expect, it } from 'vitest';
import { makeDb, seedUser } from './backend-db';
import { creditStatement, refundJob } from '../worker/credits';
import { executeGeneration } from '../worker/workflow-runner';
import type { Env } from '../worker/types';

async function setup() {
  const { db } = makeDb(); await seedUser(db, 'alice', 100);
  await db.prepare("INSERT INTO projects (id,user_id,title,aspect,duration,created_at,updated_at) VALUES ('p','alice','Demo','16:9',15,'2026-01-01','2026-01-01')").run();
  await db.prepare("INSERT INTO jobs (id,user_id,project_id,prompt,aspect,duration,asset_ids,cost,status,idempotency_key,request_hash,created_at,updated_at) VALUES ('job_abc','alice','p','demo','16:9',15,'[]',100,'queued','key','hash','2026-01-01','2026-01-01')").run();
  await creditStatement(db, 'alice', -100, 'Generation', 'job:job_abc').run();
  return { db, env: { DB: db, BUCKET: {}, APIMART_API_KEY: 'fixture' } as unknown as Env };
}
const step = { do: async (_name: string, optionsOrCallback: unknown, callback?: () => Promise<unknown>) => (callback ?? optionsOrCallback as () => Promise<unknown>)() };
describe('durable generation outcomes', () => {
  it('saves the generated version, publishes its ID and does not refund a successful job', async () => {
    const { db, env } = await setup();
    await executeGeneration(env, step, 'job_abc', async () => ({ html: '<canvas id="stage"></canvas>', storyboard: 'Sunrise', usage: {} }));
    expect(await db.prepare("SELECT status FROM jobs WHERE id='job_abc'").first('status')).toBe('completed');
    expect(await db.prepare("SELECT html FROM versions WHERE id='version_abc'").first('html')).toBe('<canvas id="stage"></canvas>');
    expect(await db.prepare("SELECT latest_version_id FROM projects WHERE id='p'").first('latest_version_id')).toBe('version_abc');
    expect(await db.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(0);
  });
  it('refunds once after a provider failure and never exposes its private error', async () => {
    const { db, env } = await setup();
    await executeGeneration(env, step, 'job_abc', async () => { throw new Error('private upstream credentials'); });
    await executeGeneration(env, step, 'job_abc', async () => { throw new Error('should not run'); });
    expect(await db.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(100);
    const job = await db.prepare("SELECT status,error FROM jobs WHERE id='job_abc'").first<{ status: string; error: string }>();
    expect(job?.status).toBe('failed'); expect(job?.error).not.toContain('private');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM versions').first('n')).toBe(0);
  });
  it('does not publish a result that finished after a timeout refund', async () => {
    const { db, env } = await setup();
    await executeGeneration(env, step, 'job_abc', async () => {
      await refundJob(db, 'job_abc', 'Timed out');
      return { html: 'late result', storyboard: 'late', usage: {} };
    });
    expect(await db.prepare("SELECT credits FROM users WHERE id='alice'").first('credits')).toBe(100);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM versions').first('n')).toBe(0);
    expect(await db.prepare("SELECT status FROM jobs WHERE id='job_abc'").first('status')).toBe('failed');
  });
});
