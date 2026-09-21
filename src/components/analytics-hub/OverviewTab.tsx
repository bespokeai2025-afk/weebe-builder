import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowUpRight, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { getAnalyticsOverview, getCallAnalyticsDeep } from "@/lib/analytics-hub/analytics-hub.functions";
import { Button } from "@/components/ui/button";
import { type AnalyticsFilterState, filterPayload, filterKey, useAnalyticsEntitlements, gbp, pct } from "./shared";
import { CHART, dailySeries } from "@/components/dashboard/chart-model";
import { DataState, MetricSummary, RankedBars, TrendPlot } from "@/components/dashboard/PerformanceCharts";
import { AgentPerformancePanel } from "./AgentPerformancePanel";

export function OverviewTab({ filter }: { filter: AnalyticsFilterState }) {
  const fn = useServerFn(getAnalyticsOverview);
  const timelineFn = useServerFn(getCallAnalyticsDeep);
  const { has, loading: accessLoading } = useAnalyticsEntitlements();
  const q = useQuery({ queryKey: ["analytics-overview", filterKey(filter)], queryFn: () => fn({ data: filterPayload(filter) }), staleTime: 60_000, throwOnError: false });
  const d = q.data;
  const unavailable = !!(q.error || d?.error);
  const ready = !!d && !d.error && !q.error;
  const allowed = has("analytics_advanced");
  // WBAH's daily endpoint ignores agent filtering. Never imply it is filtered.
  const unsupportedFilter = !!d?.isWbah && !!filter.agentId;
  const timeline = useQuery({ queryKey: ["analytics-overview-timeline", filterKey(filter)], queryFn: () => timelineFn({ data: filterPayload(filter) }), enabled: ready && !accessLoading && allowed && !unsupportedFilter, staleTime: 60_000, throwOnError: false });
  const series = timeline.data && !timeline.data.error ? dailySeries(timeline.data.volumeByDay, timeline.data.range) : [];
  const calls = d?.calls;
  const leads = d?.leads;
  const value = (n: number | undefined) => ready && n != null ? n.toLocaleString() : "—";
  const outcomeRows = [
    { name: "Connected", value: calls?.connected ?? 0, color: CHART.success },
    { name: "Missed", value: calls?.missed ?? 0, color: CHART.warning },
    { name: "Voicemail", value: calls?.voicemail ?? 0, color: CHART.neutral },
    { name: "Failed", value: calls?.failed ?? 0, color: CHART.danger },
    { name: "Other / unclassified", value: Math.max(0, (calls?.total ?? 0) - (calls?.connected ?? 0) - (calls?.missed ?? 0) - (calls?.voicemail ?? 0) - (calls?.failed ?? 0)), color: CHART.neutral },
  ];
  const timelineState = !ready ? <DataState loading={q.isLoading} title={q.isLoading ? "Preparing your performance overview" : "Connect to your data to see the trend"} detail={q.isLoading ? "Loading metrics for the selected period." : "Your data is unavailable, not zero. Use Try again above or sign in again."} />
    : !allowed ? <DataState title="Call timeline" detail="Daily call trends are included with advanced analytics." />
    : unsupportedFilter ? <DataState title="Choose All agents to view this timeline" detail="This workspace currently provides a combined daily call timeline." />
    : (timeline.data?.range.days ?? 0) > 366 ? <DataState title="Choose a shorter date range" detail="The daily chart supports up to one year at a time. Your summary above still covers the selected period." />
    : timeline.error || timeline.data?.error ? <DataState title="Call timeline is unavailable" detail="The summary above remains available. Try loading the chart again." retry={() => void timeline.refetch()} />
    : timeline.isPending ? <DataState loading title="Loading call activity" /> : undefined;

  return <div className="space-y-5 px-4 pt-5 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold tracking-tight">Performance at a glance</h2><p className="mt-1 text-sm text-muted-foreground">See what is working. Find your next opportunity.</p></div><span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">Selected period · {d?.range?.timezone || "UTC"}</span></div>
    {unavailable && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4"><AlertTriangle className="h-5 w-5 shrink-0 text-warning" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">We couldn't load your overview</p><p className="mt-1 text-xs text-muted-foreground">Check your connection or sign in again. No metrics are being reported as zero.</p></div><Button variant="outline" size="sm" onClick={() => void q.refetch()}>Try again</Button><Button variant="ghost" size="sm" asChild><Link to="/login" search={{ redirect: "/analytics" }}>Sign in</Link></Button></div>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <MetricSummary label="New leads" value={value(leads?.new)} detail={ready ? `${value(leads?.total)} total leads` : "Selected period"} color={CHART.leads} />
      <MetricSummary label="Calls" value={value(calls?.total)} detail={ready ? `${value(calls?.connected)} connected` : "Selected period"} color={CHART.primary} />
      <MetricSummary label="Bookings" value={value(d?.bookings)} detail={ready && calls?.total ? `${pct(d?.rates?.booking)} of calls` : "Booking rate unavailable"} color={CHART.accent} />
      <MetricSummary label="Qualified leads" value={value(leads?.qualified)} detail={ready && leads?.new ? `${pct(d?.rates?.qualification)} qualification rate` : "Qualification rate unavailable"} color={CHART.success} />
    </div>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <TrendPlot title="Call activity" subtitle={`Daily volume · ${timeline.data?.range?.timezone || d?.range?.timezone || "UTC"}`} data={series} state={timelineState} note="Based on calls returned by the existing analytics service, which applies its retrieval limits. Counts can differ from provider totals." />
      <div className="space-y-5"><AgentPerformancePanel filter={filter} enabled={ready} scope="Selected period" /><div className="viz-panel"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-brand" />Next step</div><p className="text-sm leading-relaxed text-muted-foreground">{!ready ? "Restore your data connection to see where to focus." : calls?.failed ? "Review failed calls to identify connection issues and missed opportunities." : (leads?.new ?? 0) === 0 ? "Create and test an agent to start capturing new enquiries." : "Review your recent conversations and follow up on interested leads."}</p><Button asChild variant="outline" size="sm" className="mt-4 gap-2"><Link to="/calls" search={{ vm: undefined }}>Review calls<ArrowUpRight className="h-3.5 w-3.5" /></Link></Button></div></div>
    </div>
    {ready && <><div className="viz-panel flex flex-wrap gap-x-8 gap-y-4 text-sm"><p><span className="text-muted-foreground">Callbacks </span><strong className="ml-2 tabular-nums">{value(d.callbacks)}</strong></p><p><span className="text-muted-foreground">Follow-ups created </span><strong className="ml-2 tabular-nums">{value(d.followUpsCreated)}</strong></p>{!d.isWbah && d.bestCampaign?.name && <p><span className="text-muted-foreground">Best campaign </span><strong className="ml-2">{d.bestCampaign.name}</strong></p>}</div>
      {!d.isWbah && (d.biggestIssue || d.nextAction) && <div className="viz-panel"><p className="text-sm font-semibold">{d.biggestIssue ? "Needs attention" : "Suggested next action"}</p><p className="mt-2 text-sm text-muted-foreground">{d.biggestIssue ? [d.biggestIssue.campaign ?? d.biggestIssue.type, d.biggestIssue.reason].filter(Boolean).join(" — ") : [d.nextAction?.title, d.nextAction?.detail].filter(Boolean).join(" — ")}</p></div>}
      <div className="grid items-start gap-5 lg:grid-cols-2"><RankedBars title="Call outcomes" subtitle="Counts for this period · not a conversion funnel" rows={outcomeRows} footer={calls?.total ? `${pct(d?.rates?.connection)} connection rate` : "No calls in this period"} /><RankedBars title="Conversation sentiment" subtitle="Classified calls in the selected period" rows={[{ name: "Positive", value: d?.sentiment?.positive ?? 0, color: CHART.success }, { name: "Neutral", value: d?.sentiment?.neutral ?? 0, color: CHART.neutral }, { name: "Negative", value: d?.sentiment?.negative ?? 0, color: CHART.danger }]} footer="Unclassified sentiment is not treated as positive or negative." /></div>
      <section className="viz-panel"><div className="mb-5"><h2 className="text-base font-semibold">Cost & return</h2><p className="mt-1 text-xs text-muted-foreground">Estimated revenue is not confirmed revenue.</p></div><div className="grid grid-cols-2 gap-5 lg:grid-cols-4">{[
        ["Total cost", gbp(d?.cost?.totalCents)], ["Estimated revenue", gbp(d?.cost?.estRevenueCents)], ["Estimated ROI", d?.cost?.totalCents ? `${d.cost.roi}%` : "—"], ["Cost per booking", d?.bookings ? gbp(d.cost?.perBookingCents) : "—"],
      ].map(([label, amount]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums">{amount}</p></div>)}</div></section></>}
  </div>;
}
