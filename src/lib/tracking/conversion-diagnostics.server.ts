/**
 * Conversion tracking diagnostics — authenticated server functions.
 * Read-only evidence for the "Conversion Tracking" diagnostics panel:
 * per-conversion recording status, Google acknowledgement status, duplicate
 * protection and attribution availability. No tokens or credentials returned.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computeConversionTrackingHealth } from "@/lib/tracking/conversion-tracking-health.server";
import { resolveDataManagerTarget, checkDataManagerRequestStatus } from "@/lib/tracking/datamanager-upload.server";

async function requireMember(context: any): Promise<string> {
  const workspaceId = context.workspaceId as string | undefined;
  const userId = context.userId as string | undefined;
  if (!workspaceId || !userId) throw new Error("No workspace");
  const { data: member } = await (context.supabase as any)
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) throw new Error("Not a member of this workspace");
  return workspaceId;
}

export const getConversionDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = await requireMember(context);

    // Opportunistically resolve pending provider verifications (bounded):
    // reuse stored provider request IDs to check Data Manager request status.
    try {
      const { data: pend } = await supabaseAdmin
        .from("conversion_events")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("delivery_status", "verification_pending")
        .order("created_at", { ascending: false })
        .limit(5);
      for (const p of (pend ?? []) as Array<{ id: string }>) {
        await checkDataManagerRequestStatus(p.id);
      }
    } catch { /* best-effort */ }

    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [health, dmResolved, eventsRes] = await Promise.all([
      computeConversionTrackingHealth(workspaceId, { windowDays: 30 }),
      resolveDataManagerTarget(workspaceId).catch(() => null),
      supabaseAdmin
        .from("conversion_events")
        .select("id, conversion_name, source, delivery_status, gclid, gbraid, wbraid, landing_url, last_error, uploaded_at, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", since30)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    const dmTarget = dmResolved && dmResolved.ok ? dmResolved.target : null;

    const rows = (eventsRes.data ?? []) as Array<{
      id: string; conversion_name: string; source: string; delivery_status: string;
      gclid: string | null; gbraid: string | null; wbraid: string | null;
      landing_url: string | null; last_error: string | null;
      uploaded_at: string | null; created_at: string;
    }>;

    // Status groupings across BOTH transports:
    //  accepted  = Data Manager "reported"/"provider_accepted" + legacy "uploaded"
    //  submitted = attempts in flight (upload_attempted/queued)
    //  rejected  = provider_rejected + legacy upload_failed
    const ACCEPTED = new Set(["reported", "provider_accepted", "uploaded"]);
    const SUBMITTED = new Set(["upload_attempted", "queued"]);
    const REJECTED = new Set(["provider_rejected", "upload_failed"]);

    const since24h = Date.now() - 24 * 3_600_000;
    const byName = new Map<string, {
      conversionName: string; sources: string[];
      total: number; last24h: number; uploaded: number; withClickId: number;
      noAttribution: number; pendingConfig: number; failed: number; duplicates: number;
      submitted: number; verificationPending: number;
      lastEventAt: string | null; lastUploadedAt: string | null; lastError: string | null;
    }>();
    let lastProviderError: { message: string; at: string } | null = null;
    let lastSuccessfulUploadAt: string | null = null;
    for (const r of rows) {
      let agg = byName.get(r.conversion_name);
      if (!agg) {
        agg = {
          conversionName: r.conversion_name, sources: [],
          total: 0, last24h: 0, uploaded: 0, withClickId: 0,
          noAttribution: 0, pendingConfig: 0, failed: 0, duplicates: 0,
          submitted: 0, verificationPending: 0,
          lastEventAt: null, lastUploadedAt: null, lastError: null,
        };
        byName.set(r.conversion_name, agg);
      }
      agg.total += 1;
      if (new Date(r.created_at).getTime() >= since24h) agg.last24h += 1;
      if (r.source && !agg.sources.includes(r.source)) agg.sources.push(r.source);
      if (ACCEPTED.has(r.delivery_status)) agg.uploaded += 1;
      if (SUBMITTED.has(r.delivery_status)) agg.submitted += 1;
      if (r.delivery_status === "verification_pending") agg.verificationPending += 1;
      if (r.gclid || r.gbraid || r.wbraid) agg.withClickId += 1;
      if (r.delivery_status === "no_attribution") agg.noAttribution += 1;
      if (r.delivery_status === "pending_config") agg.pendingConfig += 1;
      if (REJECTED.has(r.delivery_status)) { agg.failed += 1; agg.lastError ??= r.last_error; }
      if (r.delivery_status === "duplicate_suppressed") agg.duplicates += 1;
      agg.lastEventAt ??= r.created_at;
      if (!agg.lastUploadedAt && r.uploaded_at) agg.lastUploadedAt = r.uploaded_at;
      if (!lastProviderError && r.last_error && (REJECTED.has(r.delivery_status) || r.delivery_status === "pending_config")) {
        lastProviderError = { message: r.last_error, at: r.created_at };
      }
      if (!lastSuccessfulUploadAt && ACCEPTED.has(r.delivery_status) && r.uploaded_at) {
        lastSuccessfulUploadAt = r.uploaded_at;
      }
    }

    const statusCounts = {
      queued: rows.filter((r) => r.delivery_status === "queued").length,
      submitted: rows.filter((r) => r.delivery_status === "upload_attempted").length,
      accepted: rows.filter((r) => ACCEPTED.has(r.delivery_status)).length,
      rejected: rows.filter((r) => REJECTED.has(r.delivery_status)).length,
      verificationPending: rows.filter((r) => r.delivery_status === "verification_pending").length,
      duplicates: rows.filter((r) => r.delivery_status === "duplicate_suppressed").length,
      noAttribution: rows.filter((r) => r.delivery_status === "no_attribution").length,
      pendingConfig: rows.filter((r) => r.delivery_status === "pending_config").length,
    };

    // Funnel view (30-day window): web-form vs Ava voice funnels, and Google
    // Ads-attributed vs organic Ava bookings. "Attributed" = a real click ID
    // was genuinely captured — never inferred.
    const countBy = (name: string) => rows.filter((r) => r.conversion_name === name);
    const attributed = (rs: typeof rows) => rs.filter((r) => r.gclid || r.gbraid || r.wbraid).length;
    const callsStarted = countBy("ava_call_started");
    const avaLeads = rows.filter(
      (r) => r.conversion_name === "ava_qualified_lead" && r.source === "ava_web_call",
    );
    const avaBookings = countBy("ava_appointment_booked");
    const webFormLeads = rows.filter(
      (r) => r.conversion_name === "webform_lead" || r.conversion_name === "contact_form_submission",
    );
    const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
    const funnel = {
      windowDays: 30,
      callsStarted: callsStarted.length,
      avaLeads: avaLeads.length,
      avaQualifiedLeads: avaLeads.length,
      avaBookings: avaBookings.length,
      adsAttributedBookings: attributed(avaBookings),
      organicBookings: avaBookings.length - attributed(avaBookings),
      webFormLeads: webFormLeads.length,
      adsAttributedWebFormLeads: attributed(webFormLeads),
      callToLeadRatePct: pct(avaLeads.length, callsStarted.length),
      callToBookingRatePct: pct(avaBookings.length, callsStarted.length),
    };

    return {
      health,
      funnel,
      uploadConfig: {
        transport: dmTarget?.legacyFallbackEnabled ? "legacy_click_conversions" : "data_manager",
        hasGadsAccount: Boolean(dmTarget?.operatingAccountId),
        uploadActionConfigured: Boolean(dmTarget?.productDestinationId),
        hasDataManagerScope: Boolean(dmTarget?.scopeOk),
        reauthorisationRequired: Boolean(dmTarget && !dmTarget.scopeOk),
        configError: dmResolved && !dmResolved.ok ? dmResolved.reason : null,
        legacyFallbackEnabled: Boolean(dmTarget?.legacyFallbackEnabled),
      },
      statusCounts,
      lastProviderError,
      lastSuccessfulUploadAt,
      conversions: Array.from(byName.values()).sort((a, b) => b.total - a.total),
      recentEvents: rows.slice(0, 25).map((r) => ({
        id: r.id,
        conversionName: r.conversion_name,
        source: r.source,
        status: r.delivery_status,
        hasClickId: Boolean(r.gclid || r.gbraid || r.wbraid),
        landingUrl: r.landing_url,
        lastError: r.last_error,
        createdAt: r.created_at,
      })),
      checkedAt: new Date().toISOString(),
    };
  });

// ── Data Manager readiness check (safe, non-production validation) ───────────
// validateOnly dry-run + read-only conversion-action inspection. Never uploads
// a conversion; never changes any advertising setting.
export const runDataManagerReadinessCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = await requireMember(context);

    const { validateDataManagerSetup } = await import("@/lib/tracking/datamanager-upload.server");
    const resolved = await resolveDataManagerTarget(workspaceId);
    const target = resolved.ok ? resolved.target : null;

    // Read-only GAQL inspection of the configured conversion action (status,
    // primary/secondary). Best-effort — analytics scope covers this read.
    let conversionAction: {
      id: string; name: string | null; status: string | null;
      type: string | null; primaryForGoal: boolean | null;
    } | null = null;
    let conversionActionError: string | null = null;
    if (target) {
      try {
        if (!/^\d+$/.test(target.productDestinationId)) {
          throw new Error("Configured conversion action id is not numeric");
        }
        const { gaqlSearch } = await import("@/lib/growthmind/gads-live-core.server");
        const rows = await gaqlSearch(
          {
            workspaceId,
            customerId: target.operatingAccountId,
            loginCustomerId: target.loginAccountId,
          },
          `SELECT conversion_action.id, conversion_action.name, conversion_action.status,
                  conversion_action.type, conversion_action.primary_for_goal
           FROM conversion_action
           WHERE conversion_action.id = ${target.productDestinationId}`,
        );
        const c = (rows[0] as any)?.conversionAction ?? null;
        if (c) {
          conversionAction = {
            id: String(c.id ?? target.productDestinationId),
            name: c.name ?? null,
            status: c.status ?? null,
            type: c.type ?? null,
            primaryForGoal: typeof c.primaryForGoal === "boolean" ? c.primaryForGoal : null,
          };
        } else {
          conversionActionError = "Conversion action not found in the connected Google Ads account";
        }
      } catch (err) {
        conversionActionError = String((err as Error)?.message ?? err).slice(0, 300);
      }
    }

    // validateOnly ingest dry-run (nothing is recorded by Google).
    const validation = await validateDataManagerSetup(workspaceId).catch((err) => ({
      ok: false as const,
      scopeOk: false,
      error: String((err as Error)?.message ?? err).slice(0, 300),
    }));

    return {
      configured: Boolean(target),
      configError: resolved.ok ? null : resolved.reason,
      scopeGranted: Boolean(target?.scopeOk),
      reauthorisationRequired: Boolean(target && !target.scopeOk),
      operatingAccountId: target?.operatingAccountId ?? null,
      productDestinationId: target?.productDestinationId ?? null,
      legacyFallbackEnabled: Boolean(target?.legacyFallbackEnabled),
      conversionAction,
      conversionActionError,
      validation: {
        ok: Boolean((validation as any).ok),
        httpStatus: (validation as any).httpStatus ?? null,
        error: (validation as any).error ?? null,
      },
    };
  });
