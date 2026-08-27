/**
 * Generic WEBEE Native voice-runtime configuration.
 *
 * Workflow-independent defaults for endpointing, interruption, streaming TTS,
 * playback and response cancellation. Builder settings map in via resolveVoiceRuntimeConfig.
 */

import { resolveCascadeTuning, type CascadeTuningInput } from "./cascade-tuning.shared";

export type VoiceAudioState =
  | "idle"
  | "listening"
  | "thinking"
  | "generating"
  | "speaking"
  | "interrupted"
  | "cancelled";

export interface VoiceRuntimeConfig {
  endpointing: {
    silenceDurationMs: number;
    utteranceCoalesceMs: number;
    minSpeechFrames: number;
  };
  interruption: {
    /** Stop browser/carrier playback on VAD speech_start (when RMS passes threshold). */
    immediateClearOnSpeechStart: boolean;
    /** Consecutive speech frames before aborting LLM/TTS turn. */
    bargeInSpeechFrames: number;
    /** Ignore quiet VAD during agent speech (likely echo). */
    bargeInMinRms: number;
    /** RMS that always triggers immediate clear, even during opening grace. */
    bargeInLoudRms: number;
    /** Ignore barge-in abort for this long after agent audio starts. */
    openingGraceMs: number;
    /** After TTS send completes, ignore quiet echo unless loud. */
    postTtsGraceMs: number;
    interruptibleResponse: boolean;
  };
  tts: {
    streamingEnabled: boolean;
    chunkMaxChars: number;
    firstFlushChars: number;
    staticChunkMaxChars: number;
  };
  playback: {
    playbackTimeoutMs: number;
    /** Reset scheduled playhead when the queue drains (prevents mid-utterance silence). */
    resyncOnQueueDrain: boolean;
  };
  llm: {
    timeoutMs: number;
  };
}

const DEFAULTS: VoiceRuntimeConfig = {
  endpointing: {
    silenceDurationMs: 500,
    utteranceCoalesceMs: 200,
    minSpeechFrames: 6,
  },
  interruption: {
    /** When false, audio.clear only fires together with turn cancel (avoids silent stuck state). */
    immediateClearOnSpeechStart: false,
    bargeInSpeechFrames: 8,
    bargeInMinRms: 2200,
    bargeInLoudRms: 2800,
      openingGraceMs: 1800,
    postTtsGraceMs: 700,
    interruptibleResponse: true,
  },
  tts: {
    streamingEnabled: true,
    chunkMaxChars: 160,
    firstFlushChars: 12,
    staticChunkMaxChars: 120,
  },
  playback: {
    playbackTimeoutMs: 30_000,
    resyncOnQueueDrain: true,
  },
  llm: {
    timeoutMs: 25_000,
  },
};

export function resolveVoiceRuntimeConfig(input: CascadeTuningInput = {}): VoiceRuntimeConfig {
  const tuning = resolveCascadeTuning(input);
  const interruption = input.interruptionSensitivity ?? 0.7;
  const responsive = input.responsiveness ?? 1;

  return {
    endpointing: {
      silenceDurationMs: tuning.silenceDurationMs,
      utteranceCoalesceMs: tuning.utteranceCoalesceMs,
      minSpeechFrames: tuning.vad.minSpeechFrames ?? DEFAULTS.endpointing.minSpeechFrames,
    },
    interruption: {
      immediateClearOnSpeechStart: false,
      bargeInSpeechFrames: tuning.bargeInSpeechFrames,
      bargeInMinRms:
        interruption >= 0.85
          ? 2000
          : interruption >= 0.55
            ? DEFAULTS.interruption.bargeInMinRms
            : 2400,
      bargeInLoudRms: DEFAULTS.interruption.bargeInLoudRms,
      openingGraceMs:
        responsive >= 1.2 ? 1500 : responsive >= 0.8 ? DEFAULTS.interruption.openingGraceMs : 2000,
      postTtsGraceMs: DEFAULTS.interruption.postTtsGraceMs,
      interruptibleResponse: true,
    },
    tts: { ...DEFAULTS.tts },
    playback: { ...DEFAULTS.playback },
    llm: { ...DEFAULTS.llm },
  };
}

export { DEFAULTS as VOICE_RUNTIME_DEFAULTS };
