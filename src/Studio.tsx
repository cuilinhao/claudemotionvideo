import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleHelp,
  Clock3,
  CloudUpload,
  Download,
  Film,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageSquareText,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Settings2,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import {
  api,
  assetDataUrl,
  blobDataUrl,
  type Job,
  type Project,
  type User,
  type Version,
} from "./lib/api";
import { templateData } from "./lib/content";
import type { AuthMode } from "./lib/ui-types";
import { watchJob } from "./lib/job-polling";
import { estimateGenerationCost } from "./lib/generation-cost";
import {
  buildPreviewDocument,
  exportMp4,
  isPreviewMessage,
} from "./lib/renderer";
import { Brand } from "./Marketing";

function StudioHeader({
  user,
  onAuth,
  onLogout,
}: {
  user: User | null;
  onAuth: (m: AuthMode) => void;
  onLogout: () => void;
}) {
  return (
    <header className="studio-header">
      <div className="studio-brand">
        <Brand small />
        <span className="studio-divider" />{" "}
        <span className="studio-label">STUDIO</span>
      </div>
      <div className="studio-head-right">
        <span className="credit-pill">
          <Sparkles size={13} />
          {user?.credits.toLocaleString() ?? "0"} <small>credits</small>
        </span>
        {user ? (
          <button className="icon-button" onClick={onLogout} title="Sign out">
            <LogOut size={16} />
          </button>
        ) : (
          <button className="sign-in" onClick={() => onAuth("login")}>
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}
type Uploaded = { id: string; url: string; name: string; preview: string };
export function StudioPage({
  user,
  onAuth,
  onCredits,
  onLogout,
}: {
  user: User | null;
  onAuth: (m: AuthMode) => void;
  onCredits: () => void;
  onLogout: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [activeVersion, setActiveVersion] = useState<Version | null>(null);
  const [assets, setAssets] = useState<Uploaded[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [duration, setDuration] = useState<10 | 15 | 30>(15);
  const [selectedShot, setSelectedShot] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [jobProgress, setJobProgress] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [timeline, setTimeline] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [readyChannel, setReadyChannel] = useState("");
  const [toast, setToast] = useState("");
  const [mobilePanel, setMobilePanel] = useState<
    "projects" | "chat" | "preview"
  >("preview");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewChannel, setPreviewChannel] = useState(() =>
    crypto.randomUUID(),
  );
  const selectionRef = useRef(0);
  const assetLoadRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentRef = useRef(false);
  const storyboard = useMemo(() => {
    try {
      const x = JSON.parse(activeVersion?.storyboard ?? "[]");
      return Array.isArray(x)
        ? (x as {
            id: string;
            title: string;
            start: number;
            end: number;
            description: string;
          }[])
        : [];
    } catch {
      return [];
    }
  }, [activeVersion]);
  useEffect(() => {
    setPlaying(false);
    setTimeline(0);
    setSelectedShot("");
  }, [activeVersion?.id]);
  const hasProject = Boolean(projectId);
  const estimatedCost = estimateGenerationCost({
    duration,
    assetIds: assets.map((asset) => asset.id),
    ...(activeVersion ? { previousAssetIds: activeVersion.assetIds } : {}),
  });
  useEffect(() => {
    if (query.has("template")) {
      const t = templateData.find((x) => x.name === query.get("template"));
      if (t) {
        setPrompt(
          `Create a ${t.duration}-second ${t.name.toLowerCase()} motion graphic. ${t.desc} Use a clear opening, one memorable moment and a polished end card.`,
        );
        setDuration(t.duration as 10 | 15 | 30);
        setAspect(t.aspect as "16:9" | "9:16" | "1:1");
      }
    }
    if (query.has("prompt"))
      setPrompt(
        `Create a motion graphic using this effect: ${query.get("prompt")}`,
      );
  }, [location.search]);
  useEffect(() => {
    let alive = true;
    if (!user) return;
    api
      .projects()
      .then((r) => {
        if (alive) setProjects(r.projects);
      })
      .catch((e) => {
        setError(
          e instanceof Error ? e.message : "Could not load this project.",
        );
      });
    return () => {
      alive = false;
    };
  }, [user]);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    api
      .project(projectId)
      .then((r) => {
        if (!alive) return;
        setProject(r.project);
        setAspect(r.project.aspect);
        setDuration(r.project.duration as 10 | 15 | 30);
        setVersions(r.versions);
        const v =
          r.versions.find((x) => x.id === r.project.latestVersionId) ??
          r.versions[0];
        setAssetsLoading(Boolean(v));
        setPreviewChannel(crypto.randomUUID());
        setReadyChannel("");
        setActiveVersion(v ?? null);
        const activeJob =
          r.jobs.find((x) => x.status === "queued" || x.status === "running") ??
          null;
        setJob(activeJob);
        setBusy(Boolean(activeJob));
        setJobProgress(activeJob?.progress ?? "");
      })
      .catch((e) => {
        if (!alive) return;
        setAssetsLoading(false);
        setError(e instanceof Error ? e.message : "Could not load this project.");
      });
    return () => {
      alive = false;
    };
  }, [projectId]);
  useEffect(() => {
    const loadId = ++assetLoadRef.current;
    let alive = true;
    if (!activeVersion) {
      setAssets([]);
      return () => {
        alive = false;
      };
    }
    setAssetsLoading(true);
    Promise.all(
      activeVersion.assetIds.map(async (id) => ({
        id,
        name: `Image ${id.slice(0, 6)}`,
        preview: await assetDataUrl(id),
        url: "",
      })),
    )
      .then((items) => {
        if (alive && loadId === assetLoadRef.current) setAssets(items);
      })
      .catch((e) => {
        if (alive && loadId === assetLoadRef.current)
          setError(
            e instanceof Error ? e.message : "Could not load project images.",
          );
      })
      .finally(() => {
        if (alive && loadId === assetLoadRef.current) setAssetsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeVersion?.id]);
  useEffect(() => {
    const handler = () => newProject();
    window.addEventListener("cmv:new-project", handler);
    return () => window.removeEventListener("cmv:new-project", handler);
  });
  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed") return;
    return watchJob(job.id, {
      getJob: api.job,
      loadProject: api.project,
      onJob: (next) => {
        setJob(next);
        setJobProgress(next.progress);
      },
      onComplete: (next, r) => {
        setProjectId(next.projectId);
        setProject(r.project);
        setProjects((p) => [r.project, ...p.filter((x) => x.id !== r.project.id)]);
        setVersions(r.versions);
        const v = r.versions.find((x) => x.id === next.versionId) ?? r.versions[0];
        setPreviewChannel(crypto.randomUUID());
        setReadyChannel("");
        setActiveVersion(v ?? null);
        setBusy(false);
        onCredits();
        setToast("Your video is ready.");
        setTimeout(() => setToast(""), 3000);
      },
      onFailed: (next) => {
        setBusy(false);
        setError(
          next.error ||
            "This generation did not finish. Credits have been returned if the request failed on our side.",
        );
        onCredits();
      },
      onError: (e) =>
        setError(
          e instanceof Error ? e.message : "Could not check generation status.",
        ),
    });
  }, [job?.id]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        !isPreviewMessage(
          event,
          iframeRef.current?.contentWindow ?? null,
          previewChannel,
        )
      )
        return;
      const d = event.data;
      if (d.type === "cmv:ready") {
        setReadyChannel(previewChannel);
        setError("");
      }
      if (d.type === "cmv:error")
        setError(
          typeof d.error === "string" ? d.error : "Preview could not load.",
        );
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [previewChannel]);
  useEffect(() => {
    if (!playing || exporting) return;
    const id = setInterval(
      () => setTimeline((t) => (t >= duration ? 0 : t + 0.2)),
      200,
    );
    return () => clearInterval(id);
  }, [playing, duration, exporting]);
  useEffect(() => {
    if (!playing || exporting) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "cmv:seek", time: timeline, channel: previewChannel },
      "*",
    );
  }, [timeline, playing, exporting, previewChannel]);
  async function uploadFiles(files: FileList | null) {
    if (!files) return;
    if (!user) {
      onAuth("login");
      return;
    }
    const available = 4 - assets.length;
    if (available <= 0) {
      setError("A video supports up to four images.");
      return;
    }
    if (assetsLoading) {
      setError("Wait for this version’s reference images to finish loading.");
      return;
    }
    const selection = selectionRef.current;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files).slice(0, available)) {
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
          throw new Error("Choose a PNG, JPEG or WebP image.");
        const result = await api.upload(file);
        const preview = await blobDataUrl(file);
        if (selection !== selectionRef.current) return;
        setAssets((a) => [
          ...a,
          {
            id: result.asset.id,
            url: result.asset.url,
            name: result.asset.name,
            preview,
          },
        ]);
      }
    } catch (e) {
      if (selection === selectionRef.current)
        setError(e instanceof Error ? e.message : "Could not upload image.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  function removeAsset(id: string) {
    setAssets((a) => a.filter((x) => x.id !== id));
  }
  async function startGeneration() {
    if (!user) {
      onAuth("login");
      return;
    }
    if (busy || exporting) return;
    if (!prompt.trim()) {
      setError("Write one sentence about the motion you want to make.");
      return;
    }
    setError("");
    setBusy(true);
    setJobProgress("Starting a new scene…");
    const selection = selectionRef.current;
    try {
      const result = await api.startJob({
        prompt: prompt.trim(),
        aspect,
        duration,
        assetIds: assets.map((x) => x.id),
        ...(projectId ? { projectId } : {}),
        ...(activeVersion ? { versionId: activeVersion.id } : {}),
        ...(selectedShot ? { selectedShot } : {}),
        idempotencyKey: crypto.randomUUID(),
      });
      if (selection !== selectionRef.current) return;
      setProjectId(result.projectId);
      setJob({
        id: result.jobId,
        status: "queued",
        progress: "Waiting for a render slot",
        projectId: result.projectId,
      });
      setJobProgress("Waiting for a render slot");
      onCredits();
    } catch (e) {
      if (selection === selectionRef.current) {
        setBusy(false);
        setError(
          e instanceof Error ? e.message : "Could not start your generation.",
        );
      }
    }
  }
  async function chooseVersion(v: Version) {
    if (busy || uploading || exporting) return;
    if (activeVersion?.id === v.id) return;
    setAssetsLoading(true);
    setActiveVersion(v);
    setSelectedShot("");
    setTimeline(0);
    setPreviewChannel(crypto.randomUUID());
    setReadyChannel("");
  }
  const previewAssets = useMemo(
    () => Object.fromEntries(assets.map((a) => [a.id, a.preview])),
    [assets],
  );
  const previewDocument = useMemo(() => {
    if (!activeVersion) return { html: "", error: "" };
    try {
      return {
        html: buildPreviewDocument(
          activeVersion.html,
          previewAssets,
          previewChannel,
        ),
        error: "",
      };
    } catch (e) {
      return {
        html: "",
        error:
          e instanceof Error ? e.message : "Could not prepare this preview.",
      };
    }
  }, [activeVersion, previewAssets, previewChannel]);
  const previewReady = Boolean(
    activeVersion && readyChannel === previewChannel && !previewDocument.error,
  );
  async function exportVideo() {
    if (!activeVersion || !projectId || !user) return;
    if (!previewReady) {
      setError("Wait for the preview to finish loading before exporting.");
      return;
    }
    if (!iframeRef.current) {
      setError("The preview is still loading. Try again in a moment.");
      return;
    }
    setExporting(true);
    setPlaying(false);
    setError("");
    setExportProgress(0);
    try {
      let blob = await exportMp4(iframeRef.current, {
        channel: previewChannel,
        duration,
        aspect,
        onProgress: setExportProgress,
      });
      const saved = await api.saveMp4(projectId, activeVersion.id, blob);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(project?.title || "motion-study").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setToast("MP4 downloaded and saved to this project.");
      setTimeout(() => setToast(""), 3000);
      void saved;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export this video.");
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }
  async function openProject(p: Project) {
    if (exporting) return;
    selectionRef.current++;
    assetLoadRef.current++;
    setPreviewChannel(crypto.randomUUID());
    setReadyChannel("");
    setAssetsLoading(true);
    setProjectId(p.id);
    setProject(p);
    setActiveVersion(null);
    setVersions([]);
    setJob(null);
    setBusy(false);
    setAssets([]);
    setError("");
    setMobilePanel("preview");
  }
  async function deleteProject(id: string) {
    if (exporting || busy) return;
    if (!window.confirm("Delete this project and its versions?")) return;
    try {
      await api.deleteProject(id);
      setProjects((p) => p.filter((x) => x.id !== id));
      if (projectId === id) {
        selectionRef.current++;
        assetLoadRef.current++;
        setAssetsLoading(false);
        setProjectId("");
        setProject(null);
        setVersions([]);
        setActiveVersion(null);
        setJob(null);
        setBusy(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete project.");
    }
  }
  function newProject() {
    if (exporting) return;
    selectionRef.current++;
    assetLoadRef.current++;
    setPreviewChannel(crypto.randomUUID());
    setReadyChannel("");
    setAssetsLoading(false);
    setProjectId("");
    setProject(null);
    setVersions([]);
    setActiveVersion(null);
    setAssets([]);
    setPrompt("");
    setJob(null);
    setBusy(false);
    setError("");
    navigate("/studio");
    setMobilePanel("chat");
  }
  async function editShot(id: string) {
    if (busy || exporting) return;
    setSelectedShot(id);
    setMobilePanel("chat");
  }
  function seek(t: number) {
    setTimeline(Math.min(duration, Math.max(0, t)));
    iframeRef.current?.contentWindow?.postMessage(
      { type: "cmv:seek", time: t, channel: previewChannel },
      "*",
    );
  }
  const needsAuth = !user;
  return (
    <main className="studio-shell">
      <StudioHeader user={user} onAuth={onAuth} onLogout={onLogout} />
      {needsAuth && (
        <div className="studio-signin-hint">
          <span>
            <LockKeyhole size={15} />
            Sign in to save credits and create videos.
          </span>
          <button
            className="button button-primary button-xs"
            onClick={() => onAuth("login")}
          >
            Sign in <ArrowRight size={14} />
          </button>
        </div>
      )}
      <div className="studio-toolbar">
        <div className="project-name">
          <button
            className="back-plain"
            onClick={() => navigate("/")}
            aria-label="Back to home"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="crumb">STUDIO</span>
          <span className="crumb-slash">/</span>
          <strong>{project?.title || "Untitled motion study"}</strong>
        </div>
        <div className="toolbar-actions">
          <span className="save-indicator">
            <span className="live-dot" />{" "}
            {busy ? "SAVING" : "ALL CHANGES SAVED"}
          </span>
          <button
            className="button button-outline button-xs"
            onClick={() => {
              if (!user) onAuth("login");
              else
                void api
                  .portal()
                  .then((r) => window.location.assign(r.url))
                  .catch((e) => setError(e.message));
            }}
          >
            <Settings2 size={14} /> Plan & billing
          </button>
          <button
            className="button button-primary button-xs"
            onClick={() => void exportVideo()}
            disabled={!activeVersion || !previewReady || exporting || busy}
          >
            {exporting ? (
              <>
                <LoaderCircle size={14} className="spin" />{" "}
                {Math.round(exportProgress * 100)}%
              </>
            ) : (
              <>
                <Download size={14} /> Export MP4
              </>
            )}
          </button>
        </div>
      </div>
      <div className="studio-mobile-tabs">
        <button
          className={mobilePanel === "projects" ? "selected" : ""}
          onClick={() => setMobilePanel("projects")}
        >
          <Film size={14} /> Projects
        </button>
        <button
          className={mobilePanel === "chat" ? "selected" : ""}
          onClick={() => setMobilePanel("chat")}
        >
          <MessageSquareText size={14} /> Brief
        </button>
        <button
          className={mobilePanel === "preview" ? "selected" : ""}
          onClick={() => setMobilePanel("preview")}
        >
          <Play size={14} /> Preview
        </button>
      </div>
      <div className="studio-workspace">
        <aside
          className={`project-sidebar ${mobilePanel === "projects" ? "mobile-active" : ""}`}
        >
          <div className="sidebar-title">
            <span>YOUR WORK</span>
            <button
              className="icon-button tiny"
              onClick={newProject}
              title="New project"
              disabled={exporting}
            >
              <Plus size={16} />
            </button>
          </div>
          <button
            className="new-project"
            onClick={newProject}
            disabled={exporting}
          >
            <Plus size={15} /> New video <kbd>⌘ N</kbd>
          </button>
          <div className="project-list">
            {projects.map((p) => (
              <div
                key={p.id}
                className={`project-list-item ${p.id === projectId ? "active" : ""}`}
              >
                <button
                  onClick={() => void openProject(p)}
                  disabled={exporting}
                >
                  <span className="project-thumb">
                    <Film size={14} />
                  </span>
                  <span className="project-list-text">
                    <strong>{p.title || "Untitled motion study"}</strong>
                    <small>
                      {p.aspect} · {p.duration}s
                    </small>
                  </span>
                </button>
                <button
                  className="item-more"
                  onClick={() => void deleteProject(p.id)}
                  title="Delete project"
                  disabled={exporting || busy}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {projects.length === 0 && (
              <p className="empty-list">
                Your motion studies
                <br />
                will show up here.
              </p>
            )}
          </div>
          <div className="sidebar-bottom">
            <button onClick={() => navigate("/pricing")}>
              <Sparkles size={14} /> Get more credits <ArrowUpRight size={13} />
            </button>
            <span>Claude Motion Video · v1.0</span>
          </div>
        </aside>
        <section
          className={`brief-panel ${mobilePanel === "chat" ? "mobile-active" : ""}`}
        >
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">NEW MOTION STUDY</span>
              <h2>What are we making?</h2>
            </div>
            <button
              className="icon-button tiny"
              title="How credits work"
              onClick={() => navigate("/pricing")}
            >
              <CircleHelp size={16} />
            </button>
          </div>
          <p className="panel-intro">
            Describe the moment you want to bring to life. A little detail makes
            a big difference.
          </p>
          <div className="image-upload-block">
            <div className="upload-label">
              <span>
                REFERENCE IMAGES <small>OPTIONAL</small>
              </span>
              <span>{assets.length} / 4</span>
            </div>
            <div
              className="upload-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void uploadFiles(e.dataTransfer.files);
              }}
              onClick={() => {
                if (!assetsLoading && !uploading && assets.length < 4)
                  inputRef.current?.click();
              }}
              role="button"
              tabIndex={0}
              aria-disabled={assetsLoading || uploading || assets.length >= 4}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !assetsLoading &&
                  !uploading &&
                  assets.length < 4
                )
                  inputRef.current?.click();
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(e) => void uploadFiles(e.target.files)}
              />
              <div className="upload-glyph">
                {uploading ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <CloudUpload size={20} />
                )}
              </div>
              <strong>
                {uploading
                  ? "Uploading…"
                  : assetsLoading
                    ? "Loading reference images…"
                    : "Drop screenshots or product images"}
              </strong>
              <small>PNG, JPG, WebP · Up to 4 images</small>
              <span className="upload-extra">
                First image +60 credits · each extra +20
              </span>
            </div>
            {assets.length > 0 && (
              <div className="uploaded-assets">
                {assets.map((a) => (
                  <div className="uploaded-thumb" key={a.id}>
                    <img src={a.preview} alt={a.name} />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAsset(a.id);
                      }}
                      aria-label={`Remove ${a.name}`}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button
                  className="add-image"
                  onClick={() => inputRef.current?.click()}
                  disabled={assets.length >= 4}
                >
                  <Plus size={15} />
                </button>
              </div>
            )}
          </div>
          <label className="prompt-field">
            <span>THE IDEA</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A quiet product reveal. The interface eases into view, one detail at a time…"
              rows={5}
            />
            <small>
              Be specific about what moves, what stays put and how it should
              feel.
            </small>
          </label>
          <div className="studio-options">
            <div>
              <span>FORMAT</span>
              <div className="option-segments">
                {(["16:9", "9:16", "1:1"] as const).map((a) => (
                  <button
                    key={a}
                    className={aspect === a ? "active" : ""}
                    onClick={() => setAspect(a)}
                    disabled={hasProject || busy || uploading || assetsLoading || exporting}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span>RUNTIME</span>
              <div className="option-segments">
                {([10, 15, 30] as const).map((d) => (
                  <button
                    key={d}
                    className={duration === d ? "active" : ""}
                    onClick={() => setDuration(d)}
                    disabled={hasProject || busy || exporting}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          </div>
          {hasProject && (
            <p className="generation-note">
              Format and runtime are fixed for this project. Start a new project to change them.
            </p>
          )}
          {selectedShot && (
            <div className="shot-context">
              <span>EDITING SHOT {selectedShot.toUpperCase()}</span>
              <button onClick={() => setSelectedShot("")}>
                <X size={13} /> Clear
              </button>
            </div>
          )}
          {job && (
            <div className={`job-status status-${job.status}`}>
              <span>
                {job.status === "completed" ? (
                  <Check size={15} />
                ) : job.status === "failed" ? (
                  <X size={15} />
                ) : (
                  <LoaderCircle className="spin" size={15} />
                )}
              </span>
              <div>
                <strong>
                  {job.status === "completed"
                    ? "Your video is ready"
                    : job.status === "failed"
                      ? "Generation failed"
                      : jobProgress || job.progress}
                </strong>
                <small>
                  {job.status === "running"
                    ? "This can take a minute or two. You can keep this tab open."
                    : job.status === "queued"
                      ? "Waiting to begin…"
                      : job.status === "completed"
                        ? "Open the preview and refine any detail."
                        : job.error}
                </small>
              </div>
            </div>
          )}
          {error && (
            <div className="studio-error">
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          )}
          <button
            className="button button-primary generate-button"
            onClick={() => void startGeneration()}
            disabled={busy || uploading || assetsLoading || exporting}
          >
            {busy ? (
              <>
                <LoaderCircle size={16} className="spin" />{" "}
                {jobProgress || "Making your video…"}
              </>
            ) : (
              <>
                <Sparkles size={16} />
                {activeVersion ? "Refine this video" : "Generate video"}
                <span className="button-cost">
                  {assetsLoading ? "Calculating…" : `${estimatedCost} credits`}
                </span>
              </>
            )}
          </button>
          <p className="generation-note">
            {activeVersion
              ? `This edit costs ${estimatedCost} credits · text edits start at 20 · image edits start at 40, plus 20 per new image`
              : "Credits are only used when generation starts."}
          </p>
          {activeVersion && (
            <div className="chat-history">
              <div className="chat-day">
                VERSION HISTORY{" "}
                <span>
                  {versions.length}{" "}
                  {versions.length === 1 ? "VERSION" : "VERSIONS"}
                </span>
              </div>
              {versions.map((v, i) => (
                <button
                  className={`version-row ${activeVersion.id === v.id ? "active" : ""}`}
                  key={v.id}
                  onClick={() => void chooseVersion(v)}
                  disabled={busy || uploading || assetsLoading || exporting}
                >
                  <span className="version-number">V{versions.length - i}</span>
                  <span>
                    <strong>{v.prompt || "Original motion"}</strong>
                    <small>
                      {new Date(v.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </small>
                  </span>
                  {activeVersion.id === v.id && <Check size={14} />}
                </button>
              ))}
            </div>
          )}
        </section>
        <section
          className={`preview-panel ${mobilePanel === "preview" ? "mobile-active" : ""}`}
        >
          <div className="preview-topbar">
            <div>
              <span className="panel-kicker">PREVIEW / {aspect}</span>
              <span className="preview-title">
                {project?.title || "Your motion study"}
              </span>
            </div>
            <div className="preview-tools">
              <button
                className="icon-button tiny"
                onClick={() => seek(0)}
                disabled={!activeVersion || busy || exporting}
                title="Restart"
              >
                <RotateCcw size={15} />
              </button>
              <button
                className="icon-button tiny"
                onClick={() => setPlaying((p) => !p)}
                disabled={!activeVersion || busy || exporting}
                title={playing ? "Pause" : "Play"}
              >
                {playing ? (
                  <span className="pause-mark">Ⅱ</span>
                ) : (
                  <Play size={15} />
                )}
              </button>
            </div>
          </div>
          <div className={`preview-stage aspect-${aspect.replace(":", "-")}`}>
            <div className="stage-status">
              <span className="live-dot" />
              {activeVersion ? "LIVE PREVIEW" : "EMPTY CANVAS"}
            </div>
            {activeVersion ? (
              previewDocument.error ? (
                <div className="studio-error preview-build-error">
                  <span>{previewDocument.error}</span>
                </div>
              ) : (
                <iframe
                  key={`${activeVersion.id}:${previewChannel}`}
                  ref={iframeRef}
                  title="Motion graphics preview"
                  srcDoc={previewDocument.html}
                  sandbox="allow-scripts"
                />
              )
            ) : (
              <div className="empty-preview">
                <div className="empty-frame">
                  <div className="empty-frame-grid" />
                  <span className="empty-cross cross-a" />
                  <span className="empty-cross cross-b" />
                  <span className="empty-center">
                    <Sparkles size={21} />
                  </span>
                  <span className="empty-corner label-a">1920 × 1080</span>
                  <span className="empty-corner label-b">30 FPS</span>
                </div>
                <h3>Your first frame starts here.</h3>
                <p>Describe a motion idea or add an image to begin.</p>
              </div>
            )}
          </div>
          {activeVersion && (
            <div className="timeline-block">
              <div className="timeline-meta">
                <span>
                  <Clock3 size={13} />
                  {duration.toString().padStart(2, "0")}:00 SEC
                </span>
                <span>
                  SHOT{" "}
                  {selectedShot
                    ? selectedShot.replace("shot-", "")
                    : String(
                        Math.min(
                          storyboard.length || 1,
                          Math.floor(
                            (timeline / duration) * (storyboard.length || 1),
                          ) + 1,
                        ),
                      ).padStart(2, "0")}{" "}
                  / {String(storyboard.length || 1).padStart(2, "0")}
                </span>
                <span>
                  V
                  {Math.max(
                    1,
                    versions.length - versions.findIndex((v) => v.id === activeVersion.id),
                  )}
                </span>
              </div>
              <div className="timeline-track-wrap">
                <div
                  className="timeline-track"
                  onClick={(e) => {
                    if (busy || exporting) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    seek(((e.clientX - r.left) / r.width) * duration);
                  }}
                >
                  {storyboard.length ? (
                    storyboard.map((s, i) => (
                      <button
                        key={s.id}
                        className={`timeline-shot ${selectedShot === s.id ? "selected" : ""}`}
                        style={{
                          left: `${(s.start / duration) * 100}%`,
                          width: `${Math.max(7, ((s.end - s.start) / duration) * 100)}%`,
                        }}
                        title={s.title}
                        onClick={(e) => {
                          e.stopPropagation();
                          void editShot(s.id);
                          seek(s.start);
                        }}
                      >
                        <span>{s.title || `Shot ${i + 1}`}</span>
                      </button>
                    ))
                  ) : (
                    <div className="timeline-fallback">
                      <i />
                      <i />
                      <i />
                    </div>
                  )}
                  <div
                    className="playhead"
                    style={{
                      left: `${Math.min(100, (timeline / duration) * 100)}%`,
                    }}
                  />
                </div>
                <input
                  type="range"
                  min="0"
                  max={duration}
                  step=".1"
                  value={Math.min(timeline, duration)}
                  onChange={(e) => seek(Number(e.target.value))}
                  disabled={busy || exporting}
                  aria-label="Preview timeline"
                />
              </div>
              <div className="timeline-clock">
                <span>00:{timeline.toFixed(1).padStart(4, "0")}</span>
                <span>00:{duration}.0</span>
              </div>
            </div>
          )}
          <div className="preview-foot">
            <span>
              {activeVersion
                ? "Drag the playhead to scrub · Select a shot to edit"
                : "1080P · H.264 MP4 · READY TO EXPORT"}
            </span>
            <button onClick={() => navigate("/pricing")}>
              Credit guide <ArrowUpRight size={12} />
            </button>
          </div>
        </section>
      </div>
      {toast && (
        <div className="toast">
          <Check size={15} />
          {toast}
        </div>
      )}
    </main>
  );
}
