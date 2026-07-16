import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Smile } from "lucide-react";
import { getSentimentAnalytics } from "@/lib/analytics-hub/analytics-hub.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { StatCard, EmptyState, TableHead, Th } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  ChartCard, CompactDonut, TabError, CHART, SENTIMENT_COLORS, pct, fmtInt,
} from "./shared";

export function SentimentTab({ filter }: { filter: AnalyticsFilterState }) {
  const fn = useServerFn(getSentimentAnalytics);
  const q = useQuery({
    queryKey: ["analytics-sentiment", filterKey(filter)],
    queryFn: () => fn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (q.isLoading) return <LoadingProgress label="Loading sentiment" estimatedMs={7000} />;
  if (q.error) return <TabError message={`Could not load sentiment: ${String((q.error as any)?.message ?? q.error)}`} />;
  const d: any = q.data ?? {};
  if (d.error) return <TabError message={`Sentiment error: ${d.error}`} />;
  const counts = d.counts ?? {};
  const rates = d.rates ?? {};
  const byAgent: any[] = d.byAgent ?? [];

  return (
    <div className="space-y-5 px-6 pt-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Positive" tone="success" value={pct(rates.positive)} hint={`${fmtInt(counts.positive)} calls`} />
        <StatCard label="Neutral" tone="warning" value={pct(rates.neutral)} hint={`${fmtInt(counts.neutral)} calls`} />
        <StatCard label="Negative" tone="danger" value={pct(rates.negative)} hint={`${fmtInt(counts.negative)} calls`} />
        <StatCard label="Analysed calls" tone="info" value={fmtInt(d.total)} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ChartCard title="Sentiment Distribution" icon={Smile} color={CHART.warning}>
          <CompactDonut
            colors={SENTIMENT_COLORS}
            centerLabel="Calls"
            centerValue={fmtInt(d.total)}
            data={[
              { name: "Positive", value: counts.positive ?? 0 },
              { name: "Neutral", value: counts.neutral ?? 0 },
              { name: "Negative", value: counts.negative ?? 0 },
              { name: "Unknown", value: counts.unknown ?? 0 },
            ]}
          />
        </ChartCard>
        <ChartCard title="Sentiment by Agent" icon={Smile} color={CHART.primary}>
          {byAgent.length === 0 ? (
            <EmptyState icon={Smile} title="No agent sentiment" message="No sentiment data by agent in this range." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <TableHead>
                  <Th>Agent</Th><Th>Calls</Th><Th>Positive</Th><Th>Negative</Th>
                </TableHead>
                <tbody>
                  {byAgent.map((a, i) => (
                    <tr key={i} className="h-10 border-b border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="px-3 py-2 font-medium">{a.name}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtInt(a.total)}</td>
                      <td className="px-3 py-2 tabular-nums text-emerald-300">{pct(a.positiveRate)}</td>
                      <td className="px-3 py-2 tabular-nums text-red-300">{pct(a.negativeRate)}</td>
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
