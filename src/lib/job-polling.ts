import type { Job, Project, Version } from "./api";

type ProjectSnapshot = { project: Project; versions: Version[]; jobs: Job[] };

type JobPollHandlers = {
  getJob: (id: string) => Promise<Job>;
  loadProject: (id: string) => Promise<ProjectSnapshot>;
  onJob: (job: Job) => void;
  onComplete: (job: Job, project: ProjectSnapshot) => void;
  onFailed: (job: Job) => void;
  onError: (error: unknown) => void;
  intervalMs?: number;
};

/** Poll serially so a terminal job can load its saved version before the next poll. */
export function watchJob(jobId: string, handlers: JobPollHandlers): () => void {
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const poll = async () => {
    if (!live) return;
    try {
      const job = await handlers.getJob(jobId);
      if (!live) return;
      handlers.onJob(job);
      if (job.status === "completed") {
        const project = await handlers.loadProject(job.projectId);
        if (!live) return;
        handlers.onComplete(job, project);
        live = false;
        return;
      }
      if (job.status === "failed") {
        handlers.onFailed(job);
        live = false;
        return;
      }
    } catch (error) {
      if (live) handlers.onError(error);
    }
    if (live) timer = setTimeout(poll, handlers.intervalMs ?? 2200);
  };

  void poll();
  return () => {
    live = false;
    if (timer !== undefined) clearTimeout(timer);
  };
}
