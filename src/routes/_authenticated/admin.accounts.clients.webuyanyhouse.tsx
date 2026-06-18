import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft, Building2, Home, Users, UserCheck,
  RefreshCw, Loader2, ChevronDown, ChevronUp, AlertTriangle,
  ShieldCheck, PowerOff, Phone,
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
  component: WebuyanyhouseProfile,
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
    lower.includes("active") || lower.includes("available") || lower.includes("approved") || lower.includes("listed")
      ? "bg-emerald-500/20 text-emerald-400"
      : lower.includes("pending") || lower.includes("review") || lower.includes("offer")
      ? "bg-yellow-500/20 text-yellow-400"
      : lower.includes("sold") || lower.includes("inactive") || lower.includes("rejected") || lower.includes("withdrawn")
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
        <pre className="mt-1 text-[9px] bg-gray-950 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all text-gray-400">
          {JSON.stringify(record, null, 2)}
        </pre>
      )}
    </div>
  );
}

function SyncBtn({ syncing, onClick }: { syncing: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick} disabled={syncing}
      className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
    >
      {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
      Sync
    </button>
  );
}

// ── Tab: Properties (backed by the "cars" endpoint from WeeBespoke API) ───────

function PropertiesTable({ records, syncing, onSync }: { records: any[]; syncing: boolean; onSync: () => void }) {
  if (!records.length) return (
    <EmptyTab icon={Home} label="No properties synced yet" onSync={onSync} syncing={syncing} syncLabel="Sync Properties" />
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{records.length} propert{records.length !== 1 ? "ies" : "y"}</p>
        <SyncBtn syncing={syncing} onClick={onSync} />
      </div>
      <div className="rounded-lg border border-gray-800 overflow-auto">
        <table className="w-full text-xs min-w-[600px]">
          <thead className="bg-gray-900 border-b border-gray-800">
            <tr>
              {["Address", "Type", "Bedrooms", "Asking Price", "Status", "Agent", ""].map(h => (
                <th key={h} className="text-left px-3 py-2 font-medium text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {records.map((p: any, i: number) => (
              <tr key={p?.id ?? p?._id ?? i} className="hover:bg-gray-900/60">
                <td className="px-3 py-2 font-medium text-white max-w-[200px] truncate">
                  {safeStr(p, "address", "fullAddress", "propertyAddress", "make", "title", "name")}
                </td>
                <td className="px-3 py-2 text-gray-400">
                  {safeStr(p, "propertyType", "type", "category", "model")}
                </td>
                <td className="px-3 py-2 text-gray-400">
                  {safeStr(p, "bedrooms", "beds", "numBedrooms", "year")}
                </td>
                <td className="px-3 py-2 text-gray-300">
                  {safeStr(p, "askingPrice", "price", "salePrice", "offerPrice")}
                </td>
                <td className="px-3 py-2">
                  <StatusPill value={safeStr(p, "status", "propertyStatus", "listingStatus")} />
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {safeStr(p, "agentName", "agent", "assignedAgent", "dealerName", "dealer")}
                </td>
                <td className="px-3 py-2"><RawRow record={p} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Buyers ───────────────────────────────────────────────────────────────

function BuyersTable({ records, syncing, onSync }: { records: any[]; syncing: boolean; onSync: () => void }) {
  if (!records.length) return (
    <EmptyTab icon={Users} label="No buyers synced yet" onSync={onSync} syncing={syncing} syncLabel="Sync Buyers" />
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{records.length} buyer{records.length !== 1 ? "s" : ""}</p>
        <SyncBtn syncing={syncing} onClick={onSync} />
      </div>
      <div className="rounded-lg border border-gray-800 overflow-auto">
        <table className="w-full text-xs min-w-[520px]">
          <thead className="bg-gray-900 border-b border-gray-800">
            <tr>
              {["Name", "Email", "Phone", "Enquiry Date", "Status", ""].map(h => (
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
                <td className="px-3 py-2 text-gray-500">{safeDate(b, "enquiryDate", "createdAt", "created_at", "joinedAt")}</td>
                <td className="px-3 py-2"><StatusPill value={safeStr(b, "status", "buyerStatus", "leadStatus")} /></td>
                <td className="px-3 py-2"><RawRow record={b} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Agents (backed by the "dealers" endpoint from WeeBespoke API) ────────

function AgentsTable({ records, syncing, onSync }: { records: any[]; syncing: boolean; onSync: () => void }) {
  if (!records.length) return (
    <EmptyTab icon={UserCheck} label="No agents synced yet" onSync={onSync} syncing={syncing} syncLabel="Sync Agents" />
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{records.length} agent{records.length !== 1 ? "s" : ""}</p>
        <SyncBtn syncing={syncing} onClick={onSync} />
      </div>
      <div className="rounded-lg border border-gray-800 overflow-auto">
        <table className="w-full text-xs min-w-[520px]">
          <thead className="bg-gray-900 border-b border-gray-800">
            <tr>
              {["Agent Name", "Email", "Phone", "Branch / Office", "Status", ""].map(h => (
                <th key={h} className="text-left px-3 py-2 font-medium text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {records.map((a: any, i: number) => (
              <tr key={a?.id ?? a?._id ?? i} className="hover:bg-gray-900/60">
                <td className="px-3 py-2 font-medium text-white">
                  {safeStr(a, "name", "fullName", "agentName", "dealerName")}
                </td>
                <td className="px-3 py-2 text-gray-400">{safeStr(a, "email", "emailAddress")}</td>
                <td className="px-3 py-2 text-gray-400">{safeStr(a, "phone", "phoneNumber", "mobile")}</td>
                <td className="px-3 py-2 text-gray-400">
                  {safeStr(a, "branch", "office", "company", "companyName", "businessName")}
                </td>
                <td className="px-3 py-2"><StatusPill value={safeStr(a, "status", "agentStatus", "dealerStatus")} /></td>
                <td className="px-3 py-2"><RawRow record={a} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

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
  { id: "properties", label: "Properties", icon: Home      },
  { id: "buyers",     label: "Buyers",     icon: Users     },
  { id: "agents",     label: "Agents",     icon: UserCheck },
] as const;
type TabId = typeof TABS[number]["id"];

function WebuyanyhouseProfile() {
  const qc = useQueryClient();
  const [tab, setTab]   = useState<TabId>("properties");
  const [busy, setBusy] = useState<string | null>(null);

  const getStatusFn   = useServerFn(getWebespokeEnterpriseStatus);
  const getPropsF     = useServerFn(getWebespokeEnterpriseCars);
  const getBuyersF    = useServerFn(getWebespokeEnterpriseBuyers);
  const getAgentsF    = useServerFn(getWebespokeEnterpriseDealers);
  const syncPropsF    = useServerFn(syncWebespokeEnterpriseCars);
  const syncBuyersF   = useServerFn(syncWebespokeEnterpriseBuyers);
  const syncAgentsF   = useServerFn(syncWebespokeEnterpriseDealers);
  const syncAllF      = useServerFn(syncAllWebespokeEnterpriseData);
  const adminConnectF = useServerFn(adminOverrideConnectWebespokeEnterprise);
  const disconnectF   = useServerFn(disconnectWebespokeEnterprise);

  const statusQ     = useQuery({ queryKey: ["wbs-status"],      queryFn: () => getStatusFn(),  refetchInterval: 60_000 });
  const propertiesQ = useQuery({ queryKey: ["wbs-properties"],  queryFn: () => getPropsF(),    enabled: tab === "properties" });
  const buyersQ     = useQuery({ queryKey: ["wbs-buyers"],      queryFn: () => getBuyersF(),   enabled: tab === "buyers" });
  const agentsQ     = useQuery({ queryKey: ["wbs-agents"],      queryFn: () => getAgentsF(),   enabled: tab === "agents" });

  const isConnected = statusQ.data?.status === "connected";
  const stat = statusQ.data;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["wbs-status"] });
    qc.invalidateQueries({ queryKey: ["wbs-enterprise-status"] });
    qc.invalidateQueries({ queryKey: ["wbs-properties"] });
    qc.invalidateQueries({ queryKey: ["wbs-buyers"] });
    qc.invalidateQueries({ queryKey: ["wbs-agents"] });
  }

  async function handleAdminConnect() {
    setBusy("connect");
    try {
      await adminConnectF();
      toast.success("Connected — syncing all Webuyanyhouse data…");
      invalidate();
      try {
        const r = await syncAllF() as Record<string, number | string>;
        const parts: string[] = [];
        if (typeof r.cars    === "number") parts.push(`${r.cars} properties`);
        if (typeof r.buyers  === "number") parts.push(`${r.buyers} buyers`);
        if (typeof r.dealers === "number") parts.push(`${r.dealers} agents`);
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
      const parts: string[] = [];
      if (typeof r.cars    === "number") parts.push(`${r.cars} properties`);
      if (typeof r.buyers  === "number") parts.push(`${r.buyers} buyers`);
      if (typeof r.dealers === "number") parts.push(`${r.dealers} agents`);
      toast.success(parts.length ? `Synced: ${parts.join(", ")}` : "Sync complete");
      invalidate();
    } catch (e: any) { toast.error(e?.message ?? "Sync failed"); }
    finally { setBusy(null); }
  }

  async function handleSync(type: "properties" | "buyers" | "agents") {
    setBusy(`sync-${type}`);
    try {
      const fn = type === "properties" ? syncPropsF : type === "buyers" ? syncBuyersF : syncAgentsF;
      const label = type === "properties" ? "properties" : type;
      const res = await fn();
      toast.success(`Synced ${(res as any).count} ${label}`);
      invalidate();
    } catch (e: any) { toast.error(e?.message ?? "Sync failed"); }
    finally { setBusy(null); }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect and clear all cached Webuyanyhouse data?")) return;
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
              Real estate client on WeeBee AI&nbsp;·&nbsp;Microsoft Dynamics AI calling&nbsp;·&nbsp;
              <span className="font-mono">{ADMIN_EMAIL}</span>
            </p>
          </div>

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

        {/* ── Info strip ── */}
        <div className="rounded-lg bg-gray-900 border border-gray-800 px-4 py-3 flex flex-wrap items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-emerald-500" /> Real Estate</span>
          <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-blue-400" /> Microsoft Dynamics AI Calling</span>
          <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-purple-400" /> WeeBee Enterprise</span>
        </div>

        {/* ── Stats row (when connected) ── */}
        {isConnected && stat && (
          <div className="grid grid-cols-3 gap-3">
            {([
              { icon: Home,      label: "Properties", count: stat.carsCount    },
              { icon: Users,     label: "Buyers",     count: stat.buyersCount  },
              { icon: UserCheck, label: "Agents",     count: stat.dealersCount },
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
              Not connected to WeeBespoke AI Enterprise. Click <strong>Admin Connect</strong> to authenticate and load all data.
            </p>
          </div>
        )}

        {/* ── Data tabs ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex border-b border-gray-800">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
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

          <div className="p-4 min-h-[280px]">
            {tab === "properties" && (
              propertiesQ.isLoading
                ? <Loading />
                : <PropertiesTable
                    records={(propertiesQ.data ?? []) as any[]}
                    syncing={busy === "sync-properties"}
                    onSync={() => handleSync("properties")}
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
            {tab === "agents" && (
              agentsQ.isLoading
                ? <Loading />
                : <AgentsTable
                    records={(agentsQ.data ?? []) as any[]}
                    syncing={busy === "sync-agents"}
                    onSync={() => handleSync("agents")}
                  />
            )}
          </div>
        </div>

        <p className="text-[10px] text-gray-700 border-t border-gray-800 pt-3">
          Data is synced from WeeBespoke AI Enterprise and isolated to this client profile. It is not merged into platform leads, contacts, calls, or analytics.
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
