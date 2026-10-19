/**
 * Size cap for the per-node input/output stored in automation_execution_steps.
 *
 * Every node receives the whole accumulated context (call payload, transcript, CRM lookups), so
 * storing it verbatim wrote the same ~20–250 KB blob once per node — ~250 MB a day for WBAH
 * post-call runs alone. The step view only needs enough to see what a node got and returned:
 * small payloads are stored as they are; larger ones keep their top-level scalars and replace
 * anything nested with a short description.
 */

export const STEP_PAYLOAD_MAX_BYTES = 8 * 1024;
const MAX_SCALAR_CHARS = 300;

function byteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return `[array, ${value.length} items]`;
  if (value && typeof value === "object") return `[object, ${Object.keys(value).length} keys]`;
  return String(value);
}

function shortScalar(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_SCALAR_CHARS) {
    return `${value.slice(0, MAX_SCALAR_CHARS)}…`;
  }
  return value;
}

export function capStepPayload(
  record: Record<string, unknown>,
  maxBytes: number = STEP_PAYLOAD_MAX_BYTES,
): Record<string, unknown> {
  const fullBytes = byteLength(record);
  if (fullBytes <= maxBytes) return record;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = value !== null && typeof value === "object" ? describe(value) : shortScalar(value);
  }
  out._truncated = { original_bytes: fullBytes };
  if (byteLength(out) <= maxBytes) return out;

  return { _truncated: { original_bytes: fullBytes }, keys: Object.keys(record).slice(0, 100) };
}
