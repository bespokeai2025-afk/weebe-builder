import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Sparkles, Clapperboard, Loader2, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, Ban, Wand2, Volume2, VolumeX, Film, BadgeDollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  planVideoPipelineJob, adjustVideoPipelinePrompt, approveAndRenderVideoJob,
  retryVideoPipelineJob, cancelVideoPipelineJob, listVideoPipelineJobs,
  pollVideoPipelineJob, type VideoPipelineJob,
} from "@/lib/growthmind/video-pipeline.server";
import {
  validateVeoOptions, estimateVeoRenderCostUsd, VEO31_MODELS, VEO31_DURATIONS,
  VEO31_4K_LIMITATION, type VideoQualityTier, type VideoAspect, type VideoResolution,
  type VideoGenerationType,
} from "@/lib/growthmind/veo31-capabilities.shared";

const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

export function VideoPipelinePanel({ campaignId }: { campaignId?: string | null }) {
  const qc = useQueryClient();
  const planFn    = useServerFn(planVideoPipelineJob);
  const adjustFn  = useServerFn(adjustVideoPipelinePrompt);
  const approveFn = useServerFn(approveAndRenderVideoJob);
  const retryFn   = useServerFn(retryVideoPipelineJob);
  const cancelFn  = useServerFn(cancelVideoPipelineJob);
  const listFn    = useServerFn(listVideoPipelineJobs);
  const pollFn    = useServerFn(pollVideoPipelineJob);

  // ── Brief + options state ──────────────────────────────────────────────────
  const [brief, setBrief]         = useState("");
  const [objective, setObjective] = useState("");
  const [platform, setPlatform]   = useState("Meta");
  const [cta, setCta]             = useState("");
  const [tier, setTier]           = useState<VideoQualityTier>("premium");
  const [genType, setGenType]     = useState<VideoGenerationType>("text_to_video");
  const [aspect, setAspect]       = useState<VideoAspect>("16:9");
  const [resolution, setResolution] = useState<VideoResolution>("720p");
  const [duration, setDuration]   = useState<number>(8);
  const [audio, setAudio]         = useState(true);
  const [variations, setVariations] = useState(1);
  const [refImageUrl, setRefImageUrl] = useState("");
  const [busy, setBusy]           = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [adjustNotes, setAdjustNotes] = useState<Record<string, string>>({});

  const options = {
    qualityTier: tier, generationType: genType, aspectRatio: aspect,
    resolution, durationSeconds: duration, generateAudio: audio, variations,
  };
  const issues = useMemo(() => validateVeoOptions(options), [tier, genType, aspect, resolution, duration, audio, variations]);
  const estimate = useMemo(() => estimateVeoRenderCostUsd(options), [tier, duration, variations, resolution]);

  // ── Jobs list (auto-refresh while anything is rendering) ─────────────────────
  const { data: jobs = [] } = useQuery({
    queryKey: ["gm-video-pipeline-jobs"],
    queryFn: () => listFn(),
    refetchInterval: (q) => {
      const list = (q.state.data ?? []) as VideoPipelineJob[];
      return list.some(j => ["rendering", "archiving", "submitting"].includes(j.status)) ? 15000 : false;
    },
    throwOnError: false,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["gm-video-pipeline-jobs"] });

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); refresh(); }
    catch (e: any) { setError(e?.message ?? "Something went wrong."); }
    finally { setBusy(null); }
  };

  const handlePlan = () => run("plan", async () => {
    const res: any = await planFn({ data: {
      brief, objective, platform, cta, campaignId: campaignId ?? null,
      options: { ...options, referenceImageUrl: refImageUrl || null, lastFrameImageUrl: genType === "frame_guidance" ? refImageUrl || null : null },
    }});
    if (res && res.ok === false) {
      setError(res.issues?.map((i: any) => i.message).join(" ") || "Those settings aren't supported.");
    } else {
      setBrief("");
    }
  });

  const selectBtn = (active: boolean) => cn(
    "rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all",
    active ? "border-violet-500/40 bg-violet-500/15 text-violet-200" : "border-white/[0.06] text-muted-foreground/60 hover:text-foreground",
  );

  return (
    <div className="space-y-5">
      {/* ── Brief ── */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">What should this video be about?</Label>
          <Textarea value={brief} onChange={e => setBrief(e.target.value)} rows={3}
            placeholder="e.g. A 8-second ad showing how our AI receptionist answers every missed call, ending with 'Never miss a lead again'…" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input value={objective} onChange={e => setObjective(e.target.value)} placeholder="Objective (e.g. book demos)" className="text-xs" />
          <Input value={platform} onChange={e => setPlatform(e.target.value)} placeholder="Platform (Meta, TikTok…)" className="text-xs" />
          <Input value={cta} onChange={e => setCta(e.target.value)} placeholder="Call to action" className="text-xs" />
        </div>
      </div>

      {/* ── Render options ── */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold w-20">Quality</span>
          {(["premium", "draft"] as const).map(t => (
            <button key={t} onClick={() => { setTier(t); if (t === "draft") setResolution("720p"); }} className={selectBtn(tier === t)}>
              {VEO31_MODELS[t].friendlyLabel}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold w-20">Mode</span>
          {([["text_to_video", "Text to video"], ["image_to_video", "Animate an image"], ["frame_guidance", "End on a frame"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setGenType(v)} className={selectBtn(genType === v)}>{label}</button>
          ))}
        </div>
        {genType !== "text_to_video" && (
          <Input value={refImageUrl} onChange={e => setRefImageUrl(e.target.value)}
            placeholder={genType === "image_to_video" ? "Reference image URL (the image to animate)" : "Final-frame image URL"}
            className="text-xs" />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold w-20">Aspect</span>
          {(["16:9", "9:16", "1:1"] as const).map(a => (
            <button key={a} onClick={() => setAspect(a)} className={selectBtn(aspect === a)}>{a === "16:9" ? "Widescreen 16:9" : a === "9:16" ? "Vertical 9:16" : "Square 1:1"}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold w-20">Detail</span>
          {(["720p", "1080p"] as const).map(r => (
            <button key={r} onClick={() => setResolution(r)} className={selectBtn(resolution === r)}>{r}</button>
          ))}
          <span className="text-[10px] text-muted-foreground/50" title={VEO31_4K_LIMITATION}>4K not available yet</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold w-20">Length</span>
          {VEO31_DURATIONS.map(d => (
            <button key={d} onClick={() => setDuration(d)} className={selectBtn(duration === d)}>{d}s</button>
          ))}
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold ml-3">Variations</span>
          {[1, 2].map(v => (
            <button key={v} onClick={() => setVariations(v)} className={selectBtn(variations === v)}>{v}</button>
          ))}
          <button onClick={() => setAudio(a => !a)} className={cn(selectBtn(audio), "ml-3 flex items-center gap-1")}>
            {audio ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
            {audio ? "With AI audio" : "Silent"}
          </button>
        </div>

        {issues.length > 0 && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 space-y-1">
            {issues.map((i, idx) => (
              <p key={idx} className="text-[11px] text-amber-200 flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{i.message}
              </p>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1.5">
            <BadgeDollarSign className="h-3.5 w-3.5 text-emerald-400" />
            Estimated render cost: <span className="font-semibold text-emerald-300">{fmtUsd(estimate)}</span>
            <span className="text-muted-foreground/40">— you approve before anything is charged</span>
          </p>
          <Button size="sm" disabled={!brief.trim() || issues.length > 0 || busy === "plan"} onClick={handlePlan}>
            {busy === "plan" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
            Create creative plan
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[11px] text-red-300">{error}</div>
      )}

      {/* ── Jobs ── */}
      <div className="space-y-3">
        {(jobs as VideoPipelineJob[]).map(job => (
          <div key={job.id} className="rounded-xl border border-white/[0.06] bg-card/60 p-4 space-y-3">
            <div className="flex items-center gap-2">
              {job.status === "ready" && <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />}
              {job.status === "failed" && <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
              {["rendering", "archiving", "submitting"].includes(job.status) && <Loader2 className="h-4 w-4 text-violet-400 animate-spin shrink-0" />}
              {job.status === "awaiting_approval" && <Clapperboard className="h-4 w-4 text-amber-400 shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate">{job.plan?.concept?.slice(0, 90) || "Video"}</p>
                <p className="text-[10px] text-muted-foreground/60">
                  {job.friendlyStatus} · {job.qualityLabel} · {job.aspectRatio} · {job.resolution} · {job.durationSeconds}s
                  {job.variations > 1 ? ` · ${job.variations} variations` : ""}
                </p>
              </div>
              <span className="text-[11px] font-semibold text-emerald-300 shrink-0">
                {job.actualCostUsd != null ? fmtUsd(job.actualCostUsd) : fmtUsd(job.estimatedCostUsd)}
              </span>
            </div>

            {/* Awaiting approval — the cost gate */}
            {job.status === "awaiting_approval" && (
              <div className="space-y-3">
                <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-3 space-y-2">
                  {job.plan?.hook && <p className="text-[11px]"><span className="text-muted-foreground/60 font-semibold">Hook: </span>{job.plan.hook}</p>}
                  {(job.plan?.scenes ?? []).map(s => (
                    <p key={s.scene} className="text-[11px] text-muted-foreground/80">
                      <span className="font-semibold text-foreground/80">Scene {s.scene} ({s.duration}s):</span> {s.visual}
                      {s.voiceover ? <span className="italic"> — “{s.voiceover}”</span> : null}
                    </p>
                  ))}
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-muted-foreground/60 font-semibold">Render prompt (v{job.promptVersion})</summary>
                    <p className="mt-1 text-muted-foreground/80 whitespace-pre-wrap">{job.prompt}</p>
                  </details>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={adjustNotes[job.id] ?? ""}
                    onChange={e => setAdjustNotes(p => ({ ...p, [job.id]: e.target.value }))}
                    placeholder="Want changes? e.g. 'make it funnier, show the product sooner'"
                    className="text-xs flex-1 min-w-[220px]"
                  />
                  <Button size="sm" variant="outline" disabled={busy === `adjust-${job.id}` || !(adjustNotes[job.id] ?? "").trim()}
                    onClick={() => run(`adjust-${job.id}`, async () => {
                      await adjustFn({ data: { jobId: job.id, adjustmentNote: adjustNotes[job.id] } });
                      setAdjustNotes(p => ({ ...p, [job.id]: "" }));
                    })}>
                    {busy === `adjust-${job.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Adjust plan (free)"}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500" disabled={busy === `approve-${job.id}`}
                    onClick={() => run(`approve-${job.id}`, () => approveFn({ data: { jobId: job.id, confirmedCostUsd: job.estimatedCostUsd } }))}>
                    {busy === `approve-${job.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    Approve & render — {fmtUsd(job.estimatedCostUsd)}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === `cancel-${job.id}`}
                    onClick={() => run(`cancel-${job.id}`, () => cancelFn({ data: { jobId: job.id } }))}>
                    <Ban className="h-3.5 w-3.5 mr-1" /> Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Rendering — manual refresh */}
            {["rendering", "archiving"].includes(job.status) && (
              <Button size="sm" variant="outline" disabled={busy === `poll-${job.id}`}
                onClick={() => run(`poll-${job.id}`, () => pollFn({ data: { jobId: job.id } }))}>
                {busy === `poll-${job.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Check progress
              </Button>
            )}

            {/* Ready — playback */}
            {job.status === "ready" && job.outputUrl && (
              <div className="space-y-2">
                {((job.plan as any)?.outputVariations ?? [job.outputUrl]).map((url: string, i: number) => (
                  <video key={i} src={url} controls className="w-full max-h-72 rounded-lg bg-black" />
                ))}
              </div>
            )}

            {/* Failed — friendly reason + explicit (re-approved) retry */}
            {job.status === "failed" && (
              <div className="space-y-2">
                <p className="text-[11px] text-red-300/90">{job.failureReason ?? "This render didn't finish."}</p>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={busy === `retry-${job.id}`}
                    onClick={() => run(`retry-${job.id}`, () => retryFn({ data: { jobId: job.id } }))}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry (new approval)
                  </Button>
                  {job.qualityTier === "premium" && (
                    <Button size="sm" variant="ghost" disabled={busy === `retryd-${job.id}`}
                      onClick={() => run(`retryd-${job.id}`, () => retryFn({ data: { jobId: job.id, qualityTier: "draft" } }))}>
                      <Film className="h-3.5 w-3.5 mr-1.5" /> Retry as cheap draft
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {(jobs as VideoPipelineJob[]).length === 0 && (
          <p className="text-center text-[11px] text-muted-foreground/50 py-6">
            No pipeline videos yet — describe your video above and create a creative plan. Nothing is charged until you approve.
          </p>
        )}
      </div>
    </div>
  );
}
