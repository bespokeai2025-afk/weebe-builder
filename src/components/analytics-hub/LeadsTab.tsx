import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users } from "lucide-react";
import { getLeadAnalytics } from "@/lib/analytics-hub/analytics-hub.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { StatCard, EmptyState, TableHead, Th } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  ChartCard, CompactDonut, TabError, CHART, fmtInt, pct,
} from "./shared";

function humanize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function LeadsTab({ filter }: { filter: AnalyticsFilterState }) {
  const fn = useServerFn(getLeadAnalytics);
  const q = useQuery({
    queryKey: ["analytics-leads", filterKey(filter)],
    queryFn: () => fn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (q.isLoading) return <LoadingProgress label="Loading leads" estimatedMs={7000} />;
  if (q.error) return <TabError message={`Could not load leads: ${String((q.error as any)?.message ?? q.error)}`} />;
  const d: any = q.data ?? {};
  if (d.error === "not_available_for_wbah")
    return <div className="px-6 pt-6"><EmptyState icon={Users} title="Not available" message="Lead analytics is not applicable to this workspace." /></div>;
  if (d.error) return <TabError message={`Lead error: ${d.error}`} />;

  const byStatus: any[] = d.byStatus ?? [];
  const bySource: any[] = d.bySource ?? [];
  const statusData = byStatus.map((s) => ({ name: humanize(String(s.status)), value: Number(s.count) }));

  return (
    <div className="space-y-5 px-6 pt-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="New leads" tone="primary" value={fmtInt(d.newInRange)} />
        <StatCard label="Qualified" tone="success" value={fmtInt(d.qualified)} hint={pct(d.qualificationRate)} />
        <StatCard label="Bookings" tone="info" value={fmtInt(d.bookings)} />
        <StatCard label="Conversion → booking" tone="warning" value={pct(d.conversionRate)} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ChartCard title="Leads by Status" icon={Users} color={CHART.primary}>
          <CompactDonut centerLabel="Leads" centerValue={fmtInt(d.newInRange)} data={statusData} />
        </ChartCard>
        <ChartCard title="Leads by Source" icon={Users} color={CHART.accent}>
          {bySource.length === 0 ? (
            <EmptyState icon={Users} title="No source data" message="No leads in this range." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <TableHead><Th>Source</Th><Th>Leads</Th></TableHead>
                <tbody>
                  {bySource.map((s, i) => (
                    <tr key={i} className="h-10 border-b border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="px-3 py-2 font-medium">{humanize(String(s.source))}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtInt(s.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
