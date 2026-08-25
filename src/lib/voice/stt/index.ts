/**
 * Speech-to-text provider selection for WEBEE Native.
 *
 * WEBEE Native uses Fish Audio ASR only (same FISH_API_KEY as TTS).
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { FishSttProvider } from "./fish";
import type { SttProvider } from "./types";

export { FishSttProvider, fishTranscribe, type FishAsrResponse } from "./fish";
export { CASCADE_SAMPLE_RATE, buildWav } from "./whisper";
export type { SttOpenOptions, SttProvider, SttSession } from "./types";

export type SttProviderName = "fish";

export interface SttProviderKeys {
  fishApiKey?: string;
}

/** Fish ASR when FISH_API_KEY is configured. */
export function availableSttProviders(keys: SttProviderKeys = {}): SttProviderName[] {
  const fish = keys.fishApiKey ?? process.env.FISH_API_KEY ?? "";
  return fish ? ["fish"] : [];
}

/** WEBEE Native always uses Fish ASR. */
export function resolveWebeeSttPreference(
  _settings?: Record<string, unknown> | null,
  keys: SttProviderKeys = {},
): SttProviderName | null {
  const fishKey = keys.fishApiKey ?? process.env.FISH_API_KEY ?? "";
  return fishKey ? "fish" : null;
}

/** @deprecated Alias for resolveWebeeSttPreference — WEBEE Native is Fish-only. */
export const resolveEffectiveSttProvider = resolveWebeeSttPreference;

/** Build the Fish Audio STT provider (WEBEE Native only). */
export function createSttProvider(
  _preferred: SttProviderName | null | undefined,
  keys: SttProviderKeys = {},
): SttProvider {
  const fishKey = keys.fishApiKey ?? process.env.FISH_API_KEY ?? "";
  if (!fishKey) throw new Error("Fish ASR requires FISH_API_KEY");
  return new FishSttProvider(fishKey);
}
