import { useState, useEffect, useRef } from "react";
import { formatRelativeTime } from "@/lib/utils";

const RECENT_THRESHOLD_MS = 2 * 60 * 1000;
const RECENT_INTERVAL_MS = 10_000;

function pickDelay(
  date: Date | string | number | null | undefined,
  slowMs: number,
): number {
  if (date === null || date === undefined) return slowMs;
  const age = Date.now() - new Date(date).getTime();
  return age < RECENT_THRESHOLD_MS ? RECENT_INTERVAL_MS : slowMs;
}

export function useRelativeTime(
  date: Date | string | number | null | undefined,
  opts: { short?: boolean; fallback?: string; intervalMs?: number } = {},
): string {
  const { intervalMs = 60_000, ...fmtOpts } = opts;
  const [, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (date === null || date === undefined) return;

    function schedule() {
      timerRef.current = setTimeout(() => {
        setTick((n) => n + 1);
        schedule();
      }, pickDelay(date, intervalMs));
    }

    schedule();

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [date, intervalMs]);

  return formatRelativeTime(date, fmtOpts);
}
