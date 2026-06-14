import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(
  date: Date | string | number | null | undefined,
  opts: { short?: boolean; fallback?: string } = {},
): string {
  const { short = false, fallback = "—" } = opts;
  if (date === null || date === undefined) return fallback;
  const ts = typeof date === "number" ? date : new Date(date as string | Date).getTime();
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return short ? `${s}s ago` : `${s} second${s === 1 ? "" : "s"} ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return short ? `${m}m ago` : `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return short ? `${h}h ago` : `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return short ? `${d}d ago` : `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.floor(d / 30);
  return short ? `${mo}mo ago` : `${mo} month${mo === 1 ? "" : "s"} ago`;
}
