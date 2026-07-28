import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { Timer, AlertTriangle, ArrowUpDown, PhoneCall, Voicemail, CalendarDays } from "lucide-react";
import { getCampaignUsage } from "@/lib/analytics-hub/analytics-hub.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { EmptyState, TableHead, Th } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  ChartCard, MetricTile, ChartTooltip, InsightCard, CHART, gbp, fmtInt,
} from "./shared";

function fmtMin(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })} min`;
}

type SortKey = "minutesUsed" | "totalCalls" | "connectedMinutes" | "minutesThisMonth" | "percentageOfWorkspaceMinutes";

/**
 * Minutes Used per campaign — tiles, usage-over-time chart and sortable
 * per-campaign table (incl. the "Unassigned Campaign" bucket). Works for
 * both standard workspaces and the WBAH dialler view.
 */
export function CampaignUsageSection({ filter }: { filter: AnalyticsFilterState }) {
  const fn = useServerFn(getCampaignUsage);
  const q = useQuery({
    queryKey: ["analytics-campaign-usage", filterKey(filter)],
    queryFn: () => fn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });
  const [sortKey, setSortKey] = useState<SortKey>("minutesUsed");
  const [desc, setDesc] = useState(true);

  const d: any = q.data ?? {};
  const rows = useMemo(() => {
    const campaigns: any[] = d.campaigns ?? [];
    const all = [...campaigns];
    if (d.unassigned && (d.unassigned.totalCalls ?? 0) > 0) all.push(d.unassigned);
    const sorted = all.sort((a, b) => (Number(b[sortKey] ?? 0) - Number(a[sortKey] ?? 0)) * (desc ? 1 : -1));
    return sorted;
  }, [d.campaigns, d.unassigned, sortKey, desc]);

  if (q.isLoading) return <LoadingProgress label="Loading minutes used" estimatedMs={6000} />;
  if (q.error || d.error) {
    return (
      <InsightCard tone="warning" icon={AlertTriangle} title="Minutes used unavailable">
        {String(d.error ?? (q.error as any)?.message ?? "Could not load campaign usage.")}
      </InsightCard>
    );
  }

  const ws: any = d.workspace ?? {};
  const series: any[] = d.series ?? [];

  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => { if (sortKey === key) setDesc((v) => !v); else { setSortKey(key); setDesc(true); } }}
      className={`inline-flex items-center gap-1 ${sortKey === key ? "text-foreground" : ""}`}
    >
      {label} <ArrowUpDown className="h-3 w-3 opacity-60" />
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricTile label="Minutes used" value={fmtMin(ws.minutesUsed)} sub={`${fmtInt(ws.totalCalls)} calls`} icon={Timer} color={CHART.primary} />
        <MetricTile label="Connected minutes" value={fmtMin(ws.connectedMinutes)} icon={PhoneCall} color={CHART.success} />
        <MetricTile label="Voicemail minutes" value={fmtMin(ws.voicemailMinutes)} icon={Voicemail} color={CHART.warning} />
        <MetricTile label="Today" value={fmtMin(ws.minutesToday)} icon={CalendarDays} color={CHART.accent} />
        <MetricTile label="This week" value={fmtMin(ws.minutesThisWeek)} icon={CalendarDays} color={CHART.accent} />
        <MetricTile label="This month" value={fmtMin(ws.minutesThisMonth)} icon={CalendarDays} color={CHART.accent} />
      </div>

      {d.truncated && (
        <InsightCard tone="warning" icon={AlertTriangle} title="Large date range">
          This range has more calls than can be analysed in one pass — minutes cover the most recent calls only. Narrow the range for exact figures.
        </InsightCard>
      )}

      <ChartCard title="Minutes Used Over Time" icon={Timer} color={CHART.primary}>
        {series.length === 0 ? (
          <EmptyState icon={Timer} title="No usage" message="No call minutes recorded in this range." />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="cuMinutes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.primary} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={CHART.primary} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "rgba(255,255,255,0.45)" }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: "rgba(255,255,255,0.45)" }} tickLine={false} axisLine={false} width={44} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="minutesUsed" name="Minutes used" stroke={CHART.primary} strokeWidth={2} fill="url(#cuMinutes)" />
                <Area type="monotone" dataKey="connectedMinutes" name="Connected minutes" stroke={CHART.success} strokeWidth={1.5} fillOpacity={0} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      <ChartCard title="Minutes Used by Campaign" icon={Timer} color={CHART.primary}>
        {rows.length === 0 ? (
          <EmptyState icon={Timer} title="No campaigns" message="No campaign usage found in this range." />
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Campaign</Th>
                <Th>{sortBtn("minutesUsed", "Minutes used")}</Th>
                <Th>{sortBtn("totalCalls", "Calls")}</Th>
                <Th>Avg / call</Th>
                <Th>{sortBtn("connectedMinutes", "Connected min")}</Th>
                <Th>Voicemail min</Th>
                <Th>{sortBtn("minutesThisMonth", "This month")}</Th>
                <Th>{sortBtn("percentageOfWorkspaceMinutes", "% of workspace")}</Th>
                <Th>Cost</Th>
              </TableHead>
              <tbody>
                {rows.map((c: any) => (
                  <tr key={c.campaignId ?? "unassigned"} className="h-10 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2 font-medium">
                      {c.campaignName}
                      {c.campaignId == null && (
                        <span className="ml-2 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmtMin(c.minutesUsed)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtInt(c.totalCalls)}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.averageDurationSeconds ? `${Math.round(c.averageDurationSeconds / 6) / 10} min` : "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtMin(c.connectedMinutes)}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{fmtMin(c.voicemailMinutes)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtMin(c.minutesThisMonth)}</td>
                    <td className="px-3 py-2 tabular-nums">{Number(c.percentageOfWorkspaceMinutes ?? 0)}%</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.totalCostCents != null ? gbp(c.totalCostCents) : "—"}</td>
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
