import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Workflow } from "lucide-react";
import { getWorkflowAnalytics } from "@/lib/analytics-hub/analytics-hub.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { EmptyState, TableHead, Th } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  ChartCard, TabError, CHART, pct, fmtInt,
} from "./shared";

export function WorkflowsTab({ filter }: { filter: AnalyticsFilterState }) {
  const fn = useServerFn(getWorkflowAnalytics);
  const q = useQuery({
    queryKey: ["analytics-workflows", filterKey(filter)],
    queryFn: () => fn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (q.isLoading) return <LoadingProgress label="Loading workflows" estimatedMs={7000} />;
  if (q.error) return <TabError message={`Could not load workflows: ${String((q.error as any)?.message ?? q.error)}`} />;
  const d: any = q.data ?? {};
  if (d.error === "not_available_for_wbah")
    return <div className="px-6 pt-6"><EmptyState icon={Workflow} title="Not available" message="Workflow analytics is not applicable to this workspace." /></div>;
  if (d.error) return <TabError message={`Workflow error: ${d.error}`} />;
  const workflows: any[] = d.workflows ?? [];

  return (
    <div className="space-y-5 px-6 pt-5">
      <ChartCard title="Workflow Reliability" icon={Workflow} color={CHART.primary}>
        {workflows.length === 0 ? (
          <EmptyState icon={Workflow} title="No workflows" message="No workflow runs in this range." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Workflow</Th><Th>Status</Th><Th>Triggers</Th><Th>Success</Th>
                <Th>Failure</Th><Th>Success rate</Th><Th>Common errors</Th>
              </TableHead>
              <tbody>
                {workflows.map((w) => (
                  <tr key={w.id} className="h-11 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 font-medium">{w.name}</td>
                    <td className="px-3 py-2.5 text-xs capitalize text-muted-foreground">{w.status}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtInt(w.triggers)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-emerald-300">{fmtInt(w.success)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-red-300">{fmtInt(w.failure)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{pct(w.successRate)}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {(w.commonErrors ?? []).slice(0, 2).map((e: any) => `${e.error} (${e.count})`).join("; ") || "—"}
                    </td>
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
