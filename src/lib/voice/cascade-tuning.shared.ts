/**
 * Map Builder speech settings → cascade VAD / barge-in parameters.
 *
 * Browser mic chunks are ~50 ms (1200 samples @ 24 kHz), so silence frame counts
 * translate directly to perceived response delay.
 */
import type { EndpointingOptions } from "./vad/types";

/** Approximate ms per VAD frame in the browser relay path. */
export const BROWSER_VAD_FRAME_MS = 50;

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

  // Retell-like: ~400–500 ms hangover. Addresses still get extra wait via coalesce.
  let silenceMs = input.silenceDurationMs;
  if (silenceMs == null || silenceMs <= 0) {
    silenceMs = responsiveness >= 1.2 ? 400 : responsiveness >= 0.8 ? 500 : 700;
  }
  silenceMs = clamp(silenceMs, 300, 1200);

  const silenceFramesTrigger = Math.max(4, Math.round(silenceMs / BROWSER_VAD_FRAME_MS));
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
