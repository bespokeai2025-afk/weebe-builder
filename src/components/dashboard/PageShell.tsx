import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Shared compact page shell for Calls / Leads / Data dashboard routes */
export function DashboardPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("w-full min-w-0 max-w-full space-y-3 px-3 py-3 text-sm leading-snug sm:px-4", className)}>
      {children}
    </div>
  );
}

/** Sticky left columns for wide WBAH tables (layout-only) */
export const stickyHead =
  "sticky z-20 bg-card/95 backdrop-blur-sm after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-white/[0.08]";
export const stickyCell =
  "sticky z-10 bg-card/95 backdrop-blur-sm group-hover:bg-[#141a24] after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-white/[0.06]";

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
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-white/[0.06] sm:px-4">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[10px] text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {actions}
        {onRefresh && (
          <Button size="sm" variant="ghost" onClick={onRefresh} className="h-7 gap-1 text-xs px-2.5">
            <RefreshCw className="h-3 w-3" /> Refresh
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
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-white/[0.06] bg-card/60 px-2.5 py-2 backdrop-blur">
      <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", iconBg)}>
        <Icon className={cn("h-3 w-3", iconColor)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground leading-none">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-bold leading-none tabular-nums text-foreground">{value}</p>
        {hint && <p className="mt-0.5 text-[9px] text-muted-foreground leading-tight">{hint}</p>}
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
    <div className="min-w-0 rounded-lg border border-dashed border-white/[0.08] bg-card/30 px-2.5 py-2">
      <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-bold leading-none tabular-nums">{value}</p>
      {hint && <p className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{hint}</p>}
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
    <div className={cn("relative min-w-0 overflow-hidden rounded-xl border border-white/[0.06] bg-card/60 p-3 backdrop-blur", toneStyles[tone].split(" ").slice(2).join(" "))}>
      <div className={cn("absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r", toneStyles[tone].split(" ").slice(0, 2).join(" "))} />
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-bold tracking-tight text-foreground tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PanelCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-xl border border-white/[0.06] bg-card/50 p-3 backdrop-blur sm:p-4", className)}>
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
    <th className={cn("px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground", className)}>
      {children}
    </th>
  );
}

/* ── Call summary cell with hover tooltip ── */
export function SummaryTooltip({
  text,
  lines = 2,
}: {
  text: string | null | undefined;
  lines?: 1 | 2 | 3;
}) {
  if (!text) return <span className="text-muted-foreground/40">—</span>;
  const clampClass = lines === 1 ? "line-clamp-1" : lines === 3 ? "line-clamp-3" : "line-clamp-2";
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("block cursor-help leading-relaxed", clampClass)}>{text}</span>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          className="max-w-sm rounded-lg border border-white/[0.08] bg-[#111827] p-3 text-xs leading-relaxed text-foreground shadow-2xl"
        >
          <p className="whitespace-pre-wrap">{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
