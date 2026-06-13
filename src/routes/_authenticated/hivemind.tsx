import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Phone, Users, CalendarCheck, MessageSquare, TrendingUp,
  Bot, Loader2, ArrowUp, ArrowDown, Minus, RefreshCw,
  AlertTriangle, CheckCircle2, Lightbulb,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import { getHiveMindPlatformData } from "@/lib/hivemind/hivemind.functions";
import { generateRecommendations } from "@/lib/hivemind/recommendations";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/hivemind")({
  head: () => ({ meta: [{ title: "HiveMind — Webee" }] }),
  component: HiveMindOverview,
});

function StatCard({
  label, value, sub, icon: Icon, color, trend,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; trend?: "up" | "down" | "flat";
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4 flex items-start gap-3">
      <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", `bg-${color}-500/10`)}>
        <Icon className={cn("h-4.5 w-4.5", `text-${color}-400`)} style={{ height: 18, width: 18 }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span className="text-2xl font-bold tabular-nums">{value}</span>
          {trend && (
            trend === "up" ? <ArrowUp className="h-3 w-3 text-emerald-400" /> :
            trend === "down" ? <ArrowDown className="h-3 w-3 text-red-400" /> :
            <Minus className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function AgentPill({ score }: { score: number }) {
  const color = score >= 70 ? "text-emerald-400 bg-emerald-500/10" : score >= 40 ? "text-amber-400 bg-amber-500/10" : "text-red-400 bg-red-500/10";
  return <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums", color)}>{score}</span>;
}

function HiveMindOverview() {
  const fn = useServerFn(getHiveMindPlatformData);
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["hivemind-data"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });

  const recommendations = generateRecommendations(data);
  const critical = recommendations.filter(r => r.priority === "critical");
  const high = recommendations.filter(r => r.priority === "high");

  return (
    <HiveMindShell>
      <div className="px-6 py-5 max-w-5xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Overview</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Executive summary of your platform activity right now</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["hivemind-data"] })}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
            <span className="text-sm">Scanning platform…</span>
          </div>
        ) : (
          <div className="space-y-7">

            {/* Alert banner */}
            {(critical.length > 0 || high.length > 0) && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-300">
                    {critical.length > 0 && `${critical.length} critical issue${critical.length > 1 ? "s" : ""}`}
                    {critical.length > 0 && high.length > 0 && " · "}
                    {high.length > 0 && `${high.length} high-priority issue${high.length > 1 ? "s" : ""}`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {critical[0]?.problem ?? high[0]?.problem}
                  </p>
                </div>
                <Button asChild size="sm" variant="ghost" className="h-7 text-xs shrink-0 text-amber-400 hover:text-amber-300">
                  <Link to="/hivemind/recommendations">View →</Link>
                </Button>
              </div>
            )}

            {/* ── TODAY'S ACTIVITY ── */}
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-3">Today's Activity</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Calls Today"       value={data?.today.calls    ?? 0} icon={Phone}         color="blue"    sub="voice calls placed/received" />
                <StatCard label="New Leads"          value={data?.today.leads    ?? 0} icon={Users}         color="violet"  sub="leads added today" />
                <StatCard label="Appointments"       value={data?.today.bookings ?? 0} icon={CalendarCheck} color="emerald" sub="booked today" />
                <StatCard label="WhatsApp Messages"  value={data?.today.messages ?? 0} icon={MessageSquare} color="green"   sub="messages today" />
              </div>
            </section>

            {/* ── 30-DAY PERFORMANCE ── */}
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-3">30-Day Platform Performance</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Total Calls"   value={data?.calls.total       ?? 0}    icon={Phone}         color="blue"   sub={`${data?.calls.successRate ?? 0}% success rate`} />
                <StatCard label="Leads"         value={data?.leads.total       ?? 0}    icon={Users}         color="violet" sub={`${data?.leads.needCall ?? 0} need a call`} />
                <StatCard label="Bookings"      value={data?.bookings.total    ?? 0}    icon={CalendarCheck} color="emerald" sub={`${data?.bookings.recent ?? 0} this week`} />
                <StatCard label="Avg Duration"  value={data?.calls.avgDuration ? `${data.calls.avgDuration}s` : "—"} icon={TrendingUp} color="amber" sub="per call" />
              </div>
            </section>

            {/* ── AGENT PERFORMANCE ── */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Agent Performance</p>
                <Button asChild size="sm" variant="ghost" className="h-6 text-[11px] text-muted-foreground">
                  <Link to="/my-agents">Manage agents →</Link>
                </Button>
              </div>
              {!data?.agentScores?.length ? (
                <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center">
                  <Bot className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">No agents found.</p>
                  <Button asChild size="sm" variant="outline" className="mt-3"><Link to="/my-agents">Create agent</Link></Button>
                </div>
              ) : (
                <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06] bg-white/[0.015]">
                        {["Agent","Score","Calls (30d)","Success","Status","Phone","KB"].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground first:pl-4 last:pr-4">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {data.agentScores.map((a: any) => (
                        <tr key={a.id} className="hover:bg-white/[0.015] transition-colors">
                          <td className="pl-4 pr-3 py-2.5">
                            <p className="font-medium text-xs">{a.name}</p>
                            <p className="text-[10px] text-muted-foreground capitalize">{a.deploymentMode}</p>
                          </td>
                          <td className="px-3 py-2.5"><AgentPill score={a.score} /></td>
                          <td className="px-3 py-2.5 tabular-nums text-xs">{a.callCount}</td>
                          <td className="px-3 py-2.5 text-xs">
                            <span className={cn("font-medium", a.successRate >= 50 ? "text-emerald-400" : a.successRate > 0 ? "text-amber-400" : "text-muted-foreground")}>
                              {a.callCount > 0 ? `${a.successRate}%` : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            {a.deployed
                              ? <span className="rounded-full bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 text-[10px]">Live</span>
                              : <span className="rounded-full bg-red-500/10 text-red-400 px-1.5 py-0.5 text-[10px]">Offline</span>}
                          </td>
                          <td className="px-3 py-2.5 text-[11px]">
                            {a.hasPhone
                              ? <span className="text-emerald-400">✓</span>
                              : <span className="text-muted-foreground/50">—</span>}
                          </td>
                          <td className="pr-4 px-3 py-2.5 text-[11px]">
                            {a.hasKB
                              ? <span className="text-emerald-400">✓</span>
                              : <span className="text-muted-foreground/50">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ── CAMPAIGN PERFORMANCE ── */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Campaign Performance</p>
                <Button asChild size="sm" variant="ghost" className="h-6 text-[11px] text-muted-foreground">
                  <Link to="/campaigns">View campaigns →</Link>
                </Button>
              </div>
              {!data?.campaigns?.stats?.length ? (
                <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-6 text-center">
                  <p className="text-sm text-muted-foreground">No campaigns created yet.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06] bg-white/[0.015]">
                        {["Campaign","Status","Progress","Leads","Completed"].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground first:pl-4 last:pr-4">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {data.campaigns.stats.map((c: any) => (
                        <tr key={c.id} className="hover:bg-white/[0.015] transition-colors">
                          <td className="pl-4 pr-3 py-2.5 text-xs font-medium">{c.name}</td>
                          <td className="px-3 py-2.5">
                            <span className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                              c.status === "running" || c.status === "active" ? "bg-emerald-500/10 text-emerald-400" :
                              c.status === "stopped" || c.status === "paused" ? "bg-amber-500/10 text-amber-400" :
                              "bg-white/[0.05] text-muted-foreground",
                            )}>{c.status}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden min-w-[60px]">
                                <div className="h-full bg-violet-500 rounded-full" style={{ width: `${c.completionPct}%` }} />
                              </div>
                              <span className="text-[11px] text-muted-foreground tabular-nums w-8">{c.completionPct}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-xs tabular-nums">{c.totalLeads}</td>
                          <td className="pr-4 px-3 py-2.5 text-xs tabular-nums">{c.completedCalls}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ── QUICK STATS ROW ── */}
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-3">Channel Overview (30d)</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-white/[0.06] bg-card/40 px-4 py-3">
                  <p className="text-[10px] text-muted-foreground">WhatsApp</p>
                  <p className="text-lg font-bold">{data?.whatsapp.total ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground">{data?.whatsapp.inbound ?? 0} in · {data?.whatsapp.outbound ?? 0} out</p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-card/40 px-4 py-3">
                  <p className="text-[10px] text-muted-foreground">Telephony</p>
                  <p className="text-lg font-bold">{data?.telephony.total ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground">{data?.telephony.inbound ?? 0} inbound</p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-card/40 px-4 py-3">
                  <p className="text-[10px] text-muted-foreground">Email Campaigns</p>
                  <p className="text-lg font-bold">{data?.email.total ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground">{data?.email.active ?? 0} active</p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-card/40 px-4 py-3">
                  <p className="text-[10px] text-muted-foreground">Phone Numbers</p>
                  <p className="text-lg font-bold">{data?.phoneNumbers?.length ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground">assigned numbers</p>
                </div>
              </div>
            </section>

            {/* ── TOP RECOMMENDATIONS ── */}
            {recommendations.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Top Recommendations <span className="text-violet-400">({recommendations.length})</span>
                  </p>
                  <Button asChild size="sm" variant="ghost" className="h-6 text-[11px] text-muted-foreground">
                    <Link to="/hivemind/recommendations">View all →</Link>
                  </Button>
                </div>
                <div className="space-y-2">
                  {recommendations.slice(0, 4).map(r => (
                    <div key={r.id} className="rounded-lg border border-white/[0.05] bg-card/50 px-4 py-3 flex items-start gap-3">
                      <Lightbulb className={cn("h-3.5 w-3.5 shrink-0 mt-0.5",
                        r.priority === "critical" ? "text-red-400" :
                        r.priority === "high" ? "text-orange-400" :
                        r.priority === "medium" ? "text-amber-400" : "text-muted-foreground"
                      )} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium leading-snug">{r.problem}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{r.fix}</p>
                      </div>
                      <PBadge p={r.priority} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {recommendations.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/5 py-8 gap-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-400/60" />
                <p className="text-sm font-semibold text-emerald-300">Platform looks healthy</p>
                <p className="text-xs text-muted-foreground">No issues detected across all monitored areas.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </HiveMindShell>
  );
}

type P = "critical" | "high" | "medium" | "low";
function PBadge({ p }: { p: P }) {
  const s: Record<P, string> = {
    critical: "bg-red-500/15 text-red-400",
    high:     "bg-orange-500/15 text-orange-400",
    medium:   "bg-amber-500/15 text-amber-400",
    low:      "bg-slate-500/15 text-slate-400",
  };
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize shrink-0", s[p])}>{p}</span>;
}
