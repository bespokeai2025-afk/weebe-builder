/** Detect WhatsApp opt-out / STOP replies (Meta + common variants). */
export function isWhatsappOptOutMessage(body: string | null | undefined): boolean {
  const text = String(body ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return false;

  const exact = new Set([
    "stop",
    "unsubscribe",
    "cancel",
    "end",
    "quit",
    "opt out",
    "optout",
    "remove me",
    "stop all",
    "stop messages",
    "unsub",
  ]);

  if (exact.has(text)) return true;
  if (/^stop\b/.test(text) && text.length <= 24) return true;
  if (/^unsubscribe\b/.test(text) && text.length <= 32) return true;
  return false;
}
