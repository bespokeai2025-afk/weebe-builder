import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  Phone, Users, Calendar, TrendingUp, ArrowUpRight, ArrowRight,
  Radio, PhoneCall, PhoneMissed, Bot, CheckCircle2, Circle, Voicemail, Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiCard, PanelCard } from "@/components/dashboard/PageShell";
import { LiveCallsPanel } from "@/components/dashboard/LiveCallsPanel";
import { GeometryAccent } from "@/components/dashboard/GeometryAccent";
import { LeadsTrendChart } from "@/components/dashboard/LeadsTrendChart";
import { DataState, MetricSummary } from "@/components/dashboard/PerformanceCharts";
import { AgentPerformancePanel } from "@/components/analytics-hub/AgentPerformancePanel";
import { CHART } from "@/components/dashboard/chart-model";
import { DecisionBrief } from "@/components/dashboard/DecisionBrief";
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

  const { data, isLoading, isError, refetch } = useQuery({
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
  const metricsUnavailable = isLoading || !data;
  const liveAgents = agents.filter((a) => a.isLive);

  const closedReached = data?.totals.closedLeadsReached ?? 0;
  const closedTotal   = data?.totals.closedLeads ?? 0;
  const closedPct     = closedTotal > 0 ? Math.round((closedReached / closedTotal) * 100) : 0;

  // Primary KPI icons use the uniform WEBEE brand-gold treatment (Phase
  // 2A.3) via KpiCard's iconTone="brand" — no per-metric decorative color
  // needed here anymore. This is identity/decoration, not semantic status.
  const kpis = [
    {
      title: "Total Leads",
      detail: data?.isWbah ? `${daysSince ? `Last ${daysSince} days` : "All time"} · excludes closed leads` : "All-time leads",
      value: metricsUnavailable ? "—" : (data?.totals.leads ?? 0),
      icon:  Users,
    },
    {
      title: "Qualified",
      detail: data?.isWbah ? "All-time positive sentiment" : "Currently interested or qualified",
      value: metricsUnavailable ? "—" : (data?.totals.qualified ?? 0),
      icon:  TrendingUp,
    },
    {
      title: "Calls Completed",
      detail: data?.totals.calls ? `${Math.round(data.totals.callsCompleted / data.totals.calls * 100)}% of ${data.totals.calls.toLocaleString()} all-time calls` : "No calls recorded yet",
      value: metricsUnavailable ? "—" : (data?.totals.callsCompleted ?? 0),
      icon:  Phone,
    },
    {
      title: "Bookings",
      detail: `${data?.totals.upcomingBookings ?? 0} upcoming · ${data?.totals.pendingBookings ?? 0} pending`,
      value: metricsUnavailable ? "—" : (data?.totals.bookings ?? 0),
      icon:  Calendar,
    },
    {
      title: "Closed Leads Reached",
      value: isLoading ? "—" : `${closedReached} / ${closedTotal}`,
      hint:  isLoading ? undefined : `${closedPct}% contacted`,
      icon:  PhoneMissed,
    },
  ];

  // Real current-state totals for the conversion snapshot below — scalar
  // "right now" counts, not a fabricated time-series/trend.
  const flowStages = [
    { label: "Leads",          value: data?.totals.leads ?? 0,          icon: Users,      iconBg: "bg-blue-500/15",    iconColor: "text-blue-400",    barColor: "bg-blue-400" },
    { label: "Qualified",      value: data?.totals.qualified ?? 0,      icon: TrendingUp, iconBg: "bg-emerald-500/15", iconColor: "text-emerald-400", barColor: "bg-emerald-400" },
    { label: "Calls Completed",value: data?.totals.callsCompleted ?? 0, icon: Phone,      iconBg: "bg-violet-500/15",  iconColor: "text-violet-400",  barColor: "bg-violet-400" },
    { label: "Bookings",       value: data?.totals.bookings ?? 0,       icon: Calendar,   iconBg: "bg-amber-500/15",   iconColor: "text-warning",   barColor: "bg-amber-400" },
  ];
  const flowMax = Math.max(1, ...flowStages.map((s) => s.value));

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
      {/* Page header — the low-content zone the Phase 2A.3 audit identified
          as the right home for the quiet brand-accent geometry (replacing
          the old oversized Hexagon watermark that used to sit inside the
          Conversion Snapshot card, competing with its data). Hidden below
          md: a low-content header still shouldn't consume mobile height. */}
      <div className="relative mb-7 flex flex-wrap items-center justify-between gap-4">
        <GeometryAccent
          variant="quiet"
          className="absolute -right-2 -top-6 hidden h-20 w-28 md:block"
        />
        <div><p className="mb-2 text-xs font-medium uppercase tracking-widest text-brand">Your workspace</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">Turn conversations into your next opportunity.</p></div>
        <div className="relative flex items-center gap-2"><Button asChild variant="outline" size="sm"><Link to="/analytics">View analytics<ArrowUpRight className="ml-2 h-3.5 w-3.5" /></Link></Button><Button asChild size="sm" className="gap-2">{agentsQ.isSuccess && agents.length === 0 ? <Link to="/agents/new"><Plus className="h-3.5 w-3.5" />Create agent</Link> : <Link to="/calls" search={{ vm: undefined }}><Phone className="h-3.5 w-3.5" />Review calls</Link>}</Button></div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-6">
        {isError && <div role="alert" className="lg:col-span-12 flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{data ? "Your summary couldn't be refreshed" : "Your workspace data is unavailable"}</p><p className="mt-1 text-xs text-muted-foreground">{data ? "Showing the last available summary." : "We haven't replaced missing data with zeros. Try again or sign in to restore your session."}</p></div><Button variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button><Button asChild variant="ghost" size="sm"><Link to="/login" search={{ redirect: "/dashboard" }}>Sign in</Link></Button></div>}

        {/* Prioritized actions from existing workspace signals. */}


        {/* Live call banner — only visible when agents are actively on calls.
            Capped + truncated (Phase: motion/polish pass): with many live
            agents and long real-world names, an unbounded flex-wrap list
            became a cramped multi-row cluster. Each pill truncates its own
            name instead of growing, and anything past 6 collapses to a
            plain count rather than wrapping further. */}
        {liveAgents.length > 0 && (
          <div className="lg:col-span-12">
            <div className="flex flex-wrap items-center gap-2">
              {liveAgents.slice(0, 6).map((agent) => (
                <div
                  key={agent.id}
                  className="flex max-w-[200px] items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 transition-colors hover:bg-emerald-500/15"
                >
                  <Radio className="h-3 w-3 shrink-0 text-emerald-600 animate-pulse dark:text-emerald-400" />
                  <span className="truncate text-xs font-medium text-emerald-700 dark:text-emerald-400">{agent.name}</span>
                </div>
              ))}
              {liveAgents.length > 6 && (
                <span className="text-caption text-muted-foreground px-1">
                  +{liveAgents.length - 6} more live
                </span>
              )}
            </div>
          </div>
        )}

        {/* KPI summary */}
        <div className="lg:col-span-12">
          <p className="mb-3 text-xs text-muted-foreground">Workspace snapshot · charts below show their own date ranges</p>

          {/* Mobile: a compact 2-up grid (reusing the existing size="sm"
              layout, not a shrunk version of "lg") so five stacked cards
              don't push Conversion Snapshot far down the page. Closed Leads
              Reached spans full width since it carries a hint line the
              other four don't. */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {kpis.slice(0, 4).map((kpi) => (
              <MetricSummary
                key={kpi.title}
                label={kpi.title}
                value={kpi.value}
                color={kpi.title === "Total Leads" ? CHART.leads : kpi.title === "Qualified" ? CHART.success : kpi.title === "Bookings" ? CHART.accent : CHART.primary}
                detail={metricsUnavailable ? (isLoading ? "Loading summary…" : "Data unavailable") : kpi.detail}
              />
            ))}
          </div>
        </div>

        <div className="lg:col-span-12"><DecisionBrief totals={data?.totals} agents={agentsQ.isSuccess && !agentsQ.isError ? agents : undefined} loading={isLoading} stale={isError} /></div>

        {/* WBAH CRM lead breakdown — unchanged business logic, repositioned only */}
        {!isLoading && data?.isWbah && data?.wbahBreakdown && (
          <details className="lg:col-span-12 rounded-xl border border-border bg-card/60 p-4">
            <summary className="w-fit cursor-pointer rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              CRM lead breakdown · {daysSince ? `last ${daysSince} days` : "all time"}
            </summary>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Raw CRM Leads", value: data.wbahBreakdown.rawCrmLeads,  icon: Users,       iconBg: "bg-blue-500/15",    iconColor: "text-blue-400" },
                { label: "Called",        value: data.wbahBreakdown.called,        icon: PhoneCall,   iconBg: "bg-violet-500/15",  iconColor: "text-violet-400" },
                { label: "Positive",      value: data.wbahBreakdown.positive,      icon: TrendingUp,  iconBg: "bg-emerald-500/15", iconColor: "text-emerald-400" },
                { label: "Neutral",       value: data.wbahBreakdown.neutral,       icon: Circle,      iconBg: "bg-amber-500/15",   iconColor: "text-warning" },
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
          </details>
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
                    <Voicemail className="h-4 w-4 shrink-0 text-warning" />
                    <span className="text-xs text-warning">
                      <span className="font-semibold">{data!.totals.voicemailsExcluded}</span>
                      {" "}voicemail{data!.totals.voicemailsExcluded === 1 ? "" : "s"} screened — excluded from totals above
                    </span>
                    <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-warning/60" />
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
            Leads Created Over Time (Phase 2B.2): the one trend classified
            READY NOW in the Phase 2B.1 analytics audit, since every lead
            has a real, immutable created_at. Not a qualification, closed,
            or conversion metric — see getLeadsCreatedTrend's own doc comment. */}
        <div className="lg:col-span-8">
          <LeadsTrendChart />
        </div>

        {/* AI agent activity */}
        <div className="lg:col-span-4">
          <div className="viz-panel">
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
              <div className="h-[52px] rounded-xl skeleton-shimmer" />
            ) : agentsQ.isError && !agentsQ.data ? (
              <DataState title="Agents couldn't be loaded" detail="Your agents have not been removed. Try reconnecting to your workspace." retry={() => void agentsQ.refetch()} />
            ) : agents.length === 0 ? (
              // Agents are a core WEBEE object, not a generic empty list — this
              // gets a stronger, dedicated treatment rather than the standard
              // dashed-border EmptyState primitive used elsewhere. Centered
              // within the panel's own h-full height (Phase 2A.4) so it reads
              // as a deliberate, balanced composition beside Lead Activity
              // rather than a short block sitting at the top with dead space
              // below — this only affects the empty state; the populated
              // agent list below fills height naturally with its own rows.
              <div className="flex flex-col items-start gap-3 py-4 text-left">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/15 text-brand">
                  <Bot className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-base font-semibold text-foreground">Your first conversation starts here</p>
                  <p className="mt-1 max-w-[220px] text-caption text-muted-foreground">
                    Create your first AI receptionist agent to start handling calls automatically.
                  </p>
                </div>
                <Button asChild size="sm" className="gap-1.5">
                  <Link to="/agents/new">
                    <Plus className="h-3.5 w-3.5" /> Create your first agent
                  </Link>
                </Button>
              </div>
            ) : (
                <div className="flex flex-col gap-2">
                  {agents.slice(0, 3).map((agent) => (
                    <div
                      key={agent.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                        agent.isLive
                          ? "border-emerald-500/25 bg-emerald-500/10"
                          : "border-border bg-card/60"
                      }`}
                    >
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        agent.isLive ? "bg-emerald-500/15" : "bg-muted"
                      }`}>
                        {agent.isLive
                          ? <Radio className="h-3.5 w-3.5 text-emerald-600 animate-pulse dark:text-emerald-400" />
                          : <Bot className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold truncate">{agent.name}</p>
                          {agent.isLive && (
                            <span className="text-metadata text-emerald-700 font-medium shrink-0 dark:text-emerald-500">Live</span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          <Badge variant="secondary" className="text-metadata px-1.5 py-0 h-4">
                            {FLOW_LABELS[agent.agentType] ?? agent.agentType}
                          </Badge>
                          {agent.isDeployed ? (
                            <span className="flex items-center gap-1 text-metadata text-emerald-700/80 font-medium dark:text-emerald-500/70">
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
            <div className="mt-5 border-t border-border/60 pt-4"><p className="text-xs text-muted-foreground">Closed leads contacted</p><p className="mt-1 text-xl font-semibold tabular-nums">{metricsUnavailable ? "—" : `${closedReached} / ${closedTotal}`}</p><p className="mt-1 text-xs text-muted-foreground">{!metricsUnavailable && closedTotal > 0 ? `${closedPct}% contacted` : "Contact rate unavailable"}</p></div>
          </div>
        </div>

        <div className="lg:col-span-6"><AgentPerformancePanel enabled={!!data} /></div>
        {/* Conversion Snapshot — unchanged calculations, relocated below the
            new Lead Activity chart per Phase 2B.2 layout. Still a CURRENT-
            STATE snapshot (today's real totals at each stage), not a trend. */}
        <div className="lg:col-span-6">
          {/* Tightened density (Phase 2A.4) — this is a SECONDARY business
              summary beside Lead Activity, not a second hero section: smaller
              icon chips, less row padding, less header margin. Calculations
              and real counts/bars are byte-for-byte unchanged. */}
          <div className="viz-panel">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Activity breakdown</h2>
                <p className="text-xs text-muted-foreground mt-1">Current counts · separate measures, not a conversion funnel</p>
              </div>
            </div>

            {isLoading ? (
              <div className="h-24 rounded-xl skeleton-shimmer" />
            ) : !data ? <DataState title="Activity summary is unavailable" detail="Restore your data connection to view these counts." /> : (
              <div className="flex flex-col gap-0.5">
                {flowStages.map((stage, i) => {
                  const pct = Math.round((stage.value / flowMax) * 100);
                  return (
                    <div key={stage.label} className="flex items-center gap-3">
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${stage.iconBg}`}>
                        <stage.icon className={`h-3.5 w-3.5 ${stage.iconColor}`} />
                      </div>
                      <div className="min-w-0 flex-1 py-2">
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <span className="text-sm text-muted-foreground">{stage.label}</span>
                          <span className="text-sm font-bold tabular-nums text-foreground">{stage.value}</span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/60">
                          <div
                            className={`h-full rounded-full ${stage.barColor}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Live call monitoring — SSE architecture and behavior untouched */}
        <div className="lg:col-span-12">
          <LiveCallsPanel />
        </div>

        {/* Recent leads — hidden for WBAH (summaries managed separately) */}
        {!data?.isWbah && data?.recentLeads && data.recentLeads.length > 0 && (
          <div className="lg:col-span-12">
            <div className="rounded-xl border border-border bg-card/60 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <p className="text-label text-muted-foreground">
                  Recent Leads
                </p>
                <Button asChild variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground">
                  <Link to="/leads" search={{ id: undefined }}>
                    View all <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <caption className="sr-only">Most recent leads for this workspace</caption>
                  <thead>
                    <tr className="border-b border-border/60">
                      <th scope="col" className="px-4 py-2 text-left text-label text-muted-foreground">Name</th>
                      <th scope="col" className="px-4 py-2 text-left text-label text-muted-foreground">Phone</th>
                      <th scope="col" className="px-4 py-2 text-left text-label text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentLeads.map((lead: any) => (
                      <tr key={lead.id} className="h-11 border-b border-border/50 last:border-0 hover:bg-muted/40 transition-colors">
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
