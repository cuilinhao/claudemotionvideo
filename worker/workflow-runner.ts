import type { WorkflowStep } from 'cloudflare:workers';
import { generateAnimation } from './ai';
import { refundJob } from './credits';
import { completeJob } from './jobs';
import type { AssetRow, Env, JobRow, VersionRow } from './types';

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

export async function executeGeneration(env: Env, step: Pick<WorkflowStep, 'do'>, jobId: string, generate: typeof generateAnimation = generateAnimation) {
  try {
    const job = await step.do('Start generation', async () => {
      return env.DB.prepare("UPDATE jobs SET status='running',progress='Planning your animation',updated_at=? WHERE id=? AND status='queued' RETURNING *")
        .bind(new Date().toISOString(), jobId).first<JobRow>();
    });
    if (!job) return { skipped: true };
    const result = await step.do('Generate animation with AI', { retries: { limit: 0, delay: '1 second' }, timeout: '5 minutes' }, async () => {
      // No retry of a possibly billed provider request after an uncertain result.
      const claimed = await env.DB.prepare("UPDATE jobs SET ai_attempted=1,progress='Creating animation code',updated_at=? WHERE id=? AND status='running' AND ai_attempted=0 RETURNING id")
        .bind(new Date().toISOString(), job.id).first();
      if (!claimed) throw new Error('Generation already attempted or canceled');
      const assets = [];
      for (const id of JSON.parse(job.asset_ids) as string[]) {
        const asset = await env.DB.prepare('SELECT * FROM assets WHERE id=? AND user_id=?').bind(id, job.user_id).first<AssetRow>();
        if (!asset) throw new Error('Input image unavailable');
        const object = await env.BUCKET.get(asset.r2_key);
        if (!object) throw new Error('Input image unavailable');
        assets.push({ id, mediaType: asset.media_type, base64: toBase64(new Uint8Array(await object.arrayBuffer())) });
      }
      let previous: VersionRow | null = null;
      if (job.previous_version_id) {
        previous = await env.DB.prepare('SELECT * FROM versions WHERE id=? AND user_id=? AND project_id=?').bind(job.previous_version_id, job.user_id, job.project_id).first<VersionRow>();
        if (!previous) throw new Error('Previous version unavailable');
      }
      const output = await generate(env, {
        prompt: job.prompt, aspect: job.aspect, duration: job.duration, assets,
        ...(previous ? { previousHtml: previous.html } : {}), ...(job.selected_shot ? { selectedShot: job.selected_shot } : {}),
      });
      return { html: output.html, storyboard: output.storyboard };
    });
    const versionId = await step.do('Save animation version', async () => completeJob(env.DB, job, result));
    return { versionId };
  } catch (error) {
    console.error('Generation failed', { jobId, type: error instanceof Error ? error.name : 'Unknown' });
    await step.do('Refund failed generation', async () => {
      await refundJob(env.DB, jobId, 'We could not complete this animation. Your credits were refunded. Please try again.');
      return { refunded: true };
    });
    return { failed: true };
  }
}

export async function recoverStaleJobs(env: Env) {
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const stale = await env.DB.prepare("SELECT id FROM jobs WHERE status IN ('queued','running') AND updated_at<? LIMIT 100").bind(cutoff).all<{ id: string }>();
  for (const job of stale.results) {
    try { const instance = await env.GENERATION.get(job.id); await instance.terminate(); } catch { /* Missing/failed workflows still need refunds. */ }
    await refundJob(env.DB, job.id, 'Generation timed out. Your credits were refunded. Please try again.');
  }
}
