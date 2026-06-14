import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  TrendingUp, Loader2, RefreshCw, Save, Settings2, ChevronDown,
  Users, CalendarCheck, DollarSign, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getForecastData,
  getForecasts,
  saveForecast,
  saveForecastSettings,
  computeWeeklyBuckets,
  linearForecast,
  type ForecastSummary,
} from "@/lib/growthmind/growthmind.forecast";

// ── Types ──────────────────────────────────────────────────────────────────────

type Scenario = "conservative" | "base" | "optimistic";

const SCENARIO_LABELS: Record<Scenario, string> = {
  conservative: "Conservative (×0.8)",
  base:         "Base (×1.0)",
  optimistic:   "Optimistic (×1.3)",
};

const SCENARIO_COLORS: Record<Scenario, string> = {
  conservative: "#f59e0b",
  base:         "#10b981",
  optimistic:   "#6366f1",
};

// ── Summary card ───────────────────────────────────────────────────────────────

function SummaryCard({ label, icon: Icon, values, currency, showCurrency = false }: {
  label:       string;
  icon:        React.ElementType;
  values:      { conservative: number; base: number; optimistic: number };
  currency:    string;
  showCurrency?: boolean;
}) {
  const fmt = (n: number) =>
    showCurrency
      ? `${currency}${n >= 1000 ? (n / 1000).toFixed(1) + "k" : n.toLocaleString()}`
      : n.toLocaleString();

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-emerald-400" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      </div>
      <div className="space-y-1.5">
        {(["conservative", "base", "optimistic"] as Scenario[]).map(s => (
          <div key={s} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full" style={{ background: SCENARIO_COLORS[s] }} />
              <span className="text-[11px] text-muted-foreground capitalize">{s}</span>
            </div>
            <span className="text-sm font-bold tabular-nums">{fmt(values[s])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Saved forecast row ─────────────────────────────────────────────────────────

function SavedForecastRow({ fc }: { fc: any }) {
  const [open, setOpen] = useState(false);
  const date = new Date(fc.createdAt).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const s = fc.summary ?? {};
  const curr = fc.currency ?? "GBP";

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.02]"
        onClick={() => setOpen(v => !v)}
      >
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-[10px] font-semibold rounded-full px-1.5 py-0.5 capitalize",
              fc.scenario === "conservative" ? "bg-amber-500/15 text-amber-400" :
              fc.scenario === "base"         ? "bg-emerald-500/15 text-emerald-400" :
                                               "bg-indigo-500/15 text-indigo-400",
            )}>{fc.scenario}</span>
            <p className="text-xs font-medium">{fc.periodWeeks}-week forecast</p>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Saved {date}</p>
        </div>
        {s.salesBase !== undefined && (
          <span className="text-[11px] text-muted-foreground hidden sm:block">
            {s.salesBase} projected sales · {curr}{s.revBase >= 1000 ? (s.revBase / 1000).toFixed(1) + "k" : s.revBase} revenue
          </span>
        )}
      </div>
      {open && s.leadsBase !== undefined && (
        <div className="px-4 pb-3 pt-1 border-t border-white/[0.04]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Leads",       val: s.leadsBase },
              { label: "Bookings",    val: s.booksBase },
              { label: "Sales",       val: s.salesBase },
              { label: "Revenue",     val: `${curr}${s.revBase >= 1000 ? (s.revBase / 1000).toFixed(1) + "k" : s.revBase}` },
            ].map(item => (
              <div key={item.label} className="rounded-md bg-white/[0.03] px-3 py-2">
                <p className="text-[10px] text-muted-foreground">{item.label} (base)</p>
                <p className="text-sm font-bold tabular-nums mt-0.5">{item.val}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label, metric }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/[0.12] bg-[hsl(var(--card))] px-3 py-2.5 text-xs shadow-xl">
      <p className="font-semibold mb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium tabular-nums">{p.value ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

// ── Metric tab ─────────────────────────────────────────────────────────────────

type MetricKey = "leads" | "bookings" | "sales";

const METRIC_LABELS: Record<MetricKey, string> = {
  leads:    "Leads / week",
  bookings: "Appointments / week",
  sales:    "Sales / week",
};

// ── Main component ─────────────────────────────────────────────────────────────

export function GrowthMindForecast() {
  const [scenario, setScenario]     = useState<Scenario>("base");
  const [metric, setMetric]         = useState<MetricKey>("leads");
  const [dealValue, setDealValue]   = useState<string>("");
  const [currency, setCurrency]     = useState<string>("£");
  const [showConfig, setShowConfig] = useState(false);
  const [saveMsg, setSaveMsg]       = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const qc           = useQueryClient();
  const getDataFn    = useServerFn(getForecastData);
  const getHistFn    = useServerFn(getForecasts);
  const saveFcFn     = useServerFn(saveForecast);
  const saveSetFn    = useServerFn(saveForecastSettings);

  const { data: rawData, isLoading } = useQuery({
    queryKey: ["growthmind-forecast-raw"],
    queryFn:  () => getDataFn(),
    staleTime: 120_000,
    onSuccess: (d: any) => {
      if (d.dealValue && !dealValue) setDealValue(String(d.dealValue));
      if (d.currency)                setCurrency(d.currency);
    },
  } as any);

  const { data: histData, isLoading: histLoading } = useQuery({
    queryKey: ["growthmind-saved-forecasts"],
    queryFn:  () => getHistFn(),
  });

  const dv = parseFloat(dealValue) || 0;

  const { buckets, result } = useMemo(() => {
    if (!rawData) return { buckets: [], result: null };
    const bkts = computeWeeklyBuckets(rawData);
    const res  = linearForecast(bkts, dv);
    return { buckets: bkts, result: res };
  }, [rawData, dv]);

  const chartData = useMemo(() => {
    if (!result) return [];
    const actualPoints = result.actuals.map(b => ({
      label:    b.label,
      isActual: true,
      actual:   metric === "leads" ? b.leads : metric === "bookings" ? b.bookings : b.sales,
      conserv:  null as number | null,
      base:     null as number | null,
      opt:      null as number | null,
    }));

    const forecastPoints = result.forecast.map(f => ({
      label:    f.label,
      isActual: false,
      actual:   null as number | null,
      conserv:  metric === "leads" ? f.leadsConserv : metric === "bookings" ? f.booksConserv : f.salesConserv,
      base:     metric === "leads" ? f.leadsBase    : metric === "bookings" ? f.booksBase    : f.salesBase,
      opt:      metric === "leads" ? f.leadsOpt     : metric === "bookings" ? f.booksOpt     : f.salesOpt,
    }));

    return [...actualPoints, ...forecastPoints];
  }, [result, metric]);

  const splitIdx = (result?.actuals?.length ?? 0) - 1;
  const splitLabel = chartData[splitIdx]?.label;

  const summary = result?.summary;

  async function handleSaveForecast() {
    if (!result) return;
    try {
      await saveFcFn({
        scenario,
        periodWeeks: 12,
        dealValue:   dv,
        currency,
        buckets:     result.forecast as any,
        summary:     result.summary,
      });
      setSaveMsg("Forecast saved!");
      setTimeout(() => setSaveMsg(null), 3000);
      qc.invalidateQueries({ queryKey: ["growthmind-saved-forecasts"] });
    } catch (e: any) {
      setSaveMsg("Error: " + e.message);
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true);
    try {
      await saveSetFn({ dealValue: dv, currency });
      setSaveMsg("Settings saved!");
      setTimeout(() => setSaveMsg(null), 3000);
      qc.invalidateQueries({ queryKey: ["growthmind-forecast-raw"] });
    } catch (e: any) {
      setSaveMsg("Error: " + e.message);
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-5xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
              Revenue Forecast
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              90-day actuals + 12-week linear projection · conservative / base / optimistic
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              onClick={() => setShowConfig(v => !v)}
            >
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              Config
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["growthmind-forecast-raw"] })}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Config panel */}
        {showConfig && (
          <div className="mb-5 rounded-xl border border-white/[0.06] bg-card/60 p-4">
            <p className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-emerald-400" />
              Forecast Configuration
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">Average Deal Value</Label>
                <Input
                  type="number" min={0} step={100}
                  placeholder="e.g. 1500"
                  value={dealValue}
                  onChange={e => setDealValue(e.target.value)}
                  className="h-8 text-xs w-36"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Currency Symbol</Label>
                <Input
                  placeholder="£ or $ or €"
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className="h-8 text-xs w-24"
                  maxLength={5}
                />
              </div>
              <Button
                size="sm"
                onClick={handleSaveSettings}
                disabled={savingSettings}
              >
                {savingSettings ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                Save settings
              </Button>
              {saveMsg && (
                <span className={cn("text-xs font-medium", saveMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400")}>
                  {saveMsg}
                </span>
              )}
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm">Loading forecast data…</span>
          </div>
        ) : (
          <div className="space-y-5">

            {/* Scenario toggle + metric tabs */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {/* Metric tabs */}
              <div className="flex gap-1 p-1 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                {(["leads", "bookings", "sales"] as MetricKey[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setMetric(m)}
                    className={cn(
                      "px-3 py-1 rounded-md text-xs font-medium transition-all",
                      metric === m
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>

              {/* Scenario toggle */}
              <div className="flex gap-1 p-1 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                {([
                  { key: "conservative", label: "Conservative", color: SCENARIO_COLORS.conservative },
                  { key: "base",         label: "Base",         color: SCENARIO_COLORS.base },
                  { key: "optimistic",   label: "Optimistic",   color: SCENARIO_COLORS.optimistic },
                ] as { key: Scenario; label: string; color: string }[]).map(s => (
                  <button
                    key={s.key}
                    onClick={() => setScenario(s.key)}
                    className={cn(
                      "px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5",
                      scenario === s.key
                        ? "bg-white/[0.08] text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full shrink-0"
                      style={{ background: s.color, opacity: scenario === s.key ? 1 : 0.4 }}
                    />
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveForecast}
                  disabled={!result}
                >
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  Save {scenario}
                </Button>
                {saveMsg && !showConfig && (
                  <span className={cn("text-xs font-medium", saveMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400")}>
                    {saveMsg}
                  </span>
                )}
              </div>
            </div>

            {/* Chart */}
            <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {METRIC_LABELS[metric]} — actuals (solid) vs forecast (dashed)
              </p>
              {chartData.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                  Not enough historical data to generate a forecast. Add more leads to get started.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "rgba(255,255,255,0.4)" }}
                      tickLine={false}
                      interval={Math.floor(chartData.length / 8)}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<CustomTooltip metric={metric} />} />
                    <Legend
                      wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                      formatter={(value: string) => (
                        <span style={{ color: "rgba(255,255,255,0.6)" }}>{value}</span>
                      )}
                    />
                    {splitLabel && (
                      <ReferenceLine
                        x={splitLabel}
                        stroke="rgba(255,255,255,0.15)"
                        strokeDasharray="4 2"
                        label={{ value: "Today", position: "top", fontSize: 9, fill: "rgba(255,255,255,0.4)" }}
                      />
                    )}

                    <Line
                      type="monotone" dataKey="actual" name="Actual"
                      stroke="#10b981" strokeWidth={2} dot={false}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone" dataKey="conserv" name="Conservative"
                      stroke={SCENARIO_COLORS.conservative}
                      strokeWidth={scenario === "conservative" ? 2.5 : 1}
                      strokeOpacity={scenario === "conservative" ? 1 : 0.35}
                      strokeDasharray="5 3" dot={false} connectNulls={false}
                    />
                    <Line
                      type="monotone" dataKey="base" name="Base"
                      stroke={SCENARIO_COLORS.base}
                      strokeWidth={scenario === "base" ? 2.5 : 1}
                      strokeOpacity={scenario === "base" ? 1 : 0.35}
                      strokeDasharray="5 3" dot={false} connectNulls={false}
                    />
                    <Line
                      type="monotone" dataKey="opt" name="Optimistic"
                      stroke={SCENARIO_COLORS.optimistic}
                      strokeWidth={scenario === "optimistic" ? 2.5 : 1}
                      strokeOpacity={scenario === "optimistic" ? 1 : 0.35}
                      strokeDasharray="5 3" dot={false} connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 12-week summary cards */}
            {summary && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-3">
                  12-Week Projection Summary
                </p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <SummaryCard
                    label="Leads"
                    icon={Users}
                    currency={currency}
                    values={{ conservative: summary.leadsConserv, base: summary.leadsBase, optimistic: summary.leadsOpt }}
                  />
                  <SummaryCard
                    label="Appointments"
                    icon={CalendarCheck}
                    currency={currency}
                    values={{ conservative: summary.booksConserv, base: summary.booksBase, optimistic: summary.booksOpt }}
                  />
                  <SummaryCard
                    label="Sales"
                    icon={BarChart3}
                    currency={currency}
                    values={{ conservative: summary.salesConserv, base: summary.salesBase, optimistic: summary.salesOpt }}
                  />
                  <SummaryCard
                    label="Revenue"
                    icon={DollarSign}
                    currency={currency}
                    showCurrency
                    values={{ conservative: summary.revConserv, base: summary.revBase, optimistic: summary.revOpt }}
                  />
                </div>
                {dv === 0 && (
                  <p className="text-[11px] text-amber-400 mt-2 flex items-center gap-1">
                    <Settings2 className="h-3 w-3" />
                    Set your average deal value in Config to see revenue projections.
                  </p>
                )}
              </div>
            )}

            {/* Saved forecasts */}
            <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <p className="text-sm font-semibold">Saved Forecasts</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Historical forecast snapshots</p>
              </div>
              <div className="p-3 space-y-2">
                {histLoading ? (
                  <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading…</span>
                  </div>
                ) : (histData?.forecasts ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No saved forecasts yet. Click <em>Save forecast</em> to track projections over time.
                  </p>
                ) : (
                  histData!.forecasts.map(fc => (
                    <SavedForecastRow key={fc.id} fc={fc} />
                  ))
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
