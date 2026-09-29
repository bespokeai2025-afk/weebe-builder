/**
 * `enableDynamicVoiceSpeed` — Retell speeds up short interjections/quick lines and eases off
 * on longer, information-dense ones, rather than speaking every line at one fixed pace.
 *
 * Voice profile (`voiceProfile`) locks a call's `speed` once at `prepare()` for clone-drift
 * safety — this does not touch that lock, it only computes a per-utterance override applied
 * to a cloned request in `streamTts`, so nothing about voice identity/timbre changes, only pace.
 *
 * The heuristic is deliberately simple and text-length based (not a guessed sentiment/urgency
 * model with no way to verify it): a short line is read a little quicker, a long one a little
 * slower for clarity, everything in between stays at the agent's configured base speed.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

const SHORT_LINE_CHARS = 24;
const LONG_LINE_CHARS = 220;
const SHORT_LINE_FACTOR = 1.08;
const LONG_LINE_FACTOR = 0.95;

export function resolveDynamicSpeed(
  baseSpeed: number | undefined,
  text: string,
  settings: Record<string, unknown> | null | undefined,
): number | undefined {
  if (settings?.enableDynamicVoiceSpeed !== true) return baseSpeed;
  const base = typeof baseSpeed === "number" ? baseSpeed : 1;
  const len = text.trim().length;
  if (len === 0) return baseSpeed;
  if (len <= SHORT_LINE_CHARS) return base * SHORT_LINE_FACTOR;
  if (len >= LONG_LINE_CHARS) return base * LONG_LINE_FACTOR;
  return base;
}
