import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Filter, Loader2, RefreshCw, Save, Trash2, ChevronDown, Sparkles,
  TrendingDown, CheckCircle2, AlertTriangle, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getGrowthMindAIResponse } from "@/lib/growthmind/growthmind.ai";
import { getGrowthMindData } from "@/lib/growthmind/growthmind.functions";
import {
  computeFunnelStages,
  getFunnelLiveData,
  saveFunnelSnapshot,
  getFunnelSnapshots,
  deleteFunnelSnapshot,
  type FunnelStage,
} from "@/lib/growthmind/growthmind.funnels";

// ── Drop-off colour helpers ────────────────────────────────────────────────────

function dropIcon(color: FunnelStage["dropColor"]) {
  if (color === "green")  return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
  if (color === "amber")  return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />;
  if (color === "red")    return <XCircle className="h-3.5 w-3.5 text-red-400" />;
  return null;
}

function dropBadge(color: FunnelStage["dropColor"], pct: number | null) {
  if (pct === null) return null;
  const cls =
    color === "green" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" :
    color === "amber" ? "bg-amber-500/15 text-amber-400 border-amber-500/20" :
                        "bg-red-500/15 text-red-400 border-red-500/20";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", cls)}>
      {dropIcon(color)}
      {pct}% drop-off
    </span>
  );
}

// ── Funnel bar ─────────────────────────────────────────────────────────────────

function FunnelBar({ stage, maxCount, index }: {
  stage:    FunnelStage;
  maxCount: number;
  index:    number;
}) {
  const widthPct = maxCount > 0 ? Math.max(18, Math.round((stage.count / maxCount) * 100)) : 18;
  const bgColor  =
    stage.dropColor === "green" ? "bg-emerald-500/70" :
    stage.dropColor === "amber" ? "bg-amber-500/70"   :
    stage.dropColor === "red"   ? "bg-red-500/70"     : "bg-emerald-500/70";

  return (
    <div className="flex flex-col items-center gap-1.5 w-full">
      {index > 0 && (
        <div className="flex items-center gap-2 py-1">
          <TrendingDown className="h-3.5 w-3.5 text-muted-foreground/50" />
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {stage.convFromPrev !== null && (
              <span className="text-[11px] text-muted-foreground">
                {stage.convFromPrev}% conversion
              </span>
            )}
            {dropBadge(stage.dropColor, stage.dropPct)}
          </div>
        </div>
      )}

      <div
        className={cn(
          "flex items-center justify-between gap-4 rounded-xl px-5 py-3.5 transition-all",
          bgColor,
        )}
        style={{ width: `${widthPct}%`, minWidth: 240 }}
      >
        <p className="text-xs font-semibold text-white/90">{stage.label}</p>
        <p className="text-xl font-bold tabular-nums text-white">{stage.count.toLocaleString()}</p>
      </div>
    </div>
  );
}

// ── Snapshot row ───────────────────────────────────────────────────────────────

function SnapshotRow({ snap, onDelete }: { snap: any; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const date = new Date(snap.snapshotAt).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const topStage = (snap.stages as FunnelStage[])
    .filter(s => s.dropPct !== null)
    .sort((a, b) => (b.dropPct ?? 0) - (a.dropPct ?? 0))[0];

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.02]"
        onClick={() => setOpen(v => !v)}
      >
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium">{snap.name}</p>
          <p className="text-[11px] text-muted-foreground">{date}</p>
        </div>
        {topStage && (
          <span className="text-[10px] text-muted-foreground hidden sm:block">
            Biggest drop: <span className="font-medium text-foreground">{topStage.label}</span>
          </span>
        )}
        <Button
          variant="ghost" size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-red-400"
          onClick={e => { e.stopPropagation(); onDelete(snap.id); }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-white/[0.04] flex flex-wrap gap-2">
          {(snap.stages as FunnelStage[]).map(s => (
            <div key={s.key} className="flex items-center gap-1.5 rounded-md bg-white/[0.03] px-2.5 py-1.5">
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
              <span className="text-xs font-semibold tabular-nums">{s.count.toLocaleString()}</span>
              {s.dropPct !== null && dropBadge(s.dropColor, s.dropPct)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function GrowthMindFunnels() {
  const [snapshotName, setSnapshotName] = useState("");
  const [aiDiagnosis, setAiDiagnosis]   = useState<string | null>(null);
  const [aiLoading, setAiLoading]       = useState(false);
  const [saveMsg, setSaveMsg]           = useState<string | null>(null);

  const qc           = useQueryClient();
  const getLiveFn    = useServerFn(getFunnelLiveData);
  const getDataFn    = useServerFn(getGrowthMindData);
  const getSnapsFn   = useServerFn(getFunnelSnapshots);
  const saveSnapFn   = useServerFn(saveFunnelSnapshot);
  const deleteSnapFn = useServerFn(deleteFunnelSnapshot);
  const aiResponseFn = useServerFn(getGrowthMindAIResponse);

  const { data: liveData, isLoading, isFetching } = useQuery({
    queryKey: ["growthmind-funnel-live"],
    queryFn:  () => getLiveFn(),
    staleTime: 60_000,
  });

  const { data: platformData } = useQuery({
    queryKey: ["growthmind-data"],
    queryFn:  () => getDataFn(),
    staleTime: 120_000,
  });

  const { data: snapsData, isLoading: snapsLoading } = useQuery({
    queryKey: ["growthmind-funnel-snapshots"],
    queryFn:  () => getSnapsFn(),
  });

  const stages   = liveData ? computeFunnelStages(liveData) : [];
  const maxCount = stages.length > 0 ? stages[0].count : 0;

  const biggestDrop = [...stages]
    .filter(s => s.dropPct !== null)
    .sort((a, b) => (b.dropPct ?? 0) - (a.dropPct ?? 0))[0];

  async function handleSaveSnapshot() {
    if (stages.length === 0) return;
    const name = snapshotName.trim() || `Snapshot ${new Date().toLocaleDateString("en-GB")}`;
    try {
      await saveSnapFn({ name, stages });
      setSnapshotName("");
      setSaveMsg("Snapshot saved!");
      setTimeout(() => setSaveMsg(null), 3000);
      qc.invalidateQueries({ queryKey: ["growthmind-funnel-snapshots"] });
    } catch (e: any) {
      setSaveMsg("Error: " + e.message);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteSnapFn({ id });
      qc.invalidateQueries({ queryKey: ["growthmind-funnel-snapshots"] });
    } catch {}
  }

  async function handleAIDiagnosis() {
    if (!biggestDrop || !platformData) return;
    setAiLoading(true);
    setAiDiagnosis(null);
    try {
      const funnelSummary = stages.map(s =>
        `${s.label}: ${s.count}${s.dropPct !== null ? ` (${s.dropPct}% drop-off from previous stage)` : ""}`
      ).join("\n");

      const { reply } = await aiResponseFn({
        messages: [{
          role: "user",
          content: `Here is my current 6-stage marketing funnel:\n\n${funnelSummary}\n\nThe biggest drop-off is at "${biggestDrop.label}" (${biggestDrop.dropPct}% drop). In 2-3 sentences, diagnose why this might be happening and give one specific fix.`,
        }],
        platformData,
        personality: "professional",
      });
      setAiDiagnosis(reply);
    } catch (e: any) {
      setAiDiagnosis("Unable to generate AI diagnosis: " + e.message);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-3xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Filter className="h-5 w-5 text-emerald-400" />
              Marketing Funnel
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Traffic → Lead → Qualified → Appointment → Proposal → Sale · live CRM data
            </p>
          </div>
          <Button
            variant="outline" size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["growthmind-funnel-live"] })}
          >
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm">Loading funnel data…</span>
          </div>
        ) : (
          <div className="space-y-6">

            {/* Live funnel */}
            <div className="rounded-xl border border-white/[0.06] bg-card/60 p-6">
              <p className="text-sm font-semibold mb-5">Live Funnel</p>
              {stages.length === 0 || maxCount === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No lead data yet.</p>
              ) : (
                <div className="flex flex-col items-center gap-0.5">
                  {stages.map((stage, i) => (
                    <FunnelBar
                      key={stage.key}
                      stage={stage}
                      maxCount={maxCount}
                      index={i}
                    />
                  ))}
                </div>
              )}

              {/* Save snapshot */}
              <div className="mt-6 flex items-center gap-2 flex-wrap">
                <Input
                  placeholder="Snapshot name (optional)"
                  value={snapshotName}
                  onChange={e => setSnapshotName(e.target.value)}
                  className="h-8 text-xs max-w-[220px]"
                />
                <Button size="sm" onClick={handleSaveSnapshot} disabled={stages.length === 0 || maxCount === 0}>
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  Save snapshot
                </Button>
                {saveMsg && (
                  <span className={cn(
                    "text-xs font-medium",
                    saveMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400",
                  )}>{saveMsg}</span>
                )}
              </div>
            </div>

            {/* AI Diagnosis */}
            {biggestDrop && platformData && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
                    <p className="text-sm font-semibold">AI Diagnosis</p>
                  </div>
                  <Button
                    variant="outline" size="sm"
                    onClick={handleAIDiagnosis}
                    disabled={aiLoading}
                    className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                  >
                    {aiLoading
                      ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Analysing…</>
                      : <><Sparkles className="mr-1.5 h-3.5 w-3.5" />Diagnose funnel</>
                    }
                  </Button>
                </div>

                {!aiDiagnosis && !aiLoading && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Biggest drop-off at <span className="font-semibold text-foreground">{biggestDrop.label}</span> ({biggestDrop.dropPct}% drop).
                    Click <em>Diagnose funnel</em> for an AI-powered fix recommendation.
                  </p>
                )}
                {aiLoading && (
                  <p className="mt-3 text-sm text-muted-foreground animate-pulse">
                    GrowthMind is analysing your funnel…
                  </p>
                )}
                {aiDiagnosis && !aiLoading && (
                  <p className="mt-3 text-sm leading-relaxed">{aiDiagnosis}</p>
                )}
              </div>
            )}

            {/* Saved snapshots */}
            <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <p className="text-sm font-semibold">Saved Snapshots</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Compare funnel performance over time</p>
              </div>
              <div className="p-3 space-y-2">
                {snapsLoading ? (
                  <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading snapshots…</span>
                  </div>
                ) : (snapsData?.snapshots ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No snapshots saved yet — click <em>Save snapshot</em> to track progress over time.
                  </p>
                ) : (
                  snapsData!.snapshots.map(snap => (
                    <SnapshotRow key={snap.id} snap={snap} onDelete={handleDelete} />
                  ))
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
