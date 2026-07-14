/**
 * Workspace Custom Views — People section.
 *
 * Renders workspace-scoped saved views (workspace_people_views) for the
 * current workspace only. Standard workspaces only — WBAH keeps its own
 * live-CRM tabs and never renders this component.
 */
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listWorkspacePeopleViews,
  updateWorkspacePeopleView,
  duplicateWorkspacePeopleView,
  convertPeopleViewToCampaignFilter,
  dryRunWorkspaceFilter,
  runWorkspacePeopleView,
  listWorkspaceViewVersions,
  rollbackWorkspaceViewVersion,
} from "@/lib/people-views/people-views.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Eye, Copy, Archive, Filter, RefreshCw, History, Sparkles, FlaskConical, ChevronLeft, CheckCircle2,
} from "lucide-react";

type ViewRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  filter_config: { conditions: Array<{ field: string; operator: string; value?: unknown }> };
  status: string;
  version: number;
  created_by_systemmind: boolean;
  last_dry_run: { totalMatching?: number } | null;
  last_dry_run_at: string | null;
  updated_at: string;
};

export function CustomViewsSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWorkspacePeopleViews);
  const updateFn = useServerFn(updateWorkspacePeopleView);
  const duplicateFn = useServerFn(duplicateWorkspacePeopleView);
  const convertFn = useServerFn(convertPeopleViewToCampaignFilter);
  const dryRunFn = useServerFn(dryRunWorkspaceFilter);
  const runViewFn = useServerFn(runWorkspacePeopleView);
  const versionsFn = useServerFn(listWorkspaceViewVersions);
  const rollbackFn = useServerFn(rollbackWorkspaceViewVersion);

  const [openViewId, setOpenViewId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["workspace-people-views"],
    queryFn: () => listFn(),
    staleTime: 30_000,
    throwOnError: false,
  });
  const views = ((data as any)?.views ?? []) as ViewRow[];

  const openView = useMemo(() => views.find((v) => v.id === openViewId) ?? null, [views, openViewId]);

  const { data: viewRows, isFetching: rowsLoading } = useQuery({
    queryKey: ["workspace-people-view-rows", openViewId],
    queryFn: () => runViewFn({ data: { viewId: openViewId! } }),
    enabled: !!openViewId,
    staleTime: 30_000,
    throwOnError: false,
  });

  const { data: versionsData } = useQuery({
    queryKey: ["workspace-people-view-versions", historyFor],
    queryFn: () => versionsFn({ data: { objectType: "people_view", id: historyFor! } }),
    enabled: !!historyFor,
    throwOnError: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["workspace-people-views"] });
    qc.invalidateQueries({ queryKey: ["workspace-people-view-rows"] });
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

  if (isLoading) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4 text-xs text-muted-foreground">
        Loading custom views…
      </div>
    );
  }

  if (!openView) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-card/60">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Custom Views
            <span className="ml-2 normal-case text-xs font-normal tracking-normal">
              workspace-specific saved views{views.length > 0 ? ` · ${views.length}` : ""}
            </span>
          </p>
        </div>

        {views.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No custom views yet. Ask SystemMind to create one — e.g. “Create a People view for
            booked appointments” — from the SystemMind Build Workspace.
          </div>
        ) : (
          <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {views.map((v) => (
              <div key={v.id} className="rounded-lg border border-white/[0.08] bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{v.name}</p>
                    {v.description && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{v.description}</p>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] ${v.status === "active" ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-400"}`}
                  >
                    {v.status}
                  </Badge>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {(v.filter_config?.conditions ?? []).slice(0, 4).map((c, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px] font-normal">
                      <Filter className="mr-1 h-2.5 w-2.5" />
                      {c.field} {c.operator.replace(/_/g, " ")}
                      {c.value !== undefined && c.value !== null ? ` ${String(c.value)}` : ""}
                    </Badge>
                  ))}
                  {v.created_by_systemmind && (
                    <Badge variant="secondary" className="text-[10px] font-normal text-indigo-300">
                      <Sparkles className="mr-1 h-2.5 w-2.5" /> SystemMind
                    </Badge>
                  )}
                </div>

                <p className="mt-2 text-[10px] text-muted-foreground">
                  v{v.version}
                  {v.last_dry_run?.totalMatching !== undefined && (
                    <> · {v.last_dry_run.totalMatching} matching (last test)</>
                  )}
                  {" · updated "}
                  {new Date(v.updated_at).toLocaleDateString()}
                </p>

                <div className="mt-2 flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setOpenViewId(v.id)}>
                    <Eye className="mr-1 h-3 w-3" /> Open
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                    disabled={busyId === v.id}
                    onClick={() =>
                      act(v.id, "Dry-run complete", async () => {
                        const res: any = await dryRunFn({
                          data: { objectType: "people_view", id: v.id, filterConfig: v.filter_config },
                        });
                        toast.info(`${res.result.totalMatching} matching record(s)`);
                      })
                    }
                  >
                    <FlaskConical className="mr-1 h-3 w-3" /> Test
                  </Button>
                  {v.status === "draft" && (
                    <Button
                      size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-emerald-400"
                      disabled={busyId === v.id}
                      onClick={() =>
                        act(v.id, "View activated", () =>
                          updateFn({ data: { id: v.id, patch: { status: "active" } } }),
                        )
                      }
                    >
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Activate
                    </Button>
                  )}
                  <Button
                    size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                    disabled={busyId === v.id}
                    onClick={() => act(v.id, "View duplicated", () => duplicateFn({ data: { id: v.id } }))}
                  >
                    <Copy className="mr-1 h-3 w-3" /> Duplicate
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                    disabled={busyId === v.id}
                    onClick={() =>
                      act(v.id, "Converted to campaign filter (draft)", () =>
                        convertFn({ data: { viewId: v.id } }),
                      )
                    }
                  >
                    <Filter className="mr-1 h-3 w-3" /> To Campaign Filter
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                    onClick={() => setHistoryFor(historyFor === v.id ? null : v.id)}
                  >
                    <History className="mr-1 h-3 w-3" /> Versions
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-red-400"
                    disabled={busyId === v.id}
                    onClick={() =>
                      act(v.id, "View archived", () =>
                        updateFn({ data: { id: v.id, patch: { status: "archived" } } }),
                      )
                    }
                  >
                    <Archive className="mr-1 h-3 w-3" /> Archive
                  </Button>
                </div>

                {historyFor === v.id && (
                  <div className="mt-2 rounded-md border border-white/[0.08] bg-black/20 p-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Version history
                    </p>
                    {(((versionsData as any)?.versions ?? []) as Array<any>).length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">No previous versions.</p>
                    ) : (
                      (((versionsData as any)?.versions ?? []) as Array<any>).map((ver) => (
                        <div key={ver.id} className="flex items-center justify-between py-0.5 text-[11px]">
                          <span>
                            v{ver.version} · {new Date(ver.created_at).toLocaleString()}
                          </span>
                          <Button
                            size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]"
                            disabled={busyId === v.id}
                            onClick={() =>
                              act(v.id, `Rolled back to v${ver.version}`, () =>
                                rollbackFn({
                                  data: { objectType: "people_view", id: v.id, versionId: ver.id },
                                }),
                              )
                            }
                          >
                            Rollback
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Open view: matching leads ─────────────────────────────────────────────
  const rows = ((viewRows as any)?.rows ?? []) as Array<Record<string, any>>;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setOpenViewId(null)}>
          <ChevronLeft className="h-3 w-3" /> Back
        </Button>
        <p className="text-sm font-medium">{openView.name}</p>
        <Badge variant="outline" className="text-[10px]">{rows.length} record(s)</Badge>
        {rowsLoading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Sentiment</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {rowsLoading ? "Loading…" : "No matching records."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-white/[0.04]">
                  <td className="px-3 py-1.5">{r.full_name ?? "—"}</td>
                  <td className="px-3 py-1.5">{r.phone ?? "—"}</td>
                  <td className="px-3 py-1.5">{r.email ?? "—"}</td>
                  <td className="px-3 py-1.5 capitalize">{String(r.status ?? "—").replace(/_/g, " ")}</td>
                  <td className="px-3 py-1.5 capitalize">{r.sentiment ?? "—"}</td>
                  <td className="px-3 py-1.5 capitalize">{r.source ?? "—"}</td>
                  <td className="px-3 py-1.5">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
