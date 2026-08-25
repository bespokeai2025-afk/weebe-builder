/**
 * TTS provider resolution for the WEBEE native voice engine.
 *
 * WEBEE Native uses Fish Audio only (FISH_API_KEY).
 */
import { FishAudioTtsProvider } from "./fish.provider";
import type { TtsProvider } from "./types";

export type TtsProviderName = "fish";

export {
  alignPcm16,
  batchIntoSentences,
  batchForVoiceLatency,
  normalizeSpeechText,
  splitSpeakableChunks,
  type PcmChunk,
  type TtsLatencyMode,
  type TtsProvider,
  type TtsVoiceRequest,
} from "./types";
export {
  FishAudioTtsProvider,
  FISH_TTS_DEFAULT_MODEL,
  resolveFishTtsModel,
} from "./fish.provider";

export interface TtsProviderKeys {
  fishApiKey?: string | null;
  /** Fish TTS model header (defaults to s2.1-pro-free). */
  fishTtsModel?: string | null;
}

/** Fish Audio when FISH_API_KEY is configured. */
export function availableTtsProviders(keys: TtsProviderKeys = {}): TtsProviderName[] {
  return keys.fishApiKey || process.env.FISH_API_KEY ? ["fish"] : [];
}

/** Build the Fish Audio TTS provider (WEBEE Native only). */
export function createTtsProvider(
  _preferred: TtsProviderName | null | undefined,
  keys: TtsProviderKeys = {},
): TtsProvider {
  const fishKey = keys.fishApiKey || process.env.FISH_API_KEY || "";
  if (!fishKey) throw new Error("Fish TTS requires FISH_API_KEY");
  return new FishAudioTtsProvider(fishKey, { model: keys.fishTtsModel });
}
