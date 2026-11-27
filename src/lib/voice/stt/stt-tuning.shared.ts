/**
 * `sttMode` / `vocabSpecialization` → Deepgram model.
 *
 * The model choice now lives in `providers/deepgram.config.shared.ts` (`resolveDeepgramSttModel`),
 * with the rest of Deepgram's configuration. `sttMode` used to pick the model — "fast" mapped to
 * Deepgram's legacy `base` model, which on the same clip heard "a free hold… Ar job Ver ronnie… the
 * Ein n" where Nova-3 heard every word right, and Nova-3 is as fast. A medical vocabulary still
 * picks the medical model.
 *
 * `denoisingMode` is deliberately NOT handled here — Deepgram's streaming `listen` endpoint has no
 * noise-cancellation query parameter to map it to.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */
import { resolveDeepgramSttModel } from "../providers/deepgram.config.shared";

export function resolveDeepgramModel(settings: Record<string, unknown> | null | undefined): string {
  return resolveDeepgramSttModel(settings);
}
