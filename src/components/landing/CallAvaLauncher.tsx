import { useState } from "react";
import { useCallAvaNow } from "@/components/landing/CallAvaNowModal";
import { AvaOrb } from "@/components/landing/AvaOrb";

/**
 * Floating "Talk to Ava" launcher — fixed bottom-right, transparent (no square
 * background around the orb). Clicking opens the existing Call Ava Now OTP modal
 * (no OTP bypass, no duplicate modal). Mount once at the landing-page root.
 */
export function CallAvaLauncher() {
  const { open, CallAvaNow } = useCallAvaNow();
  const [hover, setHover] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={open}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        aria-label="Talk to Ava — start a live AI call"
        className="fixed bottom-5 right-5 z-[60] flex items-center gap-3 sm:bottom-6 sm:right-6"
        style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
      >
        <span
          className="hidden sm:inline-flex flex-col items-end rounded-2xl px-4 py-2 text-right"
          style={{
            background: "rgba(6,25,54,0.72)",
            border: `1px solid ${hover ? "rgba(56,189,248,0.5)" : "rgba(56,189,248,0.24)"}`,
            backdropFilter: "blur(10px)",
            boxShadow: "0 10px 34px rgba(2,8,23,0.55)",
            transition: "border-color .25s ease, transform .25s ease",
            transform: hover ? "translateX(-2px)" : "translateX(0)",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: hover ? "#E0F5FF" : "#BAE6FD",
              transition: "color .25s ease",
              lineHeight: 1.15,
            }}
          >
            Talk to Ava
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 500, color: "rgba(186,230,253,0.62)", lineHeight: 1.3 }}>
            Live AI call · instant
          </span>
        </span>

        <AvaOrb size="sm" state={hover ? "hover" : "idle"} />
      </button>

      {CallAvaNow}
    </>
  );
}
