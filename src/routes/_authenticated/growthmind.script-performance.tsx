// GrowthMind → Script Performance — call-script intelligence: per-agent
// qualification/booking/positive-sentiment rates, time-of-day breakdown, and
// AI-extracted objection + opening-line patterns from transcripts. Generates
// script-revision drafts and A/B experiments through the GrowthMind proposal
// flow (drafts-until-approval — production agents are never modified here).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  AudioLines, Loader2, RefreshCw, Clock3, MessageSquareWarning,
  Quote, Lightbulb, FlaskConical, FileEdit, ShieldCheck, AlertTriangle,
} from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getMyContext } from "@/lib/workspace/workspace.functions";
import {
  getScriptPerformance, runScriptPerformanceAnalysis, createScriptRecommendation,
} from "@/lib/growthmind/growthmind.script-performance";

export const Route = createFileRoute("/_authenticated/growthmind/script-performance")({
  component: () => (
    <GrowthMindShell>
      <ScriptPerformancePage />
    </GrowthMindShell>
  ),
});

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v}%`;
}

function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

const QUALITY_STYLE: Record<string, string> = {
  strong:  "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  weak:    "bg-red-500/15 text-red-300 border-red-500/30",
  neutral: "bg-white/[0.06] text-muted-foreground border-white/[0.1]",
};

const FREQ_STYLE: Record<string, string> = {
  common:     "bg-amber-500/15 text-amber-300 border-amber-500/30",
  occasional: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  rare:       "bg-white/[0.06] text-muted-foreground border-white/[0.1]",
};

function ScriptPerformancePage() {
  const ctxFn  = useServerFn(getMyContext);
  const getFn  = useServerFn(getScriptPerformance);
  const runFn  = useServerFn(runScriptPerformanceAnalysis);
  const recFn  = useServerFn(createScriptRecommendation);
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [recBusy, setRecBusy] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const { data: ctx } = useQuery({
    queryKey: ["my-context"],
    queryFn: () => ctxFn(),
    staleTime: 60_000,
    throwOnError: false,
  });
  const workspaceId = ctx?.workspaceId ?? null;

  const q = useQuery({
    queryKey: ["gm-script-performance", workspaceId],
    queryFn: () => getFn(),
    enabled: !!workspaceId,
    staleTime: 60_000,
    throwOnError: false,
  });

  async function runAnalysis() {
    setRunning(true);
    try {
      await runFn({ data: { force: true } });
      toast.success("Script analysis complete.");
      qc.invalidateQueries({ queryKey: ["gm-script-performance", workspaceId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Analysis failed.");
    } finally { setRunning(false); }
  }

  async function generate(kind: "revision" | "ab_experiment") {
    setRecBusy(kind);
    try {
      const res = await recFn({ data: { kind, agentKey: selectedAgent } });
      if (res.ok) {
        toast.success(`Draft created: "${res.title}" — review it under Proposals (approval required).`);
      } else {
        toast.error(res.error ?? "Could not create the draft.");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create the draft.");
    } finally { setRecBusy(null); }
  }

  if (q.isLoading || !workspaceId) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-emerald-400" /></div>;
  }

  const analysis = q.data?.analysis ?? null;
  const agents = analysis?.agents ?? [];
  const patterns = analysis?.patterns ?? null;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <AudioLines className="h-5 w-5 text-emerald-400" /> Script Performance
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Call-script intelligence from your last 30 days of calls: conversion rates by agent and time of day,
            plus AI-extracted objection and opening-line patterns from real transcripts.
          </p>
        </div>
        <Button onClick={runAnalysis} disabled={running} size="sm" className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {analysis ? "Re-run analysis" : "Run analysis"}
        </Button>
      </div>

      {!analysis ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <AudioLines className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">No script analysis yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Run the analysis to compute call-script performance from your call history and transcripts.
          </p>
        </div>
      ) : analysis.totals.calls === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-400/70" />
          <p className="mt-3 text-sm font-medium">No calls in the last 30 days</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Script analysis needs real call activity. Once calls come in, re-run the analysis here.
          </p>
        </div>
      ) : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: "Calls (30d)",     value: String(analysis.totals.calls) },
              { label: "Connected",       value: String(analysis.totals.connected) },
              { label: "Positive rate",   value: pct(analysis.totals.positiveRate) },
              { label: "Qualified rate",  value: pct(analysis.totals.qualifiedRate) },
              { label: "Booking rate",    value: pct(analysis.totals.bookingRate) },
            ].map(kpi => (
              <div key={kpi.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="text-xs text-muted-foreground">{kpi.label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{kpi.value}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Analysed {new Date(analysis.computedAt).toLocaleString()} · {analysis.sampleSize} calls ·{" "}
            {analysis.aiStatus === "ok"
              ? `${analysis.analyzedTranscripts} transcripts AI-analysed`
              : analysis.aiStatus === "skipped"
                ? "transcript AI analysis unavailable (no transcripts or no AI key)"
                : "transcript AI analysis failed — rates below are still real data"} · times shown in {analysis.timezone}
          </p>

          {/* Per-agent table */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <h2 className="text-sm font-medium">Per-agent script performance</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Select an agent to target the recommendation drafts below. Best hours = strongest connect/positive/booking mix.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08] text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Calls</th>
                    <th className="px-3 py-2">Conn. rate</th>
                    <th className="px-3 py-2">Positive</th>
                    <th className="px-3 py-2">Qualified</th>
                    <th className="px-3 py-2">Booked</th>
                    <th className="px-3 py-2">Best hours</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a: any) => (
                    <tr
                      key={a.agentKey}
                      onClick={() => setSelectedAgent(selectedAgent === a.agentKey ? null : a.agentKey)}
                      className={cn(
                        "h-11 cursor-pointer border-b border-white/[0.04] hover:bg-white/[0.03]",
                        selectedAgent === a.agentKey && "bg-emerald-500/[0.08]"
                      )}
                    >
                      <td className="px-3 py-2.5 font-medium">{a.agentName}</td>
                      <td className="px-3 py-2.5 tabular-nums">{a.total}</td>
                      <td className="px-3 py-2.5 tabular-nums">{pct(a.connectionRate)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{pct(a.positiveRate)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{pct(a.qualifiedRate)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{analysis.source === "wbah" ? pct(a.bookingRate) : "—"}</td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock3 className="h-3.5 w-3.5" />
                          {a.bestHours.length > 0 ? a.bestHours.map(hourLabel).join(", ") : "n/a"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {analysis.source === "standard" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Bookings for standard workspaces are counted workspace-wide from the bookings calendar (per-agent attribution unavailable).
                Qualified = calls flagged successful by the agent.
              </p>
            )}
          </div>

          {/* AI-extracted patterns */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <Quote className="h-4 w-4 text-emerald-400" /> Opening-line patterns
              </h2>
              {!patterns || patterns.openingLines.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {analysis.aiStatus === "ok" ? "No clear opening-line patterns found in the sampled transcripts." : "Not available — transcript AI analysis did not run."}
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {patterns.openingLines.map((o: any, i: number) => (
                    <li key={i} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm">“{o.line}”</p>
                        <Badge variant="outline" className={cn("shrink-0 text-[10px]", QUALITY_STYLE[o.quality])}>{o.quality}</Badge>
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">{o.agent ? `${o.agent} — ` : ""}{o.note}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <MessageSquareWarning className="h-4 w-4 text-amber-400" /> Objection patterns
              </h2>
              {!patterns || patterns.objections.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {analysis.aiStatus === "ok" ? "No recurring objections found in the sampled transcripts." : "Not available — transcript AI analysis did not run."}
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {patterns.objections.map((o: any, i: number) => (
                    <li key={i} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{o.objection}</p>
                        <Badge variant="outline" className={cn("shrink-0 text-[10px]", FREQ_STYLE[o.frequency])}>{o.frequency}</Badge>
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">Suggested response: {o.suggestedResponse}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {patterns && patterns.insights.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <Lightbulb className="h-4 w-4 text-sky-400" /> Insights
              </h2>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                {patterns.insights.map((s: string, i: number) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {/* Recommendation drafts */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Generate a recommendation (approval required)
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Creates a draft in <Link to="/growthmind/proposals" className="underline">Proposals</Link>
              {" "}for {selectedAgent ? `the selected agent (${agents.find((a: any) => a.agentKey === selectedAgent)?.agentName ?? selectedAgent})` : "your top agent"}.
              Production agents are never changed automatically — approved scripts are applied manually in the agent builder.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" className="gap-2" disabled={recBusy !== null} onClick={() => generate("revision")}>
                {recBusy === "revision" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileEdit className="h-4 w-4" />}
                Script revision draft
              </Button>
              <Button size="sm" variant="secondary" className="gap-2" disabled={recBusy !== null} onClick={() => generate("ab_experiment")}>
                {recBusy === "ab_experiment" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                A/B experiment draft
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
