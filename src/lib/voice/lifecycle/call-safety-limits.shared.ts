/**
 * Agent-level safety limits — `maxCallDurationMs` and `endCallAfterSilenceMs`.
 *
 * Retell enforces both regardless of what the flow does. The native engine stored these two
 * builder settings from the start but never read them anywhere, so a stuck or abandoned native
 * call had no hard stop — it could run (and bill) indefinitely. Pulled out as pure functions so
 * the one part with real room for a bug (parsing an untrusted settings blob) is testable without
 * standing up a full CascadeSession.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

function resolvePositiveMs(settings: Record<string, unknown> | null | undefined, key: string): number | null {
  const raw = settings?.[key];
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms;
}

/** Hard cap on total call length, in ms — null when unset or invalid. */
export function resolveMaxCallDurationMs(settings: Record<string, unknown> | null | undefined): number | null {
  return resolvePositiveMs(settings, "maxCallDurationMs");
}

/** Whole-call dead-air watchdog, in ms — null when unset or invalid. */
export function resolveEndCallAfterSilenceMs(
  settings: Record<string, unknown> | null | undefined,
): number | null {
  return resolvePositiveMs(settings, "endCallAfterSilenceMs");
}
