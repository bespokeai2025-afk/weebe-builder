/**
 * Fetch existing wbah_calls rows by id, in chunks.
 *
 * PostgREST puts `.in("id", ids)` in the URL; past ~500 call ids the request is
 * rejected (HTTP 400). The syncs used to ignore that error, treat every row as
 * new and upsert nulls over appointment/booking/Calendly fields and transcripts
 * — no booked WBAH call kept its booking on the call record (Sept–Oct 2026).
 * Chunked here, and a failed lookup throws so the caller never upserts blind.
 */
const CHUNK = 200;

export async function selectWbahCallsByIds<T extends { id: string }>(
  sb: unknown,
  ids: string[],
  columns: string,
  workspaceId?: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    let q = (sb as any).from("wbah_calls").select(columns).in("id", ids.slice(i, i + CHUNK));
    if (workspaceId) q = q.eq("workspace_id", workspaceId);
    const { data, error } = await q;
    if (error) throw new Error(`wbah_calls lookup failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}
