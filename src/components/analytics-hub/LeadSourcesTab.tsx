import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Filter } from "lucide-react";
import { getLeadSourceAnalytics } from "@/lib/analytics-hub/analytics-hub.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { EmptyState, TableHead, Th } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  ChartCard, InsightCard, TabError, CHART, gbp, pct, fmtInt,
} from "./shared";

export function LeadSourcesTab({ filter }: { filter: AnalyticsFilterState }) {
  const fn = useServerFn(getLeadSourceAnalytics);
  const q = useQuery({
    queryKey: ["analytics-lead-sources", filterKey(filter)],
    queryFn: () => fn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (q.isLoading) return <LoadingProgress label="Loading lead sources" estimatedMs={7000} />;
  if (q.error) return <TabError message={`Could not load lead sources: ${String((q.error as any)?.message ?? q.error)}`} />;
  const d: any = q.data ?? {};
  if (d.error === "not_available_for_wbah")
    return <div className="px-6 pt-6"><EmptyState icon={Filter} title="Not available" message="Lead source analytics is not applicable to this workspace." /></div>;
  if (d.error) return <TabError message={`Lead source error: ${d.error}`} />;
  const sources: any[] = d.sources ?? [];

  return (
    <div className="space-y-5 px-6 pt-5">
      {(d.bestSource || d.worstSource) && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {d.bestSource && <InsightCard tone="success" title="Best source">{d.bestSource} — highest qualification rate.</InsightCard>}
          {d.worstSource && <InsightCard tone="warning" title="Worst source">{d.worstSource} — lowest qualification rate.</InsightCard>}
        </div>
      )}
      <ChartCard title="Lead Sources" icon={Filter} color={CHART.primary}>
        {sources.length === 0 ? (
          <EmptyState icon={Filter} title="No leads" message="No leads created in this range." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Source</Th><Th>Leads</Th><Th>Qualified</Th><Th>Qual. rate</Th>
                <Th>Callbacks</Th><Th>Callback rate</Th><Th>Cost / lead</Th>
              </TableHead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.source} className="h-11 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 font-medium">{s.source}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtInt(s.leads)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtInt(s.qualified)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{pct(s.qualifiedRate)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtInt(s.callbacks)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{pct(s.callbackRate)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{gbp(s.costPerLeadCents)}</td>
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
