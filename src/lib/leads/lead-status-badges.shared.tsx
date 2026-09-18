// Shared call/booking status badges (WEBEE-UIUX-AUDIT.md F-05). Previously
// copy-pasted verbatim between leads.index.tsx and qualified.tsx — consolidated
// here with the exact same values, no color changes.

export function callStatusBadge(status: string | null) {
  if (!status) return <span className="text-muted-foreground text-[11px]">—</span>;
  const map: Record<string, string> = {
    completed:   "bg-emerald-500/15 text-emerald-400",
    failed:      "bg-red-500/15 text-red-400",
    no_answer:   "bg-orange-500/15 text-orange-400",
    initiated:   "bg-blue-500/15 text-blue-400",
    in_progress: "bg-blue-500/15 text-blue-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize whitespace-nowrap ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function bookingStatusBadge(status: string | null) {
  if (!status) return <span className="text-muted-foreground text-[11px]">—</span>;
  const lower = status.toLowerCase();
  const map: Record<string, string> = {
    booked:    "bg-emerald-500/15 text-emerald-400",
    confirmed: "bg-emerald-500/15 text-emerald-400",
    success:   "bg-emerald-500/15 text-emerald-400",
    pending:   "bg-amber-500/15 text-amber-400",
    cancelled: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize whitespace-nowrap ${map[lower] ?? "bg-muted text-muted-foreground"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
