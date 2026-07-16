import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Trophy, AlertTriangle, Lightbulb, TrendingDown } from "lucide-react";
import { getAnalyticsOverview, getCampaignAnalytics } from "@/lib/analytics-hub/analytics-hub.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { EmptyState } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  InsightCard, TabError, pct,
} from "./shared";

export function AiInsightsTab({ filter }: { filter: AnalyticsFilterState }) {
  const overviewFn = useServerFn(getAnalyticsOverview);
  const campaignFn = useServerFn(getCampaignAnalytics);

  const oQ = useQuery({
    queryKey: ["analytics-overview", filterKey(filter)],
    queryFn: () => overviewFn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });
  const cQ = useQuery({
    queryKey: ["analytics-campaigns", filterKey(filter)],
    queryFn: () => campaignFn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (oQ.isLoading) return <LoadingProgress label="Generating insights" estimatedMs={8000} />;
  if (oQ.error) return <TabError message={`Could not load insights: ${String((oQ.error as any)?.message ?? oQ.error)}`} />;
  const o: any = oQ.data ?? {};
  if (o.error) return <TabError message={`Insights error: ${o.error}`} />;

  const c: any = cQ.data ?? {};
  const failures: any[] = c.error ? [] : (c.failures ?? []);

  const cards: React.ReactNode[] = [];

  if (o.nextAction) {
    cards.push(
      <InsightCard key="next" tone="primary" icon={Lightbulb} title={`Recommended next action${o.nextAction.priority ? ` (${o.nextAction.priority})` : ""}`}>
        <span className="font-medium text-foreground">{o.nextAction.title}</span>
        {o.nextAction.detail ? ` — ${o.nextAction.detail}` : ""}
      </InsightCard>,
    );
  }
  if (o.biggestIssue) {
    cards.push(
      <InsightCard key="issue" tone="danger" icon={AlertTriangle} title="Biggest issue to fix">
        <span className="font-medium text-foreground">{o.biggestIssue.campaign ?? o.biggestIssue.type}</span>
        {o.biggestIssue.reason ? ` — ${o.biggestIssue.reason}` : ""}
      </InsightCard>,
    );
  }
  if (o.bestCampaign?.name) {
    cards.push(
      <InsightCard key="best" tone="success" icon={Trophy} title="What's working">
        <span className="font-medium text-foreground">{o.bestCampaign.name}</span> is your strongest campaign at{" "}
        {pct(o.bestCampaign.score)} connection rate{o.bestAgent ? `, led by ${o.bestAgent}` : ""}. Consider scaling it.
      </InsightCard>,
    );
  }
  if (o.worstCampaign?.name) {
    cards.push(
      <InsightCard key="worst" tone="warning" icon={TrendingDown} title="Needs attention">
        <span className="font-medium text-foreground">{o.worstCampaign.name}</span> underperforms at {pct(o.worstCampaign.score)}{" "}
        connection rate. Review targeting, script, or call timing.
      </InsightCard>,
    );
  }
  const roi = o.cost?.roi ?? 0;
  cards.push(
    <InsightCard key="roi" tone={roi >= 0 ? "success" : "danger"} icon={Sparkles} title="Financial signal">
      Current ROI is {roi}% on {pct(o.rates?.connection)} connection and {pct(o.sentiment?.positiveRate)} positive sentiment.
      {roi < 0 ? " Costs currently outweigh attributed revenue — tighten spend or improve conversion." : " Keep reinvesting in top performers."}
    </InsightCard>,
  );

  for (const f of failures.slice(0, 4)) {
    const recs = Array.isArray(f.recommendations) ? f.recommendations : [];
    cards.push(
      <InsightCard key={`f-${f.campaignId}-${f.at}`} tone="danger" icon={AlertTriangle} title={`AI fix: ${f.campaign ?? "Campaign"}`}>
        {f.reason ?? f.error ?? "Failure detected."}
        {recs.length > 0 && (
          <ul className="mt-1.5 list-disc pl-4 text-xs text-foreground/70">
            {recs.slice(0, 3).map((r: any, j: number) => (
              <li key={j}>{typeof r === "string" ? r : r?.action ?? JSON.stringify(r)}</li>
            ))}
          </ul>
        )}
      </InsightCard>,
    );
  }

  return (
    <div className="space-y-4 px-6 pt-5">
      {cards.length === 0 ? (
        <EmptyState icon={Sparkles} title="No insights yet" message="Not enough activity in this range to generate insights." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{cards}</div>
      )}
    </div>
  );
}
