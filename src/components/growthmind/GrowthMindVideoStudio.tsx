import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Clapperboard, Loader2, Play, Trash2, CalendarDays, X,
  Sparkles, CheckCircle2, Circle, DollarSign, Volume2,
  Film, Zap, Star, Clock, ChevronDown, ChevronUp,
  BarChart3, AlertCircle, Music2, Tv2, Radio, RefreshCw,
  ExternalLink, Mic, PenLine, LayoutTemplate, ShieldCheck,
  XCircle, Check, Megaphone, Layers, Target, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  generateVideo, generateVideoFromPrompt, getVideoAssets, deleteVideoAsset,
  scheduleVideoAsset, getVideoCostStats, retryVideoJob, pollVideoJob, getVideoDownloadUrl,
  generateVideoVariants, scoreVideoCreative, getVeoStatus, clearFailedVideoAssets,
  getVideoClips, triggerVideoAssembly,
  VIDEO_TYPE_LABELS, VIDEO_TYPE_CATEGORIES,
  type VideoType, type QualityMode, type VideoAsset, type StoryboardScene, type VideoClip,
} from "@/lib/growthmind/growthmind.video-studio";
import { listGrowthMindVoices } from "@/lib/growthmind/growthmind.ai";
import {
  isJobPending, isJobError, parseErrorMessage, isRealVideoUrl, parseJobSentinel,
  isCompositePending,
} from "@/lib/growthmind/video-job-poller";

// ── Constants ─────────────────────────────────────────────────────────────────

const LS_VOICE_KEY = "gm_video_voice_id";
const LS_VOICE_NAME_KEY = "gm_video_voice_name";
const DEFAULT_VOICE_ID   = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_VOICE_NAME = "Rachel";

function loadStoredVoice(): { id: string; name: string } {
  try {
    const id   = localStorage.getItem(LS_VOICE_KEY)   ?? DEFAULT_VOICE_ID;
    const name = localStorage.getItem(LS_VOICE_NAME_KEY) ?? DEFAULT_VOICE_NAME;
    return { id, name };
  } catch { return { id: DEFAULT_VOICE_ID, name: DEFAULT_VOICE_NAME }; }
}

function saveStoredVoice(id: string, name: string) {
  try {
    localStorage.setItem(LS_VOICE_KEY, id);
    localStorage.setItem(LS_VOICE_NAME_KEY, name);
  } catch {}
}

// ── Types ─────────────────────────────────────────────────────────────────────

type GenerationStep =
  | "idle"
  | "strategy"
  | "script"
  | "voice"
  | "video"
  | "saving"
  | "done"
  | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Detects TanStack Start stale server-function-ID errors (happen after server restarts).
 *  The response body is an HTML error page. Auto-reload fixes it. */
function isStaleServerFnError(e: any): boolean {
  const msg: string = e?.message ?? "";
  return (
    msg.trimStart().startsWith("<!") ||
    msg.trimStart().startsWith("<html") ||
    msg.includes("Invalid server function ID") ||
    msg.includes("This page didn't load")
  );
}

/** Parses a Zod issue array into a readable string. */
function parseZodIssues(issues: any[]): string {
  return issues
    .map((issue: any) => {
      const field = Array.isArray(issue.path) ? issue.path.join(".") : "";
      return field ? `${field}: ${issue.message}` : (issue.message ?? "Validation error");
    })
    .join("; ");
}

/** Converts any TanStack Start / Zod validation error into a human-readable string.
 *  Checks every common location where Zod issues end up (message, cause, data, body). */
function formatErrorMessage(e: any): string {
  // 1. Zod error object directly (e.issues)
  if (Array.isArray(e?.issues) && e.issues.length > 0) return parseZodIssues(e.issues);

  // 2. Nested cause (TanStack Start sometimes wraps)
  if (Array.isArray(e?.cause?.issues) && e.cause.issues.length > 0) return parseZodIssues(e.cause.issues);
  if (Array.isArray(e?.data?.issues)  && e.data.issues.length  > 0) return parseZodIssues(e.data.issues);

  const msg: string = e?.message ?? e?.toString?.() ?? "";

  // 3. JSON array embedded anywhere in the message
  const bracketIdx = msg.indexOf("[");
  if (bracketIdx !== -1) {
    try {
      const candidate = msg.slice(bracketIdx);
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.message) {
        return parseZodIssues(parsed);
      }
    } catch { /* not JSON there */ }
  }

  // 4. Plain JSON array as the whole message
  if (msg.trimStart().startsWith("[")) {
    try {
      const parsed = JSON.parse(msg);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.message) {
        return parseZodIssues(parsed);
      }
    } catch { /* fall through */ }
  }

  return msg || "Generation failed";
}

/** Same as formatErrorMessage but works on an already-stringified error stored in state. */
function formatDisplayError(raw: string): string {
  if (!raw) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.message) {
      return parseZodIssues(parsed);
    }
  } catch { /* not JSON */ }
  return raw;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatCost(usd: number): string {
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(4)}`;
}

const QUALITY_MODES: { id: QualityMode; label: string; desc: string; icon: React.ElementType; color: string }[] = [
  { id: "fast",     label: "Fast",     desc: "Script & storyboard only",          icon: Zap,   color: "text-amber-400"  },
  { id: "balanced", label: "Balanced", desc: "Script + ElevenLabs voiceover",     icon: Music2, color: "text-sky-400"   },
  { id: "premium",  label: "Premium",  desc: "Script + voice + AI video (Veo 3)", icon: Star,  color: "text-violet-400" },
];

const PROVIDER_LABELS: Record<string, string> = {
  veo3:       "Veo 3",
  runway_gen4: "Runway Gen-4",
  kling:      "Kling",
  pika:       "Pika",
};

const TONE_OPTIONS = ["Professional", "Friendly", "Energetic", "Authoritative", "Casual", "Urgent"];

const STEP_ORDER: GenerationStep[] = ["strategy", "script", "voice", "video", "saving"];

function StepIndicator({ step, currentStep, qualityMode }: {
  step:        GenerationStep;
  currentStep: GenerationStep;
  qualityMode: QualityMode;
}) {
  const steps = [
    { id: "strategy" as GenerationStep, label: "Strategy",   always: true  },
    { id: "script"   as GenerationStep, label: "Script",     always: true  },
    { id: "voice"    as GenerationStep, label: "Voiceover",  always: false },
    { id: "video"    as GenerationStep, label: "AI Video",   always: false },
    { id: "saving"   as GenerationStep, label: "Saving",     always: true  },
  ];

  const visible = steps.filter(s => s.always || qualityMode !== "fast");
  const idx     = STEP_ORDER.indexOf(currentStep);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {visible.map((s, i) => {
        const sIdx   = STEP_ORDER.indexOf(s.id);
        const done   = sIdx < idx;
        const active = s.id === currentStep;
        return (
          <div key={s.id} className="flex items-center gap-1.5">
            <div className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all",
              active ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30"
              : done  ? "bg-emerald-500/10 text-emerald-400/70"
              : "bg-white/[0.04] text-muted-foreground/50",
            )}>
              {active ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
               : done  ? <CheckCircle2 className="h-2.5 w-2.5" />
               : <Circle className="h-2.5 w-2.5" />}
              {s.label}
            </div>
            {i < visible.length - 1 && <div className="h-px w-3 bg-white/[0.08]" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Storyboard scene card ─────────────────────────────────────────────────────

function SceneCard({ scene }: { scene: StoryboardScene }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-violet-500/15 border border-violet-500/20 px-2.5 py-0.5 text-[10px] font-bold text-violet-400">
          Scene {scene.scene}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <Clock className="h-2.5 w-2.5" />{scene.duration}s
        </span>
      </div>

      <div className="space-y-2.5">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mb-0.5">Visual</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{scene.visual}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mb-0.5">Voiceover</p>
          <p className="text-xs leading-relaxed">{scene.voiceover}</p>
        </div>
        {scene.onScreenText && (
          <div>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mb-0.5">On-screen text</p>
            <p className="text-xs font-medium text-amber-300/90">{scene.onScreenText}</p>
          </div>
        )}
        {scene.cta && (
          <div className="rounded-lg bg-emerald-500/[0.08] border border-emerald-500/15 px-2.5 py-1.5">
            <p className="text-[9px] uppercase tracking-wider text-emerald-400/60 mb-0.5">CTA</p>
            <p className="text-xs font-semibold text-emerald-300">{scene.cta}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Asset card ────────────────────────────────────────────────────────────────

function useElapsedSeconds(since: string | null | undefined, active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active || !since) { setElapsed(0); return; }
    const start = new Date(since).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, since]);
  return elapsed;
}

// ── Composite video progress panel ────────────────────────────────────────────

function CompositeProgressPanel({ asset }: { asset: VideoAsset }) {
  const getClipsFn = useServerFn(getVideoClips);
  const triggerFn  = useServerFn(triggerVideoAssembly);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState("");

  const status = asset.assemblyStatus;
  const isAssembling = status === "assembling";
  const isFailed     = status === "failed";
  const isDone       = status === "complete";
  const needsTrigger = status === "clips_generating" || status === "clips_complete";

  const { data: clipsData } = useQuery({
    queryKey: ["video-clips", asset.id],
    queryFn:  () => getClipsFn({ data: { assetId: asset.id } }),
    enabled:  !isDone,
    refetchInterval: needsTrigger || isAssembling ? 8_000 : false,
  });
  const clips: VideoClip[] = clipsData?.clips ?? [];

  const completedCount = clips.filter(c => c.status === "completed").length;
  const failedCount    = clips.filter(c => c.status === "failed").length;
  const totalCount     = clips.length;

  async function handleTrigger() {
    setTriggering(true);
    setTriggerError("");
    try {
      await triggerFn({ data: { assetId: asset.id } });
    } catch (e: any) {
      setTriggerError(e?.message ?? "Assembly failed");
    }
    setTriggering(false);
  }

  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Layers className="h-3.5 w-3.5 text-violet-400 shrink-0" />
        <p className="text-[10px] uppercase tracking-wider text-violet-400/80 font-semibold flex-1">
          Composite Video
          {asset.requestedDuration && (
            <span className="ml-1.5 text-violet-400/50 normal-case">
              {asset.requestedDuration}s
            </span>
          )}
        </p>
        {isAssembling && (
          <span className="flex items-center gap-1 text-[10px] text-amber-400 animate-pulse">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />Assembling…
          </span>
        )}
        {isDone && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-400">
            <CheckCircle2 className="h-2.5 w-2.5" />Complete
          </span>
        )}
      </div>

      {clips.length > 0 && (
        <div className="grid grid-cols-4 gap-1">
          {clips.map(clip => (
            <div
              key={clip.id}
              title={`Scene ${clip.sceneIndex + 1}: ${clip.sceneTitle ?? ""}`}
              className={cn(
                "flex items-center justify-center h-7 rounded text-[9px] font-bold border",
                clip.status === "completed" ? "bg-emerald-500/15 border-emerald-500/25 text-emerald-400"
                : clip.status === "failed"  ? "bg-red-500/15 border-red-500/20 text-red-400"
                : clip.status === "processing" ? "bg-amber-500/15 border-amber-500/25 text-amber-400 animate-pulse"
                : "bg-white/[0.03] border-white/[0.06] text-muted-foreground/40",
              )}
            >
              {clip.status === "completed" ? "✓"
               : clip.status === "failed"  ? "✗"
               : clip.status === "processing" ? "…"
               : `${clip.sceneIndex + 1}`}
            </div>
          ))}
        </div>
      )}

      {totalCount > 0 && (
        <p className="text-[10px] text-muted-foreground/60">
          {completedCount}/{totalCount} clips done
          {failedCount > 0 && (
            <span className="text-red-400/80 ml-1.5">{failedCount} failed</span>
          )}
        </p>
      )}

      {isFailed && asset.assemblyError && (
        <p className="text-[10px] text-red-400/80 leading-relaxed">{asset.assemblyError.slice(0, 120)}</p>
      )}

      {(isFailed || (needsTrigger && completedCount > 0 && completedCount === totalCount - failedCount && totalCount > 0)) && (
        <button
          onClick={handleTrigger}
          disabled={triggering}
          className="flex items-center gap-1.5 text-[10px] font-medium text-violet-400 hover:text-violet-300 transition-colors disabled:opacity-50"
        >
          {triggering ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {triggering ? "Assembling…" : "Assemble clips now"}
        </button>
      )}

      {triggerError && (
        <p className="text-[10px] text-red-400/80">{triggerError}</p>
      )}
    </div>
  );
}

function VideoAssetCard({ asset, onDelete, onSchedule, onRetry }: {
  asset:      VideoAsset;
  onDelete:   (id: string) => void;
  onSchedule: (asset: VideoAsset) => void;
  onRetry:    (id: string) => void;
}) {
  const [expanded, setExpanded]           = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [playUrl,  setPlayUrl]            = useState<string | null>(null);
  const [loadingPlay, setLoadingPlay]     = useState(false);
  const [videoLoadError, setVideoLoadError] = useState("");
  const [showDebug, setShowDebug]           = useState(false);

  const getDownloadFn = useServerFn(getVideoDownloadUrl);

  const label  = VIDEO_TYPE_LABELS[asset.videoType] ?? asset.videoType;
  const qMode  = QUALITY_MODES.find(q => q.id === asset.qualityMode) ?? QUALITY_MODES[0];
  const QIcon  = qMode.icon;

  const jobPendingForTimer = isJobPending(asset.videoUrl);
  const elapsedSec = useElapsedSeconds(asset.createdAt, jobPendingForTimer);
  const elapsedLabel = elapsedSec < 60
    ? `${elapsedSec}s`
    : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;

  // "__data_uri__" marker means the list query stripped the real data URI for
  // performance — we fetch it on demand when the user clicks Play.
  const isDataUriMarker = asset.videoUrl === "__data_uri__";

  async function handleLoadPlay() {
    setLoadingPlay(true);
    try {
      const res = await getDownloadFn({ data: { id: asset.id } });
      if (res.downloadUrl) setPlayUrl(res.downloadUrl);
      else setDownloadError(res.error ?? "Could not load video");
    } catch (e: any) {
      setDownloadError(e?.message ?? "Load failed");
    }
    setLoadingPlay(false);
  }

  async function handleDownload() {
    setDownloadLoading(true);
    setDownloadError("");
    try {
      const res = await getDownloadFn({ data: { id: asset.id } });
      if (res.downloadUrl) {
        window.open(res.downloadUrl, "_blank", "noopener,noreferrer");
      } else {
        setDownloadError(res.error ?? "Could not generate download URL. Check Google Cloud credentials.");
      }
    } catch (e: any) {
      setDownloadError(e?.message ?? "Download failed");
    }
    setDownloadLoading(false);
  }

  const jobPending   = isJobPending(asset.videoUrl);
  const jobError     = isJobError(asset.videoUrl);
  const videoReady   = isRealVideoUrl(asset.videoUrl);
  const jobInfo      = jobPending ? parseJobSentinel(asset.videoUrl) : null;
  const errorMessage = jobError ? parseErrorMessage(asset.videoUrl!) : null;
  const isGcsUri     = videoReady && asset.videoUrl?.startsWith("gs://");

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4 space-y-3 hover:border-white/[0.12] transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 border border-violet-500/20">
            <Film className="h-3.5 w-3.5 text-violet-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate" title={asset.title}>{asset.title}</p>
            <p className="text-[10px] mt-0.5 text-violet-400/80">{label}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {jobError && (
            <button
              onClick={() => onRetry(asset.id)}
              className="p-1 rounded text-muted-foreground/40 hover:text-amber-400 transition-colors"
              title="Retry video generation"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => onSchedule(asset)}
            className="p-1 rounded text-muted-foreground/40 hover:text-emerald-400 transition-colors"
            title="Schedule to calendar"
          >
            <CalendarDays className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(asset.id)}
            className="p-1 rounded text-muted-foreground/40 hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
        {asset.script.slice(0, 160)}…
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border",
          qMode.id === "premium" ? "bg-violet-500/10 border-violet-500/20 text-violet-400"
          : qMode.id === "balanced" ? "bg-sky-500/10 border-sky-500/20 text-sky-400"
          : "bg-amber-500/10 border-amber-500/20 text-amber-400",
        )}>
          <QIcon className="h-2.5 w-2.5" />
          {qMode.label}
        </span>
        {asset.hasNativeAudio && (
          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border bg-amber-500/10 border-amber-500/20 text-amber-400">
            <Volume2 className="h-2.5 w-2.5" />Veo Audio
          </span>
        )}
        {asset.audioUrl && (
          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border bg-sky-500/10 border-sky-500/20 text-sky-400">
            <Volume2 className="h-2.5 w-2.5" />Voice
          </span>
        )}
        {isCompositePending(asset.videoUrl) ? (
          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border bg-violet-500/10 border-violet-500/20 text-violet-400 animate-pulse">
            <Layers className="h-2.5 w-2.5" />Building clips…
          </span>
        ) : jobPending ? (
          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border bg-amber-500/10 border-amber-500/20 text-amber-400 animate-pulse">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            {jobInfo?.type === "runway" ? "Runway" : "Veo 3"} processing…
          </span>
        ) : null}
        {jobError && (
          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border bg-red-500/10 border-red-500/20 text-red-400">
            <AlertCircle className="h-2.5 w-2.5" />Video failed
          </span>
        )}
        {videoReady && (
          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border bg-violet-500/10 border-violet-500/20 text-violet-400">
            <Play className="h-2.5 w-2.5" />Video ready
          </span>
        )}
        {asset.scheduledAt && (
          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
            <CalendarDays className="h-2.5 w-2.5" />Scheduled
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground/50">{formatDate(asset.createdAt)}</span>
      </div>

      {asset.audioUrl && (
        <div className="rounded-lg border border-sky-500/15 bg-sky-500/[0.04] px-3 py-2 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-sky-400/70 font-semibold flex items-center gap-1.5">
            <Volume2 className="h-3 w-3" />Voiceover
          </p>
          <audio controls src={asset.audioUrl} className="w-full h-8" />
        </div>
      )}

      {asset.isComposite && <CompositeProgressPanel asset={asset} />}

      {/* Video states */}
      {jobPending && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2.5">
          <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold text-amber-400">
                {jobInfo?.type === "runway" ? "Runway Gen-4" : "Veo 3"} rendering…
              </p>
              <span className="text-[10px] font-mono tabular-nums text-amber-400/70 shrink-0">
                ⏱ {elapsedLabel}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground/60 truncate">
              Typically 2–5 min · auto-refreshes every 10s
            </p>
          </div>
        </div>
      )}

      {jobError && errorMessage && (
        <div className="space-y-1.5">
          <div className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2.5">
            <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-red-400">Video generation failed</p>
              <p className="text-[10px] text-red-400/70 leading-relaxed line-clamp-2">{errorMessage}</p>
            </div>
          </div>
          <button
            onClick={() => onRetry(asset.id)}
            className="flex items-center gap-1.5 text-[10px] text-amber-400/80 hover:text-amber-400 transition-colors font-medium"
          >
            <RefreshCw className="h-3 w-3" />
            Retry video generation
          </button>
        </div>
      )}

      {videoReady && !isGcsUri && !isDataUriMarker && (
        <div className="space-y-1.5">
          <div className="rounded-lg overflow-hidden border border-white/[0.06]">
            <video
              controls
              src={asset.videoUrl!}
              className="w-full max-h-48 bg-black"
              preload="metadata"
              onError={() => setVideoLoadError("Video failed to load. The storage URL may be inaccessible — try refreshing the page.")}
              onLoadedMetadata={() => setVideoLoadError("")}
            />
          </div>
          {videoLoadError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-1">
                <p className="text-[10px] text-red-400/90">{videoLoadError}</p>
                <button
                  onClick={() => onRetry(asset.id)}
                  className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
                >
                  <RefreshCw className="h-3 w-3" />Delete + Regenerate
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isDataUriMarker && (
        <div className="space-y-2">
          {playUrl ? (
            <div className="rounded-lg overflow-hidden border border-white/[0.06]">
              <video controls src={playUrl} className="w-full max-h-48 bg-black" preload="metadata" />
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-lg border border-violet-500/15 bg-violet-500/[0.04] px-3 py-2.5">
              <Play className="h-3.5 w-3.5 text-violet-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold text-violet-400">Video ready</p>
                <p className="text-[10px] text-muted-foreground/60">Stored as inline data — click to load</p>
              </div>
              <button
                onClick={handleLoadPlay}
                disabled={loadingPlay}
                className="shrink-0 flex items-center gap-1.5 rounded-lg bg-violet-500/15 border border-violet-500/25 px-2.5 py-1.5 text-[10px] font-semibold text-violet-300 hover:bg-violet-500/25 transition-colors disabled:opacity-50"
              >
                {loadingPlay ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                {loadingPlay ? "Loading…" : "Play"}
              </button>
            </div>
          )}
          {downloadError && <p className="text-[10px] text-red-400/80 px-1">{downloadError}</p>}
        </div>
      )}

      {videoReady && isGcsUri && (
        <div className="space-y-2">
          <div className="flex items-center gap-2.5 rounded-lg border border-violet-500/15 bg-violet-500/[0.04] px-3 py-2.5">
            <ExternalLink className="h-3.5 w-3.5 text-violet-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-violet-400">Video ready (Google Cloud Storage)</p>
              <p className="text-[10px] text-muted-foreground/60 truncate" title={asset.videoUrl!}>
                {asset.videoUrl}
              </p>
            </div>
            <button
              onClick={handleDownload}
              disabled={downloadLoading}
              className="shrink-0 flex items-center gap-1.5 rounded-lg bg-violet-500/15 border border-violet-500/25 px-2.5 py-1.5 text-[10px] font-semibold text-violet-300 hover:bg-violet-500/25 transition-colors disabled:opacity-50"
              title="Download video from GCS"
            >
              {downloadLoading
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <ExternalLink className="h-3 w-3" />}
              {downloadLoading ? "Loading…" : "Download"}
            </button>
          </div>
          {downloadError && (
            <p className="text-[10px] text-red-400/80 leading-relaxed px-1">{downloadError}</p>
          )}
        </div>
      )}

      {asset.storyboard.length > 0 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Hide" : "Show"} storyboard ({asset.storyboard.length} scenes)
        </button>
      )}

      {expanded && asset.storyboard.length > 0 && (
        <div className="space-y-3 pt-1">
          {asset.storyboard.map(scene => (
            <SceneCard key={scene.scene} scene={scene} />
          ))}
        </div>
      )}

      {/* ── Debug panel ──────────────────────────────────────────────── */}
      <button
        onClick={() => setShowDebug(v => !v)}
        className="flex items-center gap-1 text-[9px] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
      >
        <BookOpen className="h-2.5 w-2.5" />
        {showDebug ? "Hide" : "Show"} debug
      </button>

      {showDebug && (() => {
        const url = asset.videoUrl ?? "(null)";
        let urlType = "unknown";
        if (!asset.videoUrl)                                      urlType = "NULL";
        else if (url === "[composite_pending]")                   urlType = "COMPOSITE_PENDING";
        else if (url === "__data_uri__")                          urlType = "DATA_URI_MARKER";
        else if (url.startsWith("data:video/"))                   urlType = "DATA_URI";
        else if (url.startsWith("https://") && url.includes("supabase")) urlType = "SUPABASE_STORAGE ✓";
        else if (url.startsWith("https://"))                      urlType = "HTTPS";
        else if (url.startsWith("gs://"))                         urlType = "GCS_URI";
        else if (url.startsWith("[veo3_job:"))                    urlType = "VEO3_PENDING";
        else if (url.startsWith("[runway_job:"))                  urlType = "RUNWAY_PENDING";
        else if (url.startsWith("[error:"))                       urlType = "ERROR_SENTINEL";
        else if (url.includes("generativelanguage.googleapis.com")) urlType = "GOOGLE_FILES_EXPIRED";

        const rows: [string, string][] = [
          ["Asset ID",     asset.id],
          ["Provider",     asset.provider ?? "(none)"],
          ["URL type",     urlType],
          ["Raw URL",      url.slice(0, 80) + (url.length > 80 ? "…" : "")],
          ["Composite",    asset.isComposite ? `yes — ${asset.assemblyStatus ?? "unknown"}` : "no"],
          ["Created",      asset.createdAt],
          ["Video error",  videoLoadError || "none"],
        ];

        return (
          <div className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-2.5 space-y-1 font-mono">
            {rows.map(([k, v]) => (
              <div key={k} className="flex gap-2 text-[9px] leading-relaxed">
                <span className="text-muted-foreground/50 shrink-0 w-20">{k}</span>
                <span className={cn(
                  "break-all",
                  urlType.includes("ERROR") || urlType === "GOOGLE_FILES_EXPIRED" ? "text-red-400/80"
                  : urlType.includes("SUPABASE") ? "text-emerald-400/80"
                  : urlType.includes("PENDING") ? "text-amber-400/80"
                  : "text-muted-foreground/70",
                )}>{v}</span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ── Cost panel ────────────────────────────────────────────────────────────────

function VideoCostPanel() {
  const getCostFn = useServerFn(getVideoCostStats);
  const { data } = useQuery({
    queryKey: ["video-cost-stats"],
    queryFn:  () => getCostFn({}),
  });

  if (!data) return null;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4 space-y-3">
      <p className="text-xs font-semibold flex items-center gap-2">
        <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
        Cost Overview (30d)
      </p>

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-2.5">
          <p className="text-[10px] text-muted-foreground/60 mb-0.5">Total Assets</p>
          <p className="text-sm font-bold">{data.totalAssets}</p>
        </div>
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-2.5">
          <p className="text-[10px] text-muted-foreground/60 mb-0.5">Total Cost</p>
          <p className="text-sm font-bold text-emerald-400">{formatCost(data.totalCost)}</p>
        </div>
      </div>

      {/* Cost breakdown */}
      <div className="space-y-1.5">
        <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Cost breakdown</p>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">AI text (strategy + script)</span>
          <span className="text-[11px]">{formatCost(data.aiTextCost)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">ElevenLabs voice ({data.elLabsCount} gen)</span>
          <span className="text-[11px]">{formatCost(data.elLabsCost)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            Video (Veo3 ×{data.veo3Count} · Runway ×{data.runwayCount})
          </span>
          <span className="text-[11px]">{formatCost(data.videoCost)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Storage (~{data.storageMb} MB)</span>
          <span className="text-[11px]">{formatCost(data.storageCostUsd)}</span>
        </div>
      </div>

      {/* Profit margin */}
      {data.totalCost > 0 && (
        <div className="rounded-lg bg-emerald-500/[0.07] border border-emerald-500/20 p-2.5 space-y-1">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Est. profit margin (3× markup)</p>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Est. revenue</span>
            <span className="text-[11px] text-emerald-400">{formatCost(data.estimatedRevenue)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Margin</span>
            <span className="text-[11px] font-semibold text-emerald-400">{data.profitMarginPct}%</span>
          </div>
        </div>
      )}

      {Object.keys(data.byQuality).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">By quality</p>
          {Object.entries(data.byQuality).map(([q, count]) => {
            const mode = QUALITY_MODES.find(m => m.id === q);
            return (
              <div key={q} className="flex items-center justify-between">
                <span className={cn("text-[11px]", mode?.color ?? "text-muted-foreground")}>{mode?.label ?? q}</span>
                <span className="text-[11px] text-muted-foreground/70">{count as number} video{(count as number) !== 1 ? "s" : ""}</span>
              </div>
            );
          })}
        </div>
      )}

      {Object.keys(data.byProvider).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">By provider</p>
          {Object.entries(data.byProvider).map(([prov, stat]) => (
            <div key={prov} className="flex items-center justify-between">
              <span className="text-[11px]">{PROVIDER_LABELS[prov as keyof typeof PROVIDER_LABELS] ?? prov}</span>
              <span className="text-[11px] text-muted-foreground/70">
                {(stat as { count: number; cost: number }).count} · {formatCost((stat as { count: number; cost: number }).cost)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Schedule modal ────────────────────────────────────────────────────────────

function ScheduleModal({ asset, onClose, onScheduled }: {
  asset:       VideoAsset;
  onClose:     () => void;
  onScheduled: () => void;
}) {
  const scheduleFn = useServerFn(scheduleVideoAsset);
  const [date, setDate]     = useState(new Date().toISOString().slice(0, 10));
  const [channel, setChannel] = useState("");
  const [notes, setNotes]   = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  async function handleSchedule() {
    setSaving(true); setError("");
    try {
      await scheduleFn({ data: {
        assetId:       asset.id,
        scheduledDate: date,
        channel,
        notes,
      }});
      onScheduled();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Failed to schedule");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[hsl(var(--sidebar-background))] shadow-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/20">
            <CalendarDays className="h-4.5 w-4.5 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-semibold">Schedule to Content Calendar</p>
            <p className="text-xs text-muted-foreground truncate max-w-[220px]">{asset.title}</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3.5">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Scheduled Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Channel (optional)</Label>
            <Input value={channel} onChange={e => setChannel(e.target.value)} placeholder="e.g. Instagram, TikTok" className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Notes (optional)</Label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              placeholder="Any notes about this scheduled post…"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose} className="flex-1">Cancel</Button>
          <Button size="sm" onClick={handleSchedule} disabled={saving || !date} className="flex-1">
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="mr-1.5 h-3.5 w-3.5" />}
            Schedule
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type InputMode = "guided" | "freeform";

const PLATFORM_OPTIONS = [
  { value: "meta",      label: "Meta (Facebook/Instagram)" },
  { value: "tiktok",    label: "TikTok" },
  { value: "linkedin",  label: "LinkedIn" },
  { value: "youtube",   label: "YouTube" },
  { value: "instagram", label: "Instagram Reels" },
  { value: "general",   label: "General / Multi-Platform" },
];

const LENGTH_OPTIONS = [
  { value: 10,  label: "10 seconds" },
  { value: 15,  label: "15 seconds" },
  { value: 20,  label: "20 seconds" },
  { value: 30,  label: "30 seconds" },
  { value: 60,  label: "60 seconds" },
  { value: 90,  label: "90 seconds" },
];

const ASPECT_OPTIONS = [
  { value: "9:16", label: "9:16 (Portrait / Stories)" },
  { value: "16:9", label: "16:9 (Landscape / YouTube)" },
  { value: "1:1",  label: "1:1 (Square)" },
  { value: "4:5",  label: "4:5 (Vertical Feed)" },
];

const FREEFORM_PROVIDERS = [
  { value: "veo3",       label: "Veo 3 (Google)",    note: "Cinematic quality" },
  { value: "runway_gen4", label: "Runway Gen-4",      note: "UGC & authentic" },
  { value: "kling",      label: "Kling",              note: "Coming soon" },
  { value: "pika",       label: "Pika",               note: "Coming soon" },
];

export function GrowthMindVideoStudio() {
  const qc = useQueryClient();

  const generateFn         = useServerFn(generateVideo);
  const generateFreeFormFn = useServerFn(generateVideoFromPrompt);
  const getAssetsFn        = useServerFn(getVideoAssets);
  const deleteAssetFn      = useServerFn(deleteVideoAsset);
  const retryFn            = useServerFn(retryVideoJob);
  const pollJobFn          = useServerFn(pollVideoJob);
  const voicesFn           = useServerFn(listGrowthMindVoices);
  const getVeoStatusFn     = useServerFn(getVeoStatus);

  const { data: veoStatus } = useQuery({
    queryKey: ["veo-status"],
    queryFn:  () => getVeoStatusFn(),
    staleTime: 60_000,
  });

  const generateVariantsFn  = useServerFn(generateVideoVariants);
  const scoreFn             = useServerFn(scoreVideoCreative);
  const getDownloadResultFn = useServerFn(getVideoDownloadUrl);
  const clearFailedFn       = useServerFn(clearFailedVideoAssets);

  const [resultPlayUrl,    setResultPlayUrl]    = useState<string | null>(null);
  const [resultPlayLoading, setResultPlayLoading] = useState(false);

  // ── Mode ──────────────────────────────────────────────────────────────────
  const [inputMode, setInputMode] = useState<InputMode>("guided");

  // ── Guided builder state ──────────────────────────────────────────────────
  const [videoType, setVideoType]     = useState<VideoType>("explainer_video");
  const [qualityMode, setQualityMode] = useState<QualityMode>("fast");
  const [targetAudience, setTargetAudience] = useState("");
  const [offer, setOffer]             = useState("");
  const [tone, setTone]               = useState("professional");
  const [cta, setCta]                 = useState("");

  // ── Free-form mode state ──────────────────────────────────────────────────
  const [ffPrompt,    setFfPrompt]    = useState("");
  const [ffGoal,      setFfGoal]      = useState("");
  const [ffAudience,  setFfAudience]  = useState("");
  const [ffPlatform,  setFfPlatform]  = useState("meta");
  const [ffLength,    setFfLength]    = useState(20);
  const [ffAspect,    setFfAspect]    = useState("9:16");
  const [ffBrandStyle, setFfBrandStyle] = useState("");
  const [ffCta,       setFfCta]       = useState("");
  const [ffVoiceover, setFfVoiceover] = useState(true);
  const [ffProvider,  setFfProvider]  = useState("veo3");

  // ── Shared state ──────────────────────────────────────────────────────────
  const [includeKb, setIncludeKb] = useState(true);
  const [veoAudio,  setVeoAudio]  = useState(true);
  const [voiceId, setVoiceId]     = useState(DEFAULT_VOICE_ID);
  const [voiceName, setVoiceName] = useState(DEFAULT_VOICE_NAME);
  const [voices, setVoices]       = useState<{ id: string; name: string; category: string }[]>([]);

  const [step, setStep]   = useState<GenerationStep>("idle");
  const [error, setError] = useState("");

  // Pre-fill from URL params when navigating from Content Studio or Campaign Factory
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const mode      = sp.get("mode");
    const prompt    = sp.get("prompt");
    const vidType   = sp.get("videoType");
    const cid       = sp.get("campaignId");
    const cname     = sp.get("campaignName");
    const platform  = sp.get("platform");
    if (cid)   setCampaignId(cid);
    if (cname) setCampaignName(decodeURIComponent(cname));
    if (mode === "freeform") {
      setInputMode("freeform");
      if (prompt)   setFfPrompt(decodeURIComponent(prompt));
      if (platform) setFfPlatform(platform);
      if (vidType) {
        const VALID_PROVIDERS: Record<string, string> = {
          meta_video_ad: "veo3", ugc_ad: "runway_gen4", testimonial_video: "runway_gen4",
        };
        setFfProvider(VALID_PROVIDERS[vidType] ?? "veo3");
      }
    }
  }, []);

  useEffect(() => {
    const stored = loadStoredVoice();
    setVoiceId(stored.id);
    setVoiceName(stored.name);
    voicesFn().then(r => {
      if (r.voices?.length) {
        setVoices(r.voices);
        setVoiceId(prev => {
          if (prev === DEFAULT_VOICE_ID) {
            const first = r.voices[0];
            setVoiceName(first.name);
            saveStoredVoice(first.id, first.name);
            return first.id;
          }
          return prev;
        });
      }
    }).catch(() => {});
  }, []);

  const [lastResult, setLastResult] = useState<{
    assetId:          string;
    title:            string;
    script:           string;
    storyboard:       StoryboardScene[];
    audioUrl:         string | null;
    videoUrl:         string | null;
    costEstimate:     number;
    strategyBrief:    string;
    marketingAngle?:  string;
    hook?:            string;
    optimisedPrompt?: string;
    qualityChecks?:   { rule: string; passed: boolean; note: string }[];
    allChecksPassed?: boolean;
    valuePointUsed?:  string | null;
  } | null>(null);

  // ── Campaign + variant state ───────────────────────────────────────────────
  const [campaignId, setCampaignId]       = useState<string | null>(null);
  const [campaignName, setCampaignName]   = useState<string>("");
  const [variantCount, setVariantCount]   = useState<1 | 3 | 5>(1);

  // ── Creative score state ───────────────────────────────────────────────────
  const [creativeScore, setCreativeScore] = useState<{ overall: number; verdict: string; improvements: string[]; hook: number; clarity: number; emotion: number; cta: number; brand: number; platform: number } | null>(null);
  const [scoringId, setScoringId]         = useState<string | null>(null);
  const [clearingFailed, setClearingFailed] = useState(false);

  const [filterType, setFilterType]       = useState<VideoType | "all">("all");
  const [scheduleAsset, setScheduleAsset] = useState<VideoAsset | null>(null);

  const { data: assetsData } = useQuery({
    queryKey: ["video-assets", filterType],
    queryFn:  () => getAssetsFn({ data: { videoType: filterType === "all" ? undefined : filterType, limit: 200 } }),
    refetchInterval: 15000,
  });

  const assets = assetsData?.assets ?? [];

  const displayedAssets = assets;

  // Active polling: every 10 s, call pollVideoJob for each pending asset so the
  // DB is updated promptly and the query cache is invalidated on resolution.
  useEffect(() => {
    const pendingIds = assets.filter(a => isJobPending(a.videoUrl)).map(a => a.id);
    if (pendingIds.length === 0) return;

    const interval = setInterval(async () => {
      let anyResolved = false;
      await Promise.allSettled(
        pendingIds.map(async (id) => {
          try {
            const res = await pollJobFn({ data: { id } });
            if (res.status === "resolved" || res.status === "failed") {
              anyResolved = true;
            }
          } catch { /* ignore transient errors */ }
        }),
      );
      if (anyResolved) {
        qc.invalidateQueries({ queryKey: ["video-assets"] });
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [assets, pollJobFn, qc]);

  // Sync lastResult.videoUrl from the asset list once the poller resolves it.
  // The result panel shows the sentinel forever otherwise.
  useEffect(() => {
    if (!lastResult?.assetId) return;
    const resolved = assets.find(a => a.id === lastResult.assetId);
    if (!resolved) return;
    if (resolved.videoUrl && resolved.videoUrl !== lastResult.videoUrl) {
      setLastResult(prev => prev ? { ...prev, videoUrl: resolved.videoUrl } : prev);
      setResultPlayUrl(null); // reset lazy-load state for the new URL
    }
  }, [assets, lastResult?.assetId, lastResult?.videoUrl]);

  // Reset result panel play state when a new generation starts
  useEffect(() => {
    setResultPlayUrl(null);
    setResultPlayLoading(false);
  }, [lastResult?.assetId]);

  async function handleGenerate() {
    setStep("strategy");
    setError("");
    setLastResult(null);
    setCreativeScore(null);
    try {
      setStep("script");
      const res = await generateFn({ data: {
        videoType,
        qualityMode,
        targetAudience,
        offer,
        tone,
        cta,
        voiceId,
        campaignId,
        includeKb,
        generateVeoAudio: veoAudio,
      }});
      setStep("saving");
      setLastResult({
        assetId:        res.assetId,
        title:          res.title,
        script:         res.script,
        storyboard:     res.storyboard,
        audioUrl:       res.audioUrl,
        videoUrl:       res.videoUrl,
        costEstimate:   res.costEstimate,
        strategyBrief:  res.strategyBrief,
        valuePointUsed: res.valuePointUsed,
      });
      setStep("done");
      qc.invalidateQueries({ queryKey: ["video-assets"] });
      qc.invalidateQueries({ queryKey: ["video-cost-stats"] });
    } catch (e: any) {
      if (isStaleServerFnError(e)) { window.location.reload(); return; }
      setError(formatErrorMessage(e));
      setStep("error");
    }
  }

  async function handleGenerateFreeForm() {
    if (ffPrompt.trim().length < 5) {
      setError("Please enter a prompt of at least 5 characters.");
      setStep("error");
      return;
    }
    setStep("strategy");
    setError("");
    setLastResult(null);
    setCreativeScore(null);
    try {
      setStep("script");
      const res = await generateFreeFormFn({ data: {
        userPrompt:        ffPrompt,
        businessGoal:      ffGoal,
        targetAudience:    ffAudience,
        platform:          ffPlatform as any,
        videoLength:       ffLength,
        aspectRatio:       ffAspect as any,
        brandStyle:        ffBrandStyle,
        cta:               ffCta,
        voiceoverNeeded:   ffVoiceover,
        preferredProvider: ffProvider as any,
        voiceId,
        campaignId,
        includeKb,
        generateVeoAudio:  veoAudio,
      }});
      setStep("saving");
      setLastResult({
        assetId:         res.assetId,
        title:           res.title,
        script:          res.script,
        storyboard:      res.storyboard,
        audioUrl:        res.audioUrl,
        videoUrl:        res.videoUrl,
        costEstimate:    res.costEstimate,
        strategyBrief:   res.strategyBrief,
        marketingAngle:  res.marketingAngle,
        hook:            res.hook,
        optimisedPrompt: res.optimisedPrompt,
        qualityChecks:   res.qualityChecks,
        allChecksPassed: res.allChecksPassed,
      });
      setStep("done");
      qc.invalidateQueries({ queryKey: ["video-assets"] });
      qc.invalidateQueries({ queryKey: ["video-cost-stats"] });
    } catch (e: any) {
      if (isStaleServerFnError(e)) { window.location.reload(); return; }
      setError(formatErrorMessage(e));
      setStep("error");
    }
  }

  async function handleGenerateVariants() {
    if (variantCount === 1) {
      if (inputMode === "freeform") return handleGenerateFreeForm();
      return handleGenerate();
    }
    setStep("strategy");
    setError("");
    setLastResult(null);
    setCreativeScore(null);
    try {
      setStep("script");
      await generateVariantsFn({ data: {
        videoType:      inputMode === "guided" ? videoType : "meta_video_ad",
        qualityMode:    inputMode === "guided" ? qualityMode : "fast",
        targetAudience: inputMode === "guided" ? targetAudience : ffAudience,
        offer:          inputMode === "guided" ? offer : ffGoal,
        tone:           inputMode === "guided" ? tone : "professional",
        cta:            inputMode === "guided" ? cta : ffCta,
        voiceId,
        campaignId,
        count:          variantCount,
      }});
      setStep("done");
      qc.invalidateQueries({ queryKey: ["video-assets"] });
      qc.invalidateQueries({ queryKey: ["video-cost-stats"] });
    } catch (e: any) {
      if (isStaleServerFnError(e)) { window.location.reload(); return; }
      setError(formatErrorMessage(e));
      setStep("error");
    }
  }

  async function handleScoreAsset(assetId: string) {
    setScoringId(assetId);
    setCreativeScore(null);
    try {
      const res = await scoreFn({ data: { assetId } });
      setCreativeScore(res.score);
      qc.invalidateQueries({ queryKey: ["video-assets"] });
    } catch (e: any) {
      alert(`Scoring failed: ${e?.message ?? "Unknown error"}`);
    }
    setScoringId(null);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this video asset?")) return;
    try {
      await deleteAssetFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["video-assets"] });
    } catch {}
  }

  async function handleRetry(id: string) {
    try {
      await retryFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["video-assets"] });
    } catch (e: any) {
      alert(`Retry failed: ${e?.message ?? "Unknown error"}`);
    }
  }

  async function handleClearFailed() {
    const failedCount = assets.filter(a => isJobError(a.videoUrl) || a.videoUrl?.startsWith("gs://")).length;
    if (failedCount === 0) return;
    if (!confirm(`Delete ${failedCount} failed/unplayable video asset${failedCount !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setClearingFailed(true);
    try {
      await clearFailedFn();
      qc.invalidateQueries({ queryKey: ["video-assets"] });
    } catch (e: any) {
      alert(`Clear failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setClearingFailed(false);
    }
  }

  const generating = !["idle", "done", "error"].includes(step);

  return (
    <GrowthMindShell>
      <div className="flex h-full min-h-0">
        {/* Main content */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-6">

          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/20 border border-violet-500/30">
              <Clapperboard className="h-4.5 w-4.5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold">Video Studio</h1>
              <p className="text-xs text-muted-foreground">AI-powered video scripts, storyboards & voiceovers</p>
            </div>
          </div>

          {/* Veo not connected banner */}
          {veoStatus && !veoStatus.connected && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-300">Video provider not connected</p>
                <p className="text-[11px] text-amber-400/70 mt-0.5">
                  Add a <strong>Gemini API Key</strong> to generate videos with Google Veo 3.
                </p>
              </div>
              <a
                href="/settings/providers/video"
                className="shrink-0 text-[11px] font-semibold text-amber-300 hover:text-amber-200 border border-amber-500/40 hover:border-amber-400/60 rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap"
              >
                Connect Veo →
              </a>
            </div>
          )}

          {/* Campaign context banner */}
          {campaignName && (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.07] px-4 py-2.5 flex items-center gap-2.5">
              <Megaphone className="h-3.5 w-3.5 text-violet-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-violet-400/60 uppercase tracking-wider font-semibold">Campaign Context</p>
                <p className="text-xs font-semibold truncate text-violet-200">{campaignName}</p>
              </div>
              <button
                onClick={() => { setCampaignId(null); setCampaignName(""); }}
                className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                title="Clear campaign context"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Generator card */}
          <div className="rounded-2xl border border-white/[0.06] bg-card/60 p-5 space-y-5">

            {/* Mode tabs */}
            <div className="flex rounded-xl border border-white/[0.06] overflow-hidden p-0.5 bg-white/[0.02]">
              <button
                onClick={() => setInputMode("guided")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all",
                  inputMode === "guided"
                    ? "bg-violet-500/20 text-violet-300 border border-violet-500/25"
                    : "text-muted-foreground/60 hover:text-foreground",
                )}
              >
                <LayoutTemplate className="h-3.5 w-3.5" />
                Guided Builder
              </button>
              <button
                onClick={() => setInputMode("freeform")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all",
                  inputMode === "freeform"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/25"
                    : "text-muted-foreground/60 hover:text-foreground",
                )}
              >
                <PenLine className="h-3.5 w-3.5" />
                Free-Form Prompt
              </button>
            </div>

            {/* ── GUIDED BUILDER ─────────────────────────────────────────────── */}
            {inputMode === "guided" && (<>

              {/* Quality mode picker */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">Quality Mode</p>
                <div className="grid grid-cols-3 gap-2">
                  {QUALITY_MODES.map(m => {
                    const Icon = m.icon;
                    const active = qualityMode === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setQualityMode(m.id)}
                        className={cn(
                          "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all",
                          active
                            ? "border-violet-500/30 bg-violet-500/10"
                            : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10] hover:bg-white/[0.04]",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <Icon className={cn("h-3.5 w-3.5", active ? m.color : "text-muted-foreground/60")} />
                          <span className={cn("text-xs font-semibold", active ? "text-foreground" : "text-muted-foreground/70")}>{m.label}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/50 leading-tight">{m.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Voice picker — shown for balanced / premium modes */}
              {qualityMode !== "fast" && (
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold flex items-center gap-1.5">
                    <Mic className="h-3 w-3 text-sky-400" />
                    Voiceover Voice
                    {voiceName && (
                      <span className="ml-auto text-[10px] text-sky-400 font-medium normal-case tracking-normal">{voiceName}</span>
                    )}
                  </p>
                  {voices.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/60 italic">
                      Add an ElevenLabs API key in Settings → Integrations to unlock voice selection
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5 max-h-40 overflow-y-auto pr-1">
                      {voices.map(v => (
                        <button
                          key={v.id}
                          onClick={() => {
                            setVoiceId(v.id);
                            setVoiceName(v.name);
                            saveStoredVoice(v.id, v.name);
                          }}
                          className={cn(
                            "text-left px-2.5 py-1.5 rounded-lg border text-xs transition-all",
                            voiceId === v.id
                              ? "border-sky-500/40 bg-sky-500/15 text-sky-300"
                              : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground hover:border-white/[0.12]",
                          )}
                        >
                          <p className="font-medium truncate">{v.name}</p>
                          <p className="text-[10px] opacity-60 capitalize">{v.category}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Video type picker */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">Video Type</p>
                {VIDEO_TYPE_CATEGORIES.map(cat => (
                  <div key={cat.label} className="space-y-1.5">
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground/40 font-semibold px-0.5">{cat.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {cat.types.map(t => {
                        const active = videoType === t;
                        return (
                          <button
                            key={t}
                            onClick={() => setVideoType(t)}
                            className={cn(
                              "rounded-lg border px-2.5 py-1 text-xs font-medium transition-all",
                              active
                                ? "border-violet-500/30 bg-violet-500/15 text-violet-300"
                                : "border-white/[0.06] text-muted-foreground/70 hover:border-white/[0.12] hover:text-foreground",
                            )}
                          >
                            {VIDEO_TYPE_LABELS[t]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Brief fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Target Audience</Label>
                  <Input
                    value={targetAudience}
                    onChange={e => setTargetAudience(e.target.value)}
                    placeholder="e.g. small business owners"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Offer / Product</Label>
                  <Input
                    value={offer}
                    onChange={e => setOffer(e.target.value)}
                    placeholder="e.g. AI receptionist software"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Tone of Voice</Label>
                  <select
                    value={tone}
                    onChange={e => setTone(e.target.value)}
                    className="w-full h-8 rounded-md border border-input bg-transparent px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {TONE_OPTIONS.map(o => <option key={o} value={o.toLowerCase()}>{o}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Call to Action</Label>
                  <Input
                    value={cta}
                    onChange={e => setCta(e.target.value)}
                    placeholder="e.g. Book a free demo"
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* Variant count selector */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold flex items-center gap-1.5">
                  <Layers className="h-3 w-3 text-violet-400" />
                  Variants to Generate
                </p>
                <div className="flex gap-1.5">
                  {([1, 3, 5] as const).map(n => (
                    <button
                      key={n}
                      onClick={() => setVariantCount(n)}
                      className={cn(
                        "flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-all",
                        variantCount === n
                          ? "border-violet-500/30 bg-violet-500/15 text-violet-300"
                          : "border-white/[0.06] text-muted-foreground/60 hover:text-foreground",
                      )}
                    >
                      {n === 1 ? "1 video" : `${n} variants`}
                    </button>
                  ))}
                </div>
                {variantCount > 1 && (
                  <p className="text-[10px] text-muted-foreground/50">
                    Generates {variantCount} hook variants (emotional, curiosity, urgency…) for A/B testing
                  </p>
                )}
              </div>

              {/* KB toggle — Guided */}
              <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground/70">Use Knowledge Base</span>
                </div>
                <button
                  onClick={() => setIncludeKb(v => !v)}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
                    includeKb ? "bg-violet-600" : "bg-white/10",
                  )}
                >
                  <span className={cn(
                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200",
                    includeKb ? "translate-x-4" : "translate-x-0",
                  )} />
                </button>
              </div>

              {/* Veo Audio toggle — Guided */}
              {(() => {
                const audioSupported = !!veoStatus?.hasGeminiKey || !!veoStatus?.hasVertexCreds;
                return (
                  <div className={cn(
                    "flex items-center justify-between rounded-xl border px-3 py-2.5",
                    audioSupported
                      ? "border-white/[0.06] bg-white/[0.02]"
                      : "border-white/[0.03] bg-white/[0.01] opacity-60",
                  )}>
                    <div className="flex items-center gap-2">
                      <Volume2 className={cn("h-3.5 w-3.5", audioSupported ? "text-amber-400/70" : "text-muted-foreground/30")} />
                      <div>
                        <span className="text-xs text-muted-foreground/70">Veo Native Sound</span>
                        <p className="text-[10px] leading-tight text-muted-foreground/40">
                          {audioSupported
                            ? "AI-generated audio baked into video (Veo 3 — Gemini API or Vertex)"
                            : "Add a Gemini API key or Vertex AI credentials in Settings → Providers → Video"}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => audioSupported && setVeoAudio(v => !v)}
                      disabled={!audioSupported}
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
                        !audioSupported ? "cursor-not-allowed" : "cursor-pointer",
                        veoAudio && audioSupported ? "bg-amber-500" : "bg-white/10",
                      )}
                    >
                      <span className={cn(
                        "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200",
                        veoAudio && audioSupported ? "translate-x-4" : "translate-x-0",
                      )} />
                    </button>
                  </div>
                );
              })()}

              {/* Generate button — Guided */}
              <div className="flex items-center gap-3">
                <Button
                  onClick={variantCount > 1 ? handleGenerateVariants : handleGenerate}
                  disabled={generating}
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                >
                  {generating
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Sparkles className="mr-2 h-4 w-4" />}
                  {generating
                    ? "Generating…"
                    : variantCount > 1
                      ? `Generate ${variantCount} Variants`
                      : "Generate Video"}
                </Button>
                {generating && (
                  <StepIndicator step={step} currentStep={step} qualityMode={qualityMode} />
                )}
              </div>
            </>)}

            {/* ── FREE-FORM PROMPT MODE ─────────────────────────────────────── */}
            {inputMode === "freeform" && (<>

              {/* Creative Prompt */}
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold flex items-center gap-1.5">
                  <PenLine className="h-3 w-3 text-emerald-400" />
                  Creative Prompt
                </Label>
                <textarea
                  value={ffPrompt}
                  onChange={e => setFfPrompt(e.target.value)}
                  rows={4}
                  placeholder={
                    'e.g. Create a premium Meta video ad for our AI receptionist targeting estate agents in the UK. ' +
                    'Show missed calls turning into booked appointments. Cinematic, high trust, blue WeeBee branding, 20 seconds, strong CTA.'
                  }
                  className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 resize-none leading-relaxed"
                />
                <p className="text-[10px] text-muted-foreground/50">
                  GrowthMind will extract goals, audience, and platform — or fill the fields below for precision.
                </p>
              </div>

              {/* Row 1: Goal + Audience */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Business Goal</Label>
                  <Input
                    value={ffGoal}
                    onChange={e => setFfGoal(e.target.value)}
                    placeholder="e.g. Generate demo bookings"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Target Audience</Label>
                  <Input
                    value={ffAudience}
                    onChange={e => setFfAudience(e.target.value)}
                    placeholder="e.g. Estate agents in the UK"
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* Row 2: Platform + Length */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Platform</Label>
                  <select
                    value={ffPlatform}
                    onChange={e => setFfPlatform(e.target.value)}
                    className="w-full h-8 rounded-md border border-input bg-transparent px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Video Length</Label>
                  <select
                    value={ffLength}
                    onChange={e => setFfLength(Number(e.target.value))}
                    className="w-full h-8 rounded-md border border-input bg-transparent px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {LENGTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Row 3: Aspect Ratio + CTA */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Aspect Ratio</Label>
                  <select
                    value={ffAspect}
                    onChange={e => setFfAspect(e.target.value)}
                    className="w-full h-8 rounded-md border border-input bg-transparent px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {ASPECT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Call to Action</Label>
                  <Input
                    value={ffCta}
                    onChange={e => setFfCta(e.target.value)}
                    placeholder="e.g. Book your free demo"
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* Brand Style */}
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Brand Style</Label>
                <Input
                  value={ffBrandStyle}
                  onChange={e => setFfBrandStyle(e.target.value)}
                  placeholder="e.g. Blue WeeBee branding, cinematic, high-trust, professional"
                  className="h-8 text-xs"
                />
              </div>

              {/* Voiceover + Provider */}
              <div className="grid grid-cols-2 gap-3 items-start">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Voiceover</Label>
                  <button
                    onClick={() => setFfVoiceover(v => !v)}
                    className={cn(
                      "flex items-center gap-2 h-8 px-3 rounded-md border text-xs font-medium transition-all w-full",
                      ffVoiceover
                        ? "border-sky-500/40 bg-sky-500/15 text-sky-300"
                        : "border-white/[0.06] text-muted-foreground/60 hover:text-foreground",
                    )}
                  >
                    <div className={cn(
                      "h-3 w-3 rounded-full border-2 flex items-center justify-center transition-all",
                      ffVoiceover ? "border-sky-400 bg-sky-400" : "border-muted-foreground/40",
                    )}>
                      {ffVoiceover && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </div>
                    {ffVoiceover ? "Voiceover on" : "Voiceover off"}
                  </button>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">AI Video Provider</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FREEFORM_PROVIDERS.map(p => {
                      const disabled = p.note === "Coming soon";
                      const active = ffProvider === p.value;
                      return (
                        <button
                          key={p.value}
                          onClick={() => !disabled && setFfProvider(p.value)}
                          disabled={disabled}
                          className={cn(
                            "flex flex-col items-start px-2.5 py-1.5 rounded-lg border text-left transition-all",
                            disabled ? "opacity-35 cursor-not-allowed border-white/[0.04]"
                            : active
                              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                              : "border-white/[0.06] text-muted-foreground/60 hover:text-foreground hover:border-white/[0.12]",
                          )}
                        >
                          <span className="text-[10px] font-semibold leading-tight">{p.label}</span>
                          <span className="text-[9px] opacity-60">{p.note}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Voice selector (if voiceover on) */}
              {ffVoiceover && voices.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold flex items-center gap-1.5">
                    <Mic className="h-3 w-3 text-sky-400" />
                    Voice
                    {voiceName && <span className="ml-auto text-sky-400 font-medium normal-case tracking-normal">{voiceName}</span>}
                  </p>
                  <div className="grid grid-cols-3 gap-1.5 max-h-28 overflow-y-auto pr-1">
                    {voices.map(v => (
                      <button
                        key={v.id}
                        onClick={() => { setVoiceId(v.id); setVoiceName(v.name); saveStoredVoice(v.id, v.name); }}
                        className={cn(
                          "text-left px-2.5 py-1.5 rounded-lg border text-xs transition-all",
                          voiceId === v.id
                            ? "border-sky-500/40 bg-sky-500/15 text-sky-300"
                            : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground hover:border-white/[0.12]",
                        )}
                      >
                        <p className="font-medium truncate">{v.name}</p>
                        <p className="text-[10px] opacity-60 capitalize">{v.category}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Variant count selector — freeform */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold flex items-center gap-1.5">
                  <Layers className="h-3 w-3 text-emerald-400" />
                  Variants to Generate
                </p>
                <div className="flex gap-1.5">
                  {([1, 3, 5] as const).map(n => (
                    <button
                      key={n}
                      onClick={() => setVariantCount(n)}
                      className={cn(
                        "flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-all",
                        variantCount === n
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                          : "border-white/[0.06] text-muted-foreground/60 hover:text-foreground",
                      )}
                    >
                      {n === 1 ? "1 video" : `${n} variants`}
                    </button>
                  ))}
                </div>
              </div>

              {/* KB toggle — Free-Form */}
              <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground/70">Use Knowledge Base</span>
                </div>
                <button
                  onClick={() => setIncludeKb(v => !v)}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
                    includeKb ? "bg-emerald-600" : "bg-white/10",
                  )}
                >
                  <span className={cn(
                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200",
                    includeKb ? "translate-x-4" : "translate-x-0",
                  )} />
                </button>
              </div>

              {/* Veo Audio toggle — Free-Form */}
              {(() => {
                const audioSupported = !!veoStatus?.hasGeminiKey || !!veoStatus?.hasVertexCreds;
                return (
                  <div className={cn(
                    "flex items-center justify-between rounded-xl border px-3 py-2.5",
                    audioSupported
                      ? "border-white/[0.06] bg-white/[0.02]"
                      : "border-white/[0.03] bg-white/[0.01] opacity-60",
                  )}>
                    <div className="flex items-center gap-2">
                      <Volume2 className={cn("h-3.5 w-3.5", audioSupported ? "text-amber-400/70" : "text-muted-foreground/30")} />
                      <div>
                        <span className="text-xs text-muted-foreground/70">Veo Native Sound</span>
                        <p className="text-[10px] leading-tight text-muted-foreground/40">
                          {audioSupported
                            ? "AI-generated audio baked into video (Veo 3 — Gemini API or Vertex)"
                            : "Add a Gemini API key or Vertex AI credentials in Settings → Providers → Video"}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => audioSupported && setVeoAudio(v => !v)}
                      disabled={!audioSupported}
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
                        !audioSupported ? "cursor-not-allowed" : "cursor-pointer",
                        veoAudio && audioSupported ? "bg-amber-500" : "bg-white/10",
                      )}
                    >
                      <span className={cn(
                        "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200",
                        veoAudio && audioSupported ? "translate-x-4" : "translate-x-0",
                      )} />
                    </button>
                  </div>
                );
              })()}

              {/* Generate button — Free-Form */}
              <div className="flex items-center gap-3">
                <Button
                  onClick={variantCount > 1 ? handleGenerateVariants : handleGenerateFreeForm}
                  disabled={generating || !ffPrompt.trim()}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {generating
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Sparkles className="mr-2 h-4 w-4" />}
                  {generating
                    ? "Optimising & Generating…"
                    : variantCount > 1
                      ? `Generate ${variantCount} Variants`
                      : "Generate Ad Pipeline"}
                </Button>
                {generating && (
                  <StepIndicator step={step} currentStep={step} qualityMode="premium" />
                )}
              </div>
            </>)}

            {/* Error — shared */}
            {step === "error" && error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3">
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-400">Generation failed</p>
                  <p className="text-xs text-red-400/80 mt-0.5">{formatDisplayError(error)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Result preview */}
          {lastResult && step === "done" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm font-semibold">Generated: {lastResult.title}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-muted-foreground/60">Est. cost: {formatCost(lastResult.costEstimate)}</span>
                  <span className="rounded-full bg-emerald-500/15 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                    Saved ✓
                  </span>
                  <button
                    onClick={() => handleScoreAsset(lastResult.assetId)}
                    disabled={!!scoringId}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 px-2.5 py-1 text-[11px] font-medium text-violet-400 hover:bg-violet-500/15 transition-colors disabled:opacity-50"
                  >
                    {scoringId ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <BarChart3 className="h-2.5 w-2.5" />}
                    Score Creative
                  </button>
                </div>
              </div>

              {/* Free-form only: marketing angle + hook */}
              {lastResult.marketingAngle && (
                <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] p-4 space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-400/70 font-semibold flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" />Marketing Angle
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{lastResult.marketingAngle}</p>
                  {lastResult.hook && (
                    <>
                      <p className="text-[10px] uppercase tracking-wider text-emerald-400/70 font-semibold mt-1">Hook (first 3s)</p>
                      <p className="text-xs font-medium text-emerald-300/90 leading-relaxed">"{lastResult.hook}"</p>
                    </>
                  )}
                </div>
              )}

              {/* Quality checks (free-form mode) */}
              {lastResult.qualityChecks && lastResult.qualityChecks.length > 0 && (
                <div className="rounded-xl border border-white/[0.06] bg-card/40 p-4 space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold flex items-center gap-1.5">
                    <ShieldCheck className="h-3 w-3 text-violet-400" />
                    Ad Quality Checks
                    {lastResult.allChecksPassed
                      ? <span className="ml-auto text-emerald-400 font-medium">All passed ✓</span>
                      : <span className="ml-auto text-amber-400 font-medium">{lastResult.qualityChecks.filter(c => !c.passed).length} auto-fixed</span>
                    }
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {lastResult.qualityChecks.map((c, i) => (
                      <div key={i} className={cn(
                        "flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-[10px]",
                        c.passed ? "bg-emerald-500/[0.06] text-emerald-400/80" : "bg-amber-500/[0.06] text-amber-400/80",
                      )}>
                        {c.passed
                          ? <Check className="h-2.5 w-2.5 shrink-0 mt-0.5" />
                          : <XCircle className="h-2.5 w-2.5 shrink-0 mt-0.5" />
                        }
                        <span className="leading-tight">{c.rule}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Optimised Veo prompt */}
              {lastResult.optimisedPrompt && (
                <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.04] p-4 space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-violet-400/70 font-semibold">Optimised Veo Prompt</p>
                  <p className="text-[11px] text-muted-foreground/80 leading-relaxed font-mono break-words">
                    {lastResult.optimisedPrompt}
                  </p>
                </div>
              )}

              {lastResult.strategyBrief && !lastResult.marketingAngle && (
                <div className="rounded-xl border border-sky-500/15 bg-sky-500/[0.04] p-4">
                  <p className="text-[10px] uppercase tracking-wider text-sky-400/70 mb-1.5 font-semibold">Strategy Brief</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{lastResult.strategyBrief}</p>
                </div>
              )}

              {/* Value point used */}
              {lastResult.valuePointUsed && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 flex items-start gap-2.5">
                  <Target className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-amber-400/70 font-semibold mb-0.5">Value Point Injected</p>
                    <p className="text-[11px] text-muted-foreground/80 leading-relaxed">{lastResult.valuePointUsed}</p>
                  </div>
                </div>
              )}

              {/* Creative score panel */}
              {creativeScore && (
                <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.04] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-wider text-violet-400/70 font-semibold flex items-center gap-1.5">
                      <BarChart3 className="h-3 w-3" />Creative Score
                    </p>
                    <span className={cn(
                      "text-sm font-bold tabular-nums",
                      creativeScore.overall >= 8 ? "text-emerald-400"
                      : creativeScore.overall >= 6 ? "text-amber-400"
                      : "text-red-400",
                    )}>
                      {creativeScore.overall}/10
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      { label: "Hook",     value: creativeScore.hook },
                      { label: "Clarity",  value: creativeScore.clarity },
                      { label: "Emotion",  value: creativeScore.emotion },
                      { label: "CTA",      value: creativeScore.cta },
                      { label: "Brand",    value: creativeScore.brand },
                      { label: "Platform", value: creativeScore.platform },
                    ] as const).map(d => (
                      <div key={d.label} className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2 text-center">
                        <p className={cn(
                          "text-sm font-bold tabular-nums",
                          (d.value as number) >= 8 ? "text-emerald-400" : (d.value as number) >= 6 ? "text-amber-400" : "text-red-400",
                        )}>{d.value}</p>
                        <p className="text-[9px] text-muted-foreground/60 mt-0.5">{d.label}</p>
                      </div>
                    ))}
                  </div>
                  {creativeScore.verdict && (
                    <p className="text-[11px] text-muted-foreground/80 italic">{creativeScore.verdict}</p>
                  )}
                  {creativeScore.improvements.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold">Improvements</p>
                      {creativeScore.improvements.map((imp, i) => (
                        <p key={i} className="text-[11px] text-muted-foreground/70 flex items-start gap-1.5">
                          <span className="text-violet-400/60 shrink-0">→</span>{imp}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {lastResult.audioUrl && (
                <div className="rounded-xl border border-sky-500/15 bg-sky-500/[0.04] p-4 space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-sky-400/70 font-semibold flex items-center gap-1.5">
                    <Volume2 className="h-3 w-3" />ElevenLabs Voiceover
                  </p>
                  <audio controls src={lastResult.audioUrl} className="w-full h-9" />
                </div>
              )}

              {lastResult.videoUrl && (() => {
                const vUrl = lastResult.videoUrl;
                const isPending = isJobPending(vUrl);
                const isError   = isJobError(vUrl);
                const isReady   = isRealVideoUrl(vUrl);
                const jobInfo   = isPending ? parseJobSentinel(vUrl) : null;
                return (
                  <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.04] p-4 space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-violet-400/70 font-semibold flex items-center gap-1.5">
                      <Film className="h-3 w-3" />AI Video
                    </p>
                    {isPending && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs text-amber-400">
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                            {jobInfo?.type === "runway" ? "Runway Gen-4" : "Veo 3"} job submitted — rendering in background…
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground/50">
                          Typically 2–5 min · check the Asset Library below — it auto-polls every 10s
                        </p>
                      </div>
                    )}
                    {isError && (
                      <p className="text-xs text-red-400">{parseErrorMessage(vUrl)}</p>
                    )}
                    {isReady && vUrl === "__data_uri__" && (
                      resultPlayUrl ? (
                        <video controls src={resultPlayUrl} className="w-full max-h-48 rounded-lg bg-black" preload="metadata" />
                      ) : (
                        <div className="flex items-center gap-2.5 rounded-lg border border-violet-500/15 bg-violet-500/[0.06] px-3 py-2.5">
                          <Play className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-semibold text-violet-400">Video ready — click to load</p>
                            <p className="text-[10px] text-muted-foreground/50">Stored as inline data · loads from database</p>
                          </div>
                          <button
                            disabled={resultPlayLoading}
                            onClick={async () => {
                              if (!lastResult?.assetId) return;
                              setResultPlayLoading(true);
                              try {
                                const res = await getDownloadResultFn({ data: { id: lastResult.assetId } });
                                if (res.downloadUrl) setResultPlayUrl(res.downloadUrl);
                              } catch { /* ignore */ }
                              setResultPlayLoading(false);
                            }}
                            className="shrink-0 flex items-center gap-1.5 rounded-lg bg-violet-500/15 border border-violet-500/25 px-2.5 py-1.5 text-[10px] font-semibold text-violet-300 hover:bg-violet-500/25 transition-colors disabled:opacity-50"
                          >
                            {resultPlayLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                            {resultPlayLoading ? "Loading…" : "Play"}
                          </button>
                        </div>
                      )
                    )}
                    {isReady && !vUrl.startsWith("gs://") && vUrl !== "__data_uri__" && (
                      <video controls src={vUrl} className="w-full max-h-48 rounded-lg bg-black" preload="metadata" />
                    )}
                    {isReady && vUrl.startsWith("gs://") && (
                      <p className="text-xs text-muted-foreground break-all">{vUrl}</p>
                    )}
                  </div>
                );
              })()}

              <div>
                <p className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Tv2 className="h-4 w-4 text-violet-400" />
                  Storyboard ({lastResult.storyboard.length} scenes)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {lastResult.storyboard.map(scene => (
                    <SceneCard key={scene.scene} scene={scene} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Asset library */}
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Film className="h-4 w-4 text-violet-400" />
                  Asset Library
                  {assets.length > 0 && (
                    <span className="rounded-full bg-violet-500/15 border border-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-400">
                      {assets.length}
                    </span>
                  )}
                </p>
                {assets.some(a => isJobError(a.videoUrl) || a.videoUrl?.startsWith("gs://")) && (
                  <button
                    onClick={handleClearFailed}
                    disabled={clearingFailed}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-2 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    {clearingFailed
                      ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      : <Trash2 className="h-2.5 w-2.5" />}
                    {clearingFailed ? "Clearing…" : "Clear all failed"}
                  </button>
                )}
              </div>

              {/* Filter pills */}
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={() => setFilterType("all")}
                  className={cn("rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all",
                    filterType === "all"
                      ? "border-violet-500/30 bg-violet-500/15 text-violet-300"
                      : "border-white/[0.06] text-muted-foreground/60 hover:text-foreground",
                  )}
                >
                  All
                </button>
                {VIDEO_TYPE_CATEGORIES.flatMap(c => c.types).filter(t => assets.some(a => a.videoType === t)).map(t => (
                  <button
                    key={t}
                    onClick={() => setFilterType(t)}
                    className={cn("rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all",
                      filterType === t
                        ? "border-violet-500/30 bg-violet-500/15 text-violet-300"
                        : "border-white/[0.06] text-muted-foreground/60 hover:text-foreground",
                    )}
                  >
                    {VIDEO_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            {displayedAssets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 border border-violet-500/20 mb-4">
                  <Clapperboard className="h-6 w-6 text-violet-400/60" />
                </div>
                <p className="text-sm font-medium text-muted-foreground/70">No video assets yet</p>
                <p className="text-xs text-muted-foreground/40 mt-1">Generate your first video above</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {displayedAssets.map(asset => (
                  <VideoAssetCard
                    key={asset.id}
                    asset={asset}
                    onDelete={handleDelete}
                    onSchedule={a => setScheduleAsset(a)}
                    onRetry={handleRetry}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar — cost panel */}
        <aside className="hidden xl:flex w-64 shrink-0 flex-col border-l border-white/[0.06] p-4 gap-4 overflow-y-auto">
          <VideoCostPanel />

          {/* ── Poller health chip ── */}
          {(() => {
            const pendingCount    = assets.filter(a => isJobPending(a.videoUrl)).length;
            const compositeCount  = assets.filter(a => isCompositePending(a.videoUrl) || (a.isComposite && a.assemblyStatus && !["complete", "failed"].includes(a.assemblyStatus))).length;
            const failedCount     = assets.filter(a => isJobError(a.videoUrl)).length;
            const anyActive       = pendingCount > 0 || compositeCount > 0;
            return (
              <div className="rounded-xl border border-white/[0.06] bg-card/60 p-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                  <Radio className="h-3 w-3" />
                  Poller Status
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {pendingCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/25 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      {pendingCount} rendering
                    </span>
                  )}
                  {compositeCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 border border-violet-500/25 px-2 py-0.5 text-[10px] font-semibold text-violet-400">
                      <Layers className="h-2.5 w-2.5" />
                      {compositeCount} compositing
                    </span>
                  )}
                  {!anyActive && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      All done
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/25 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                      <XCircle className="h-2.5 w-2.5" />
                      {failedCount} failed
                    </span>
                  )}
                </div>
                {anyActive && (
                  <p className="text-[10px] text-muted-foreground/50">Auto-polls every 10s</p>
                )}
              </div>
            );
          })()}

          <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4 space-y-2.5">
            <p className="text-xs font-semibold flex items-center gap-2">
              <Radio className="h-3.5 w-3.5 text-violet-400" />
              Provider Routing
            </p>
            <div className="space-y-2">
              <div className="text-[11px] text-muted-foreground/70 space-y-1">
                <p><span className="text-violet-300 font-medium">Veo 3</span> — Meta, LinkedIn, TikTok, Explainer, Product Demo, YouTube</p>
                <p><span className="text-sky-300 font-medium">Runway Gen-4</span> — UGC & Testimonial</p>
              </div>
              <div className="border-t border-white/[0.06] pt-2 text-[10px] text-muted-foreground/50 space-y-0.5">
                <p>Kling / Pika — coming soon</p>
                <p>Premium mode required for video generation</p>
              </div>
            </div>
          </div>

          {/* ── AI CMO Pipeline Status ── */}
          {(campaignName || assets.some(a => a.campaignId)) && (
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] p-3 space-y-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/70 flex items-center gap-1.5">
                <Megaphone className="h-3 w-3" />
                CMO Pipeline
              </p>
              {campaignName && (
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <p className="text-[11px] text-foreground/80 truncate">{campaignName}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-2">
                  <p className="text-[10px] text-muted-foreground/60">Linked</p>
                  <p className="text-sm font-bold tabular-nums text-emerald-400">
                    {assets.filter(a => a.campaignId).length}
                  </p>
                </div>
                <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-2">
                  <p className="text-[10px] text-muted-foreground/60">Variants</p>
                  <p className="text-sm font-bold tabular-nums text-violet-400">
                    {assets.filter(a => a.variantGroupId).length}
                  </p>
                </div>
              </div>
              {assets.some(a => a.creativeScore !== null && a.creativeScore !== undefined) && (
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-muted-foreground/60">Avg Creative Score</p>
                  <p className="text-[11px] font-semibold text-amber-400">
                    {(assets.filter(a => a.creativeScore != null).reduce((s, a) => s + (a.creativeScore ?? 0), 0) /
                      assets.filter(a => a.creativeScore != null).length).toFixed(1)}/10
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-4 space-y-1.5">
            <p className="text-[10px] font-semibold text-amber-400/80 flex items-center gap-1.5">
              <BarChart3 className="h-3 w-3" />API Keys Required
            </p>
            <div className="text-[10px] text-muted-foreground/60 leading-relaxed space-y-1">
              <p><span className="text-amber-300/80 font-medium">Veo 3 (recommended):</span> Add <code className="text-amber-300/70">GEMINI_API_KEY</code> in Settings → Providers → Video → Google Veo 3.</p>
              <p><span className="text-amber-300/80 font-medium">Veo 3 (legacy):</span> <code className="text-amber-300/70">GCP Project ID</code> + <code className="text-amber-300/70">OAuth Access Token</code>.</p>
              <p><span className="text-amber-300/80 font-medium">Runway:</span> <code className="text-amber-300/70">RUNWAY_API_KEY</code>. Voiceover: <code className="text-amber-300/70">ELEVENLABS_API_KEY</code>.</p>
            </div>
          </div>
        </aside>
      </div>

      {/* Schedule modal */}
      {scheduleAsset && (
        <ScheduleModal
          asset={scheduleAsset}
          onClose={() => setScheduleAsset(null)}
          onScheduled={() => {
            qc.invalidateQueries({ queryKey: ["video-assets"] });
            setScheduleAsset(null);
          }}
        />
      )}
    </GrowthMindShell>
  );
}
