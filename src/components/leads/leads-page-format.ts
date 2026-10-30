/** Leads page — dates, status options and date presets. */
import { wbahDateTimeOptions } from "@/lib/dashboard/wbah-timezone";

export function fmtDate(d: string | null | undefined, isWbah = false) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString(undefined, wbahDateTimeOptions(isWbah));
  } catch {
    return d;
  }
}

export function fmtCallDate(iso: string | null | undefined, isWbah = false) {
  if (!iso) return "Not called yet";
  try {
    return new Date(iso).toLocaleString(
      undefined,
      wbahDateTimeOptions(isWbah, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  } catch {
    return iso;
  }
}

export const STATUS_OPTIONS = [
  {
    value: "interested",
    label: "Open",
    color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
  },
  {
    value: "qualified",
    label: "Qualified",
    color: "bg-violet-500/15 text-violet-600 dark:text-violet-400 ring-violet-500/20",
  },
  {
    value: "callback_requested",
    label: "Callback Requested",
    color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/20",
  },
  {
    value: "need_to_call",
    label: "Needs to Call",
    color: "bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-sky-500/20",
  },
  {
    value: "not_interested",
    label: "Closed",
    color: "bg-red-500/15 text-red-600 dark:text-red-400 ring-red-500/20",
  },
  {
    value: "completed",
    label: "Completed",
    color: "bg-blue-500/15 text-blue-600 dark:text-blue-400 ring-blue-500/20",
  },
  {
    value: "no_answer",
    label: "No Answer",
    color: "bg-orange-500/15 text-orange-600 dark:text-orange-400 ring-orange-500/20",
  },
  {
    value: "scheduled",
    label: "Scheduled",
    color: "bg-purple-500/15 text-purple-600 dark:text-purple-400 ring-purple-500/20",
  },
] as const;

export function statusDisplay(status: string | null | undefined) {
  const opt = STATUS_OPTIONS.find((o) => o.value === status);
  if (opt) return opt;
  return {
    value: status ?? "",
    label: status?.replace(/_/g, " ") ?? "—",
    color: "bg-muted text-muted-foreground ring-border",
  };
}

export function filterToDates(filter: string): { dateFrom?: string; dateTo?: string } {
  if (filter === "all") return {};
  if (filter === "today") {
    const d = new Date();
    const from = new Date(d);
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(d);
    to.setUTCHours(23, 59, 59, 999);
    return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
  }
  if (filter === "yesterday") {
    const d = new Date(Date.now() - 86_400_000);
    const from = new Date(d);
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(d);
    to.setUTCHours(23, 59, 59, 999);
    return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
  }
  const days = parseInt(filter, 10);
  return isNaN(days) ? {} : { dateFrom: new Date(Date.now() - days * 86_400_000).toISOString() };
}
