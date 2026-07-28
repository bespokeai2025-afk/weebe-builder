import { cn } from "@/lib/utils";

/** UAT / Dynamics test cohort — not for production TTC/DQ sweeps. */
export function WbahTestLeadBadge({
  className,
  label = "TEST",
}: {
  className?: string;
  label?: "TEST" | "UAT";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border border-amber-300/50 bg-amber-500/15 px-1 py-0 text-[9px] font-bold uppercase tracking-wide text-amber-300",
        className,
      )}
    >
      {label}
    </span>
  );
}

/** True when the app hostname looks like production (not localhost / UAT). */
export function isLikelyProductionFrontend(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname.toLowerCase();
  return (
    !h.includes("localhost") &&
    !h.includes("127.0.0.1") &&
    !h.includes("uat") &&
    !h.includes("staging")
  );
}
