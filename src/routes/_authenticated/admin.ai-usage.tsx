import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { RefreshCw, Activity, DollarSign, AlertTriangle, Cpu, Stethoscope } from "lucide-react";
import {
  getModelRegistryStatus,
  getAiUsageDashboard,
  runAiBillingDiagnostic,
} from "@/lib/ai/ai-diagnostics.functions";

export const Route = createFileRoute("/_authenticated/admin/ai-usage")({
  component: AiUsagePage,
});

const RANGE_OPTIONS = [7, 30, 90] as const;

function fmtUsd(v: number) {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
function fmtInt(v: number) {
  return v.toLocaleString();
}

function AiUsagePage() {
  const registryFn = useServerFn(getModelRegistryStatus);
  const dashboardFn = useServerFn(getAiUsageDashboard);
  const diagnosticFn = useServerFn(runAiBillingDiagnostic);
  const [days, setDays] = React.useState<number>(30);
  const [diag, setDiag] = React.useState<Awaited<ReturnType<typeof runAiBillingDiagnostic>> | null>(null);

  const registryQ = useQuery({
    queryKey: ["admin-ai-registry"],
    queryFn: () => registryFn(),
    throwOnError: false,
  });
  const usageQ = useQuery({
    queryKey: ["admin-ai-usage", days],
    queryFn: () => dashboardFn({ data: { days } }),
    throwOnError: false,
  });

  const diagMut = useMutation({
    mutationFn: () => diagnosticFn(),
    onSuccess: (r) => {
      setDiag(r);
      if (r.ok) toast.success(`Diagnostic OK — ${r.returnedModel} responded in ${r.latencyMs}ms`);
      else toast.error(`Diagnostic failed: ${r.error}`);
      usageQ.refetch();
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const d = usageQ.data;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="h-6 w-6" /> AI Usage &amp; Billing
          </h1>
          <p className="text-sm text-muted-foreground">
            Platform-wide AI model registry, usage ledger and billing diagnostics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {RANGE_OPTIONS.map((r) => (
            <Button key={r} size="sm" variant={days === r ? "default" : "outline"} onClick={() => setDays(r)}>
              {r}d
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => { registryQ.refetch(); usageQ.refetch(); }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> Requests</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{d ? fmtInt(d.totals.requests) : "—"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" /> Est. cost (window)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{d ? fmtUsd(d.totals.costUsd) : "—"}</div>
            {d && (
              <div className="text-xs text-muted-foreground mt-1">
                Today: {fmtUsd(d.spendTodayUsd)} · This month: {fmtUsd(d.spendThisMonthUsd)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Tokens in / out</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">
            {d ? `${fmtInt(d.totals.inputTokens)} / ${fmtInt(d.totals.outputTokens)}` : "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Failures / Fallbacks</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">
            {d ? `${fmtInt(d.totals.failures)} / ${fmtInt(d.totals.fallbacks)}` : "—"}
            {d && (d.totals as any).failedCostUsd > 0 && (
              <div className="text-xs font-normal text-muted-foreground mt-1">
                ${Number((d.totals as any).failedCostUsd).toFixed(4)} spent on failed requests
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Model registry */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Model registry</CardTitle>
          {registryQ.data && (
            <span className="text-xs text-muted-foreground">
              Fallback chain: {registryQ.data.fallbackChain.join(" → ")} (never gpt-4o)
            </span>
          )}
        </CardHeader>
        <CardContent>
          {registryQ.isLoading && <p className="text-sm text-muted-foreground">Checking model availability…</p>}
          {registryQ.error && <p className="text-sm text-destructive">Failed to load registry: {String((registryQ.error as any)?.message)}</p>}
          {registryQ.data && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Provider</th>
                    <th className="py-2 pr-4">Active model</th>
                    <th className="py-2 pr-4">Reasoning</th>
                    <th className="py-2 pr-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {registryQ.data.assignments.map((a) => (
                    <tr key={a.role} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{a.role}</td>
                      <td className="py-2 pr-4">{a.provider}</td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {a.activeModel}
                        {a.overridden && <Badge variant="outline" className="ml-2">env override ({a.envVar})</Badge>}
                      </td>
                      <td className="py-2 pr-4">{a.reasoningEffort ?? "—"}</td>
                      <td className="py-2 pr-4">
                        {a.available
                          ? <Badge className="bg-green-600 hover:bg-green-600">available</Badge>
                          : <Badge variant="destructive" title={a.availabilityError ?? undefined}>unavailable</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing diagnostic */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Stethoscope className="h-4 w-4" /> Billing diagnostic</CardTitle>
          <Button size="sm" onClick={() => diagMut.mutate()} disabled={diagMut.isPending}>
            {diagMut.isPending ? "Running…" : "Run diagnostic call"}
          </Button>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p className="text-muted-foreground">
            Makes one tiny real OpenAI request and records exactly which API key and model served it,
            so a charge on the provider invoice can be matched to this platform.
          </p>
          {diag && (
            <div className="mt-2 grid gap-1 font-mono text-xs">
              <div>Key: {diag.keyFingerprint}</div>
              <div>Requested: {diag.requestedModel} → Returned: {diag.returnedModel ?? "(failed)"}</div>
              <div>Request ID: {diag.requestId ?? "—"} · {diag.latencyMs}ms</div>
              {diag.ok && (
                <>
                  <div>
                    Tokens: {diag.inputTokens} in ({diag.cachedInputTokens} cached) / {diag.outputTokens} out
                    {" "}({diag.reasoningTokens} reasoning)
                  </div>
                  <div>Estimated cost: ${diag.estimatedCostUsd.toFixed(6)}</div>
                </>
              )}
              {diag.error && <div className="text-destructive">{diag.error}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Aggregations */}
      <div className="grid md:grid-cols-2 gap-4">
        <UsageTable title="By model" rows={d?.byModel ?? []} loading={usageQ.isLoading} />
        <UsageTable title="By department" rows={d?.byDepartment ?? []} loading={usageQ.isLoading} />
        <UsageTable title="By feature" rows={d?.byFeature ?? []} loading={usageQ.isLoading} />
        <UsageTable title="By workspace" rows={d?.byWorkspace ?? []} loading={usageQ.isLoading} />
        <UsageTable title="By routing class" rows={(d as any)?.byTaskClass ?? []} loading={usageQ.isLoading} />
      </div>

      {/* Recent routed requests */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent routed requests</CardTitle></CardHeader>
        <CardContent>
          {!(d as any)?.recentRouted?.length && <p className="text-sm text-muted-foreground">No routed AI requests in the selected window yet.</p>}
          {!!(d as any)?.recentRouted?.length && (
            <div className="space-y-2">
              {(d as any).recentRouted.map((r: any, i: number) => (
                <div key={i} className="text-xs border rounded p-2">
                  <span className="font-mono">{new Date(r.createdAt).toLocaleString()}</span>{" · "}
                  <span className="font-medium">{r.department}/{r.feature}</span>{" · "}
                  <Badge variant="outline">{r.taskClass}</Badge>{" "}
                  {r.reasoningEffort && <Badge variant="outline">reasoning: {r.reasoningEffort}</Badge>}{" "}
                  {r.fallbackUsed && <Badge variant="destructive">fallback</Badge>}
                  <div className="font-mono mt-1">{r.requestedModel} → {r.returnedModel ?? "(failed)"} · {r.status}</div>
                  {r.reason && <div className="text-muted-foreground mt-1">{r.reason}</div>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent failures */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent failures</CardTitle></CardHeader>
        <CardContent>
          {!d?.recentFailures?.length && <p className="text-sm text-muted-foreground">No failed AI requests in the selected window.</p>}
          {!!d?.recentFailures?.length && (
            <div className="space-y-2">
              {d.recentFailures.map((f, i) => (
                <div key={i} className="text-xs border rounded p-2">
                  <span className="font-mono">{new Date(f.createdAt).toLocaleString()}</span>{" · "}
                  <span className="font-medium">{f.department}/{f.feature}</span>{" · "}
                  <span className="font-mono">{f.model}</span>
                  <div className="text-destructive mt-1">{f.error}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UsageTable({ title, rows, loading }: {
  title: string;
  rows: Array<{ key: string; requests: number; inputTokens: number; outputTokens: number; costUsd: number; failures: number; fallbacks: number }>;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && !rows.length && <p className="text-sm text-muted-foreground">No usage recorded yet.</p>}
        {!!rows.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-1 pr-2">Key</th>
                  <th className="py-1 pr-2 text-right">Req</th>
                  <th className="py-1 pr-2 text-right">Tokens in/out</th>
                  <th className="py-1 pr-2 text-right">Cost</th>
                  <th className="py-1 pr-2 text-right">Fail/FB</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 12).map((r) => (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="py-1 pr-2 font-mono truncate max-w-[180px]">{r.key}</td>
                    <td className="py-1 pr-2 text-right">{fmtInt(r.requests)}</td>
                    <td className="py-1 pr-2 text-right">{fmtInt(r.inputTokens)}/{fmtInt(r.outputTokens)}</td>
                    <td className="py-1 pr-2 text-right">{fmtUsd(r.costUsd)}</td>
                    <td className="py-1 pr-2 text-right">{r.failures}/{r.fallbacks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
