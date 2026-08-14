/**
 * Retell-shaped call lifecycle types.
 *
 * The native engine emits the same payloads Retell does so that everything
 * downstream of `/api/public/voice-webhook` — the 1300-line webhook processor,
 * WBAH, CRM dispatch, lead-gen, bookings, executive events — keeps working with
 * no changes. That inheritance is the single largest scope reduction available,
 * so these shapes are a contract, not an implementation detail: renaming a field
 * here silently drops a downstream feature.
 *
 * Field names mirror `RetellCall` in src/lib/retell/retell-webhook.processor.ts.
 *
 * NOTE: reachable from vite.config.ts via the gateway, so relative imports only.
 */

/** One finalised utterance. `ts` is wall-clock ms, used to order the transcript. */
export interface TranscriptTurn {
  role: "agent" | "user";
  text: string;
  ts: number;
}

/**
 * Why a call ended.
 *
 * Values match Retell's vocabulary because downstream code pattern-matches on
 * them: `no_answer`/`busy`/`voicemail` drive lead no-answer handling, and the
 * voicemail classifier keyword-matches this string. Inventing our own spelling
 * would quietly disable both.
 */
export type DisconnectionReason =
  | "user_hangup"
  | "agent_hangup"
  | "call_transfer"
  | "voicemail_reached"
  | "inactivity"
  | "max_duration_reached"
  | "dial_busy"
  | "dial_failed"
  | "dial_no_answer"
  | "error_llm_websocket_open"
  | "error_frontend_corrupted_payload"
  | "error_unknown";

export interface RetellCallAnalysis {
  call_summary?: string | null;
  /** "Positive" | "Neutral" | "Negative" — matched case-insensitively downstream. */
  user_sentiment?: string | null;
  call_successful?: boolean | null;
  in_voicemail?: boolean | null;
  custom_analysis_data?: Record<string, unknown>;
}

/** An entry of Retell's `transcript_object`, consumed by the live-call views. */
export interface RetellTranscriptEntry {
  role: "agent" | "user";
  content: string;
}

export interface RetellShapedCall {
  call_id: string;
  agent_id: string;
  agent_name?: string | null;
  /** `phone_call` reaches analytics; `web_call` is filtered as a builder test. */
  call_type: "phone_call" | "web_call";
  call_status: "registered" | "ongoing" | "ended" | "error";
  direction: "inbound" | "outbound";
  from_number?: string | null;
  to_number?: string | null;
  /** Epoch ms, matching Retell. */
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  disconnection_reason?: DisconnectionReason | string | null;
  transcript?: string;
  transcript_object?: RetellTranscriptEntry[];
  recording_url?: string | null;
  call_analysis?: RetellCallAnalysis;
  /** Campaign attribution. The processor re-verifies tenancy before trusting it. */
  metadata?: Record<string, unknown>;
  retell_llm_dynamic_variables?: Record<string, string>;
  /** `combined_cost` is USD cents, as Retell reports it. */
  call_cost?: { combined_cost: number; total_duration_seconds: number };
}

export type VoiceLifecycleEvent =
  | "call_started"
  | "transcript_updated"
  | "call_ended"
  | "call_analyzed"
  | "call_failed"
  | "call_transferred";

export interface VoiceWebhookPayload {
  event: VoiceLifecycleEvent;
  call: RetellShapedCall;
}

/**
 * A post-call extraction field, in the shape the builder already stores as
 * `post_call_analysis_data` (see src/lib/builder/export-conversation-flow.ts).
 */
export interface AnalysisField {
  name: string;
  description?: string;
  type?: "string" | "number" | "boolean" | "enum";
  choices?: string[];
  examples?: string[];
}
