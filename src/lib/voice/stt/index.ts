/**
 * Speech-to-text provider selection.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { DeepgramSttProvider } from "./deepgram";
import { WhisperSttProvider } from "./whisper-batch";
import type { SttProvider } from "./types";

export { DeepgramSttProvider } from "./deepgram";
export { WhisperSttProvider } from "./whisper-batch";
export { CASCADE_SAMPLE_RATE, buildWav, whisperTranscribe } from "./whisper";
export type { SttOpenOptions, SttProvider, SttSession } from "./types";

export type SttProviderName = "deepgram" | "whisper";

export interface SttProviderKeys {
  deepgramApiKey?: string;
  openaiApiKey?: string;
}

/** Providers with credentials available, best first. */
export function availableSttProviders(keys: SttProviderKeys = {}): SttProviderName[] {
  const deepgram = keys.deepgramApiKey ?? process.env.DEEPGRAM_API_KEY ?? "";
  const openai = keys.openaiApiKey ?? process.env.OPENAI_API_KEY ?? "";
  const out: SttProviderName[] = [];
  if (deepgram) out.push("deepgram");
  if (openai) out.push("whisper");
  return out;
}

/**
 * Resolve an STT provider.
 *
 * Deepgram wins by default because streaming recognition removes the whole
 * transcription from the turn's latency budget. Whisper is the fallback so a
 * workspace with only an OpenAI key still works.
 */
export function createSttProvider(
  preferred: SttProviderName | null | undefined,
  keys: SttProviderKeys = {},
): SttProvider {
  const deepgramKey = keys.deepgramApiKey ?? process.env.DEEPGRAM_API_KEY ?? "";
  const openaiKey = keys.openaiApiKey ?? process.env.OPENAI_API_KEY ?? "";

  if (preferred === "deepgram") {
    if (!deepgramKey) throw new Error("Deepgram requested but DEEPGRAM_API_KEY is not set");
    return new DeepgramSttProvider(deepgramKey);
  }
  if (preferred === "whisper") {
    if (!openaiKey) throw new Error("Whisper requested but OPENAI_API_KEY is not set");
    return new WhisperSttProvider(openaiKey);
  }

  if (deepgramKey) return new DeepgramSttProvider(deepgramKey);
  if (openaiKey) return new WhisperSttProvider(openaiKey);
  throw new Error("No STT provider configured: set DEEPGRAM_API_KEY or OPENAI_API_KEY");
}
