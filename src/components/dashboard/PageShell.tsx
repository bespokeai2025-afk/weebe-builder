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
    <>
      <div className="border-b border-white/[0.06] px-6 py-3">
        <h1 className="text-sm font-medium text-foreground">{title}</h1>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 shadow-glow">
              <Icon className="h-4 w-4 text-primary-foreground" />
            </div>
          )}
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {onRefresh && (
            <Button size="sm" variant="secondary" onClick={onRefresh} className="h-8 bg-primary/15 text-primary hover:bg-primary/25">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

const toneStyles = {
  primary: "from-[#7C5CFF] to-[#5B3CE0] shadow-[0_-14px_30px_-14px_rgba(124,92,255,0.45)]",
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
      <div className={cn("absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r", toneStyles[tone].split(" ").slice(0, 2).join(" "))} />
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</p>
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
