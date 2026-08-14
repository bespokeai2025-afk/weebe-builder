/**
 * TTS provider resolution for the WEBEE native voice engine.
 *
 * Fish Audio is preferred when a key is available; ElevenLabs remains the
 * fallback so existing agents keep working during the migration.
 */
import { ElevenLabsTtsProvider } from "./elevenlabs.provider";
import { FishAudioTtsProvider } from "./fish.provider";
import type { TtsProvider } from "./types";

export type TtsProviderName = "fish" | "elevenlabs";

export {
  alignPcm16,
  batchIntoSentences,
  type PcmChunk,
  type TtsLatencyMode,
  type TtsProvider,
  type TtsVoiceRequest,
} from "./types";
export { ElevenLabsTtsProvider } from "./elevenlabs.provider";
export { FishAudioTtsProvider } from "./fish.provider";

export interface TtsProviderKeys {
  /** Per-workspace override; falls back to the platform env key. */
  fishApiKey?: string | null;
  elevenLabsApiKey?: string | null;
}

/** Which providers currently have a usable key. */
export function availableTtsProviders(keys: TtsProviderKeys = {}): TtsProviderName[] {
  const available: TtsProviderName[] = [];
  if (keys.fishApiKey || process.env.FISH_API_KEY) available.push("fish");
  if (keys.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY) available.push("elevenlabs");
  return available;
}

/**
 * Build a TTS provider.
 *
 * `preferred` is honoured when that provider has a key; otherwise the first
 * available provider is used so a missing per-workspace key degrades to the
 * platform default rather than failing the call.
 */
export function createTtsProvider(
  preferred: TtsProviderName | null | undefined,
  keys: TtsProviderKeys = {},
): TtsProvider {
  const fishKey = keys.fishApiKey || process.env.FISH_API_KEY || "";
  const elKey = keys.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY || "";

  const order: TtsProviderName[] =
    preferred === "elevenlabs" ? ["elevenlabs", "fish"] : ["fish", "elevenlabs"];

  for (const name of order) {
    if (name === "fish" && fishKey) return new FishAudioTtsProvider(fishKey);
    if (name === "elevenlabs" && elKey) return new ElevenLabsTtsProvider(elKey);
  }

  throw new Error("No TTS provider configured — set FISH_API_KEY or ELEVENLABS_API_KEY");
}
