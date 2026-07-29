import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { Timer, AlertTriangle, ArrowUpDown, PhoneCall, Voicemail, CalendarDays, PoundSterling, CheckCircle2 } from "lucide-react";
import { BILLING_RATE_GBP_PER_MINUTE, formatDurationHuman } from "@/lib/analytics-hub/campaign-usage.shared";
import { getCampaignUsage } from "@/lib/analytics-hub/analytics-hub.functions";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { EmptyState, TableHead, Th } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  ChartCard, MetricTile, ChartTooltip, InsightCard, CHART, fmtInt,
} from "./shared";

function fmtMin(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })} min`;
}

function fmtGbp(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

/** Actual provider cost is recorded in USD cents — never shown as GBP. */
function fmtUsdCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "Provider cost unavailable";
  return (Number(cents) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { timeZone: "Europe/London" });
}

const PROVIDER_STATUS_LABEL: Record<string, string> = {
  verified: "Verified",
  provider_mismatch: "Provider mismatch detected",
  unavailable: "Provider unavailable",
};

type SortKey = "minutesUsed" | "totalCalls" | "connectedMinutes" | "minutesThisMonth" | "percentageOfWorkspaceMinutes" | "rateCostGbp";

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
  const { rows, hiddenDeletedCount } = useMemo(() => {
    const campaigns: any[] = d.campaigns ?? [];
    // Deleted campaigns stay VISIBLE whenever they carry usage in the range —
    // every displayed row + Unassigned must sum to the workspace total.
    // Zero-usage deleted campaigns are pure clutter and are omitted.
    const shown = campaigns.filter((c) => !c.isDeleted || (c.totalCalls ?? 0) > 0);
    const hiddenZero = campaigns.length - shown.length;
    const all = [...shown];
    if (d.unassigned && (d.unassigned.totalCalls ?? 0) > 0) all.push(d.unassigned);
    const sorted = all.sort((a, b) => (Number(b[sortKey] ?? 0) - Number(a[sortKey] ?? 0)) * (desc ? 1 : -1));
    return { rows: sorted, hiddenDeletedCount: hiddenZero };
  }, [d.campaigns, d.unassigned, sortKey, desc]);

  // "This month" only makes sense when the selected range actually covers the
  // current calendar month from its start — otherwise it just repeats
  // "Minutes used" for a narrower window, which is misleading.
  const monthCovered = useMemo(() => {
    if (!d.range?.startIso) return false;
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const s = Date.parse(d.range.startIso);
    return Number.isFinite(s) && s <= monthStart;
  }, [d.range?.startIso]);

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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <MetricTile label="Minutes used" value={fmtMin(ws.minutesUsed)} sub={`${fmtInt(ws.totalCalls)} calls`} icon={Timer} color={CHART.primary} />
        <MetricTile
          label="Client Usage Charge"
          value={fmtGbp(ws.rateCostGbp)}
          sub={`@ £${BILLING_RATE_GBP_PER_MINUTE.toFixed(2)}/min`}
          icon={PoundSterling}
          color={CHART.warning}
        />
        <MetricTile label="Connected minutes" value={fmtMin(ws.connectedMinutes)} icon={PhoneCall} color={CHART.success} />
        <MetricTile label="Voicemail minutes" value={fmtMin(ws.voicemailMinutes)} icon={Voicemail} color={CHART.warning} />
        <MetricTile label="Today" value={fmtMin(ws.minutesToday)} icon={CalendarDays} color={CHART.accent} />
        {monthCovered && (
          <MetricTile label="This month" value={fmtMin(ws.minutesThisMonth)} icon={CalendarDays} color={CHART.accent} />
        )}
      </div>

      {d.range?.startIso && (
        <div className="text-[11px] text-muted-foreground">
          Reporting period: {fmtDateTime(d.range.startIso)} → {fmtDateTime(d.range.endIso)} (Europe/London)
        </div>
      )}

      {/* Provider reconciliation is WEBEE-internal diagnostics: the server only
          includes `provider` for platform admins — clients never receive it. */}
      {d.provider && (
        <InsightCard
          tone={d.provider.status === "verified" ? "success" : "warning"}
          icon={d.provider.status === "verified" ? CheckCircle2 : AlertTriangle}
          title={`Admin diagnostics · Provider reconciliation — ${PROVIDER_STATUS_LABEL[d.provider.status] ?? d.provider.status}`}
        >
          {d.provider.status === "unavailable" ? (
            <>Retell could not be reached to independently verify this period. Figures shown are WEBEE&apos;s stored data; no provider comparison is available right now.</>
          ) : (
            <span className="block space-y-0.5">
              <span className="block">Retell provider minutes: {fmtMin(d.provider.minutes)} across {fmtInt(d.provider.calls)} calls · WEBEE recorded: {fmtMin(ws.minutesUsed)} across {fmtInt(ws.totalCalls)} calls.</span>
              <span className="block">
                Provider reconciliation difference: {fmtMin(d.provider.differenceMinutes)} (tolerance ±{fmtMin(d.provider.toleranceMinutes)} from per-call second rounding).
                {" "}Actual provider cost for this period: {fmtUsdCents(d.provider.costUsdCents)}{(d.provider.costUnavailableCalls ?? 0) > 0 ? ` (${fmtInt(d.provider.costUnavailableCalls)} calls without recorded cost)` : ""}.
              </span>
              {d.lastSyncedAt && <span className="block">Last successful sync: {fmtDateTime(d.lastSyncedAt)}.</span>}
              {d.provider.status === "provider_mismatch" && (
                <span className="block">The difference above is outside tolerance — some provider calls may not be synced yet. It is shown, never hidden.</span>
              )}
            </span>
          )}
        </InsightCard>
      )}

      {d.truncated && (
        <InsightCard tone="warning" icon={AlertTriangle} title="Large date range">
          This range has more calls than can be analysed in one pass — minutes cover the most recent calls only. Narrow the range for exact figures.
        </InsightCard>
      )}

      {d.reconciliation && !d.reconciliation.reconciled && (
        <InsightCard tone="warning" icon={AlertTriangle} title="Reconciliation mismatch">
          Campaign totals do not add up to the workspace total for this range
          ({fmtMin((d.reconciliation.attributedSeconds ?? 0) / 60)} attributed vs {fmtMin((d.reconciliation.workspaceSeconds ?? 0) / 60)} workspace).
          Figures shown are real recorded data, but attribution needs review.
        </InsightCard>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>{fmtInt(d.dedupedCallCount)} unique calls counted</span>
        {(d.duplicatesRemoved ?? 0) + (d.crossSourceDuplicatesExcluded ?? 0) > 0 && (
          <span>{fmtInt((d.duplicatesRemoved ?? 0) + (d.crossSourceDuplicatesExcluded ?? 0))} duplicate records excluded</span>
        )}
        {(ws.missingDurationCalls ?? 0) > 0 && (
          <span>{fmtInt(ws.missingDurationCalls)} calls with no recorded duration (counted as calls, 0 minutes)</span>
        )}
        {(d.excludedInvalidCount ?? 0) > 0 && (
          <span>{fmtInt(d.excludedInvalidCount)} records excluded (invalid duration)</span>
        )}
        {d.reconciliation?.reconciled && <span>Totals reconciled ✓</span>}
        {hiddenDeletedCount > 0 && (
          <span>{fmtInt(hiddenDeletedCount)} deleted campaign{hiddenDeletedCount === 1 ? "" : "s"} with no usage in this range omitted</span>
        )}
        {d.lastSyncedAt && (
          <span>Last synced {new Date(d.lastSyncedAt).toLocaleString("en-GB")}</span>
        )}
        {d.unassigned && (d.unassigned.totalCalls ?? 0) > 0 && d.unassignedReasons && (
          <span>
            Unassigned: {fmtInt(d.unassignedReasons.noAgent)} no agent, {fmtInt(d.unassignedReasons.agentNotInAnyCampaign)} agent not in a campaign, {fmtInt(d.unassignedReasons.ambiguousAgent)} ambiguous agent
          </span>
        )}
      </div>

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
                <Th>
                  <span title="Total talk time ÷ all calls in range (including voicemail and failed calls)">Avg / call</span>
                </Th>
                <Th>{sortBtn("connectedMinutes", "Connected min")}</Th>
                <Th>Voicemail min</Th>
                {monthCovered && <Th>{sortBtn("minutesThisMonth", "This month")}</Th>}
                <Th>{sortBtn("percentageOfWorkspaceMinutes", "% of workspace")}</Th>
                <Th>
                  <span title={`What the client is charged at £${BILLING_RATE_GBP_PER_MINUTE.toFixed(2)} per minute`}>{sortBtn("rateCostGbp", "Client Usage Charge")}</span>
                </Th>
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
                    <td className="px-3 py-2 tabular-nums text-muted-foreground" title="Total talk time ÷ all calls in range">
                      {c.avgSecondsPerCall != null && c.totalCalls > 0 ? formatDurationHuman(c.avgSecondsPerCall) : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmtMin(c.connectedMinutes)}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{fmtMin(c.voicemailMinutes)}</td>
                    {monthCovered && <td className="px-3 py-2 tabular-nums">{fmtMin(c.minutesThisMonth)}</td>}
                    <td className="px-3 py-2 tabular-nums">{Number(c.percentageOfWorkspaceMinutes ?? 0)}%</td>
                    <td className="px-3 py-2 tabular-nums font-medium">{fmtGbp(c.rateCostGbp)}</td>
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
