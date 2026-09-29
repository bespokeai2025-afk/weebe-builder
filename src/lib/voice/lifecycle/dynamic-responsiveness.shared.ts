/**
 * `enableDynamicResponsiveness` — adapt how long the agent waits on the caller based on the
 * pace the caller has actually been keeping in this call, instead of one fixed wait for every
 * turn regardless of how quickly or slowly this particular caller responds.
 *
 * The signal is the gap between the agent finishing a line and the caller's next accepted
 * utterance, tracked per turn in `cascade-session.ts` as `recentResponseGapsMs`. A caller who has
 * been answering quickly gets a shorter wait before the flow's own timeout edge fires (they're
 * keeping pace, so a stall now is more likely a real hang-up than them still thinking); a caller
 * who has been taking longer gets more room. This only ever adjusts the flow-authored
 * `silenceTimeoutMs` within a bounded ±25% — it never invents a wait where the flow specified
 * none, and never lets the adjustment dominate the author's own configured value.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

const MAX_ADJUSTMENT = 0.25;
/** Below this average gap, the caller is answering briskly — shorten the wait. */
const BRISK_GAP_MS = 800;
/** Above this average gap, the caller needs more thinking time — lengthen the wait. */
const SLOW_GAP_MS = 2500;

export function resolveDynamicSilenceTimeoutMs(
  baseMs: number | undefined,
  recentResponseGapsMs: number[],
  settings: Record<string, unknown> | null | undefined,
): number | undefined {
  if (settings?.enableDynamicResponsiveness !== true) return baseMs;
  if (!baseMs || baseMs <= 0 || recentResponseGapsMs.length === 0) return baseMs;

  const avgGap = recentResponseGapsMs.reduce((a, b) => a + b, 0) / recentResponseGapsMs.length;
  if (avgGap <= BRISK_GAP_MS) return Math.round(baseMs * (1 - MAX_ADJUSTMENT));
  if (avgGap >= SLOW_GAP_MS) return Math.round(baseMs * (1 + MAX_ADJUSTMENT));
  return baseMs;
}
