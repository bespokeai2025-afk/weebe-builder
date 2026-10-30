/** Data page — dates, durations and status badges. */
import { wbahDateTimeOptions } from "@/lib/dashboard/wbah-timezone";

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function wbahSyncAgo(iso?: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const CALL_STATUSES = [
  { value: "all", label: "All statuses" },
  { value: "needs_to_call", label: "Needs to call" },
  { value: "queued", label: "Queued" },
  { value: "calling", label: "Calling" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "do_not_call", label: "Do not call" },
  { value: "disqualified", label: "Disqualified" },
] as const;

export function fmtDate(iso?: string | null, isWbah = false) {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString(
    "en-US",
    wbahDateTimeOptions(isWbah, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  );
}

export function statusBadgeClass(status?: string | null) {
  const map: Record<string, string> = {
    needs_to_call: "bg-muted text-muted-foreground",
    queued: "bg-primary/15 text-primary",
    calling: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    completed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    failed: "bg-destructive/15 text-destructive",
    do_not_call: "bg-muted/60 text-muted-foreground line-through",
    disqualified: "bg-rose-500/15 text-rose-600 dark:text-rose-400 line-through",
  };
  return map[status ?? ""] ?? "bg-muted text-muted-foreground";
}

export function fmtTs(ts: number | null | undefined, isWbah = false): string {
  if (!ts) return "N/A";
  const d = new Date(ts);
  const time = d.toLocaleTimeString(
    "en-GB",
    wbahDateTimeOptions(isWbah, { hour: "2-digit", minute: "2-digit" }),
  );
  const date = d.toLocaleDateString(
    "en-GB",
    wbahDateTimeOptions(isWbah, { day: "2-digit", month: "short", year: "numeric" }),
  );
  return `${time} · ${date}`;
}

export function fmtMs(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "N/A";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export function wbahCallStatusBadge(status: string | null | undefined): { label: string; cls: string } {
  const s = (status ?? "").toLowerCase();
  if (s === "need_to_call" || s === "need to call")
    return { label: "Need To Call", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
  if (s === "not_connected" || s === "no_answer" || s === "not connected")
    return { label: "Not Connected", cls: "bg-orange-500/15 text-orange-600 dark:text-orange-400" };
  if (s === "call_analyzed" || s === "completed" || s === "ended")
    return { label: "Completed", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" };
  if (s === "disqualified" || s === "rejected" || s === "not_interested")
    return { label: "Disqualified", cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" };
  if (!s) return { label: "N/A", cls: "bg-muted text-muted-foreground" };
  const label = s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { label, cls: "bg-muted text-muted-foreground" };
}

export function wbahSentimentBadge(sentiment: string | null | undefined): { label: string; cls: string } {
  const s = (sentiment ?? "").toLowerCase();
  if (s.includes("positive")) return { label: "Positive", cls: "text-emerald-600 dark:text-emerald-400" };
  if (s.includes("neutral")) return { label: "Neutral", cls: "text-amber-600 dark:text-amber-400" };
  if (s.includes("negative")) return { label: "Negative", cls: "text-rose-600 dark:text-rose-400" };
  return { label: sentiment ? sentiment : "N/A", cls: "text-muted-foreground" };
}

export function truncateDqReason(text: string | null | undefined, max = 36): string {
  if (!text) return "—";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

// Normalize the many raw/normalized call statuses into a few filter buckets so
// the same Status filter works across both Leads (raw API statuses) and Calls
// (normalized statuses).
export function wbahStatusKey(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase().trim();
  if (s === "need_to_call" || s === "need to call") return "need_to_call";
  if (
    s === "not_connected" ||
    s === "no_answer" ||
    s === "not connected" ||
    s === "voicemail" ||
    s === "voicemail_reached" ||
    s === "missed"
  )
    return "not_connected";
  if (s === "call_analyzed" || s === "completed" || s === "ended") return "completed";
  if (s === "disqualified" || s === "rejected" || s === "not_interested" || s.includes("disqualif"))
    return "disqualified";
  if (s === "failed" || s === "error" || s === "call_failed") return "failed";
  return "other";
}

export function wbahDateCutoff(filter: string): number {
  if (filter === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (filter === "7d") return Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (filter === "30d") return Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (filter === "45d") return Date.now() - 45 * 24 * 60 * 60 * 1000;
  return 0;
}
