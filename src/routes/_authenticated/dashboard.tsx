import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  Phone, Users, Calendar, TrendingUp, ArrowUpRight, ArrowRight,
  Radio, PhoneCall, PhoneMissed, Bot, CheckCircle2, Circle, Voicemail, Hexagon, Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiCard, PanelCard } from "@/components/dashboard/PageShell";
import { LiveCallsPanel } from "@/components/dashboard/LiveCallsPanel";
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

  const [daysSince, setDaysSince] = useState<number | undefined>(30);

  useEffect(() => {
    const stored = localStorage.getItem("wbahDaysFilter") ?? "30";
    setDaysSince(stored === "all" ? undefined : parseInt(stored, 10));

    const onStorage = (e: StorageEvent) => {
      if (e.key === "wbahDaysFilter") {
        const val = e.newValue ?? "30";
        setDaysSince(val === "all" ? undefined : parseInt(val, 10));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey:             ["dashboard-overview", daysSince],
    queryFn:              () => getStats({ data: { daysSince } }),
    staleTime:            5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError:         false,
  });

  const agentsQ = useQuery({
    queryKey:             ["dashboard-workspace-agents"],
    queryFn:              () => getAgentsFn(),
    staleTime:            5 * 60_000,
    refetchInterval:      5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError:         false,
  });

  const agents     = agentsQ.data ?? [];
  const liveAgents = agents.filter((a) => a.isLive);

  const closedReached = data?.totals.closedLeadsReached ?? 0;
  const closedTotal   = data?.totals.closedLeads ?? 0;
  const closedPct     = closedTotal > 0 ? Math.round((closedReached / closedTotal) * 100) : 0;

  // Real, already-computed signal (getOverviewStats.totals.callsFailed) — the
  // only data-backed "needs attention" source available without a new query.
  // Other attention categories (deployments, integrations, auth) have no
  // existing dashboard-reachable data source yet and are deliberately not
  // shown rather than faked.
  const callsFailed = data?.totals.callsFailed ?? 0;

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

  // Real current-state totals for the conversion snapshot below — scalar
  // "right now" counts, not a fabricated time-series/trend.
  const flowStages = [
    { label: "Leads",          value: data?.totals.leads ?? 0,          icon: Users,      iconBg: "bg-blue-500/15",    iconColor: "text-blue-400",    barColor: "bg-blue-400" },
    { label: "Qualified",      value: data?.totals.qualified ?? 0,      icon: TrendingUp, iconBg: "bg-emerald-500/15", iconColor: "text-emerald-400", barColor: "bg-emerald-400" },
    { label: "Calls Completed",value: data?.totals.callsCompleted ?? 0, icon: Phone,      iconBg: "bg-violet-500/15",  iconColor: "text-violet-400",  barColor: "bg-violet-400" },
    { label: "Bookings",       value: data?.totals.bookings ?? 0,       icon: Calendar,   iconBg: "bg-amber-500/15",   iconColor: "text-amber-400",   barColor: "bg-amber-400" },
  ];
  const flowMax = Math.max(1, ...flowStages.map((s) => s.value));

  return (
    <div className="mx-auto w-full max-w-[1600px] px-8 py-6">
      {/* Page header */}
      <div className="mb-4">
        <h1 className="text-base font-semibold tracking-tight">Dashboard</h1>
        <p className="text-caption text-muted-foreground mt-0.5">Overview of your receptionist activity</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">

        {/* Needs attention — only rendered when a real, already-computed signal exists */}
        {!isLoading && callsFailed > 0 && (
          <div className="lg:col-span-12">
            <Link
              to="/calls"
              search={{ vm: undefined }}
              className="flex items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 transition-colors hover:bg-destructive/10"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/15">
                <PhoneMissed className="h-4 w-4 text-destructive" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">Needs attention</p>
                <p className="text-caption text-muted-foreground">
                  {callsFailed} call{callsFailed === 1 ? "" : "s"} didn't connect — review in Calls
                </p>
              </div>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </div>
        )}

        {/* Live call banner — only visible when agents are actively on calls */}
        {liveAgents.length > 0 && (
          <div className="lg:col-span-12 flex flex-wrap gap-2">
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

        {/* KPI summary */}
        <div className="lg:col-span-12">
          <p className="mb-2 text-label text-muted-foreground">Key Metrics</p>

          {/* Mobile: a compact 2-up grid (reusing the existing size="sm"
              layout, not a shrunk version of "lg") so five stacked cards
              don't push Conversion Snapshot far down the page. Closed Leads
              Reached spans full width since it carries a hint line the
              other four don't. */}
          <div className="grid grid-cols-2 gap-2 sm:hidden">
            {kpis.slice(0, 4).map((kpi) => (
              <KpiCard
                key={kpi.title}
                size="sm"
                label={kpi.title}
                value={kpi.value}
                icon={kpi.icon}
                iconBg={kpi.iconBg}
                iconColor={kpi.iconColor}
              />
            ))}
            <div className="col-span-2">
              <KpiCard
                size="sm"
                label={kpis[4].title}
                value={kpis[4].value}
                icon={kpis[4].icon}
                iconBg={kpis[4].iconBg}
                iconColor={kpis[4].iconColor}
                hint={(kpis[4] as any).hint}
              />
            </div>
          </div>

          {/* Tablet/desktop: unchanged dominant "lg" treatment. */}
          <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {kpis.map((kpi) => (
              <KpiCard
                key={kpi.title}
                size="lg"
                label={kpi.title}
                value={kpi.value}
                icon={kpi.icon}
                iconBg={kpi.iconBg}
                iconColor={kpi.iconColor}
                hint={(kpi as any).hint}
              />
            ))}
          </div>
        </div>

        {/* WBAH CRM lead breakdown — unchanged business logic, repositioned only */}
        {!isLoading && data?.isWbah && data?.wbahBreakdown && (
          <div className="lg:col-span-12">
            <p className="mb-2 text-label text-muted-foreground">
              CRM Lead Breakdown
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Raw CRM Leads", value: data.wbahBreakdown.rawCrmLeads,  icon: Users,       iconBg: "bg-blue-500/15",    iconColor: "text-blue-400" },
                { label: "Called",        value: data.wbahBreakdown.called,        icon: PhoneCall,   iconBg: "bg-violet-500/15",  iconColor: "text-violet-400" },
                { label: "Positive",      value: data.wbahBreakdown.positive,      icon: TrendingUp,  iconBg: "bg-emerald-500/15", iconColor: "text-emerald-400" },
                { label: "Neutral",       value: data.wbahBreakdown.neutral,       icon: Circle,      iconBg: "bg-amber-500/15",   iconColor: "text-amber-400" },
                { label: "Disqualified",  value: data.wbahBreakdown.disqualified,  icon: PhoneMissed, iconBg: "bg-rose-500/15",    iconColor: "text-rose-400" },
                { label: "Callbacks",     value: data.wbahBreakdown.callbacks,     icon: Calendar,    iconBg: "bg-sky-500/15",     iconColor: "text-sky-400" },
              ].map((c) => (
                <KpiCard
                  key={c.label}
                  label={c.label}
                  value={c.value}
                  icon={c.icon}
                  iconBg={c.iconBg}
                  iconColor={c.iconColor}
                />
              ))}
            </div>
          </div>
        )}

        {/* Voicemail screened banner */}
        {!isLoading && (data?.totals.voicemailsExcluded ?? 0) > 0 && (
          <div className="lg:col-span-12">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/calls"
                    search={{ vm: "only" }}
                    className="flex items-center gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-left transition-colors hover:bg-amber-500/10 w-full"
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
          </div>
        )}

        {/* Primary business insight area — the dashboard's visual anchor.
            This is a CURRENT-STATE snapshot (today's real totals at each
            stage), not a time-series trend: getOverviewStats has no history
            to trend from, so nothing here is fabricated or simulated. Once
            a historical data layer exists (separately approved), this is
            the slot a real trend chart replaces. */}
        <div className="lg:col-span-8">
          <PanelCard className="relative h-full overflow-hidden border-t-2 border-t-brand">
            <Hexagon
              className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 text-brand/[0.05]"
              strokeWidth={1}
            />
            <div className="relative">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Conversion Snapshot</p>
                  <p className="text-caption text-muted-foreground mt-0.5">Current totals across the lead journey</p>
                </div>
              </div>

              {isLoading ? (
                <div className="h-32 animate-pulse rounded-xl bg-muted" />
              ) : (
                <div className="flex flex-col gap-1">
                  {flowStages.map((stage, i) => {
                    const pct = Math.max(4, Math.round((stage.value / flowMax) * 100));
                    return (
                      <div key={stage.label} className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${stage.iconBg}`}>
                          <stage.icon className={`h-4 w-4 ${stage.iconColor}`} />
                        </div>
                        <div className="min-w-0 flex-1 py-1.5">
                          <div className="flex items-baseline justify-between gap-2 mb-1">
                            <span className="text-caption text-muted-foreground">{stage.label}</span>
                            <span className="text-sm font-bold tabular-nums text-foreground">{stage.value}</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${stage.barColor}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        {i < flowStages.length - 1 && (
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 hidden sm:block" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </PanelCard>
        </div>

        {/* AI agent activity */}
        <div className="lg:col-span-4">
          <PanelCard className="h-full">
            <div className="flex items-center justify-between mb-3">
              <p className="text-label text-muted-foreground">Agents</p>
              {agents.length > 0 && (
                <Button asChild variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground">
                  <Link to="/my-agents">
                    Manage <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </Button>
              )}
            </div>

            {agentsQ.isLoading ? (
              <div className="h-[52px] animate-pulse rounded-xl bg-muted" />
            ) : agents.length === 0 ? (
              // Agents are a core WEBEE object, not a generic empty list — this
              // gets a stronger, dedicated treatment rather than the standard
              // dashed-border EmptyState primitive used elsewhere.
              <div className="flex flex-col items-center gap-3 rounded-xl border border-brand/20 bg-brand/[0.04] px-5 py-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/15 text-brand">
                  <Bot className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">No agents yet</p>
                  <p className="mt-1 max-w-[220px] text-caption text-muted-foreground">
                    Create your first AI receptionist agent to start handling calls automatically.
                  </p>
                </div>
                <Button asChild size="sm" className="w-full gap-1.5">
                  <Link to="/agents/new">
                    <Plus className="h-3.5 w-3.5" /> Create your first agent
                  </Link>
                </Button>
              </div>
            ) : (
                <div className="flex flex-col gap-2">
                  {agents.map((agent) => (
                    <div
                      key={agent.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
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
                            <span className="text-metadata text-emerald-500 font-medium shrink-0">Live</span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          <Badge variant="secondary" className="text-metadata px-1.5 py-0 h-4">
                            {FLOW_LABELS[agent.agentType] ?? agent.agentType}
                          </Badge>
                          {agent.isDeployed ? (
                            <span className="flex items-center gap-1 text-metadata text-emerald-500/70 font-medium">
                              <CheckCircle2 className="h-2.5 w-2.5" />Deployed
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-metadata text-muted-foreground">
                              <Circle className="h-2.5 w-2.5" />Draft
                            </span>
                          )}
                          {agent.phoneNumber && (
                            <span className="font-mono text-metadata text-muted-foreground flex items-center gap-1">
                              <PhoneCall className="h-2.5 w-2.5" />{agent.phoneNumber}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
            )}
          </PanelCard>
        </div>

        {/* Live call monitoring — SSE architecture and behavior untouched */}
        <div className="lg:col-span-12">
          <LiveCallsPanel />
        </div>

        {/* Recent leads — hidden for WBAH (summaries managed separately) */}
        {!data?.isWbah && data?.recentLeads && data.recentLeads.length > 0 && (
          <div className="lg:col-span-12">
            <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                <p className="text-label text-muted-foreground">
                  Recent Leads
                </p>
                <Button asChild variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground">
                  <Link to="/leads">
                    View all <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <caption className="sr-only">Most recent leads for this workspace</caption>
                  <thead>
                    <tr className="border-b border-white/[0.04]">
                      <th scope="col" className="px-4 py-2 text-left text-label text-muted-foreground">Name</th>
                      <th scope="col" className="px-4 py-2 text-left text-label text-muted-foreground">Phone</th>
                      <th scope="col" className="px-4 py-2 text-left text-label text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentLeads.map((lead: any) => (
                      <tr key={lead.id} className="h-11 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-2.5 font-medium text-sm">{lead.full_name?.trim() || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{lead.phone || "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className="rounded-full bg-muted px-2 py-0.5 text-metadata capitalize text-muted-foreground">
                            {lead.status ?? "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
