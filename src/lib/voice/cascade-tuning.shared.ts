/**
 * Map Builder speech settings → cascade VAD / barge-in parameters.
 *
 * Every VAD setting here is a frame count, and a frame is `VAD_FRAME_MS` long on every transport:
 * the cascade session regroups caller audio into frames of that size before detection, because
 * transports send different sizes (browser 50 ms, Twilio 20 ms, the browser fallback ~85 ms) and a
 * frame count only means a duration when the frame size is fixed.
 */
import type { EndpointingOptions } from "./vad/types";

/** Default end-of-speech wait when the agent leaves it unset. */
export const DEFAULT_SILENCE_MS = 400;

/** Length of one VAD frame, in ms, on every transport (see the note at the top). */
export const VAD_FRAME_MS = 50;

export interface CascadeTuningInput {
  /** Builder hyperstreamSilenceDurationMs — ms of silence before end-of-speech. */
  silenceDurationMs?: number;
  /** 0–2, higher = agent responds sooner after caller stops. */
  responsiveness?: number;
  /** 0–1, higher = caller can interrupt more easily. */
  interruptionSensitivity?: number;
}

export interface CascadeTuning {
  vad: EndpointingOptions;
  bargeInSpeechFrames: number;
  silenceDurationMs: number;
  /** Wait after VAD endpoint before STT — merges "Street." + "Dubai." into one turn. */
  utteranceCoalesceMs: number;
}

export function resolveCascadeTuning(input: CascadeTuningInput = {}): CascadeTuning {
  const responsiveness = clamp(input.responsiveness ?? 1, 0, 2);
  const interruption = clamp(input.interruptionSensitivity ?? 0.7, 0, 1);

  // End-of-speech wait. It sits in front of every reply, so it is the cheapest latency to cut:
  // 400 ms by default. Complete short answers already drop to 250–350 ms and half-finished
  // sentences are held open to 900 ms (turn-commit.shared), so the base only covers the rest.
  let silenceMs = input.silenceDurationMs;
  if (silenceMs == null || silenceMs <= 0) {
    silenceMs = responsiveness >= 1.2 ? 350 : responsiveness >= 0.8 ? DEFAULT_SILENCE_MS : 600;
  }
  silenceMs = clamp(silenceMs, 300, 1200);

  const silenceFramesTrigger = Math.max(4, Math.round(silenceMs / VAD_FRAME_MS));
  // High interruption sensitivity → fewer frames to barge in (3 ≈ 150 ms, 10 ≈ 500 ms).
  const bargeInSpeechFrames = Math.max(3, Math.round(3 + (1 - interruption) * 7));

  return {
    silenceDurationMs: silenceMs,
    bargeInSpeechFrames,
    utteranceCoalesceMs: Math.min(320, Math.max(80, Math.round(silenceMs * 0.4))),
    vad: {
      silenceFramesTrigger,
      minSpeechFrames: 6,
      startFrames: 2,
      preRollFrames: 6,
    },
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export {
  resolveUtteranceCoalesceMs,
  resolveEndpointHangoverMs,
  looksLikeCommitReadyPartial,
  shouldSkipSttFinal,
} from "./turn-commit.shared";
