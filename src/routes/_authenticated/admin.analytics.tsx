import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, BarChart3, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { adminGetPlatformAnalytics } from "@/lib/admin/platform-oversight.functions";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  component: AdminAnalyticsPage,
});

const WINDOW_OPTIONS = [7, 30, 90] as const;

function money(cents: number): string {
  return `£${((cents ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function AdminAnalyticsPage() {
  const getAnalytics = useServerFn(adminGetPlatformAnalytics);
  const [search, setSearch] = useState("");
  const [windowDays, setWindowDays] = useState<number>(30);
  const [pkgFilter, setPkgFilter] = useState<string>("");
  const [resellerFilter, setResellerFilter] = useState<string>("");

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin-platform-analytics", windowDays],
    queryFn: () => getAnalytics({ data: { windowDays } }),
    staleTime: 15_000,
    throwOnError: false,
  });

  const totals = data?.totals;
  const wbah = data?.wbah;
  const allRows = data?.rows ?? [];
  const packageOptions = Array.from(
    new Set(allRows.map((r: any) => r.packageKey).filter(Boolean)),
  ).sort() as string[];
  const resellerOptions = Array.from(
    new Map(
      allRows
        .filter((r: any) => r.resellerParentId)
        .map((r: any) => [r.resellerParentId, r.resellerParentName ?? r.resellerParentId]),
    ).entries(),
  ).sort((a, b) => String(a[1]).localeCompare(String(b[1]))) as [string, string][];
  const rows = allRows.filter(
    (r: any) =>
      (search.trim() ? r.name.toLowerCase().includes(search.trim().toLowerCase()) : true) &&
      (pkgFilter ? r.packageKey === pkgFilter : true) &&
      (resellerFilter
        ? r.resellerParentId === resellerFilter || r.workspaceId === resellerFilter
        : true),
  );

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Platform Analytics</h1>
            <p className="text-sm text-muted-foreground">
              Cross-workspace usage, campaign volume and report delivery health.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border">
            {WINDOW_OPTIONS.map((w) => (
              <button
                key={w}
                onClick={() => setWindowDays(w)}
                className={
                  "px-3 py-1.5 text-sm " +
                  (windowDays === w ? "bg-primary text-primary-foreground" : "text-muted-foreground")
                }
              >
                {w}d
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={"mr-2 h-4 w-4 " + (isFetching ? "animate-spin" : "")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Usage cost (mo)" value={totals ? money(totals.usageCostCents) : "—"} loading={isLoading} />
        <StatCard label="Campaign volume" value={totals?.campaignVolume ?? "—"} loading={isLoading} />
        <StatCard label="Failed campaigns" value={totals?.failedCampaigns ?? "—"} loading={isLoading} danger={(totals?.failedCampaigns ?? 0) > 0} />
        <StatCard label="Reports generated" value={totals?.reportVolume ?? "—"} loading={isLoading} />
        <StatCard label="Delivery failures" value={totals?.reportDeliveryFailures ?? "—"} loading={isLoading} danger={(totals?.reportDeliveryFailures ?? 0) > 0} />
      </div>

      {/* WBAH shown separately */}
      {wbah ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">
              WBAH (isolated)
            </Badge>
            <span className="text-sm font-medium">{wbah.name}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
            <div><span className="text-muted-foreground">Usage:</span> {money(wbah.usageCostCents)}</div>
            <div><span className="text-muted-foreground">Campaigns:</span> {wbah.campaignVolume}</div>
            <div><span className="text-muted-foreground">Failed:</span> {wbah.failedCampaigns}</div>
            <div><span className="text-muted-foreground">Reports:</span> {wbah.reportVolume}</div>
            <div><span className="text-muted-foreground">Delivery fails:</span> {wbah.reportDeliveryFailures}</div>
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter workspaces…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <select
          value={pkgFilter}
          onChange={(e) => setPkgFilter(e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          aria-label="Filter by package"
        >
          <option value="">All packages</option>
          {packageOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={resellerFilter}
          onChange={(e) => setResellerFilter(e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
          aria-label="Filter by reseller"
        >
          <option value="">All resellers</option>
          {resellerOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        {(pkgFilter || resellerFilter) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPkgFilter("");
              setResellerFilter("");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Workspace</th>
              <th className="px-3 py-2 text-right">Usage (mo)</th>
              <th className="px-3 py-2 text-right">Campaigns</th>
              <th className="px-3 py-2 text-right">Failed</th>
              <th className="px-3 py-2 text-right">Reports</th>
              <th className="px-3 py-2 text-right">Report fails</th>
              <th className="px-3 py-2 text-right">Delivery fails</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2" colSpan={7}>
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr className="border-t">
                <td className="px-3 py-6 text-center text-muted-foreground" colSpan={7}>
                  No workspaces match your filter.
                </td>
              </tr>
            ) : (
              rows.map((r: any) => (
                <tr key={r.workspaceId} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-right">{money(r.usageCostCents)}</td>
                  <td className="px-3 py-2 text-right">{r.campaignVolume}</td>
                  <td className="px-3 py-2 text-right">
                    {r.failedCampaigns > 0 ? (
                      <span className="inline-flex items-center gap-1 text-red-600">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {r.failedCampaigns}
                      </span>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{r.reportVolume}</td>
                  <td className="px-3 py-2 text-right">{r.reportsFailed}</td>
                  <td className="px-3 py-2 text-right">
                    {r.reportDeliveryFailures > 0 ? (
                      <span className="inline-flex items-center gap-1 text-red-600">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {r.reportDeliveryFailures}
                      </span>
                    ) : (
                      0
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  danger,
}: {
  label: string;
  value: string | number;
  loading?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      {loading ? (
        <Skeleton className="mt-1 h-6 w-16" />
      ) : (
        <div className={"mt-1 text-lg font-semibold " + (danger ? "text-red-600" : "")}>{value}</div>
      )}
    </div>
  );
}
