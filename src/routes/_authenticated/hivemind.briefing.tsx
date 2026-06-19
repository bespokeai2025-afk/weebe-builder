import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Newspaper, TrendingUp, TrendingDown, Minus, Users, CalendarCheck,
  DollarSign, Phone, Loader2, RefreshCw, AlertTriangle, Lightbulb,
  CheckCircle2, Zap, ArrowRight, BarChart3, Bot, Brain,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { HiveMindShell, useHiveMindMode } from "@/components/hivemind/HiveMindShell";
import { MarketingExecutiveSummary } from "@/components/hivemind/MarketingExecutiveSummary";
import { getExecutiveBriefing, type BiRecommendation, type BiRisk } from "@/lib/hivemind/hivemind.bi";
import { proposeHiveMindAction } from "@/lib/hivemind/hivemind.actions";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";

export const Route = createFileRoute("/_authenticated/hivemind/briefing")({
  head: () => ({ meta: [{ title: "Executive Briefing — HiveMind" }] }),
  component: HiveMindBriefingPage,
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
function fmtDollar(n: number) {
  return n === 0 ? "$0" : `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// ── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({
  label, value, prev, unit, icon: Icon, color,
}: {
  label: string; value: number; prev: number; unit?: string;
  icon: React.ElementType; color: string;
}) {
  const diff = value - prev;
  const pct  = prev > 0 ? Math.round((diff / prev) * 100) : 0;
  const up   = diff > 0;
  const flat = diff === 0;
  const TrendIcon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const trendColor = flat ? "text-muted-foreground" : up ? "text-emerald-400" : "text-red-400";

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--card))] px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.04]")}>
          <Icon className={cn("h-3.5 w-3.5", color)} />
        </div>
      </div>
      <p className="text-2xl font-bold tabular-nums">
        {unit === "$" ? fmtDollar(value) : fmt(value)}
        {unit && unit !== "$" && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
      </p>
      <div className={cn("flex items-center gap-1 mt-1.5 text-[11px]", trendColor)}>
        <TrendIcon className="h-3 w-3" />
        {flat ? "No change" : `${up ? "+" : ""}${pct}% vs last month`}
        <span className="text-muted-foreground ml-1">({prev} prior)</span>
      </div>
    </div>
  );
}

// ── Risk badge ────────────────────────────────────────────────────────────────
function RiskBadge({ risk }: { risk: BiRisk }) {
  const s = {
    critical: "border-red-500/30 bg-red-500/[0.06] text-red-300",
    warning:  "border-amber-500/30 bg-amber-500/[0.06] text-amber-300",
    info:     "border-blue-500/20 bg-blue-500/[0.04] text-blue-300",
  }[risk.severity];
  const dot = { critical: "bg-red-400", warning: "bg-amber-400", info: "bg-blue-400" }[risk.severity];
  return (
    <div className={cn("rounded-xl border px-4 py-3 flex items-start gap-3", s)}>
      <div className={cn("h-1.5 w-1.5 rounded-full mt-1.5 shrink-0", dot)} />
      <div className="min-w-0">
        <p className="text-xs font-medium">{risk.title}</p>
        <p className="text-[11px] opacity-70 mt-0.5">{risk.description}</p>
      </div>
    </div>
  );
}

// ── Recommendation card ───────────────────────────────────────────────────────
function RecommendationCard({
  rec, mode, onPropose, proposing,
}: {
  rec: BiRecommendation;
  mode: string;
  onPropose: (rec: BiRecommendation) => void;
  proposing: boolean;
}) {
  const p = { high: "text-red-400 bg-red-500/10 border-red-500/20", medium: "text-amber-400 bg-amber-500/10 border-amber-500/20", low: "text-blue-400 bg-blue-500/10 border-blue-500/20" }[rec.priority];
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--card))] px-4 py-3 flex items-start gap-3">
      <Lightbulb className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-xs font-medium">{rec.title}</p>
          <span className={cn("text-[9px] font-semibold rounded-full px-1.5 py-0.5 border", p)}>
            {rec.priority}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{rec.description}</p>
      </div>
      {mode === "operator" && rec.action_type && (
        <button
          onClick={() => onPropose(rec)}
          disabled={proposing}
          className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-amber-400 hover:bg-amber-500/20 transition-all disabled:opacity-40 shrink-0"
        >
          {proposing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          Propose
        </button>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function HiveMindBriefingPage() {
  const mode        = useHiveMindMode();
  const getBriefFn  = useServerFn(getExecutiveBriefing);
  const proposeFn   = useServerFn(proposeHiveMindAction);
  const qc          = useQueryClient();
  const [proposing, setProposing] = useState(false);
  const [proposeMsg, setProposeMsg] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["hivemind-briefing-exec"],
    queryFn:  () => getBriefFn(),
    staleTime: 120_000,
    throwOnError: false,
  });

  async function handlePropose(rec: BiRecommendation) {
    if (!rec.action_type) return;
    setProposing(true);
    try {
      await proposeFn({ data: {
        title:          rec.title,
        description:    rec.description,
        action_type:    rec.action_type,
        action_payload: rec.action_payload ?? {},
      }});
      setProposeMsg("Action proposed — visit Action Centre to approve");
      qc.invalidateQueries({ queryKey: ["hivemind-actions"] });
      qc.invalidateQueries({ queryKey: ["hivemind-shell-badge"] });
      setTimeout(() => setProposeMsg(null), 5000);
    } finally { setProposing(false); }
  }

  const d  = data;
  const now = new Date();

  return (
    <HiveMindShell>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-white/[0.07] bg-[hsl(var(--background))]/95 backdrop-blur-sm px-5 py-3 flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 ring-1 ring-violet-500/30 shrink-0">
          <Newspaper className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Executive Briefing</p>
          <p className="text-[11px] text-muted-foreground">
            <RelativeTime date={now} short />
          </p>
        </div>
        <div className="flex items-center gap-2">
          {proposeMsg && <p className="text-[11px] text-emerald-400 hidden sm:block">{proposeMsg}</p>}
          <button onClick={() => refetch()} disabled={isFetching}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-all disabled:opacity-40">
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />Loading briefing…
        </div>
      ) : d ? (
        <div className="px-5 py-5 max-w-4xl space-y-6">

          {/* Greeting */}
          <div className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.06] to-violet-500/[0.02] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-violet-500/20 ring-1 ring-violet-500/30 flex items-center justify-center shrink-0">
                <Brain className="h-4.5 w-4.5 text-violet-400" />
              </div>
              <div>
                <p className="text-base font-semibold text-violet-200">{d.greeting}</p>
                <p className="text-[11px] text-violet-400/70 mt-0.5">Here's your platform snapshot for today</p>
              </div>
            </div>
          </div>

          {/* MTD metrics */}
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold mb-3">This Month</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard label="Leads"        value={d.month.leads}    prev={d.prevMonth.leads}    icon={Users}         color="text-violet-400" />
              <MetricCard label="Appointments" value={d.month.bookings} prev={d.prevMonth.bookings} icon={CalendarCheck}  color="text-blue-400" />
              <MetricCard label="Sales"        value={d.month.sales}    prev={d.prevMonth.sales}    icon={CheckCircle2}   color="text-emerald-400" />
              <MetricCard label="Calls"        value={d.month.calls}    prev={d.prevMonth.calls ?? 0} icon={Phone}        color="text-amber-400" />
            </div>
          </div>

          {/* Today's snapshot */}
          {(d.today.leads + d.today.bookings + d.today.calls > 0) && (
            <div className="rounded-xl border border-white/[0.07] bg-[hsl(var(--card))] px-4 py-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold mb-2">Today</p>
              <div className="flex flex-wrap gap-4">
                {d.today.leads > 0 && <span className="text-xs"><span className="font-bold text-violet-300">{d.today.leads}</span> <span className="text-muted-foreground">new leads</span></span>}
                {d.today.bookings > 0 && <span className="text-xs"><span className="font-bold text-blue-300">{d.today.bookings}</span> <span className="text-muted-foreground">bookings</span></span>}
                {d.today.calls > 0 && <span className="text-xs"><span className="font-bold text-amber-300">{d.today.calls}</span> <span className="text-muted-foreground">calls</span></span>}
              </div>
            </div>
          )}

          {/* Performance spotlight */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Top agent */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--card))] px-4 py-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2 font-semibold">Top Agent</p>
              {d.topAgent ? (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <Bot className="h-4 w-4 text-violet-400" />
                    <p className="text-sm font-semibold truncate">{d.topAgent.name}</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {d.topAgent.callCount} calls · {d.topAgent.successRate}% success
                  </p>
                </>
              ) : <p className="text-xs text-muted-foreground italic">No call data yet</p>}
            </div>

            {/* Conversion rate */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--card))] px-4 py-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2 font-semibold">Conversion Rate</p>
              <p className="text-2xl font-bold tabular-nums">{d.conversionRate}%</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">lead → sale</p>
            </div>

            {/* Costs */}
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--card))] px-4 py-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2 font-semibold">AI Call Costs (30d)</p>
              <p className="text-2xl font-bold tabular-nums">{fmtDollar(d.costs.totalDollars)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {Math.round(d.costs.totalMinutes)}m · {fmtDollar(d.costs.costPerLead)}/lead
              </p>
            </div>
          </div>

          {/* Lead velocity */}
          {(d.leadVelocity.thisMonth > 0 || d.leadVelocity.lastMonth > 0) && (
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--card))] px-4 py-3">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Lead Velocity</p>
                <div className={cn("flex items-center gap-1 text-xs font-medium",
                  d.leadVelocity.trend === "up" ? "text-emerald-400" :
                  d.leadVelocity.trend === "down" ? "text-red-400" : "text-muted-foreground")}>
                  {d.leadVelocity.trend === "up" ? <TrendingUp className="h-3.5 w-3.5" /> :
                   d.leadVelocity.trend === "down" ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                  {d.leadVelocity.trend === "flat" ? "Flat" : `${d.leadVelocity.trend === "up" ? "+" : "-"}${d.leadVelocity.pct}% vs last month`}
                </div>
              </div>
              <div className="flex gap-6">
                <div>
                  <p className="text-xs text-muted-foreground">This month</p>
                  <p className="text-xl font-bold">{d.leadVelocity.thisMonth}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last month</p>
                  <p className="text-xl font-bold text-muted-foreground">{d.leadVelocity.lastMonth}</p>
                </div>
                {d.followUpGaps > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Without follow-up</p>
                    <p className="text-xl font-bold text-amber-400">{d.followUpGaps}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Agent rankings */}
          {d.agentRankings.length > 0 && (
            <div className="rounded-xl border border-white/[0.08] bg-[hsl(var(--card))] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Agent Performance</p>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {d.agentRankings.slice(0, 5).map((a, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                    <span className="text-[11px] text-muted-foreground w-4 shrink-0">{i + 1}</span>
                    <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <p className="flex-1 text-xs font-medium truncate">{a.name}</p>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
                      <span>{a.callCount} calls</span>
                      <span className={cn("font-medium", a.successRate > 60 ? "text-emerald-400" : a.successRate > 30 ? "text-amber-400" : "text-red-400")}>
                        {a.successRate}%
                      </span>
                      {!a.deployed && <span className="text-red-400 text-[10px]">NOT DEPLOYED</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Marketing — CMO advisory */}
          <MarketingExecutiveSummary summary={d.growthMind} />

          {/* Risks */}
          {d.risks.length > 0 && (
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold mb-3">Risks</p>
              <div className="space-y-2">
                {d.risks.map((risk, i) => <RiskBadge key={i} risk={risk} />)}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {d.recommendations.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">Recommendations</p>
                {mode === "operator" && (
                  <Link to="/hivemind/actions" className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1">
                    View Action Centre <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
              <div className="space-y-2">
                {d.recommendations.map((rec, i) => (
                  <RecommendationCard key={i} rec={rec} mode={mode} onPropose={handlePropose} proposing={proposing} />
                ))}
              </div>
            </div>
          )}

          {d.risks.length === 0 && d.recommendations.length === 0 && (
            <div className="flex flex-col items-center py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-400/60 mb-2" />
              <p className="text-sm font-medium text-emerald-300">Platform looks healthy</p>
              <p className="text-xs text-muted-foreground mt-1">No risks or recommendations at this time</p>
            </div>
          )}

        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground text-center px-5">
          <Newspaper className="h-8 w-8 mb-3 opacity-40" />
          <p className="text-sm font-medium">Could not load briefing</p>
          <p className="text-xs mt-1">Check your connection and try refreshing</p>
          <button onClick={() => refetch()} className="mt-4 text-xs text-violet-400 hover:text-violet-300 transition-colors">Retry</button>
        </div>
      )}
    </HiveMindShell>
  );
}
