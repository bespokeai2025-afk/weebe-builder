import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, RefreshCw, CheckCircle2, XCircle, Clock, Loader2,
  Cpu, Mic, Phone, MessageSquare, Mail, Database, CalendarCheck,
  BookOpen, Video, Image, BarChart3, Megaphone, AlertTriangle,
  DollarSign, Zap, Link2, Star, ArrowDownToLine, PowerOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getProviderRegistryData,
  updateProviderPriority,
  toggleProviderEnabled,
} from "@/lib/providers/providers.functions";

export const Route = createFileRoute("/_authenticated/settings/providers")({
  head: () => ({ meta: [{ title: "Provider Settings — Webee" }] }),
  component: ProvidersSettingsPage,
});

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  llm:         { label: "LLM / AI Models",   icon: Cpu,           color: "text-violet-400" },
  voice:       { label: "Voice Engines",      icon: Mic,           color: "text-blue-400"   },
  telephony:   { label: "Telephony",          icon: Phone,         color: "text-emerald-400"},
  whatsapp:    { label: "WhatsApp",           icon: MessageSquare, color: "text-green-400"  },
  email:       { label: "Email",              icon: Mail,          color: "text-amber-400"  },
  crm:         { label: "CRM",                icon: Database,      color: "text-cyan-400"   },
  calendar:    { label: "Calendar",           icon: CalendarCheck, color: "text-rose-400"   },
  knowledge:   { label: "Knowledge Base",     icon: BookOpen,      color: "text-indigo-400" },
  video:       { label: "Video Generation",   icon: Video,         color: "text-pink-400"   },
  image:       { label: "Image Generation",   icon: Image,         color: "text-orange-400" },
  analytics:   { label: "Analytics",          icon: BarChart3,     color: "text-teal-400"   },
  advertising: { label: "Advertising",        icon: Megaphone,     color: "text-yellow-400" },
};

const STATUS_ORDER = ["connected", "disconnected", "error", "coming_soon"];

function StatusBadge({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
        <CheckCircle2 className="h-2.5 w-2.5" /> Connected
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">
        <AlertTriangle className="h-2.5 w-2.5" /> Error
      </span>
    );
  }
  if (status === "coming_soon") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        <Clock className="h-2.5 w-2.5" /> Coming soon
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <XCircle className="h-2.5 w-2.5" /> Disconnected
    </span>
  );
}

function PriorityBadge({ isDefault, isFallback }: { isDefault?: boolean; isFallback?: boolean }) {
  if (isDefault) return (
    <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] bg-violet-500/15 text-violet-400">Primary</span>
  );
  if (isFallback) return (
    <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] bg-blue-500/15 text-blue-400">Fallback</span>
  );
  return null;
}

const CATEGORY_SETUP_LINKS: Record<string, string> = {
  llm:         "/settings/integrations",
  voice:       "/settings/integrations",
  telephony:   "/telephony-settings",
  whatsapp:    "/whatsapp",
  email:       "/settings/integrations",
  crm:         "/settings/crm",
  calendar:    "/settings/calendar",
  knowledge:   "/builder",
  video:       "/growthmind/video-studio",
  image:       "/growthmind/content-studio",
  analytics:   "/growthmind",
  advertising: "/growthmind/ads",
};

function ProviderCard({
  provider,
  category,
  setupHref,
  onSetPrimary,
  onSetFallback,
  onDisable,
  isPending,
}: {
  provider: any;
  category: string;
  setupHref: string;
  onSetPrimary: () => void;
  onSetFallback: () => void;
  onDisable: () => void;
  isPending: boolean;
}) {
  const isConnected = provider.status === "connected";
  const isComingSoon = provider.status === "coming_soon";

  return (
    <div
      className={cn(
        "rounded-xl border p-3.5 transition-colors",
        isConnected ? "border-emerald-500/15 bg-emerald-500/[0.03]" :
        isComingSoon ? "border-white/[0.04] bg-white/[0.01] opacity-60" :
        "border-white/[0.05] bg-white/[0.02]",
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-semibold leading-tight">{provider.label}</p>
          <PriorityBadge isDefault={provider.isDefault} isFallback={provider.isFallback} />
        </div>
        <StatusBadge status={provider.status} />
      </div>

      <p className="text-[11px] text-muted-foreground leading-snug mb-2">{provider.description}</p>

      {isConnected && (provider.requests > 0 || provider.errors > 0) && (
        <div className="flex gap-3 text-[10px] text-muted-foreground mb-2">
          {provider.requests > 0 && <span>{provider.requests.toLocaleString()} req</span>}
          {provider.errors > 0 && <span className="text-red-400">{provider.errors} err</span>}
          {provider.totalCostUsd > 0 && <span>${provider.totalCostUsd.toFixed(4)}</span>}
        </div>
      )}

      {/* Controls for connected providers */}
      {isConnected && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/[0.05]">
          <Button
            size="sm"
            variant={provider.isDefault ? "secondary" : "ghost"}
            className="h-5 px-1.5 text-[10px] gap-1"
            disabled={isPending || provider.isDefault}
            onClick={onSetPrimary}
            title="Set as primary provider for this category"
          >
            <Star className="h-2.5 w-2.5" />
            {provider.isDefault ? "Primary" : "Set Primary"}
          </Button>
          <Button
            size="sm"
            variant={provider.isFallback ? "secondary" : "ghost"}
            className="h-5 px-1.5 text-[10px] gap-1"
            disabled={isPending || provider.isFallback}
            onClick={onSetFallback}
            title="Set as fallback provider for this category"
          >
            <ArrowDownToLine className="h-2.5 w-2.5" />
            {provider.isFallback ? "Fallback" : "Set Fallback"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1.5 text-[10px] gap-1 ml-auto text-red-400/70 hover:text-red-400"
            disabled={isPending}
            onClick={onDisable}
            title="Disable this provider"
          >
            <PowerOff className="h-2.5 w-2.5" />
            Disable
          </Button>
        </div>
      )}

      {!isConnected && !isComingSoon && (
        <Button asChild size="sm" variant="ghost" className="h-6 px-0 text-[11px] text-muted-foreground hover:text-foreground mt-0.5">
          <Link to={setupHref as any}>
            <Link2 className="mr-1 h-3 w-3" />
            Configure →
          </Link>
        </Button>
      )}
    </div>
  );
}

function ProvidersSettingsPage() {
  const getFn = useServerFn(getProviderRegistryData);
  const updatePriorityFn = useServerFn(updateProviderPriority);
  const toggleEnabledFn = useServerFn(toggleProviderEnabled);
  const qc = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["provider-registry"],
    queryFn: () => getFn(),
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (action: { type: "priority"; category: string; providerName: string; role: "primary" | "fallback" | "none" } | { type: "toggle"; category: string; providerName: string; enabled: boolean }) => {
      if (action.type === "priority") {
        await updatePriorityFn({ data: { category: action.category, providerName: action.providerName, role: action.role } });
      } else {
        await toggleEnabledFn({ data: { category: action.category, providerName: action.providerName, enabled: action.enabled } });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provider-registry"] });
      toast.success("Provider setting saved");
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Failed to update provider setting");
    },
  });

  const totalConnected = data?.totalConnected ?? 0;
  const totalProviders = data?.totalProviders ?? 0;
  const totalSpend = data?.totalSpend ?? 0;
  const recentErrors = data?.recentErrors ?? 0;

  const categoryOrder = Object.keys(CATEGORY_META);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">

        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/settings/integrations">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
          <div className="flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Settings</p>
            <h1 className="text-2xl font-semibold tracking-tight">Provider Registry</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              All third-party integrations across every platform capability. Set primary and fallback providers per category.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["provider-registry"] })}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-32 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
            <span className="text-sm">Loading provider registry…</span>
          </div>
        ) : (
          <div className="space-y-8">

            {/* Summary row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Providers",  value: `${totalConnected}/${totalProviders}`, sub: "connected", icon: Zap,           color: "text-violet-400" },
                { label: "Categories", value: String(categoryOrder.length),          sub: "capability areas", icon: Database, color: "text-blue-400"   },
                { label: "Total Spend",value: `$${totalSpend.toFixed(4)}`,           sub: "all time",    icon: DollarSign,    color: "text-emerald-400" },
                { label: "Errors",     value: String(recentErrors),                  sub: "all time",    icon: AlertTriangle, color: recentErrors > 0 ? "text-red-400" : "text-muted-foreground" },
              ].map((card) => (
                <div key={card.label} className="rounded-xl border border-white/[0.06] bg-card/60 px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <card.icon className={cn("h-3.5 w-3.5", card.color)} />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{card.label}</span>
                  </div>
                  <p className="text-xl font-bold tabular-nums">{card.value}</p>
                  <p className="text-[10px] text-muted-foreground">{card.sub}</p>
                </div>
              ))}
            </div>

            {/* Category sections */}
            {categoryOrder.map((cat) => {
              const meta = CATEGORY_META[cat];
              const summary = data?.byCategory[cat];
              if (!summary) return null;
              const Icon = meta.icon;
              const sorted = [...summary.providers].sort(
                (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
              );

              return (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.06]">
                      <Icon className={cn("h-3.5 w-3.5", meta.color)} />
                    </div>
                    <h2 className="text-sm font-semibold">{meta.label}</h2>
                    <span className="text-[10px] text-muted-foreground">
                      {summary.connectedCount}/{summary.totalCount} connected
                    </span>
                    {summary.totalSpend > 0 && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        ${summary.totalSpend.toFixed(4)} spend
                      </span>
                    )}
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {sorted.map((provider) => {
                      const setupHref = CATEGORY_SETUP_LINKS[cat] ?? "/settings/integrations";
                      return (
                        <ProviderCard
                          key={provider.name}
                          provider={provider}
                          category={cat}
                          setupHref={setupHref}
                          isPending={mutation.isPending}
                          onSetPrimary={() =>
                            mutation.mutate({ type: "priority", category: cat, providerName: provider.name, role: "primary" })
                          }
                          onSetFallback={() =>
                            mutation.mutate({ type: "priority", category: cat, providerName: provider.name, role: "fallback" })
                          }
                          onDisable={() =>
                            mutation.mutate({ type: "toggle", category: cat, providerName: provider.name, enabled: false })
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Migration hint */}
            <div className="rounded-xl border border-white/[0.06] bg-card/40 p-4 text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">One-time database setup required</p>
              <p>Run the migration below in your Supabase SQL editor to enable persistent provider settings and usage tracking:</p>
              <code className="mt-2 block rounded bg-muted px-3 py-2 font-mono text-[10px] break-all">
                supabase/migrations/20260705000000_provider_framework.sql
              </code>
            </div>

          </div>
        )}
      </div>
    </main>
  );
}
