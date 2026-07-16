import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Megaphone, AlertTriangle } from "lucide-react";
import { getCampaignAnalytics } from "@/lib/analytics-hub/analytics-hub.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { EmptyState, TableHead, Th } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  ChartCard, InsightCard, TabError, CHART, gbp, pct, fmtInt,
} from "./shared";

export function CampaignsTab({ filter }: { filter: AnalyticsFilterState }) {
  const fn = useServerFn(getCampaignAnalytics);
  const q = useQuery({
    queryKey: ["analytics-campaigns", filterKey(filter)],
    queryFn: () => fn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (q.isLoading) return <LoadingProgress label="Loading campaigns" estimatedMs={7000} />;
  if (q.error) return <TabError message={`Could not load campaigns: ${String((q.error as any)?.message ?? q.error)}`} />;
  const d: any = q.data ?? {};
  if (d.error === "not_available_for_wbah")
    return <div className="px-6 pt-6"><EmptyState icon={Megaphone} title="Not available" message="Campaign analytics is not applicable to this workspace." /></div>;
  if (d.error) return <TabError message={`Campaign error: ${d.error}`} />;

  const campaigns: any[] = d.campaigns ?? [];
  const failures: any[] = d.failures ?? [];

  return (
    <div className="space-y-5 px-6 pt-5">
      <ChartCard title="Campaign Performance" icon={Megaphone} color={CHART.primary}>
        {campaigns.length === 0 ? (
          <EmptyState icon={Megaphone} title="No campaigns" message="No campaigns found in this range." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Campaign</Th><Th>Status</Th><Th>Calls</Th><Th>Connected</Th>
                <Th>Conn. rate</Th><Th>Positive</Th><Th>Cost</Th><Th>Cost / conn.</Th>
              </TableHead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="h-11 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 font-medium">{c.name}</td>
                    <td className="px-3 py-2.5 text-xs capitalize text-muted-foreground">{c.status}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtInt(c.callsTotal)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtInt(c.callsConnected)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{pct(c.connectionRate)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtInt(c.positiveSentiment)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{gbp(c.totalCostCents)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{gbp(c.costPerConnectedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      {failures.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-red-400" /> Campaign failures
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {failures.map((f, i) => (
              <InsightCard key={i} tone="danger" icon={AlertTriangle} title={`${f.campaign ?? "Campaign"} — ${f.type}`}>
                {f.reason ?? f.error ?? "Failure reported."}
                {f.stage ? <span className="block text-xs text-muted-foreground">Stage: {f.stage}</span> : null}
                {Array.isArray(f.recommendations) && f.recommendations.length > 0 && (
                  <ul className="mt-1.5 list-disc pl-4 text-xs text-foreground/70">
                    {f.recommendations.slice(0, 3).map((r: any, j: number) => (
                      <li key={j}>{typeof r === "string" ? r : r?.action ?? JSON.stringify(r)}</li>
                    ))}
                  </ul>
                )}
              </InsightCard>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
