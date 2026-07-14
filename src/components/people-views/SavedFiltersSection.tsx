/**
 * Workspace Saved Page Filters — generic collapsible section rendered on major
 * pages (calls, campaigns, leads, follow-up, workflows, analytics, data…).
 *
 * Read-only over page data: running a filter never mutates anything. Standard
 * workspaces only — WBAH pages never render this component.
 */
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listWorkspacePageFilters,
  updateWorkspacePageFilter,
  duplicateWorkspacePageFilter,
  setDefaultWorkspacePageFilter,
  dryRunWorkspacePageFilter,
  runWorkspacePageFilter,
} from "@/lib/people-views/page-filters.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Eye, Copy, Archive, Filter, Sparkles, FlaskConical, ChevronLeft, CheckCircle2, Star, StarOff, ChevronDown, ChevronRight,
} from "lucide-react";

type FilterRow = {
  id: string;
  page_key: string;
  name: string;
  description: string | null;
  filter_config: { conditions: Array<{ field: string; operator: string; value?: unknown }> };
  status: string;
  version: number;
  is_default: boolean;
  created_by_systemmind: boolean;
  last_dry_run: { totalMatching?: number } | null;
  last_dry_run_at: string | null;
  updated_at: string;
};

export function SavedFiltersSection({ pageKey }: { pageKey: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listWorkspacePageFilters);
  const updateFn = useServerFn(updateWorkspacePageFilter);
  const duplicateFn = useServerFn(duplicateWorkspacePageFilter);
  const setDefaultFn = useServerFn(setDefaultWorkspacePageFilter);
  const dryRunFn = useServerFn(dryRunWorkspacePageFilter);
  const runFn = useServerFn(runWorkspacePageFilter);

  const [expanded, setExpanded] = useState(false);
  const [openFilterId, setOpenFilterId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["workspace-page-filters", pageKey],
    queryFn: () => listFn({ data: { pageKey: pageKey as any } }),
    staleTime: 30_000,
    throwOnError: false,
  });
  const filters = ((data as any) ?? []) as FilterRow[];

  const openFilter = useMemo(
    () => filters.find((f) => f.id === openFilterId) ?? null,
    [filters, openFilterId],
  );

  const { data: rowsData, isFetching: rowsLoading } = useQuery({
    queryKey: ["workspace-page-filter-rows", openFilterId],
    queryFn: () => runFn({ data: { id: openFilterId! } }),
    enabled: !!openFilterId,
    staleTime: 30_000,
    throwOnError: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["workspace-page-filters", pageKey] });
    qc.invalidateQueries({ queryKey: ["workspace-page-filter-rows"] });
  };

  async function act(id: string, label: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
      toast.success(label);
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? `${label} failed`);
    } finally {
      setBusyId(null);
    }
  }

  // Hide the section entirely while loading or when no filters exist — pages
  // must behave exactly as before when the feature is unused.
  if (isLoading || filters.length === 0) return null;

  if (openFilter) {
    const rows = ((rowsData as any)?.rows ?? []) as Array<Record<string, unknown>>;
    const cols = rows.length > 0 ? Object.keys(rows[0]).filter((k) => k !== "id").slice(0, 6) : [];
    return (
      <div className="rounded-xl border border-white/[0.06] bg-card/60">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setOpenFilterId(null)}>
              <ChevronLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <p className="text-sm font-medium">{openFilter.name}</p>
            <Badge variant="outline" className="text-[10px]">v{openFilter.version}</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">{rowsLoading ? "Loading…" : `${rows.length} record(s)`}</p>
        </div>
        <div className="max-h-80 overflow-auto p-2">
          {rows.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">No records match this filter right now.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  {cols.map((c) => (
                    <th key={c} className="px-2 py-1 font-medium">{c.replace(/_/g, " ")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={String(r.id ?? i)} className="border-t border-white/[0.04]">
                    {cols.map((c) => (
                      <td key={c} className="px-2 py-1.5 max-w-[220px] truncate">{String(r[c] ?? "—")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2"
        onClick={() => setExpanded((v) => !v)}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <Filter className="mr-1.5 inline h-3 w-3" />
          Saved Filters
          <span className="ml-2 normal-case text-xs font-normal tracking-normal">
            {filters.length} for this page
          </span>
        </p>
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="divide-y divide-white/[0.04] border-t border-white/[0.06]">
          {filters.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-medium">{f.name}</p>
                  {f.is_default && <Badge className="text-[10px]" variant="secondary"><Star className="mr-0.5 h-2.5 w-2.5" />Default</Badge>}
                  {f.created_by_systemmind && <Badge variant="outline" className="text-[10px]"><Sparkles className="mr-0.5 h-2.5 w-2.5" />SystemMind</Badge>}
                  <Badge variant={f.status === "active" ? "secondary" : "outline"} className="text-[10px]">{f.status}</Badge>
                </div>
                <p className="truncate text-[11px] text-muted-foreground">
                  {f.filter_config?.conditions?.length ?? 0} condition(s)
                  {f.last_dry_run?.totalMatching !== undefined ? ` · last dry-run: ${f.last_dry_run.totalMatching} match(es)` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 px-2" disabled={busyId === f.id} onClick={() => setOpenFilterId(f.id)}>
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-7 px-2" disabled={busyId === f.id}
                  title="Dry run (read-only count)"
                  onClick={() => act(f.id, "Dry run complete", async () => {
                    const res: any = await dryRunFn({ data: { pageKey: pageKey as any, filterConfig: f.filter_config, id: f.id } });
                    toast.info(`${res?.totalMatching ?? 0} record(s) match`);
                  })}
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                </Button>
                {f.status === "draft" && (
                  <Button
                    variant="ghost" size="sm" className="h-7 px-2" disabled={busyId === f.id} title="Activate"
                    onClick={() => act(f.id, "Filter activated", () => updateFn({ data: { id: f.id, patch: { status: "active" } } }))}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost" size="sm" className="h-7 px-2" disabled={busyId === f.id}
                  title={f.is_default ? "Remove default" : "Set as default"}
                  onClick={() => act(f.id, f.is_default ? "Default removed" : "Set as default", () =>
                    setDefaultFn({ data: { id: f.id, isDefault: !f.is_default } }))}
                >
                  {f.is_default ? <StarOff className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-7 px-2" disabled={busyId === f.id} title="Duplicate"
                  onClick={() => act(f.id, "Filter duplicated", () => duplicateFn({ data: { id: f.id } }))}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-7 px-2" disabled={busyId === f.id} title="Archive"
                  onClick={() => act(f.id, "Filter archived", () => updateFn({ data: { id: f.id, patch: { status: "archived" } } }))}
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
