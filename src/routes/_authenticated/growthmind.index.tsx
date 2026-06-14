import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  TrendingUp, Loader2, RefreshCw, Target, Megaphone,
  PhoneCall, Users, Calendar, ArrowRight, Lightbulb, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { getGrowthMindData } from "@/lib/growthmind/growthmind.functions";
import { computeGrowthScore } from "@/lib/growthmind/growthmind.score";
import { generateGrowthRecommendations } from "@/lib/growthmind/growthmind.recommendations";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/growthmind/")({
  head: () => ({ meta: [{ title: "GrowthMind — Webee" }] }),
  component: GrowthMindOverview,
});

function StatCard({ label, value, sub, color = "emerald" }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
      <p className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-[0.08em] font-medium">{label}</p>
      <p className={cn("text-2xl font-bold tabular-nums", `text-${color}-400`)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function GrowthMindOverview() {
  const fn = useServerFn(getGrowthMindData);
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["growthmind-data"],
    queryFn:  () => fn(),
    staleTime: 60_000,
  });

  const score = computeGrowthScore(data);
  const recs  = generateGrowthRecommendations(data);
  const criticalRecs = recs.filter(r => r.priority === "critical");
  const highRecs     = recs.filter(r => r.priority === "high");

  const scoreColor = score.total >= 70 ? "text-emerald-400" : score.total >= 40 ? "text-amber-400" : "text-red-400";
  const barColor   = score.total >= 70 ? "bg-emerald-500" : score.total >= 40 ? "bg-amber-500" : "bg-red-500";

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-5xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
              GrowthMind Overview
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">Your AI-powered revenue intelligence dashboard</p>
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
                  <p className="text-[10px] text-muted-foreground mt-0.5 font-semibold uppercase tracking-[0.1em]">Growth Score</p>
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

            {/* Key metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <StatCard label="Total Leads"       value={data?.leads.total ?? 0}           sub={`${data?.leads.newLast7 ?? 0} new this week`} />
              <StatCard label="Conversion Rate"   value={`${data?.leads.conversionRate ?? 0}%`} sub={`${data?.leads.sales ?? 0} sales closed`} color="emerald" />
              <StatCard label="Calls (30d)"        value={data?.calls.total ?? 0}            sub={`${data?.calls.successRate ?? 0}% success rate`} color="blue" />
              <StatCard label="Active Campaigns"  value={data?.campaigns.active ?? 0}       sub={`${data?.campaigns.total ?? 0} total campaigns`} color="purple" />
              <StatCard label="Bookings"           value={data?.bookings.total ?? 0}         sub={`${data?.bookings.last7 ?? 0} this week`} color="amber" />
              <StatCard label="Follow-Up Coverage" value={`${data?.leads.followUpCoverage ?? 0}%`} sub="of active leads contacted" color={data?.leads.followUpCoverage >= 75 ? "emerald" : "amber"} />
              <StatCard label="Stale Leads"        value={data?.leads.staleCount ?? 0}       sub="14+ days without update" color={data?.leads.staleCount > 10 ? "red" : "amber"} />
              <StatCard label="WhatsApp (30d)"     value={data?.whatsapp.total ?? 0}         sub={`${data?.whatsapp.inbound ?? 0} inbound messages`} color="emerald" />
            </div>

            {/* Alerts + quick links */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Top issues */}
              <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    Top Issues
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

              {/* Quick actions */}
              <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.06]">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <Lightbulb className="h-3.5 w-3.5 text-emerald-400" />
                    Quick Actions
                  </p>
                </div>
                <div className="p-3 grid grid-cols-2 gap-2">
                  {[
                    { label: "AI Assistant",        href: "/growthmind/chat",             icon: TrendingUp,  desc: "Ask GrowthMind anything" },
                    { label: "Lead Opportunities",  href: "/growthmind/lead-opportunities", icon: Target,    desc: "Find revenue in your pipeline" },
                    { label: "Campaigns",           href: "/growthmind/campaigns",        icon: Megaphone,   desc: "View campaign performance" },
                    { label: "Full Report",         href: "/growthmind/reports",          icon: Users,       desc: "Download marketing report" },
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

            {/* Score dimension detail */}
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

          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
