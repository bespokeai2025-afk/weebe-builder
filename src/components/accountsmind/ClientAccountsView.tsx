import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, BarChart3, TrendingUp, Factory } from "lucide-react";
import {
  getClientVisibleConfig,
  getAccountsMindIndustryState,
  applyAccountsMindIndustryPreset,
} from "@/lib/accountsmind/accountsmind-config.functions";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
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

function IndustrySetupCard() {
  const qc = useQueryClient();
  const getStateFn = useServerFn(getAccountsMindIndustryState);
  const applyFn = useServerFn(applyAccountsMindIndustryPreset);
  const [selected, setSelected] = useState<string>("");
  const [applying, setApplying] = useState(false);

  const { data: state } = useQuery({
    queryKey: ["accountsmind-industry-state"],
    queryFn: () => getStateFn(),
    throwOnError: false,
  });

  if (!state?.canManage) return null;

  const current = state.industry;
  const options = state.options ?? [];
  const currentLabel = options.find((o: any) => o.key === current)?.label ?? null;
  const chosen = selected || current || "";
  const chosenOption = options.find((o: any) => o.key === chosen);

  const apply = async () => {
    if (!chosen) return;
    setApplying(true);
    try {
      const res = await applyFn({ data: { industryKey: chosen } });
      toast.success(
        `Dashboard tailored for ${options.find((o: any) => o.key === chosen)?.label ?? chosen} — ${res.statsCreated} stats and ${res.widgetsCreated} widgets set up.`,
      );
      qc.invalidateQueries({ queryKey: ["accountsmind-client-view"] });
      qc.invalidateQueries({ queryKey: ["accountsmind-industry-state"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to apply industry setup");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Factory className="h-4 w-4 text-emerald-400" />
        <p className="text-sm font-medium">Industry setup</p>
        {currentLabel && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
            {currentLabel}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Choose your industry to tailor this dashboard with the right KPIs and labels for your
        business. Applying replaces your current dashboard stats and widgets with the industry
        preset (previous versions are kept and can be rolled back). This only affects your own
        workspace.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Select value={chosen} onValueChange={setSelected}>
          <SelectTrigger className="sm:w-72">
            <SelectValue placeholder="Select your industry…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o: any) => (
              <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={apply}
          disabled={applying || !chosen || (chosen === current && !selected)}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          {applying ? "Applying…" : chosen === current ? "Re-apply preset" : "Tailor my dashboard"}
        </Button>
      </div>
      {chosenOption && (
        <p className="text-[10px] text-muted-foreground">{chosenOption.description}</p>
      )}
    </div>
  );
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

      <IndustrySetupCard />

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your dashboard…
        </div>
      ) : widgets.length === 0 && stats.length === 0 ? (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-6">
          <p className="text-sm">Your account dashboard hasn't been set up yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Pick your industry above to set it up instantly, or ask your account manager to
            configure it for you.
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
