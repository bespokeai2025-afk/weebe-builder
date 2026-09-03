import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Shared BuzzChat chrome — matches Webee theme tokens, not a new palette. */
export const BUZZ_SELECT = "h-9 text-sm";
export const BUZZ_SEARCH = "h-9 pl-9 text-sm";

export function BuzzchatFilterChip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
      {count != null && (
        <span
          className={cn(
            "rounded-full px-1.5 py-px text-[10px] tabular-nums",
            active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function BuzzchatEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/40">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function BuzzchatThreadSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-border/60" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="space-y-2 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </li>
      ))}
    </ul>
  );
}

export function BuzzchatTableSkeleton({
  rows = 8,
  cols = 6,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="space-y-2 p-3" aria-hidden>
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-2">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className={cn("h-8 flex-1", j === 0 && "flex-[1.4]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function BuzzchatFieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}
