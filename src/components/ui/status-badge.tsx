import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Shared status pill — one source of truth for status/severity colours.
 *
 * Previously every screen re-implemented its own status→colour mapping
 * (leads.index.tsx alone had 5+). This consolidates them on a single tone
 * system that passes WCAG AA contrast in both themes:
 *
 *   - light mode uses the -600 shade (e.g. text-emerald-600) for ≥4.5:1
 *   - dark mode uses the -400 shade, preserving the frozen dark palette
 *
 * Usage:
 *   <StatusBadge tone="success">Connected</StatusBadge>
 *   <StatusBadge tone="warning">Pending</StatusBadge>
 *   <StatusBadge tone="danger">Cancelled</StatusBadge>
 *   <StatusBadge tone="info">In progress</StatusBadge>
 *   <StatusBadge tone="neutral">Draft</StatusBadge>
 *   <StatusBadge tone="violet" icon={<Sparkles />}>AI</StatusBadge>
 */
const statusBadgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize whitespace-nowrap border",
  {
    variants: {
      tone: {
        success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
        warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25",
        danger: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25",
        info: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25",
        neutral: "bg-muted text-muted-foreground border-border",
        sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25",
        cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/25",
        violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25",
        purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/25",
        fuchsia: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/25",
        pink: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/25",
        orange: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25",
        slate: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/25",
      },
      size: {
        sm: "px-1.5 py-0 text-[10px]",
        md: "px-2 py-0.5 text-[11px]",
        lg: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: {
      tone: "neutral",
      size: "md",
    },
  },
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {
  icon?: React.ReactNode;
}

function StatusBadge({ tone, size, icon, className, children, ...props }: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ tone, size }), className)} {...props}>
      {icon}
      {children}
    </span>
  );
}

export { StatusBadge, statusBadgeVariants };