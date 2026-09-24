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

  // Sentence-length opt-outs. The keyword list above only caught people who replied with a single
  // word, so someone writing "Do not send any messages in the future" or "Delete my data
  // immediately" was never flagged and stayed in the audience for the next campaign. These are
  // matched anywhere in the message, with no length limit, because a real opt-out is usually
  // phrased as a complaint rather than a command.
  return OPT_OUT_PHRASES.some((p) => p.test(text));
}

/**
 * Phrasings that mean "stop contacting me" without using a keyword.
 *
 * Kept deliberately specific: "not interested" on its own is a sales outcome, not an opt-out, and
 * flagging it would silently shrink every audience. Each pattern here is an explicit instruction
 * to stop, delete, or block.
 */
const OPT_OUT_PHRASES: RegExp[] = [
  /\bdo not (send|contact|message|text|call|write)\b/,
  // Punctuation is stripped to spaces above, so "don't" arrives as "don t".
  /\bdon ?t (send|contact|message|text|call|write)\b/,
  /\bnever (contact|message|text|call)\b/,
  /\bstop (sending|messaging|contacting|texting|calling)\b/,
  /\bno more (messages|texts|contact)\b/,
  /\b(delete|remove|erase) (all )?my (data|details|information|number|info)\b/,
  /\b(delete|remove) me\b/,
  /\bblock my number\b/,
  /\btake me off\b/,
  /\bremove me from\b/,
  /\bopt(ing)? out\b/,
  /\bwithdraw my consent\b/,
];
