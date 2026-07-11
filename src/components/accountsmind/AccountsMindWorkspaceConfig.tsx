import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Loader2, LayoutDashboard, BarChart3, ListChecks, Eye, ShieldAlert, ArrowRight, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountsMindShell } from "./AccountsMindShell";
import { Badge } from "@/components/ui/badge";
import {
  listAccountsMindConfig,
  computeAccountsMindMetrics,
  getAccountsMindMetricSeries,
} from "@/lib/accountsmind/accountsmind-config.functions";
import { MetricSparkline } from "./MetricSparkline";

function formatMetric(value: number | null | undefined, format: string): string {
  if (value == null) return "—";
  switch (format) {
    case "currency":   return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    case "percentage": return `${value}%`;
    case "duration":   return `${value.toLocaleString()} min`;
    default:           return value.toLocaleString();
  }
}

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-400 border-emerald-500/40",
  paused: "text-orange-400 border-orange-500/40",
  hidden: "text-gray-500 border-gray-700",
};

export function AccountsMindWorkspaceConfig() {
  const listFn    = useServerFn(listAccountsMindConfig);
  const metricsFn = useServerFn(computeAccountsMindMetrics);
  const seriesFn  = useServerFn(getAccountsMindMetricSeries);

  const { data: config, isLoading } = useQuery({
    queryKey: ["accountsmind-config"],
    queryFn: () => listFn({ data: { includeNonActive: true } }),
    throwOnError: false,
  });

  const metricKeys = [
    ...(config?.stats ?? []).map((s: any) => s.metric_key),
    ...(config?.widgets ?? []).map((w: any) => w.metric_key),
  ].filter(Boolean);

  const { data: metricValues } = useQuery({
    queryKey: ["accountsmind-metric-values", [...new Set(metricKeys)].sort().join(",")],
    queryFn: () => metricsFn({ data: { keys: [...new Set(metricKeys)] } }),
    enabled: metricKeys.length > 0,
    throwOnError: false,
  });

  const trendKeys = [...new Set(
    (config?.widgets ?? [])
      .filter((w: any) => w.widget_type === "trend" || w.widget_type === "progress")
      .map((w: any) => w.metric_key)
      .filter(Boolean),
  )];

  const { data: metricSeries } = useQuery({
    queryKey: ["accountsmind-metric-series", [...trendKeys].sort().join(",")],
    queryFn: () => seriesFn({ data: { keys: trendKeys, days: 30 } }),
    enabled: trendKeys.length > 0 && !!metricValues,
    throwOnError: false,
  });

  const total = (config?.fields?.length ?? 0) + (config?.stats?.length ?? 0) + (config?.widgets?.length ?? 0);

  return (
    <AccountsMindShell>
      <div className="p-6 max-w-4xl space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <LayoutDashboard className="w-4 h-4 text-emerald-400" /> Workspace Config
            </h1>
            <p className="text-xs text-gray-400 mt-1">
              Custom fields, stats and dashboard widgets configured for this workspace by SystemMind
              (approval-first — drafted, reviewed, then activated).
            </p>
          </div>
          <Link
            to="/systemmind/accountsmind-setup"
            className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 rounded-md px-3 py-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" /> Manage in SystemMind <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-6">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading configuration…
          </div>
        ) : total === 0 ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-5">
            <p className="text-sm text-gray-300">No custom configuration is live for this workspace yet.</p>
            <p className="text-xs text-gray-500 mt-1">
              Draft one with SystemMind's AccountsMind Setup, then approve it on the Automation page.
            </p>
          </div>
        ) : (
          <>
            {(config?.widgets?.length ?? 0) > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5" /> Dashboard widgets
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {config!.widgets.map((w: any) => (
                    <div key={w.id} className={cn(
                      "rounded-lg border border-gray-800 bg-gray-900/60 p-4",
                      w.status !== "active" && "opacity-60",
                    )}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-gray-400 truncate">{w.title}</p>
                        {w.client_visible && <Eye className="w-3 h-3 text-sky-400 shrink-0" />}
                      </div>
                      <p className="text-xl font-bold text-white mt-1.5">
                        {formatMetric(metricValues?.[w.metric_key], w.format)}
                      </p>
                      {(w.widget_type === "trend" || w.widget_type === "progress") && (
                        (metricSeries?.[w.metric_key]?.length ?? 0) >= 2 ? (
                          <MetricSparkline
                            points={metricSeries![w.metric_key]}
                            formatValue={(v) => formatMetric(v, w.format)}
                          />
                        ) : (
                          <p className="text-[10px] text-gray-600 mt-2">
                            Collecting daily history — trend appears after a few days.
                          </p>
                        )
                      )}
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <Badge variant="outline" className="text-[9px] font-mono border-gray-700 text-gray-500">{w.metric_key}</Badge>
                        <Badge variant="outline" className={cn("text-[9px]", STATUS_COLORS[w.status] ?? "text-gray-500 border-gray-700")}>{w.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {(config?.stats?.length ?? 0) > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                  <ListChecks className="w-3.5 h-3.5" /> Stats
                </h2>
                <div className="space-y-1.5">
                  {config!.stats.map((s: any) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 flex-wrap">
                      <span className="text-xs font-medium text-white">{s.label}</span>
                      <Badge variant="outline" className="text-[9px] font-mono border-gray-700 text-gray-500">{s.metric_key}</Badge>
                      <span className="text-xs text-emerald-300 font-semibold ml-auto">
                        {formatMetric(metricValues?.[s.metric_key], s.format)}
                      </span>
                      <Badge variant="outline" className={cn("text-[9px]", STATUS_COLORS[s.status] ?? "text-gray-500 border-gray-700")}>{s.status}</Badge>
                      {s.client_visible && <Eye className="w-3 h-3 text-sky-400" />}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {(config?.fields?.length ?? 0) > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                  <ListChecks className="w-3.5 h-3.5" /> Custom fields
                </h2>
                <div className="space-y-1.5">
                  {config!.fields.map((f: any) => (
                    <div key={f.id} className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 flex-wrap">
                      <Badge variant="outline" className="text-[9px] font-mono border-gray-700 text-gray-500">{f.field_key}</Badge>
                      <span className="text-xs font-medium text-white">{f.label}</span>
                      <span className="text-[10px] text-gray-500">{f.field_type} · {f.entity_type}</span>
                      <div className="flex items-center gap-1.5 ml-auto">
                        {f.risk_level === "high" && <ShieldAlert className="w-3 h-3 text-red-400" />}
                        <Badge variant="outline" className={cn("text-[9px]", STATUS_COLORS[f.status] ?? "text-gray-500 border-gray-700")}>{f.status}</Badge>
                        {f.client_visible && <Eye className="w-3 h-3 text-sky-400" />}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </AccountsMindShell>
  );
}
