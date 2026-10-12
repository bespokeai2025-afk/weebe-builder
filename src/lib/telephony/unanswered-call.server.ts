/**
 * Report a native outbound call that never connected — no answer, busy, or a failed dial.
 *
 * A connected call is reported by its voice-engine lifecycle. A call that is never answered never
 * opens the audio stream, so nothing reported it and the lead/campaign never learned the outcome.
 * Retell reports these as an ended call with `dial_no_answer` / `dial_busy`; this sends the same
 * pair of events (`call_ended`, then `call_analyzed`) the processor already handles, with
 * `call_status` set so its no-answer handling (lead → no_answer → back in the retry queue) runs.
 */
import { emitVoiceEvent } from "../voice/lifecycle/webhook";
import type { RetellShapedCall, VoiceWebhookPayload } from "../voice/lifecycle/types";

export interface UnansweredCallRow {
  id: string;
  agent_id: string | null;
  workspace_id: string;
  direction: string;
  status: string;
  from_number: string | null;
  to_number: string | null;
  campaign_id: string | null;
  started_at: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Statuses that mean the call already reached a person (or the engine), or was already reported
 * as finished — a repeated Twilio callback must not send the events twice.
 */
const ALREADY_SETTLED = new Set(["active", "answered", "completed", "transferred", "voicemail", "failed"]);

/** Twilio terminal status → Retell's call_status / disconnection_reason, or null when connected. */
export function unansweredOutcome(
  twilioStatus: string,
): { callStatus: "no_answer" | "busy" | "error"; reason: string } | null {
  switch (twilioStatus) {
    case "no-answer":
      return { callStatus: "no_answer", reason: "dial_no_answer" };
    case "busy":
      return { callStatus: "busy", reason: "dial_busy" };
    case "failed":
    case "canceled":
      return { callStatus: "error", reason: "dial_failed" };
    default:
      return null;
  }
}

/** The two events to send, or [] when this status change isn't an unanswered outbound call. */
export function buildUnansweredCallEvents(
  row: UnansweredCallRow,
  twilioStatus: string,
  now: number = Date.now(),
): VoiceWebhookPayload[] {
  if (row.direction !== "outbound" || !row.agent_id) return [];
  if (ALREADY_SETTLED.has(row.status)) return [];
  const outcome = unansweredOutcome(twilioStatus);
  if (!outcome) return [];

  const meta = row.metadata ?? {};
  const callMetadata =
    meta.call_metadata && typeof meta.call_metadata === "object" ? (meta.call_metadata as Record<string, unknown>) : {};
  const dynamic =
    meta.dynamic_variables && typeof meta.dynamic_variables === "object"
      ? (meta.dynamic_variables as Record<string, string>)
      : undefined;
  const started = row.started_at ? Date.parse(row.started_at) : now;

  const call: RetellShapedCall = {
    call_id: row.id,
    agent_id: row.agent_id,
    call_type: "phone_call",
    call_status: outcome.callStatus as RetellShapedCall["call_status"],
    direction: "outbound",
    from_number: row.from_number,
    to_number: row.to_number,
    start_timestamp: Number.isFinite(started) ? started : now,
    end_timestamp: now,
    duration_ms: 0,
    disconnection_reason: outcome.reason,
    transcript: "",
    transcript_object: [],
    metadata: {
      ...callMetadata,
      engine: "webee_native",
      workspace_id: row.workspace_id,
      ...(row.campaign_id ? { campaign_id: row.campaign_id } : {}),
    },
    ...(dynamic ? { retell_llm_dynamic_variables: dynamic } : {}),
  };
  const analysis = {
    call_summary:
      outcome.callStatus === "busy"
        ? "The line was busy; the call did not connect."
        : outcome.callStatus === "no_answer"
          ? "The call was not answered."
          : "The call could not be placed.",
    user_sentiment: "Neutral",
    call_successful: false,
    in_voicemail: false,
    custom_analysis_data: {},
  };
  return [
    { event: "call_ended", call },
    { event: "call_analyzed", call: { ...call, call_analysis: analysis } },
  ];
}

/** Send them in order — `call_ended` must land before `call_analyzed` (both upsert one row). */
export async function reportUnansweredCall(
  row: UnansweredCallRow,
  twilioStatus: string,
  emit: (payload: VoiceWebhookPayload) => Promise<unknown> = emitVoiceEvent,
): Promise<number> {
  const events = buildUnansweredCallEvents(row, twilioStatus);
  for (const event of events) await emit(event);
  return events.length;
}
