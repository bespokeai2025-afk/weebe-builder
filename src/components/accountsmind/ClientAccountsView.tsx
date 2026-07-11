import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, BarChart3, TrendingUp } from "lucide-react";
import { getClientVisibleConfig } from "@/lib/accountsmind/accountsmind-config.functions";
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

export function ClientAccountsView() {
  const getFn = useServerFn(getClientVisibleConfig);

  const { data, isLoading } = useQuery({
    queryKey: ["accountsmind-client-view"],
    queryFn: () => getFn(),
    throwOnError: false,
  });

  const widgets: any[] = data?.widgets ?? [];
  const stats:   any[] = data?.stats ?? [];
  const metrics = data?.metrics ?? {};
  const series: Record<string, Array<{ date: string; value: number }>> = data?.series ?? {};

  return (
    <div className="p-5 md:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <BarChart3 className="h-4.5 w-4.5 text-emerald-400" /> Your Account Dashboard
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Live figures for your workspace, updated every time you open this page.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your dashboard…
        </div>
      ) : widgets.length === 0 && stats.length === 0 ? (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-6">
          <p className="text-sm">Your account dashboard hasn't been set up yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Ask your account manager to configure it — once approved, your stats will appear here.
          </p>
        </div>
      ) : (
        <>
          {widgets.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {widgets.map((w: any) => {
                const isTrend = w.widget_type === "trend" || w.widget_type === "progress";
                const points = isTrend ? (series[w.metric_key] ?? []) : [];
                return (
                  <div key={w.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      {isTrend && <TrendingUp className="h-3 w-3 text-emerald-400" />}
                      {w.title}
                    </p>
                    <p className="text-2xl font-bold mt-1.5">{formatMetric(metrics[w.metric_key], w.format)}</p>
                    {points.length >= 2 ? (
                      <MetricSparkline
                        points={points}
                        formatValue={(v) => formatMetric(v, w.format)}
                      />
                    ) : isTrend ? (
                      <p className="text-[10px] text-muted-foreground/70 mt-2">
                        Collecting daily history — the trend line will appear here.
                      </p>
                    ) : null}
                    {w.description && <p className="text-[10px] text-muted-foreground mt-1">{w.description}</p>}
                  </div>
                );
              })}
            </div>
          )}
          {stats.length > 0 && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] divide-y divide-white/[0.05]">
              {stats.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-xs font-medium">{s.label}</p>
                    {s.description && <p className="text-[10px] text-muted-foreground mt-0.5">{s.description}</p>}
                  </div>
                  <p className="text-sm font-semibold text-emerald-300">{formatMetric(metrics[s.metric_key], s.format)}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
