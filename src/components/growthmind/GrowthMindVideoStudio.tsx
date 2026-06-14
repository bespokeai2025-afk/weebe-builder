import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Clapperboard, Loader2, Play, Trash2, CalendarDays, X,
  Sparkles, CheckCircle2, Circle, DollarSign, Volume2,
  Film, Zap, Star, Clock, ChevronDown, ChevronUp,
  BarChart3, AlertCircle, Music2, Tv2, Radio, RefreshCw,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  generateVideo, getVideoAssets, deleteVideoAsset, scheduleVideoAsset, getVideoCostStats,
  retryVideoJob,
  VIDEO_TYPE_LABELS, VIDEO_TYPE_CATEGORIES,
  type VideoType, type QualityMode, type VideoAsset, type StoryboardScene,
} from "@/lib/growthmind/growthmind.video-studio";
import {
  isJobPending, isJobError, parseErrorMessage, isRealVideoUrl, parseJobSentinel,
} from "@/lib/growthmind/video-job-poller";

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

function VideoAssetCard({ asset, onDelete, onSchedule, onRetry }: {
  asset:      VideoAsset;
  onDelete:   (id: string) => void;
  onSchedule: (asset: VideoAsset) => void;
  onRetry:    (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const label  = VIDEO_TYPE_LABELS[asset.videoType] ?? asset.videoType;
  const qMode  = QUALITY_MODES.find(q => q.id === asset.qualityMode) ?? QUALITY_MODES[0];
  const QIcon  = qMode.icon;

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
        {asset.audioUrl && (
          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border bg-sky-500/10 border-sky-500/20 text-sky-400">
            <Volume2 className="h-2.5 w-2.5" />Voice
          </span>
        )}
        {jobPending && (
          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border bg-amber-500/10 border-amber-500/20 text-amber-400 animate-pulse">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            {jobInfo?.type === "runway" ? "Runway" : "Veo 3"} processing…
          </span>
        )}
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

      {asset.audioUrl && asset.audioUrl.startsWith("data:") && (
        <audio controls src={asset.audioUrl} className="w-full h-8 opacity-80" />
      )}

      {/* Video states */}
      {jobPending && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2.5">
          <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-amber-400">
              {jobInfo?.type === "runway" ? "Runway Gen-4" : "Veo 3"} rendering…
            </p>
            <p className="text-[10px] text-muted-foreground/60 truncate">
              Job: {jobInfo?.jobId?.slice(0, 40)}{(jobInfo?.jobId?.length ?? 0) > 40 ? "…" : ""}
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

      {videoReady && !isGcsUri && (
        <div className="rounded-lg overflow-hidden border border-white/[0.06]">
          <video
            controls
            src={asset.videoUrl!}
            className="w-full max-h-48 bg-black"
            preload="metadata"
          />
        </div>
      )}

      {videoReady && isGcsUri && (
        <div className="flex items-center gap-2.5 rounded-lg border border-violet-500/15 bg-violet-500/[0.04] px-3 py-2.5">
          <ExternalLink className="h-3.5 w-3.5 text-violet-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-violet-400">Video ready (Google Cloud Storage)</p>
            <p className="text-[10px] text-muted-foreground/60 truncate" title={asset.videoUrl!}>
              {asset.videoUrl}
            </p>
          </div>
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

export function GrowthMindVideoStudio() {
  const qc = useQueryClient();

  const generateFn   = useServerFn(generateVideo);
  const getAssetsFn  = useServerFn(getVideoAssets);
  const deleteAssetFn = useServerFn(deleteVideoAsset);
  const retryFn      = useServerFn(retryVideoJob);

  const [videoType, setVideoType]     = useState<VideoType>("explainer_video");
  const [qualityMode, setQualityMode] = useState<QualityMode>("fast");
  const [targetAudience, setTargetAudience] = useState("");
  const [offer, setOffer]             = useState("");
  const [tone, setTone]               = useState("professional");
  const [cta, setCta]                 = useState("");

  const [step, setStep]   = useState<GenerationStep>("idle");
  const [error, setError] = useState("");

  const [lastResult, setLastResult] = useState<{
    title:         string;
    script:        string;
    storyboard:    StoryboardScene[];
    audioUrl:      string | null;
    videoUrl:      string | null;
    costEstimate:  number;
    strategyBrief: string;
  } | null>(null);

  const [filterType, setFilterType]       = useState<VideoType | "all">("all");
  const [scheduleAsset, setScheduleAsset] = useState<VideoAsset | null>(null);

  const { data: assetsData } = useQuery({
    queryKey: ["video-assets", filterType],
    queryFn:  () => getAssetsFn({ videoType: filterType === "all" ? undefined : filterType }),
    refetchInterval: 15000,
  });

  const assets = assetsData?.assets ?? [];

  const displayedAssets = assets;

  async function handleGenerate() {
    setStep("strategy");
    setError("");
    setLastResult(null);
    try {
      setStep("script");
      const res = await generateFn({ data: {
        videoType,
        qualityMode,
        targetAudience,
        offer,
        tone,
        cta,
        voiceId: "21m00Tcm4TlvDq8ikWAM",
      }});
      setStep("saving");
      setLastResult({
        title:         res.title,
        script:        res.script,
        storyboard:    res.storyboard,
        audioUrl:      res.audioUrl,
        videoUrl:      res.videoUrl,
        costEstimate:  res.costEstimate,
        strategyBrief: res.strategyBrief,
      });
      setStep("done");
      qc.invalidateQueries({ queryKey: ["video-assets"] });
      qc.invalidateQueries({ queryKey: ["video-cost-stats"] });
    } catch (e: any) {
      setError(e.message ?? "Generation failed");
      setStep("error");
    }
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

          {/* Generator card */}
          <div className="rounded-2xl border border-white/[0.06] bg-card/60 p-5 space-y-5">

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

            {/* Generate button */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleGenerate}
                disabled={generating}
                className="bg-violet-600 hover:bg-violet-700 text-white"
              >
                {generating
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Sparkles className="mr-2 h-4 w-4" />}
                {generating ? "Generating…" : "Generate Video"}
              </Button>

              {generating && (
                <StepIndicator step={step} currentStep={step} qualityMode={qualityMode} />
              )}
            </div>

            {/* Error */}
            {step === "error" && error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3">
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-400">Generation failed</p>
                  <p className="text-xs text-red-400/80 mt-0.5">{error}</p>
                </div>
              </div>
            )}
          </div>

          {/* Result preview */}
          {lastResult && step === "done" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Generated: {lastResult.title}</p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/60">Est. cost: {formatCost(lastResult.costEstimate)}</span>
                  <span className="rounded-full bg-emerald-500/15 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                    Saved ✓
                  </span>
                </div>
              </div>

              {lastResult.strategyBrief && (
                <div className="rounded-xl border border-sky-500/15 bg-sky-500/[0.04] p-4">
                  <p className="text-[10px] uppercase tracking-wider text-sky-400/70 mb-1.5 font-semibold">Strategy Brief</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{lastResult.strategyBrief}</p>
                </div>
              )}

              {lastResult.audioUrl && lastResult.audioUrl.startsWith("data:") && (
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
                      <div className="flex items-center gap-2 text-xs text-amber-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                        {jobInfo?.type === "runway" ? "Runway Gen-4" : "Veo 3"} job submitted — rendering in background…
                      </div>
                    )}
                    {isError && (
                      <p className="text-xs text-red-400">{parseErrorMessage(vUrl)}</p>
                    )}
                    {isReady && !vUrl.startsWith("gs://") && (
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
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Film className="h-4 w-4 text-violet-400" />
                Asset Library
                {assets.length > 0 && (
                  <span className="rounded-full bg-violet-500/15 border border-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-400">
                    {assets.length}
                  </span>
                )}
              </p>

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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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

          <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-4 space-y-1.5">
            <p className="text-[10px] font-semibold text-amber-400/80 flex items-center gap-1.5">
              <BarChart3 className="h-3 w-3" />API Keys Required
            </p>
            <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
              Premium video needs <code className="text-amber-300/70">GOOGLE_CLOUD_PROJECT</code> + <code className="text-amber-300/70">GOOGLE_CLOUD_ACCESS_TOKEN</code> (Veo 3) or <code className="text-amber-300/70">RUNWAY_API_KEY</code>. Voiceover needs <code className="text-amber-300/70">ELEVENLABS_API_KEY</code>.
            </p>
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
