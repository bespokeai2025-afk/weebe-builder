/**
 * `sttMode` / `vocabSpecialization` — Deepgram tuning knobs stored from the builder and read by
 * nobody: `DeepgramSttProvider` always transcribed on the hardcoded default model regardless of
 * what the agent configured.
 *
 * Deepgram's real model catalog is the mapping surface here: `nova-2` is the accurate general
 * model, `base` is the cheaper/faster tier, `nova-2-medical` is the domain model for clinical
 * vocabulary. `sttMode: "custom"` has no distinct Deepgram model to map to — it falls back to the
 * same accurate general model as "accurate" rather than silently inventing a model name Deepgram
 * doesn't have.
 *
 * `denoisingMode` is deliberately NOT handled here — Deepgram's streaming `listen` endpoint (see
 * `buildDeepgramListenUrl`) has no noise-cancellation query parameter to map it to, and Fish's
 * realtime ASR has no such option either. Wiring it would mean inventing a parameter that doesn't
 * exist on either provider, so it stays unwired until a provider actually supports it.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

export function resolveDeepgramModel(
  settings: Record<string, unknown> | null | undefined,
): string | undefined {
  const vocab = settings?.vocabSpecialization;
  if (vocab === "medical") return "nova-2-medical";

  const mode = settings?.sttMode;
  if (mode === "fast") return "base";
  if (mode === "accurate" || mode === "custom") return "nova-2";
  return undefined;
}
