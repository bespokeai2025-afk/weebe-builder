/**
 * Conversion-tracking health signal (deterministic, server-only).
 *
 *   verified    — at least one event acknowledged by Google in the window
 *   partial     — events are being recorded, but none acknowledged by Google
 *                 (missing click IDs and/or no upload conversion action yet)
 *   broken      — ad spend/clicks are flowing but no conversion events exist
 *   unavailable — cannot assess (no Google Ads connection and no events)
 *
 * Consumed by the diagnostics dashboard and by GrowthMind's Google Ads
 * deep-analysis so conversion-dependent recommendations are labelled
 * low-confidence while tracking is not verified.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type TrackingHealthSignal = "verified" | "partial" | "broken" | "unavailable";

export interface TrackingHealth {
  signal: TrackingHealthSignal;
  reasons: string[];
  windowDays: number;
  totals: {
    events: number;
    uploaded: number;
    withClickId: number;
    noAttribution: number;
    pendingConfig: number;
    uploadFailed: number;
    duplicatesSuppressed: number;
  };
  lastEventAt: string | null;
  lastUploadedAt: string | null;
  checkedAt: string;
}

export async function computeConversionTrackingHealth(
  workspaceId: string,
  opts?: { windowDays?: number; adClicksInWindow?: number | null },
): Promise<TrackingHealth> {
  const windowDays = opts?.windowDays ?? 30;
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const { data } = await supabaseAdmin
    .from("conversion_events")
    .select("delivery_status, gclid, gbraid, wbraid, created_at, uploaded_at")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows = (data ?? []) as Array<{
    delivery_status: string;
    gclid: string | null; gbraid: string | null; wbraid: string | null;
    created_at: string; uploaded_at: string | null;
  }>;

  const totals = {
    events: rows.length,
    uploaded: rows.filter((r) => r.delivery_status === "uploaded").length,
    withClickId: rows.filter((r) => r.gclid || r.gbraid || r.wbraid).length,
    noAttribution: rows.filter((r) => r.delivery_status === "no_attribution").length,
    pendingConfig: rows.filter((r) => r.delivery_status === "pending_config").length,
    uploadFailed: rows.filter((r) => r.delivery_status === "upload_failed").length,
    duplicatesSuppressed: rows.filter((r) => r.delivery_status === "duplicate_suppressed").length,
  };

  const { count: gadsAccounts } = await supabaseAdmin
    .from("growthmind_ads_accounts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("platform", "google");
  const hasGads = (gadsAccounts ?? 0) > 0;

  const reasons: string[] = [];
  let signal: TrackingHealthSignal;

  if (totals.uploaded > 0) {
    signal = "verified";
    reasons.push(`${totals.uploaded} conversion(s) acknowledged by Google Ads in the last ${windowDays} days.`);
  } else if (totals.events > 0) {
    signal = "partial";
    reasons.push(`${totals.events} conversion event(s) recorded server-side but none acknowledged by Google yet.`);
    if (totals.withClickId === 0) {
      reasons.push("No event carried a Google click ID (gclid/gbraid/wbraid) — ad landing pages are not passing click IDs through to the forms.");
    }
    if (totals.pendingConfig > 0) {
      reasons.push("Upload conversion action is not configured (google_ads provider setting uploadConversionActionId) — Google-side conversion action creation is a drafted change awaiting approval.");
    }
    if (totals.uploadFailed > 0) {
      reasons.push(`${totals.uploadFailed} upload attempt(s) failed — see conversion event provider responses.`);
    }
  } else if (hasGads && (opts?.adClicksInWindow ?? 0) > 0) {
    signal = "broken";
    reasons.push(`Google Ads recorded ${opts?.adClicksInWindow} click(s) in the window but zero conversion events were captured server-side — the website tag/lead path is not reaching WEBEE.`);
  } else if (hasGads) {
    signal = "partial";
    reasons.push("Google Ads is connected but no conversion events have been recorded yet (no confirmed leads in the window).");
  } else {
    signal = "unavailable";
    reasons.push("No Google Ads connection and no conversion events — tracking health cannot be assessed.");
  }

  return {
    signal,
    reasons,
    windowDays,
    totals,
    lastEventAt: rows[0]?.created_at ?? null,
    lastUploadedAt: rows.find((r) => r.uploaded_at)?.uploaded_at ?? null,
    checkedAt: new Date().toISOString(),
  };
}
