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
      <div className="border-b border-white/[0.06] px-8 py-5">
        <h1 className="text-base font-medium text-foreground">{title}</h1>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 px-8 pt-8">
        <div className="flex items-center gap-4">
          {Icon && (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-glow">
              <Icon className="h-7 w-7 text-primary-foreground" />
            </div>
          )}
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {onRefresh && (
            <Button variant="secondary" onClick={onRefresh} className="bg-primary/15 text-primary hover:bg-primary/25">
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
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
    <div className={cn("relative overflow-hidden rounded-2xl border border-white/[0.06] bg-card/60 p-5 backdrop-blur", toneStyles[tone].split(" ").slice(2).join(" "))}>
      <div className={cn("absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r", toneStyles[tone].split(" ").slice(0, 2).join(" "))} />
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-4xl font-bold tracking-tight text-foreground tabular-nums">{value}</p>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PanelCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-white/[0.06] bg-card/50 p-5 backdrop-blur", className)}>
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
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-card/30 px-6 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{message}</p>
    </div>
  );
}