import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, RefreshCw, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { SummaryTooltip } from "@/components/dashboard/PageShell";
import { TablePagBar, type PageSize } from "@/components/ui/table-pagination";
import {
  getWbahCallbackSummary,
  listWbahCallbacks,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import {
  CALLBACK_TABS,
  formatCallbackTime,
  sourceLabel,
  type CallbackRow,
  type CallbackStatus,
  type CallbackSummary,
} from "@/lib/integrations/webespokeEnterprise/wbah-callbacks.types";
import { cn } from "@/lib/utils";

const EMPTY_SUMMARY: CallbackSummary = {
  pending: 0,
  due: 0,
  upcoming: 0,
  completedRecent: 0,
  missingPhone: 0,
};

function CallbackStatusBadge({ row }: { row: CallbackRow }) {
  if (!row.hasPhone) {
    return (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-400 text-[10px]">
        No phone
      </Badge>
    );
  }
  if (row.status === "completed" || row.callbackCompleted) {
    return (
      <Badge variant="outline" className="border-slate-500/30 bg-slate-500/10 text-slate-400 text-[10px]">
        Completed
      </Badge>
    );
  }
  if (row.isOverdue) {
    const mins = row.minutesOverdue;
    const label =
      typeof mins === "number" && mins > 0
        ? `Overdue (${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`})`
        : "Overdue";
    return (
      <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-400 text-[10px]">
        {label}
      </Badge>
    );
  }
  if (row.status === "upcoming") {
    const mins = row.minutesUntilDue;
    const label =
      typeof mins === "number" && mins >= 0
        ? mins < 60
          ? `In ${mins}m`
          : `In ${Math.floor(mins / 60)}h ${mins % 60}m`
        : "Upcoming";
    return (
      <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-400 text-[10px]">
        {label}
      </Badge>
    );
  }
  if (row.status === "due") {
    return (
      <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-400 text-[10px]">
        Due now
      </Badge>
    );
  }
  return null;
}

export function WbahCallbacksPanel({
  onSummaryChange,
}: {
  onSummaryChange?: (summary: CallbackSummary) => void;
}) {
  const summaryFn = useServerFn(getWbahCallbackSummary);
  const listFn = useServerFn(listWbahCallbacks);

  const [summary, setSummary] = useState<CallbackSummary>(EMPTY_SUMMARY);
  const [activeTab, setActiveTab] = useState<CallbackStatus>("pending");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [rows, setRows] = useState<CallbackRow[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const listInFlight = useRef(false);

  const applySummary = useCallback(
    (s: CallbackSummary) => {
      setSummary(s);
      onSummaryChange?.(s);
    },
    [onSummaryChange],
  );

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    setSummaryError(null);
    try {
      const s = (await summaryFn()) as CallbackSummary;
      applySummary(s);
    } catch (err) {
      setSummaryError((err as Error).message || "Failed to load callback summary");
    } finally {
      setLoadingSummary(false);
    }
  }, [applySummary, summaryFn]);

  const fetchList = useCallback(
    async (opts?: { page?: number; pageSize?: PageSize; status?: CallbackStatus; search?: string }) => {
      if (listInFlight.current) return;
      listInFlight.current = true;
      setLoadingList(true);
      setListError(null);
      const p = opts?.page ?? page;
      const ps = opts?.pageSize ?? pageSize;
      const st = opts?.status ?? activeTab;
      const q = opts?.search ?? debouncedSearch;
      try {
        const res = (await listFn({
          data: {
            status: st,
            page: p,
            pageSize: ps,
            search: q.trim() || undefined,
          },
        })) as { items: CallbackRow[]; pagination: { totalItems: number; totalPages: number } };
        setRows(res.items ?? []);
        setTotalItems(res.pagination?.totalItems ?? 0);
        setTotalPages(Math.max(1, res.pagination?.totalPages ?? 1));
        setLoaded(true);
      } catch (err) {
        setListError((err as Error).message || "Failed to load callbacks");
      } finally {
        setLoadingList(false);
        listInFlight.current = false;
      }
    },
    [activeTab, debouncedSearch, listFn, page, pageSize],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchSummary(), fetchList()]);
  }, [fetchSummary, fetchList]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    void fetchSummary();
    const id = setInterval(() => void fetchSummary(), 60_000);
    return () => clearInterval(id);
  }, [fetchSummary]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, debouncedSearch]);

  useEffect(() => {
    void fetchList({ page, pageSize, status: activeTab, search: debouncedSearch });
  }, [activeTab, debouncedSearch, page, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const showLoading = loadingList && !loaded;
  const empty = loaded && rows.length === 0 && !loadingList && !listError;

  return (
    <div className="min-w-0">
      {/* Sub-tabs + search */}
      <div className="flex flex-col gap-2 border-b border-white/[0.06] px-2.5 py-2 sm:px-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {CALLBACK_TABS.map((tab) => {
            const count = summary[tab.countKey];
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                  active
                    ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                    : "border-white/[0.06] bg-muted/20 text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {count > 0 && (
                  <span className="ml-1 rounded-full bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-400">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          {summary.missingPhone > 0 && (
            <span className="ml-1 text-[10px] text-amber-400">
              {summary.missingPhone} pending without phone
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, lead ID…"
                className="h-7 w-full min-w-[160px] max-w-[220px] rounded-md border border-white/[0.08] bg-muted/40 pl-7 pr-7 text-[11px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 sm:w-52"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void refreshAll()}
              disabled={loadingSummary || loadingList}
            >
              <RefreshCw
                className={cn("mr-1.5 h-3.5 w-3.5", (loadingSummary || loadingList) && "animate-spin")}
              />
              Refresh
            </Button>
          </div>
        </div>
        {summaryError && (
          <p className="text-[10px] text-amber-400 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Summary: {summaryError}
          </p>
        )}
      </div>

      {showLoading && (
        <LoadingProgress label="Loading callbacks" estimatedMs={6000} className="py-20" />
      )}

      {!showLoading && listError && (
        <div className="flex flex-col items-center gap-2 py-16 text-sm">
          <AlertCircle className="h-8 w-8 text-destructive/60" />
          <p className="font-medium text-destructive">Could not load callbacks</p>
          <p className="max-w-sm text-center text-xs text-muted-foreground">{listError}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void fetchList()}>
            Try again
          </Button>
        </div>
      )}

      {!showLoading && !listError && empty && (
        <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No callbacks in this view</p>
          <p className="text-xs">
            {debouncedSearch.trim()
              ? "Try a different search term."
              : "Pending callback requests from Dynamics sync and AI calls will appear here."}
          </p>
        </div>
      )}

      {!showLoading && !listError && rows.length > 0 && (
        <>
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-white/[0.06] bg-card/30">
                  <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Name</th>
                  <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Phone</th>
                  <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                    Callback time
                  </th>
                  <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Source</th>
                  <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Summary</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-white/[0.04] hover:bg-white/[0.02]"
                  >
                    <td className="px-2 py-1.5">
                      <div className="font-medium text-foreground">{row.name || "—"}</div>
                      {row.leadId && (
                        <div className="text-[10px] text-muted-foreground">Lead {row.leadId}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">{row.mobile || "—"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{formatCallbackTime(row)}</td>
                    <td className="px-2 py-1.5">{sourceLabel(row.callbackType)}</td>
                    <td className="px-2 py-1.5">
                      <CallbackStatusBadge row={row} />
                    </td>
                    <td className="max-w-[200px] px-2 py-1.5">
                      <SummaryTooltip text={row.callSummary} lines={2} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagBar
            page={page}
            pageSize={pageSize}
            totalPages={totalPages}
            total={totalItems}
            setPage={setPage}
            changePageSize={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        </>
      )}
    </div>
  );
}
