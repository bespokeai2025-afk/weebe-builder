import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Users, PhoneCall, CalendarCheck, Smile, TrendingUp, DollarSign,
  Trophy, AlertTriangle, Lightbulb, BarChart3,
} from "lucide-react";
import { getAnalyticsOverview } from "@/lib/analytics-hub/analytics-hub.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { StatCard } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  ChartCard, CompactDonut, MetricTile, InsightCard, TabError,
  CHART, SENTIMENT_COLORS, gbp, pct, fmtInt,
} from "./shared";

export function OverviewTab({ filter }: { filter: AnalyticsFilterState }) {
  const fn = useServerFn(getAnalyticsOverview);
  const q = useQuery({
    queryKey: ["analytics-overview", filterKey(filter)],
    queryFn: () => fn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (q.isLoading) return <LoadingProgress label="Loading overview" estimatedMs={7000} />;
  if (q.error) return <TabError message={`Could not load overview: ${String((q.error as any)?.message ?? q.error)}`} />;
  const d: any = q.data ?? {};
  if (d.error) return <TabError message={`Overview error: ${d.error}`} />;

  const calls = d.calls ?? {};
  const leads = d.leads ?? {};
  const sentiment = d.sentiment ?? {};
  const rates = d.rates ?? {};
  const cost = d.cost ?? {};

  return (
    <div className="space-y-5 px-6 pt-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Leads (new)" tone="primary" value={fmtInt(leads.new)} hint={`${fmtInt(leads.total)} total`} />
        <StatCard label="Calls" tone="info" value={fmtInt(calls.total)} hint={`${fmtInt(calls.connected)} connected`} />
        <StatCard label="Bookings" tone="success" value={fmtInt(d.bookings)} hint={`${pct(rates.booking)} of calls`} />
        <StatCard label="Qualified" tone="warning" value={fmtInt(leads.qualified)} hint={`${pct(rates.qualification)} rate`} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile label="Connection rate" value={pct(rates.connection)} color={CHART.success} icon={TrendingUp} />
        <MetricTile label="Conversion rate" value={pct(rates.conversion)} color={CHART.primary} icon={Users} />
        <MetricTile label="Callbacks" value={fmtInt(d.callbacks)} color={CHART.accent} icon={PhoneCall} />
        <MetricTile label="Follow-ups created" value={fmtInt(d.followUpsCreated)} color={CHART.pink} icon={CalendarCheck} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ChartCard title="Call Outcomes" icon={PhoneCall} color={CHART.primary}>
          <CompactDonut
            centerLabel="Calls"
            centerValue={fmtInt(calls.total)}
            data={[
              { name: "Connected", value: calls.connected ?? 0 },
              { name: "Missed", value: calls.missed ?? 0 },
              { name: "Voicemail", value: calls.voicemail ?? 0 },
              { name: "Failed", value: calls.failed ?? 0 },
            ]}
          />
        </ChartCard>
        <ChartCard title="Sentiment" icon={Smile} color={CHART.warning}>
          <CompactDonut
            colors={SENTIMENT_COLORS}
            centerLabel="Positive"
            centerValue={pct(sentiment.positiveRate)}
            data={[
              { name: "Positive", value: sentiment.positive ?? 0 },
              { name: "Neutral", value: sentiment.neutral ?? 0 },
              { name: "Negative", value: sentiment.negative ?? 0 },
            ]}
          />
        </ChartCard>
        <ChartCard title="Cost & ROI" icon={DollarSign} color={CHART.success}>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <MetricTile label="Total cost" value={gbp(cost.totalCents)} color={CHART.warning} />
            <MetricTile label="Est. revenue" value={gbp(cost.estRevenueCents)} color={CHART.success} />
            <MetricTile label="ROI" value={`${cost.roi ?? 0}%`} color={cost.roi >= 0 ? CHART.success : CHART.danger} />
            <MetricTile label="Cost / booking" value={gbp(cost.perBookingCents)} color={CHART.accent} />
          </div>
        </ChartCard>
      </div>

      {!d.isWbah && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {d.bestCampaign?.name ? (
            <InsightCard tone="success" icon={Trophy} title="Best campaign">
              <span className="font-medium text-foreground">{d.bestCampaign.name}</span> — {pct(d.bestCampaign.score)} connection
              rate. {d.bestAgent ? `Top agent: ${d.bestAgent}.` : ""}
            </InsightCard>
          ) : (
            <InsightCard tone="primary" icon={BarChart3} title="Campaign performance">
              No campaign KPI reports in this range yet.
            </InsightCard>
          )}
          {d.biggestIssue ? (
            <InsightCard tone="danger" icon={AlertTriangle} title="Biggest issue">
              <span className="font-medium text-foreground">{d.biggestIssue.campaign ?? d.biggestIssue.type}</span>
              {d.biggestIssue.reason ? ` — ${d.biggestIssue.reason}` : ""}
            </InsightCard>
          ) : d.nextAction ? (
            <InsightCard tone="warning" icon={Lightbulb} title={`Next action${d.nextAction.priority ? ` (${d.nextAction.priority})` : ""}`}>
              <span className="font-medium text-foreground">{d.nextAction.title}</span>
              {d.nextAction.detail ? ` — ${d.nextAction.detail}` : ""}
            </InsightCard>
          ) : (
            <InsightCard tone="success" icon={Trophy} title="All clear">
              No blocking issues detected in this range.
            </InsightCard>
          )}
        </div>
      )}
    </div>
  );
}
