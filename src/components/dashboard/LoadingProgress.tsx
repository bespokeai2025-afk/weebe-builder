import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Simulated-progress loader. Because data fetches have no real progress signal,
 * this animates a percentage that crawls toward (but never reaches) 99% on a
 * decelerating curve so users get a sense of how long they need to wait. When
 * the data arrives the parent unmounts this component, so 100% is never shown —
 * the loader simply disappears and the real content takes its place.
 *
 * `estimatedMs` is the rough time the fetch is expected to take — the bar reaches
 * ~95% around that mark, then crawls toward 99%.
 */
export function LoadingProgress({
  label = "Loading",
  estimatedMs = 6000,
  className,
}: {
  label?: string;
  estimatedMs?: number;
  className?: string;
}) {
  const [pct, setPct] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const target = 1 - Math.exp((-3 * elapsed) / Math.max(400, estimatedMs));
      setPct((prev) => Math.max(prev, Math.min(99, Math.round(target * 100))));
    }, 120);
    return () => clearInterval(id);
  }, [estimatedMs]);

  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-16", className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        <span>{label}…</span>
        <span className="tabular-nums text-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
