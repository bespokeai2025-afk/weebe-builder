// ── Marketing Executive Summary (CMO advisory) ────────────────────────────────
// Presents GrowthMind's executive summary inside HiveMind. GrowthMind is the
// advisory CMO that reports up to HiveMind (COO) — it recommends, never executes.
//
// Usage:
//   <MarketingExecutiveSummary />                 // self-fetches the summary
//   <MarketingExecutiveSummary summary={data} />  // uses an already-fetched summary
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2, Megaphone, TrendingUp, AlertTriangle, Lightbulb,
  DollarSign, FileText, ArrowUpRight, Clapperboard, Star,
  Zap, Target, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getGrowthMindExecutiveSummary } from "@/lib/executives/executive-bridge";
import {
  EXECUTIVE_TASK_LABELS,
  type GrowthMindExecutiveSummary,
  type ExecReadiness,
} from "@/lib/executives/executive-council";

// ── helpers ───────────────────────────────────────────────────────────────────
const SEVERITY_STYLE: Record<string, string> = {
  critical: "border-red-500/30 bg-red-500/[0.06] text-red-300",
  high:     "border-amber-500/30 bg-amber-500/[0.06] text-amber-300",
  medium:   "border-sky-500/30 bg-sky-500/[0.06] text-sky-300",
  low:      "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
};

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-400",
  high:     "bg-amber-400",
  medium:   "bg-sky-400",
  low:      "bg-slate-400",
};

const BAR_COLOR: Record<ExecReadiness["color"], string> = {
  emerald: "bg-emerald-500",
  amber:   "bg-amber-500",
  red:     "bg-red-500",
  slate:   "bg-slate-500",
};

function scoreColor(score: number): string {
  return score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";
}

// ── component ─────────────────────────────────────────────────────────────────
export function MarketingExecutiveSummary({
  summary,
  className,
}: {
  summary?: GrowthMindExecutiveSummary | null;
  className?: string;
}) {
  const selfFetch = summary === undefined;
  const getFn = useServerFn(getGrowthMindExecutiveSummary);

  const { data: fetched, isLoading } = useQuery({
    queryKey: ["hivemind-marketing-council"],
    queryFn:  () => getFn(),
    staleTime: 120_000,
    enabled:  selfFetch,
  });

  const gm = (selfFetch ? fetched : summary) ?? null;

  if (selfFetch && isLoading) {
    return (
      <div className={cn("rounded-xl border border-white/[0.07] bg-[hsl(var(--card))] px-4 py-6 flex items-center justify-center gap-2 text-muted-foreground", className)}>
        <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
        <span className="text-xs">Consulting GrowthMind…</span>
      </div>
    );
  }

  if (!gm) {
    return (
      <div className={cn("rounded-xl border border-white/[0.07] bg-[hsl(var(--card))] px-4 py-5 text-center", className)}>
        <Megaphone className="h-6 w-6 text-violet-400/50 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Marketing advisory unavailable right now</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.05] to-transparent overflow-hidden", className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 ring-1 ring-violet-500/30 shrink-0">
          <Megaphone className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-violet-200">GrowthMind · CMO Advisory</p>
            <span className="text-[10px] text-violet-400/70 rounded-full border border-violet-500/30 px-1.5 py-0.5">Recommends only</span>
          </div>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{gm.headline}</p>
        </div>
        <div className="text-right shrink-0">
          <div className={cn("text-2xl font-bold tabular-nums leading-none", scoreColor(gm.marketingReadinessScore))}>
            {gm.marketingReadinessScore}
          </div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mt-1">{gm.grade} · {gm.label}</p>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Readiness bars */}
        {gm.readiness.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2.5">
            {gm.readiness.map((r) => (
              <div key={r.key}>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="tabular-nums font-medium">{r.score}/{r.max}</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", BAR_COLOR[r.color])} style={{ width: `${r.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Revenue opportunity */}
        {(gm.revenueOpportunity.recoverableLeads > 0 || gm.revenueOpportunity.hotLeads > 0) && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2.5 flex items-start gap-2.5">
            <DollarSign className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-emerald-200">
                {gm.revenueOpportunity.recoverableLeads} recoverable · {gm.revenueOpportunity.hotLeads} hot
                {gm.revenueOpportunity.estimatedValue != null && (
                  <span className="text-emerald-300/90"> · ~${gm.revenueOpportunity.estimatedValue.toLocaleString()}</span>
                )}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{gm.revenueOpportunity.note}</p>
            </div>
          </div>
        )}

        {/* Opportunities */}
        {gm.topOpportunities.length > 0 && (
          <Section icon={TrendingUp} iconClass="text-emerald-400" label="Top Opportunities">
            <div className="space-y-1.5">
              {gm.topOpportunities.slice(0, 4).map((o) => (
                <div key={o.id} className="flex items-start gap-2">
                  <span className={cn("h-1.5 w-1.5 rounded-full mt-1.5 shrink-0", SEVERITY_DOT[o.urgency] ?? SEVERITY_DOT.low)} />
                  <p className="text-xs"><span className="font-medium">{o.label}</span> <span className="text-muted-foreground">— {o.detail}</span></p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Risks */}
        {gm.topRisks.length > 0 && (
          <Section icon={AlertTriangle} iconClass="text-amber-400" label="Marketing Risks">
            <div className="space-y-1.5">
              {gm.topRisks.slice(0, 3).map((r) => (
                <div key={r.id} className={cn("rounded-lg border px-3 py-2", SEVERITY_STYLE[r.severity] ?? SEVERITY_STYLE.low)}>
                  <p className="text-xs font-medium">{r.title}</p>
                  <p className="text-[11px] opacity-80 mt-0.5">{r.detail}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Recommended actions */}
        {gm.recommendedActions.length > 0 && (
          <Section icon={Lightbulb} iconClass="text-violet-400" label="CMO Recommendations">
            <div className="space-y-2">
              {gm.recommendedActions.slice(0, 4).map((a) => (
                <div key={a.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", SEVERITY_DOT[a.priority] ?? SEVERITY_DOT.low)} />
                    <p className="text-xs font-medium">{a.label}</p>
                    {a.taskType && (
                      <span className="text-[10px] text-violet-300/90 rounded border border-violet-500/25 bg-violet-500/[0.06] px-1.5 py-0.5">
                        {EXECUTIVE_TASK_LABELS[a.taskType]}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{a.problem}</p>
                  <p className="text-[11px] text-violet-200/80 mt-0.5">→ {a.fix}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Recent marketing reports */}
        {gm.recentMarketingReports.length > 0 && (
          <Section icon={FileText} iconClass="text-sky-400" label="Recent Marketing Reports">
            <div className="space-y-1">
              {gm.recentMarketingReports.slice(0, 4).map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-[11px]">
                  <ArrowUpRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">{r.type}:</span>
                  <span className="font-medium truncate">{r.title}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── CMO Proactive Intelligence Section ──────────────────────────── */}
        {(gm.topService || gm.fastestGrowingSegment || gm.topCampaignProposal || gm.topVideoProposal || gm.recommendedNextAction) && (
          <div className="rounded-lg border border-violet-500/15 bg-violet-500/[0.03] px-3 py-3 space-y-3">
            <p className="text-[11px] text-violet-300/70 uppercase tracking-wide font-semibold flex items-center gap-1.5">
              <Star className="h-3 w-3 text-violet-400" />
              Proactive CMO Intelligence
            </p>

            {/* Top Service */}
            {gm.topService && (
              <div className="flex items-start gap-2">
                <Target className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-emerald-200">
                    Highest Opportunity: <span className="font-bold">{gm.topService.name}</span>
                    <span className="ml-1.5 text-[10px] rounded bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5">{gm.topService.score}/100</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{gm.topService.recommendation}</p>
                </div>
              </div>
            )}

            {/* Fastest Growing Segment */}
            {gm.fastestGrowingSegment && (
              <div className="flex items-start gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-sky-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-sky-200">
                    Growing Signal: <span className="font-bold">{gm.fastestGrowingSegment.label}</span>
                    <span className="ml-1.5 text-[10px] rounded bg-sky-500/15 text-sky-400 px-1.5 py-0.5">{gm.fastestGrowingSegment.classification}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{gm.fastestGrowingSegment.insight}</p>
                </div>
              </div>
            )}

            {/* Top Campaign Proposal */}
            {gm.topCampaignProposal && (
              <div className="flex items-start gap-2">
                <Zap className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-amber-200">Campaign Proposal</p>
                  <p className="text-[11px] font-semibold text-foreground mt-0.5 leading-snug">{gm.topCampaignProposal.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{gm.topCampaignProposal.reason.slice(0, 100)}{gm.topCampaignProposal.reason.length > 100 ? "…" : ""}</p>
                  {gm.topCampaignProposal.channels.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {gm.topCampaignProposal.channels.map(ch => (
                        <span key={ch} className="text-[9px] rounded border border-amber-500/25 bg-amber-500/[0.06] text-amber-300 px-1.5 py-0.5">{ch}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Top Video Proposal */}
            {gm.topVideoProposal && (
              <div className="flex items-start gap-2">
                <Clapperboard className="h-3.5 w-3.5 text-pink-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-pink-200">Video Concept</p>
                  <p className="text-[11px] font-semibold text-foreground mt-0.5">{gm.topVideoProposal.title.split("—")[0].trim()}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 italic">{gm.topVideoProposal.hook.slice(0, 90)}{gm.topVideoProposal.hook.length > 90 ? "…" : ""}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">{gm.topVideoProposal.platform} · {gm.topVideoProposal.duration}</p>
                </div>
              </div>
            )}

            {/* Recommended Next Action */}
            {gm.recommendedNextAction && (
              <div className="rounded-md bg-violet-500/[0.08] border border-violet-500/20 px-2.5 py-2 flex items-start gap-2">
                <ArrowRight className="h-3.5 w-3.5 text-violet-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-violet-300/70 uppercase tracking-wide font-semibold mb-0.5">Recommended Next Action</p>
                  <p className="text-xs text-violet-200 leading-snug">{gm.recommendedNextAction}</p>
                </div>
              </div>
            )}

            {/* Growth Forecast Summary */}
            {gm.growthForecastSummary && (
              <p className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
                <TrendingUp className="h-3 w-3 shrink-0" />
                {gm.growthForecastSummary}
              </p>
            )}
          </div>
        )}

        {/* Missing assets */}
        {gm.missingMarketingAssets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Missing:</span>
            {gm.missingMarketingAssets.map((m, i) => (
              <span key={i} className="text-[10px] rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-muted-foreground">{m}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  icon: Icon, iconClass, label, children,
}: {
  icon: React.ElementType;
  iconClass: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={cn("h-3.5 w-3.5", iconClass)} />
        <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">{label}</p>
      </div>
      {children}
    </div>
  );
}
