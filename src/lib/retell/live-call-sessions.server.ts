/**
 * live_call_sessions — LIVE (in-progress) transcript snapshots for the dashboard
 * Live Calls panel.
 *
 * The ONLY live transcript source for Retell MANAGED agents is the
 * `transcript_updated` webhook event (Retell REST `get-call` does NOT expose an
 * in-progress transcript, and this app is not Retell's LLM backend so the LLM
 * WebSocket is unavailable). `transcript_updated` carries the FULL cumulative
 * transcript each time it fires, so we keep ONE snapshot row per call
 * (UNIQUE workspace_id + retell_call_id) — inherently dedup-free.
 *
 * This is DISPLAY-ONLY, transient state. It never touches the `calls` table,
 * analytics, leads, or any downstream system. All writes go through the
 * service-role client and are best-effort (callers wrap in try/catch) so this
 * layer can never break the canonical post-call webhook processing.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type LiveSessionStatus = "ringing" | "in_progress" | "ended" | "failed";

export interface LiveTranscriptLine {
  role: "agent" | "user";
  content: string;
}

/** Shape of the Retell `call` object relevant to live sessions. */
interface RetellCallLike {
  call_id?: string;
  agent_id?: string;
  call_type?: string;
  call_status?: string;
  direction?: string;
  from_number?: string | null;
  to_number?: string | null;
  start_timestamp?: number | null;
  transcript?: string | null;
  transcript_object?: Array<{ role?: string; content?: string }>;
  transcript_with_tool_calls?: Array<{ role?: string; content?: string }>;
}

/**
 * Extract a structured [{role, content}] transcript from a Retell call object.
 * Prefers the structured arrays; falls back to parsing the plain-text string.
 * Mirrors the extractor used on the SSE read side so both agree on shape.
 */
export function extractLiveTranscript(call: RetellCallLike): LiveTranscriptLine[] {
  const fromArray = (arr?: Array<{ role?: string; content?: string }>) =>
    (arr ?? [])
      .filter(
        (u) => (u.role === "agent" || u.role === "user") && typeof u.content === "string",
      )
      .map((u) => ({
        role: u.role === "agent" ? ("agent" as const) : ("user" as const),
        content: (u.content ?? "").trim(),
      }))
      .filter((u) => u.content.length > 0);

  const obj = fromArray(call.transcript_object);
  if (obj.length > 0) return obj;

  const toolCalls = fromArray(call.transcript_with_tool_calls);
  if (toolCalls.length > 0) return toolCalls;

  return parseTranscriptString(call.transcript ?? "");
}

/** Parse Retell's plain-text transcript ("Agent: ...\nUser: ...") into lines. */
export function parseTranscriptString(text: string): LiveTranscriptLine[] {
  if (!text || !text.trim()) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(agent|assistant|ai|user|human|customer)\s*:\s*(.*)$/i);
      if (m) {
        const who = m[1].toLowerCase();
        const role: "agent" | "user" =
          who === "agent" || who === "assistant" || who === "ai" ? "agent" : "user";
        return { role, content: m[2].trim() };
      }
      return { role: "agent" as const, content: line };
    })
    .filter((l) => l.content.length > 0);
}

/** Derive the live status from a Retell call object + event name. */
export function deriveLiveStatus(
  event: string,
  callStatus?: string | null,
): LiveSessionStatus {
  if (event === "call_ended" || event === "call_analyzed" || event === "call_transferred") {
    return "ended";
  }
  if (event === "call_failed") return "failed";
  const s = String(callStatus ?? "").toLowerCase();
  if (s === "registered") return "ringing";
  if (s === "ended") return "ended";
  if (s === "error") return "failed";
  return "in_progress";
}

/**
 * Upsert the live snapshot for an in-progress call. The transcript is the full
 * cumulative transcript from the webhook. Guarded so an out-of-order (older)
 * webhook delivery can never shrink a longer, newer transcript already stored.
 */
export async function upsertLiveCallSession(input: {
  workspaceId: string;
  agentName?: string | null;
  event: string;
  call: RetellCallLike;
}): Promise<void> {
  const { workspaceId, agentName, event, call } = input;
  const retellCallId = call.call_id;
  if (!workspaceId || !retellCallId) return;

  const transcript = extractLiveTranscript(call);
  const transcriptLen = transcript.length;
  const status = deriveLiveStatus(event, call.call_status);
  const startedAt =
    call.start_timestamp != null ? new Date(call.start_timestamp).toISOString() : null;

  const { data: existing } = await supabaseAdmin
    .from("live_call_sessions")
    .select("transcript_len, call_status")
    .eq("workspace_id", workspaceId)
    .eq("retell_call_id", retellCallId)
    .maybeSingle();

  const existingRow = existing as
    | { transcript_len?: number; call_status?: string }
    | null;

  // NEVER resurrect an ended session. `transcript_updated` fires frequently and
  // webhook deliveries are unordered, so one can land AFTER call_ended/failed —
  // reviving it would show a ghost "LIVE" card and suppress the real completed
  // card until stale cleanup. Lifecycle events (call_ended/failed) still write
  // through so the terminal state is always recorded.
  if (
    event === "transcript_updated" &&
    (existingRow?.call_status === "ended" || existingRow?.call_status === "failed")
  ) {
    return;
  }

  // Guard against out-of-order deliveries: only overwrite the transcript when
  // the incoming one is at least as long as what we already have (Retell sends
  // the full cumulative transcript, so length is monotonic within a call).
  const storedLen = existingRow?.transcript_len ?? -1;
  const keepTranscript = transcriptLen < storedLen && status !== "ended" && status !== "failed";

  const nowIso = new Date().toISOString();
  const record: Record<string, unknown> = {
    workspace_id: workspaceId,
    retell_call_id: retellCallId,
    agent_id: call.agent_id ?? null,
    agent_name: agentName ?? null,
    from_number: call.from_number ?? null,
    to_number: call.to_number ?? null,
    direction: call.direction ?? null,
    call_type: call.call_type ?? null,
    call_status: status,
    started_at: startedAt,
    updated_at: nowIso,
    ended_at: status === "ended" || status === "failed" ? nowIso : null,
  };
  if (!keepTranscript) {
    record.transcript = transcript;
    record.transcript_len = transcriptLen;
  }

  await supabaseAdmin
    .from("live_call_sessions")
    .upsert(record as never, { onConflict: "workspace_id,retell_call_id" });
}

/** Mark a live session as ended/failed (called on call_ended/analyzed/failed). */
export async function markLiveCallSessionEnded(
  workspaceId: string,
  retellCallId: string,
  status: "ended" | "failed" = "ended",
): Promise<void> {
  if (!workspaceId || !retellCallId) return;
  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from("live_call_sessions")
    .update({ call_status: status, ended_at: nowIso, updated_at: nowIso } as never)
    .eq("workspace_id", workspaceId)
    .eq("retell_call_id", retellCallId);
}

export interface ActiveLiveSession {
  retell_call_id: string;
  agent_id: string | null;
  agent_name: string | null;
  from_number: string | null;
  to_number: string | null;
  direction: string | null;
  call_type: string | null;
  call_status: LiveSessionStatus;
  transcript: LiveTranscriptLine[];
  started_at: string | null;
}

/**
 * Fetch the workspace's currently-active live sessions (ringing/in_progress),
 * updated within the recency window (stale rows from a crashed/ghost call are
 * ignored). Workspace-scoped — this is the tenant-isolation boundary for the
 * live transcript source.
 */
export async function fetchActiveLiveCallSessions(
  workspaceId: string,
  recencyMs = 15 * 60 * 1000,
): Promise<ActiveLiveSession[]> {
  if (!workspaceId) return [];
  try {
    const since = new Date(Date.now() - recencyMs).toISOString();
    const { data } = await supabaseAdmin
      .from("live_call_sessions")
      .select(
        "retell_call_id, agent_id, agent_name, from_number, to_number, direction, call_type, call_status, transcript, started_at",
      )
      .eq("workspace_id", workspaceId)
      .in("call_status", ["ringing", "in_progress"])
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(25);

    return (data ?? []).map((row: Record<string, unknown>) => ({
      retell_call_id: String(row.retell_call_id ?? ""),
      agent_id: (row.agent_id as string | null) ?? null,
      agent_name: (row.agent_name as string | null) ?? null,
      from_number: (row.from_number as string | null) ?? null,
      to_number: (row.to_number as string | null) ?? null,
      direction: (row.direction as string | null) ?? null,
      call_type: (row.call_type as string | null) ?? null,
      call_status: (row.call_status as LiveSessionStatus) ?? "in_progress",
      transcript: Array.isArray(row.transcript)
        ? (row.transcript as LiveTranscriptLine[])
        : [],
      started_at: (row.started_at as string | null) ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Best-effort opportunistic cleanup of stale rows for a workspace so the table
 * never grows unbounded (no cron needed). Removes ended rows older than 1h and
 * any row not updated in 2h (ghost/abandoned sessions).
 */
export async function cleanupStaleLiveCallSessions(workspaceId: string): Promise<void> {
  if (!workspaceId) return;
  try {
    const endedCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const staleCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from("live_call_sessions")
      .delete()
      .eq("workspace_id", workspaceId)
      .not("ended_at", "is", null)
      .lt("ended_at", endedCutoff);
    await supabaseAdmin
      .from("live_call_sessions")
      .delete()
      .eq("workspace_id", workspaceId)
      .lt("updated_at", staleCutoff);
  } catch {
    /* best-effort */
  }
}
