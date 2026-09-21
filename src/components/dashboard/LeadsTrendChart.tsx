import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLeadsCreatedTrend } from "@/lib/dashboard/leads.functions";
import { CHART } from "./chart-model";
import { DataState, TrendPlot } from "./PerformanceCharts";

/** Only immutable lead-created timestamps; never inferred conversion history. */
export function LeadsTrendChart() {
  const getTrendFn = useServerFn(getLeadsCreatedTrend);
  const [days, setDays] = useState<7 | 30>(30);
  const q = useQuery({
    queryKey: ["dashboard-leads-trend", days], queryFn: () => getTrendFn({ data: { days } }),
    staleTime: 5 * 60_000, refetchOnWindowFocus: false, throwOnError: false,
  });
  return <TrendPlot title="Lead activity" subtitle={`New leads · last ${days} days · workspace timezone`} unit="leads" color={CHART.leads}
    data={q.data ?? []}
    controls={<div role="group" aria-label="Lead activity date range" className="viz-switch">{([7, 30] as const).map(d => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{d}D</button>)}</div>}
    state={q.isLoading ? <DataState loading title="Loading lead activity" detail="Preparing your daily trend." /> : q.isError && !q.data ? <DataState title="Lead activity is unavailable" detail="We couldn't retrieve your data. Your leads have not been changed." retry={() => void q.refetch()} /> : undefined}
    note={q.isError && q.data ? "Showing the last available data. Refresh to try again." : "Counts leads by creation date. This is an activity trend, not a conversion rate."}
  />;
}
