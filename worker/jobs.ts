import { z } from 'zod';
import { digest } from './auth';
import { generationCost, refundJob } from './credits';
import { ApiError } from './errors';
import type { Env, JobRow, ProjectRow, UserRow, VersionRow } from './types';

export const jobInputSchema = z.object({
  prompt: z.string().trim().min(3).max(10_000),
  aspect: z.enum(['16:9', '9:16', '1:1']), duration: z.union([z.literal(10), z.literal(15), z.literal(30)]),
  assetIds: z.array(z.string().min(1).max(100)).max(4).default([]),
  projectId: z.string().min(1).max(100).optional(), versionId: z.string().min(1).max(100).optional(),
  selectedShot: z.string().max(2000).optional(), idempotencyKey: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
});
export type JobInput = z.infer<typeof jobInputSchema>;
export const publicJob = (job: JobRow) => ({ id: job.id, projectId: job.project_id, status: job.status, progress: job.progress, ...(job.error ? { error: job.error } : {}), ...(job.version_id ? { versionId: job.version_id } : {}) });

async function chargeResult(db: D1Database, job: JobRow) {
  const payment = await db.prepare('SELECT payment_type,charged_cost FROM generation_payments WHERE job_id=?').bind(job.id).first<{ payment_type: 'single_video' | 'credits'; charged_cost: number }>();
  return { jobId: job.id, projectId: job.project_id, cost: payment?.charged_cost ?? job.cost, paymentType: payment?.payment_type ?? 'credits' as const };
}

export async function createJob(env: Env, user: UserRow, input: JobInput) {
  const requestHash = await digest(JSON.stringify(input));
  const existing = await env.DB.prepare('SELECT * FROM jobs WHERE user_id=? AND idempotency_key=?').bind(user.id, input.idempotencyKey).first<JobRow>();
  if (existing) {
    if (existing.request_hash !== requestHash) throw new ApiError(409, 'This request key has already been used for different work.', 'IDEMPOTENCY_CONFLICT');
    return chargeResult(env.DB, existing);
  }
  const tombstone = await env.DB.prepare('SELECT job_id FROM generation_payments WHERE user_id=? AND idempotency_key=?').bind(user.id, input.idempotencyKey).first();
  if (tombstone) throw new ApiError(409, 'This request key has already been used. Start a new request.', 'IDEMPOTENCY_CONFLICT');
  if (new Set(input.assetIds).size !== input.assetIds.length) throw new ApiError(400, 'Each image may appear only once.');
  let project: ProjectRow | null = null;
  if (input.projectId) {
    project = await env.DB.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').bind(input.projectId, user.id).first<ProjectRow>();
    if (!project) throw new ApiError(404, 'Project not found.');
    if (project.aspect !== input.aspect || project.duration !== input.duration) throw new ApiError(400, 'Start a new project to change the aspect ratio or duration.', 'PROJECT_FORMAT_FIXED');
  }
  let previous: VersionRow | null = null;
  if (input.versionId) {
    if (!project) throw new ApiError(400, 'Choose the project for this version.');
    previous = await env.DB.prepare('SELECT * FROM versions WHERE id=? AND project_id=? AND user_id=?').bind(input.versionId, project.id, user.id).first<VersionRow>();
    if (!previous) throw new ApiError(404, 'Version not found.');
  }
  if (input.selectedShot && !previous) throw new ApiError(400, 'Shot edits require an existing version.');
  for (const id of input.assetIds) {
    if (!await env.DB.prepare('SELECT id FROM assets WHERE id=? AND user_id=?').bind(id, user.id).first()) throw new ApiError(404, 'Image not found.');
  }
  if (!env.APIMART_API_KEY) throw new ApiError(503, 'AI generation is being configured. Please try again later.', 'AI_UNAVAILABLE');
  const previousAssets: string[] = previous ? JSON.parse(previous.asset_ids) : [];
  const cost = generationCost({ duration: input.duration, assetCount: input.assetIds.length, edit: !!previous, newAssetCount: input.assetIds.filter(id => !previousAssets.includes(id)).length });
  const id = `job_${(await digest(`${user.id}:${input.idempotencyKey}`)).slice(0, 48)}`;
  const projectId = project?.id ?? `project_${id.slice(4)}`;
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO projects (id,user_id,title,aspect,duration,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
        .bind(projectId, user.id, input.prompt.slice(0, 80), input.aspect, input.duration, now, now),
      // Select the payment inside the same transaction as both debit and job.
      // The request tombstone survives project deletion and prevents switching
      // payment sources from making a duplicate request payable again.
      env.DB.prepare(`INSERT INTO generation_payments(job_id,user_id,idempotency_key,request_hash,payment_type,charged_cost,created_at)
        SELECT ?,?,?,?,CASE WHEN ?=0 AND COALESCE((SELECT balance FROM single_video_balances WHERE user_id=?),0)>0 THEN 'single_video' ELSE 'credits' END,
        CASE WHEN ?=0 AND COALESCE((SELECT balance FROM single_video_balances WHERE user_id=?),0)>0 THEN 0 ELSE ? END,?`)
        .bind(id, user.id, input.idempotencyKey, requestHash, previous ? 1 : 0, user.id, previous ? 1 : 0, user.id, cost, now),
      env.DB.prepare(`INSERT INTO single_video_ledger(id,user_id,amount,reason,external_key,created_at)
        SELECT ?,user_id,-1,'Animation generation',?,? FROM generation_payments WHERE job_id=? AND payment_type='single_video'`)
        .bind(crypto.randomUUID(), `job:${id}`, now, id),
      env.DB.prepare(`INSERT INTO credit_ledger(id,user_id,amount,reason,external_key,created_at)
        SELECT ?,user_id,-charged_cost,?,?,? FROM generation_payments WHERE job_id=? AND payment_type='credits'`)
        .bind(crypto.randomUUID(), previous ? 'Animation edit' : 'Animation generation', `job:${id}`, now, id),
      // Keep the nominal legacy credit cost for compatibility with deployed
      // jobs CHECK(cost>0). generation_payments is the charged-cost authority.
      env.DB.prepare(`INSERT INTO jobs (id,user_id,project_id,prompt,aspect,duration,asset_ids,previous_version_id,selected_shot,cost,status,idempotency_key,request_hash,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'queued',?,?,?,?) ON CONFLICT(user_id,idempotency_key) DO NOTHING`)
        .bind(id, user.id, projectId, input.prompt, input.aspect, input.duration, JSON.stringify(input.assetIds), previous?.id ?? null, input.selectedShot ?? null, cost, input.idempotencyKey, requestHash, now, now),
    ]);
  } catch (error) {
    if (String(error).includes('INSUFFICIENT_CREDITS')) throw new ApiError(402, previous ? `This edit needs ${cost} credits. Choose a subscription to continue.` : `Buy one video for $5 or choose a subscription to cover ${cost} credits.`, 'INSUFFICIENT_CREDITS');
    if (await env.DB.prepare('SELECT job_id FROM generation_payments WHERE job_id=?').bind(id).first() || await env.DB.prepare('SELECT id FROM credit_ledger WHERE external_key=?').bind(`job:${id}`).first()) {
      const concurrent = await env.DB.prepare('SELECT * FROM jobs WHERE id=? AND user_id=?').bind(id, user.id).first<JobRow>();
      if (concurrent && concurrent.request_hash === requestHash) return chargeResult(env.DB, concurrent);
      throw new ApiError(409, 'This request key has already been used. Start a new request.', 'IDEMPOTENCY_CONFLICT');
    }
    throw error;
  }
  const stored = await env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first<JobRow>();
  if (!stored || stored.request_hash !== requestHash) throw new ApiError(409, 'This request key has already been used for different work.', 'IDEMPOTENCY_CONFLICT');
  if (stored.status === 'queued') {
    try { await env.GENERATION.create({ id, params: { jobId: id } }); }
    catch {
      try { const instance = await env.GENERATION.get(id); await instance.status(); }
      catch {
        await refundJob(env.DB, id, 'The generation service could not start. Your credits or purchased generation were returned.');
        throw new ApiError(503, 'The generation service could not start. Your credits or purchased generation were returned.', 'GENERATION_UNAVAILABLE');
      }
    }
  }
  return chargeResult(env.DB, stored);
}

export async function completeJob(db: D1Database, job: JobRow, result: { html: string; storyboard: string }) {
  const versionId = `version_${job.id.slice(4)}`;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO versions (id,project_id,user_id,html,storyboard,prompt,asset_ids,created_at)
      SELECT ?,project_id,user_id,?,?,prompt,asset_ids,? FROM jobs WHERE id=? AND status='running'
      ON CONFLICT(id) DO NOTHING`).bind(versionId, result.html, result.storyboard, now, job.id),
    db.prepare("UPDATE jobs SET status='completed',progress='Ready to preview and export',version_id=?,updated_at=? WHERE id=? AND status='running'")
      .bind(versionId, now, job.id),
    db.prepare("UPDATE projects SET latest_version_id=?,aspect=?,duration=?,updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND status='completed' AND version_id=?)")
      .bind(versionId, job.aspect, job.duration, now, job.project_id, job.id, versionId),
  ]);
  return versionId;
}
