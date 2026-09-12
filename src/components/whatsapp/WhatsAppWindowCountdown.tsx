import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatWhatsappWindowRemaining,
  whatsappWindowRemainingMs,
  whatsappWindowUrgency,
} from "@/lib/whatsapp/campaign-leads.shared";

const URGENCY_CLASS: Record<string, string> = {
  safe: "text-muted-foreground",
  warning: "text-amber-500",
  critical: "text-destructive animate-pulse",
  closed: "text-muted-foreground",
  none: "text-muted-foreground",
};

/**
 * Live 24h WhatsApp session countdown. Re-renders every 30s so the label and
 * urgency color stay current without a full page refresh — this is the
 * "visible countdown" + "remind me before it closes" requirement: the
 * escalating color (amber inside 4h, pulsing red inside the final hour) is
 * the in-app reminder as the agent works the board.
 */
export function WhatsAppWindowCountdown({
  lastInboundAt,
  className,
}: {
  lastInboundAt: string | null | undefined;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const remaining = whatsappWindowRemainingMs(lastInboundAt, now);
  if (remaining == null) return null;

  const urgency = whatsappWindowUrgency(remaining);
  const label = formatWhatsappWindowRemaining(remaining);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium",
        URGENCY_CLASS[urgency],
        className,
      )}
      title={
        urgency === "closed"
          ? "The 24h free-text window has closed — send an approved template or use WhatsApp directly"
          : "Time left to reply freely before the 24h WhatsApp window closes"
      }
    >
      <Clock className="h-3 w-3" />
      {label}
    </span>
  );
}
