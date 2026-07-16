import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users } from "lucide-react";
import { getAgentAnalytics } from "@/lib/analytics-hub/analytics-hub.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { EmptyState, TableHead, Th } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  ChartCard, TabError, CHART, gbp, pct, fmtInt, fmtSecs,
} from "./shared";

export function AgentsTab({ filter }: { filter: AnalyticsFilterState }) {
  const fn = useServerFn(getAgentAnalytics);
  const q = useQuery({
    queryKey: ["analytics-agents", filterKey(filter)],
    queryFn: () => fn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (q.isLoading) return <LoadingProgress label="Loading agents" estimatedMs={7000} />;
  if (q.error) return <TabError message={`Could not load agents: ${String((q.error as any)?.message ?? q.error)}`} />;
  const d: any = q.data ?? {};
  if (d.error) return <TabError message={`Agent error: ${d.error}`} />;
  const agents: any[] = d.agents ?? [];

  return (
    <div className="space-y-5 px-6 pt-5">
      <ChartCard title="Agent Performance" icon={Users} color={CHART.primary}>
        {agents.length === 0 ? (
          <EmptyState icon={Users} title="No agent activity" message="No agent calls found in this range." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Agent</Th><Th>Calls</Th><Th>Connected</Th><Th>Conn. rate</Th>
                <Th>Positive</Th><Th>Bookings</Th><Th>Avg dur.</Th><Th>Cost / conn.</Th>
              </TableHead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.agentId} className="h-11 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 font-medium">{a.name}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtInt(a.total)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtInt(a.connected)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{pct(a.connectionRate)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{pct(a.positiveRate)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtInt(a.bookings)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtSecs(a.avgDurationSeconds)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{gbp(a.costPerConnectedCents)}</td>
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
