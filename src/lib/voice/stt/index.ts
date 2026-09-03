/**
 * Speech-to-text provider selection for WEBEE Native.
 *
 * TTS stays Fish Audio. STT is Fish realtime ASR by default, or Deepgram
 * Nova-2 when the agent sets `webeeSttProvider: "deepgram"`.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { DeepgramSttProvider } from "./deepgram";
import { FishSttProvider } from "./fish";
import type { SttProvider } from "./types";

export { FishSttProvider, fishTranscribe, type FishAsrResponse } from "./fish";
export { DeepgramSttProvider } from "./deepgram";
export { applyKeywordBoost, keywordBoostPrompt } from "./keyword-boost.shared";
export { lookupWorkspaceVoiceApiKey } from "./workspace-key";
export { CASCADE_SAMPLE_RATE, buildWav } from "./whisper";
export type { SttOpenOptions, SttProvider, SttSession } from "./types";

export type SttProviderName = "fish" | "deepgram";

export interface SttProviderKeys {
  fishApiKey?: string;
  deepgramApiKey?: string;
}

export function parseSttProviderName(value: unknown): SttProviderName | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "deepgram" || raw === "fish") return raw;
  return null;
}

function fishKeyOf(keys: SttProviderKeys = {}): string {
  return String(keys.fishApiKey ?? process.env.FISH_API_KEY ?? "").trim();
}

function deepgramKeyOf(keys: SttProviderKeys = {}): string {
  return String(keys.deepgramApiKey ?? process.env.DEEPGRAM_API_KEY ?? "").trim();
}

/** Providers that have a key right now. */
export function availableSttProviders(keys: SttProviderKeys = {}): SttProviderName[] {
  const out: SttProviderName[] = [];
  if (fishKeyOf(keys)) out.push("fish");
  if (deepgramKeyOf(keys)) out.push("deepgram");
  return out;
}

/**
 * Agent STT choice. Default is Fish. An explicit Deepgram selection is kept
 * even without a key so `createSttProvider` can fail with a Deepgram message
 * instead of silently swapping engines.
 */
export function resolveWebeeSttPreference(
  settings?: Record<string, unknown> | null,
  keys: SttProviderKeys = {},
): SttProviderName | null {
  const requested = parseSttProviderName(settings?.webeeSttProvider);
  if (requested === "deepgram") return "deepgram";
  if (requested === "fish") return fishKeyOf(keys) ? "fish" : null;
  return fishKeyOf(keys) ? "fish" : deepgramKeyOf(keys) ? "deepgram" : null;
}

/** @deprecated Alias for resolveWebeeSttPreference. */
export const resolveEffectiveSttProvider = resolveWebeeSttPreference;

/** Build the STT provider for WEBEE Native (Fish TTS is unchanged). */
export function createSttProvider(
  preferred: SttProviderName | null | undefined,
  keys: SttProviderKeys = {},
): SttProvider {
  const want = preferred === "deepgram" ? "deepgram" : "fish";
  if (want === "deepgram") {
    const key = deepgramKeyOf(keys);
    if (!key) {
      throw new Error(
        "Deepgram ASR requires DEEPGRAM_API_KEY. Add it under Settings → Integrations → Voice Engines.",
      );
    }
    return new DeepgramSttProvider(key);
  }
  const fishKey = fishKeyOf(keys);
  if (!fishKey) throw new Error("Fish ASR requires FISH_API_KEY");
  return new FishSttProvider(fishKey);
}
