import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DollarSign, TrendingUp } from "lucide-react";
import { getFinancialAnalytics } from "@/lib/analytics-hub/analytics-hub.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { StatCard, EmptyState, TableHead, Th } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  ChartCard, MetricTile, TabError, CHART, gbp, fmtInt,
} from "./shared";

export function FinancialTab({ filter }: { filter: AnalyticsFilterState }) {
  const fn = useServerFn(getFinancialAnalytics);
  const q = useQuery({
    queryKey: ["analytics-financial", filterKey(filter)],
    queryFn: () => fn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (q.isLoading) return <LoadingProgress label="Loading financials" estimatedMs={7000} />;
  if (q.error) return <TabError message={`Could not load financials: ${String((q.error as any)?.message ?? q.error)}`} />;
  const d: any = q.data ?? {};
  if (d.error) return <TabError message={`Financial error: ${d.error}`} />;
  const providers: any[] = Object.entries(d.providerCostsCents ?? {}).map(([name, cents]) => ({ name, cents: Number(cents) }));
  const limits = d.packageLimits;

  return (
    <div className="space-y-5 px-6 pt-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total cost" tone="warning" value={gbp(d.costCents)} />
        <StatCard label="Revenue" tone="success" value={gbp(d.revenueCents)} />
        <StatCard label="Profit" tone={d.profitCents >= 0 ? "success" : "danger"} value={gbp(d.profitCents)} />
        <StatCard label="ROI" tone="primary" value={`${d.roi ?? 0}%`} hint={`${d.marginPercent ?? 0}% margin`} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile label="Cost / lead" value={gbp(d.costPerLeadCents)} color={CHART.accent} icon={DollarSign} />
        <MetricTile label="Cost / qualified" value={gbp(d.costPerQualifiedCents)} color={CHART.primary} icon={DollarSign} />
        <MetricTile label="Cost / booking" value={gbp(d.costPerBookingCents)} color={CHART.pink} icon={DollarSign} />
        <MetricTile label="Minutes used" value={fmtInt(d.minutesUsed)} color={CHART.warning} icon={TrendingUp} />
      </div>

      {limits && (
        <ChartCard title="Package Limits" icon={TrendingUp} color={CHART.success}>
          <div className="grid grid-cols-3 gap-3 pt-1">
            <MetricTile label="Package" value={limits.packageName ?? "—"} color={CHART.primary} />
            <MetricTile label="Included minutes" value={limits.includedVoiceMinutes != null ? fmtInt(limits.includedVoiceMinutes) : "—"} color={CHART.accent} />
            <MetricTile label="Minutes used" value={fmtInt(limits.minutesUsed)} color={CHART.warning} />
          </div>
        </ChartCard>
      )}

      <ChartCard title="Cost by Provider" icon={DollarSign} color={CHART.warning}>
        {providers.length === 0 ? (
          <EmptyState icon={DollarSign} title="No provider costs" message="No provider cost data in this range." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead><Th>Provider</Th><Th>Cost</Th></TableHead>
              <tbody>
                {providers.sort((a, b) => b.cents - a.cents).map((p) => (
                  <tr key={p.name} className="h-10 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2 font-medium capitalize">{p.name}</td>
                    <td className="px-3 py-2 tabular-nums">{gbp(p.cents)}</td>
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
