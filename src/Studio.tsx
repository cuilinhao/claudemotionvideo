import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Code2, Download, Film, ImagePlus, LoaderCircle, LogOut, Music2, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, Settings2, Sparkles, Trash2, UserRound, X, Zap } from "lucide-react";
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
import { estimateGenerationPayment } from "./lib/generation-cost";
import {
  buildPreviewDocument,
  createAnimationSourceDownload,
  exportMp4,
  isPreviewMessage,
} from "./lib/renderer";
import { buildDemoDocument, demo, loadDemoResources, composeGenerationPrompt, studioEffects, studioPalettes, studioScenarios, type StudioScenario } from "./lib/tellcut-demo";
import "./studio-fidelity.css";
import { AudioPanel, type PreparedAudio } from "./AudioPanel";

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
  const [view, setView] = useState<'example' | 'new' | 'project'>(() => query.has('prompt') || query.has('template') || query.has('scene') || query.get('view') === 'new' ? 'new' : 'example');
  const [rail, setRail] = useState(() => { try { return localStorage.getItem('cmv.studio.rail') === '1'; } catch { return false; } });
  const [accountOpen, setAccountOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [styleId, setStyleId] = useState('auto');
  const [effectIds, setEffectIds] = useState<string[]>([]);
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState('');
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
  const [audioBusy, setAudioBusy] = useState(true);
  const [audioRevision, setAudioRevision] = useState(0);
  const [preparedAudio, setPreparedAudio] = useState<PreparedAudio>({
    buffer: null,
    wav: null,
    musicDuration: null,
    voiceDuration: null,
  });
  const [audioPreviewUrl, setAudioPreviewUrl] = useState("");
  const [readyChannel, setReadyChannel] = useState("");
  const [toast, setToast] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const exportControllerRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioDialogRef = useRef<HTMLDialogElement>(null);
  const audioTriggerRef = useRef<HTMLButtonElement>(null);
  const audioUrlRef = useRef("");
  const playbackStartRef = useRef(0);
  const [previewChannel, setPreviewChannel] = useState(() =>
    crypto.randomUUID(),
  );
  const selectionRef = useRef(0);
  const assetLoadRef = useRef(0);
  const currentUserIdRef = useRef(user?.id ?? null);
  const previousUserIdRef = useRef(user?.id ?? null);
  currentUserIdRef.current = user?.id ?? null;
  const inputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const deepLinkRef = useRef('');
  const entryConsumedRef = useRef(false);
  useEffect(() => {
    if (entryConsumedRef.current) return;
    entryConsumedRef.current = true;
    try {
      const sceneId = sessionStorage.getItem('cmv.scene') || sessionStorage.getItem('tellcut.scene');
      sessionStorage.removeItem('cmv.scene'); sessionStorage.removeItem('tellcut.scene');
      const scene = studioScenarios.find(item => item.id === sceneId);
      if (scene) { pickScene(scene); setView('new'); }
      const raw = sessionStorage.getItem('cmv.prefill') || sessionStorage.getItem('opus6.prefill');
      sessionStorage.removeItem('cmv.prefill'); sessionStorage.removeItem('opus6.prefill');
      if (raw) {
        const entry: unknown = JSON.parse(raw);
        if (entry && typeof entry === 'object') {
          const values = entry as Record<string, unknown>;
          const brief = typeof values.brief === 'string' ? values.brief : typeof values.prompt === 'string' ? values.prompt : '';
          if (brief) { setPrompt(brief.slice(0, 2000)); setView('new'); }
          if (['16:9', '9:16', '1:1'].includes(String(values.aspect))) setAspect(values.aspect as typeof aspect);
          if ([10, 15, 30].includes(Number(values.duration))) setDuration(Number(values.duration) as typeof duration);
          if (typeof values.styleId === 'string' && studioPalettes.some(item => item.id === values.styleId)) setStyleId(values.styleId);
          if (Array.isArray(values.effectIds)) setEffectIds(values.effectIds.filter((id): id is string => typeof id === 'string' && studioEffects.some(item => item.id === id)).slice(0, 1));
        } else if (typeof entry === 'string') { setPrompt(entry.slice(0, 2000)); setView('new'); }
      }
    } catch { /* Invalid or unavailable browser storage is not a project error. */ }
  }, []);
  useEffect(() => {
    document.body.classList.add('shell-body');
    return () => { document.body.classList.remove('shell-body', 'shell-rail'); };
  }, []);
  useEffect(() => {
    document.body.classList.toggle('shell-rail', rail);
    try { localStorage.setItem('cmv.studio.rail', rail ? '1' : '0'); } catch { /* storage may be unavailable */ }
  }, [rail]);
  useEffect(() => {
    const dismiss = (event: MouseEvent) => { if (!(event.target as Element).closest('.acct')) setAccountOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAccountOpen(false); setAudioOpen(false); setImagesOpen(false); } };
    document.addEventListener('click', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('click', dismiss); document.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => {
    const dialog = audioDialogRef.current;
    if (!dialog || !audioOpen) return;
    const trigger = audioTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [audioOpen, projectId, user?.id]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ block: 'nearest' }); }, [versions.length, job?.status, pendingPrompt]);
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
  const handleAudioPrepared = useCallback((audio: PreparedAudio) => {
    setPreparedAudio(audio);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const nextUrl = audio.wav ? URL.createObjectURL(audio.wav) : "";
    audioUrlRef.current = nextUrl;
    setAudioPreviewUrl(nextUrl);
    audioRef.current?.pause();
    setPlaying(false);
    setTimeline(0);
  }, []);
  const handleAudioBusy = useCallback((value: boolean) => {
    if (value) {
      audioRef.current?.pause();
      setPlaying(false);
    }
    setAudioBusy(value);
  }, []);
  const handleAudioRevision = useCallback((revision: number) => setAudioRevision(revision), []);
  useEffect(() => () => {
    exportControllerRef.current?.abort();
    audioRef.current?.pause();
    audioRef.current?.removeAttribute("src");
    audioRef.current?.load();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = "";
  }, []);
  useEffect(() => {
    setPlaying(false);
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setTimeline(0);
    setSelectedShot("");
  }, [activeVersion?.id]);
  useEffect(() => {
    audioRef.current?.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = "";
    setAudioPreviewUrl("");
    setPreparedAudio({ buffer: null, wav: null, musicDuration: null, voiceDuration: null });
    setAudioRevision(0);
    setAudioBusy(true);
    setPlaying(false);
    setTimeline(0);
  }, [projectId, user?.id]);
  const hasProject = Boolean(projectId);
  const generationPayment = estimateGenerationPayment({
    singleVideoGenerations: user?.singleVideoGenerations,
    duration,
    assetIds: assets.map((asset) => asset.id),
    ...(activeVersion ? { previousAssetIds: activeVersion.assetIds } : {}),
  });
  useEffect(() => {
    const requested = query.get('scene');
    const scene = studioScenarios.find(s => s.id === requested);
    if (scene) { pickScene(scene); setView('new'); }
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
    const id = location.pathname.match(/^\/studio\/v\/([^/]+)\/?$/)?.[1] || query.get('project');
    const nextView = query.get('view');
    if (!id && (nextView === 'example' || nextView === 'new') && view !== nextView) newProject(nextView, false);
    if (!id || !user || deepLinkRef.current === `${user.id}:${id}`) return;
    deepLinkRef.current = `${user.id}:${id}`;
    selectionRef.current++; assetLoadRef.current++;
    setProjectId(id); setView('project'); setActiveVersion(null); setVersions([]); setAssets([]); setProject(null);
    setAssetsLoading(true); setPreviewChannel(crypto.randomUUID()); setReadyChannel(''); setJob(null); setBusy(false); setError('');
  }, [location.pathname, location.search, user?.id]);
  useLayoutEffect(() => {
    const nextUserId = user?.id ?? null;
    const previousUserId = previousUserIdRef.current;
    if (previousUserId === nextUserId) return;
    previousUserIdRef.current = nextUserId;
    deepLinkRef.current = '';
    selectionRef.current++;
    assetLoadRef.current++;
    setProjects([]);
    setProjectId("");
    setProject(null);
    setVersions([]);
    setActiveVersion(null);
    setAssets([]);
    setAssetsLoading(false);
    if (previousUserId !== null || nextUserId === null) setPrompt("");
    setSelectedShot("");
    setJob(null);
    setJobProgress("");
    setUploading(false);
    setBusy(false);
    setExporting(false);
    setExportProgress(0);
    audioRef.current?.pause();
    setAudioBusy(true);
    exportControllerRef.current?.abort();
    setAudioRevision(0);
    setPreparedAudio({ buffer: null, wav: null, musicDuration: null, voiceDuration: null });
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = "";
    setAudioPreviewUrl("");
    setError("");
    setPlaying(false);
    setTimeline(0);
    setReadyChannel("");
    setPreviewChannel(crypto.randomUUID());
    if (nextUserId === null) setView('example');
    setAudioOpen(false);
    setPendingPrompt('');
  }, [user?.id]);
  useEffect(() => {
    let alive = true;
    if (!user) return;
    const requestUserId = user.id;
    api
      .projects()
      .then((r) => {
        if (alive && currentUserIdRef.current === requestUserId)
          setProjects(r.projects);
      })
      .catch((e) => {
        if (!alive || currentUserIdRef.current !== requestUserId) return;
        setError(
          e instanceof Error ? e.message : "Could not load this project.",
        );
      });
    return () => {
      alive = false;
    };
  }, [user?.id]);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const requestUserId = currentUserIdRef.current;
    const selection = selectionRef.current;
    api
      .project(projectId)
      .then((r) => {
        if (
          !alive ||
          selection !== selectionRef.current ||
          currentUserIdRef.current !== requestUserId
        )
          return;
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
        if (
          !alive ||
          selection !== selectionRef.current ||
          currentUserIdRef.current !== requestUserId
        )
          return;
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
    const requestUserId = currentUserIdRef.current;
    const selection = selectionRef.current;
    const isCurrent = () =>
      selection === selectionRef.current &&
      currentUserIdRef.current === requestUserId;
    return watchJob(job.id, {
      getJob: api.job,
      loadProject: api.project,
      onJob: (next) => {
        if (!isCurrent()) return;
        setJob(next);
        setJobProgress(next.progress);
      },
      onComplete: (next, r) => {
        if (!isCurrent()) return;
        setProjectId(next.projectId);
        setProject(r.project);
        setProjects((p) => [r.project, ...p.filter((x) => x.id !== r.project.id)]);
        setVersions(r.versions);
        const v = r.versions.find((x) => x.id === next.versionId) ?? r.versions[0];
        setPreviewChannel(crypto.randomUUID());
        setReadyChannel("");
        setActiveVersion(v ?? null);
        setBusy(false);
        setPendingPrompt('');
        onCredits();
        setToast("Your video is ready.");
        setTimeout(() => setToast(""), 3000);
      },
      onFailed: (next) => {
        if (!isCurrent()) return;
        setBusy(false);
        setError(
          next.error ||
            "This generation did not finish. Credits have been returned if the request failed on our side.",
        );
        onCredits();
      },
      onError: (e) => {
        if (!isCurrent()) return;
        setError(
          e instanceof Error ? e.message : "Could not check generation status.",
        );
      },
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
    let frame = 0;
    let lastUiUpdate = 0;
    playbackStartRef.current = performance.now() - timeline * 1000;
    const tick = (now: number) => {
      let time = audioPreviewUrl && audioRef.current
        ? audioRef.current.currentTime
        : (now - playbackStartRef.current) / 1000;
      if (!Number.isFinite(time)) time = 0;
      time = Math.min(duration, time);
      iframeRef.current?.contentWindow?.postMessage(
        { type: "cmv:seek", time, channel: previewChannel },
        "*",
      );
      if (now - lastUiUpdate > 90 || time >= duration) {
        lastUiUpdate = now;
        setTimeline(time);
      }
      if (time >= duration || (audioPreviewUrl && audioRef.current?.ended)) {
        audioRef.current?.pause();
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, exporting, duration, previewChannel, audioPreviewUrl]);
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
      if (selection === selectionRef.current) setUploading(false);
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
    if (busy || exporting || uploading || assetsLoading) return;
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
        prompt: composeGenerationPrompt(prompt, { styleId, effectIds, brandColors, assets: assets.map(a => a.id) }),
        aspect,
        duration,
        assetIds: assets.map((x) => x.id),
        ...(projectId ? { projectId } : {}),
        ...(activeVersion ? { versionId: activeVersion.id } : {}),
        ...(selectedShot ? { selectedShot } : {}),
        paymentType: generationPayment.paymentType,
        idempotencyKey: crypto.randomUUID(),
      });
      if (selection !== selectionRef.current) return;
      setProjectId(result.projectId);
      setView('project');
      setPendingPrompt(prompt.trim());
      setPrompt('');
      deepLinkRef.current = `${user.id}:${result.projectId}`;
      navigate(`/studio/v/${result.projectId}`, { replace: Boolean(projectId) });
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
    if (audioBusy) {
      setError("Wait for the audio mix to finish saving and preparing before export.");
      return;
    }
    if (!previewReady) {
      setError("Wait for the preview to finish loading before exporting.");
      return;
    }
    if (!iframeRef.current) {
      setError("The preview is still loading. Try again in a moment.");
      return;
    }
    const revision = audioRevision;
    const exportAudio = preparedAudio.buffer ?? undefined;
    const controller = new AbortController();
    exportControllerRef.current = controller;
    setExporting(true);
    audioRef.current?.pause();
    setPlaying(false);
    setError("");
    setExportProgress(0);
    const selection = selectionRef.current;
    try {
      let blob = await exportMp4(iframeRef.current, {
        channel: previewChannel,
        duration,
        aspect,
        audio: exportAudio,
        signal: controller.signal,
        onProgress: (progress) => {
          if (selection === selectionRef.current) setExportProgress(progress);
        },
      });
      if (selection !== selectionRef.current) return;
      if (controller.signal.aborted) throw new DOMException('Video export stopped.', 'AbortError');
      const saved = await api.saveMp4(projectId, activeVersion.id, blob, revision);
      if (selection !== selectionRef.current) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(project?.title || "motion-study").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setToast("MP4 downloaded and saved to this project.");
      setTimeout(() => setToast(""), 3000);
      void saved;
    } catch (e) {
      if (selection === selectionRef.current && e instanceof Error && e.name === 'AbortError') {
        setToast('Export stopped.'); setTimeout(() => setToast(''), 3000);
      } else if (selection === selectionRef.current)
        setError(e instanceof Error ? e.message : "Could not export this video.");
    } finally {
      if (exportControllerRef.current === controller) exportControllerRef.current = null;
      if (selection === selectionRef.current) {
        setExporting(false);
        setExportProgress(0);
      }
    }
  }
  async function openProject(p: Project) {
    if (exporting) return;
    if (view === 'project' && projectId === p.id) return;
    selectionRef.current++;
    assetLoadRef.current++;
    setPreviewChannel(crypto.randomUUID());
    setReadyChannel("");
    setAssetsLoading(true);
    setProjectId(p.id);
    setView('project');
    setPendingPrompt('');
    setPrompt('');
    setAudioOpen(false);
    deepLinkRef.current = `${user?.id}:${p.id}`;
    navigate(`/studio/v/${p.id}`);
    setProject(p);
    setActiveVersion(null);
    setVersions([]);
    setJob(null);
    setBusy(false);
    setAssets([]);
    setError("");
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
        setView('new');
        navigate('/studio?view=new');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete project.");
    }
  }
  function newProject(nextView: 'new' | 'example' = 'new', navigateToView = true) {
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
    setView(nextView);
    setAudioOpen(false);
    setPendingPrompt('');
    setSceneId(null); setStyleId('auto'); setEffectIds([]); setBrandColors([]);
    setAspect('16:9'); setDuration(15);
    deepLinkRef.current = '';
    if (navigateToView) navigate(`/studio?view=${nextView}`);
  }
  async function editShot(id: string) {
    if (busy || exporting) return;
    const next = selectedShot === id ? '' : id;
    setSelectedShot(next);
    if (next) { const shot = storyboard.find(s => s.id === next); if (shot) { setPlaying(false); audioRef.current?.pause(); seek(shot.start + .01); } }
    promptRef.current?.focus();
  }
  function seek(t: number) {
    const next = Math.min(duration, Math.max(0, t));
    setTimeline(next);
    playbackStartRef.current = performance.now() - next * 1000;
    if (audioRef.current && audioPreviewUrl) audioRef.current.currentTime = next;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "cmv:seek", time: next, channel: previewChannel },
      "*",
    );
  }
  function togglePlayback() {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    const next = timeline >= duration - .01 ? 0 : timeline;
    if (next !== timeline) seek(next);
    if (audioPreviewUrl && audioRef.current) {
      audioRef.current.currentTime = next;
      void audioRef.current.play().then(() => setPlaying(true)).catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not play audio preview.");
      });
    } else {
      playbackStartRef.current = performance.now() - next * 1000;
      setPlaying(true);
    }
  }
  function pickScene(scene: StudioScenario) {
    setSceneId(scene.id); setPrompt(scene.starter); setAspect(scene.aspect as typeof aspect);
    setDuration(scene.duration as typeof duration); setStyleId(scene.look); setEffectIds([]);
    requestAnimationFrame(() => promptRef.current?.focus());
  }
  function downloadSource() {
    if (!activeVersion) return;
    try {
      const download = createAnimationSourceDownload(activeVersion.html);
      const url = URL.createObjectURL(download.blob);
      const link = document.createElement('a'); link.href = url; link.download = download.filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not download the animation source.'); }
  }
  const orderedVersions = [...versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const hasPaidPlan = ['starter', 'pro', 'max'].includes(user?.plan ?? '');
  const currentShot = storyboard.find(s => s.id === selectedShot);
  const currentScene = studioScenarios.find(s => s.id === sceneId);
  const controlsDisabled = busy || exporting || uploading || assetsLoading;
  const composer = <div className="ed-ask"><div className="composer">
    {!hasProject && <p className="muted small cmv-generation-balance">{user ? `${user.singleVideoGenerations ?? 0} purchased video generation${user.singleVideoGenerations === 1 ? '' : 's'} remaining · ${generationPayment.label} for this video` : 'Registration includes 0 free videos. Buy one video for $5 or choose a subscription.'} <a href="/pricing#single-video">Buy one video · $5</a></p>}
    {hasProject && <p className="muted small cmv-generation-balance">Extra edits and AI voiceover use subscription credits.</p>}
    {brandColors.length > 0 && <div className="cmp-added"><span className="pchip">{brandColors.map(color => <i key={color} className="dot" style={{ background: color }} />)}Brand colours<button aria-label="Remove brand colours" onClick={() => setBrandColors([])}>×</button></span></div>}
    {(error || previewDocument.error) && <p className="error" role="alert">{error || previewDocument.error}</p>}
    <div className="ed-ask-box" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (!controlsDisabled) void uploadFiles(event.dataTransfer.files); }}>
      {currentShot && <div className="ed-scope"><button className="ed-scope-what" onClick={() => { setPrompt(currentShot.description); setSelectedShot(''); }}>Only change {currentShot.start.toFixed(1)}–{currentShot.end.toFixed(1)}s · {currentShot.description}</button><button aria-label="Change the whole video instead" onClick={() => setSelectedShot('')}>×</button></div>}
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => void uploadFiles(event.target.files)} />
      <div className="ask-top">
        {assets.length > 0 && <button className={`img-stack${assets.length === 1 ? ' one' : ''}`} aria-label={`${assets.length} images added. Show them`} onClick={() => setImagesOpen(true)}>{assets.slice(0, 2).map((asset, index) => <img key={asset.id} src={asset.preview} alt="" style={{ zIndex: 2 - index }} />)}{assets.length > 2 && <span className="img-stack-more">+{assets.length - 2}</span>}</button>}
        <label className="sr-only" htmlFor="brief">Prompt</label>
        <textarea id="brief" ref={promptRef} rows={hasProject ? 2 : 3} maxLength={2000} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void startGeneration(); } }} onPaste={event => { if (event.clipboardData.files.length && !controlsDisabled) { event.preventDefault(); void uploadFiles(event.clipboardData.files); } }} placeholder={hasProject ? currentShot ? 'What should change in this part?' : 'What would you like to change?' : assets.length ? 'Say what should move in your images… type @ to name one' : 'Describe your video, or add an image…'} disabled={busy || exporting} />
      </div>
      <div className="ws-tools">
        <button className="tool-round" aria-label="Add an image" title="Add an image" disabled={controlsDisabled || assets.length >= 4} onClick={() => inputRef.current?.click()}>{uploading ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}</button>
        <EffectPicker value={effectIds} onChange={setEffectIds} disabled={controlsDisabled} suggested={currentScene?.effects} />
        {!hasProject && <VideoSettings aspect={aspect} duration={duration} styleId={styleId} brandColors={brandColors} cost={generationPayment.label} onAspect={setAspect} onDuration={setDuration} onStyle={setStyleId} onColors={setBrandColors} disabled={controlsDisabled} />}
        {hasProject && <span className="mono muted cmv-edit-cost">{generationPayment.label}</span>}
        <button className="ed-send" aria-label="Send" disabled={controlsDisabled || prompt.trim().length < 2} onClick={() => void startGeneration()}>{busy ? <span className="pulse" /> : <ArrowUp size={16} />}</button>
      </div>
    </div>
  </div></div>;
  const chat = <section className="ed-chat ws-chat" aria-label="Chat"><div className="ed-msgs">
    {orderedVersions.map((version, index) => <div className="ws-turn" key={version.id}>
      <div className="ed-user"><p>{version.prompt.split(/\n\n(?:Visual style:|Motion effect:|Brand colours:|@Image1 is image asset )/)[0]}</p><span className="ed-chips mono">{aspect} · {duration}s{version.assetIds.length ? ` · ${version.assetIds.length} image${version.assetIds.length > 1 ? 's' : ''}` : ''}</span></div>
      <div className="ed-opus"><div className="ed-done"><Check size={15} /><b>{index ? 'Done. Your change is ready.' : 'Done. Your video is ready.'}</b></div><div className="ed-ver-row"><span className="mono">v{index + 1}</span><button disabled={controlsDisabled} aria-pressed={activeVersion?.id === version.id} onClick={() => void chooseVersion(version)}>{activeVersion?.id === version.id ? 'Showing' : 'Show'}</button>{index > 0 && <button disabled={controlsDisabled} onClick={() => void chooseVersion(orderedVersions[index - 1])}>Undo</button>}</div></div>
    </div>)}
    {pendingPrompt && <div className="ed-user"><p>{pendingPrompt}</p><span className="ed-chips mono">{aspect} · {duration}s</span></div>}
    {busy && <div className="ed-opus"><div className="ed-run"><div className="ed-run-head"><span className="pulse" /><b>{activeVersion ? 'Working on your change' : 'Making your video'}</b></div><p className="muted">{jobProgress}</p><ol className="run-steps"><li className={job?.status === 'running' ? 'done' : 'now'}>Read your brief</li><li className={job?.status === 'running' ? 'now' : ''}>Plan the storyboard</li><li>Write the animation code</li></ol><span className="muted small">You can leave and return to this video. Failed generation payments are returned automatically.</span></div></div>}
    <div ref={messagesEndRef} />
  </div>{composer}</section>;
  return <section className="studio-shell">
    <link rel="stylesheet" href="/reference-assets/_astro/Base.CXy0q1tT.css" />
    <audio ref={audioRef} src={audioPreviewUrl || undefined} preload="auto" hidden />
    <div className="home">
      <aside className="shell-side" aria-label="Your videos and site menu">
        <div className="shell-head"><a className="logo shell-logo" href="/" aria-label="Claude Motion Video home"><img className="logo-mark" src="/favicon.svg" alt="" aria-hidden="true" /><span className="logo-word">Claude Motion Video</span></a><button className="shell-fold" aria-label={rail ? 'Open the sidebar' : 'Close the sidebar'} title={rail ? 'Open the sidebar' : 'Close the sidebar'} aria-expanded={!rail} onClick={() => setRail(value => !value)}>{rail ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button></div>
        <button className="ws-new" aria-pressed={view === 'new'} aria-label="New video" title={rail ? 'New video' : undefined} disabled={exporting} onClick={() => newProject()}><Plus size={16} /><span className="ws-new-label">New video</span></button>
        <button className="ws-item" aria-pressed={view === 'example'} title={rail ? demo.title : undefined} disabled={exporting} onClick={() => newProject('example')}><span>{demo.title}</span><small className="ws-item-tag">Example</small></button>
        {projects.length > 0 && <span className="ws-list-head">Your videos</span>}
        <div className="ws-items">{projects.map(item => <button key={item.id} className="ws-item" aria-pressed={view === 'project' && projectId === item.id} title={item.title} disabled={exporting} onClick={() => void openProject(item)}><span>{item.title || 'Untitled video'}</span><small>{busy && projectId === item.id ? <><span className="pulse" />Making it…</> : relativeTime(item.updatedAt)}</small></button>)}{!projects.length && <p className="ws-list-empty">Videos you make show up here, and every version is kept.</p>}</div>
        <div className="shell-acct"><div className="acct acct-side">
          {user ? <><button className="acct-me" aria-haspopup="menu" aria-expanded={accountOpen} onClick={() => setAccountOpen(value => !value)}><span className="avatar">{user.email.charAt(0).toUpperCase()}</span><span className="acct-me-text"><b>{user.email.split('@')[0]}</b><small>{hasPaidPlan && user.plan ? `${user.plan[0].toUpperCase()}${user.plan.slice(1)} plan` : 'No plan yet'}</small></span><ChevronDown size={14} /></button><a className="credits-pill" href="/account" title={`${user.credits.toLocaleString()} credits`} aria-label={`${user.credits.toLocaleString()} credits`}><Zap size={15} />{user.credits.toLocaleString()}</a>
            {accountOpen && <div className="acct-menu acct-menu-up" role="menu"><span className="acct-email muted">{user.email}</span><a role="menuitem" href="/my-videos"><Film size={17} />My videos</a><a role="menuitem" href="/account"><UserRound size={17} />Account and credits</a><a role="menuitem" className="acct-upgrade" href="/pricing"><Zap size={17} />{hasPaidPlan ? 'Change plan' : 'Upgrade plan'}</a><hr /><a role="menuitem" href="/examples"><Play size={17} />Examples</a><a role="menuitem" href="/effects"><Sparkles size={17} />Effects</a><a role="menuitem" href="/blogs"><Code2 size={17} />Blogs</a><hr /><button role="menuitem" onClick={onLogout}><LogOut size={17} />Sign out</button></div>}
          </> : <button className="btn small acct-signin" onClick={() => onAuth('login')}>Sign in</button>}
        </div></div>
      </aside>
      <div className="ws">{view === 'example' ? <LuckySpinExample onOwn={() => newProject()} /> : view === 'new' && !hasProject ? <div className="ws-main">{chat}<section className="ws-stage" aria-label="Your video"><div className="ws-stage-head">{currentScene ? <button className="ws-back" onClick={() => setSceneId(null)}><ArrowLeft size={14} />All kinds of video</button> : <span className="ws-tag ws-tag-plain">Start from</span>}</div>{currentScene ? <div className="scn-preview"><video key={currentScene.id} src={`/reference-assets/scenarios/${currentScene.id}.mp4`} poster={`/reference-assets/scenarios/${currentScene.id}.jpg`} autoPlay muted loop playsInline style={{ aspectRatio: currentScene.aspect.replace(':', ' / ') }} /><p><b>{currentScene.name}</b><span>{currentScene.blurb}</span></p></div> : <div className="scn-grid">{studioScenarios.map(scene => <ScenarioCard key={scene.id} scene={scene} onPick={() => pickScene(scene)} />)}</div>}</section></div> : <div className="ed embedded"><div className="ed-main">{chat}<section className="ed-stage" aria-label="Video preview">
        <div className="ed-vbar"><span className="ed-title" title={project?.title}>{project?.title || 'Your video'}</span><div className="ed-vtabs" role="group" aria-label="Versions">{orderedVersions.map((version, index) => <button key={version.id} aria-pressed={activeVersion?.id === version.id} disabled={controlsDisabled} onClick={() => void chooseVersion(version)}>v{index + 1}</button>)}</div><span className="ed-spacer" />{!busy && activeVersion && <span className="mono muted cmv-save-state">Saved</span>}</div>
        <div className="ed-frame">{activeVersion && !assetsLoading && previewDocument.html ? <div className={`ed-screen screen aspect-${aspect.replace(':', 'x')}`} style={{ '--ar': aspect.split(':').map(Number).reduce((a, b) => a / b), aspectRatio: aspect.replace(':', '/') } as CSSProperties}><iframe key={previewChannel} ref={iframeRef} srcDoc={previewDocument.html} title="Animation preview" sandbox="allow-scripts" referrerPolicy="no-referrer" />{!previewReady && <div className="demo-wait">Loading preview…</div>}{busy && <div className="cmv-preview-busy"><span className="pulse" />Applying your change…</div>}</div> : <div className="ed-making">{busy ? <><span className="pulse" /><h2>Making your video</h2><p className="muted">{jobProgress || 'Planning the shots'}</p></> : error || previewDocument.error ? <p className="error">{error || previewDocument.error}</p> : <p className="muted">Opening your video…</p>}</div>}</div>
        {activeVersion && <div className="ed-tools" aria-label="Video tools"><button className="btn small primary" disabled={controlsDisabled || audioBusy || !previewReady} onClick={() => void exportVideo()}>{exporting ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}{exporting ? `Exporting ${Math.round(exportProgress * 100)}%` : 'Export MP4'}</button>{exporting && <button className="btn small" onClick={() => exportControllerRef.current?.abort()}>Stop</button>}<button ref={audioTriggerRef} className="ed-tool" aria-label="Audio" title="Audio" aria-expanded={audioOpen} onClick={() => setAudioOpen(value => !value)}><Music2 size={15} />{audioBusy && <span className="pulse" />}</button><button className="ed-tool" aria-label="Your images" title="Your images" onClick={() => setImagesOpen(true)}><ImagePlus size={15} /></button><button className="ed-tool" aria-label="Download HTML source as text" title="Download HTML source (.txt)" onClick={downloadSource}><Code2 size={15} /></button><button className="ed-tool" aria-label="Delete video" title="Delete video" disabled={controlsDisabled} onClick={() => void deleteProject(projectId)}><Trash2 size={15} /></button></div>}
      </section></div><div className="ed-track"><Timeline duration={duration} time={timeline} playing={playing} disabled={!previewReady || busy || exporting || audioBusy} beats={storyboard.map(s => ({ ...s, text: s.description || s.title }))} selected={currentShot?.start ?? null} onToggle={togglePlayback} onSeek={seek} onPick={beat => void editShot(beat.id ?? '')} /></div></div>}</div>
    </div>
    {user && projectId && <dialog ref={audioDialogRef} className="cmv-audio-dialog" aria-label="Audio" onCancel={() => setAudioOpen(false)} onClose={() => setAudioOpen(false)} onClick={event => { if (event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setAudioOpen(false); }}><button className="cmv-dialog-close" aria-label="Close audio" onClick={() => setAudioOpen(false)}><X size={18} /></button><AudioPanel key={`${user.id}:${projectId}`} projectId={projectId} userId={user.id} duration={duration} disabled={exporting || busy} onAudioPrepared={handleAudioPrepared} onPreparing={handleAudioBusy} onRevision={handleAudioRevision} onCredits={onCredits} /></dialog>}
    {imagesOpen && <div className="cmv-audio-overlay" role="dialog" aria-modal="true" aria-label="Your images" onClick={event => { if (event.target === event.currentTarget) setImagesOpen(false); }}><div className="cmv-images-dialog"><div className="refs-head"><div><b>References</b><span className="muted small">{assets.length} of 4 added · use @ in your prompt</span></div><button className="btn small" disabled={controlsDisabled || assets.length >= 4} onClick={() => inputRef.current?.click()}>+ Add</button><button className="tool-round" aria-label="Close images" onClick={() => setImagesOpen(false)}><X size={16} /></button></div><div className="refs-grid">{assets.map((asset, index) => <div className="ref-card" key={asset.id}><img src={asset.preview} alt={asset.name} /><button className="ref-x" disabled={controlsDisabled} aria-label={`Remove Image${index + 1}`} onClick={() => removeAsset(asset.id)}>×</button><span className="ref-name mono">@Image{index + 1}</span></div>)}</div>{!assets.length && <p className="muted small">Add a screenshot, product image or poster to animate.</p>}</div></div>}
    {toast && <div className="cmv-toast" role="status"><Check size={15} />{toast}</div>}
  </section>;
}

function relativeTime(value: string) {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  if (!Number.isFinite(elapsed)) return '';
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

type Beat = { id?: string; start: number; end: number; text: string };
function Timeline({ duration, time, playing, beats, selected, disabled, onToggle, onSeek, onPick }: {
  duration: number; time: number; playing: boolean; beats: Beat[]; selected: number | null; disabled: boolean;
  onToggle: () => void; onSeek: (time: number) => void; onPick: (beat: Beat) => void;
}) {
  const marks = Array.from({ length: Math.floor(duration) + 1 }, (_, index) => index).filter(index => index % (duration > 20 ? 5 : duration > 10 ? 2 : 1) === 0);
  return <div className="tl"><div className="tl-top"><button className="tl-play" disabled={disabled} aria-label={playing ? 'Pause' : 'Play'} onClick={onToggle}>{playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</button><span className="tl-time mono">{time.toFixed(1)}s / {duration}s</span></div><div className="tl-lane"><div className="tl-ruler" onClick={event => { if (!disabled) { const bounds = event.currentTarget.getBoundingClientRect(); onSeek(Math.max(0, Math.min(duration - .01, (event.clientX - bounds.left) / bounds.width * duration))); } }} aria-hidden="true">{marks.map(mark => <span key={mark} style={{ left: `${mark / duration * 100}%` }}>{mark}s</span>)}</div>{beats.length ? <div className="tl-shots">{beats.map((beat, index) => <button key={beat.id || index} className={`tl-shot${time >= beat.start && time < beat.end ? ' now' : ''}`} disabled={disabled} aria-pressed={selected === beat.start} style={{ flexGrow: Math.max(.25, beat.end - beat.start) }} title={`${beat.start.toFixed(1)}–${beat.end.toFixed(1)}s · ${beat.text}`} onClick={() => onPick(beat)}><span className="tl-shot-text">{beat.text}</span></button>)}</div> : <div className="tl-bar" />}<span className="tl-head" style={{ left: `${Math.min(100, time / duration * 100)}%` }} aria-hidden="true" /></div></div>;
}

function LuckySpinExample({ onOwn }: { onOwn: () => void }) {
  const [resources, setResources] = useState<Awaited<ReturnType<typeof loadDemoResources>> | null>(null);
  const [failure, setFailure] = useState('');
  const [retry, setRetry] = useState(0);
  const [versions, setVersions] = useState<string[][]>([[]]);
  const [shown, setShown] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [selected, setSelected] = useState<Beat | null>(null);
  const [otherMessages, setOtherMessages] = useState<{ text: string; after: number; note?: string }[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const start = useRef(0);
  const pendingStart = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const channel = useMemo(() => crypto.randomUUID(), [shown, retry]);
  const latest = versions.at(-1)!;
  const remaining = demo.presets.filter(preset => !latest.includes(preset.id));
  const doc = useMemo(() => {
    if (!resources) return '';
    return buildDemoDocument(versions[shown], resources.assets, resources.fontCss, channel);
  }, [resources, versions, shown, channel]);
  useEffect(() => {
    let alive = true;
    setFailure('');
    loadDemoResources().then(result => { if (alive) setResources(result); }).catch(cause => { if (alive) setFailure(cause instanceof Error ? cause.message : 'The example could not load.'); });
    return () => { alive = false; };
  }, [retry]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [versions.length, otherMessages.length]);
  useEffect(() => {
    setReady(false); setPlaying(false);
    const receive = (event: MessageEvent) => {
      if (!isPreviewMessage(event, iframe.current?.contentWindow ?? null, channel)) return;
      if (event.data.type === 'cmv:error') { setFailure('The example could not render. Please retry.'); setPlaying(false); }
      if (event.data.type === 'cmv:ready') { setFailure(''); setReady(true); seek(pendingStart.current); setPlaying(true); pendingStart.current = 0; }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [channel, doc]);
  useEffect(() => {
    if (!playing || !ready) return;
    start.current = performance.now() - time * 1000;
    let frame = 0, timer: ReturnType<typeof setTimeout> | undefined, updated = 0;
    const tick = (now: number) => {
      const next = Math.min(10, (now - start.current) / 1000);
      iframe.current?.contentWindow?.postMessage({ type: 'cmv:seek', time: next, channel }, '*');
      if (now - updated > 70 || next === 10) { setTime(next); updated = now; }
      if (next >= 10) {
        timer = setTimeout(() => { start.current = performance.now(); frame = requestAnimationFrame(tick); }, 1200);
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); if (timer) clearTimeout(timer); };
  }, [playing, ready, channel]);
  function seek(next: number) { setTime(next); start.current = performance.now() - next * 1000; iframe.current?.contentWindow?.postMessage({ type: 'cmv:seek', time: next, channel }, '*'); }
  function showVersion(index: number) { if (shown === index) return; pendingStart.current = 0; setShown(index); setSelected(null); }
  function send() {
    const value = prompt.trim(); if (value.length < 2) return;
    const preset = remaining.find(item => item.label === value);
    const note = selected ? `Only change ${selected.start.toFixed(1)}–${selected.end.toFixed(1)}s · ${selected.text}` : undefined;
    if (!preset) setOtherMessages(messages => [...messages, { text: value, after: latest.length, note }]);
    else { if (note) setNotes(values => ({ ...values, [preset.id]: note })); pendingStart.current = Math.max(0, preset.at - .6); setVersions(previous => [...previous, [...latest, preset.id]]); setShown(versions.length); }
    setPrompt(''); setSelected(null);
  }
  const versionRow = (index: number) => <div className="ed-ver-row"><span className="mono">v{index + 1}</span>{shown === index ? <span className="muted">Showing</span> : <button onClick={() => showVersion(index)}>Show</button>}</div>;
  const additionalMessages = (after: number) => otherMessages.filter(message => message.after === after).map((message, index) => <div className="ws-turn" key={`ask-${after}-${index}`}><div className="ed-user"><p>{message.text}</p>{message.note && <span className="ed-chips mono">{message.note}</span>}</div><div className="ed-opus"><p>In the example, only the ready-made changes run. Your own words work on a video of your own, and change just what you ask.</p><p><button className="link-btn" onClick={onOwn}>Make my own video →</button></p></div></div>);
  return <div className="ws-main"><section className="ws-chat ed-chat" aria-label="Chat"><div className="ed-msgs">
    <div className="ed-user ws-user"><img className="ws-user-img" src={`/reference-assets${demo.source}`} alt="Game screenshot" width={1206} height={1945} /><p>{demo.prompt}</p></div>
    <div className="ed-opus"><p>Done. I animated your screenshot: the button press, the spin, the landing and the coins.</p>{versionRow(0)}</div>
    {additionalMessages(0)}
    {latest.map((id, index) => { const preset = demo.presets.find(item => item.id === id)!; return <div className="ws-turn" key={id}><div className="ed-user"><p>{preset.label}</p>{notes[id] && <span className="ed-chips mono">{notes[id]}</span>}</div><div className="ed-opus"><p>{preset.summary}</p>{versionRow(index + 1)}</div>{additionalMessages(index + 1)}</div>; })}<div ref={end} />
  </div><div className="ed-ask">{remaining.length > 0 && <div className="ws-try"><span>Try a change:</span>{remaining.map(preset => <button key={preset.id} aria-pressed={prompt === preset.label} onClick={() => { setPrompt(preset.label); input.current?.focus(); }}>{preset.label}</button>)}</div>}<div className="ed-ask-box ws-demo-ask">{selected && <div className="ed-scope"><button className="ed-scope-what" title="Put it in the box to edit" onClick={() => { setPrompt(selected.text); setSelected(null); input.current?.focus(); }}>Only change {selected.start.toFixed(1)}–{selected.end.toFixed(1)}s · {selected.text}</button><button aria-label="Change the whole video instead" onClick={() => setSelected(null)}>×</button></div>}<label className="sr-only" htmlFor="demo-ask">Example change</label><textarea id="demo-ask" ref={input} rows={2} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={selected ? 'What should change in this part?' : remaining.length ? 'Pick a change above, or say your own' : "That's every example change. Say your own"} /><div className="ed-ask-foot"><span className="mono muted">Example · free</span><button className="ed-send" aria-label="Send" disabled={prompt.trim().length < 2} onClick={send}><ArrowUp size={16} /></button></div></div><p className="ws-own">This is an example. <button onClick={onOwn}>Make your own video →</button></p></div></section>
    <section className="ws-stage" aria-label="Example"><div className="ws-stage-head"><span className="ws-tag">Example</span><div className="ed-vtabs" role="group" aria-label="Versions">{versions.map((_, index) => <button key={index} aria-pressed={shown === index} onClick={() => showVersion(index)}>v{index + 1}</button>)}</div></div><div className="ws-flow"><div className="ws-card ws-in"><span className="ws-label">Image + prompt</span><img className="ws-in-img" src={`/reference-assets${demo.source}`} alt="The game screenshot the example was made from" width={1206} height={1945} /><p className="ws-in-prompt">“{demo.prompt}”</p></div><div className="ws-arrow" aria-hidden="true"><span>Opus 5.5</span><ArrowRight size={28} strokeWidth={1.8} /></div><div className="ws-out"><div className="demo-video">{doc && <iframe key={channel} ref={iframe} srcDoc={doc} sandbox="allow-scripts" title="Lucky spin ad example" referrerPolicy="no-referrer" />}{(!ready || failure) && <div className="demo-wait">{failure ? <div><p>{failure}</p><button className="btn small" onClick={() => setRetry(value => value + 1)}>Retry</button></div> : 'Loading example…'}</div>}</div></div></div><div className="ws-track"><Timeline duration={10} time={time} playing={playing} beats={demo.beats} selected={selected?.start ?? null} disabled={!ready || !!failure} onToggle={() => { if (time >= 10) seek(0); setPlaying(value => !value); }} onSeek={seek} onPick={beat => { const isSame = selected?.start === beat.start; setSelected(isSame ? null : beat); if (!isSame) { setPlaying(false); seek(beat.start + .01); } }} /></div></section>
  </div>;
}

function ScenarioCard({ scene, onPick }: { scene: StudioScenario; onPick: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const play = () => { if (video.current) { video.current.currentTime = 0; void video.current.play().catch(() => {}); } };
  const pause = () => video.current?.pause();
  return <button className="scn-card" title={scene.blurb} onClick={onPick} onMouseEnter={play} onMouseLeave={pause} onFocus={play} onBlur={pause}><span className="scn-shot" style={{ '--poster': `url(/reference-assets/scenarios/${scene.id}.jpg)` } as CSSProperties}><video ref={video} src={`/reference-assets/scenarios/${scene.id}.mp4`} poster={`/reference-assets/scenarios/${scene.id}.jpg`} muted loop playsInline preload="none" aria-hidden="true" /></span><span className="scn-meta"><b>{scene.name}</b><span className="scn-sub">{scene.aspect} · {scene.duration}s{scene.image ? ` · ${scene.image}` : ''}</span></span></button>;
}

function FloatingPanel({ anchor, label, width, onClose, children }: { anchor: RefObject<HTMLElement | null>; label: string; width: number; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect(); if (!rect) return;
      const panelHeight = Math.min(540, ref.current?.scrollHeight || 540, window.innerHeight - 24);
      const panelWidth = Math.min(width, window.innerWidth - 24);
      setPosition({ position: 'fixed', width: panelWidth, maxHeight: Math.min(540, window.innerHeight - 24), left: Math.max(12, Math.min(rect.left, window.innerWidth - panelWidth - 12)), top: Math.max(12, Math.min(rect.top - panelHeight - 10, window.innerHeight - panelHeight - 12)) });
    };
    update(); window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [anchor, width]);
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [anchor, onClose]);
  return createPortal(<div ref={ref} className="floating-pop cmv-floating" role="dialog" aria-label={label} style={position}>{children}</div>, document.body);
}

const effectGroups = [{ name: 'Suggested', categories: null }, { name: 'Text', categories: ['Text'] }, { name: 'Graphics & transitions', categories: ['Shapes', 'Background', 'Transition'] }, { name: 'Product & data', categories: ['UI', 'Data'] }, { name: '3D & game', categories: ['3D', 'Game', 'Cinematic'] }, { name: 'All', categories: null }];
let effectModule: Promise<{ t: (canvas: HTMLCanvasElement, id: string) => () => void }> | undefined;
function EffectCanvas({ id }: { id: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true, detach: (() => void) | undefined;
    const url = '/reference-assets/_astro/effect-ticker.CCyLZTl6.js';
    effectModule ??= import(/* @vite-ignore */ url);
    effectModule.then(module => { if (alive && canvas.current) detach = module.t(canvas.current, id); }).catch(() => { effectModule = undefined; });
    return () => { alive = false; detach?.(); };
  }, [id]);
  return <canvas ref={canvas} className="fx-thumb" width={480} height={270} aria-hidden="true" />;
}
function EffectPicker({ value, onChange, disabled, suggested }: { value: string[]; onChange: (ids: string[]) => void; disabled: boolean; suggested?: string[] }) {
  const [open, setOpen] = useState(false), [group, setGroup] = useState('Suggested');
  const button = useRef<HTMLButtonElement>(null);
  const categories = effectGroups.find(item => item.name === group)?.categories;
  const effects = group === 'Suggested' && suggested?.length ? studioEffects.filter(effect => suggested.includes(effect.id)) : categories ? studioEffects.filter(effect => categories.includes(effect.category)) : studioEffects;
  return <div className="picker-wrap fx-picker"><span className={`tool-pill fx-pill${value.length ? ' on' : ''}`}><button ref={button} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(current => !current)}><Sparkles size={14} /><span>{value.length ? studioEffects.find(effect => effect.id === value[0])?.name : 'Effect'}</span></button>{value.length > 0 && <button className="fx-pill-x" aria-label="Remove the effect" disabled={disabled} onClick={() => onChange([])}><X size={12} /></button>}</span>{open && <FloatingPanel anchor={button} label="Effects" width={540} onClose={() => setOpen(false)}><div className="pop-head"><b>Add an effect <span className="muted" style={{ fontWeight: 400 }}>· optional</span></b><span className="muted small">Pick one to add on top of what you ask for, or none.</span></div><button className="pick-row pick-none" aria-pressed={!value.length} onClick={() => onChange([])}><Sparkles size={25} /><span className="pick-text"><b>From my words</b><span>No extra effect. Claude Motion Video uses whatever you describe.</span></span>{!value.length && <span className="pick-check" aria-hidden="true">✓</span>}</button><div className="chips tabs">{effectGroups.map(item => <button key={item.name} className="chip small" aria-pressed={group === item.name} onClick={() => setGroup(item.name)}>{item.name}</button>)}</div><div className="fx-pick">{effects.map(effect => <button key={effect.id} className="fx-option" aria-pressed={value.includes(effect.id)} title={effect.desc} onClick={() => { onChange(value.includes(effect.id) ? [] : [effect.id]); setOpen(false); }}><EffectCanvas id={effect.id} /><span>{effect.name}</span></button>)}</div><div className="pop-foot"><span className="muted small">{value.length ? `${studioEffects.find(effect => effect.id === value[0])?.name} added` : 'Following your words'}</span><button className="btn small primary" onClick={() => setOpen(false)}>Done</button></div></FloatingPanel>}</div>;
}

function VideoSettings({ aspect, duration, styleId, brandColors, cost, disabled, onAspect, onDuration, onStyle, onColors }: {
  aspect: '16:9' | '9:16' | '1:1'; duration: 10 | 15 | 30; styleId: string; brandColors: string[]; cost: string; disabled: boolean;
  onAspect: (aspect: '16:9' | '9:16' | '1:1') => void; onDuration: (duration: 10 | 15 | 30) => void; onStyle: (style: string) => void; onColors: (colors: string[]) => void;
}) {
  const [open, setOpen] = useState(false); const button = useRef<HTMLButtonElement>(null);
  const style = studioPalettes.find(palette => palette.id === styleId) || studioPalettes[0];
  return <div className="picker-wrap settings-picker"><button ref={button} className="tool-pill settings-pill" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-label={`Video settings: ${aspect}, ${duration} seconds`} onClick={() => setOpen(value => !value)}><span className="mono">{aspect} · {duration}s</span>{style.swatch.length > 0 && <span className="brand-dots">{style.swatch.map(color => <i key={color} style={{ background: color }} />)}</span>}{brandColors.length > 0 && <span className="brand-dots">{brandColors.map((color, index) => <i key={index} style={{ background: color }} />)}</span>}</button>{open && <FloatingPanel anchor={button} label="Video settings" width={440} onClose={() => setOpen(false)}><div className="pop-head"><b>Video settings</b></div><div className="set-group"><span className="set-label">Format</span><div className="seg" role="radiogroup" aria-label="Format">{(['16:9', '9:16', '1:1'] as const).map(format => <button key={format} role="radio" aria-checked={aspect === format} onClick={() => onAspect(format)}><span className="cmv-aspect-icon" style={{ aspectRatio: format.replace(':', '/') }} /><span className="mono">{format}</span></button>)}</div></div><div className="set-group"><span className="set-label">Length<span className="set-cost"><Zap size={12} />{cost}</span></span><div className="seg" role="radiogroup" aria-label="Length">{([10, 15, 30] as const).map(length => <button key={length} role="radio" aria-checked={duration === length} onClick={() => onDuration(length)}><span className="mono">{length}s</span></button>)}</div></div><div className="set-group"><span className="set-label">Colors</span><div className="palettes" role="radiogroup" aria-label="Colors">{studioPalettes.map(palette => <button key={palette.id} role="radio" aria-checked={styleId === palette.id} className="palette" title={palette.hint} onClick={() => onStyle(palette.id)}><span className="palette-colors">{palette.swatch.length ? palette.swatch.map((color, index) => <i key={index} style={{ background: color }} />) : <Sparkles size={16} />}</span><span className="palette-name">{palette.name}</span></button>)}</div></div><div className="brand-colors"><div><b>Your brand colours</b><span className="muted small"> optional, up to 3</span></div><div className="brand-row">{brandColors.map((color, index) => <span className="brand-chip" key={index}><input type="color" value={color} aria-label={`Brand colour ${index + 1}`} onChange={event => onColors(brandColors.map((value, i) => i === index ? event.target.value.toUpperCase() : value))} /><span className="mono">{color}</span><button aria-label={`Remove ${color}`} onClick={() => onColors(brandColors.filter((_, i) => i !== index))}>×</button></span>)}{brandColors.length < 3 && <button className="btn small" onClick={() => onColors([...brandColors, ['#FF5A36', '#111111', '#F4EFE6'][brandColors.length]])}>+ Add colour</button>}</div></div><div className="pop-foot"><button className="btn small primary" onClick={() => setOpen(false)}>Done</button></div></FloatingPanel>}</div>;
}
