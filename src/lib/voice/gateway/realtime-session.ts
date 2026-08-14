/**
 * Shared OpenAI Realtime session setup for the voice gateways.
 *
 * Centralised because the telephony and FreJun relays each carried their own
 * copy of a session.update payload written against the pre-GA API, which had
 * three independent breakages (see .agents/memory/hyperstream-relay-pitfalls.md):
 *
 *   1. model `gpt-4o-realtime-preview-2024-12-17` no longer exists
 *   2. header `OpenAI-Beta: realtime=v1` now fails with beta_api_shape_disabled
 *   3. the flat schema (`input_audio_format`, top-level `voice`/`turn_detection`)
 *      is rejected with unknown_parameter — `gpt-realtime` needs the nested
 *      `audio.input` / `audio.output` shape and a `session.type`
 *
 * Keeping one builder means a future API change is a single edit.
 */
import { WebSocket } from "ws";

/** Undated stable alias. Dated preview models get retired without notice. */
export const REALTIME_MODEL = "gpt-realtime";

/** Realtime speaks PCM16 at 24 kHz in both directions. */
export const REALTIME_SAMPLE_RATE = 24000;

export type TurnDetectionMode = "server_vad" | "semantic_vad";

export interface RealtimeSessionConfig {
  instructions: string;
  voice: string;
  turnDetection?: TurnDetectionMode;
  /** Only meaningful for semantic_vad; "low" waits longest before taking the turn. */
  eagerness?: "low" | "medium" | "high" | "auto";
  /** Enable input transcription so callers' words can be logged. */
  transcribe?: boolean;
}

/**
 * Build the `session.update` frame for `gpt-realtime`.
 *
 * `session.type` is required on every update, and any field outside the nested
 * audio shape is rejected outright.
 */
export function buildSessionUpdate(config: RealtimeSessionConfig): string {
  const mode = config.turnDetection ?? "server_vad";

  const turn_detection: Record<string, unknown> =
    mode === "semantic_vad"
      ? {
          type: "semantic_vad",
          // A model decides when the caller is actually finished instead of a
          // fixed silence timer, so the agent stops cutting people off.
          eagerness: config.eagerness ?? "low",
          create_response: true,
          interrupt_response: true,
        }
      : {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
          create_response: true,
          interrupt_response: true,
        };

  const input: Record<string, unknown> = {
    format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE },
    turn_detection,
  };
  if (config.transcribe) {
    input.transcription = { model: "whisper-1" };
  }

  return JSON.stringify({
    type: "session.update",
    session: {
      type: "realtime",
      output_modalities: ["audio"],
      instructions: config.instructions,
      audio: {
        input,
        output: {
          format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE },
          voice: config.voice,
        },
      },
    },
  });
}

/**
 * Open a Realtime socket with the correct auth.
 *
 * Deliberately no `OpenAI-Beta` header — sending it closes the socket with
 * 4000 beta_api_shape_disabled.
 */
export function openRealtimeSocket(apiKey: string, model: string = REALTIME_MODEL): WebSocket {
  return new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

/**
 * Resolve a stored per-agent model to one that still exists.
 *
 * Agent rows created before the GA cutover have retired dated preview ids
 * saved in settings; honouring those would fail every call.
 */
export function resolveRealtimeModel(stored: unknown): string {
  const name = typeof stored === "string" ? stored.trim() : "";
  if (!name) return REALTIME_MODEL;
  // Any dated `-preview-YYYY-MM-DD` realtime id is retired.
  if (/realtime-preview/.test(name)) return REALTIME_MODEL;
  return name;
}

/**
 * True when an event carries output audio.
 *
 * GA renamed `response.audio.delta` to `response.output_audio.delta`; accept
 * both so the gateways keep working across the rename in either direction.
 */
export function isAudioDeltaEvent(type: unknown): boolean {
  return type === "response.output_audio.delta" || type === "response.audio.delta";
}

/** True when an event carries the agent's finished spoken text. */
export function isAgentTranscriptDoneEvent(type: unknown): boolean {
  return (
    type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done"
  );
}

/** True when an event carries a completed transcription of caller speech. */
export function isUserTranscriptDoneEvent(type: unknown): boolean {
  return type === "conversation.item.input_audio_transcription.completed";
}
