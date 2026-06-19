import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2, XCircle, AlertTriangle, DollarSign, Zap, Link2, Cpu, Mic,
  Phone, MessageSquare, Mail, Database, CalendarCheck, BookOpen, Video, Image,
  BarChart3, Megaphone, Loader2, RefreshCw,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { getProviderRegistryData } from "@/lib/providers/providers.functions";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  llm:         Cpu,
  voice:       Mic,
  telephony:   Phone,
  whatsapp:    MessageSquare,
  email:       Mail,
  crm:         Database,
  calendar:    CalendarCheck,
  knowledge:   BookOpen,
  video:       Video,
  image:       Image,
  analytics:   BarChart3,
  advertising: Megaphone,
};

const CATEGORY_COLORS: Record<string, string> = {
  llm:         "text-violet-400",
  voice:       "text-blue-400",
  telephony:   "text-emerald-400",
  whatsapp:    "text-green-400",
  email:       "text-amber-400",
  crm:         "text-cyan-400",
  calendar:    "text-rose-400",
  knowledge:   "text-indigo-400",
  video:       "text-pink-400",
  image:       "text-orange-400",
  analytics:   "text-teal-400",
  advertising: "text-yellow-400",
};

export function HiveMindProviderHealth() {
  const fn = useServerFn(getProviderRegistryData);
  const qc = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["provider-registry"],
    queryFn: () => fn(),
    staleTime: 120_000,
    throwOnError: false,
  });

  const totalConnected = data?.totalConnected ?? 0;
  const totalProviders = data?.totalProviders ?? 0;
  const totalSpend = data?.totalSpend ?? 0;
  const recentErrors = data?.recentErrors ?? 0;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-violet-400" />
          <h3 className="text-sm font-semibold">Provider Health</h3>
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="text-emerald-400 font-medium">{totalConnected} connected</span>
              <span>·</span>
              <span>{totalProviders - totalConnected} pending</span>
              {totalSpend > 0 && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-0.5">
                    <DollarSign className="h-2.5 w-2.5" />
                    {totalSpend.toFixed(4)} spend
                  </span>
                </>
              )}
              {recentErrors > 0 && (
                <>
                  <span>·</span>
                  <span className="text-red-400 flex items-center gap-0.5">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {recentErrors} errors
                  </span>
                </>
              )}
            </div>
          )}
          <Button
            variant="ghost" size="sm"
            className="h-6 w-6 p-0"
            onClick={() => qc.invalidateQueries({ queryKey: ["provider-registry"] })}
          >
            <RefreshCw className={cn("h-3 w-3 text-muted-foreground", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
          <span className="text-xs">Loading providers…</span>
        </div>
      ) : (
        <>
          {/* Category grid */}
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(data?.byCategory ?? {}).map(([cat, summary]) => {
              const Icon = CATEGORY_ICONS[cat] ?? Zap;
              const color = CATEGORY_COLORS[cat] ?? "text-muted-foreground";
              const allConnected = summary.connectedCount === summary.totalCount;
              const noneConnected = summary.connectedCount === 0;

              return (
                <div
                  key={cat}
                  className={cn(
                    "rounded-lg border p-2.5",
                    allConnected ? "border-emerald-500/15 bg-emerald-500/[0.03]" :
                    noneConnected ? "border-white/[0.04] bg-white/[0.01]" :
                    "border-amber-500/15 bg-amber-500/[0.03]",
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Icon className={cn("h-3 w-3 shrink-0", color)} />
                    {allConnected
                      ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400 ml-auto shrink-0" />
                      : noneConnected
                        ? <XCircle className="h-2.5 w-2.5 text-muted-foreground/40 ml-auto shrink-0" />
                        : <AlertTriangle className="h-2.5 w-2.5 text-amber-400 ml-auto shrink-0" />
                    }
                  </div>
                  <p className="text-[10px] font-medium text-foreground capitalize leading-tight">{cat.replace(/_/g, " ")}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5">
                    {summary.connectedCount}/{summary.totalCount}
                  </p>
                  {summary.totalSpend > 0 && (
                    <p className="text-[9px] text-muted-foreground">
                      ${summary.totalSpend.toFixed(4)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Top spend by provider */}
          {data && (() => {
            const topProviders = Object.values(data.byCategory)
              .flatMap(s => s.providers)
              .filter(p => p.totalCostUsd > 0)
              .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
              .slice(0, 5);

            if (topProviders.length === 0) return null;

            return (
              <div className="border-t border-white/[0.06] px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-2">Top spend by provider</p>
                <div className="space-y-1.5">
                  {topProviders.map(p => (
                    <div key={`${p.name}-spend`} className="flex items-center justify-between text-[11px]">
                      <span className="text-foreground font-medium">{p.label}</span>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        {p.requests > 0 && <span>{p.requests.toLocaleString()} req</span>}
                        {p.errors > 0 && <span className="text-red-400">{p.errors} err</span>}
                        <span className="text-foreground font-semibold tabular-nums">${p.totalCostUsd.toFixed(4)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Footer */}
          <div className="border-t border-white/[0.06] px-4 py-2 flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              {totalConnected > 0
                ? `${totalConnected} of ${totalProviders} providers active across all capabilities`
                : "Connect providers to unlock capabilities"}
            </p>
            <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground">
              <Link to="/settings/providers">
                <Link2 className="mr-1 h-3 w-3" />
                Manage →
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
