import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  BarChart3,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  DollarSign,
  Smile,
  Meh,
  Frown,
  Voicemail,
  CheckCircle2,
  XCircle,
  Activity,
  AlertTriangle,
} from "lucide-react";
import {
  PageHeader,
  PanelCard,
  StatCard,
  EmptyState,
} from "@/components/dashboard/PageShell";
import { Button } from "@/components/ui/button";
import { getRetellAnalytics } from "@/lib/dashboard/analytics.functions";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({ meta: [{ title: "Analytics" }] }),
  component: AnalyticsPage,
});

const RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
];

// Retell-style palette mapped to our purple primary
const CHART = {
  primary: "#8B5CF6",
  primaryGlow: "#A78BFA",
  accent: "#22D3EE",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
  neutral: "#64748B",
  grid: "rgba(255,255,255,0.06)",
  axis: "rgba(255,255,255,0.45)",
};

const SENTIMENT_COLORS = [CHART.success, CHART.warning, CHART.danger, CHART.neutral];
const TYPE_COLORS = [CHART.primary, CHART.primaryGlow, CHART.accent, CHART.success, CHART.danger, CHART.warning];

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {label && <div className="mb-1 font-medium text-foreground">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function fmtDuration(seconds: number) {
  if (!seconds || !isFinite(seconds)) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtMs(ms?: number | null) {
  if (ms === null || ms === undefined || !isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function humanize(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function AnalyticsPage() {
  const fn = useServerFn(getRetellAnalytics);
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ["retell-analytics", days],
    queryFn: () => fn({ data: { days, limit: 1000 } }),
  });

  const result = q.data;
  const calls = (result?.calls ?? []) as any[];

  const analytics = useMemo(() => {
    const total = calls.length;
    const inbound = calls.filter(
      (c) => c.direction === "inbound" || c.call_direction === "inbound",
    ).length;
    const outbound = calls.filter(
      (c) => c.direction === "outbound" || c.call_direction === "outbound",
    ).length;
    const webCalls = calls.filter(
      (c) => c.call_type === "web_call" || c.call_type === "webcall",
    ).length;

    const byStatus: Record<string, number> = {};
    const byDisconnect: Record<string, number> = {};
    const bySentiment: Record<string, number> = { Positive: 0, Neutral: 0, Negative: 0, Unknown: 0 };
    const byAgent: Record<string, { count: number; durationSec: number; costCents: number }> = {};
    const byDay: Record<string, number> = {};
    let totalDurationSec = 0;
    let totalCostCents = 0;
    let successCount = 0;
    let unsuccessCount = 0;
    let voicemailCount = 0;
    const llmLatencies: number[] = [];
    const e2eLatencies: number[] = [];
    const ttsLatencies: number[] = [];

    for (const c of calls) {
      byStatus[c.call_status ?? "unknown"] = (byStatus[c.call_status ?? "unknown"] ?? 0) + 1;
      const dr = c.disconnection_reason ?? c.disconnect_reason;
      if (dr) {
        byDisconnect[dr] = (byDisconnect[dr] ?? 0) + 1;
      }
      const sentiment = c.call_analysis?.user_sentiment ?? "Unknown";
      bySentiment[sentiment] = (bySentiment[sentiment] ?? 0) + 1;

      const durSec =
        c.call_cost?.total_duration_seconds ??
        (c.duration_ms != null
          ? c.duration_ms / 1000
          : c.end_timestamp && c.start_timestamp
            ? Math.max(0, (c.end_timestamp - c.start_timestamp) / 1000)
            : 0);
      totalDurationSec += durSec;

      const costCents = c.call_cost?.combined_cost ?? c.combined_cost ?? 0;
      totalCostCents += costCents;

      if (c.call_analysis?.call_successful === true) successCount += 1;
      else if (c.call_analysis?.call_successful === false) unsuccessCount += 1;
      if (c.call_analysis?.in_voicemail) voicemailCount += 1;

      const aid = c.agent_id ?? "unknown";
      const agg = byAgent[aid] ?? { count: 0, durationSec: 0, costCents: 0 };
      agg.count += 1;
      agg.durationSec += durSec;
      agg.costCents += costCents;
      byAgent[aid] = agg;

      if (c.start_timestamp) {
        const d = new Date(c.start_timestamp);
        const key = d.toISOString().slice(0, 10);
        byDay[key] = (byDay[key] ?? 0) + 1;
      }

      if (c.latency?.llm?.p50 != null) llmLatencies.push(c.latency.llm.p50);
      if (c.latency?.e2e?.p50 != null) e2eLatencies.push(c.latency.e2e.p50);
      if (c.latency?.tts?.p50 != null) ttsLatencies.push(c.latency.tts.p50);
    }

    const avg = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const avgDuration = total ? totalDurationSec / total : 0;
    const avgCost = total ? totalCostCents / total : 0;

    return {
      total,
      inbound,
      outbound,
      webCalls,
      byStatus,
      byDisconnect,
      bySentiment,
      byAgent,
      byDay,
      totalDurationSec,
      totalCostCents,
      avgDuration,
      avgCost,
      successCount,
      unsuccessCount,
      voicemailCount,
      successRate: total ? (successCount / total) * 100 : 0,
      avgLlmLatency: avg(llmLatencies),
      avgE2eLatency: avg(e2eLatencies),
      avgTtsLatency: avg(ttsLatencies),
    };
  }, [calls]);

  const dayEntries = useMemo(() => {
    const entries = Object.entries(analytics.byDay).sort(([a], [b]) => a.localeCompare(b));
    return entries.slice(-30);
  }, [analytics.byDay]);

  const maxDay = Math.max(1, ...dayEntries.map(([, v]) => v));

  return (
    <div className="pb-12">
      <PageHeader
        title="Analytics"
        subtitle="All call performance metrics from your voice agents"
        icon={BarChart3}
        onRefresh={() => q.refetch()}
        actions={
          <div className="flex gap-1 rounded-lg border border-white/[0.06] bg-card/40 p-1">
            {RANGES.map((r) => (
              <Button
                key={r.days}
                size="sm"
                variant={days === r.days ? "secondary" : "ghost"}
                onClick={() => setDays(r.days)}
                className={days === r.days ? "bg-primary/20 text-primary" : ""}
              >
                {r.label}
              </Button>
            ))}
          </div>
        }
      />

      {result?.error && (
        <div className="mx-8 mt-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="h-4 w-4" />
          <span>Analytics error: {result.error}</span>
        </div>
      )}

      {result && !result.configured ? (
        <div className="px-8 pt-8">
          <PanelCard>
            <EmptyState
              icon={BarChart3}
              title="No deployed agents"
              message="Deploy a voice agent to start collecting analytics."
            />
          </PanelCard>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 px-8 pt-6 md:grid-cols-4">
            <StatCard label="Total calls" tone="primary" value={analytics.total} />
            <StatCard label="Total talk time" tone="info" value={fmtDuration(analytics.totalDurationSec)} />
            <StatCard label="Total cost" tone="warning" value={fmtMoney(analytics.totalCostCents)} />
            <StatCard label="Success rate" tone="success" value={`${analytics.successRate.toFixed(1)}%`} />
          </div>

          <div className="grid grid-cols-2 gap-4 px-8 pt-4 md:grid-cols-4">
            <StatCard label="Avg duration" tone="info" value={fmtDuration(analytics.avgDuration)} />
            <StatCard label="Avg cost / call" tone="warning" value={fmtMoney(analytics.avgCost)} />
            <StatCard label="Voicemails" tone="danger" value={analytics.voicemailCount} />
            <StatCard label="Unsuccessful" tone="danger" value={analytics.unsuccessCount} />
          </div>

          {/* Calls per day */}
          <div className="px-8 pt-6">
            <PanelCard>
              <div className="mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Calls per day</h3>
              </div>
              {dayEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data in this range.</p>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer>
                    <AreaChart
                      data={dayEntries.map(([day, count]) => ({
                        day: day.slice(5),
                        calls: count,
                      }))}
                      margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="callsArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CHART.primary} stopOpacity={0.55} />
                          <stop offset="100%" stopColor={CHART.primary} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="day" stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART.primary, strokeOpacity: 0.3 }} />
                      <Area
                        type="monotone"
                        dataKey="calls"
                        stroke={CHART.primaryGlow}
                        strokeWidth={2}
                        fill="url(#callsArea)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </PanelCard>
          </div>

          {/* Sentiment + Call type breakdowns */}
          <div className="grid grid-cols-1 gap-4 px-8 pt-6 md:grid-cols-2">
            <PanelCard>
              <div className="mb-4 flex items-center gap-2">
                <Smile className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">User sentiment</h3>
              </div>
              <DonutChart
                data={[
                  { name: "Positive", value: analytics.bySentiment.Positive ?? 0 },
                  { name: "Neutral", value: analytics.bySentiment.Neutral ?? 0 },
                  { name: "Negative", value: analytics.bySentiment.Negative ?? 0 },
                  { name: "Unknown", value: analytics.bySentiment.Unknown ?? 0 },
                ]}
                colors={SENTIMENT_COLORS}
                centerLabel="Calls"
                centerValue={analytics.total}
              />
            </PanelCard>

            <PanelCard>
              <div className="mb-4 flex items-center gap-2">
                <PhoneCall className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Call types</h3>
              </div>
              <DonutChart
                data={[
                  { name: "Inbound", value: analytics.inbound },
                  { name: "Outbound", value: analytics.outbound },
                  { name: "Web", value: analytics.webCalls },
                  { name: "Successful", value: analytics.successCount },
                  { name: "Unsuccessful", value: analytics.unsuccessCount },
                  { name: "Voicemail", value: analytics.voicemailCount },
                ]}
                colors={TYPE_COLORS}
                centerLabel="Total"
                centerValue={analytics.total}
              />
            </PanelCard>
          </div>

          {/* Status + Disconnect reasons */}
          <div className="grid grid-cols-1 gap-4 px-8 pt-6 md:grid-cols-2">
            <PanelCard>
              <div className="mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Call status</h3>
              </div>
              <HBarChart
                data={Object.entries(analytics.byStatus)
                  .sort(([, a], [, b]) => b - a)
                  .map(([k, v]) => ({ name: humanize(k), value: v }))}
              />
            </PanelCard>

            <PanelCard>
              <div className="mb-4 flex items-center gap-2">
                <XCircle className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Disconnection reasons</h3>
              </div>
              <HBarChart
                data={Object.entries(analytics.byDisconnect)
                  .sort(([, a], [, b]) => b - a)
                  .map(([k, v]) => ({ name: humanize(k), value: v }))}
                color={CHART.danger}
              />
            </PanelCard>
          </div>

          {/* Latency */}
          <div className="px-8 pt-6">
            <PanelCard>
              <div className="mb-4 flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Average latency (p50)</h3>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <LatencyTile label="LLM" value={fmtMs(analytics.avgLlmLatency)} />
                <LatencyTile label="End-to-end" value={fmtMs(analytics.avgE2eLatency)} />
                <LatencyTile label="TTS" value={fmtMs(analytics.avgTtsLatency)} />
              </div>
            </PanelCard>
          </div>

          {/* Per-agent table */}
          <div className="px-8 pt-6">
            <PanelCard>
              <div className="mb-4 flex items-center gap-2">
                <PhoneCall className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Per-agent breakdown</h3>
              </div>
              {Object.keys(analytics.byAgent).length === 0 ? (
                <p className="text-sm text-muted-foreground">No agent activity.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2">Agent ID</th>
                        <th className="px-3 py-2">Calls</th>
                        <th className="px-3 py-2">Talk time</th>
                        <th className="px-3 py-2">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(analytics.byAgent)
                        .sort(([, a], [, b]) => b.count - a.count)
                        .map(([id, v]) => (
                          <tr key={id} className="border-b border-white/[0.04]">
                            <td className="px-3 py-2 font-mono text-xs">{id}</td>
                            <td className="px-3 py-2 tabular-nums">{v.count}</td>
                            <td className="px-3 py-2 tabular-nums">{fmtDuration(v.durationSec)}</td>
                            <td className="px-3 py-2 tabular-nums">{fmtMoney(v.costCents)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </PanelCard>
          </div>
        </>
      )}

      {q.isLoading && (
        <div className="px-8 pt-6 text-sm text-muted-foreground">Loading analytics…</div>
      )}
    </div>
  );
}

function SentimentRow({
  icon: Icon,
  label,
  count,
  total,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  count: number;
  total: number;
  tone: string;
}) {
  const pct = total ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <span className="font-medium tabular-nums">
          {count} <span className="text-xs text-muted-foreground">({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.04]">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DonutChart({
  data,
  colors,
  centerLabel,
  centerValue,
}: {
  data: { name: string; value: number }[];
  colors: string[];
  centerLabel: string;
  centerValue: number;
}) {
  const filtered = data.filter((d) => d.value > 0);
  if (filtered.length === 0) {
    return <p className="text-sm text-muted-foreground">No data.</p>;
  }
  return (
    <div className="relative h-64 w-full">
      <ResponsiveContainer>
        <PieChart>
          <Tooltip content={<ChartTooltip />} />
          <Pie
            data={filtered}
            dataKey="value"
            nameKey="name"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            stroke="none"
          >
            {filtered.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            wrapperStyle={{ fontSize: 11, color: CHART.axis }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-8">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{centerLabel}</span>
        <span className="text-2xl font-bold tabular-nums">{centerValue}</span>
      </div>
    </div>
  );
}

function HBarChart({
  data,
  color = CHART.primary,
}: {
  data: { name: string; value: number }[];
  color?: string;
}) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">No data.</p>;
  const height = Math.max(180, data.length * 36);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid stroke={CHART.grid} horizontal={false} />
          <XAxis type="number" stroke={CHART.axis} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            stroke={CHART.axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={120}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(139,92,246,0.08)" }} />
          <Bar dataKey="value" fill={color} radius={[0, 6, 6, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function LatencyTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/40 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}