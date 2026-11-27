/**
 * Persist per-turn voice latency.
 *
 * Called from the live gateway at the end of each turn, so the one rule that
 * matters is that it must never slow a call down or break one: every write is
 * fire-and-forget and every failure is swallowed after a warning. Losing a
 * latency row is an inconvenience; adding a blocking round trip to a live
 * conversation is the exact problem this data exists to solve.
 */
// Relative, not the "@/" alias: dev-plugins/voice-gateway.plugin.ts statically imports
// gateway/mount, so everything reachable from it gets bundled into
// vite.config.ts, where "@/" does not resolve and the config fails to load.
import { supabaseAdmin } from "../../integrations/supabase/client.server";
import type { TurnLatencyRecord } from "./graph/latency-trace";

export type CallTurnContext = {
  workspaceId: string;
  callId: string;
  nodeId?: string | null;
  engine?: string | null;
  agentId?: string | null;
  isTestCall?: boolean;
  llmProvider?: string | null;
  ttsProvider?: string | null;
  sttProvider?: string | null;
};

function toRow(ctx: CallTurnContext, rec: TurnLatencyRecord) {
  return {
    workspace_id: ctx.workspaceId,
    call_id: ctx.callId,
    turn_index: rec.turnIndex,
    voice_end_to_first_audio_ms: rec.voiceEndToFirstAudioMs,
    end_of_speech_wait_ms: rec.endOfSpeechWaitMs,
    speech_to_first_audio_ms: rec.speechToFirstAudioMs,
    endpoint_to_stt_final_ms: rec.endpointToSttFinalMs,
    stt_to_route_ms: rec.sttToRouteMs,
    stt_to_node_loaded_ms: rec.sttToNodeLoadedMs,
    stt_to_first_token_ms: rec.sttToFirstTokenMs,
    stt_to_first_sentence_ms: rec.sttToFirstSentenceMs,
    stt_to_first_audio_ms: rec.sttToFirstAudioMs,
    hangover_ms: rec.hangoverMs,
    held_for_incomplete: rec.heldForIncomplete,
    edge_route_method: rec.edgeRouteMethod,
    global_route_method: rec.globalRouteMethod,
    speculative_hit: rec.speculativeHit,
    partial_commit: rec.partialCommit,
    interrupted: rec.interrupted,
    node_id: ctx.nodeId ?? null,
    engine: ctx.engine ?? "webee_native",
    agent_id: ctx.agentId ?? null,
    is_test_call: ctx.isTestCall ?? false,
    llm_provider: ctx.llmProvider ?? null,
    llm_model: rec.llmModel,
    tts_provider: ctx.ttsProvider ?? null,
    stt_provider: ctx.sttProvider ?? null,
    prompt_chars: rec.promptChars,
    stt_to_llm_request_ms: rec.sttToLlmRequestMs,
    stt_to_first_speakable_ms: rec.sttToFirstSpeakableMs,
    full_turn_ms: rec.fullTurnMs,
    speech_end_reference: rec.speechEndReference,
    llm_service_tier: rec.llmServiceTier,
  };
}

/** Columns added after the table; a database without them yet still gets the rest of the row. */
const NEWER_COLUMNS = [
  "voice_end_to_first_audio_ms",
  "end_of_speech_wait_ms",
  // 20261127000000_call_turns_turn_timings.sql
  "stt_to_first_speakable_ms",
  "full_turn_ms",
  "speech_end_reference",
  "llm_service_tier",
] as const;
/**
 * Columns this database has reported missing — left out of later writes. Forgotten after a few
 * minutes, so a migration applied while the server is running is picked up without a restart.
 */
const missingColumns = new Set<string>();
const MISSING_COLUMN_RECHECK_MS = 5 * 60_000;
let missingColumnsSince = 0;

/** The newer column a write was refused for, from PostgREST's "Could not find the 'x' column". */
function missingColumnIn(message: string): string | null {
  return NEWER_COLUMNS.find((c) => message.includes(`'${c}'`) || message.includes(`"${c}"`)) ??
    NEWER_COLUMNS.find((c) => message.includes(c) && !missingColumns.has(c)) ??
    null;
}

/**
 * Write one turn. Upserts on (call_id, turn_index) so a retried flush cannot
 * double-count a turn in the percentiles.
 *
 * A database that has not run a migration yet refuses the whole row over one unknown column. Only
 * that column is dropped and the row retried, so every figure the database can hold is kept —
 * dropping every newer column at once lost caller wait and endpointing until the newest migration ran.
 */
export async function recordCallTurnLatency(
  ctx: CallTurnContext,
  rec: TurnLatencyRecord,
): Promise<void> {
  if (!ctx.workspaceId || !ctx.callId) return;
  const upsert = (row: Record<string, unknown>) =>
    (supabaseAdmin as any).from("call_turns").upsert(row, { onConflict: "call_id,turn_index" });
  try {
    const row: Record<string, unknown> = toRow(ctx, rec);
    if (missingColumns.size && Date.now() - missingColumnsSince > MISSING_COLUMN_RECHECK_MS) missingColumns.clear();
    for (const c of missingColumns) delete row[c];
    let { error } = await upsert(row);
    for (let tries = 0; error && tries < NEWER_COLUMNS.length; tries++) {
      const column = missingColumnIn(error.message);
      if (!column || !(column in row)) break;
      if (missingColumns.size === 0) missingColumnsSince = Date.now();
      missingColumns.add(column);
      delete row[column];
      console.warn(`[call-turn-latency] call_turns has no ${column} yet — apply the latest call_turns migration`);
      ({ error } = await upsert(row));
    }
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn("[call-turn-latency] write failed", {
      callId: ctx.callId,
      turn: rec.turnIndex,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Fire-and-forget wrapper for use on a live call path. */
export function recordCallTurnLatencyAsync(
  ctx: CallTurnContext,
  rec: TurnLatencyRecord,
): void {
  void recordCallTurnLatency(ctx, rec);
}
