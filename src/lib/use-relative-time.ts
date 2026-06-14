import { useState, useEffect } from "react";
import { formatRelativeTime } from "@/lib/utils";

export function useRelativeTime(
  date: Date | string | number | null | undefined,
  opts: { short?: boolean; fallback?: string; intervalMs?: number } = {},
): string {
  const { intervalMs = 60_000, ...fmtOpts } = opts;
  const [, setTick] = useState(0);

  useEffect(() => {
    if (date === null || date === undefined) return;
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [date, intervalMs]);

  return formatRelativeTime(date, fmtOpts);
}
