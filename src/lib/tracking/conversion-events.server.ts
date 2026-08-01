/**
 * Conversion-event ledger (server-only).
 *
 * Records a conversion event ONLY after the underlying business event is
 * confirmed (lead created/updated from a form, Ava call qualified). Every
 * event carries whatever click-ID attribution was genuinely captured —
 * click IDs are NEVER fabricated. After recording, a Google Ads click-
 * conversion upload is attempted best-effort when (and only when):
 *   - the event has a real gclid / gbraid / wbraid, AND
 *   - the workspace has an upload conversion action configured.
 * Otherwise the event is stored with an honest status
 * ("no_attribution" / "pending_config") so the diagnostics dashboard can
 * report exactly why Google did not receive it.
 *
 * All functions are best-effort and never throw — conversion recording must
 * never break lead capture.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Click-ID sanitising ───────────────────────────────────────────────────────

const CLICK_ID_RE = /^[A-Za-z0-9_.-]{8,200}$/;

export interface ClickIds {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
}

/** Extract + validate click IDs from an untrusted payload. Invalid → null. */
export function extractClickIds(raw: Record<string, unknown>): ClickIds {
  const pick = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return CLICK_ID_RE.test(s) ? s : null;
  };
  return {
    gclid:  pick(raw.gclid),
    gbraid: pick(raw.gbraid),
    wbraid: pick(raw.wbraid),
  };
}

export function hasClickId(ids: ClickIds | null | undefined): boolean {
  return Boolean(ids && (ids.gclid || ids.gbraid || ids.wbraid));
}

/** Sanitise a landing-page URL (http/https only, capped length). */
export function sanitizeLandingUrl(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, 500) : "";
  return /^https?:\/\//i.test(s) ? s : null;
}

// ── Event recording ───────────────────────────────────────────────────────────

/**
 * Observation-only conversion names never fall back to the workspace's
 * default upload conversion action — they upload ONLY when an action is
 * explicitly mapped for them (conversionActionMap). A microphone click must
 * never count against the primary booking/lead conversion action.
 */
export const OBSERVATION_ONLY_CONVERSIONS = new Set(["ava_call_started"]);

export interface RecordConversionEventInput {
  workspaceId: string;
  /** Logical conversion name, e.g. "contact_form_submission". */
  conversionName: string;
  /** Origin path: "webform" | "contact_form" | "ava_call". */
  source: string;
  leadId?: string | null;
  /** Non-PII references (submission id, ava request id, call id …). */
  recordRef?: Record<string, unknown>;
  clickIds?: ClickIds | null;
  landingUrl?: string | null;
  /**
   * Provider-side order/dedup reference (e.g. Cal.com booking UID). Sent as
   * the transaction id on upload so provider-side dedup holds across retries.
   */
  orderId?: string | null;
  /**
   * Visitor ad-consent state as genuinely captured ("granted" | "denied" |
   * null=unknown). "denied" records the event but blocks any upload.
   */
  adUserDataConsent?: string | null;
  /**
   * Uniqueness key for this exact event (e.g. `webform:<submissionId>`).
   * A second insert with the same key is silently deduplicated.
   */
  dedupKey: string;
}

/** Pure initial-status decision (exported for tests). */
export function decideInitialStatus(input: {
  duplicateOfLead: boolean;
  hasClickId: boolean;
  consentDenied: boolean;
}): string {
  if (input.duplicateOfLead) return "duplicate_suppressed";
  if (input.consentDenied) return "consent_blocked";
  return input.hasClickId ? "recorded" : "no_attribution";
}

export interface RecordConversionEventResult {
  ok: boolean;
  eventId?: string;
  status?: string;
  deduped?: boolean;
  error?: string;
}

/**
 * Insert a conversion event and attempt Google acknowledgement.
 * Duplicate protection is two-layered:
 *  1. hard unique dedup_key (same business event never records twice);
 *  2. same (workspace, conversionName, lead) within 24 h →
 *     stored as "duplicate_suppressed" and never uploaded.
 */
export async function recordConversionEvent(
  input: RecordConversionEventInput,
): Promise<RecordConversionEventResult> {
  try {
    const clickIds = input.clickIds ?? { gclid: null, gbraid: null, wbraid: null };

    // Layer 2 duplicate check (lead-level, 24 h window).
    let duplicateOfLead = false;
    if (input.leadId) {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from("conversion_events")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", input.workspaceId)
        .eq("conversion_name", input.conversionName)
        .eq("lead_id", input.leadId)
        .gte("created_at", dayAgo);
      duplicateOfLead = (count ?? 0) > 0;
    }

    const initialStatus = decideInitialStatus({
      duplicateOfLead,
      hasClickId: hasClickId(clickIds),
      consentDenied: input.adUserDataConsent === "denied",
    });

    // order_id + consent travel inside record_ref (no schema change needed):
    // the uploaders read them for provider-side dedup + consent signalling.
    const recordRef: Record<string, unknown> = { ...(input.recordRef ?? {}) };
    if (input.orderId) recordRef.order_id = String(input.orderId).slice(0, 128);
    if (input.adUserDataConsent) recordRef.ad_user_data_consent = input.adUserDataConsent;

    const { data, error } = await supabaseAdmin
      .from("conversion_events")
      .insert({
        workspace_id:    input.workspaceId,
        conversion_name: input.conversionName,
        source:          input.source,
        lead_id:         input.leadId ?? null,
        record_ref:      recordRef,
        gclid:           clickIds.gclid,
        gbraid:          clickIds.gbraid,
        wbraid:          clickIds.wbraid,
        landing_url:     input.landingUrl ?? null,
        dedup_key:       input.dedupKey,
        delivery_status: initialStatus,
      } as never)
      .select("id")
      .single();

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return { ok: true, deduped: true, status: "deduped" };
      }
      console.error("[CONVERSION] event insert failed:", error.message);
      return { ok: false, error: error.message };
    }

    const eventId = (data as { id: string }).id;

    // Attempt Google acknowledgement only for fresh, attributed events.
    // Primary transport: Google Data Manager API. The legacy Google Ads
    // uploadClickConversions path runs ONLY when the workspace explicitly
    // sets legacyClickConversionFallback="true" (documented fallback for
    // proven allowlisted accounts) — never both for the same event.
    if (initialStatus === "recorded") {
      try {
        const { resolveDataManagerTarget, maybeUploadViaDataManager } =
          await import("@/lib/tracking/datamanager-upload.server");
        const resolved = await resolveDataManagerTarget(input.workspaceId);
        if (resolved.ok && resolved.target.legacyFallbackEnabled) {
          const { maybeUploadClickConversion } =
            await import("@/lib/tracking/gads-conversion-upload.server");
          await maybeUploadClickConversion(eventId);
        } else {
          await maybeUploadViaDataManager(eventId);
        }
      } catch (err) {
        console.error("[CONVERSION] upload attempt errored:", (err as Error)?.message);
      }
    }

    return { ok: true, eventId, status: initialStatus };
  } catch (err) {
    console.error("[CONVERSION] recordConversionEvent errored:", (err as Error)?.message);
    return { ok: false, error: (err as Error)?.message ?? "unknown" };
  }
}
