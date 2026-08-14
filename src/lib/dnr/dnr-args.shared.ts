/**
 * Shared argument hygiene for the DNR Retell custom-function tools.
 */

/**
 * Copy `raw` without keys whose value is `null`.
 *
 * Retell's tool_call_strict_mode requires the model to emit every declared
 * property, so unset optional arguments arrive as `null` rather than being
 * omitted. Zod's `.optional()` accepts `undefined` but rejects `null`, which
 * turns a perfectly valid call into a validation error on a field nobody
 * asked for.
 */
export function dnrStripNulls(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null) continue;
    out[key] = value;
  }
  return out;
}

/** Coerce a scalar that Retell may send as a number into a trimmed string. */
export function dnrScalarToString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
