import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Thin progress bar along the top of the app while a page change is in flight (route code and
 * loaders). Clicking a sidebar link used to show nothing until the next page rendered. Waits
 * 120 ms before appearing so instant (preloaded) navigations don't flash it.
 */
export function RouteProgressBar() {
  const pending = useRouterState({ select: (s) => s.status === "pending" || s.isLoading });
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (pending) {
      const show = setTimeout(() => {
        setVisible(true);
        setProgress(15);
        tick.current = setInterval(() => {
          // Ease toward 90% until the navigation finishes.
          setProgress((p) => (p < 90 ? p + (90 - p) * 0.12 : p));
        }, 200);
      }, 120);
      return () => {
        clearTimeout(show);
        if (tick.current) clearInterval(tick.current);
        tick.current = null;
      };
    }
    if (!visible) return;
    setProgress(100);
    const hide = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 250);
    return () => clearTimeout(hide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!visible) return null;
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
    >
      <div
        className="h-full bg-primary shadow-[0_0_8px_var(--primary)] transition-[width] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
