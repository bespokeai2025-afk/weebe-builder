/**
 * TTS provider resolution for the WEBEE native voice engine.
 *
 * Fish Audio (FISH_API_KEY) or OpenAI (OPENAI_API_KEY). Fish stays the default because it accepts
 * the output sample rate natively and streams input tokens; OpenAI returns a fixed 24 kHz and has
 * no input streaming, so its provider resamples and batches by clause.
 */
import { FishAudioTtsProvider } from "./fish.provider";
import { OpenAiTtsProvider } from "./openai.provider";
import type { TtsProvider } from "./types";

export type TtsProviderName = "fish" | "openai";

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
export {
  OpenAiTtsProvider,
  OPENAI_TTS_DEFAULT_MODEL,
  OPENAI_TTS_DEFAULT_VOICE,
  OPENAI_TTS_VOICES,
  resamplePcm16,
  resolveOpenAiTtsModel,
  resolveOpenAiTtsVoice,
} from "./openai.provider";

export interface TtsProviderKeys {
  fishApiKey?: string | null;
  /** Fish TTS model header (defaults to s2.1-pro-free). */
  fishTtsModel?: string | null;
  openaiApiKey?: string | null;
  /** OpenAI speech model (defaults to gpt-4o-mini-tts). */
  openaiTtsModel?: string | null;
  /** Delivery direction for gpt-4o-*-tts, e.g. "Warm, unhurried, British English." */
  openaiTtsInstructions?: string | null;
}

export function parseTtsProviderName(value: unknown): TtsProviderName | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "openai" || raw === "fish") return raw;
  return null;
}

function fishKeyOf(keys: TtsProviderKeys): string {
  return String(keys.fishApiKey ?? process.env.FISH_API_KEY ?? "").trim();
}

function openaiKeyOf(keys: TtsProviderKeys): string {
  return String(keys.openaiApiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
}

/** Providers that have a key right now. */
export function availableTtsProviders(keys: TtsProviderKeys = {}): TtsProviderName[] {
  const out: TtsProviderName[] = [];
  if (fishKeyOf(keys)) out.push("fish");
  if (openaiKeyOf(keys)) out.push("openai");
  return out;
}

/**
 * Build the requested TTS provider.
 *
 * An explicit choice is honoured even when its key is missing, so the call fails naming the
 * provider the agent actually asked for rather than silently speaking in a different voice.
 */
export function createTtsProvider(
  preferred: TtsProviderName | null | undefined,
  keys: TtsProviderKeys = {},
): TtsProvider {
  if (preferred === "openai") {
    const key = openaiKeyOf(keys);
    if (!key) throw new Error("OpenAI TTS requires OPENAI_API_KEY");
    return new OpenAiTtsProvider(key, {
      model: keys.openaiTtsModel,
      instructions: keys.openaiTtsInstructions,
    });
  }
  const fishKey = fishKeyOf(keys);
  if (!fishKey) throw new Error("Fish TTS requires FISH_API_KEY");
  return new FishAudioTtsProvider(fishKey, { model: keys.fishTtsModel });
}
