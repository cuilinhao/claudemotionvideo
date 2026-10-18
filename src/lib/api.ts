export type User = {
  id: string;
  email: string;
  credits: number;
  plan: string | null;
  subscriptionStatus: string | null;
};
export type Project = {
  id: string;
  title: string;
  aspect: "16:9" | "9:16" | "1:1";
  duration: number;
  createdAt: string;
  updatedAt: string;
  latestVersionId?: string;
};
export type Version = {
  id: string;
  html: string;
  storyboard: string;
  prompt: string;
  createdAt: string;
  assetIds: string[];
};
export type Job = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: string;
  error?: string;
  versionId?: string;
  projectId: string;
};
type ApiError = { error?: string; code?: string };

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as ApiError;
      if (body.error) message = body.error;
    } catch {
      /* response wasn't JSON */
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json")
    ? (response.json() as Promise<T>)
    : (response.blob() as Promise<T>);
}

export const api = {
  me: () => request<{ user: User | null; billingEnabled: boolean }>("/api/me"),
  auth: (mode: "register" | "login", email: string, password: string) =>
    request<{ user: User }>(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  forgotPassword: (email: string) =>
    request<{ ok: true; message: string }>("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  projects: () => request<{ projects: Project[] }>("/api/projects"),
  project: (id: string) =>
    request<{ project: Project; versions: Version[]; jobs: Job[] }>(
      `/api/projects/${encodeURIComponent(id)}`,
    ),
  deleteProject: (id: string) =>
    request<{ ok: true }>(`/api/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  upload: (file: File) => {
    const data = new FormData();
    data.append("file", file);
    return request<{ asset: { id: string; url: string; name: string } }>(
      "/api/assets",
      { method: "POST", body: data },
    );
  },
  asset: (id: string) => request<Blob>(`/api/assets/${encodeURIComponent(id)}`),
  startJob: (input: {
    prompt: string;
    aspect: "16:9" | "9:16" | "1:1";
    duration: 10 | 15 | 30;
    assetIds: string[];
    projectId?: string;
    versionId?: string;
    selectedShot?: string;
    idempotencyKey: string;
  }) =>
    request<{ jobId: string; projectId: string; cost: number }>("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  job: (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}`),
  credits: () =>
    request<{
      credits: number;
      ledger: { amount: number; reason: string; createdAt: string }[];
    }>("/api/credits"),
  checkout: (plan: "starter" | "pro" | "max", interval: "month" | "year") =>
    request<{ url: string }>("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan, interval }),
    }),
  portal: () =>
    request<{ url: string }>("/api/billing/portal", { method: "POST" }),
  saveMp4: (projectId: string, versionId: string, blob: Blob) =>
    request<{ url: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/mp4`,
      { method: "PUT", headers: { "content-type": "video/mp4" }, body: blob },
    ),
  mp4: (projectId: string, versionId: string) =>
    request<Blob>(
      `/api/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/mp4`,
    ),
};

export async function assetDataUrl(id: string): Promise<string> {
  const blob = await api.asset(id);
  return blobDataUrl(blob);
}

export async function blobDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read uploaded image."));
    reader.readAsDataURL(blob);
  });
}
