import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Database, AlertTriangle, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { getDataLimitsReport, type DataLimitRow } from "@/lib/admin/data-limits.functions";
import { SystemMindShell } from "./SystemMindShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function pctBar(pct: number, level: DataLimitRow["level"]) {
  const color =
    level === "critical" ? "bg-red-500" :
    level === "near"     ? "bg-amber-500" :
    level === "warning"  ? "bg-yellow-400" :
    "bg-emerald-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}

function LevelBadge({ level }: { level: DataLimitRow["level"] }) {
  if (level === "critical") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400">
      <XCircle className="h-3 w-3" /> Critical
    </span>
  );
  if (level === "near") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
      <AlertCircle className="h-3 w-3" /> Near Limit
    </span>
  );
  if (level === "warning") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-400/15 px-2 py-0.5 text-[11px] font-medium text-yellow-400">
      <AlertTriangle className="h-3 w-3" /> Warning
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
      <CheckCircle2 className="h-3 w-3" /> OK
    </span>
  );
}

function recommendation(row: DataLimitRow): string | null {
  if (row.level === "ok") return null;
  const tbl = row.label;
  if (row.level === "critical")
    return `${tbl} has exceeded 90% of the soft limit. Archive or purge old records immediately to prevent performance degradation.`;
  if (row.level === "near")
    return `${tbl} is approaching the soft limit (${row.pct}%). Plan an archiving or partitioning strategy soon.`;
  return `${tbl} is at ${row.pct}% of the soft limit. Monitor growth and prepare a cleanup plan.`;
}

function fmt(n: number) {
  if (n < 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function SystemMindDataLimitsPage() {
  const getFn = useServerFn(getDataLimitsReport);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["systemmind-data-limits"],
    queryFn: () => getFn(),
    staleTime: 120_000,
    throwOnError: false,
  });

  const rows = data?.rows ?? [];
  const critical = rows.filter((r) => r.level === "critical");
  const near     = rows.filter((r) => r.level === "near");
  const warning  = rows.filter((r) => r.level === "warning");
  const ok       = rows.filter((r) => r.level === "ok");

  const summary =
    critical.length > 0 ? `${critical.length} critical` :
    near.length > 0     ? `${near.length} near limit` :
    warning.length > 0  ? `${warning.length} at warning` :
    rows.length > 0     ? "All tables OK" : "Loading…";

  return (
    <SystemMindShell>
      <div className="mx-auto w-full max-w-5xl px-6 py-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Database className="h-5 w-5 text-muted-foreground" />
              Data Limits Monitor
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Platform-wide table usage vs soft limits — {summary}
              {data?.fetchedAt && (
                <span className="ml-2 opacity-60">
                  · as of {new Date(data.fetchedAt).toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {(critical.length > 0 || near.length > 0) && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-2">
            <p className="text-sm font-medium text-red-400 flex items-center gap-1.5">
              <XCircle className="h-4 w-4" /> Action required
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground list-disc list-inside">
              {[...critical, ...near].map((r) => (
                <li key={r.key}>{recommendation(r)}</li>
              ))}
            </ul>
          </div>
        )}

        {warning.length > 0 && (
          <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/5 p-4 space-y-2">
            <p className="text-sm font-medium text-yellow-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Monitor closely
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground list-disc list-inside">
              {warning.map((r) => (
                <li key={r.key}>{recommendation(r)}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_160px] gap-x-4 px-4 py-2 bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            <span>Table</span>
            <span className="text-right">Count</span>
            <span className="text-right">Soft Limit</span>
            <span className="text-right">Usage</span>
            <span>Status</span>
          </div>
          <div className="divide-y">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-4 py-3 grid grid-cols-[1fr_auto_auto_auto_160px] gap-x-4 animate-pulse">
                  <div className="h-4 bg-muted rounded w-32" />
                  <div className="h-4 bg-muted rounded w-12" />
                  <div className="h-4 bg-muted rounded w-14" />
                  <div className="h-4 bg-muted rounded w-10" />
                  <div className="h-4 bg-muted rounded w-20" />
                </div>
              ))
            ) : rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No data returned. Check server logs.
              </div>
            ) : rows.map((row) => (
              <div key={row.key} className="px-4 py-3">
                <div className="grid grid-cols-[1fr_auto_auto_auto_160px] gap-x-4 items-center">
                  <div>
                    <p className="text-sm font-medium">{row.label}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{row.table}</p>
                  </div>
                  <p className="text-sm font-mono tabular-nums text-right">{fmt(row.count)}</p>
                  <p className="text-sm text-muted-foreground text-right">{fmt(row.softLimit)}</p>
                  <p className={cn("text-sm font-mono tabular-nums text-right font-medium",
                    row.level === "critical" ? "text-red-400" :
                    row.level === "near"     ? "text-amber-400" :
                    row.level === "warning"  ? "text-yellow-400" :
                    "text-emerald-400"
                  )}>
                    {row.count < 0 ? "—" : `${row.pct}%`}
                  </p>
                  <div className="space-y-1">
                    <LevelBadge level={row.level} />
                    {pctBar(row.pct, row.level)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {ok.length > 0 && rows.length > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            {ok.length} of {rows.length} tables are within safe limits.
            Soft limits trigger a review recommendation — they do not enforce hard cutoffs.
          </p>
        )}
      </div>
    </SystemMindShell>
  );
}
