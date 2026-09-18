import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Package, PlayCircle, RefreshCw, RotateCcw, ShieldAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  adminGetPackageMatrix,
  adminResetPackageDefinition,
  adminRunPackageMigrationReport,
  adminUpsertPackageDefinition,
} from "@/lib/admin/platform-oversight.functions";

export const Route = createFileRoute("/_authenticated/admin/packages")({
  component: AdminPackagesPage,
});

const LIMIT_FIELDS: Array<{ key: string; label: string }> = [
  { key: "includedVoiceMinutes", label: "Voice minutes" },
  { key: "includedStaffUsers", label: "Staff seats" },
  { key: "maxAgents", label: "Max agents" },
  { key: "maxWorkflows", label: "Max workflows" },
  { key: "maxCampaigns", label: "Max campaigns" },
  { key: "maxCustomViews", label: "Max saved views" },
  { key: "maxPageFilters", label: "Max page filters" },
  { key: "maxCampaignFilters", label: "Max campaign filters" },
  { key: "maxChildAccounts", label: "Max child accounts" },
];

function AdminPackagesPage() {
  const qc = useQueryClient();
  const getMatrix = useServerFn(adminGetPackageMatrix);
  const upsertFn = useServerFn(adminUpsertPackageDefinition);
  const resetFn = useServerFn(adminResetPackageDefinition);
  const migrateFn = useServerFn(adminRunPackageMigrationReport);

  const [tab, setTab] = useState<"matrix" | "migration">("matrix");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<any | null>(null);
  const [report, setReport] = useState<any | null>(null);
  const [resetTarget, setResetTarget] = useState<any | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-package-matrix"],
    queryFn: () => getMatrix(),
    staleTime: 15_000,
    throwOnError: false,
  });

  const packages = data?.packages ?? [];
  const selected = useMemo(
    () => packages.find((p: any) => p.packageKey === selectedKey) ?? null,
    [packages, selectedKey],
  );

  const startEdit = (pkg: any) => {
    setSelectedKey(pkg.packageKey);
    setDraft({
      packageKey: pkg.packageKey,
      packageName: pkg.packageName,
      description: pkg.description ?? "",
      limits: { ...pkg.limits },
      features: Object.fromEntries(
        (data?.featureKeys ?? []).map((k: string) => [k, pkg.features.includes(k)]),
      ),
      pageAccessCaps: { ...(pkg.effectivePageCaps ?? {}) },
      actionCaps: { ...(pkg.effectiveActionCaps ?? {}) },
      aiDepartments: [...(pkg.aiDepartments ?? [])],
      notificationCaps: { ...pkg.notificationCaps },
      notificationDefaults: { ...pkg.notificationDefaults },
      isActive: pkg.isActive,
    });
  };

  // Actions switched OFF whose backing feature is ON. `explicit ?? feature`
  // means the explicit false wins, so this combination silently denies the
  // action platform-wide while the package advertises the feature.
  const contradictedActions = useMemo(() => {
    if (!draft) return [] as string[];
    const featureFor = (data?.actionFeatureMap ?? {}) as Record<string, string>;
    return ((data?.actionKeys ?? []) as string[]).filter(
      (k) => draft.actionCaps?.[k] === false && draft.features?.[featureFor[k]] === true,
    );
  }, [draft, data]);

  const saveMut = useMutation({
    mutationFn: async () => upsertFn({ data: draft }),
    onSuccess: () => {
      toast.success("Package saved — DB override active");
      setDraft(null);
      setSelectedKey(null);
      qc.invalidateQueries({ queryKey: ["admin-package-matrix"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: async (packageKey: string) => resetFn({ data: { packageKey } }),
    onSuccess: () => {
      toast.success("Reverted to code default");
      setResetTarget(null);
      setDraft(null);
      setSelectedKey(null);
      qc.invalidateQueries({ queryKey: ["admin-package-matrix"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const migrateMut = useMutation({
    mutationFn: async (apply: boolean) => migrateFn({ data: { apply } }),
    onSuccess: (res: any) => {
      setReport(res);
      if (res.applied)
        toast.success(`Migration applied — ${res.appliedCount} workspace(s) assigned`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" /> Package Matrix
          </h1>
          <p className="text-sm text-muted-foreground">
            Edits here are saved to the database and override the code catalog for all workspaces.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={tab === "matrix" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("matrix")}
          >
            Matrix
          </Button>
          <Button
            variant={tab === "migration" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("migration")}
          >
            Migration report
          </Button>
        </div>
      </div>

      {tab === "matrix" && (
        <>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left">
                    <th className="p-3">Package</th>
                    <th className="p-3">Price / mo</th>
                    <th className="p-3">Features</th>
                    <th className="p-3">Workspaces</th>
                    <th className="p-3">Child accounts</th>
                    <th className="p-3">Email notifs</th>
                    <th className="p-3">Source</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {packages.map((p: any) => (
                    <tr
                      key={p.packageKey}
                      className={cn("border-b last:border-0", !p.isActive && "opacity-60")}
                    >
                      <td className="p-3">
                        <div className="font-medium">{p.packageName}</div>
                        <div className="text-xs text-muted-foreground">{p.packageKey}</div>
                      </td>
                      <td className="p-3">
                        {p.monthlyPricePence === null
                          ? "Custom"
                          : `£${(p.monthlyPricePence / 100).toFixed(0)}`}
                      </td>
                      <td className="p-3">{p.features.length}</td>
                      {/* What an edit here actually reaches. The default package
                          also governs every workspace with no subscription row,
                          which is the number that surprises people. */}
                      <td className="p-3">
                        <span className="tabular-nums font-medium">{p.workspaceCount ?? 0}</span>
                        {p.inheritsUnsubscribed && (data?.unsubscribedCount ?? 0) > 0 && (
                          <div className="text-[10px] text-amber-500">
                            incl. {data?.unsubscribedCount} with no subscription
                          </div>
                        )}
                      </td>
                      <td className="p-3">{p.limits.maxChildAccounts ?? 0}</td>
                      <td className="p-3">
                        {p.notificationCaps.emailAllowed ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground" />
                        )}
                      </td>
                      <td className="p-3">
                        {p.dbOverride ? (
                          <Badge variant="secondary">DB override</Badge>
                        ) : (
                          <Badge variant="outline">Code default</Badge>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                            Edit
                          </Button>
                          {p.dbOverride && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Revert to code default"
                              onClick={() => setResetTarget(p)}
                              disabled={resetMut.isPending}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {draft && selected && (
            <div className="border rounded-lg p-5 space-y-5 bg-muted/20">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">
                  Editing: {selected.packageName}{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    ({selected.packageKey})
                  </span>
                </h2>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDraft(null);
                      setSelectedKey(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                    {saveMut.isPending ? "Saving…" : "Save to DB"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 max-w-xl">
                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">Package name</span>
                  <Input
                    value={draft.packageName}
                    onChange={(e) => setDraft({ ...draft, packageName: e.target.value })}
                  />
                </label>
                <label className="text-sm space-y-1 flex flex-col justify-end">
                  <span className="text-muted-foreground">Active</span>
                  <Switch
                    checked={draft.isActive}
                    onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
                  />
                </label>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Limits (blank = unlimited)</h3>
                <div className="grid grid-cols-3 gap-3 max-w-3xl">
                  {LIMIT_FIELDS.map((f) => (
                    <label key={f.key} className="text-xs space-y-1">
                      <span className="text-muted-foreground">{f.label}</span>
                      <Input
                        type="number"
                        min={0}
                        value={draft.limits[f.key] ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            limits: {
                              ...draft.limits,
                              [f.key]: e.target.value === "" ? null : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Features</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-w-4xl">
                  {(data?.featureKeys ?? []).map((k: string) => (
                    <label key={k} className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={draft.features[k] === true}
                        onCheckedChange={(v) =>
                          setDraft({ ...draft, features: { ...draft.features, [k]: v } })
                        }
                      />
                      <span>{(data?.featureLabels as any)?.[k] ?? k}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">AI departments</h3>
                <div className="flex flex-wrap gap-4 text-xs">
                  {["growthmind", "hivemind", "systemmind", "accountsmind"].map((d) => (
                    <label key={d} className="flex items-center gap-2">
                      <Switch
                        checked={draft.aiDepartments.includes(d)}
                        onCheckedChange={(v) =>
                          setDraft({
                            ...draft,
                            aiDepartments: v
                              ? [...draft.aiDepartments, d]
                              : draft.aiDepartments.filter((x: string) => x !== d),
                          })
                        }
                      />
                      <span className="capitalize">{d}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Page access caps</h3>
                <p className="text-xs text-muted-foreground mb-2">
                  Effective page level = min(role level, package cap).
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-w-4xl">
                  {((data?.pageKeys ?? []) as string[]).map((k) => (
                    <label
                      key={k}
                      className="flex items-center justify-between gap-2 text-xs border rounded px-2 py-1.5"
                    >
                      <span>{(data?.pageLabels as any)?.[k] ?? k}</span>
                      <select
                        className="bg-transparent border rounded px-1.5 py-0.5"
                        value={draft.pageAccessCaps[k] ?? "full"}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            pageAccessCaps: { ...draft.pageAccessCaps, [k]: e.target.value },
                          })
                        }
                      >
                        {((data?.pageLevels ?? []) as string[]).map((lv) => (
                          <option key={lv} value={lv}>
                            {lv}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Action caps</h3>
                <p className="text-xs text-muted-foreground mb-2">
                  Actions require both the role grant and the package cap. An action switched off
                  here overrides its feature — so it stays denied even when the feature below is
                  enabled, and even for an owner.
                </p>
                {/* A package could be saved with every feature enabled and every
                    action denied, which reads as "full access" in the matrix
                    while blocking owners from lead assignment and user
                    management. Name the contradiction where it is made. */}
                {contradictedActions.length > 0 && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-600 dark:text-amber-400">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      {contradictedActions.length} action
                      {contradictedActions.length === 1 ? " is" : "s are"} denied even though the
                      feature granting{contradictedActions.length === 1 ? " it" : " them"} is
                      enabled:{" "}
                      {contradictedActions
                        .map((k) => (data?.actionLabels as any)?.[k] ?? k)
                        .join(", ")}
                      .
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 shrink-0 text-[11px]"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          actionCaps: {
                            ...draft.actionCaps,
                            ...Object.fromEntries(contradictedActions.map((k) => [k, true])),
                          },
                        })
                      }
                    >
                      Match features
                    </Button>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-w-4xl">
                  {((data?.actionKeys ?? []) as string[]).map((k) => {
                    const contradicted = contradictedActions.includes(k);
                    return (
                      <label key={k} className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={draft.actionCaps[k] !== false}
                          onCheckedChange={(v) =>
                            setDraft({ ...draft, actionCaps: { ...draft.actionCaps, [k]: v } })
                          }
                        />
                        <span className={cn(contradicted && "text-amber-600 dark:text-amber-400")}>
                          {(data?.actionLabels as any)?.[k] ?? k}
                        </span>
                        {contradicted && (
                          <ShieldAlert className="h-3 w-3 shrink-0 text-amber-500" />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Notification caps &amp; defaults</h3>
                <div className="flex gap-6 text-xs items-center">
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={draft.notificationCaps.emailAllowed === true}
                      onCheckedChange={(v) =>
                        setDraft({
                          ...draft,
                          notificationCaps: { ...draft.notificationCaps, emailAllowed: v },
                        })
                      }
                    />
                    Email notifications allowed
                  </label>
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={draft.notificationCaps.customRecipientsAllowed === true}
                      onCheckedChange={(v) =>
                        setDraft({
                          ...draft,
                          notificationCaps: {
                            ...draft.notificationCaps,
                            customRecipientsAllowed: v,
                          },
                        })
                      }
                    />
                    Custom recipients allowed
                  </label>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Per-event defaults below seed new workspaces on this package (existing settings
                  are never overwritten).
                </p>
                <div className="mt-2 border rounded-md divide-y max-w-3xl">
                  {Object.entries(draft.notificationDefaults ?? {}).map(
                    ([eventKey, d]: [string, any]) => (
                      <div
                        key={eventKey}
                        className="flex items-center justify-between px-3 py-2 text-xs"
                      >
                        <span className="font-mono">{eventKey}</span>
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-1.5">
                            <Switch
                              checked={d.inAppEnabled !== false}
                              onCheckedChange={(v) =>
                                setDraft({
                                  ...draft,
                                  notificationDefaults: {
                                    ...draft.notificationDefaults,
                                    [eventKey]: { ...d, inAppEnabled: v },
                                  },
                                })
                              }
                            />
                            In-app
                          </label>
                          <label className="flex items-center gap-1.5">
                            <Switch
                              checked={d.emailEnabled === true}
                              disabled={!draft.notificationCaps.emailAllowed}
                              onCheckedChange={(v) =>
                                setDraft({
                                  ...draft,
                                  notificationDefaults: {
                                    ...draft.notificationDefaults,
                                    [eventKey]: { ...d, emailEnabled: v },
                                  },
                                })
                              }
                            />
                            Email
                          </label>
                        </div>
                      </div>
                    ),
                  )}
                  {Object.keys(draft.notificationDefaults ?? {}).length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No defaults defined for this package.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "migration" && (
        <div className="space-y-4">
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              Assigns an explicit <code className="text-xs">legacy_full</code> subscription to
              workspaces that have none. Insert-only: existing subscriptions and the WBAH workspace
              are never modified.
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => migrateMut.mutate(false)}
                disabled={migrateMut.isPending}
              >
                <RefreshCw className="h-4 w-4 mr-1.5" /> Run report (dry run)
              </Button>
              <Button
                size="sm"
                onClick={() => migrateMut.mutate(true)}
                disabled={migrateMut.isPending || !report || report.totals?.needingAssignment === 0}
              >
                <PlayCircle className="h-4 w-4 mr-1.5" /> Apply assignments
              </Button>
            </div>
          </div>

          {report && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  ["Workspaces", report.totals.workspaces],
                  ["With subscription", report.totals.withSubscription],
                  ["Needing assignment", report.totals.needingAssignment],
                  ["WBAH (skipped)", report.totals.wbahSkipped],
                  ["Missing owner", report.totals.missingOwner],
                ].map(([label, v]) => (
                  <div key={String(label)} className="border rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-lg font-semibold">{String(v)}</div>
                  </div>
                ))}
              </div>
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      <th className="p-2.5">Workspace</th>
                      <th className="p-2.5">Package</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Flags</th>
                      <th className="p-2.5">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r: any) => (
                      <tr key={r.workspaceId} className="border-b last:border-0">
                        <td className="p-2.5">
                          <div className="font-medium">{r.name}</div>
                          {r.warning && <div className="text-xs text-amber-500">{r.warning}</div>}
                        </td>
                        <td className="p-2.5">{r.currentPackageKey ?? "—"}</td>
                        <td className="p-2.5">{r.subscriptionStatus ?? "—"}</td>
                        <td className="p-2.5 space-x-1">
                          {r.isWbah && <Badge variant="secondary">WBAH</Badge>}
                          {r.isResellerChild && <Badge variant="outline">Reseller child</Badge>}
                          {r.hasWhiteLabel && <Badge variant="outline">White-label</Badge>}
                        </td>
                        <td className="p-2.5">
                          {r.action === "none" && (
                            <span className="text-muted-foreground text-xs">No change</span>
                          )}
                          {r.action === "skipped_wbah" && (
                            <span className="text-xs">Skipped (WBAH)</span>
                          )}
                          {r.action === "assign_legacy_full" && (
                            <Badge>
                              {report.applied ? "Assigned legacy_full" : "Will assign legacy_full"}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Reverting was a bare icon button with no confirmation, despite being
          audited as high risk and re-governing every workspace on the package
          in one click. Name the blast radius before doing it. */}
      <AlertDialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revert “{resetTarget?.packageName}” to its code default?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This deletes the saved override for <code>{resetTarget?.packageKey}</code>. Every
                  customisation made here — features, page access, action caps and limits — is
                  discarded and cannot be recovered.
                </p>
                <p className="font-medium text-foreground">
                  {resetTarget?.workspaceCount ?? 0} workspace
                  {(resetTarget?.workspaceCount ?? 0) === 1 ? "" : "s"} will immediately fall back
                  to the code default.
                </p>
                {resetTarget?.inheritsUnsubscribed && (data?.unsubscribedCount ?? 0) > 0 && (
                  <p className="text-xs text-amber-500">
                    This is the default package, so that includes {data?.unsubscribedCount}{" "}
                    workspace
                    {(data?.unsubscribedCount ?? 0) === 1 ? "" : "s"} with no subscription row —
                    they inherit it whether or not anyone assigned it. To change one account only,
                    set a per-workspace override instead.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetMut.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (resetTarget?.packageKey) resetMut.mutate(resetTarget.packageKey);
              }}
              disabled={resetMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resetMut.isPending ? "Reverting…" : "Revert to code default"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
