import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTablePagination, TablePagBar } from "@/components/ui/table-pagination";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Building2, ChevronDown, ChevronRight, Search, Check,
  X, Clock, Package, Layers, RefreshCw, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  adminListWorkspacesWithModules,
  adminSetWorkspaceModules,
  adminListModuleRequests,
  adminDecideModuleRequest,
  MODULE_CATALOG,
} from "@/lib/modules/modules.functions";

export const Route = createFileRoute("/_authenticated/admin/workspaces")({
  component: AdminWorkspacesPage,
});

const PLAN_TIERS = [
  { id: "free",              label: "Free / PAYG",         color: "#64748b" },
  { id: "receptionist",     label: "Receptionist",         color: "#60a5fa" },
  { id: "lead_generation",  label: "Lead Generation",      color: "#4ade80" },
  { id: "pro_bundle",       label: "Pro Bundle",           color: "#f5b800" },
  { id: "scale_bundle",     label: "Scale Bundle",         color: "#e879f9" },
  { id: "executive_suite",  label: "Executive Suite",      color: "#f5b800" },
  { id: "business_command", label: "Business Command",     color: "#a78bfa" },
  { id: "enterprise",       label: "Enterprise",           color: "#38bdf8" },
];

function AdminWorkspacesPage() {
  const qc = useQueryClient();
  const fetchWorkspaces = useServerFn(adminListWorkspacesWithModules);
  const fetchRequests   = useServerFn(adminListModuleRequests);
  const setModulesFn    = useServerFn(adminSetWorkspaceModules);
  const decideFn        = useServerFn(adminDecideModuleRequest);

  const [search, setSearch]           = useState("");
  const [expanded, setExpanded]       = useState<string | null>(null);
  const [tab, setTab]                 = useState<"workspaces" | "requests">("workspaces");
  const [pendingModules, setPending]  = useState<Record<string, string[]>>({});
  const [pendingTiers, setPTiers]     = useState<Record<string, string>>({});

  const { data: workspaces = [], isLoading } = useQuery({
    queryKey: ["admin-workspaces-modules"],
    queryFn: () => fetchWorkspaces(),
    staleTime: 30_000,
    throwOnError: false,
  });

  const { data: requests = [], isLoading: reqLoading } = useQuery({
    queryKey: ["admin-module-requests"],
    queryFn: () => fetchRequests(),
    staleTime: 30_000,
    throwOnError: false,
  });

  const saveMut = useMutation({
    mutationFn: async ({ workspaceId, modules, planTier }: { workspaceId: string; modules: string[]; planTier: string }) => {
      const res = await setModulesFn({ data: { workspaceId, modules, planTier } });
      return res;
    },
    onSuccess: (_r, vars) => {
      toast.success("Modules updated");
      setPending((p) => { const n = { ...p }; delete n[vars.workspaceId]; return n; });
      setPTiers((p) => { const n = { ...p }; delete n[vars.workspaceId]; return n; });
      qc.invalidateQueries({ queryKey: ["admin-workspaces-modules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decideMut = useMutation({
    mutationFn: async ({ requestId, approve }: { requestId: string; approve: boolean }) => {
      return decideFn({ data: { requestId, approve } });
    },
    onSuccess: (_r, vars) => {
      toast.success(vars.approve ? "Module approved & activated" : "Request denied");
      qc.invalidateQueries({ queryKey: ["admin-module-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-workspaces-modules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filteredAll = (workspaces as any[]).filter((ws) =>
    ws.name?.toLowerCase().includes(search.toLowerCase())
  );
  const wsPag = useTablePagination(filteredAll, 25);
  const filtered = wsPag.sliced;

  const pending = (requests as any[]).filter((r) => r.status === "pending");

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-5 lg:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workspace Modules</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Assign packages and AI modules to workspaces. Review upgrade requests.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["admin-workspaces-modules"] });
            qc.invalidateQueries({ queryKey: ["admin-module-requests"] });
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-white/[0.06] pb-px">
        {(["workspaces", "requests"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px",
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "requests" ? (
              <span className="flex items-center gap-2">
                Upgrade Requests
                {pending.length > 0 && (
                  <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px]">
                    {pending.length}
                  </Badge>
                )}
              </span>
            ) : "Workspaces"}
          </button>
        ))}
      </div>

      {/* ── WORKSPACES TAB ── */}
      {tab === "workspaces" && (
        <div className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search workspaces…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>

          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : (
            <div className="space-y-2">
              {filtered.map((ws: any) => {
                const settings = ws.workspace_settings?.[0] ?? ws.workspace_settings ?? {};
                const currentModules: string[] = pendingModules[ws.id] ?? settings.active_modules ?? [];
                const currentTier: string = pendingTiers[ws.id] ?? settings.plan_tier ?? "free";
                const memberCount = ws.workspace_members?.[0]?.count ?? 0;
                const isOpen = expanded === ws.id;
                const isDirty = !!(pendingModules[ws.id] || pendingTiers[ws.id]);

                return (
                  <div key={ws.id} className="rounded-xl border border-white/[0.06] bg-card/40 overflow-hidden">
                    {/* Row header */}
                    <button
                      onClick={() => setExpanded(isOpen ? null : ws.id)}
                      className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Building2 className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{ws.name}</span>
                          <span
                            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                            style={{
                              background: `${PLAN_TIERS.find(t => t.id === currentTier)?.color ?? "#64748b"}18`,
                              color: PLAN_TIERS.find(t => t.id === currentTier)?.color ?? "#64748b",
                            }}
                          >
                            {PLAN_TIERS.find(t => t.id === currentTier)?.label ?? currentTier}
                          </span>
                          {isDirty && <Badge variant="secondary" className="text-[10px]">Unsaved</Badge>}
                        </div>
                        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {memberCount} members</span>
                          <span className="flex items-center gap-1"><Package className="h-3 w-3" /> {currentModules.length} modules</span>
                        </div>
                      </div>
                      {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                    </button>

                    {/* Expanded module editor */}
                    {isOpen && (
                      <div className="border-t border-white/[0.06] p-4 space-y-4">
                        {/* Plan tier selector */}
                        <div>
                          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block">Plan Tier</label>
                          <div className="flex flex-wrap gap-2">
                            {PLAN_TIERS.map((tier) => (
                              <button
                                key={tier.id}
                                onClick={() => setPTiers((p) => ({ ...p, [ws.id]: tier.id }))}
                                className={cn(
                                  "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                                  currentTier === tier.id
                                    ? "border-current text-white"
                                    : "border-white/[0.08] text-muted-foreground hover:border-white/20"
                                )}
                                style={currentTier === tier.id ? { borderColor: tier.color, color: tier.color, background: `${tier.color}15` } : {}}
                              >
                                {tier.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Module toggles */}
                        <div>
                          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block">Active Modules</label>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {MODULE_CATALOG.map((mod) => {
                              const active = currentModules.includes(mod.id);
                              return (
                                <button
                                  key={mod.id}
                                  onClick={() => {
                                    const next = active
                                      ? currentModules.filter((m) => m !== mod.id)
                                      : [...currentModules, mod.id];
                                    setPending((p) => ({ ...p, [ws.id]: next }));
                                  }}
                                  className={cn(
                                    "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all",
                                    active ? "bg-card border-primary/30" : "bg-transparent border-white/[0.06] hover:border-white/15"
                                  )}
                                >
                                  <div
                                    className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center"
                                    style={active ? { background: mod.color, borderColor: mod.color } : { borderColor: "rgba(255,255,255,0.2)" }}
                                  >
                                    {active && <Check className="h-2.5 w-2.5 text-black" />}
                                  </div>
                                  <div>
                                    <div className="text-xs font-medium" style={{ color: active ? mod.color : undefined }}>{mod.name}</div>
                                    <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{mod.price}</div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Save */}
                        <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.06]">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setPending((p) => { const n = { ...p }; delete n[ws.id]; return n; });
                              setPTiers((p) => { const n = { ...p }; delete n[ws.id]; return n; });
                            }}
                            disabled={!isDirty}
                          >
                            Discard
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => saveMut.mutate({ workspaceId: ws.id, modules: currentModules, planTier: currentTier })}
                            disabled={saveMut.isPending}
                          >
                            Save modules
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredAll.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  <Layers className="mx-auto h-8 w-8 mb-3 opacity-30" />
                  No workspaces found
                </div>
              )}
              {filteredAll.length > 0 && <TablePagBar {...wsPag} />}
            </div>
          )}
        </div>
      )}

      {/* ── REQUESTS TAB ── */}
      {tab === "requests" && (
        <div className="space-y-3">
          {reqLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : (requests as any[]).length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <Clock className="mx-auto h-8 w-8 mb-3 opacity-30" />
              No upgrade requests yet
            </div>
          ) : (
            (requests as any[]).map((req: any) => (
              <div key={req.id} className="rounded-xl border border-white/[0.06] bg-card/40 p-4 flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {(req.workspaces as any)?.name ?? req.workspace_id}
                    </span>
                    <Badge
                      variant={req.status === "pending" ? "secondary" : req.status === "approved" ? "default" : "destructive"}
                      className="text-[10px]"
                    >
                      {req.status}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Requested <strong className="text-foreground">{req.module_name}</strong>
                    {" · "}{new Date(req.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                  {req.notes && <div className="mt-1 text-xs text-muted-foreground italic">&ldquo;{req.notes}&rdquo;</div>}
                </div>
                {req.status === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => decideMut.mutate({ requestId: req.id, approve: false })}
                      disabled={decideMut.isPending}
                    >
                      <X className="h-3.5 w-3.5" /> Deny
                    </Button>
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => decideMut.mutate({ requestId: req.id, approve: true })}
                      disabled={decideMut.isPending}
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
