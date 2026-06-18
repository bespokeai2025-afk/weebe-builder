/**
 * Webuyanyhouse workspace — shared UI shell components.
 * Used across all /wbah/* pages for consistent layout and style.
 */
import { cn } from "@/lib/utils";
import { AlertTriangle, Loader2 } from "lucide-react";

// ── Page container ─────────────────────────────────────────────────────────────

export function WbahPage({
  title, subtitle, actions, children, className,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-5 p-6 min-h-0", className)}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

// ── Card ───────────────────────────────────────────────────────────────────────

export function WbahCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-gray-900 border border-gray-800 rounded-xl", className)}>
      {children}
    </div>
  );
}

// ── KPI card ───────────────────────────────────────────────────────────────────

export function KpiCard({
  label, value, sub, icon: Icon, color = "text-emerald-400",
}: {
  label: string;
  value: string | number | null | undefined;
  sub?: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <WbahCard className="p-4 flex items-start gap-3">
      <div className={cn("p-2 rounded-lg bg-gray-800 shrink-0")}>
        <Icon className={cn("h-4 w-4", color)} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-white truncate">
          {value == null ? "—" : value}
        </p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </WbahCard>
  );
}

// ── Loading state ─────────────────────────────────────────────────────────────

export function WbahLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-20 text-gray-500 gap-2">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

// ── Error state ────────────────────────────────────────────────────────────────

export function WbahError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-red-500/5 border border-red-500/20 p-4">
      <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium text-red-400">API Error</p>
        <p className="text-xs text-red-300/70 mt-0.5">{message}</p>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

export function WbahEmpty({ label = "No records found" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-gray-600 text-sm">
      {label}
    </div>
  );
}

// ── Table wrappers ─────────────────────────────────────────────────────────────

export function WbahTable({
  headers, children, className,
}: {
  headers: string[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border border-gray-800", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/50">
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-gray-900 divide-y divide-gray-800/60">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function WbahTr({
  children, onClick, className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "transition-colors",
        onClick && "cursor-pointer hover:bg-gray-800/50",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function WbahTd({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={cn("px-4 py-3 text-gray-300 whitespace-nowrap", className)}>
      {children}
    </td>
  );
}

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active:   "bg-emerald-500/20 text-emerald-400",
  paused:   "bg-yellow-500/20 text-yellow-400",
  pending:  "bg-yellow-500/20 text-yellow-400",
  completed:"bg-blue-500/20 text-blue-400",
  failed:   "bg-red-500/20 text-red-400",
  positive: "bg-emerald-500/20 text-emerald-400",
  neutral:  "bg-gray-500/20 text-gray-400",
  negative: "bg-red-500/20 text-red-400",
  new:      "bg-purple-500/20 text-purple-400",
};

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="text-gray-600">—</span>;
  const lower = status.toLowerCase();
  const cls = Object.entries(STATUS_COLORS).find(([k]) => lower.includes(k))?.[1]
    ?? "bg-gray-700/50 text-gray-400";
  return (
    <span className={cn("inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full capitalize", cls)}>
      {status}
    </span>
  );
}

// ── Sentiment badge ────────────────────────────────────────────────────────────

export function SentimentBadge({ sentiment }: { sentiment?: string | null }) {
  if (!sentiment) return <span className="text-gray-600">—</span>;
  const s = sentiment.toLowerCase();
  const cls = s === "positive"
    ? "text-emerald-400"
    : s === "negative"
    ? "text-red-400"
    : "text-gray-400";
  return <span className={cn("text-xs font-medium capitalize", cls)}>{sentiment}</span>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function safeArr(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const vals = Object.values(v as object);
    if (vals.length && Array.isArray(vals[0])) return vals[0] as any[];
  }
  return [];
}

export function safeNum(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || fallback;
  if (v && typeof v === "object") {
    const keys = ["total", "count", "value", "amount", "minutes"];
    for (const k of keys) {
      const val = (v as any)[k];
      if (typeof val === "number") return val;
      if (typeof val === "string") return parseFloat(val) || fallback;
    }
  }
  return fallback;
}

export function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }); }
  catch { return d; }
}
