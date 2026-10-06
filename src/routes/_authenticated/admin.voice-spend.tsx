/**
 * Voice spend — what calls actually cost, for the owner.
 *
 * Deliberately separate from `admin.cost-engine`, which models what a minute *should* cost from
 * editable assumptions. This shows actuals from the providers each call really used, so the two
 * can be compared rather than conflated.
 */
import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, AlertTriangle, DollarSign, Clock, Radio, TrendingUp } from "lucide-react";
import { getVoiceSpendDashboard } from "@/lib/voice/voice-spend.functions";

export const Route = createFileRoute("/_authenticated/admin/voice-spend")({
  component: VoiceSpendPage,
});

const RANGE_OPTIONS = [1, 7, 30, 90] as const;

/** Sub-cent figures are the norm here, so a plain 2dp currency format would read as $0.00. */
function usd(v: number, dp = 4) {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: dp })}`;
}
function mmss(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function shortTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

function VoiceSpendPage() {
  const dashboardFn = useServerFn(getVoiceSpendDashboard);
  const [days, setDays] = React.useState<number>(7);

  const q = useQuery({
    queryKey: ["admin-voice-spend", days],
    queryFn: () => dashboardFn({ data: { days, limit: 50 } }),
    // Live calls are the only thing that moves on its own; everything else is settled history.
    refetchInterval: 15_000,
    throwOnError: false,
  });

  const d = q.data;
  const maxDayCost = Math.max(1e-9, ...(d?.byDay ?? []).map((x) => x.costUsd));

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Voice spend</h1>
          <p className="text-xs text-muted-foreground">
            What calls actually cost, priced against the providers each call really used.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {RANGE_OPTIONS.map((n) => (
            <Button
              key={n}
              size="sm"
              variant={days === n ? "default" : "outline"}
              onClick={() => setDays(n)}
            >
              {n}d
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {q.error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-2 pt-6 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{String((q.error as any)?.message ?? q.error)}</span>
          </CardContent>
        </Card>
      ) : null}

      {/* Accuracy caveats are shown, not hidden — a cost figure the reader cannot trust is
          worse than one they can discount. */}
      {(d?.warnings?.length ?? 0) > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/[0.04]">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Accuracy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 pt-0 text-xs text-muted-foreground">
            {d!.warnings.map((w) => (
              <div key={w}>• {w}</div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={DollarSign}
          label={`Spend (${d?.rangeDays ?? days}d)`}
          value={d ? usd(d.totals.costUsd, 2) : "—"}
          sub={d ? `${d.totals.calls} calls` : undefined}
        />
        <Stat
          icon={Clock}
          label="Minutes"
          value={d ? d.totals.minutes.toLocaleString() : "—"}
          sub={d ? `${usd(d.totals.avgCostPerMin, 5)} per minute` : undefined}
        />
        <Stat
          icon={TrendingUp}
          label="Gross margin"
          value={d ? `${d.totals.marginPct}%` : "—"}
          sub={
            d?.markup
              ? `${usd(d.totals.profitUsd, 2)} on ${usd(d.totals.sellingUsd, 2)} — ${d.markup.label} ${d.markup.value}${d.markup.type === "percentage" ? "%" : ""}`
              : "No active markup configured"
          }
        />
        <Stat
          icon={Radio}
          label="Live now"
          value={d ? String(d.live.length) : "—"}
          sub={
            d && d.providerCoverage.total > 0
              ? `${d.providerCoverage.recorded}/${d.providerCoverage.total} calls fully attributed`
              : undefined
          }
        />
      </div>

      {/* ── Live calls ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Radio className="h-4 w-4 text-emerald-500" />
            Calls in progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!d?.live.length ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No calls in progress.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 font-medium">Started</th>
                  <th className="pb-2 text-right font-medium">Elapsed</th>
                  <th className="pb-2 text-right font-medium">Accrued</th>
                </tr>
              </thead>
              <tbody>
                {d.live.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2">{c.agentName ?? "—"}</td>
                    <td className="py-2 text-muted-foreground">{shortTime(c.startedAt)}</td>
                    <td className="py-2 text-right tabular-nums">{mmss(c.elapsedSeconds)}</td>
                    <td className="py-2 text-right tabular-nums">{usd(c.estCostUsd, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Accrued at the blended engine rate — which providers a call used is only known once it
            ends.
          </p>
        </CardContent>
      </Card>

      {/* ── Daily trend ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Spend by day</CardTitle>
        </CardHeader>
        <CardContent>
          {!d?.byDay.length ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No calls in this range.</p>
          ) : (
            <div className="space-y-1.5">
              {d.byDay.map((row) => (
                <div key={row.day} className="flex items-center gap-3 text-xs">
                  <span className="w-20 shrink-0 text-muted-foreground">{row.day.slice(5)}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full rounded bg-primary/70"
                      style={{ width: `${Math.max(2, (row.costUsd / maxDayCost) * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right tabular-nums">{usd(row.costUsd, 3)}</span>
                  <span className="w-28 shrink-0 text-right text-muted-foreground tabular-nums">
                    {row.calls} calls · {row.minutes}m
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Provider mix ── */}
      {d?.providerMix.length ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Cost by provider</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Stage</th>
                  <th className="pb-2 font-medium">Provider</th>
                  <th className="pb-2 text-right font-medium">Calls</th>
                  <th className="pb-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {d.providerMix.map((m) => (
                  <tr key={`${m.kind}-${m.provider}`} className="border-b last:border-0">
                    <td className="py-2">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {m.kind}
                      </Badge>
                    </td>
                    <td className="py-2 font-mono">{m.provider}</td>
                    <td className="py-2 text-right tabular-nums">{m.calls}</td>
                    <td className="py-2 text-right tabular-nums">{usd(m.costUsd, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Per-call detail ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Recent calls</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!d?.recent.length ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No calls in this range.</p>
          ) : (
            <table className="w-full min-w-[820px] text-xs">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Started</th>
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 text-right font-medium">Min</th>
                  <th className="pb-2 font-medium">STT</th>
                  <th className="pb-2 font-medium">LLM</th>
                  <th className="pb-2 font-medium">TTS</th>
                  <th className="pb-2 text-right font-medium">STT $</th>
                  <th className="pb-2 text-right font-medium">LLM $</th>
                  <th className="pb-2 text-right font-medium">TTS $</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 whitespace-nowrap text-muted-foreground">
                      {shortTime(c.startedAt)}
                      {c.isTestCall ? (
                        <Badge variant="outline" className="ml-1.5 text-[9px]">
                          test
                        </Badge>
                      ) : null}
                    </td>
                    <td className="max-w-[160px] truncate py-2">{c.agentName ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">{c.minutes}</td>
                    <td className="py-2 font-mono text-[11px]">{c.sttProvider ?? "—"}</td>
                    <td className="py-2 font-mono text-[11px]">{c.llmProvider ?? "—"}</td>
                    <td className="py-2 font-mono text-[11px]">{c.ttsProvider ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">{usd(c.sttUsd, 4)}</td>
                    <td className="py-2 text-right tabular-nums">{usd(c.llmUsd, 4)}</td>
                    <td className="py-2 text-right tabular-nums">{usd(c.ttsUsd, 4)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {usd(c.totalUsd, 4)}
                      {c.estimated ? (
                        <span
                          className="ml-1 text-amber-600 dark:text-amber-400"
                          title="At least one stage had no recorded provider and fell back to the blended rate"
                        >
                          ~
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            <span className="text-amber-600 dark:text-amber-400">~</span> means at least one stage
            had no recorded provider and was priced at the blended rate rather than the provider's
            own.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
