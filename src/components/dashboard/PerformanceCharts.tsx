import { useId, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ArrowUpRight, BarChart3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CHART } from "./chart-model";

export function DataState({ title, detail, retry, loading = false }: {
  title: string; detail?: string; retry?: () => void; loading?: boolean;
}) {
  return <div role="status" className="viz-state">
    <span className="viz-state-icon"><Activity className="h-5 w-5" aria-hidden="true" /></span>
    <p className="text-sm font-semibold text-foreground">{title}</p>
    {detail && <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{detail}</p>}
    {loading && <div className="mt-2 h-1.5 w-32 rounded-full skeleton-shimmer" aria-hidden="true" />}
    {retry && <Button variant="outline" size="sm" onClick={retry} className="mt-2 gap-2"><RefreshCw className="h-3.5 w-3.5" />Try again</Button>}
  </div>;
}

export function MetricSummary({ label, value, detail, color = CHART.primary, action }: {
  label: string; value: string | number; detail?: string; color?: string; action?: ReactNode;
}) {
  return <div className="viz-metric" style={{ "--series-color": color } as React.CSSProperties}>
    <div className="flex items-center justify-between gap-2"><p className="text-sm text-muted-foreground">{label}</p><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} /></div>
    <p className="mt-3 break-words text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</p>
    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{detail}</span>{action}</div>
  </div>;
}

function PlotTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-border bg-popover px-3 py-2.5 text-sm text-popover-foreground shadow-elevated">
    <p className="mb-1 text-xs text-muted-foreground">{label}</p>
    <p className="font-semibold tabular-nums">{Number(payload[0].value).toLocaleString()} <span className="font-normal">{payload[0].name}</span></p>
  </div>;
}

export function TrendPlot({ title, subtitle, data, unit = "calls", color = CHART.primary, controls, state, note }: {
  title: string; subtitle: string; data: { date: string; count: number }[];
  unit?: string; color?: string; controls?: ReactNode; state?: ReactNode; note?: string;
}) {
  const [view, setView] = useState<"line" | "bar">("line");
  const id = useId().replace(/:/g, "");
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const hasData = data.some(d => d.count > 0);
  const axes = <>
    <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 5" />
    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={12} minTickGap={24} tick={{ fill: CHART.axis, fontSize: 12 }} tickFormatter={date => /^\d{4}-/.test(date) ? date.slice(5) : date} />
    <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fill: CHART.axis, fontSize: 12 }} />
    <Tooltip content={<PlotTooltip />} cursor={{ stroke: CHART.axis, strokeDasharray: "4 4", fill: "var(--muted)", fillOpacity: 0.3 }} />
  </>;
  return <section className="viz-panel viz-hero" style={{ "--series-color": color } as React.CSSProperties} aria-label={title}>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-base font-semibold tracking-tight">{title}</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{subtitle}</p></div>
      <div className="flex flex-wrap items-center gap-2">{controls}<div role="group" aria-label={`${title} chart type`} className="viz-switch">
        <button type="button" aria-pressed={view === "line"} onClick={() => setView("line")}><Activity className="h-3.5 w-3.5" />Line</button>
        <button type="button" aria-pressed={view === "bar"} onClick={() => setView("bar")}><BarChart3 className="h-3.5 w-3.5" />Bar</button>
      </div></div>
    </header>
    {state || (!hasData ? <DataState title={`No ${unit} in this period`} detail="Try a wider date range. Your activity will appear here as it arrives." /> : <>
      <div className="mb-3 mt-6 flex items-baseline gap-2"><span className="text-3xl font-semibold tracking-tight tabular-nums">{total.toLocaleString()}</span><span className="text-sm text-muted-foreground">{unit} in this view</span></div>
      <div className="viz-plot h-[240px] min-w-0 sm:h-[280px]" role="img" aria-label={`${title}: ${total} ${unit}. Exact values are available in View chart data below.`}>
        <ResponsiveContainer width="100%" height="100%">
          {view === "line" ? <AreaChart accessibilityLayer data={data} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
            <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.22} /><stop offset="100%" stopColor={color} stopOpacity={0.01} /></linearGradient></defs>
            {axes}<Area className="viz-line" type="linear" dataKey="count" name={unit} stroke={color} strokeWidth={2.5} fill={`url(#${id}-fill)`} dot={data.length === 1 ? { r: 4 } : false} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 3 }} isAnimationActive={false} />
          </AreaChart> : <BarChart accessibilityLayer data={data} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
            <defs><linearGradient id={`${id}-bars`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} /><stop offset="100%" stopColor={color} stopOpacity={0.55} /></linearGradient></defs>
            {axes}<Bar className="viz-bars" dataKey="count" name={unit} fill={`url(#${id}-bars)`} radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={false} />
          </BarChart>}
        </ResponsiveContainer>
      </div>
      <details className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View chart data</summary><div className="mt-3 max-h-52 overflow-auto"><table className="w-full text-left"><caption className="sr-only">{title}</caption><thead><tr><th scope="col" className="py-2">Date</th><th scope="col" className="text-right">{unit}</th></tr></thead><tbody>{data.map(d => <tr key={d.date} className="border-t border-border/50"><th scope="row" className="py-2 font-normal">{d.date}</th><td className="text-right tabular-nums">{d.count.toLocaleString()}</td></tr>)}</tbody></table></div></details>
    </>)}
    {note && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{note}</p>}
  </section>;
}

export function RankedBars({ title, subtitle, rows, color = CHART.accent, footer }: {
  title: string; subtitle: string; rows: { name: string; value: number; color?: string }[]; color?: string; footer?: ReactNode;
}) {
  const max = Math.max(1, ...rows.map(row => row.value));
  return <section className="viz-panel"><header className="mb-6"><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{subtitle}</p></header>
    <ul className="space-y-5">{rows.map((row, i) => <li key={`${row.name}-${i}`}>
      <div className="mb-2 flex items-baseline justify-between gap-4 text-sm"><span className="min-w-0 break-words text-muted-foreground">{row.name}</span><span className="shrink-0 font-semibold tabular-nums">{row.value.toLocaleString()}</span></div>
      <div aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-muted/60"><div className="viz-rank-bar h-full rounded-full" style={{ width: `${row.value / max * 100}%`, background: row.color || color }} /></div>
    </li>)}</ul>
    {footer && <div className="mt-6 border-t border-border/60 pt-4 text-xs text-muted-foreground">{footer}</div>}
  </section>;
}
