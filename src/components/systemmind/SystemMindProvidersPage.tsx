import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlugZap, RefreshCw, Loader2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemMindShell } from "./SystemMindShell";
import { getSystemMindProviders } from "@/lib/systemmind/systemmind-cto.functions";
import type { SystemMindProvider } from "@/lib/systemmind/systemmind-cto.server";

const CATEGORY_ORDER = ["ai", "voice", "telephony", "messaging", "calendar", "email", "crm", "payment"];

const CATEGORY_LABEL: Record<string, string> = {
  ai: "AI", voice: "Voice", telephony: "Telephony",
  messaging: "Messaging", calendar: "Calendar",
  email: "Email", crm: "CRM", payment: "Payment",
};

function StatusDot({ status }: { status: "connected" | "disconnected" | "partial" }) {
  return status === "connected"
    ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
    : status === "partial"
    ? <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
    : <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
}

function StatusBadge({ status }: { status: "connected" | "disconnected" | "partial" }) {
  const styles = {
    connected:    "bg-emerald-500/15 text-emerald-400",
    partial:      "bg-amber-500/15 text-amber-400",
    disconnected: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", styles[status])}>
      {status}
    </span>
  );
}

function ProviderCard({ provider }: { provider: SystemMindProvider }) {
  return (
    <div className={cn(
      "rounded-xl border p-4 transition-colors",
      provider.status === "connected"
        ? "border-emerald-500/20 bg-emerald-500/[0.02]"
        : provider.status === "partial"
        ? "border-amber-500/20 bg-amber-500/[0.02]"
        : "border-red-500/20 bg-red-500/[0.02]",
    )}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={provider.status} />
          <p className="text-sm font-semibold truncate">{provider.displayName}</p>
        </div>
        <StatusBadge status={provider.status} />
      </div>

      {provider.status !== "disconnected" ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-base font-bold">{provider.requests.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Requests</p>
          </div>
          <div>
            <p className={cn("text-base font-bold", provider.errorRate > 10 ? "text-red-400" : provider.errorRate > 5 ? "text-amber-400" : "")}>
              {provider.errorRate}%
            </p>
            <p className="text-[10px] text-muted-foreground">Error rate</p>
          </div>
          <div>
            <p className="text-base font-bold">${provider.cost.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground">Cost</p>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground leading-relaxed">{provider.configHint}</p>
      )}

      {provider.lastUsedAt && (
        <p className="text-[10px] text-muted-foreground/40 mt-2">
          Last used: {new Date(provider.lastUsedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );
}

export function SystemMindProvidersPage() {
  const providersFn = useServerFn(getSystemMindProviders);
  const [filter, setFilter] = useState("all");

  const { data: providers, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["systemmind-providers"],
    queryFn: () => providersFn(),
  });

  const connected = (providers ?? []).filter((p) => p.status === "connected").length;
  const partial   = (providers ?? []).filter((p) => p.status === "partial").length;
  const disconnected = (providers ?? []).filter((p) => p.status === "disconnected").length;

  const grouped = CATEGORY_ORDER.reduce<Record<string, SystemMindProvider[]>>((acc, cat) => {
    const items = (providers ?? []).filter((p) =>
      (filter === "all" || p.status === filter) && p.category === cat,
    );
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  return (
    <SystemMindShell>
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-sky-500/25">
              <PlugZap className="h-5 w-5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Providers</h1>
              <p className="text-xs text-muted-foreground">Integration health, usage metrics, and cost by provider</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} /> Refresh
          </Button>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: "Connected", count: connected, color: "text-emerald-400" },
            { label: "Partial",   count: partial,   color: "text-amber-400" },
            { label: "Disconnected", count: disconnected, color: "text-red-400" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
              <p className={cn("text-2xl font-bold", s.color)}>{s.count}</p>
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div className="flex gap-1.5 mb-5">
          {["all", "connected", "partial", "disconnected"].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-medium capitalize transition-colors",
                filter === f ? "bg-sky-500/20 text-sky-300" : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]",
              )}>
              {f}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-2">
                  {CATEGORY_LABEL[cat] ?? cat}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map((p) => <ProviderCard key={p.id} provider={p} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SystemMindShell>
  );
}
