import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft, Building2, RefreshCw,
  Loader2, CheckCircle2, XCircle, UserPlus,
  Home, Phone, Users, HelpCircle, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AccountsMindShell } from "@/components/accountsmind/AccountsMindShell";
import {
  provisionWebuyanyhouseAccount,
  getWebuyanyhouseAdminStatus,
  adminSyncWebuyanyhouseLeads,
  cleanupWbahDuplicateLeads,
} from "@/lib/integrations/webespokeEnterprise/wbah.functions";
import { wbahProbeApi, wbahProbeCrmPeople } from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import { getSyncState } from "@/lib/sync-state/sync-state.server";

export const Route = createFileRoute(
  "/_authenticated/admin/accounts/clients/webuyanyhouse",
)({
  head: () => ({ meta: [{ title: "Webuyanyhouse — Admin Control" }] }),
  component: WebuyanyhouseAdminPanel,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className={cn(
      "inline-block w-2 h-2 rounded-full shrink-0",
      connected ? "bg-emerald-400" : "bg-gray-600",
    )} />
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full",
      ok ? "bg-emerald-500/20 text-emerald-400" : "bg-gray-800 text-gray-500",
    )}>
      {ok ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
      {label}
    </span>
  );
}

function SyncStatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "bg-emerald-500/20 text-emerald-400",
    partial: "bg-yellow-500/20 text-yellow-400",
    running: "bg-sky-500/20 text-sky-400",
    error:   "bg-red-500/20 text-red-400",
    idle:    "bg-gray-800 text-gray-500",
  };
  return (
    <span className={cn(
      "inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full capitalize",
      map[status] ?? "bg-gray-800 text-gray-500",
    )}>
      {status}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = "text-white" }: {
  icon: React.ElementType; label: string; value: number | string; color?: string;
}) {
  return (
    <div className="bg-gray-950 rounded-lg p-3 flex items-center gap-3">
      <Icon className={cn("w-4 h-4 shrink-0", color)} />
      <div>
        <p className={cn("text-base font-bold tabular-nums", color)}>{value}</p>
        <p className="text-[10px] text-gray-500">{label}</p>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function WebuyanyhouseAdminPanel() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const getStatusFn   = useServerFn(getWebuyanyhouseAdminStatus);
  const provisionFn   = useServerFn(provisionWebuyanyhouseAccount);
  const syncFn        = useServerFn(adminSyncWebuyanyhouseLeads);
  const cleanupFn     = useServerFn(cleanupWbahDuplicateLeads);
  const probeFn       = useServerFn(wbahProbeApi);
  const crmPeopleProbeFn = useServerFn(wbahProbeCrmPeople);

  const [probing, setProbing]       = useState(false);
  const [probeResult, setProbeResult] = useState<any | null>(null);
  const [crmPeopleProbing, setCrmPeopleProbing] = useState(false);
  const [crmPeopleProbeResult, setCrmPeopleProbeResult] = useState<any | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ["wbah-admin-status"],
    queryFn:  () => getStatusFn(),
    refetchInterval: 30_000,
    throwOnError: false,
  });

  const getSyncStateFn = useServerFn(getSyncState);
  const { data: syncState, isLoading: syncStateLoading } = useQuery({
    queryKey: ["wbah-sync-state", status?.workspaceId],
    queryFn:  () => getSyncStateFn({ data: { workspaceId: status?.workspaceId } }),
    enabled:  !!status?.workspaceId,
    refetchInterval: 30_000,
    throwOnError: false,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["wbah-admin-status"] });
  }

  async function handleProvision() {
    setBusy("provision");
    try {
      const r = await provisionFn();
      toast.success(
        r.alreadyExisted
          ? "Account already exists — workspace confirmed."
          : `WEBEE account created for ${r.email}`
      );
      invalidate();
    } catch (e: any) { toast.error(e?.message ?? "Provisioning failed"); }
    finally { setBusy(null); }
  }

  async function handleProbe() {
    setProbing(true);
    try {
      const r = await probeFn();
      setProbeResult(r);
    } catch (e: any) { toast.error(e?.message ?? "Probe failed"); }
    finally { setProbing(false); }
  }

  async function handleCrmPeopleProbe() {
    setCrmPeopleProbing(true);
    try {
      const r = await crmPeopleProbeFn();
      setCrmPeopleProbeResult(r);
    } catch (e: any) { toast.error(e?.message ?? "CRM People probe failed"); }
    finally { setCrmPeopleProbing(false); }
  }

  async function handleCleanup() {
    if (!confirm("This will permanently delete duplicate leads from the database, keeping one record per lead. Continue?")) return;
    setBusy("cleanup");
    try {
      const r = await cleanupFn() as any;
      toast.success(`Cleanup complete — removed ${r.deleted} duplicates, ${r.remaining} unique leads remain`);
      invalidate();
    } catch (e: any) { toast.error(e?.message ?? "Cleanup failed"); }
    finally { setBusy(null); }
  }

  async function handleSync() {
    setBusy("sync");
    try {
      const r = await syncFn() as any;
      const parts: string[] = [];
      if (typeof r.sellers  === "number") parts.push(`${r.sellers} property leads`);
      if (typeof r.contacts === "number") parts.push(`${r.contacts} contacts`);
      if (r.errors?.length) toast.error(`Sync partial: ${r.errors.join(", ")}`);
      else toast.success(parts.length ? `Synced: ${parts.join(", ")}` : "Sync complete");
      invalidate();
    } catch (e: any) { toast.error(e?.message ?? "Sync failed"); }
    finally { setBusy(null); }
  }

  const isBusy      = busy !== null;
  const wsCreated   = !!status?.workspaceCreated;
  const apiConn     = status?.apiStatus === "connected";
  const canSync     = wsCreated && apiConn;

  return (
    <AccountsMindShell>
      <div className="p-6 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link to="/admin/accounts/clients" className="text-gray-400 hover:text-white transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 shrink-0">
            <Building2 className="h-5 w-5 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-white">Webuyanyhouse</h1>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                Enterprise Client
              </span>
              {status && (
                <>
                  <StatusBadge ok={wsCreated} label={wsCreated ? "Account Active" : "No Account"} />
                  <StatusBadge ok={apiConn}   label={apiConn   ? "API Connected" : "API Disconnected"} />
                </>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Real estate client · Microsoft Dynamics AI calling · property seller qualification
            </p>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading status…
          </div>
        )}

        {status && (
          <>
            {/* 1 — WEBEE Account */}
            <Section title="1 · WEBEE Account">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <StatusDot connected={wsCreated} />
                    <span className="text-sm text-white font-medium">
                      {wsCreated ? "Account exists" : "Account not created"}
                    </span>
                  </div>
                  {wsCreated ? (
                    <div className="text-xs text-gray-500 space-y-0.5 pl-4">
                      <p>Login: <span className="font-mono text-gray-400">admin@webuyanyhouse.co.uk</span></p>
                      <p>Password: <span className="text-gray-600 italic">managed securely — not shown</span></p>
                      <p>Workspace ID: <span className="font-mono text-gray-600 text-[10px]">{status.workspaceId}</span></p>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-600 pl-4">
                      Creates the WEBEE login and isolated workspace for Webuyanyhouse.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    className={cn(
                      "h-8 text-xs gap-1.5",
                      wsCreated
                        ? "bg-gray-800 text-gray-300 hover:bg-gray-700"
                        : "bg-emerald-600 hover:bg-emerald-700 text-white"
                    )}
                    disabled={isBusy}
                    onClick={handleProvision}
                  >
                    {busy === "provision"
                      ? <><Loader2 className="w-3 h-3 animate-spin" />Working…</>
                      : <><UserPlus className="w-3 h-3" />{wsCreated ? "Re-provision" : "Create Account"}</>}
                  </Button>
                  {wsCreated && (
                    <Link
                      to="/leads"
                      className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" /> View Leads
                    </Link>
                  )}
                </div>
              </div>
            </Section>

            {/* 2 — Sync */}
            <Section title="2 · Sync Leads">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <StatusDot connected={canSync} />
                    <span className="text-sm text-white font-medium">
                      {canSync ? "Ready to sync" : "Awaiting account + API connection"}
                    </span>
                  </div>
                  {status.lastSynced && (
                    <p className="text-xs text-gray-600 pl-4">
                      Last sync: {new Date(status.lastSynced).toLocaleString("en-GB")}
                    </p>
                  )}
                  <p className="text-xs text-gray-600 pl-4">
                    Imports property seller leads from WeeBespoke AI, classifies into sections,
                    stores in Webuyanyhouse's isolated workspace.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 h-8 text-xs gap-1.5"
                    disabled={isBusy}
                    onClick={handleCleanup}
                  >
                    {busy === "cleanup"
                      ? <><Loader2 className="w-3 h-3 animate-spin" />Cleaning…</>
                      : <><RefreshCw className="w-3 h-3" />Remove Duplicates</>}
                  </Button>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs gap-1.5"
                    disabled={isBusy || !canSync}
                    onClick={handleSync}
                  >
                    {busy === "sync"
                      ? <><Loader2 className="w-3 h-3 animate-spin" />Syncing…</>
                      : <><RefreshCw className="w-3 h-3" />Sync Now</>}
                  </Button>
                </div>
              </div>

              {/* Lead counts — sourced from standard leads table */}
              {status.totalLeads > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
                  <StatCard icon={Home}       label="New Leads"        value={status.leadCounts.new_leads}        color="text-emerald-400" />
                  <StatCard icon={Phone}      label="Tried To Contact" value={status.leadCounts.tried_to_contact} color="text-yellow-400" />
                  <StatCard icon={Users}      label="Disqualified"     value={status.leadCounts.disqualified}     color="text-red-400" />
                  <StatCard icon={HelpCircle} label="Qualified"        value={status.leadCounts.qualified}        color="text-purple-400" />
                </div>
              )}
            </Section>

            {/* 3b — Sync History */}
            <Section title="Sync History">
              <p className="text-xs text-gray-500">
                Outcome of each on-demand / manual sync for this workspace. Calls refresh live when
                the Calls page is opened — this account has no background or automatic sync.
              </p>
              {syncStateLoading ? (
                <div className="flex items-center gap-2 text-gray-500 text-xs">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                </div>
              ) : !syncState?.applied ? (
                <p className="text-xs text-gray-600">
                  Sync tracking table not applied yet — run{" "}
                  <span className="font-mono">SYNC_STATE_MIGRATION.sql</span> in Supabase to enable it.
                </p>
              ) : syncState.rows.length === 0 ? (
                <p className="text-xs text-gray-600">
                  No syncs recorded yet. Use <strong>Sync Now</strong> above (or Sync on the People
                  page) to populate this.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-800">
                        <th className="py-1.5 pr-3 font-medium">Module</th>
                        <th className="py-1.5 pr-3 font-medium">Status</th>
                        <th className="py-1.5 pr-3 font-medium">Last success</th>
                        <th className="py-1.5 pr-3 font-medium">Records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncState.rows.map((r) => (
                        <tr key={r.id} className="border-b border-gray-900/80">
                          <td className="py-1.5 pr-3 capitalize text-gray-300">{r.module}</td>
                          <td className="py-1.5 pr-3"><SyncStatusPill status={r.sync_status} /></td>
                          <td className="py-1.5 pr-3 text-gray-400">
                            {r.last_successful_sync_at
                              ? new Date(r.last_successful_sync_at).toLocaleString("en-GB")
                              : "—"}
                          </td>
                          <td className="py-1.5 pr-3 text-gray-500">
                            {(r.records_created + r.records_updated) || 0} synced
                            {r.records_skipped ? ` · ${r.records_skipped} skipped` : ""}
                            {r.sync_status === "error" && r.error_message
                              ? <span className="text-red-400/80"> · {r.error_message.slice(0, 80)}</span>
                              : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* 3 — UAT CRM_data People cohorts */}
            <Section title="3 · UAT CRM_data People Cohorts">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <p className="text-xs text-gray-500">
                  Reads People tab cohorts from UAT CRM_data (synced by backend Dynamics category sync).
                  Run sync from Data → Campaigns if counts are zero.
                </p>
                <Button
                  size="sm"
                  className="bg-sky-600 hover:bg-sky-700 text-white h-8 text-xs gap-1.5 shrink-0"
                  disabled={crmPeopleProbing}
                  onClick={handleCrmPeopleProbe}
                >
                  {crmPeopleProbing
                    ? <><Loader2 className="w-3 h-3 animate-spin" />Testing…</>
                    : <><RefreshCw className="w-3 h-3" />Probe CRM_data counts</>}
                </Button>
              </div>
              {crmPeopleProbeResult && (
                <div className="mt-2 rounded-lg bg-gray-950 border border-gray-800 p-3 overflow-x-auto">
                  <pre className="text-[11px] text-sky-300 whitespace-pre-wrap font-mono leading-relaxed">
                    {JSON.stringify(crmPeopleProbeResult, null, 2)}
                  </pre>
                </div>
              )}
            </Section>

            {/* 4 — WeeBespoke API Diagnostic Probe */}
            {apiConn && (
              <Section title="4 · WeeBespoke API Diagnostic Probe">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <p className="text-xs text-gray-500">
                    Fires 7 parallel requests to WeeBespoke API and returns record counts for each.
                    Use to verify pagination behaviour and total record counts.
                  </p>
                  <Button
                    size="sm"
                    className="bg-violet-600 hover:bg-violet-700 text-white h-8 text-xs gap-1.5 shrink-0"
                    disabled={probing}
                    onClick={handleProbe}
                  >
                    {probing
                      ? <><Loader2 className="w-3 h-3 animate-spin" />Probing…</>
                      : <><RefreshCw className="w-3 h-3" />Run Probe</>}
                  </Button>
                </div>
                {probeResult && (
                  <div className="mt-2 rounded-lg bg-gray-950 border border-gray-800 p-3 overflow-x-auto">
                    <pre className="text-[11px] text-emerald-300 whitespace-pre-wrap font-mono leading-relaxed">
                      {JSON.stringify(probeResult, null, 2)}
                    </pre>
                  </div>
                )}
              </Section>
            )}

            {/* Info */}
            <div className="rounded-lg bg-gray-900 border border-gray-800 px-4 py-3 text-xs text-gray-500 space-y-1">
              <p className="font-medium text-gray-400">Data isolation note</p>
              <p>All imported leads are stored in Webuyanyhouse's isolated workspace only. They are NOT visible in any other account, the admin dashboard, HiveMind, or shared CRM tables.</p>
              <p>Tokens are stored server-side only — never returned to or stored in the browser.</p>
            </div>
          </>
        )}
      </div>
    </AccountsMindShell>
  );
}
