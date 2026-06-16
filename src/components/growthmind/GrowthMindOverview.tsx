import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  TrendingUp, TrendingDown, Loader2, RefreshCw, Target, Megaphone,
  ArrowRight, Lightbulb, AlertTriangle, Minus, BookOpen, CheckCircle2,
  BarChart3, Video, Image, Link2, XCircle, Clapperboard, Zap,
  Star, DollarSign, Filter, Play, Users, Dna, Rocket, ChevronRight,
} from "lucide-react";
import { getProviderRegistryData } from "@/lib/providers/providers.functions";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { getGrowthMindData } from "@/lib/growthmind/growthmind.functions";
import { computeGrowthScore } from "@/lib/growthmind/growthmind.score";
import { generateGrowthRecommendations } from "@/lib/growthmind/growthmind.recommendations";
import { getActivePlaybook, PLAYBOOKS } from "@/lib/growthmind/growthmind.playbooks";
import { Button } from "@/components/ui/button";
import { getBusinessDna, computeDnaCompletionScore } from "@/lib/growthmind/growthmind.business-dna";
import { getCurrentValuePoint } from "@/lib/growthmind/trending-value-engine.server";
import { getOpportunities, runOpportunityEngine } from "@/lib/growthmind/opportunity-engine.server";
import { getCMODashboardData, runCMOAnalysis } from "@/lib/executives/executive-bridge";
import { toast } from "sonner";

function TrendPill({ pct, label = "wow" }: { pct: number | null; label?: string }) {
  if (pct === null) return null;
  const up   = pct > 0;
  const flat = pct === 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-[10px] font-semibold rounded-full px-1.5 py-0.5",
      flat  ? "bg-slate-500/15 text-slate-400" :
      up    ? "bg-emerald-500/15 text-emerald-400" :
              "bg-red-500/15 text-red-400",
    )}>
      {flat  ? <Minus className="h-2.5 w-2.5" /> :
       up    ? <TrendingUp className="h-2.5 w-2.5" /> :
               <TrendingDown className="h-2.5 w-2.5" />}
      {up ? "+" : ""}{pct}% {label}
    </span>
  );
}

function StatCard({ label, value, sub, color = "emerald", wowPct, momPct }: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  wowPct?: number | null;
  momPct?: number | null;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
      <p className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-[0.08em] font-medium">{label}</p>
      <p className={cn("text-2xl font-bold tabular-nums", `text-${color}-400`)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
      {(wowPct !== undefined || momPct !== undefined) && (
        <div className="flex flex-wrap gap-1 mt-2">
          {wowPct !== undefined && <TrendPill pct={wowPct ?? null} label="wow" />}
          {momPct !== undefined && <TrendPill pct={momPct ?? null} label="mom" />}
        </div>
      )}
    </div>
  );
}

export function GrowthMindOverview() {
  const fn                 = useServerFn(getGrowthMindData);
  const getPlaybookFn      = useServerFn(getActivePlaybook);
  const providerRegistryFn = useServerFn(getProviderRegistryData);
  const getDnaFn           = useServerFn(getBusinessDna);
  const getValuePointFn    = useServerFn(getCurrentValuePoint);
  const getOpportunitiesFn  = useServerFn(getOpportunities);
  const runOppEngineFn      = useServerFn(runOpportunityEngine);
  const getCMODashboardFn   = useServerFn(getCMODashboardData);
  const runCMOAnalysisFn    = useServerFn(runCMOAnalysis);
  const [runningOppEngine, setRunningOppEngine] = React.useState(false);
  const [runningCMO, setRunningCMO] = React.useState(false);
  const qc = useQueryClient();

  const { data: providerData } = useQuery({
    queryKey: ["provider-registry"],
    queryFn: () => providerRegistryFn(),
    staleTime: 120_000,
  });
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["growthmind-data"],
    queryFn:  () => fn(),
    staleTime: 60_000,
  });

  const { data: playbookData } = useQuery({
    queryKey: ["growthmind-active-playbook"],
    queryFn:  () => getPlaybookFn(),
    staleTime: 60_000,
  });

  const { data: dnaData } = useQuery({
    queryKey: ["growthmind-business-dna"],
    queryFn:  () => getDnaFn(),
    staleTime: 120_000,
  });

  const { data: valuePointData } = useQuery({
    queryKey: ["growthmind-value-point"],
    queryFn:  () => getValuePointFn(),
    staleTime: 120_000,
  });

  const { data: oppsData, refetch: refetchOpps } = useQuery({
    queryKey: ["growthmind-opportunities"],
    queryFn:  () => getOpportunitiesFn(),
    staleTime: 120_000,
  });

  const { data: cmoData, refetch: refetchCMO } = useQuery({
    queryKey: ["growthmind-cmo-dashboard"],
    queryFn:  () => getCMODashboardFn(),
    staleTime: 300_000,
  });

  const dna        = (dnaData as any)?.dna ?? null;
  const dnaScore   = dna ? computeDnaCompletionScore(dna) : null;
  const valuePoint = (valuePointData as any)?.valuePoint ?? null;
  const storedOpps = (oppsData as any)?.opportunities ?? [];

  const score = computeGrowthScore(data);
  const recs  = generateGrowthRecommendations(data);

  async function handleRunOppEngine() {
    try {
      setRunningOppEngine(true);
      await runOppEngineFn();
      await refetchOpps();
      toast.success("Opportunity Engine complete — opportunities updated");
    } catch {
      toast.error("Opportunity Engine failed — try again");
    } finally {
      setRunningOppEngine(false);
    }
  }

  async function handleRunCMOAnalysis() {
    try {
      setRunningCMO(true);
      await runCMOAnalysisFn();
      await refetchCMO();
      toast.success("CMO Analysis complete — all signals refreshed");
    } catch {
      toast.error("CMO Analysis failed — try again");
    } finally {
      setRunningCMO(false);
    }
  }

  const cmo = cmoData as any ?? {};
  const serviceScores     = cmo.serviceScores ?? [];
  const trendSignals      = cmo.trendSignals ?? [];
  const campaignProposals = cmo.campaignProposals ?? [];
  const videoProposals    = cmo.videoProposals ?? [];

  const topService     = serviceScores[0] ?? null;
  const growingTrend   = trendSignals.find((s: any) => s.classification === "Growing") ?? trendSignals[0] ?? null;
  const topCampaign    = campaignProposals.find((p: any) => p.status === "draft") ?? campaignProposals[0] ?? null;
  const topVideo       = videoProposals.find((p: any) => p.status === "draft") ?? videoProposals[0] ?? null;

  // Recommended funnel — stage with most stalled leads
  const stalledPipeline: any[] = (data as any)?.leads?.stalledPipeline ?? [];
  const stageCounts: Record<string, number> = {};
  for (const l of stalledPipeline) {
    const stage = l.pipeline_stage ?? l.status ?? "unknown";
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
  }
  const topStage = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0] ?? null;

  // Recommended budget
  const budget = dna?.monthly_marketing_budget ?? null;
  const score60 = score.total;
  const recommendedBudget = budget
    ? `£${Math.round(budget * 0.6).toLocaleString()} of £${budget.toLocaleString()}/mo budget`
    : score60 < 40
      ? "£200–500/month on 1 channel"
      : score60 < 70
        ? "£500–1,500/month across 3 channels"
        : "£1,500+/month — scale across 4+ channels";

  // Recommended next action
  const criticalRec = recs.find(r => r.priority === "critical");
  const highRec     = recs.find(r => r.priority === "high");
  const nextAction  = topCampaign
    ? `Run: "${topCampaign.title}"`
    : criticalRec?.fix ?? highRec?.fix ?? topService?.recommendation ?? "Run CMO Analysis to generate recommendations";

  const activePlaybookId = playbookData?.activePlaybook?.industry ?? null;
  const activePlaybook   = PLAYBOOKS.find(p => p.id === activePlaybookId) ?? null;

  const scoreColor = score.total >= 70 ? "text-emerald-400" : score.total >= 40 ? "text-amber-400" : "text-red-400";
  const barColor   = score.total >= 70 ? "bg-emerald-500" : score.total >= 40 ? "bg-amber-500" : "bg-red-500";

  const t = (data as any)?.trends;

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-5xl">

        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
              GrowthMind Overview
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">Your AI Chief Marketing Officer — marketing readiness &amp; growth strategy</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["growthmind-data"] })}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm">Analysing marketing data…</span>
          </div>
        ) : (
          <div className="space-y-6">

            {/* Growth Score */}
            <div className="rounded-xl border border-white/[0.06] bg-card/60 p-5">
              <div className="flex items-center gap-6 flex-wrap">
                <div className="text-center min-w-[80px]">
                  <div className={cn("text-5xl font-bold tabular-nums", scoreColor)}>{score.total}</div>
                  <div className={cn("text-lg font-bold", scoreColor)}>{score.grade}</div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 font-semibold uppercase tracking-[0.1em]">Marketing Readiness</p>
                </div>

                <div className="flex-1 min-w-[200px] space-y-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">{score.label}</span>
                    <span className="text-[11px] text-muted-foreground">{score.total}/100</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${score.total}%` }} />
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3">
                    {score.dimensions.map(d => (
                      <div key={d.key} className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between mb-0.5">
                            <span className="text-[10px] text-muted-foreground truncate">{d.label}</span>
                            <span className="text-[10px] font-medium ml-1 shrink-0">{d.score}/{d.max}</span>
                          </div>
                          <div className="h-1 rounded-full bg-white/[0.06]">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                d.color === "emerald" ? "bg-emerald-500" :
                                d.color === "amber"   ? "bg-amber-500" : "bg-red-500"
                              )}
                              style={{ width: `${d.pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Active Playbook summary */}
            {activePlaybook ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-emerald-400 shrink-0" />
                  <p className="text-xs font-semibold text-emerald-300">Active Playbook</p>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span className="text-sm font-medium">{activePlaybook.industry}</span>
                </div>
                <p className="text-xs text-muted-foreground flex-1 min-w-[180px] truncate">{activePlaybook.description}</p>
                <Link to="/growthmind/playbooks" className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5 shrink-0">
                  View tactics <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <div className="rounded-xl border border-white/[0.06] bg-card/60 px-4 py-3 flex items-center gap-3">
                <BookOpen className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                <p className="text-xs text-muted-foreground flex-1">No playbook active.</p>
                <Link to="/growthmind/playbooks" className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5 shrink-0">
                  Choose a playbook <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            )}

            {/* ── Business DNA + Value Point + Opportunity Engine ───────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

              {/* DNA completion card */}
              <Link to="/growthmind/business-dna" className="rounded-xl border border-white/[0.06] bg-card/60 p-4 hover:border-emerald-500/20 hover:bg-emerald-500/[0.03] transition-all group">
                <div className="flex items-center gap-2 mb-2">
                  <Dna className="h-4 w-4 text-emerald-400 shrink-0" />
                  <p className="text-xs font-semibold">Business DNA</p>
                  <ArrowRight className="h-3 w-3 text-muted-foreground ml-auto group-hover:text-emerald-400 transition-colors" />
                </div>
                {dnaScore !== null ? (
                  <>
                    <div className="flex items-end gap-1.5 mb-2">
                      <span className={cn("text-2xl font-bold tabular-nums", dnaScore.pct >= 70 ? "text-emerald-400" : dnaScore.pct >= 40 ? "text-amber-400" : "text-red-400")}>
                        {dnaScore.pct}%
                      </span>
                      <span className="text-[10px] text-muted-foreground mb-0.5">complete</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.06] mb-2">
                      <div
                        className={cn("h-full rounded-full transition-all", dnaScore.pct >= 70 ? "bg-emerald-500" : dnaScore.pct >= 40 ? "bg-amber-500" : "bg-red-500")}
                        style={{ width: `${dnaScore.pct}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">{dnaScore.missing.length === 0 ? "All fields complete" : `${dnaScore.missing.length} field${dnaScore.missing.length !== 1 ? "s" : ""} missing`}</p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Set up your Business DNA to unlock AI-powered marketing insights.</p>
                )}
              </Link>

              {/* Current Value Point card */}
              <Link to="/growthmind/business-dna" className="rounded-xl border border-white/[0.06] bg-card/60 p-4 hover:border-emerald-500/20 hover:bg-emerald-500/[0.03] transition-all group">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-4 w-4 text-amber-400 shrink-0" />
                  <p className="text-xs font-semibold">Top Value Point</p>
                  <ArrowRight className="h-3 w-3 text-muted-foreground ml-auto group-hover:text-emerald-400 transition-colors" />
                </div>
                {valuePoint ? (
                  <>
                    <p className="text-xs font-medium leading-snug line-clamp-2">{valuePoint.current_highest_value}</p>
                    {valuePoint.who_to_target && (
                      <p className="text-[10px] text-muted-foreground mt-1.5 line-clamp-1">Target: {valuePoint.who_to_target}</p>
                    )}
                    {valuePoint.confidence_score != null && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <div className="flex-1 h-1 rounded-full bg-white/[0.06]">
                          <div className="h-full rounded-full bg-amber-500" style={{ width: `${valuePoint.confidence_score}%` }} />
                        </div>
                        <span className="text-[9px] text-muted-foreground">{valuePoint.confidence_score}%</span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Run the Opportunity Engine to discover your top value point.</p>
                )}
              </Link>

              {/* Opportunity Engine card */}
              <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2 mb-1">
                  <Rocket className="h-4 w-4 text-emerald-400 shrink-0" />
                  <p className="text-xs font-semibold">Opportunity Engine</p>
                </div>
                {storedOpps.length > 0 ? (
                  <div className="flex-1 space-y-1.5">
                    {storedOpps.slice(0, 3).map((o: any) => (
                      <div key={o.id} className="flex items-center gap-2">
                        <span className={cn(
                          "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                          o.urgency === "critical" ? "bg-red-500/15 text-red-400" :
                          o.urgency === "high"     ? "bg-orange-500/15 text-orange-400" :
                          o.urgency === "medium"   ? "bg-amber-500/15 text-amber-400" :
                                                     "bg-slate-500/15 text-slate-400",
                        )}>{o.urgency}</span>
                        <p className="text-[10px] text-muted-foreground truncate">{o.title}</p>
                      </div>
                    ))}
                    {storedOpps.length > 3 && (
                      <Link to="/growthmind/lead-opportunities" className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5 mt-1">
                        +{storedOpps.length - 3} more <ArrowRight className="h-2.5 w-2.5" />
                      </Link>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground flex-1">No opportunities detected yet.</p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs mt-auto"
                  onClick={handleRunOppEngine}
                  disabled={runningOppEngine}
                >
                  {runningOppEngine ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />}
                  {runningOppEngine ? "Running…" : "Run Analysis"}
                </Button>
              </div>
            </div>

            {/* Key metrics with trend indicators */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <StatCard
                label="Total Leads"
                value={data?.leads.total ?? 0}
                sub={`${data?.leads.newLast7 ?? 0} new this week`}
                wowPct={t?.leads?.wowPct}
                momPct={t?.leads?.momPct}
              />
              <StatCard
                label="Conversion Rate"
                value={`${data?.leads.conversionRate ?? 0}%`}
                sub={`${data?.leads.sales ?? 0} sales closed`}
                color="emerald"
                wowPct={t?.conversionRate?.wowPct}
                momPct={t?.conversionRate?.momPct}
              />
              <StatCard
                label="Active Campaigns"
                value={data?.campaigns.active ?? 0}
                sub={`${data?.campaigns.total ?? 0} total campaigns`}
                color="purple"
              />
              <StatCard
                label="Bookings (total)"
                value={data?.bookings.total ?? 0}
                sub={`${data?.bookings.last7 ?? 0} this week`}
                color="amber"
                wowPct={t?.bookings?.wowPct}
                momPct={t?.bookings?.momPct}
              />
              <StatCard
                label="Follow-Up Coverage"
                value={`${data?.leads.followUpCoverage ?? 0}%`}
                sub="of active leads contacted"
                color={(data?.leads.followUpCoverage ?? 0) >= 75 ? "emerald" : "amber"}
              />
              <StatCard
                label="SEO Keywords"
                value={data?.marketing?.seoKeywords ?? 0}
                sub={`${data?.marketing?.seoSitesCount ?? 0} site${(data?.marketing?.seoSitesCount ?? 0) !== 1 ? "s" : ""} monitored`}
                color={(data?.marketing?.seoKeywords ?? 0) > 0 ? "emerald" : "slate"}
              />
              <StatCard
                label="Content (14d)"
                value={data?.marketing?.recentContentCount ?? 0}
                sub="pieces published"
                color={(data?.marketing?.recentContentCount ?? 0) >= 2 ? "emerald" : "amber"}
              />
              <StatCard
                label="WhatsApp (30d)"
                value={data?.whatsapp.total ?? 0}
                sub={`${data?.whatsapp.outbound ?? 0} outbound`}
                color="emerald"
              />
            </div>

            {/* Alerts + quick links */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    Growth Opportunities
                  </p>
                  <Link to="/growthmind/recommendations" className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5">
                    View all <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {recs.slice(0, 4).length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No issues detected — all clear!
                    </div>
                  ) : recs.slice(0, 4).map(r => (
                    <div key={r.id} className="px-4 py-2.5 flex items-start gap-2.5">
                      <span className={cn(
                        "shrink-0 mt-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                        r.priority === "critical" ? "bg-red-500/15 text-red-400" :
                        r.priority === "high"     ? "bg-orange-500/15 text-orange-400" :
                        r.priority === "medium"   ? "bg-amber-500/15 text-amber-400" :
                                                    "bg-slate-500/15 text-slate-400",
                      )}>{r.priority}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium leading-snug">{r.problem}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{r.fix.slice(0, 80)}…</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.06]">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <Lightbulb className="h-3.5 w-3.5 text-emerald-400" />
                    CMO Actions
                  </p>
                </div>
                <div className="p-3 grid grid-cols-2 gap-2">
                  {[
                    { label: "AI CMO Chat",        href: "/growthmind/chat",               icon: TrendingUp, desc: "Ask GrowthMind anything" },
                    { label: "Business DNA",       href: "/growthmind/business-dna",       icon: Dna,        desc: "Configure your brand & offers" },
                    { label: "Strategy Builder",   href: "/growthmind/strategy",           icon: Rocket,     desc: "30/60/90-day growth plans" },
                    { label: "Campaign Factory",   href: "/growthmind/campaign-factory",   icon: Zap,        desc: "AI-generated campaigns" },
                    { label: "Content Studio",     href: "/growthmind/content-studio",     icon: BookOpen,   desc: "Generate & publish content" },
                    { label: "Full Report",        href: "/growthmind/reports",            icon: Megaphone,  desc: "Trends & marketing report" },
                  ].map(item => (
                    <Link
                      key={item.href}
                      to={item.href}
                      className="rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-emerald-500/[0.05] hover:border-emerald-500/20 p-3 transition-all group"
                    >
                      <item.icon className="h-4 w-4 text-emerald-400 mb-2" />
                      <p className="text-xs font-medium leading-snug">{item.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{item.desc}</p>
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {/* ── 7 CMO Intelligence Cards ─────────────────────────────── */}
            <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.03] overflow-hidden">
              <div className="px-4 py-3 border-b border-violet-500/10 flex items-center justify-between">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-violet-400" />
                  Proactive CMO Intelligence
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] border-violet-500/25 text-violet-300 hover:bg-violet-500/10"
                  onClick={handleRunCMOAnalysis}
                  disabled={runningCMO}
                >
                  {runningCMO
                    ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    : <RefreshCw className="mr-1 h-3 w-3" />
                  }
                  {runningCMO ? "Analysing…" : "Run CMO Analysis"}
                </Button>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">

                {/* Card 1 — Highest Opportunity Service */}
                <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.03] p-3 space-y-1.5">
                  <p className="text-[10px] text-emerald-300/70 uppercase tracking-wide font-semibold flex items-center gap-1">
                    <Target className="h-3 w-3" /> Top Service
                  </p>
                  {topService ? (
                    <>
                      <p className="text-sm font-bold text-emerald-200 leading-snug">{topService.serviceName}</p>
                      <p className="text-[10px] text-muted-foreground leading-snug">{topService.recommendation}</p>
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-1 rounded-full bg-white/[0.06]">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${topService.totalScore}%` }} />
                        </div>
                        <span className="text-[10px] text-emerald-400 font-semibold">{topService.totalScore}/100</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">Run CMO Analysis to score your services</p>
                  )}
                </div>

                {/* Card 2 — Fastest Growing Audience */}
                <div className="rounded-lg border border-sky-500/15 bg-sky-500/[0.03] p-3 space-y-1.5">
                  <p className="text-[10px] text-sky-300/70 uppercase tracking-wide font-semibold flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> Fastest Growing Signal
                  </p>
                  {growingTrend ? (
                    <>
                      <p className="text-sm font-bold text-sky-200 leading-snug">{growingTrend.label}</p>
                      <span className={cn(
                        "inline-block text-[9px] rounded px-1.5 py-0.5 font-semibold",
                        growingTrend.classification === "Growing" ? "bg-emerald-500/15 text-emerald-400" :
                        growingTrend.classification === "Declining" ? "bg-red-500/15 text-red-400" :
                        "bg-amber-500/15 text-amber-400"
                      )}>{growingTrend.classification} {growingTrend.changePercent != null ? `${growingTrend.changePercent > 0 ? "+" : ""}${growingTrend.changePercent}%` : ""}</span>
                      <p className="text-[10px] text-muted-foreground leading-snug">{growingTrend.actionHint}</p>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">No trend signals yet — run CMO Analysis</p>
                  )}
                </div>

                {/* Card 3 — Top Campaign Proposal */}
                <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.03] p-3 space-y-1.5">
                  <p className="text-[10px] text-amber-300/70 uppercase tracking-wide font-semibold flex items-center gap-1">
                    <Zap className="h-3 w-3" /> Campaign Proposal
                  </p>
                  {topCampaign ? (
                    <>
                      <p className="text-sm font-bold text-amber-200 leading-snug line-clamp-2">{topCampaign.title}</p>
                      <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">{topCampaign.reason}</p>
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {(topCampaign.channels ?? []).slice(0, 3).map((ch: string) => (
                          <span key={ch} className="text-[9px] rounded border border-amber-500/20 bg-amber-500/[0.06] text-amber-300 px-1 py-0.5">{ch}</span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">No campaign proposals yet — run CMO Analysis</p>
                  )}
                </div>

                {/* Card 4 — Top Video Campaign Proposal */}
                <div className="rounded-lg border border-pink-500/15 bg-pink-500/[0.03] p-3 space-y-1.5">
                  <p className="text-[10px] text-pink-300/70 uppercase tracking-wide font-semibold flex items-center gap-1">
                    <Clapperboard className="h-3 w-3" /> Video Concept
                  </p>
                  {topVideo ? (
                    <>
                      <p className="text-sm font-bold text-pink-200 leading-snug line-clamp-2">{topVideo.title}</p>
                      <p className="text-[10px] text-muted-foreground italic leading-snug line-clamp-2">{topVideo.hook}</p>
                      <p className="text-[10px] text-muted-foreground/70">{topVideo.platform} · {topVideo.duration}</p>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">No video concepts yet — run CMO Analysis</p>
                  )}
                </div>

                {/* Card 5 — Funnel Drop-Off */}
                <div className="rounded-lg border border-orange-500/15 bg-orange-500/[0.03] p-3 space-y-1.5">
                  <p className="text-[10px] text-orange-300/70 uppercase tracking-wide font-semibold flex items-center gap-1">
                    <Filter className="h-3 w-3" /> Funnel Priority
                  </p>
                  {topStage ? (
                    <>
                      <p className="text-sm font-bold text-orange-200 leading-snug capitalize">{topStage[0]}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {topStage[1]} lead{topStage[1] !== 1 ? "s" : ""} stalled at this stage
                      </p>
                      <p className="text-[10px] text-orange-300/70">Add a re-engagement sequence here</p>
                    </>
                  ) : stalledPipeline.length === 0 ? (
                    <p className="text-[11px] text-emerald-400">No stalled leads — pipeline healthy!</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">Pipeline data loading…</p>
                  )}
                </div>

                {/* Card 6 — Recommended Budget */}
                <div className="rounded-lg border border-violet-500/15 bg-violet-500/[0.03] p-3 space-y-1.5">
                  <p className="text-[10px] text-violet-300/70 uppercase tracking-wide font-semibold flex items-center gap-1">
                    <DollarSign className="h-3 w-3" /> Budget Guidance
                  </p>
                  <p className="text-sm font-bold text-violet-200 leading-snug">{recommendedBudget.split(" ")[0]}</p>
                  <p className="text-[10px] text-muted-foreground leading-snug">{recommendedBudget.split(" ").slice(1).join(" ")}</p>
                  {topCampaign?.budgetEstimate && (
                    <p className="text-[10px] text-violet-300/70">Top campaign: {topCampaign.budgetEstimate}</p>
                  )}
                </div>

                {/* Card 7 — Recommended Next Action */}
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3 space-y-1.5 col-span-1 sm:col-span-2 lg:col-span-1">
                  <p className="text-[10px] text-emerald-300/70 uppercase tracking-wide font-semibold flex items-center gap-1">
                    <ChevronRight className="h-3 w-3" /> Next Action
                  </p>
                  <p className="text-xs font-semibold text-emerald-200 leading-snug">{nextAction}</p>
                  {topCampaign && (
                    <div className="pt-1 space-y-1">
                      <p className="text-[10px] text-muted-foreground">Audience: {topCampaign.audience}</p>
                      <p className="text-[10px] text-muted-foreground">Expected: {topCampaign.expectedOutcome}</p>
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* Score breakdown */}
            <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
              <p className="text-sm font-semibold mb-3">Score Breakdown</p>
              <div className="space-y-2.5">
                {score.dimensions.map(d => (
                  <div key={d.key} className="flex items-center gap-3">
                    <div className="w-36 shrink-0">
                      <p className="text-xs text-muted-foreground">{d.label}</p>
                    </div>
                    <div className="flex-1 h-1.5 rounded-full bg-white/[0.06]">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          d.color === "emerald" ? "bg-emerald-500" :
                          d.color === "amber"   ? "bg-amber-500" : "bg-red-500"
                        )}
                        style={{ width: `${d.pct}%` }}
                      />
                    </div>
                    <div className="w-12 text-right">
                      <span className="text-xs font-medium tabular-nums">{d.score}/{d.max}</span>
                    </div>
                    <div className="flex-1 min-w-0 hidden lg:block">
                      <p className="text-[11px] text-muted-foreground truncate">{d.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Provider Awareness */}
            {providerData && (() => {
              const growthCategories: Array<{
                key: string;
                label: string;
                icon: React.ElementType;
                color: string;
                gateMsg: string;
                href: string;
              }> = [
                { key: "analytics",   label: "Analytics",          icon: BarChart3, color: "text-teal-400",   gateMsg: "Connect Google Analytics to unlock traffic & conversion data", href: "/settings/providers" },
                { key: "advertising", label: "Advertising",        icon: Megaphone, color: "text-yellow-400", gateMsg: "Connect Google Ads or Meta Ads to track campaign performance",  href: "/settings/providers" },
                { key: "video",       label: "Video Generation",   icon: Video,     color: "text-pink-400",   gateMsg: "Connect a video provider to generate AI-powered video ads",    href: "/growthmind/video-studio" },
                { key: "image",       label: "Image Generation",   icon: Image,     color: "text-orange-400", gateMsg: "Connect an image provider to auto-generate creative assets",   href: "/growthmind/content-studio" },
              ];

              const notConnected = growthCategories.filter(c => {
                const summary = providerData.byCategory[c.key];
                return !summary || summary.connectedCount === 0;
              });

              if (notConnected.length === 0) return null;

              return (
                <div className="rounded-xl border border-white/[0.06] bg-card/40 overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-emerald-400" />
                    <p className="text-sm font-semibold">Unlock More GrowthMind Capabilities</p>
                  </div>
                  <div className="p-3 space-y-2">
                    {notConnected.map(cat => {
                      const Icon = cat.icon;
                      return (
                        <div key={cat.key} className="flex items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] shrink-0">
                            <Icon className={cn("h-4 w-4", cat.color)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold">{cat.label}</p>
                            <p className="text-[11px] text-muted-foreground">{cat.gateMsg}</p>
                          </div>
                          <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                          <Link
                            to={cat.href as any}
                            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
                          >
                            <Link2 className="h-3 w-3" />
                            Connect →
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
