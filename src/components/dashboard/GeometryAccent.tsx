import { cn } from "@/lib/utils";

/**
 * WEBEE's small brand-accent geometry (Phase 2A.3 design audit) — a
 * restrained cluster of rounded-hexagon outlines, plus one subtle filled
 * shape in the "present" variant. This is brand accent / visual texture
 * only — never data, status, workflow, or navigation. It must never be
 * the only carrier of any information, which is why it's fully decorative
 * (aria-hidden, no pointer events) by construction.
 *
 * Two strengths only, per the approved design:
 * - "quiet": low-content header/background zones (the default).
 * - "present": a future higher-visibility promotional/insight surface.
 *
 * Color always comes from the shared --brand token via currentColor —
 * this is not a second, geometry-specific brand color.
 */
export function GeometryAccent({
  variant = "quiet",
  className,
}: {
  variant?: "quiet" | "present";
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 160 120"
      fill="none"
      className={cn("pointer-events-none select-none text-brand", className)}
      style={{
        opacity:
          variant === "present"
            ? "var(--geometry-accent-opacity-present)"
            : "var(--geometry-accent-opacity-quiet)",
      }}
    >
      <polygon
        points="70,10 118,36 118,88 70,114 22,88 22,36"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <polygon
        points="122,48 152,65 152,99 122,116 92,99 92,65"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {variant === "present" && (
        <polygon
          points="32,68 53,80 53,104 32,116 11,104 11,80"
          fill="currentColor"
        />
      )}
    </svg>
  );
}
