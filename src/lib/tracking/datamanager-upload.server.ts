/**
 * Google Data Manager API offline-conversion uploader (server-only).
 *
 * Primary production transport for conversion_events since Google moved
 * offline-conversion ingestion off the legacy Google Ads
 * `uploadClickConversions` endpoint (June 2026). The legacy adapter in
 * gads-conversion-upload.server.ts stays available ONLY behind the explicit
 * `legacyClickConversionFallback: "true"` flag in the workspace's google_ads
 * provider settings (documented fallback for proven allowlisted accounts).
 *
 * Honesty rules:
 *  - never fabricate attribution — an event uploads only with a REAL
 *    gclid/gbraid/wbraid or genuinely captured (normalised, SHA-256-hashed)
 *    first-party identifiers;
 *  - an accepted ingestion request is NOT proof the conversion is visible in
 *    Google Ads — accepted requests sit in `verification_pending` until the
 *    provider's request status reports SUCCESS (→ `reported`);
 *  - tokens without the datamanager OAuth scope are never used to claim
 *    Data Manager access — the event stays `pending_config` with a
 *    reauthorisation message.
 *
 * Idempotency: upload attempts are guarded by a compare-and-set on
 * delivery_status, so a ledger event can never upload twice (double dispatch,
 * browser refresh and scheduled retries all lose the CAS race).
 */
import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { grantedScopesIncludeDataManager } from "@/lib/providers/advertising/google-ads-oauth.functions";

export const DATA_MANAGER_BASE = "https://datamanager.googleapis.com/v1";

// Statuses an event may hold before a Data Manager upload attempt is allowed.
const UPLOADABLE_STATUSES = ["recorded", "queued"] as const;
// Retryable provider failures keep the event in "queued"; permanent ones go
// to "provider_rejected".
const RETRYABLE_HTTP = new Set([408, 429, 500, 502, 503, 504]);

interface EventRow {
  id: string;
  workspace_id: string;
  conversion_name: string;
  source: string;
  lead_id: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  created_at: string;
  delivery_status: string;
  provider_response: Record<string, unknown> | null;
}

// ── First-party identifier normalisation + hashing ──────────────────────────

/** Normalise an email per Google rules (trim, lowercase, gmail dot removal). */
export function normalizeEmail(raw: string): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  const [local, domain] = s.split("@");
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.replace(/\./g, "")}@${domain}`;
  }
  return s;
}

/**
 * Normalise a phone number to E.164. Only returns a value when the input is
 * confidently internationalisable: already has +CC, or is a UK 0-prefixed
 * number (platform default market). Anything ambiguous → null (never guess).
 */
export function normalizePhoneE164(raw: string): string | null {
  const s = String(raw ?? "").replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  if (/^00[1-9]\d{7,14}$/.test(s)) return `+${s.slice(2)}`;
  if (/^0[1-9]\d{8,9}$/.test(s)) return `+44${s.slice(1)}`; // UK national format
  return null;
}

/** SHA-256 hex digest (Google accepts hex with encoding: "HEX"). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface HashedIdentifiers {
  hashedEmail: string | null;
  hashedPhone: string | null;
}

export function buildHashedIdentifiers(email?: string | null, phone?: string | null): HashedIdentifiers {
  const ne = email ? normalizeEmail(email) : null;
  const np = phone ? normalizePhoneE164(phone) : null;
  return {
    hashedEmail: ne ? sha256Hex(ne) : null,
    hashedPhone: np ? sha256Hex(np) : null,
  };
}

// ── Config resolution (workspace-specific, no global fallback) ───────────────

export interface DataManagerTarget {
  operatingAccountId: string;       // Google Ads customer ID (digits)
  loginAccountId: string | null;    // manager/login account actually authorised
  productDestinationId: string;     // conversion action ID
  creds: Record<string, string>;
  scopeOk: boolean;
  legacyFallbackEnabled: boolean;
}

export async function resolveDataManagerTarget(workspaceId: string): Promise<
  { ok: true; target: DataManagerTarget } | { ok: false; reason: string }
> {
  const { data: ps } = await supabaseAdmin
    .from("provider_settings")
    .select("credentials")
    .eq("workspace_id", workspaceId)
    .eq("provider_category", "advertising")
    .eq("provider_name", "google_ads")
    .maybeSingle();
  const creds = ((ps as { credentials?: Record<string, string> } | null)?.credentials ?? {});

  const rawAction = String(creds.uploadConversionActionId ?? "").trim();
  if (!/^\d{3,20}$/.test(rawAction)) {
    return { ok: false, reason: "uploadConversionActionId not configured in google_ads provider settings" };
  }

  const { data: acc } = await supabaseAdmin
    .from("growthmind_ads_accounts")
    .select("customer_id, login_customer_id")
    .eq("workspace_id", workspaceId)
    .eq("platform", "google")
    .not("customer_id", "is", null)
    .limit(1)
    .maybeSingle();
  const operatingAccountId =
    (acc as { customer_id?: string | null } | null)?.customer_id?.replace(/\D/g, "") ?? "";
  if (!operatingAccountId) return { ok: false, reason: "No connected Google Ads account for workspace" };

  const loginAccountId =
    (acc as { login_customer_id?: string | null } | null)?.login_customer_id?.replace(/\D/g, "") ||
    creds.managerId?.replace(/\D/g, "") ||
    null;

  return {
    ok: true,
    target: {
      operatingAccountId,
      loginAccountId,
      productDestinationId: rawAction,
      creds,
      scopeOk: grantedScopesIncludeDataManager(creds.grantedScopes),
      legacyFallbackEnabled: creds.legacyClickConversionFallback === "true",
    },
  };
}

// ── Payload building ─────────────────────────────────────────────────────────

function toRfc3339(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface DmEventInput {
  eventId: string;             // ledger id — used as transactionId (idempotency reference)
  conversionName: string;
  source: string;
  createdAt: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  hashedEmail?: string | null;
  hashedPhone?: string | null;
}

/**
 * Build the IngestEventsRequest body. At least one attribution route (click
 * ID or hashed identifier) must be present — enforced by the caller.
 * Currency/value are intentionally omitted: WEBEE has no genuinely configured
 * per-conversion monetary value (the conversion action carries its default).
 */
export function buildIngestEventsBody(
  target: Pick<DataManagerTarget, "operatingAccountId" | "loginAccountId" | "productDestinationId">,
  ev: DmEventInput,
  validateOnly: boolean,
): Record<string, unknown> {
  const destination: Record<string, unknown> = {
    operatingAccount: { accountType: "GOOGLE_ADS", accountId: target.operatingAccountId },
    productDestinationId: target.productDestinationId,
  };
  if (target.loginAccountId && target.loginAccountId !== target.operatingAccountId) {
    destination.loginAccount = { accountType: "GOOGLE_ADS", accountId: target.loginAccountId };
  }

  const adIdentifiers: Record<string, unknown> = {};
  if (ev.gclid) adIdentifiers.gclid = ev.gclid;
  else if (ev.gbraid) adIdentifiers.gbraid = ev.gbraid;
  else if (ev.wbraid) adIdentifiers.wbraid = ev.wbraid;

  const userIdentifiers: Record<string, unknown>[] = [];
  if (ev.hashedEmail) userIdentifiers.push({ emailAddress: ev.hashedEmail });
  if (ev.hashedPhone) userIdentifiers.push({ phoneNumber: ev.hashedPhone });

  const event: Record<string, unknown> = {
    transactionId: ev.eventId,
    eventTimestamp: toRfc3339(ev.createdAt),
    eventSource: "WEB",
    eventName: ev.conversionName,
    // First-party consent: these events originate from WEBEE's own forms /
    // qualified calls where the user actively submitted their details.
    consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" },
  };
  if (Object.keys(adIdentifiers).length > 0) event.adIdentifiers = adIdentifiers;
  if (userIdentifiers.length > 0) event.userData = { userIdentifiers };

  return {
    destinations: [destination],
    encoding: "HEX",
    events: [event],
    validateOnly,
  };
}

// ── Access token (reuses the existing Google Ads OAuth refresh flow) ─────────

async function getDataManagerAccessToken(workspaceId: string): Promise<string> {
  const { getGadsAccessToken } = await import("@/lib/growthmind/gads-live-core.server");
  return getGadsAccessToken(workspaceId);
}

// ── Ledger helpers ────────────────────────────────────────────────────────────

async function setEventStatus(
  eventId: string,
  status: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  await supabaseAdmin
    .from("conversion_events")
    .update({ delivery_status: status, updated_at: new Date().toISOString(), ...patch } as never)
    .eq("id", eventId);
}

/** Merge Data Manager bookkeeping into provider_response without clobbering. */
function dmMeta(existing: Record<string, unknown> | null, patch: Record<string, unknown>): Record<string, unknown> {
  const base = existing && typeof existing === "object" ? existing : {};
  const dm = (base as { dm?: Record<string, unknown> }).dm ?? {};
  return { ...base, transport: "data_manager", dm: { ...dm, ...patch } };
}

// ── Main upload path ─────────────────────────────────────────────────────────

/**
 * Attempt a Data Manager ingest for one ledger event. Never throws.
 * CAS-guarded: only proceeds if it wins the transition to "upload_attempted".
 */
export async function maybeUploadViaDataManager(eventId: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("conversion_events")
      .select("id, workspace_id, conversion_name, source, lead_id, gclid, gbraid, wbraid, created_at, delivery_status, provider_response")
      .eq("id", eventId)
      .maybeSingle();
    const ev = data as EventRow | null;
    if (!ev) return;
    if (!UPLOADABLE_STATUSES.includes(ev.delivery_status as never)) return;

    // Gather attribution routes. Click IDs come from the ledger row; hashed
    // first-party identifiers come from the linked lead where available.
    const hasClick = Boolean(ev.gclid || ev.gbraid || ev.wbraid);
    let hashed: HashedIdentifiers = { hashedEmail: null, hashedPhone: null };
    if (ev.lead_id) {
      // Tenant boundary: the lead must belong to the SAME workspace as the
      // event — a mismatched lead_id yields no identifier route at all.
      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("email, phone")
        .eq("id", ev.lead_id)
        .eq("workspace_id", ev.workspace_id)
        .maybeSingle();
      const l = lead as { email?: string | null; phone?: string | null } | null;
      hashed = buildHashedIdentifiers(l?.email, l?.phone);
    }
    if (!hasClick && !hashed.hashedEmail && !hashed.hashedPhone) {
      // No valid attribution route at all — leave the honest ledger status.
      return;
    }

    const resolved = await resolveDataManagerTarget(ev.workspace_id);
    if (!resolved.ok) {
      await setEventStatus(ev.id, "pending_config", { last_error: resolved.reason });
      return;
    }
    const target = resolved.target;
    if (!target.scopeOk) {
      await setEventStatus(ev.id, "pending_config", {
        last_error: "reauthorisation_required: Google connection lacks the Data Manager scope — reconnect with Google",
      });
      return;
    }

    // Idempotency CAS: only ONE caller may move recorded/queued → upload_attempted.
    const { data: claimed } = await supabaseAdmin
      .from("conversion_events")
      .update({ delivery_status: "upload_attempted", updated_at: new Date().toISOString() } as never)
      .eq("id", ev.id)
      .in("delivery_status", UPLOADABLE_STATUSES as unknown as string[])
      .select("id");
    if (!claimed || (claimed as unknown[]).length === 0) return; // lost the race

    let token: string;
    try {
      token = await getDataManagerAccessToken(ev.workspace_id);
    } catch (err) {
      await setEventStatus(ev.id, "queued", {
        last_error: `OAuth token refresh failed: ${String((err as Error)?.message).slice(0, 300)}`,
      });
      return;
    }

    const body = buildIngestEventsBody(target, {
      eventId: ev.id,
      conversionName: ev.conversion_name,
      source: ev.source,
      createdAt: ev.created_at,
      gclid: ev.gclid,
      gbraid: ev.gbraid,
      wbraid: ev.wbraid,
      hashedEmail: hashed.hashedEmail,
      hashedPhone: hashed.hashedPhone,
    }, false);

    const submittedAt = new Date().toISOString();
    const res = await fetch(`${DATA_MANAGER_BASE}/events:ingest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok || (json as { error?: unknown }).error) {
      const msg = String((json as any)?.error?.message ?? `HTTP ${res.status}`).slice(0, 400);
      const retryable = RETRYABLE_HTTP.has(res.status);
      await setEventStatus(ev.id, retryable ? "queued" : "provider_rejected", {
        provider_response: dmMeta(ev.provider_response, {
          submittedAt, initialResponse: json, httpStatus: res.status, retryable,
        }),
        last_error: msg,
      });
      return;
    }

    const requestId = String((json as { requestId?: string }).requestId ?? "");
    // Accepted ≠ visible in Google Ads: hold in verification_pending until the
    // provider's request status reports a final SUCCESS.
    await setEventStatus(ev.id, requestId ? "verification_pending" : "provider_accepted", {
      provider_response: dmMeta(ev.provider_response, {
        requestId: requestId || null, submittedAt, initialResponse: json,
      }),
      uploaded_at: submittedAt,
      last_error: null,
    });
    console.log("[CONVERSION][DM] ingest accepted", { eventId: ev.id, requestId });
  } catch (err) {
    console.error("[CONVERSION][DM] maybeUploadViaDataManager errored:", (err as Error)?.message);
    try {
      await setEventStatus(eventId, "queued", {
        last_error: String((err as Error)?.message ?? "unknown").slice(0, 400),
      });
    } catch { /* best-effort */ }
  }
}

// ── Status retrieval (verification_pending → reported / provider_rejected) ───

export async function checkDataManagerRequestStatus(eventId: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("conversion_events")
      .select("id, workspace_id, delivery_status, provider_response")
      .eq("id", eventId)
      .maybeSingle();
    const ev = data as Pick<EventRow, "id" | "workspace_id" | "delivery_status" | "provider_response"> | null;
    if (!ev || ev.delivery_status !== "verification_pending") return;
    const requestId = String(((ev.provider_response as any)?.dm?.requestId ?? ""));
    if (!requestId) return;

    const token = await getDataManagerAccessToken(ev.workspace_id);
    const res = await fetch(
      `${DATA_MANAGER_BASE}/requestStatus:retrieve?requestId=${encodeURIComponent(requestId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const checkedAt = new Date().toISOString();
    if (!res.ok) {
      // Status endpoint failure is not a row failure — keep waiting.
      await setEventStatus(ev.id, "verification_pending", {
        provider_response: dmMeta(ev.provider_response, { statusCheckedAt: checkedAt, statusCheckError: (json as any)?.error?.message ?? `HTTP ${res.status}` }),
      });
      return;
    }

    const perDest = ((json as any).requestStatusPerDestination ?? []) as Array<Record<string, any>>;
    const states = perDest.map((d) => String(d.requestStatus ?? d.eventsIngestionStatus?.requestStatus ?? "")).filter(Boolean);
    const rowErrors = perDest.flatMap((d) => d.errorInfo?.errorReasons ?? d.errorCounts ?? []);
    const allSuccess = states.length > 0 && states.every((s) => s === "SUCCESS" || s === "SUCCESS_WITH_WARNINGS");
    const anyFailed = states.some((s) => s.startsWith("FAILED") || s === "FAILURE" || s === "PARTIAL_SUCCESS_WITH_ERRORS");

    if (allSuccess) {
      await setEventStatus(ev.id, "reported", {
        provider_response: dmMeta(ev.provider_response, { statusCheckedAt: checkedAt, finalState: states, statusResponse: json }),
        last_error: null,
      });
    } else if (anyFailed) {
      await setEventStatus(ev.id, "provider_rejected", {
        provider_response: dmMeta(ev.provider_response, { statusCheckedAt: checkedAt, finalState: states, statusResponse: json, rowErrors }),
        last_error: `Data Manager processing failed: ${JSON.stringify(rowErrors).slice(0, 300)}`,
      });
    } else {
      await setEventStatus(ev.id, "verification_pending", {
        provider_response: dmMeta(ev.provider_response, { statusCheckedAt: checkedAt, lastKnownState: states }),
      });
    }
  } catch (err) {
    console.error("[CONVERSION][DM] status check errored:", (err as Error)?.message);
  }
}

// ── Validate-only mode ───────────────────────────────────────────────────────

export interface ValidateOnlyResult {
  ok: boolean;
  scopeOk: boolean;
  operatingAccountId?: string;
  loginAccountId?: string | null;
  productDestinationId?: string;
  httpStatus?: number;
  error?: string;
  response?: unknown;
}

/**
 * validateOnly ingest — verifies OAuth scope, account access, destination and
 * payload shape WITHOUT recording any conversion (validateOnly: true is a
 * dry-run on Google's side; nothing is ingested).
 */
export async function validateDataManagerSetup(workspaceId: string): Promise<ValidateOnlyResult> {
  const resolved = await resolveDataManagerTarget(workspaceId);
  if (!resolved.ok) return { ok: false, scopeOk: false, error: resolved.reason };
  const target = resolved.target;
  if (!target.scopeOk) {
    return {
      ok: false, scopeOk: false,
      operatingAccountId: target.operatingAccountId,
      productDestinationId: target.productDestinationId,
      error: "reauthorisation_required: token lacks the Data Manager scope",
    };
  }
  let token: string;
  try {
    token = await getDataManagerAccessToken(workspaceId);
  } catch (err) {
    return { ok: false, scopeOk: true, error: `OAuth token refresh failed: ${String((err as Error)?.message)}` };
  }

  // Validation payload: hashed synthetic identifier only, clearly non-production.
  // validateOnly guarantees Google records nothing.
  const body = buildIngestEventsBody(target, {
    eventId: `validate-${Date.now()}`,
    conversionName: "webee_qualified_lead",
    source: "validation",
    createdAt: new Date().toISOString(),
    gclid: null, gbraid: null, wbraid: null,
    hashedEmail: sha256Hex("validation@webee.invalid"),
    hashedPhone: null,
  }, true);

  const res = await fetch(`${DATA_MANAGER_BASE}/events:ingest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: res.ok && !(json as { error?: unknown }).error,
    scopeOk: true,
    operatingAccountId: target.operatingAccountId,
    loginAccountId: target.loginAccountId,
    productDestinationId: target.productDestinationId,
    httpStatus: res.status,
    error: res.ok ? undefined : String((json as any)?.error?.message ?? `HTTP ${res.status}`).slice(0, 400),
    response: json,
  };
}
