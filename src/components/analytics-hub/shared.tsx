/**
 * Shared primitives for the Analytics Centre BI hub (tabbed Analytics page).
 *
 * Holds the chart palette, small chart/panel building blocks, the shared
 * date-range filter, entitlement-driven tab locking (upgrade prompt) and cents
 * → £ formatters. Every tab component in this folder builds on these.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
} from "recharts";
import { Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { getMyEntitlements } from "@/lib/packages/packages.functions";
import { FEATURE_LABELS } from "@/lib/packages/packages.shared";

// ── Palette (mirrors the Call Analytics tab) ──────────────────────────────────
export const CHART = {
  primary:     "#8B5CF6",
  primaryGlow: "#A78BFA",
  accent:      "#22D3EE",
  success:     "#22C55E",
  warning:     "#F59E0B",
  danger:      "#EF4444",
  neutral:     "#64748B",
  pink:        "#EC4899",
  orange:      "#F97316",
  grid:        "rgba(255,255,255,0.06)",
  axis:        "rgba(255,255,255,0.40)",
};

export const DONUT_COLORS = [CHART.primary, CHART.accent, CHART.success, CHART.warning, CHART.danger, CHART.pink, CHART.orange, CHART.neutral];
export const SENTIMENT_COLORS = [CHART.success, CHART.warning, CHART.danger, CHART.neutral];

// ── Shared date-range filter ──────────────────────────────────────────────────
export interface AnalyticsFilterState {
  dateFilter: string;
  customStart: string | null;
  customEnd: string | null;
  campaignId: string | null;
  agentId: string | null;
  source: string | null;
}

export const DATE_FILTERS: Array<{ key: string; label: string }> = [
  { key: "today",      label: "Today" },
  { key: "yesterday",  label: "Yesterday" },
  { key: "7d",         label: "7d" },
  { key: "30d",        label: "30d" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "custom",     label: "Custom" },
];

/** Serializable payload shared across every analytics-hub server fn call. */
export function filterPayload(f: AnalyticsFilterState) {
  return {
    dateFilter: f.dateFilter as import("@/lib/analytics-hub/analytics-hub.server").AnalyticsDateFilter,
    customStart: f.dateFilter === "custom" ? f.customStart : null,
    customEnd: f.dateFilter === "custom" ? f.customEnd : null,
    campaignId: f.campaignId ?? null,
    agentId: f.agentId ?? null,
    source: f.source ?? null,
  };
}

/** Stable key fragment for react-query keys (includes the filter). */
export function filterKey(f: AnalyticsFilterState) {
  return `${f.dateFilter}:${f.customStart ?? ""}:${f.customEnd ?? ""}:${f.campaignId ?? ""}:${f.agentId ?? ""}:${f.source ?? ""}`;
}

export function useAnalyticsFilter(initial = "30d") {
  const [state, setState] = useState<AnalyticsFilterState>({
    dateFilter: initial, customStart: null, customEnd: null,
    campaignId: null, agentId: null, source: null,
  });
  return { state, setState };
}

export function DateRangeControl({
  value,
  onChange,
}: {
  value: AnalyticsFilterState;
  onChange: (next: AnalyticsFilterState) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-lg border border-white/[0.06] bg-card/40 p-1">
        {DATE_FILTERS.map((r) => (
          <Button
            key={r.key}
            size="sm"
            variant={value.dateFilter === r.key ? "secondary" : "ghost"}
            onClick={() => onChange({ ...value, dateFilter: r.key })}
            className={value.dateFilter === r.key ? "bg-primary/20 text-primary" : ""}
          >
            {r.label}
          </Button>
        ))}
      </div>
      {value.dateFilter === "custom" && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={value.customStart ?? ""}
            onChange={(e) => onChange({ ...value, customStart: e.target.value || null })}
            className="rounded-lg border border-white/[0.1] bg-card/60 px-2.5 py-1.5 text-xs text-foreground"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={value.customEnd ?? ""}
            onChange={(e) => onChange({ ...value, customEnd: e.target.value || null })}
            className="rounded-lg border border-white/[0.1] bg-card/60 px-2.5 py-1.5 text-xs text-foreground"
          />
        </div>
      )}
    </div>
  );
}

// ── Shared compact FilterBar (agent / campaign / source + date range) ─────────
export interface AnalyticsFilterOption { id: string; name: string }
export interface AnalyticsFilterOptions {
  agents: AnalyticsFilterOption[];
  campaigns: AnalyticsFilterOption[];
  sources: Array<{ value: string; label: string }>;
}

const SELECT_CLS =
  "rounded-lg border border-white/[0.1] bg-card/60 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40";

/** Which of the shared selects a tab actually honors server-side. */
export interface FilterBarSupports { agent?: boolean; campaign?: boolean; source?: boolean }

export function FilterBar({
  value,
  onChange,
  options,
  loading,
  supports,
}: {
  value: AnalyticsFilterState;
  onChange: (next: AnalyticsFilterState) => void;
  options?: AnalyticsFilterOptions | null;
  loading?: boolean;
  /** Only render selects the current tab honors server-side (default: all). */
  supports?: FilterBarSupports;
}) {
  const agents = options?.agents ?? [];
  const campaigns = options?.campaigns ?? [];
  const sources = options?.sources ?? [];
  const show = { agent: supports?.agent !== false, campaign: supports?.campaign !== false, source: supports?.source !== false };
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {show.agent && (
        <select
          className={SELECT_CLS}
          value={value.agentId ?? ""}
          disabled={loading}
          onChange={(e) => onChange({ ...value, agentId: e.target.value || null })}
        >
          <option value="">All agents</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      {show.campaign && (
        <select
          className={SELECT_CLS}
          value={value.campaignId ?? ""}
          disabled={loading}
          onChange={(e) => onChange({ ...value, campaignId: e.target.value || null })}
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {show.source && (
        <select
          className={SELECT_CLS}
          value={value.source ?? ""}
          disabled={loading}
          onChange={(e) => onChange({ ...value, source: e.target.value || null })}
        >
          <option value="">All sources</option>
          {sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      )}
      <DateRangeControl value={value} onChange={onChange} />
    </div>
  );
}

// ── Entitlements ──────────────────────────────────────────────────────────────
export function useAnalyticsEntitlements() {
  const q = useQuery({
    queryKey: ["my-entitlements"],
    queryFn: () => getMyEntitlements(),
    staleTime: 30_000,
    retry: false,
    throwOnError: false,
  });
  const features = ((q.data as any)?.entitlements?.features ?? null) as Record<string, boolean> | null;
  const packageName = (q.data as any)?.entitlements?.packageName ?? "";
  // Fail open while loading (backend still enforces every call).
  const has = (key: string) => features == null || features[key] !== false;
  return { has, packageName, features, loading: q.isLoading };
}

// ── Upgrade prompt (tab-level lock) ───────────────────────────────────────────
export function LockedTab({ feature, packageName }: { feature: string; packageName?: string }) {
  const label = (FEATURE_LABELS as Record<string, string>)[feature] ?? feature;
  return (
    <div className="px-6 pt-8">
      <div className="mx-auto max-w-md rounded-2xl border border-primary/20 bg-primary/[0.06] p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
          <Lock className="h-6 w-6 text-primary" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">{label} is locked</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {label} is not included in your current package{packageName ? ` (${packageName})` : ""}. Upgrade to unlock this
          analytics view.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button asChild>
            <Link to="/billing" search={{ checkout: undefined }}>View Packages</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Chart / panel building blocks ─────────────────────────────────────────────
export function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/[0.1] bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {label != null && <p className="mb-1 font-medium text-foreground">{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? p.fill }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="font-medium tabular-nums text-foreground/90">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function NoData() {
  return <p className="py-8 text-center text-xs text-muted-foreground">No data in this range.</p>;
}

export function ChartCard({
  title,
  icon: Icon,
  color,
  children,
  right,
}: {
  title: string;
  icon: React.ElementType;
  color: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-card/50 p-4 backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5" style={{ color }} />
          <h3 className="text-xs font-semibold uppercase tracking-[0.10em] text-muted-foreground">{title}</h3>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function MetricTile({
  label,
  value,
  sub,
  color = CHART.primary,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-card/50 p-4 backdrop-blur-sm">
      <div className="mb-2 flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5" style={{ color }} />}
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      </div>
      <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function CompactDonut({
  data,
  colors = DONUT_COLORS,
  centerLabel,
  centerValue,
}: {
  data: { name: string; value: number }[];
  colors?: string[];
  centerLabel: string;
  centerValue: number | string;
}) {
  const filtered = data.filter((d) => d.value > 0);
  if (filtered.length === 0) return <NoData />;
  return (
    <div className="w-full">
      <div className="relative h-44 w-full">
        <ResponsiveContainer>
          <PieChart>
            <Tooltip content={<ChartTooltip />} />
            <Pie data={filtered} dataKey="value" nameKey="name" innerRadius={52} outerRadius={76} paddingAngle={2} stroke="none">
              {filtered.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{centerLabel}</span>
          <span className="text-xl font-bold tabular-nums">{centerValue}</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1.5">
        {filtered.map((d, i) => (
          <div key={d.name} className="flex items-center gap-1.5 text-[10px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colors[i % colors.length] }} />
            <span className="text-muted-foreground">{d.name}</span>
            <span className="font-medium tabular-nums text-foreground/90">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InsightCard({
  tone = "primary",
  icon: Icon = Sparkles,
  title,
  children,
}: {
  tone?: "primary" | "success" | "warning" | "danger";
  icon?: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  const toneClass = {
    primary: "border-primary/20 bg-primary/[0.06] text-primary",
    success: "border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-300",
    warning: "border-amber-500/20 bg-amber-500/[0.08] text-amber-300",
    danger:  "border-red-500/20 bg-red-500/[0.08] text-red-300",
  }[tone];
  return (
    <div className={cn("rounded-2xl border p-4", toneClass)}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      <div className="text-sm text-foreground/80">{children}</div>
    </div>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────
export function gbp(cents: number | null | undefined): string {
  const n = Number(cents ?? 0) / 100;
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: n >= 1000 ? 0 : 2 });
}

export function pct(n: number | null | undefined): string {
  return `${Math.round(Number(n ?? 0) * 10) / 10}%`;
}

export function fmtInt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-GB");
}

export function fmtSecs(s: number | null | undefined): string {
  const sec = Math.round(Number(s ?? 0));
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

export function shortDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Amber inline error banner reused by every tab. */
export function TabError({ message }: { message: string }) {
  return (
    <div className="mx-6 mt-4 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <Lock className="h-4 w-4" />
      <span>{message}</span>
    </div>
  );
}

/** WBAH "not available" empty state for campaign-style tabs. */
export function useWbahHidden(error: string | null | undefined) {
  return useMemo(() => error === "not_available_for_wbah", [error]);
}
