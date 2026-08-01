/**
 * GA4 Measurement Protocol emitter (server-only, best-effort).
 *
 * Emits analytics events (ava_call_started, generate_lead, ava_qualified_lead,
 * ava_appointment_booked) for reporting alongside the Google Ads conversion
 * ledger. The server-side Google Ads upload remains the conversion source of
 * truth — GA4 events here are analytics/reporting only and must never be
 * imported into Google Ads as a second conversion source for the same action.
 *
 * Configuration (shared env, never exposed to the frontend):
 *   GA4_MEASUREMENT_ID — e.g. "G-XXXXXXX"
 *   GA4_API_SECRET     — Measurement Protocol API secret
 * When either is missing the emitter is a silent no-op (honest skip — GA4 is
 * optional reporting, not part of lead capture).
 *
 * Never throws; never blocks the caller's business path.
 */
import { createHash } from "crypto";

const GA4_ENDPOINT = "https://www.google-analytics.com/mp/collect";

export interface Ga4EventInput {
  /** GA4 event name, e.g. "ava_appointment_booked". */
  name: string;
  /**
   * Stable visitor reference. Prefer the site's visitor_session_id; falls
   * back to a deterministic hash of the call id so retries stay consistent.
   */
  clientRef: string | null | undefined;
  /** Fallback reference (e.g. retell call id) when no visitor session exists. */
  fallbackRef?: string | null;
  /** Deduplication/transaction reference (e.g. Cal.com booking UID). */
  transactionId?: string | null;
  params?: Record<string, string | number | boolean | null | undefined>;
}

export function ga4Configured(): boolean {
  return Boolean(process.env.GA4_MEASUREMENT_ID?.trim() && process.env.GA4_API_SECRET?.trim());
}

/** Deterministic MP client_id ("<10 digits>.<10 digits>") from any stable ref. */
export function ga4ClientId(ref: string): string {
  const h = createHash("sha256").update(ref, "utf8").digest();
  const a = h.readUInt32BE(0) % 1_000_000_000 + 1_000_000_000;
  const b = h.readUInt32BE(4) % 1_000_000_000 + 1_000_000_000;
  return `${a}.${b}`;
}

/** Build the MP payload (exported for tests). */
export function buildGa4Payload(input: Ga4EventInput): Record<string, unknown> | null {
  const ref = input.clientRef?.trim() || input.fallbackRef?.trim() || "";
  if (!ref) return null;
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.params ?? {})) {
    if (v != null && v !== "") params[k] = v;
  }
  if (input.transactionId) params.transaction_id = input.transactionId;
  return {
    client_id: ga4ClientId(ref),
    non_personalized_ads: true,
    events: [{ name: input.name, params }],
  };
}

/** Fire-and-forget GA4 event. Silent no-op when GA4 is not configured. */
export async function sendGa4Event(input: Ga4EventInput): Promise<void> {
  try {
    if (!ga4Configured()) return;
    const payload = buildGa4Payload(input);
    if (!payload) return;
    const url =
      `${GA4_ENDPOINT}?measurement_id=${encodeURIComponent(process.env.GA4_MEASUREMENT_ID!.trim())}` +
      `&api_secret=${encodeURIComponent(process.env.GA4_API_SECRET!.trim())}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // MP returns 2xx even for malformed events; log non-2xx only.
    if (!res.ok) {
      console.warn("[GA4] event send non-2xx", { name: input.name, status: res.status });
    }
  } catch (err) {
    console.warn("[GA4] event send failed:", (err as Error)?.message);
  }
}
