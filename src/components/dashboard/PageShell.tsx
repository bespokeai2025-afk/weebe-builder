import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  onRefresh,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  onRefresh?: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-white/[0.06]">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        )}
        <div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {onRefresh && (
          <Button size="sm" variant="ghost" onClick={onRefresh} className="h-8 gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── Compact KPI card: icon left, label+value stacked right (~64px tall) ── */
export function KpiCard({
  label,
  value,
  icon: Icon,
  delta,
  deltaUp,
  iconBg = "bg-blue-500/15",
  iconColor = "text-blue-400",
  hint,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  delta?: string;
  deltaUp?: boolean;
  iconBg?: string;
  iconColor?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-card/60 px-4 py-3 backdrop-blur">
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", iconBg)}>
        <Icon className={cn("h-4 w-4", iconColor)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground leading-none mb-1">
          {label}
        </p>
        <p className="text-xl font-bold leading-tight tabular-nums text-foreground">{value}</p>
        {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
      </div>
      {delta != null && (
        <span className={cn("text-xs font-semibold shrink-0", deltaUp ? "text-emerald-400" : "text-red-400")}>
          {delta}
        </span>
      )}
    </div>
  );
}

/* ── Mini KPI card — dashed border variant for secondary stats ── */
export function MiniKpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-white/[0.08] bg-card/30 px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

const toneStyles = {
  primary: "from-[#4f8cff] to-[#2563eb] shadow-[0_-14px_30px_-14px_rgba(79,140,255,0.35)]",
  success: "from-[#22C55E] to-[#16A34A] shadow-[0_-14px_30px_-14px_rgba(34,197,94,0.4)]",
  warning: "from-[#F5A524] to-[#D97706] shadow-[0_-14px_30px_-14px_rgba(245,165,36,0.4)]",
  danger: "from-[#EF4D5E] to-[#C2344A] shadow-[0_-14px_30px_-14px_rgba(239,77,94,0.4)]",
  info: "from-[#22D3EE] to-[#0EA5E9] shadow-[0_-14px_30px_-14px_rgba(34,211,238,0.4)]",
} as const;

export function StatCard({
  label,
  value,
  hint,
  tone = "primary",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: keyof typeof toneStyles;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-white/[0.06] bg-card/60 p-4 backdrop-blur", toneStyles[tone].split(" ").slice(2).join(" "))}>
      <div className={cn("absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r", toneStyles[tone].split(" ").slice(0, 2).join(" "))} />
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PanelCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-white/[0.06] bg-card/50 p-4 backdrop-blur", className)}>
      {children}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  message,
}: {
  icon: React.ElementType;
  title: string;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-card/30 px-6 py-10 text-center">
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

/* ── Standard table header row ── */
export function TableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-white/[0.06] bg-card/30">
        {children}
      </tr>
    </thead>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn("px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground", className)}>
      {children}
    </th>
  );
}
