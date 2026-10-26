/**
 * Transcripts WEBEE already holds: the Retell webhook payloads stored on
 * wbah_post_call_jobs. Calls placed from another Retell account (the "new"
 * pool) can't be fetched with the WBAH key (get-call → 404), so a transcript
 * lost from wbah_calls is only recoverable from here. No @/ imports — loaded
 * from the sync tick.
 */
const CHUNK = 100;

function transcriptFromCall(call: Record<string, unknown> | null | undefined): string | null {
  if (!call) return null;
  const text = typeof call.transcript === "string" ? call.transcript.trim() : "";
  if (text) return text;
  const turns = Array.isArray(call.transcript_object)
    ? (call.transcript_object as Array<{ role?: string; content?: string }>)
        .filter((t) => (t.role === "agent" || t.role === "user") && t.content)
        .map((t) => `${t.role}: ${t.content}`)
        .join("\n")
    : "";
  return turns || null;
}

/** call id → transcript, from the newest stored webhook payload that has one. */
export async function transcriptsFromPostCallJobs(sb: unknown, callIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(callIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await (sb as any)
      .from("wbah_post_call_jobs")
      .select("retell_call_id, event, created_at, call:payload->call")
      .in("retell_call_id", ids.slice(i, i + CHUNK))
      .in("event", ["call_analyzed", "call_ended"])
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("[wbah-transcripts] post-call job lookup failed:", error.message);
      continue;
    }
    for (const row of (data ?? []) as Array<{ retell_call_id: string; call: Record<string, unknown> | null }>) {
      if (out.has(row.retell_call_id)) continue;
      const t = transcriptFromCall(row.call);
      if (t) out.set(row.retell_call_id, t);
    }
  }
  return out;
}

export { transcriptFromCall };
