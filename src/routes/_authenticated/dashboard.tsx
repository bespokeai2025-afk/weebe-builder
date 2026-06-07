import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Phone, Users, Calendar, TrendingUp, ArrowUpRight, Radio, PhoneCall } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/PageShell";
import { getOverviewStats } from "@/lib/dashboard/leads.functions";
import { getDashboardLiveAgents } from "@/lib/agents/agents.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Webee" }] }),
  component: DashboardPage,
});

const FLOW_LABELS: Record<string, string> = {
  receptionist: "Receptionist",
  lead_generation: "Lead Generation",
  client_qualification: "Client Qualification",
};

function DashboardPage() {
  const getStats = useServerFn(getOverviewStats);
  const getLiveAgents = useServerFn(getDashboardLiveAgents);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-overview"],
    queryFn: () => getStats(),
  });

  const liveAgentsQ = useQuery({
    queryKey: ["dashboard-live-agents"],
    queryFn: () => getLiveAgents(),
    refetchOnWindowFocus: true,
  });

  const liveAgents = liveAgentsQ.data ?? [];

  const kpis = [
    {
      title: "Total Leads",
      value: isLoading ? "—" : (data?.totals.leads ?? 0),
      icon: Users,
      iconBg: "bg-blue-500/15",
      iconColor: "text-blue-400",
    },
    {
      title: "Qualified",
      value: isLoading ? "—" : (data?.totals.qualified ?? 0),
      icon: TrendingUp,
      iconBg: "bg-emerald-500/15",
      iconColor: "text-emerald-400",
    },
    {
      title: "Calls Completed",
      value: isLoading ? "—" : (data?.totals.callsCompleted ?? 0),
      icon: Phone,
      iconBg: "bg-violet-500/15",
      iconColor: "text-violet-400",
    },
    {
      title: "Bookings",
      value: isLoading ? "—" : (data?.totals.bookings ?? 0),
      icon: Calendar,
      iconBg: "bg-amber-500/15",
      iconColor: "text-amber-400",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-5">
      {/* Page header */}
      <div className="mb-5">
        <h1 className="text-base font-semibold tracking-tight">Dashboard</h1>
        <p className="text-[11px] text-muted-foreground mt-0.5">Overview of your receptionist activity</p>
      </div>

      {/* Live Agents strip */}
      {(liveAgents.length > 0 || liveAgentsQ.isLoading) && (
        <div className="mb-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">
            Live Agents
          </p>
          {liveAgentsQ.isLoading ? (
            <div className="h-[52px] animate-pulse rounded-xl bg-muted" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {liveAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
                    <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{agent.name}</p>
                      <span className="text-[10px] text-emerald-500 font-medium shrink-0">Live</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                        {FLOW_LABELS[agent.agentType] ?? agent.agentType}
                      </Badge>
                      {agent.phoneNumber && (
                        <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                          <PhoneCall className="h-2.5 w-2.5" />{agent.phoneNumber}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-5">
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.title}
            label={kpi.title}
            value={kpi.value}
            icon={kpi.icon}
            iconBg={kpi.iconBg}
            iconColor={kpi.iconColor}
          />
        ))}
      </div>

      {/* Recent leads */}
      {data?.recentLeads && data.recentLeads.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden mb-4">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Recent Leads
            </p>
            <Button asChild variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground">
              <Link to="/leads">
                View all <ArrowUpRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.04]">
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Name</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Phone</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.recentLeads.slice(0, 5).map((lead: any) => (
                <tr key={lead.id} className="h-11 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-2.5 font-medium text-sm">{lead.full_name ?? lead.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{lead.phone ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
                      {lead.status ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm" className="h-8 text-xs gap-1">
          <Link to="/my-agents">
            View agents <ArrowUpRight className="h-3 w-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
