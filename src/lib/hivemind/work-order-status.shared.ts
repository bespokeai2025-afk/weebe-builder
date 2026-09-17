// Single source of truth for work-order status badge styling. Previously
// copy-pasted verbatim across hivemind.tasks.tsx, hivemind.work-orders.tsx,
// hivemind.work-orders_.$id.tsx and ActiveWorkOrdersWidget.tsx (WEBEE-UIUX-AUDIT.md
// F-05) — consolidated here with the exact same values, no color changes.
// Shared (client-safe): no server imports.

export const WO_STATUS_STYLES: Record<string, string> = {
  open:                "bg-sky-500/15 text-sky-400 border-sky-500/25",
  in_progress:         "bg-amber-500/15 text-amber-400 border-amber-500/25",
  awaiting_approval:   "bg-violet-500/15 text-violet-400 border-violet-500/25",
  blocked:             "bg-red-500/15 text-red-400 border-red-500/25",
  partially_completed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  completed:           "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  cancelled:           "bg-slate-500/15 text-slate-400 border-slate-500/25",
  failed:              "bg-red-500/15 text-red-400 border-red-500/25",
};

export const WO_STATUS_STYLE_FALLBACK = "bg-white/[0.05] text-muted-foreground border-white/[0.1]";
