/**
 * Is this WATI history entry the same message we logged when we sent it?
 *
 * WATI's history carries no link back to our send — `localMessageId` is null on broadcasts — and its
 * text differs from our log in whitespace. Our log's time has also lagged WATI's: by ~30 s, and by
 * ~2 minutes on a 240-recipient campaign logged only after its last batch. So the match is the same
 * contact (callers filter by phone), the same direction, the same text up to spacing and case,
 * close in time.
 *
 * Shared by the inbox sync (WATI copy arrives after our log) and the campaign logger (WATI copy
 * already imported before our log is written), so one rule decides both ways round.
 */

/** Text equal up to whitespace and case; empty text never matches. */
export function sameWatiMessageText(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (t: string | null | undefined) => String(t ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const na = norm(a);
  return na !== "" && na === norm(b);
}

/** How far apart our log and WATI's entry may be. WATI_SYNC_SEND_MATCH_WINDOW_SECONDS overrides 600. */
export function watiSendMatchWindowMs(): number {
  const raw = typeof process !== "undefined" ? process.env?.WATI_SYNC_SEND_MATCH_WINDOW_SECONDS : undefined;
  const n = Number(raw);
  return (Number.isFinite(n) && n > 0 ? n : 600) * 1000;
}

/** A row this app logged when it sent the message (no WATI/Meta id yet), as opposed to one imported from WATI. */
export function isOurWatiSendLog(row: {
  whatsapp_message_id?: string | null;
  campaign_id?: string | null;
  external_id?: string | null;
}): boolean {
  return !row.whatsapp_message_id && (!!row.campaign_id || /^lead_/.test(String(row.external_id ?? "")));
}

/** Delivery only moves forward (sent → delivered → read); a failure replaces a plain "sent". */
export function watiStatusMovesForward(current: string | null | undefined, next: string): boolean {
  const rank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };
  const cur = String(current ?? "");
  if (next === "failed") return cur === "" || cur === "queued" || cur === "sent";
  return (rank[next] ?? -1) > (rank[cur] ?? -1);
}

/** The earlier of two ISO times — WATI's own timestamp is when the message actually went out. */
export function earlierIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? null : (b as string);
  if (Number.isNaN(tb)) return a as string;
  return ta <= tb ? (a as string) : (b as string);
}
