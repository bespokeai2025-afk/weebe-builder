import { useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2, Car, Users, UserCheck, Bike, Wrench,
  RefreshCw, ChevronDown, ChevronUp, AlertTriangle,
  Loader2, Clock, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getWebespokeEnterpriseCars,
  getWebespokeEnterpriseBuyers,
  getWebespokeEnterpriseDealers,
  syncWebespokeEnterpriseCars,
  syncWebespokeEnterpriseBuyers,
  syncWebespokeEnterpriseDealers,
  getWebespokeEnterpriseStatus,
} from "@/lib/integrations/webespokeEnterprise/enterprise.functions";

export const Route = createFileRoute("/_authenticated/enterprise/webuyanyhouse")({
  head: () => ({ meta: [{ title: "Webuyanyhouse — Enterprise Data" }] }),
  component: WebuyanyhousenPage,
});

// ── Safe field helpers ────────────────────────────────────────────────────────

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
      try { return new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
      catch { /* ignore */ }
    }
  }
  return "—";
}

// ── Raw data drawer ───────────────────────────────────────────────────────────

function RawDrawer({ record }: { record: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1"
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {open ? "Hide" : "View"} raw data
      </button>
      {open && (
        <pre className="mt-2 text-[10px] bg-muted/50 rounded-md p-3 overflow-auto max-h-48 whitespace-pre-wrap break-all">
          {JSON.stringify(record, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Cars table ────────────────────────────────────────────────────────────────

function CarsTable({ records, syncing, onSync }: { records: any[]; syncing: boolean; onSync: () => void }) {
  if (!records.length) {
    return (
      <EmptyState
        icon={Car}
        label="No cars synced yet"
        sub="Click Sync Cars to load the latest vehicle data from WeeBespoke AI."
        syncing={syncing}
        onSync={onSync}
        syncLabel="Sync Cars"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{records.length} vehicle{records.length !== 1 ? "s" : ""}</p>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onSync} disabled={syncing}>
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Sync Cars
        </Button>
      </div>
      <div className="rounded-lg border overflow-auto">
        <table className="w-full text-xs min-w-[600px]">
          <thead className="bg-muted/50">
            <tr>
              {["Make / Model", "Year", "Reg", "Price", "Status", "Dealer", ""].map(h => (
                <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {records.map((car: any, i) => (
              <tr key={car?.id ?? car?._id ?? i} className="hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">
                  {safeStr(car, "make", "brand", "manufacturer")} {safeStr(car, "model", "carModel")}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{safeStr(car, "year", "manufacturedYear")}</td>
                <td className="px-3 py-2 text-muted-foreground">{safeStr(car, "registration", "reg", "licensePlate", "registrationNumber")}</td>
                <td className="px-3 py-2">{safeStr(car, "price", "askingPrice", "salePrice")}</td>
                <td className="px-3 py-2">
                  <StatusPill value={safeStr(car, "status", "carStatus", "listingStatus")} />
                </td>
                <td className="px-3 py-2 text-muted-foreground">{safeStr(car, "dealerName", "dealer", "dealerId")}</td>
                <td className="px-3 py-2"><RawDrawer record={car} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Buyers table ──────────────────────────────────────────────────────────────

function BuyersTable({ records, syncing, onSync }: { records: any[]; syncing: boolean; onSync: () => void }) {
  if (!records.length) {
    return (
      <EmptyState
        icon={Users}
        label="No buyers synced yet"
        sub="Click Sync Buyers to load buyer data from WeeBespoke AI."
        syncing={syncing}
        onSync={onSync}
        syncLabel="Sync Buyers"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{records.length} buyer{records.length !== 1 ? "s" : ""}</p>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onSync} disabled={syncing}>
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Sync Buyers
        </Button>
      </div>
      <div className="rounded-lg border overflow-auto">
        <table className="w-full text-xs min-w-[500px]">
          <thead className="bg-muted/50">
            <tr>
              {["Name", "Email", "Phone", "Joined", "Status", ""].map(h => (
                <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {records.map((buyer: any, i) => (
              <tr key={buyer?.id ?? buyer?._id ?? i} className="hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">
                  {safeStr(buyer, "name", "fullName", "firstName")}
                  {buyer?.lastName ? ` ${buyer.lastName}` : ""}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{safeStr(buyer, "email", "emailAddress")}</td>
                <td className="px-3 py-2 text-muted-foreground">{safeStr(buyer, "phone", "phoneNumber", "mobile")}</td>
                <td className="px-3 py-2 text-muted-foreground">{safeDate(buyer, "createdAt", "created_at", "joinedAt")}</td>
                <td className="px-3 py-2"><StatusPill value={safeStr(buyer, "status", "buyerStatus")} /></td>
                <td className="px-3 py-2"><RawDrawer record={buyer} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Dealers table ─────────────────────────────────────────────────────────────

function DealersTable({ records, syncing, onSync }: { records: any[]; syncing: boolean; onSync: () => void }) {
  if (!records.length) {
    return (
      <EmptyState
        icon={UserCheck}
        label="No dealers synced yet"
        sub="Click Sync Dealers to load dealer data from WeeBespoke AI."
        syncing={syncing}
        onSync={onSync}
        syncLabel="Sync Dealers"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{records.length} dealer{records.length !== 1 ? "s" : ""}</p>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onSync} disabled={syncing}>
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Sync Dealers
        </Button>
      </div>
      <div className="rounded-lg border overflow-auto">
        <table className="w-full text-xs min-w-[560px]">
          <thead className="bg-muted/50">
            <tr>
              {["Dealer Name", "Email", "Phone", "Company", "Status", ""].map(h => (
                <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {records.map((dealer: any, i) => (
              <tr key={dealer?.id ?? dealer?._id ?? i} className="hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{safeStr(dealer, "dealerName", "name", "fullName")}</td>
                <td className="px-3 py-2 text-muted-foreground">{safeStr(dealer, "email", "emailAddress")}</td>
                <td className="px-3 py-2 text-muted-foreground">{safeStr(dealer, "phone", "phoneNumber", "mobile")}</td>
                <td className="px-3 py-2 text-muted-foreground">{safeStr(dealer, "company", "companyName", "businessName")}</td>
                <td className="px-3 py-2"><StatusPill value={safeStr(dealer, "status", "dealerStatus")} /></td>
                <td className="px-3 py-2"><RawDrawer record={dealer} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function StatusPill({ value }: { value: string }) {
  if (value === "—") return <span className="text-muted-foreground">—</span>;
  const lower = value.toLowerCase();
  const color = lower.includes("active") || lower.includes("available") || lower.includes("approved")
    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
    : lower.includes("pending") || lower.includes("review")
    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
    : lower.includes("inactive") || lower.includes("sold") || lower.includes("rejected")
    ? "bg-red-500/10 text-red-400 border-red-500/20"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${color}`}>
      {value}
    </span>
  );
}

function EmptyState({
  icon: Icon, label, sub, syncing, onSync, syncLabel,
}: {
  icon: React.ElementType; label: string; sub: string; syncing: boolean; onSync: () => void; syncLabel: string;
}) {
  return (
    <div className="text-center py-12 text-muted-foreground rounded-lg border border-dashed">
      <Icon className="w-8 h-8 mx-auto mb-2 opacity-30" />
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs mt-1 mb-4">{sub}</p>
      <Button size="sm" variant="outline" onClick={onSync} disabled={syncing} className="gap-1">
        {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        {syncLabel}
      </Button>
    </div>
  );
}

function ComingSoon({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="text-center py-16 text-muted-foreground rounded-lg border border-dashed">
      <Icon className="w-8 h-8 mx-auto mb-2 opacity-30" />
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs mt-1">Coming soon — endpoint pattern prepared</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: "cars",        label: "Cars",        icon: Car       },
  { id: "buyers",      label: "Buyers",      icon: Users     },
  { id: "dealers",     label: "Dealers",     icon: UserCheck },
  { id: "bikes",       label: "Bikes",       icon: Bike      },
  { id: "spare-parts", label: "Spare Parts", icon: Wrench    },
] as const;

type TabId = typeof TABS[number]["id"];

function WebuyanyhousenPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>("cars");

  const getStatus    = useServerFn(getWebespokeEnterpriseStatus);
  const getCars      = useServerFn(getWebespokeEnterpriseCars);
  const getBuyers    = useServerFn(getWebespokeEnterpriseBuyers);
  const getDealers   = useServerFn(getWebespokeEnterpriseDealers);
  const syncCarsFn   = useServerFn(syncWebespokeEnterpriseCars);
  const syncBuyersFn = useServerFn(syncWebespokeEnterpriseBuyers);
  const syncDealersFn= useServerFn(syncWebespokeEnterpriseDealers);

  const statusQ  = useQuery({ queryKey: ["wbs-status"],  queryFn: () => getStatus() });
  const carsQ    = useQuery({ queryKey: ["wbs-cars"],    queryFn: () => getCars(),    enabled: activeTab === "cars" });
  const buyersQ  = useQuery({ queryKey: ["wbs-buyers"],  queryFn: () => getBuyers(),  enabled: activeTab === "buyers" });
  const dealersQ = useQuery({ queryKey: ["wbs-dealers"], queryFn: () => getDealers(), enabled: activeTab === "dealers" });

  const syncMutation = useMutation({
    mutationFn: async (type: "cars" | "buyers" | "dealers") => {
      if (type === "cars")    return syncCarsFn();
      if (type === "buyers")  return syncBuyersFn();
      return syncDealersFn();
    },
    onSuccess: (res, type) => {
      toast.success(`Synced ${(res as any).count} ${type} from WeeBespoke AI`);
      qc.invalidateQueries({ queryKey: [`wbs-${type}`] });
      qc.invalidateQueries({ queryKey: ["wbs-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Sync failed"),
  });

  const status = statusQ.data;
  const isConnected = status?.status === "connected";

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10 border border-violet-500/20 shrink-0">
          <Building2 className="h-6 w-6 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight">Webuyanyhouse</h1>
            <Badge variant="outline" className="text-[10px]">Enterprise Client</Badge>
            {status && (
              <span className={cn(
                "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border",
                isConnected
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : status.status === "otp_sent"
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-muted text-muted-foreground",
              )}>
                {isConnected ? "Connected" : status.status === "otp_sent" ? "OTP Sent" : "Disconnected"}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Vehicle marketplace CRM backend — WeeBespoke AI Enterprise integration
          </p>
          {isConnected && (
            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
              {status.userEmail && <span>Logged in as {status.userEmail}</span>}
              <span className="flex items-center gap-1">
                <Car className="w-3 h-3" />{status.carsCount} cars
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />{status.buyersCount} buyers
              </span>
              <span className="flex items-center gap-1">
                <UserCheck className="w-3 h-3" />{status.dealersCount} dealers
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Not connected warning ── */}
      {!statusQ.isLoading && !isConnected && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-center gap-3 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-amber-200">
            WeeBespoke AI Enterprise is not connected. Go to{" "}
            <a href="/settings/providers" className="underline hover:no-underline">Settings → Provider Registry</a>{" "}
            and connect under "Enterprise Integrations".
          </span>
        </div>
      )}

      {/* ── Enterprise Data tabs ── */}
      <div className="space-y-4">
        <div className="border-b">
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                  activeTab === tab.id
                    ? "border-violet-500 text-violet-400"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="min-h-[300px]">
          {activeTab === "cars" && (
            carsQ.isLoading
              ? <div className="flex items-center gap-2 py-12 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span></div>
              : <CarsTable
                  records={(carsQ.data ?? []) as any[]}
                  syncing={syncMutation.isPending && syncMutation.variables === "cars"}
                  onSync={() => syncMutation.mutate("cars")}
                />
          )}
          {activeTab === "buyers" && (
            buyersQ.isLoading
              ? <div className="flex items-center gap-2 py-12 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span></div>
              : <BuyersTable
                  records={(buyersQ.data ?? []) as any[]}
                  syncing={syncMutation.isPending && syncMutation.variables === "buyers"}
                  onSync={() => syncMutation.mutate("buyers")}
                />
          )}
          {activeTab === "dealers" && (
            dealersQ.isLoading
              ? <div className="flex items-center gap-2 py-12 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span></div>
              : <DealersTable
                  records={(dealersQ.data ?? []) as any[]}
                  syncing={syncMutation.isPending && syncMutation.variables === "dealers"}
                  onSync={() => syncMutation.mutate("dealers")}
                />
          )}
          {activeTab === "bikes"       && <ComingSoon icon={Bike}   label="Bikes" />}
          {activeTab === "spare-parts" && <ComingSoon icon={Wrench} label="Spare Parts" />}
        </div>
      </div>

      {/* ── Isolation notice ── */}
      <p className="text-[10px] text-muted-foreground border-t pt-3">
        This data is exclusively scoped to the Webuyanyhouse enterprise profile and is not merged into the
        main platform dashboard, HiveMind, leads, contacts, or analytics.
      </p>
    </div>
  );
}
