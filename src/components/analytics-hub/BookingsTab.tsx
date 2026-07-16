import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarCheck, AlertTriangle } from "lucide-react";
import { getBookingAnalytics } from "@/lib/analytics-hub/analytics-hub.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { StatCard, EmptyState, TableHead, Th } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  ChartCard, CompactDonut, TabError, CHART, fmtInt,
} from "./shared";

export function BookingsTab({ filter }: { filter: AnalyticsFilterState }) {
  const fn = useServerFn(getBookingAnalytics);
  const q = useQuery({
    queryKey: ["analytics-bookings", filterKey(filter)],
    queryFn: () => fn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (q.isLoading) return <LoadingProgress label="Loading bookings" estimatedMs={7000} />;
  if (q.error) return <TabError message={`Could not load bookings: ${String((q.error as any)?.message ?? q.error)}`} />;
  const d: any = q.data ?? {};
  if (d.error) return <TabError message={`Booking error: ${d.error}`} />;
  const byStatus: Record<string, number> = d.byStatus ?? {};
  const bySource: any[] = d.bySource ?? [];
  const statusData = Object.entries(byStatus).map(([name, value]) => ({ name, value: Number(value) }));
  const anomalies = d.anomalies ?? { count: 0, sampleLeadIds: [] };

  return (
    <div className="space-y-5 px-6 pt-5">
      {anomalies.count > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Booked but marked need-to-call</p>
            <p className="mt-0.5 text-amber-200/80">
              {anomalies.count} lead{anomalies.count === 1 ? "" : "s"} {anomalies.count === 1 ? "has" : "have"} a booking but {anomalies.count === 1 ? "is" : "are"} still marked “need to call”. Review these to avoid duplicate outreach.
            </p>
            {anomalies.sampleLeadIds.length > 0 && (
              <p className="mt-1 font-mono text-[11px] text-amber-200/60">
                {anomalies.sampleLeadIds.slice(0, 20).join(", ")}
              </p>
            )}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total bookings" tone="success" value={fmtInt(d.total)} />
        {statusData.slice(0, 3).map((s) => (
          <StatCard key={s.name} label={s.name} tone="info" value={fmtInt(s.value)} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ChartCard title="Bookings by Status" icon={CalendarCheck} color={CHART.success}>
          <CompactDonut centerLabel="Bookings" centerValue={fmtInt(d.total)} data={statusData} />
        </ChartCard>
        <ChartCard title="Bookings by Source" icon={CalendarCheck} color={CHART.primary}>
          {bySource.length === 0 ? (
            <EmptyState icon={CalendarCheck} title="No source data" message="No booking sources in this range." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <TableHead><Th>Source</Th><Th>Bookings</Th></TableHead>
                <tbody>
                  {bySource.map((s, i) => (
                    <tr key={i} className="h-10 border-b border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="px-3 py-2 font-medium">{s.source}</td>
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
