import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Repeat } from "lucide-react";
import { getFollowUpAnalytics } from "@/lib/analytics-hub/analytics-hub.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { StatCard, EmptyState, TableHead, Th } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  ChartCard, TabError, CHART, fmtInt,
} from "./shared";

export function FollowUpsTab({ filter }: { filter: AnalyticsFilterState }) {
  const fn = useServerFn(getFollowUpAnalytics);
  const q = useQuery({
    queryKey: ["analytics-followups", filterKey(filter)],
    queryFn: () => fn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (q.isLoading) return <LoadingProgress label="Loading follow-ups" estimatedMs={7000} />;
  if (q.error) return <TabError message={`Could not load follow-ups: ${String((q.error as any)?.message ?? q.error)}`} />;
  const d: any = q.data ?? {};
  if (d.error === "not_available_for_wbah")
    return <div className="px-6 pt-6"><EmptyState icon={Repeat} title="Not available" message="Follow-up analytics is not applicable to this workspace." /></div>;
  if (d.error) return <TabError message={`Follow-up error: ${d.error}`} />;
  const byChannel: any[] = d.byChannel ?? [];

  return (
    <div className="space-y-5 px-6 pt-5">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Created" tone="primary" value={fmtInt(d.created)} />
        <StatCard label="Completed" tone="success" value={fmtInt(d.completed)} />
        <StatCard label="Overdue" tone="danger" value={fmtInt(d.overdue)} />
      </div>
      <ChartCard title="Follow-ups by Channel" icon={Repeat} color={CHART.primary}>
        {byChannel.length === 0 ? (
          <EmptyState icon={Repeat} title="No follow-ups" message="No follow-up tasks in this range." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead><Th>Channel</Th><Th>Count</Th></TableHead>
              <tbody>
                {byChannel.map((c, i) => (
                  <tr key={i} className="h-10 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2 font-medium capitalize">{c.channel}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtInt(c.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
