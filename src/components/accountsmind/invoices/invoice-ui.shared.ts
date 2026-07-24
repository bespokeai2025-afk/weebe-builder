/** Shared UI bits for the AccountsMind invoice suite. */
import { formatMoneyCents } from "@/lib/accountsmind/invoice-totals.shared";

export const money = formatMoneyCents;

export const inputCls = "bg-slate-950 border-slate-700 text-white";
export const selectCls =
  "w-full h-9 rounded-md bg-slate-950 border border-slate-700 text-sm text-white px-2";

export const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  ready: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  unpaid: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  sent: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  viewed: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  partially_paid: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  paid: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  overdue: "bg-red-500/15 text-red-300 border-red-500/30",
  cancelled: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  void: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  refunded: "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  ready: "Ready",
  unpaid: "Ready", // legacy alias
  sent: "Sent",
  viewed: "Viewed",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
  void: "Void",
  refunded: "Refunded",
};

export function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const dd = new Date(d.length === 10 ? `${d}T00:00:00Z` : d);
  return Number.isNaN(dd.getTime()) ? "—" : dd.toLocaleDateString("en-GB");
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
