import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Phone, Users, Calendar, TrendingUp, ArrowUpRight,
  Radio, PhoneCall, PhoneMissed, Bot, CheckCircle2, Circle, Voicemail,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/PageShell";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getOverviewStats } from "@/lib/dashboard/leads.functions";
import { getWorkspaceAgents } from "@/lib/agents/agents.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Webee" }] }),
  component: DashboardPage,
});

const FLOW_LABELS: Record<string, string> = {
  receptionist:         "Receptionist",
  lead_generation:      "Lead Generation",
  client_qualification: "Client Qualification",
};

function DashboardPage() {
  const getStats      = useServerFn(getOverviewStats);
  const getAgentsFn   = useServerFn(getWorkspaceAgents);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-overview"],
    queryFn:  () => getStats(),
    throwOnError: false,
  });

  const agentsQ = useQuery({
    queryKey:         ["dashboard-workspace-agents"],
    queryFn:          () => getAgentsFn(),
    refetchInterval:  30_000,
    throwOnError:     false,
  });

  const agents     = agentsQ.data ?? [];
  const liveAgents = agents.filter((a) => a.isLive);

  const closedReached = data?.totals.closedLeadsReached ?? 0;
  const closedTotal   = data?.totals.closedLeads ?? 0;
  const closedPct     = closedTotal > 0 ? Math.round((closedReached / closedTotal) * 100) : 0;

  const kpis = [
    {
      title:     "Total Leads",
      value:     isLoading ? "—" : (data?.totals.leads ?? 0),
      icon:      Users,
      iconBg:    "bg-blue-500/15",
      iconColor: "text-blue-400",
    },
    {
      title:     "Qualified",
      value:     isLoading ? "—" : (data?.totals.qualified ?? 0),
      icon:      TrendingUp,
      iconBg:    "bg-emerald-500/15",
      iconColor: "text-emerald-400",
    },
    {
      title:     "Calls Completed",
      value:     isLoading ? "—" : (data?.totals.callsCompleted ?? 0),
      icon:      Phone,
      iconBg:    "bg-violet-500/15",
      iconColor: "text-violet-400",
    },
    {
      title:     "Bookings",
      value:     isLoading ? "—" : (data?.totals.bookings ?? 0),
      icon:      Calendar,
      iconBg:    "bg-amber-500/15",
      iconColor: "text-amber-400",
    },
    {
      title:     "Closed Leads Reached",
      value:     isLoading ? "—" : `${closedReached} / ${closedTotal}`,
      hint:      isLoading ? undefined : `${closedPct}% contacted`,
      icon:      PhoneMissed,
      iconBg:    "bg-rose-500/15",
      iconColor: "text-rose-400",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-5">
      {/* Page header */}
      <div className="mb-5">
        <h1 className="text-base font-semibold tracking-tight">Dashboard</h1>
        <p className="text-[11px] text-muted-foreground mt-0.5">Overview of your receptionist activity</p>
      </div>

      {/* Live call banner — only visible when agents are actively on calls */}
      {liveAgents.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {liveAgents.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3 py-1"
            >
              <Radio className="h-3 w-3 text-emerald-400 animate-pulse" />
              <span className="text-xs font-medium text-emerald-400">{agent.name} — Live</span>
            </div>
          ))}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 mb-3">
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.title}
            label={kpi.title}
            value={kpi.value}
            icon={kpi.icon}
            iconBg={kpi.iconBg}
            iconColor={kpi.iconColor}
            hint={(kpi as any).hint}
          />
        ))}
      </div>

      {/* Voicemail screened banner */}
      {!isLoading && (data?.totals.voicemailsExcluded ?? 0) > 0 && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/calls"
                search={{ vm: "only" }}
                className="mb-5 flex items-center gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-left transition-colors hover:bg-amber-500/10 w-full"
              >
                <Voicemail className="h-4 w-4 shrink-0 text-amber-400" />
                <span className="text-xs text-amber-300/90">
                  <span className="font-semibold">{data!.totals.voicemailsExcluded}</span>
                  {" "}voicemail{data!.totals.voicemailsExcluded === 1 ? "" : "s"} screened — excluded from totals above
                </span>
                <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-amber-400/60" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[260px] text-center text-xs">
              Voicemails are calls where your agent reached an answering machine.
              They are excluded from call counts and durations so your stats reflect real conversations.
              Click to view screened calls.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Agents */}
      {(agentsQ.isLoading || agents.length > 0) && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Agents
            </p>
            <Button asChild variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground">
              <Link to="/my-agents">
                Manage <ArrowUpRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>

          {agentsQ.isLoading ? (
            <div className="h-[52px] animate-pulse rounded-xl bg-muted" />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors ${
                    agent.isLive
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "border-white/[0.06] bg-card/60"
                  }`}
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    agent.isLive ? "bg-emerald-500/15" : "bg-muted"
                  }`}>
                    {agent.isLive
                      ? <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
                      : <Bot className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{agent.name}</p>
                      {agent.isLive && (
                        <span className="text-[10px] text-emerald-500 font-medium shrink-0">Live</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                        {FLOW_LABELS[agent.agentType] ?? agent.agentType}
                      </Badge>
                      {agent.isDeployed ? (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-500/70 font-medium">
                          <CheckCircle2 className="h-2.5 w-2.5" />Deployed
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Circle className="h-2.5 w-2.5" />Draft
                        </span>
                      )}
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

      {/* Recent leads — hidden for WBAH (summaries managed separately) */}
      {!data?.isWbah && data?.recentLeads && data.recentLeads.length > 0 && (
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
              {data.recentLeads.map((lead: any) => (
                <tr key={lead.id} className="h-11 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-2.5 font-medium text-sm">{lead.full_name?.trim() || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{lead.phone || "—"}</td>
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
    </div>
  );
}
