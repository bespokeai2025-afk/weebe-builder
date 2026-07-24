// ── SystemMind CRM connector contract (Task #457) ─────────────────────────────
// One interface every CRM connector implements. Connectors are EXECUTABLE but
// scoped to connection lifecycle only: credential testing with evidence,
// schema discovery, and optional OAuth credential refresh. Pre-call retrieval
// and post-call write-back stay in the runtime adapters (src/lib/crm/*,
// src/lib/providers/crm/*) and are OUT OF SCOPE here.
//
// Adding a CRM later = one connector file + one registry entry. No bespoke wiring.

export type CrmTestStepKey =
  | "auth"
  | "read"
  | "write"
  | "discovery_preview"
  | "sample_record";

export interface CrmTestStep {
  key: CrmTestStepKey;
  label: string;
  ok: boolean;
  /** Truthful evidence, e.g. "Authenticated as jane@acme.com (WhoAmI)". Never vague. */
  detail: string;
  skipped?: boolean;
}

export interface CrmTestReport {
  ok: boolean;
  steps: CrmTestStep[];
  /** Small, non-secret sample record (field name → stringified value preview). */
  sampleRecord: Record<string, string> | null;
  /** Number of fields discovered on the primary lead/contact object. */
  fieldCount: number | null;
  testedAt: string;
  /** Human-readable failure summary when ok=false. */
  error?: string;
}

export interface DiscoveredField {
  key: string;
  label: string;
  type: string;
  custom: boolean;
  required?: boolean;
}

export interface DiscoveredObject {
  /** Universal-ish object key, e.g. "contact", "lead", "deal". */
  key: string;
  /** Vendor object name, e.g. "contacts", "Lead", "persons". */
  crmObject: string;
  fields: DiscoveredField[];
}

export interface DiscoveredStage {
  id: string;
  label: string;
  order?: number;
}

export interface DiscoveredPipeline {
  id: string;
  label: string;
  stages: DiscoveredStage[];
}

export interface DiscoveredOwner {
  id: string;
  name: string;
  email?: string;
}

export interface CrmDiscoverySnapshot {
  provider: string;
  objects: DiscoveredObject[];
  pipelines: DiscoveredPipeline[];
  owners: DiscoveredOwner[];
  discoveredAt: string;
  warnings: string[];
}

export interface CrmCredentialRefreshResult {
  /** Credential keys to merge into the stored (encrypted) credential set. */
  updated: Record<string, string>;
  /** ISO expiry of the refreshed access token, when known. */
  expiresAt?: string;
}

export interface CrmConnector {
  provider: string;
  /** Full evidence-based connection test: auth, read, write, sample, field count. */
  testConnection(): Promise<CrmTestReport>;
  /** Live schema discovery: objects/fields/custom fields, pipelines/stages, owners. */
  discover(): Promise<CrmDiscoverySnapshot>;
  /**
   * OAuth refresh (where the provider supports it). Returns null when the stored
   * credentials cannot be refreshed (no refresh token / not applicable).
   */
  refreshCredentials?(): Promise<CrmCredentialRefreshResult | null>;
}

// ── Shared helpers for connector implementations ──────────────────────────────

export function step(
  key: CrmTestStepKey,
  label: string,
  ok: boolean,
  detail: string,
  skipped = false,
): CrmTestStep {
  return { key, label, ok, detail, skipped };
}

export function report(steps: CrmTestStep[], extras?: Partial<CrmTestReport>): CrmTestReport {
  const failed = steps.find((s) => !s.ok && !s.skipped);
  return {
    ok: !failed,
    steps,
    sampleRecord: extras?.sampleRecord ?? null,
    fieldCount: extras?.fieldCount ?? null,
    testedAt: new Date().toISOString(),
    ...(failed ? { error: `${failed.label}: ${failed.detail}` } : {}),
  };
}

/** Truncate + stringify a record into a safe non-secret preview (max 12 fields). */
export function samplePreview(rec: Record<string, unknown> | null | undefined): Record<string, string> | null {
  if (!rec || typeof rec !== "object") return null;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(rec)) {
    if (v == null || typeof v === "object") continue;
    if (/token|secret|password|api_?key|authorization/i.test(k)) continue;
    out[k] = String(v).slice(0, 80);
    if (++n >= 12) break;
  }
  return Object.keys(out).length ? out : null;
}

export class CrmHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyPreview: string,
    label: string,
  ) {
    super(`${label} — HTTP ${status}${bodyPreview ? `: ${bodyPreview}` : ""}`);
  }
}

/** fetch wrapper: throws CrmHttpError with a short body preview on non-2xx. */
export async function crmFetch(
  url: string,
  init: RequestInit,
  label: string,
): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CrmHttpError(res.status, body.slice(0, 200), label);
  }
  if (res.status === 204) return null;
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
