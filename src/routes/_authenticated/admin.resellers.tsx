import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Ban, Building2, CheckCircle2, ChevronDown, ChevronRight, History, Network } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  adminGetWorkspaceOversight,
  adminListChildWorkspaces,
  adminListResellers,
  adminSetFeatureOverride,
  adminSetResellerAccess,
  adminSetWorkspacePackage,
  adminSetWorkspaceSuspended,
} from "@/lib/admin/platform-oversight.functions";
import { adminGetPackageMatrix } from "@/lib/admin/platform-oversight.functions";

export const Route = createFileRoute("/_authenticated/admin/resellers")({
  component: AdminResellersPage,
});

function statusBadge(status: string | null) {
  const s = status ?? "none";
  const variant =
    s === "active" ? "default" : s === "suspended" || s === "cancelled" ? "destructive" : "secondary";
  return <Badge variant={variant as any}>{s}</Badge>;
}

function AdminResellersPage() {
  const qc = useQueryClient();
  const listResellers = useServerFn(adminListResellers);
  const listChildren = useServerFn(adminListChildWorkspaces);
  const getMatrix = useServerFn(adminGetPackageMatrix);
  const getOversight = useServerFn(adminGetWorkspaceOversight);
  const setResellerFn = useServerFn(adminSetResellerAccess);
  const setPackageFn = useServerFn(adminSetWorkspacePackage);
  const setSuspendedFn = useServerFn(adminSetWorkspaceSuspended);
  const setOverrideFn = useServerFn(adminSetFeatureOverride);

  const [tab, setTab] = useState<"resellers" | "children">("resellers");
  const [drillWs, setDrillWs] = useState<string | null>(null);

  const { data: resellers = [], isLoading: rLoading } = useQuery({
    queryKey: ["admin-resellers"],
    queryFn: () => listResellers(),
    staleTime: 30_000,
    throwOnError: false,
  });
  const { data: children = [], isLoading: cLoading } = useQuery({
    queryKey: ["admin-reseller-children"],
    queryFn: () => listChildren(),
    staleTime: 30_000,
    throwOnError: false,
  });
  const { data: matrix } = useQuery({
    queryKey: ["admin-package-matrix"],
    queryFn: () => getMatrix(),
    staleTime: 30_000,
    throwOnError: false,
  });
  const { data: oversight, isLoading: oLoading } = useQuery({
    queryKey: ["admin-ws-oversight", drillWs],
    queryFn: () => getOversight({ data: { workspaceId: drillWs! } }),
    enabled: !!drillWs,
    staleTime: 10_000,
    throwOnError: false,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-resellers"] });
    qc.invalidateQueries({ queryKey: ["admin-reseller-children"] });
    if (drillWs) qc.invalidateQueries({ queryKey: ["admin-ws-oversight", drillWs] });
  };

  const resellerMut = useMutation({
    mutationFn: async (v: { workspaceId: string; enabled: boolean | null }) => setResellerFn({ data: v }),
    onSuccess: () => { toast.success("Reseller access updated"); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const packageMut = useMutation({
    mutationFn: async (v: { workspaceId: string; packageKey: string }) => setPackageFn({ data: v }),
    onSuccess: () => { toast.success("Package changed"); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const suspendMut = useMutation({
    mutationFn: async (v: { workspaceId: string; suspended: boolean }) => setSuspendedFn({ data: v }),
    onSuccess: (r: any) => { toast.success(`Workspace ${r.status}`); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const overrideMut = useMutation({
    mutationFn: async (v: { workspaceId: string; featureKey: string; enabled: boolean | null }) =>
      setOverrideFn({ data: v }),
    onSuccess: () => { toast.success("Override updated"); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const packageOptions = (matrix?.packages ?? []).filter((p: any) => p.isActive);

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Network className="h-5 w-5 text-primary" /> Resellers &amp; Child Workspaces
          </h1>
          <p className="text-sm text-muted-foreground">
            Platform-level oversight of reseller access, child accounts, packages and suspensions. All actions are audited.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={tab === "resellers" ? "default" : "outline"} size="sm" onClick={() => setTab("resellers")}>
            Resellers ({resellers.length})
          </Button>
          <Button variant={tab === "children" ? "default" : "outline"} size="sm" onClick={() => setTab("children")}>
            Child workspaces ({children.length})
          </Button>
        </div>
      </div>

      {tab === "resellers" && (
        rLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : resellers.length === 0 ? (
          <div className="border rounded-lg p-8 text-center text-sm text-muted-foreground">
            No workspaces currently have reseller capability.
          </div>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="p-3">Workspace</th>
                  <th className="p-3">Owner</th>
                  <th className="p-3">Package</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Children</th>
                  <th className="p-3">White-label</th>
                  <th className="p-3">Email mode</th>
                  <th className="p-3">Reseller access</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {resellers.map((r: any) => (
                  <ResellerRow
                    key={r.workspaceId}
                    r={r}
                    packageOptions={packageOptions}
                    onDrill={() => setDrillWs(drillWs === r.workspaceId ? null : r.workspaceId)}
                    drilled={drillWs === r.workspaceId}
                    onSetReseller={(enabled) => resellerMut.mutate({ workspaceId: r.workspaceId, enabled })}
                    onSetPackage={(packageKey) => packageMut.mutate({ workspaceId: r.workspaceId, packageKey })}
                    onSuspend={(suspended) => suspendMut.mutate({ workspaceId: r.workspaceId, suspended })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === "children" && (
        cLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : children.length === 0 ? (
          <div className="border rounded-lg p-8 text-center text-sm text-muted-foreground">
            No reseller child accounts exist yet.
          </div>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="p-3">Client</th>
                  <th className="p-3">Reseller</th>
                  <th className="p-3">Package</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Usage</th>
                  <th className="p-3">Modes</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {children.map((c: any) => (
                  <tr key={c.clientId} className="border-b last:border-0">
                    <td className="p-3">
                      <div className="font-medium">{c.childName}</div>
                      <div className="text-xs text-muted-foreground">{c.ownerEmail ?? c.clientEmail}</div>
                      <div className="text-xs text-muted-foreground">
                        created {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                      </div>
                    </td>
                    <td className="p-3">{c.parentName}</td>
                    <td className="p-3">
                      {c.childWorkspaceId ? (
                        <select
                          className="bg-transparent border rounded px-2 py-1 text-xs"
                          value={c.packageKey ?? ""}
                          onChange={(e) =>
                            packageMut.mutate({ workspaceId: c.childWorkspaceId, packageKey: e.target.value })
                          }
                        >
                          {packageOptions.map((p: any) => (
                            <option key={p.packageKey} value={p.packageKey}>{p.packageName}</option>
                          ))}
                          {!packageOptions.some((p: any) => p.packageKey === c.packageKey) && c.packageKey && (
                            <option value={c.packageKey}>{c.packageName}</option>
                          )}
                        </select>
                      ) : (
                        <span className="text-xs">{c.packageName}</span>
                      )}
                    </td>
                    <td className="p-3 space-x-1">
                      {statusBadge(c.status)}
                      {c.subscriptionStatus === "suspended" && <Badge variant="destructive">suspended</Badge>}
                      {c.upgradeRequestedPackageKey && (
                        <Badge variant="outline">upgrade → {c.upgradeRequestedPackageKey}</Badge>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {c.members} members · {c.agents} agents
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {c.brandingMode} / {c.billingMode}
                    </td>
                    <td className="p-3">
                      {c.childWorkspaceId && (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant={c.subscriptionStatus === "suspended" ? "default" : "outline"}
                            onClick={() =>
                              suspendMut.mutate({
                                workspaceId: c.childWorkspaceId,
                                suspended: c.subscriptionStatus !== "suspended",
                              })
                            }
                            disabled={suspendMut.isPending}
                          >
                            {c.subscriptionStatus === "suspended" ? (
                              <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Reactivate</>
                            ) : (
                              <><Ban className="h-3.5 w-3.5 mr-1" /> Suspend</>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Audit & overrides"
                            onClick={() => setDrillWs(drillWs === c.childWorkspaceId ? null : c.childWorkspaceId)}
                          >
                            <History className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {drillWs && (
        <div className="border rounded-lg p-5 space-y-4 bg-muted/20">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {oversight?.workspace?.name ?? "Workspace"} — overrides &amp; audit
            </h2>
            <Button size="sm" variant="ghost" onClick={() => setDrillWs(null)}>Close</Button>
          </div>
          {oLoading || !oversight ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <>
              <div className="text-sm">
                Subscription:{" "}
                <span className="font-medium">{oversight.subscription?.package_key ?? "none"}</span>{" "}
                {statusBadge(oversight.subscription?.subscription_status ?? null)}
              </div>
              <div>
                <h3 className="text-sm font-medium mb-2">Feature overrides</h3>
                <div className="flex flex-wrap gap-2 mb-2">
                  {(oversight.overrides ?? []).length === 0 && (
                    <span className="text-xs text-muted-foreground">No admin overrides.</span>
                  )}
                  {(oversight.overrides ?? []).map((o: any) => (
                    <Badge
                      key={o.feature_key}
                      variant={o.enabled ? "default" : "destructive"}
                      className="cursor-pointer"
                      title="Click to remove this override"
                      onClick={() =>
                        overrideMut.mutate({ workspaceId: drillWs, featureKey: o.feature_key, enabled: null })
                      }
                    >
                      {o.feature_key}: {o.enabled ? "granted" : "denied"} ✕
                    </Badge>
                  ))}
                </div>
                <AddOverride
                  featureKeys={(matrix?.featureKeys ?? []) as string[]}
                  labels={(matrix?.featureLabels ?? {}) as Record<string, string>}
                  onAdd={(featureKey, enabled) => overrideMut.mutate({ workspaceId: drillWs, featureKey, enabled })}
                />
              </div>
              <div>
                <h3 className="text-sm font-medium mb-2">Recent audit entries</h3>
                <div className="border rounded-md divide-y max-h-72 overflow-y-auto bg-background">
                  {(oversight.audit ?? []).length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No audit entries.</div>
                  )}
                  {(oversight.audit ?? []).map((a: any) => (
                    <div key={a.id} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                      <div>
                        <span className="font-medium">{a.action_type}</span>{" "}
                        <span className="text-muted-foreground">{a.object_type}{a.object_id ? ` · ${a.object_id}` : ""}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={a.risk_level === "high" ? "destructive" : "secondary"}>{a.risk_level}</Badge>
                        <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ResellerRow({
  r, packageOptions, onDrill, drilled, onSetReseller, onSetPackage, onSuspend,
}: {
  r: any;
  packageOptions: any[];
  onDrill: () => void;
  drilled: boolean;
  onSetReseller: (enabled: boolean | null) => void;
  onSetPackage: (packageKey: string) => void;
  onSuspend: (suspended: boolean) => void;
}) {
  const suspended = r.subscriptionStatus === "suspended";
  return (
    <tr className={cn("border-b last:border-0", suspended && "opacity-70")}>
      <td className="p-3">
        <div className="font-medium">{r.name}</div>
        <div className="text-xs text-muted-foreground">
          {r.slug} · created {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
        </div>
      </td>
      <td className="p-3 text-xs">
        <div>{r.ownerName ?? "—"}</div>
        <div className="text-muted-foreground">{r.ownerEmail ?? ""}</div>
        <div className="text-muted-foreground">
          last activity {r.lastActivityAt ? new Date(r.lastActivityAt).toLocaleDateString() : "—"}
        </div>
      </td>
      <td className="p-3">
        <select
          className="bg-transparent border rounded px-2 py-1 text-xs"
          value={r.packageKey ?? ""}
          onChange={(e) => onSetPackage(e.target.value)}
        >
          {!r.packageKey && <option value="">— none —</option>}
          {packageOptions.map((p: any) => (
            <option key={p.packageKey} value={p.packageKey}>{p.packageName}</option>
          ))}
          {r.packageKey && !packageOptions.some((p: any) => p.packageKey === r.packageKey) && (
            <option value={r.packageKey}>{r.packageName}</option>
          )}
        </select>
      </td>
      <td className="p-3">{statusBadge(r.subscriptionStatus)}</td>
      <td className="p-3 text-xs">
        {r.childCount} / {r.childLimit ?? 0}
        <span className="text-muted-foreground"> ({r.activeChildren} active{r.suspendedChildren ? `, ${r.suspendedChildren} susp.` : ""})</span>
      </td>
      <td className="p-3 text-xs">
        {r.whiteLabel ? (
          <span>{r.whiteLabel.brandName ?? "custom"}{r.whiteLabel.customDomain ? ` · ${r.whiteLabel.customDomain}` : ""}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="p-3 text-xs">{r.emailProviderMode}</td>
      <td className="p-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={r.resellerOverride ?? r.packageIncludesReseller}
            onCheckedChange={(v) => onSetReseller(v)}
          />
          {r.resellerOverride !== null && (
            <button
              className="text-[10px] text-muted-foreground underline"
              title="Remove override — revert to package rule"
              onClick={() => onSetReseller(null)}
            >
              override
            </button>
          )}
        </div>
      </td>
      <td className="p-3">
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant={suspended ? "default" : "outline"} onClick={() => onSuspend(!suspended)}>
            {suspended ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Reactivate</> : <><Ban className="h-3.5 w-3.5 mr-1" /> Suspend</>}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDrill}>
            {drilled ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function AddOverride({
  featureKeys, labels, onAdd,
}: {
  featureKeys: string[];
  labels: Record<string, string>;
  onAdd: (featureKey: string, enabled: boolean) => void;
}) {
  const [key, setKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  return (
    <div className="flex items-center gap-2 text-xs">
      <select className="bg-transparent border rounded px-2 py-1" value={key} onChange={(e) => setKey(e.target.value)}>
        <option value="">Add override…</option>
        {featureKeys.map((k) => (
          <option key={k} value={k}>{labels[k] ?? k}</option>
        ))}
      </select>
      <label className="flex items-center gap-1.5">
        <Switch checked={enabled} onCheckedChange={setEnabled} /> {enabled ? "grant" : "deny"}
      </label>
      <Button size="sm" variant="outline" disabled={!key} onClick={() => { onAdd(key, enabled); setKey(""); }}>
        Add
      </Button>
    </div>
  );
}
