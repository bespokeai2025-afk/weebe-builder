import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getDashboardLiveAgents } from "@/lib/agents/agents.functions";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
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
  Phone,
  Clock,
  Activity,
  XCircle,
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  TrendingUp,
  Zap,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import {
  PageHeader,
  PanelCard,
  StatCard,
  EmptyState,
  TableHead,
  Th,
} from "@/components/dashboard/PageShell";
import { Button } from "@/components/ui/button";
import { getRetellAnalytics } from "@/lib/dashboard/analytics.functions";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Webee" }] }),
  component: AnalyticsPage,
});

const RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
];

const CHART = {
  primary:     "#8B5CF6",
  primaryGlow: "#A78BFA",
  accent:      "#22D3EE",
  success:     "#22C55E",
  warning:     "#F59E0B",
  danger:      "#EF4444",
  neutral:     "#64748B",
  pink:        "#EC4899",
  orange:      "#F97316",
  grid:        "rgba(255,255,255,0.06)",
  axis:        "rgba(255,255,255,0.40)",
};

const SENTIMENT_COLORS  = [CHART.success, CHART.warning, CHART.danger, CHART.neutral];
const SUCCESS_COLORS    = [CHART.success, CHART.danger, CHART.neutral];
const DIRECTION_COLORS  = [CHART.primary, CHART.accent, CHART.pink];
const DISCONNECT_COLORS = [CHART.danger, CHART.warning, CHART.primary, CHART.accent, CHART.neutral, CHART.orange];

// ── Tooltip ───────────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {label && <div className="mb-1 font-medium text-foreground">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium tabular-nums">{p.value?.toLocaleString?.() ?? p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtDuration(seconds: number) {
  if (!seconds || !isFinite(seconds)) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtMs(ms?: number | null) {
  if (ms === null || ms === undefined || !isFinite(ms) || ms === 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function humanize(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortDay(isoDate: string) {
  return isoDate.slice(5); // MM-DD
}

// ── Analytics computation ─────────────────────────────────────────────────────
function computeAnalytics(calls: any[]) {
  const total   = calls.length;
  const inbound = calls.filter((c) => c.direction === "inbound"  || c.call_direction === "inbound").length;
  const outbound= calls.filter((c) => c.direction === "outbound" || c.call_direction === "outbound").length;
  const webCalls= calls.filter((c) => c.call_type === "web_call" || c.call_type === "webcall").length;

  const byStatus:     Record<string, number> = {};
  const byDisconnect: Record<string, number> = {};
  const bySentiment:  Record<string, number> = { Positive: 0, Neutral: 0, Negative: 0, Unknown: 0 };
  const byAgent:      Record<string, { count: number; durationSec: number }> = {};

  // Time-series buckets (keyed by YYYY-MM-DD)
  const byDay:          Record<string, number> = {};
  const byDayDuration:  Record<string, { total: number; count: number }> = {};
  const byDayOutcome:   Record<string, { success: number; unsuccessful: number; voicemail: number }> = {};
  const byDayLatency:   Record<string, { llm: number[]; e2e: number[]; tts: number[] }> = {};
  const byHour:         Record<number, number> = {};

  let totalDurationSec = 0;
  let successCount     = 0;
  let unsuccessCount   = 0;
  let voicemailCount   = 0;
  let transferCount    = 0;
  const llmLatencies: number[] = [];
  const e2eLatencies: number[] = [];
  const ttsLatencies: number[] = [];

  for (const c of calls) {
    // ── status / disconnect ──
    byStatus[c.call_status ?? "unknown"] = (byStatus[c.call_status ?? "unknown"] ?? 0) + 1;
    const dr = c.disconnection_reason ?? c.disconnect_reason;
    if (dr) byDisconnect[dr] = (byDisconnect[dr] ?? 0) + 1;

    // ── sentiment ──
    const sentiment = c.call_analysis?.user_sentiment ?? "Unknown";
    bySentiment[sentiment] = (bySentiment[sentiment] ?? 0) + 1;

    // ── duration ──
    const durSec =
      c.call_cost?.total_duration_seconds ??
      (c.duration_ms != null
        ? c.duration_ms / 1000
        : c.end_timestamp && c.start_timestamp
          ? Math.max(0, (c.end_timestamp - c.start_timestamp) / 1000)
          : 0);
    totalDurationSec += durSec;

    // ── success / voicemail / transfer ──
    if (c.call_analysis?.call_successful === true)  successCount++;
    else if (c.call_analysis?.call_successful === false) unsuccessCount++;
    if (c.call_analysis?.in_voicemail) voicemailCount++;
    if (c.disconnection_reason === "transfer_to_human" || c.transfer_destination) transferCount++;

    // ── per-agent ──
    const aid = c.agent_id ?? "unknown";
    const agg = byAgent[aid] ?? { count: 0, durationSec: 0 };
    agg.count++; agg.durationSec += durSec;
    byAgent[aid] = agg;

    // ── latency ──
    const llm = c.latency?.llm?.p50 ?? null;
    const e2e = c.latency?.e2e?.p50 ?? null;
    const tts = c.latency?.tts?.p50 ?? null;
    if (llm != null) llmLatencies.push(llm);
    if (e2e != null) e2eLatencies.push(e2e);
    if (tts != null) ttsLatencies.push(tts);

    // ── time-series ──
    if (c.start_timestamp) {
      const d   = new Date(c.start_timestamp);
      const key = d.toISOString().slice(0, 10);
      const hr  = d.getUTCHours();

      byDay[key]  = (byDay[key]  ?? 0) + 1;
      byHour[hr]  = (byHour[hr] ?? 0) + 1;

      const dd = byDayDuration[key] ?? { total: 0, count: 0 };
      dd.total += durSec; dd.count++;
      byDayDuration[key] = dd;

      const do_ = byDayOutcome[key] ?? { success: 0, unsuccessful: 0, voicemail: 0 };
      if (c.call_analysis?.call_successful === true)  do_.success++;
      else if (c.call_analysis?.call_successful === false) do_.unsuccessful++;
      if (c.call_analysis?.in_voicemail) do_.voicemail++;
      byDayOutcome[key] = do_;

      const dl = byDayLatency[key] ?? { llm: [], e2e: [], tts: [] };
      if (llm != null) dl.llm.push(llm);
      if (e2e != null) dl.e2e.push(e2e);
      if (tts != null) dl.tts.push(tts);
      byDayLatency[key] = dl;
    }
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  return {
    total, inbound, outbound, webCalls,
    byStatus, byDisconnect, bySentiment, byAgent,
    byDay, byDayDuration, byDayOutcome, byDayLatency, byHour,
    totalDurationSec,
    totalMinutes: Math.round(totalDurationSec / 60),
    avgDuration:  total ? totalDurationSec / total : 0,
    successCount, unsuccessCount, voicemailCount, transferCount,
    successRate: total ? (successCount / total) * 100 : 0,
    avgLlmLatency: avg(llmLatencies),
    avgE2eLatency: avg(e2eLatencies),
    avgTtsLatency: avg(ttsLatencies),
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────
function AnalyticsPage() {
  const fn              = useServerFn(getRetellAnalytics);
  const getLiveAgentsFn = useServerFn(getDashboardLiveAgents);
  const [days, setDays] = useState(30);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectorOpen,    setSelectorOpen]    = useState(false);

  const q = useQuery({
    queryKey: ["retell-analytics", days],
    queryFn:  () => fn({ data: { days, limit: 1000 } }),
  });
  const liveAgentsQ = useQuery({
    queryKey: ["dashboard-live-agents"],
    queryFn:  () => getLiveAgentsFn({ data: undefined }),
    staleTime: 60_000,
  });

  const result    = q.data;
  const allCalls  = (result?.calls ?? []) as any[];
  const agentNames: Record<string, string> = (result?.agentNames ?? {}) as Record<string, string>;

  const agentList = useMemo(() => {
    const live = liveAgentsQ.data ?? [];
    return live
      .filter((a) => !!a.deployedRetellAgentId)
      .map((a) => ({ id: a.deployedRetellAgentId as string, name: a.name }));
  }, [liveAgentsQ.data]);

  const calls = useMemo(
    () => (selectedAgentId ? allCalls.filter((c) => c.agent_id === selectedAgentId) : allCalls),
    [allCalls, selectedAgentId],
  );

  const analytics = useMemo(() => computeAnalytics(calls), [calls]);

  // Sorted day-keyed arrays
  const sortedDays = useMemo(
    () => Object.keys(analytics.byDay).sort(),
    [analytics.byDay],
  );
  const last30Days = sortedDays.slice(-30);

  const callsPerDayData = useMemo(
    () => last30Days.map((d) => ({ day: shortDay(d), calls: analytics.byDay[d] ?? 0 })),
    [last30Days, analytics.byDay],
  );

  const durationTrendData = useMemo(
    () => last30Days.map((d) => {
      const dd = analytics.byDayDuration[d];
      return { day: shortDay(d), avg: dd && dd.count ? Math.round(dd.total / dd.count) : 0 };
    }),
    [last30Days, analytics.byDayDuration],
  );

  const outcomeTrendData = useMemo(
    () => last30Days.map((d) => {
      const o = analytics.byDayOutcome[d] ?? { success: 0, unsuccessful: 0, voicemail: 0 };
      return { day: shortDay(d), ...o };
    }),
    [last30Days, analytics.byDayOutcome],
  );

  const latencyTrendData = useMemo(
    () => last30Days.map((d) => {
      const dl = analytics.byDayLatency[d] ?? { llm: [], e2e: [], tts: [] };
      const a  = (arr: number[]) => (arr.length ? Math.round(arr.reduce((x, y) => x + y, 0) / arr.length) : null);
      return { day: shortDay(d), LLM: a(dl.llm), E2E: a(dl.e2e), TTS: a(dl.tts) };
    }),
    [last30Days, analytics.byDayLatency],
  );

  const hourData = useMemo(
    () => Array.from({ length: 24 }, (_, h) => ({ hour: `${h}h`, calls: analytics.byHour[h] ?? 0 })),
    [analytics.byHour],
  );

  const successRate   = analytics.total ? Math.round((analytics.successCount / analytics.total)  * 100) : 0;
  const transferRate  = analytics.total ? ((analytics.transferCount / analytics.total) * 100).toFixed(1) : "0";
  const unknownSuccess = Math.max(0, analytics.total - analytics.successCount - analytics.unsuccessCount);

  const selectedAgentName = selectedAgentId
    ? (agentNames[selectedAgentId] ?? agentList.find((a) => a.id === selectedAgentId)?.name ?? selectedAgentId)
    : "All agents";

  return (
    <div className="pb-8">
      <PageHeader
        title="Call Analytics"
        subtitle="All call performance metrics pulled from your voice agents"
        icon={BarChart3}
        onRefresh={() => q.refetch()}
        actions={
          <div className="flex items-center gap-2">
            {agentList.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setSelectorOpen((o) => !o)}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-card/60 px-3 py-1.5 text-sm font-medium hover:bg-card/80"
                >
                  <span className="max-w-[180px] truncate">{selectedAgentName}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                {selectorOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
                    <button
                      className={`w-full px-4 py-2.5 text-left text-sm hover:bg-muted/60 ${!selectedAgentId ? "text-primary font-medium" : "text-foreground"}`}
                      onClick={() => { setSelectedAgentId(null); setSelectorOpen(false); }}
                    >All agents</button>
                    {agentList.map((a) => (
                      <button
                        key={a.id}
                        className={`w-full px-4 py-2.5 text-left text-sm hover:bg-muted/60 ${selectedAgentId === a.id ? "text-primary font-medium" : "text-foreground"}`}
                        onClick={() => { setSelectedAgentId(a.id); setSelectorOpen(false); }}
                      >{a.name}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-1 rounded-lg border border-white/[0.06] bg-card/40 p-1">
              {RANGES.map((r) => (
                <Button
                  key={r.days} size="sm"
                  variant={days === r.days ? "secondary" : "ghost"}
                  onClick={() => setDays(r.days)}
                  className={days === r.days ? "bg-primary/20 text-primary" : ""}
                >{r.label}</Button>
              ))}
            </div>
          </div>
        }
      />

      {result?.error && (
        <div className="mx-6 mt-4 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="h-4 w-4" />
          <span>Analytics error: {result.error}</span>
        </div>
      )}

      {result && !result.configured ? (
        <div className="px-6 pt-5">
          <PanelCard>
            <EmptyState icon={BarChart3} title="No deployed agents" message="Deploy a voice agent to start collecting analytics." />
          </PanelCard>
        </div>
      ) : (
        <>
          {selectedAgentId && (
            <div className="mx-6 mt-4 flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm">
              <span className="text-primary font-medium">Showing: <span className="font-semibold">{selectedAgentName}</span></span>
              <button onClick={() => setSelectedAgentId(null)} className="text-xs text-muted-foreground hover:text-foreground">Clear filter</button>
            </div>
          )}

          {/* ── KPI row 1 ── */}
          <div className="grid grid-cols-2 gap-3 px-6 pt-5 md:grid-cols-4">
            <StatCard label="Total calls"   tone="primary" value={analytics.total} />
            <StatCard label="Minutes used"  tone="info"    value={`${analytics.totalMinutes}m`} />
            <StatCard label="Avg duration"  tone="info"    value={fmtDuration(analytics.avgDuration)} />
            <StatCard label="E2E latency"   tone="primary" value={fmtMs(analytics.avgE2eLatency)} />
          </div>

          {/* ── KPI row 2 ── */}
          <div className="grid grid-cols-2 gap-3 px-6 pt-3 md:grid-cols-4">
            <StatCard label="Inbound"      tone="primary" value={analytics.inbound}       icon={ArrowDownLeft} />
            <StatCard label="Outbound"     tone="info"    value={analytics.outbound}      icon={ArrowUpRight} />
            <StatCard label="Success rate" tone="success" value={`${successRate}%`}       icon={CheckCircle2} />
            <StatCard label="Transfer rate" tone="warning" value={`${transferRate}%`}     icon={TrendingUp} />
          </div>

          {/* ── Call counts area chart (full width) ── */}
          <div className="px-6 pt-4">
            <ChartCard title="Call Counts" icon={Activity} color={CHART.primary}>
              {callsPerDayData.length === 0 ? <NoData /> : (
                <div className="h-52 w-full">
                  <ResponsiveContainer>
                    <AreaChart data={callsPerDayData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="grad_calls" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor={CHART.primary} stopOpacity={0.55} />
                          <stop offset="100%" stopColor={CHART.primary} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="day" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="calls" name="Calls" stroke={CHART.primaryGlow} strokeWidth={2} fill="url(#grad_calls)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>
          </div>

          {/* ── 3 donuts ── */}
          <div className="grid grid-cols-1 gap-4 px-6 pt-4 md:grid-cols-3">
            <ChartCard title="Call Successful" icon={CheckCircle2} color={CHART.success}>
              <CompactDonut
                data={[
                  { name: "Successful",   value: analytics.successCount },
                  { name: "Unsuccessful", value: analytics.unsuccessCount },
                  { name: "Unknown",      value: unknownSuccess },
                ]}
                colors={SUCCESS_COLORS}
                centerLabel="Total"
                centerValue={analytics.total}
              />
            </ChartCard>

            <ChartCard title="Disconnection Reason" icon={XCircle} color={CHART.danger}>
              <CompactDonut
                data={Object.entries(analytics.byDisconnect)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 6)
                  .map(([k, v]) => ({ name: humanize(k), value: v }))}
                colors={DISCONNECT_COLORS}
                centerLabel="Reasons"
                centerValue={Object.keys(analytics.byDisconnect).length}
              />
            </ChartCard>

            <ChartCard title="User Sentiment" icon={Activity} color={CHART.warning}>
              <CompactDonut
                data={[
                  { name: "Positive", value: analytics.bySentiment.Positive ?? 0 },
                  { name: "Neutral",  value: analytics.bySentiment.Neutral  ?? 0 },
                  { name: "Negative", value: analytics.bySentiment.Negative ?? 0 },
                  { name: "Unknown",  value: analytics.bySentiment.Unknown  ?? 0 },
                ]}
                colors={SENTIMENT_COLORS}
                centerLabel="Calls"
                centerValue={analytics.total}
              />
            </ChartCard>
          </div>

          {/* ── 3 more charts ── */}
          <div className="grid grid-cols-1 gap-4 px-6 pt-4 md:grid-cols-3">
            <ChartCard title="Phone Inbound / Outbound" icon={Phone} color={CHART.accent}>
              <CompactDonut
                data={[
                  { name: "Inbound",  value: analytics.inbound },
                  { name: "Outbound", value: analytics.outbound },
                  { name: "Web",      value: analytics.webCalls },
                ]}
                colors={DIRECTION_COLORS}
                centerLabel="Total"
                centerValue={analytics.total}
              />
            </ChartCard>

            <ChartCard title="Avg Call Duration (s)" icon={Clock} color={CHART.accent}>
              {durationTrendData.length === 0 ? <NoData /> : (
                <div className="h-48 w-full">
                  <ResponsiveContainer>
                    <AreaChart data={durationTrendData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="grad_dur" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor={CHART.accent} stopOpacity={0.5} />
                          <stop offset="100%" stopColor={CHART.accent} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="day" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="avg" name="Avg (s)" stroke={CHART.accent} strokeWidth={2} fill="url(#grad_dur)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>

            <ChartCard title="Call Success Rate (%)" icon={TrendingUp} color={CHART.success}>
              {outcomeTrendData.length === 0 ? <NoData /> : (
                <div className="h-48 w-full">
                  <ResponsiveContainer>
                    <LineChart data={outcomeTrendData.map((d) => {
                      const total = d.success + d.unsuccessful;
                      return { day: d.day, rate: total ? Math.round((d.success / total) * 100) : 0 };
                    })} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="day" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="rate" name="Success %" stroke={CHART.success} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>
          </div>

          {/* ── Latency trends (full width) ── */}
          <div className="px-6 pt-4">
            <ChartCard title="Latency Trends — LLM / TTS / E2E (ms p50)" icon={Zap} color={CHART.warning}>
              {latencyTrendData.every((d) => d.LLM == null && d.E2E == null && d.TTS == null) ? <NoData /> : (
                <div className="h-52 w-full">
                  <ResponsiveContainer>
                    <LineChart data={latencyTrendData} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                      <CartesianGrid stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="day" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} unit="ms" />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11, color: CHART.axis }} />
                      <Line type="monotone" dataKey="LLM" stroke={CHART.primary}  strokeWidth={2} dot={false} connectNulls />
                      <Line type="monotone" dataKey="TTS" stroke={CHART.accent}   strokeWidth={2} dot={false} connectNulls />
                      <Line type="monotone" dataKey="E2E" stroke={CHART.warning}  strokeWidth={2} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>
          </div>

          {/* ── Daily outcomes stacked + Call by hour ── */}
          <div className="grid grid-cols-1 gap-4 px-6 pt-4 md:grid-cols-2">
            <ChartCard title="Daily Call Outcomes" icon={BarChart3} color={CHART.success}>
              {outcomeTrendData.length === 0 ? <NoData /> : (
                <div className="h-52 w-full">
                  <ResponsiveContainer>
                    <BarChart data={outcomeTrendData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="day" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11, color: CHART.axis }} />
                      <Bar dataKey="success"      name="Successful"   fill={CHART.success}  stackId="a" radius={[0,0,0,0]} />
                      <Bar dataKey="unsuccessful" name="Unsuccessful" fill={CHART.danger}   stackId="a" />
                      <Bar dataKey="voicemail"    name="Voicemail"    fill={CHART.neutral}  stackId="a" radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>

            <ChartCard title="Call Volume by Hour (UTC)" icon={Clock} color={CHART.primary}>
              {hourData.every((d) => d.calls === 0) ? <NoData /> : (
                <div className="h-52 w-full">
                  <ResponsiveContainer>
                    <BarChart data={hourData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="hour" stroke={CHART.axis} fontSize={9} tickLine={false} axisLine={false} interval={3} />
                      <YAxis stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="calls" name="Calls" fill={CHART.primary} radius={[3,3,0,0]} barSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>
          </div>

          {/* ── Avg latency tiles + call status H-bar ── */}
          <div className="grid grid-cols-1 gap-4 px-6 pt-4 md:grid-cols-2">
            <ChartCard title="Average Latency (p50)" icon={Zap} color={CHART.warning}>
              <div className="grid grid-cols-3 gap-3 pt-1">
                <LatencyTile label="LLM"         value={fmtMs(analytics.avgLlmLatency)} color={CHART.primary} />
                <LatencyTile label="End-to-end"  value={fmtMs(analytics.avgE2eLatency)} color={CHART.warning} />
                <LatencyTile label="TTS"         value={fmtMs(analytics.avgTtsLatency)} color={CHART.accent} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <LatencyTile label="Voicemails"     value={String(analytics.voicemailCount)} color={CHART.neutral} />
                <LatencyTile label="Transfers"      value={String(analytics.transferCount)}  color={CHART.pink} />
              </div>
            </ChartCard>

            <ChartCard title="Call Status Breakdown" icon={PhoneCall} color={CHART.primary}>
              <HBarChart
                data={Object.entries(analytics.byStatus)
                  .sort(([, a], [, b]) => b - a)
                  .map(([k, v]) => ({ name: humanize(k), value: v }))}
              />
            </ChartCard>
          </div>

          {/* ── Disconnection reasons ── */}
          <div className="px-6 pt-4">
            <ChartCard title="Disconnection Reasons" icon={XCircle} color={CHART.danger}>
              <HBarChart
                data={Object.entries(analytics.byDisconnect)
                  .sort(([, a], [, b]) => b - a)
                  .map(([k, v]) => ({ name: humanize(k), value: v }))}
                color={CHART.danger}
              />
            </ChartCard>
          </div>

          {/* ── Per-agent breakdown ── */}
          {!selectedAgentId && (
            <div className="px-6 pt-4">
              <ChartCard title="Per-Agent Breakdown" icon={PhoneCall} color={CHART.primary}>
                {Object.keys(analytics.byAgent).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No agent activity.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <TableHead>
                        <Th>Agent</Th>
                        <Th>Calls</Th>
                        <Th>Talk time</Th>
                        <Th>Avg duration</Th>
                        <Th />
                      </TableHead>
                      <tbody>
                        {Object.entries(analytics.byAgent)
                          .sort(([, a], [, b]) => b.count - a.count)
                          .map(([id, v]) => (
                            <tr key={id} className="h-11 border-b border-white/[0.04] transition-colors hover:bg-white/[0.02]">
                              <td className="px-3 py-2.5 text-sm font-medium">
                                {agentNames[id] ?? agentList.find((a) => a.id === id)?.name ?? (
                                  <span className="font-mono text-xs text-muted-foreground">{id}</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 tabular-nums">{v.count}</td>
                              <td className="px-3 py-2.5 tabular-nums">{fmtDuration(v.durationSec)}</td>
                              <td className="px-3 py-2.5 tabular-nums">{fmtDuration(v.count ? v.durationSec / v.count : 0)}</td>
                              <td className="px-3 py-2.5">
                                <button onClick={() => setSelectedAgentId(id)} className="text-xs text-primary hover:underline">
                                  View only
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </ChartCard>
            </div>
          )}
        </>
      )}

      {q.isLoading && (
        <div className="px-6 pt-5 text-sm text-muted-foreground">Loading analytics…</div>
      )}
    </div>
  );
}

// ── Reusable chart wrapper ────────────────────────────────────────────────────
function ChartCard({
  title, icon: Icon, color, children,
}: {
  title: string;
  icon: React.ElementType;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-card/50 p-4 backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" style={{ color }} />
        <h3 className="text-xs font-semibold uppercase tracking-[0.10em] text-muted-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function NoData() {
  return <p className="py-8 text-center text-xs text-muted-foreground">No data in this range.</p>;
}

// ── Compact donut chart ───────────────────────────────────────────────────────
function CompactDonut({
  data, colors, centerLabel, centerValue,
}: {
  data: { name: string; value: number }[];
  colors: string[];
  centerLabel: string;
  centerValue: number;
}) {
  const filtered = data.filter((d) => d.value > 0);
  if (filtered.length === 0) return <NoData />;
  return (
    <div className="relative h-52 w-full">
      <ResponsiveContainer>
        <PieChart>
          <Tooltip content={<ChartTooltip />} />
          <Pie
            data={filtered} dataKey="value" nameKey="name"
            innerRadius={52} outerRadius={76} paddingAngle={2} stroke="none"
          >
            {filtered.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Pie>
          <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 10, color: CHART.axis }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-8">
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{centerLabel}</span>
        <span className="text-xl font-bold tabular-nums">{centerValue}</span>
      </div>
    </div>
  );
}

// ── Horizontal bar chart ──────────────────────────────────────────────────────
function HBarChart({ data, color = CHART.primary }: { data: { name: string; value: number }[]; color?: string }) {
  if (data.length === 0) return <NoData />;
  const height = Math.max(140, data.length * 34);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 2, right: 16, left: 0, bottom: 2 }}>
          <CartesianGrid stroke={CHART.grid} horizontal={false} />
          <XAxis type="number" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} width={130} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(139,92,246,0.07)" }} />
          <Bar dataKey="value" fill={color} radius={[0, 5, 5, 0]} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Latency stat tile ─────────────────────────────────────────────────────────
function LatencyTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/40 px-3 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color }}>{label}</p>
      <p className="mt-1.5 text-xl font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
