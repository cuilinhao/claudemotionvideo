import { describe, expect, it, vi } from "vitest";
import { watchJob } from "../src/lib/job-polling";
import type { Job, Project, Version } from "../src/lib/api";

const job = (status: Job["status"]): Job => ({
  id: "job-1",
  projectId: "project-1",
  status,
  progress: status,
});

const result = {
  project: {
    id: "project-1",
    title: "Test",
    aspect: "16:9" as const,
    duration: 10,
    createdAt: "",
    updatedAt: "",
  } satisfies Project,
  versions: [
    {
      id: "version-1",
      html: "<canvas id=\"stage\"></canvas>",
      storyboard: "[]",
      prompt: "test",
      createdAt: "",
      assetIds: [],
    },
  ] satisfies Version[],
  jobs: [],
};

describe("watchJob", () => {
  it("loads and activates a completed version after the job status changes", async () => {
    let resolveProject!: (value: typeof result) => void;
    const projectPromise = new Promise<typeof result>((resolve) => {
      resolveProject = resolve;
    });
    const loadProject = vi.fn(() => projectPromise);
    const onComplete = vi.fn();
    const stop = watchJob("job-1", {
      getJob: async () => job("completed"),
      loadProject,
      onJob: vi.fn(),
      onComplete,
      onFailed: vi.fn(),
      onError: vi.fn(),
    });

    await vi.waitFor(() => expect(loadProject).toHaveBeenCalledOnce());
    resolveProject(result);
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith(job("completed"), result));
    stop();
  });

  it("does not apply a completion after the selected job has changed", async () => {
    let resolveProject!: (value: typeof result) => void;
    const projectPromise = new Promise<typeof result>((resolve) => {
      resolveProject = resolve;
    });
    const loadProject = vi.fn(() => projectPromise);
    const onComplete = vi.fn();
    const stop = watchJob("job-1", {
      getJob: async () => job("completed"),
      loadProject,
      onJob: vi.fn(),
      onComplete,
      onFailed: vi.fn(),
      onError: vi.fn(),
    });

    await vi.waitFor(() => expect(loadProject).toHaveBeenCalledOnce());
    stop();
    resolveProject(result);
    await Promise.resolve();
    await Promise.resolve();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
