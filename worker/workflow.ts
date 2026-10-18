import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { executeGeneration } from './workflow-runner';
import type { Env } from './types';

export class GenerationWorkflow extends WorkflowEntrypoint<Env, { jobId: string }> {
  async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep) {
    return executeGeneration(this.env, step, event.payload.jobId);
  }
}
