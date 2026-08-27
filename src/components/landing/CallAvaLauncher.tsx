import { useState } from "react";
import { useCallAvaNow } from "@/components/landing/CallAvaNowModal";
import { AvaOrb } from "@/components/landing/AvaOrb";

/**
 * Floating Ava launcher — fixed bottom-right, transparent (no square background
 * around the orb). Clicking opens the existing Call Ava Now OTP modal (no OTP
 * bypass, no duplicate modal). Mount once at the landing-page root.
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
        <AvaOrb size="sm" state={hover ? "hover" : "idle"} />
      </button>

      {CallAvaNow}
    </>
  );
}
