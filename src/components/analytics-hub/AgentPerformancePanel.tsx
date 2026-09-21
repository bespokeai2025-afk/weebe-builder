import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAgentAnalytics } from "@/lib/analytics-hub/analytics-hub.functions";
import { type AnalyticsFilterState, filterKey, filterPayload, useAnalyticsEntitlements } from "./shared";
import { DataState, RankedBars } from "@/components/dashboard/PerformanceCharts";
import { CHART } from "@/components/dashboard/chart-model";

const DEFAULT_FILTER: AnalyticsFilterState = { dateFilter: "30d", customStart: null, customEnd: null, agentId: null, source: null, campaignId: null };
export function AgentPerformancePanel({ filter = DEFAULT_FILTER, enabled = true, scope = "Last 30 days" }: { filter?: AnalyticsFilterState; enabled?: boolean; scope?: string }) {
  const fn = useServerFn(getAgentAnalytics);
  const { has, loading } = useAnalyticsEntitlements();
  const allowed = has("analytics_advanced");
  const q = useQuery({ queryKey: ["analytics-agents", filterKey(filter)], queryFn: () => fn({ data: filterPayload(filter) }), enabled: enabled && !loading && allowed, staleTime: 60_000, throwOnError: false });
  const error = q.error || q.data?.error;
  const rows = [...(q.data?.agents ?? [])].sort((a, b) => b.total - a.total).slice(0, 5).map((a, index) => ({ name: a.name, value: a.total, color: index === 0 ? "var(--brand)" : CHART.accent }));
  if (!allowed) return <section className="viz-panel"><DataState title="Agent performance" detail="Detailed agent comparisons are included with advanced analytics. Your current metrics remain available above." /></section>;
  if (!enabled || loading || q.isPending) return <section className="viz-panel"><DataState loading={enabled} title="Agent performance" detail={enabled ? "Loading your agent comparison." : "Available once workspace data is connected."} /></section>;
  if (error) return <section className="viz-panel"><DataState title="Agent performance is unavailable" detail="We couldn't load agent activity for this period." retry={() => void q.refetch()} /></section>;
  if (!rows.some(row => row.value > 0)) return <section className="viz-panel"><DataState title="No agent activity in this period" detail="Completed activity will appear here. Try a wider date range in Analytics." /></section>;
  return <RankedBars title="Agent performance" subtitle={`${scope} · top 5 by call volume`} rows={rows} color={CHART.accent} footer="Call volume measures workload, not call quality or conversion." />;
}
