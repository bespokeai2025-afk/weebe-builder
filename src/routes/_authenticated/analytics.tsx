import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
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
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  if (ms === null || ms === undefined || !isFinite(ms)) return "\u2014";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function humanize(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
    const byStatus: Record<string, number> = {};
    const byDisconnect: Record<string, number> = {};
    const bySentiment: Record<string, number> = {
      Positive: 0,
      Neutral: 0,
      Negative: 0,
      Unknown: 0,
    };
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
      if (c.disconnection_reason)
        byDisconnect[c.disconnection_reason] = (byDisconnect[c.disconnection_reason] ?? 0) + 1;
      const sentiment = c.call_analysis?.user_sentiment ?? "Unknown";
      bySentiment[sentiment] = (bySentiment[sentiment] ?? 0) + 1;
      const durSec =
        c.call_cost?.total_duration_seconds ??
        (c.end_timestamp && c.start_timestamp
          ? Math.max(0, (c.end_timestamp - c.start_timestamp) / 1000)
          : 0);
      totalDurationSec += durSec;
      const costCents = c.call_cost?.combined_cost ?? 0;
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
        byDay[d.toISOString().slice(0, 10)] = (byDay[d.toISOString().slice(0, 10)] ?? 0) + 1;
      }
      if (c.latency?.llm?.p50 != null) llmLatencies.push(c.latency.llm.p50);
      if (c.latency?.e2e?.p50 != null) e2eLatencies.push(c.latency.e2e.p50);
      if (c.latency?.tts?.p50 != null) ttsLatencies.push(c.latency.tts.p50);
    }
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const avgDuration = total ? totalDurationSec / total : 0;
    const avgCost = total ? totalCostCents / total : 0;
    return {
      total,
      inbound: calls.filter((c) => c.direction === "inbound").length,
      outbound: calls.filter((c) => c.direction === "outbound").length,
      webCalls: calls.filter((c) => c.call_type === "web_call").length,
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

  const dayEntries = useMemo(
    () =>
      Object.entries(analytics.byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-30),
    [analytics.byDay],
  );
  const maxDay = Math.max(1, ...dayEntries.map(([, v]) => v));

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All call performance metrics from your voice agents
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => q.refetch()}
            disabled={q.isRefetching}
          >
            <RefreshCw className={cn("h-4 w-4", q.isRefetching && "animate-spin")} />
          </Button>
          <div className="flex gap-1 rounded-lg border border-border bg-card/40 p-1">
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
        </div>
      </div>

      {result?.error && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Analytics error: {result.error}</span>
        </div>
      )}

      {result && !result.configured ? (
        <Card>
          <CardContent>
            <p className="py-8 text-center text-sm text-muted-foreground">
              Deploy a voice agent to start collecting analytics.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total calls
                </CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{analytics.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total talk time
                </CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{fmtDuration(analytics.totalDurationSec)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total cost
                </CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{fmtMoney(analytics.totalCostCents)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Success rate
                </CardTitle>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{analytics.successRate.toFixed(1)}%</p>
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Avg duration
                </CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{fmtDuration(analytics.avgDuration)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Avg cost / call
                </CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{fmtMoney(analytics.avgCost)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Voicemails
                </CardTitle>
                <Voicemail className="h-4 w-4 text-amber-400" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{analytics.voicemailCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Unsuccessful
                </CardTitle>
                <XCircle className="h-4 w-4 text-destructive" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{analytics.unsuccessCount}</p>
              </CardContent>
            </Card>
          </div>

          {/* Calls per day chart */}
          <Card className="mt-6">
            <CardContent>
              <div className="mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Calls per day</h3>
              </div>
              {dayEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data in this range.</p>
              ) : (
                <>
                  <div className="flex h-40 items-end gap-1">
                    {dayEntries.map(([day, v]) => (
                      <div
                        key={day}
                        className="group relative flex flex-1 flex-col items-center gap-1"
                      >
                        <div
                          className="w-full rounded-t bg-gradient-to-t from-primary/50 to-primary transition-all hover:from-primary hover:to-primary"
                          style={{
                            height: `${(v / maxDay) * 100}%`,
                            minHeight: 2,
                          }}
                        />
                        <div className="pointer-events-none absolute -top-8 hidden whitespace-nowrap rounded-md bg-popover px-2 py-1 text-[10px] shadow-md group-hover:block">
                          {day}: {v}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                    <span>{dayEntries[0]?.[0] ?? ""}</span>
                    <span>{dayEntries.at(-1)?.[0] ?? ""}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Sentiment + Call type */}
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardContent>
                <div className="mb-4 flex items-center gap-2">
                  <Smile className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">User sentiment</h3>
                </div>
                <div className="space-y-3">
                  <SentimentRow
                    icon={Smile}
                    label="Positive"
                    count={analytics.bySentiment.Positive ?? 0}
                    total={analytics.total}
                    tone="bg-emerald-500"
                  />
                  <SentimentRow
                    icon={Meh}
                    label="Neutral"
                    count={analytics.bySentiment.Neutral ?? 0}
                    total={analytics.total}
                    tone="bg-amber-500"
                  />
                  <SentimentRow
                    icon={Frown}
                    label="Negative"
                    count={analytics.bySentiment.Negative ?? 0}
                    total={analytics.total}
                    tone="bg-rose-500"
                  />
                  <SentimentRow
                    icon={Meh}
                    label="Unknown"
                    count={analytics.bySentiment.Unknown ?? 0}
                    total={analytics.total}
                    tone="bg-muted-foreground/40"
                  />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <div className="mb-4 flex items-center gap-2">
                  <PhoneCall className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Call types</h3>
                </div>
                <div className="space-y-3">
                  <SentimentRow
                    icon={PhoneIncoming}
                    label="Inbound"
                    count={analytics.inbound}
                    total={analytics.total}
                    tone="bg-sky-500"
                  />
                  <SentimentRow
                    icon={PhoneOutgoing}
                    label="Outbound"
                    count={analytics.outbound}
                    total={analytics.total}
                    tone="bg-indigo-500"
                  />
                  <SentimentRow
                    icon={Activity}
                    label="Web calls"
                    count={analytics.webCalls}
                    total={analytics.total}
                    tone="bg-violet-500"
                  />
                  <SentimentRow
                    icon={CheckCircle2}
                    label="Successful"
                    count={analytics.successCount}
                    total={analytics.total}
                    tone="bg-emerald-500"
                  />
                  <SentimentRow
                    icon={XCircle}
                    label="Unsuccessful"
                    count={analytics.unsuccessCount}
                    total={analytics.total}
                    tone="bg-rose-500"
                  />
                  <SentimentRow
                    icon={Voicemail}
                    label="Voicemail"
                    count={analytics.voicemailCount}
                    total={analytics.total}
                    tone="bg-amber-500"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Status + Disconnect */}
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardContent>
                <div className="mb-4 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Call status</h3>
                </div>
                {Object.keys(analytics.byStatus).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data.</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(analytics.byStatus)
                      .sort(([, a], [, b]) => b - a)
                      .map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{humanize(k)}</span>
                          <span className="font-medium tabular-nums">{v}</span>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <div className="mb-4 flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Disconnection reasons</h3>
                </div>
                {Object.keys(analytics.byDisconnect).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data.</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(analytics.byDisconnect)
                      .sort(([, a], [, b]) => b - a)
                      .map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{humanize(k)}</span>
                          <span className="font-medium tabular-nums">{v}</span>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Latency */}
          <Card className="mt-6">
            <CardContent>
              <div className="mb-4 flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Average latency (p50)</h3>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <LatencyTile label="LLM" value={fmtMs(analytics.avgLlmLatency)} />
                <LatencyTile label="End-to-end" value={fmtMs(analytics.avgE2eLatency)} />
                <LatencyTile label="TTS" value={fmtMs(analytics.avgTtsLatency)} />
              </div>
            </CardContent>
          </Card>

          {/* Per-agent table */}
          <Card className="mt-6">
            <CardContent>
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
                      <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
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
                          <tr key={id} className="border-b border-border/40">
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
            </CardContent>
          </Card>
        </>
      )}

      {q.isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading analytics\u2026</p>}
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

function LatencyTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
