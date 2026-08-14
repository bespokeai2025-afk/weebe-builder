/**
 * Collapses the optimistic row an outbound send writes when WATI's send response carries no
 * message id.
 *
 * Sending from the inbox writes a row immediately so the message renders without waiting for
 * WATI. WATI often returns no id for session sends, so that row gets a synthesised
 * `wati_session_<ts>` external_id. Seconds later the API sync (or the webhook) sees the same
 * message carrying its real `wamid` and, finding no id match, writes a second row — the same
 * message twice in the thread.
 *
 * The sync already skips messages that match an existing row on body + time, but that only works
 * when the optimistic row landed first; the two writes race, so it frequently does not.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Gap between our insert time and WATI's send time: one WATI round trip, plus whatever the send
 * handler does before inserting.
 */
export const OPTIMISTIC_DUPLICATE_WINDOW_MS = 15_000;

/**
 * Shape of the ids we mint when a WATI send response carries none: `wati_session_<ts>`,
 * `wati_tpl_<ts>`, `wati_file_<ts>` and the provider adapter's `wati_<ts>`.
 */
const SYNTHETIC_ID_PATTERN = /^wati_(?:session_|tpl_|file_)?\d+$/;

export type DedupeCandidateRow = {
  id?: string | null;
  external_id?: string | null;
  whatsapp_message_id?: string | null;
  sent_at?: string | null;
  body?: string | null;
  direction?: string | null;
};

export function isSyntheticWatiMessageId(externalId: string | null | undefined): boolean {
  if (!externalId) return false;
  return SYNTHETIC_ID_PATTERN.test(externalId);
}

function sentAtMs(value: unknown): number | null {
  if (value == null) return null;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? null : ms;
}

/** A row we wrote ourselves before WATI told us the real message id. */
function isOptimisticRow(row: DedupeCandidateRow): boolean {
  return (
    row.direction === "outbound" &&
    !row.whatsapp_message_id &&
    isSyntheticWatiMessageId(row.external_id)
  );
}

/** A row carrying WATI's own id — the copy worth keeping. */
function isConfirmedRow(row: DedupeCandidateRow): boolean {
  return row.direction === "outbound" && Boolean(row.whatsapp_message_id);
}

/**
 * Ids of optimistic rows that duplicate a confirmed row.
 *
 * Matching is one-to-one: sending the same text twice in quick succession produces two optimistic
 * rows and (eventually) two confirmed ones, and each optimistic row may only be consumed by a
 * distinct confirmed row, so both messages survive.
 */
export function findRedundantOptimisticMessageIds(
  rows: DedupeCandidateRow[],
  windowMs: number = OPTIMISTIC_DUPLICATE_WINDOW_MS,
): string[] {
  const optimistic = rows.filter(isOptimisticRow);
  if (optimistic.length === 0) return [];

  const confirmed = rows.filter(isConfirmedRow);
  if (confirmed.length === 0) return [];

  const claimed = new Set<DedupeCandidateRow>();
  const redundant: string[] = [];

  for (const candidate of optimistic) {
    if (!candidate.id) continue;
    const candidateMs = sentAtMs(candidate.sent_at);
    if (candidateMs == null) continue;
    const candidateBody = String(candidate.body ?? "").trim();

    const match = confirmed.find((row) => {
      if (claimed.has(row)) return false;
      if (String(row.body ?? "").trim() !== candidateBody) return false;
      const rowMs = sentAtMs(row.sent_at);
      return rowMs != null && Math.abs(rowMs - candidateMs) <= windowMs;
    });

    if (match) {
      claimed.add(match);
      redundant.push(candidate.id);
    }
  }

  return redundant;
}

/**
 * Drops optimistic rows for one contact that WATI has since confirmed under its own id.
 *
 * Safe to call repeatedly — a thread with nothing to collapse costs one query.
 */
export async function collapseOptimisticOutboundDuplicates(
  workspaceId: string,
  contactPhone: string,
): Promise<number> {
  const admin = supabaseAdmin as any;

  const { data } = await admin
    .from("whatsapp_messages")
    .select("id, external_id, whatsapp_message_id, sent_at, body, direction")
    .eq("workspace_id", workspaceId)
    .eq("contact_phone", contactPhone)
    .eq("direction", "outbound")
    .order("sent_at", { ascending: false })
    .limit(200);

  const redundant = findRedundantOptimisticMessageIds((data ?? []) as DedupeCandidateRow[]);
  if (redundant.length === 0) return 0;

  const { error } = await admin.from("whatsapp_messages").delete().in("id", redundant);
  if (error) {
    console.warn("[whatsapp-dedupe] failed to drop duplicate outbound rows", {
      count: redundant.length,
      error: error.message,
    });
    return 0;
  }

  return redundant.length;
}
