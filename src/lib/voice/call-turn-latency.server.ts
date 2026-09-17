/**
 * Persist per-turn voice latency.
 *
 * Called from the live gateway at the end of each turn, so the one rule that
 * matters is that it must never slow a call down or break one: every write is
 * fire-and-forget and every failure is swallowed after a warning. Losing a
 * latency row is an inconvenience; adding a blocking round trip to a live
 * conversation is the exact problem this data exists to solve.
 */
// Relative, not the "@/" alias: voice-gateway.plugin.ts statically imports
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
};

function toRow(ctx: CallTurnContext, rec: TurnLatencyRecord) {
  return {
    workspace_id: ctx.workspaceId,
    call_id: ctx.callId,
    turn_index: rec.turnIndex,
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
  };
}

/**
 * Write one turn. Upserts on (call_id, turn_index) so a retried flush cannot
 * double-count a turn in the percentiles.
 */
export async function recordCallTurnLatency(
  ctx: CallTurnContext,
  rec: TurnLatencyRecord,
): Promise<void> {
  if (!ctx.workspaceId || !ctx.callId) return;
  try {
    const { error } = await (supabaseAdmin as any)
      .from("call_turns")
      .upsert(toRow(ctx, rec), { onConflict: "call_id,turn_index" });
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
