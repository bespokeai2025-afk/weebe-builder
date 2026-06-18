import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft, Building2, Car, Users, UserCheck, Bike, Wrench,
  RefreshCw, Loader2, ChevronDown, ChevronUp, AlertTriangle,
  ShieldCheck, PowerOff,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AccountsMindShell } from "@/components/accountsmind/AccountsMindShell";
import {
  getWebespokeEnterpriseStatus,
  getWebespokeEnterpriseCars,
  getWebespokeEnterpriseBuyers,
  getWebespokeEnterpriseDealers,
  syncWebespokeEnterpriseCars,
  syncWebespokeEnterpriseBuyers,
  syncWebespokeEnterpriseDealers,
  syncAllWebespokeEnterpriseData,
  adminOverrideConnectWebespokeEnterprise,
  disconnectWebespokeEnterprise,
} from "@/lib/integrations/webespokeEnterprise/enterprise.functions";

export const Route = createFileRoute(
  "/_authenticated/admin/accounts/clients/webuyanyhouse",
)({
  head: () => ({ meta: [{ title: "Webuyanyhouse — Enterprise Client" }] }),
  component: WebuyanyhousenProfile,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeStr(obj: any, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim()) return String(v);
  }
  return "—";
}

function safeDate(obj: any, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (v) {
      try {
        return new Date(v).toLocaleDateString("en-GB", {
          day: "numeric", month: "short", year: "numeric",
        });
      } catch { /* ignore */ }
    }
  }
  return "—";
}

function StatusPill({ value }: { value: string }) {
  if (value === "—") return <span className="text-gray-600">—</span>;
  const lower = value.toLowerCase();
  const cls =
    lower.includes("active") || lower.includes("available") || lower.includes("approved")
      ? "bg-emerald-500/20 text-emerald-400"
      : lower.includes("pending") || lower.includes("review")
      ? "bg-yellow-500/20 text-yellow-400"
      : lower.includes("inactive") || lower.includes("sold") || lower.includes("rejected")
      ? "bg-red-500/20 text-red-400"
      : "bg-gray-700 text-gray-400";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>
      {value}
    </span>
  );
}

function RawRow({ record }: { record: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[10px] text-gray-600 hover:text-gray-400 flex items-center gap-1"
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {open ? "hide" : "raw"}
      </button>
      {open && (
        <pre className="mt-1 text-[9px] bg-gray-900 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all text-gray-400">
          {JSON.stringify(record, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Tab tables ────────────────────────────────────────────────────────────────

function CarsTable({ records, syncing, onSync }: { records: any[]; syncing: boolean; onSync: () => void }) {
  if (!records.length) return (
    <EmptyTab icon={Car} label="No cars synced" onSync={onSync} syncing={syncing} syncLabel="Sync Cars" />
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{records.length} vehicle{records.length !== 1 ? "s" : ""}</p>
        <button
          onClick={onSync} disabled={syncing}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
        >
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Sync
        </button>
      </div>
      <div className="rounded-lg border border-gray-800 overflow-auto">
        <table className="w-full text-xs min-w-[580px]">
          <thead className="bg-gray-900 border-b border-gray-800">
            <tr>
              {["Make / Model", "Year", "Registration", "Price", "Status", "Dealer", ""].map(h => (
                <th key={h} className="text-left px-3 py-2 font-medium text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {records.map((car: any, i: number) => (
              <tr key={car?.id ?? car?._id ?? i} className="hover:bg-gray-900/60">
                <td className="px-3 py-2 font-medium text-white">
                  {safeStr(car, "make", "brand", "manufacturer")} {safeStr(car, "model", "carModel")}
                </td>
                <td className="px-3 py-2 text-gray-400">{safeStr(car, "year", "manufacturedYear")}</td>
                <td className="px-3 py-2 text-gray-400 font-mono text-[11px]">
                  {safeStr(car, "registration", "reg", "licensePlate", "registrationNumber")}
                </td>
                <td className="px-3 py-2 text-gray-300">{safeStr(car, "price", "askingPrice", "salePrice")}</td>
                <td className="px-3 py-2"><StatusPill value={safeStr(car, "status", "carStatus", "listingStatus")} /></td>
                <td className="px-3 py-2 text-gray-500">{safeStr(car, "dealerName", "dealer", "dealerId")}</td>
                <td className="px-3 py-2"><RawRow record={car} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BuyersTable({ records, syncing, onSync }: { records: any[]; syncing: boolean; onSync: () => void }) {
  if (!records.length) return (
    <EmptyTab icon={Users} label="No buyers synced" onSync={onSync} syncing={syncing} syncLabel="Sync Buyers" />
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{records.length} buyer{records.length !== 1 ? "s" : ""}</p>
        <button onClick={onSync} disabled={syncing} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50">
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Sync
        </button>
      </div>
      <div className="rounded-lg border border-gray-800 overflow-auto">
        <table className="w-full text-xs min-w-[480px]">
          <thead className="bg-gray-900 border-b border-gray-800">
            <tr>
              {["Name", "Email", "Phone", "Joined", "Status", ""].map(h => (
                <th key={h} className="text-left px-3 py-2 font-medium text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {records.map((b: any, i: number) => (
              <tr key={b?.id ?? b?._id ?? i} className="hover:bg-gray-900/60">
                <td className="px-3 py-2 font-medium text-white">
                  {safeStr(b, "name", "fullName", "firstName")}{b?.lastName ? ` ${b.lastName}` : ""}
                </td>
                <td className="px-3 py-2 text-gray-400">{safeStr(b, "email", "emailAddress")}</td>
                <td className="px-3 py-2 text-gray-400">{safeStr(b, "phone", "phoneNumber", "mobile")}</td>
                <td className="px-3 py-2 text-gray-500">{safeDate(b, "createdAt", "created_at", "joinedAt")}</td>
                <td className="px-3 py-2"><StatusPill value={safeStr(b, "status", "buyerStatus")} /></td>
                <td className="px-3 py-2"><RawRow record={b} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DealersTable({ records, syncing, onSync }: { records: any[]; syncing: boolean; onSync: () => void }) {
  if (!records.length) return (
    <EmptyTab icon={UserCheck} label="No dealers synced" onSync={onSync} syncing={syncing} syncLabel="Sync Dealers" />
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{records.length} dealer{records.length !== 1 ? "s" : ""}</p>
        <button onClick={onSync} disabled={syncing} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50">
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Sync
        </button>
      </div>
      <div className="rounded-lg border border-gray-800 overflow-auto">
        <table className="w-full text-xs min-w-[520px]">
          <thead className="bg-gray-900 border-b border-gray-800">
            <tr>
              {["Dealer Name", "Email", "Phone", "Company", "Status", ""].map(h => (
                <th key={h} className="text-left px-3 py-2 font-medium text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {records.map((d: any, i: number) => (
              <tr key={d?.id ?? d?._id ?? i} className="hover:bg-gray-900/60">
                <td className="px-3 py-2 font-medium text-white">{safeStr(d, "dealerName", "name", "fullName")}</td>
                <td className="px-3 py-2 text-gray-400">{safeStr(d, "email", "emailAddress")}</td>
                <td className="px-3 py-2 text-gray-400">{safeStr(d, "phone", "phoneNumber", "mobile")}</td>
                <td className="px-3 py-2 text-gray-400">{safeStr(d, "company", "companyName", "businessName")}</td>
                <td className="px-3 py-2"><StatusPill value={safeStr(d, "status", "dealerStatus")} /></td>
                <td className="px-3 py-2"><RawRow record={d} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyTab({
  icon: Icon, label, syncing, onSync, syncLabel,
}: { icon: React.ElementType; label: string; syncing: boolean; onSync: () => void; syncLabel: string }) {
  return (
    <div className="text-center py-14 text-gray-600 border border-gray-800 border-dashed rounded-lg">
      <Icon className="w-8 h-8 mx-auto mb-2 opacity-20" />
      <p className="text-sm">{label}</p>
      <button
        onClick={onSync} disabled={syncing}
        className="mt-3 flex items-center gap-1.5 mx-auto text-xs text-emerald-500 hover:text-emerald-400 disabled:opacity-50"
      >
        {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        {syncLabel}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = "nathan@bespoke.ai";

const TABS = [
  { id: "cars",        label: "Cars",        icon: Car       },
  { id: "buyers",      label: "Buyers",      icon: Users     },
  { id: "dealers",     label: "Dealers",     icon: UserCheck },
  { id: "bikes",       label: "Bikes",       icon: Bike      },
  { id: "spare-parts", label: "Spare Parts", icon: Wrench    },
] as const;
type TabId = typeof TABS[number]["id"];

function WebuyanyhousenProfile() {
  const qc = useQueryClient();
  const [tab, setTab]   = useState<TabId>("cars");
  const [busy, setBusy] = useState<string | null>(null);

  const getStatusFn     = useServerFn(getWebespokeEnterpriseStatus);
  const getCarsF        = useServerFn(getWebespokeEnterpriseCars);
  const getBuyersF      = useServerFn(getWebespokeEnterpriseBuyers);
  const getDealersF     = useServerFn(getWebespokeEnterpriseDealers);
  const syncCarsF       = useServerFn(syncWebespokeEnterpriseCars);
  const syncBuyersF     = useServerFn(syncWebespokeEnterpriseBuyers);
  const syncDealersF    = useServerFn(syncWebespokeEnterpriseDealers);
  const syncAllF        = useServerFn(syncAllWebespokeEnterpriseData);
  const adminConnectF   = useServerFn(adminOverrideConnectWebespokeEnterprise);
  const disconnectF     = useServerFn(disconnectWebespokeEnterprise);

  const statusQ  = useQuery({ queryKey: ["wbs-status"],   queryFn: () => getStatusFn(), refetchInterval: 60_000 });
  const carsQ    = useQuery({ queryKey: ["wbs-cars"],    queryFn: () => getCarsF(),    enabled: tab === "cars" });
  const buyersQ  = useQuery({ queryKey: ["wbs-buyers"],  queryFn: () => getBuyersF(),  enabled: tab === "buyers" });
  const dealersQ = useQuery({ queryKey: ["wbs-dealers"], queryFn: () => getDealersF(), enabled: tab === "dealers" });

  const isConnected = statusQ.data?.status === "connected";
  const stat = statusQ.data;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["wbs-status"] });
    qc.invalidateQueries({ queryKey: ["wbs-enterprise-status"] });
    qc.invalidateQueries({ queryKey: ["wbs-cars"] });
    qc.invalidateQueries({ queryKey: ["wbs-buyers"] });
    qc.invalidateQueries({ queryKey: ["wbs-dealers"] });
  }

  async function handleAdminConnect() {
    setBusy("connect");
    try {
      await adminConnectF();
      toast.success("Connected as Webuyanyhouse — syncing all data…");
      invalidate();
      try {
        const r = await syncAllF() as Record<string, number | string>;
        const parts = (["cars","buyers","dealers"] as const)
          .filter(k => typeof r[k] === "number")
          .map(k => `${r[k]} ${k}`);
        if (parts.length) toast.success(`Synced: ${parts.join(", ")}`);
        invalidate();
      } catch { /* non-fatal */ }
    } catch (e: any) { toast.error(e?.message ?? "Connection failed"); }
    finally { setBusy(null); }
  }

  async function handleSyncAll() {
    setBusy("sync-all");
    try {
      const r = await syncAllF() as Record<string, number | string>;
      const parts = (["cars","buyers","dealers"] as const)
        .filter(k => typeof r[k] === "number")
        .map(k => `${r[k]} ${k}`);
      toast.success(parts.length ? `Synced: ${parts.join(", ")}` : "Sync complete");
      invalidate();
    } catch (e: any) { toast.error(e?.message ?? "Sync failed"); }
    finally { setBusy(null); }
  }

  async function handleSync(type: "cars" | "buyers" | "dealers") {
    setBusy(`sync-${type}`);
    try {
      const fn = type === "cars" ? syncCarsF : type === "buyers" ? syncBuyersF : syncDealersF;
      const res = await fn();
      toast.success(`Synced ${(res as any).count} ${type}`);
      invalidate();
    } catch (e: any) { toast.error(e?.message ?? "Sync failed"); }
    finally { setBusy(null); }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect WeeBespoke AI and clear all cached Webuyanyhouse data?")) return;
    setBusy("disconnect");
    try {
      await disconnectF();
      toast.success("Disconnected");
      invalidate();
    } catch (e: any) { toast.error(e?.message ?? "Disconnect failed"); }
    finally { setBusy(null); }
  }

  const isBusy = busy !== null;

  return (
    <AccountsMindShell>
      <div className="p-6 space-y-5">

        {/* ── Header ── */}
        <div className="flex items-center gap-3">
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
              {statusQ.data && (
                <span className={cn(
                  "text-[10px] font-medium px-2 py-0.5 rounded-full",
                  isConnected ? "bg-emerald-500/20 text-emerald-400" : "bg-gray-800 text-gray-500",
                )}>
                  {isConnected ? "● Connected" : "○ Disconnected"}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              WeeBespoke AI Enterprise — vehicle marketplace CRM&nbsp;·&nbsp;<span className="font-mono">{ADMIN_EMAIL}</span>
            </p>
          </div>

          {/* Action buttons */}
          {isConnected ? (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-8 text-xs"
                disabled={isBusy}
                onClick={handleSyncAll}
              >
                {busy === "sync-all" ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Sync All
              </Button>
              <Button
                size="sm" variant="outline"
                className="border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-500/30 h-8 text-xs gap-1"
                disabled={isBusy}
                onClick={handleDisconnect}
              >
                {busy === "disconnect" ? <Loader2 className="w-3 h-3 animate-spin" /> : <PowerOff className="w-3 h-3" />}
                Disconnect
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-8 text-xs shrink-0"
              disabled={isBusy}
              onClick={handleAdminConnect}
            >
              {busy === "connect"
                ? <><Loader2 className="w-3 h-3 animate-spin" />Connecting…</>
                : <><ShieldCheck className="w-3 h-3" />Admin Connect</>}
            </Button>
          )}
        </div>

        {/* ── Stats row (when connected) ── */}
        {isConnected && stat && (
          <div className="grid grid-cols-3 gap-3">
            {([
              { icon: Car,       label: "Cars",    count: stat.carsCount    },
              { icon: Users,     label: "Buyers",  count: stat.buyersCount  },
              { icon: UserCheck, label: "Dealers", count: stat.dealersCount },
            ] as const).map(c => (
              <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
                <c.icon className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-lg font-bold text-white tabular-nums">{c.count}</p>
                  <p className="text-[10px] text-gray-500">{c.label} synced</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Not-connected callout ── */}
        {!statusQ.isLoading && !isConnected && (
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
            <p className="text-sm text-yellow-200">
              Not connected. Click <strong>Admin Connect</strong> above to authenticate and load all data automatically.
            </p>
          </div>
        )}

        {/* ── Data tabs ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-gray-800 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                  tab === t.id
                    ? "border-emerald-500 text-emerald-400"
                    : "border-transparent text-gray-500 hover:text-gray-300",
                )}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-4 min-h-[280px]">
            {tab === "cars" && (
              carsQ.isLoading
                ? <Loading />
                : <CarsTable
                    records={(carsQ.data ?? []) as any[]}
                    syncing={busy === "sync-cars"}
                    onSync={() => handleSync("cars")}
                  />
            )}
            {tab === "buyers" && (
              buyersQ.isLoading
                ? <Loading />
                : <BuyersTable
                    records={(buyersQ.data ?? []) as any[]}
                    syncing={busy === "sync-buyers"}
                    onSync={() => handleSync("buyers")}
                  />
            )}
            {tab === "dealers" && (
              dealersQ.isLoading
                ? <Loading />
                : <DealersTable
                    records={(dealersQ.data ?? []) as any[]}
                    syncing={busy === "sync-dealers"}
                    onSync={() => handleSync("dealers")}
                  />
            )}
            {tab === "bikes" && (
              <ComingSoon icon={Bike} label="Bikes" />
            )}
            {tab === "spare-parts" && (
              <ComingSoon icon={Wrench} label="Spare Parts" />
            )}
          </div>
        </div>

        <p className="text-[10px] text-gray-700 border-t border-gray-800 pt-3">
          Enterprise data is isolated to this client profile and is not merged into platform leads, contacts, calls, or analytics.
        </p>
      </div>
    </AccountsMindShell>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-12 text-gray-500">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}

function ComingSoon({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="text-center py-14 text-gray-700 border border-gray-800 border-dashed rounded-lg">
      <Icon className="w-8 h-8 mx-auto mb-2 opacity-20" />
      <p className="text-sm">{label}</p>
      <p className="text-xs mt-1 text-gray-700">Coming soon</p>
    </div>
  );
}
