import { AlertTriangle, Database, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode, ElementType } from "react";

export const MIGRATION_FILE = "SYSTEMMIND_DEPLOYMENT_PLANNER_MIGRATION.sql";

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("text-[10px] border border-white/[0.08] rounded px-1.5 py-0.5 text-muted-foreground", className)}>
      {children}
    </span>
  );
}

export function Section({ icon: Icon, title, children, className }: { icon: ElementType; title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-white/[0.06] bg-white/[0.02] p-3", className)}>
      <p className="text-[11px] font-semibold flex items-center gap-1.5 mb-2">
        <Icon className="h-3.5 w-3.5 text-sky-400" /> {title}
      </p>
      {children}
    </div>
  );
}

const RISK_CLS: Record<string, string> = {
  low: "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400",
  medium: "border-amber-500/30 bg-amber-500/[0.08] text-amber-400",
  high: "border-red-500/30 bg-red-500/[0.08] text-red-400",
};

export function RiskPill({ rating }: { rating: string | null | undefined }) {
  const r = rating ?? "medium";
  return (
    <span className={cn("text-[10px] rounded-full px-2 py-0.5 border capitalize", RISK_CLS[r] ?? RISK_CLS.medium)}>
      {r} risk
    </span>
  );
}

export function scoreColor(v: number): string {
  if (v >= 70) return "bg-emerald-400";
  if (v >= 45) return "bg-amber-400";
  return "bg-red-400";
}

export function ScoreBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="w-full">
      {label && (
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[10px] text-muted-foreground/70">{label}</span>
          <span className="text-[10px] text-foreground/80 tabular-nums">{value}</span>
        </div>
      )}
      <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", scoreColor(value))} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "sky" | "emerald" | "amber" | "red" }) {
  const toneCls =
    tone === "emerald" ? "text-emerald-400" : tone === "amber" ? "text-amber-400" : tone === "red" ? "text-red-400" : "text-sky-400";
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50">{label}</p>
      <p className={cn("text-xl font-semibold mt-1 tabular-nums", toneCls)}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{hint}</p>}
    </div>
  );
}

/** Shown when the manual migration has not been applied yet. */
export function MigrationNotice({ what }: { what?: string }) {
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4 flex items-start gap-3">
      <Database className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-amber-200">Database migration required</p>
        <p className="text-xs text-muted-foreground mt-1">
          {what ?? "This feature"} needs its tables. Apply{" "}
          <code className="text-amber-300 bg-amber-500/10 px-1 py-0.5 rounded text-[11px]">supabase/migrations/{MIGRATION_FILE}</code>{" "}
          in the Supabase SQL Editor (Dashboard → SQL Editor → paste → Run), then reload this page.
        </p>
      </div>
    </div>
  );
}

/** The recurring "descriptive / plan-only, nothing executes" trust banner. */
export function ExecutionBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/[0.05] p-3">
      <ShieldCheck className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
      <p className="text-[11px] text-muted-foreground">
        {children ?? (
          <>
            SystemMind Intelligence is <span className="text-foreground/90">descriptive only</span>. It assembles plans and
            scores from existing knowledge — it never deploys, provisions, or executes anything. Autonomous deployment is
            disabled; a human operator carries out every step.
          </>
        )}
      </p>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint }: { icon: ElementType; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/40 mb-2" />
      <p className="text-sm text-muted-foreground">{title}</p>
      {hint && <p className="text-[11px] text-muted-foreground/60 mt-1 max-w-sm">{hint}</p>}
    </div>
  );
}

export function InlineError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-500/25 bg-red-500/[0.06] p-3 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
      <p className="text-[11px] text-red-300">{message}</p>
    </div>
  );
}
