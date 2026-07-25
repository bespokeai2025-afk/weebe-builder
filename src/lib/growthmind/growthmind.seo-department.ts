/**
 * GrowthMind SEO Department server functions — Strategy Centre data layer.
 *
 * Reads synced Search Console data (server-write-only tables) via the
 * authenticated client where RLS applies, and dispatches sync/inspection work
 * to the shared cores. Never invents metrics; baseline-pending is surfaced
 * explicitly.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Connection + system health overview ──────────────────────────────────────

export const getSeoDepartmentOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: settings } = await sb
      .from("workspace_settings")
      .select("gsc_access_token, gsc_refresh_token, gsc_token_expiry, gsc_property_url, gsc_auto_matched")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const propertyUrl: string | null = settings?.gsc_property_url ?? null;
    const connected = !!settings?.gsc_access_token;

    let syncState: any = null;
    if (propertyUrl) {
      const { data } = await sb
        .from("growthmind_gsc_sync_state")
        .select("status, baseline_pending, sync_kind, requested_start_date, requested_end_date, last_complete_date, rows_imported, warnings, quota, freshness, connection, last_synced_at, next_sync_at, error_message")
        .eq("workspace_id", workspaceId)
        .eq("property_url", propertyUrl)
        .maybeSingle();
      syncState = data ?? null;
    }

    const { data: sitemaps } = await sb
      .from("growthmind_gsc_sitemaps")
      .select("path, errors, warnings, is_pending, last_submitted, last_downloaded")
      .eq("workspace_id", workspaceId)
      .limit(20);

    const { data: inspections } = await sb
      .from("growthmind_gsc_inspections")
      .select("url, verdict, coverage_state, inspected_at")
      .eq("workspace_id", workspaceId)
      .order("inspected_at", { ascending: false })
      .limit(20);

    const tokenExpiry = settings?.gsc_token_expiry ? new Date(settings.gsc_token_expiry) : null;
    const tokenHealthy = !!tokenExpiry && (tokenExpiry.getTime() > Date.now() || !!settings?.gsc_refresh_token);

    let currentBlocker: string | null = null;
    if (!connected) currentBlocker = "Search Console is not connected.";
    else if (!propertyUrl) currentBlocker = "No Search Console property selected.";
    else if (syncState?.status === "failed") currentBlocker = `Last sync failed: ${syncState.error_message}`;
    else if (syncState?.baseline_pending) currentBlocker = "Google is still processing performance data for this newly verified property (baseline pending).";

    return {
      connection: {
        connected,
        propertyUrl,
        propertyType: propertyUrl?.startsWith("sc-domain:") ? "Domain property" : propertyUrl ? "URL-prefix property" : null,
        autoMatched: !!settings?.gsc_auto_matched,
        permissionLevel: (syncState?.connection as any)?.permissionLevel ?? "siteOwner",
        tokenExpiry: settings?.gsc_token_expiry ?? null,
        refreshTokenAvailable: !!settings?.gsc_refresh_token,
        tokenHealthy,
        lastApiCallAt: (syncState?.connection as any)?.lastApiCallAt ?? null,
        lastTokenRefreshAt: (syncState?.connection as any)?.lastRefreshAt ?? null,
      },
      sync: syncState,
      dataProcessing: syncState?.baseline_pending
        ? { state: "processing", note: "Property newly verified — Google has not published performance rows yet. Incremental sync runs daily." }
        : syncState
        ? { state: "available", note: syncState.freshness?.note ?? null }
        : { state: "never_synced", note: "Initial sync has not run yet." },
      sitemaps: {
        count: sitemaps?.length ?? 0,
        items: sitemaps ?? [],
        healthy: (sitemaps ?? []).every((s: any) => Number(s.errors) === 0),
      },
      urlInspection: {
        available: true,
        recent: inspections ?? [],
      },
      website: {
        host: "Lovable Cloud (GoDaddy DNS, Cloudflare)",
        deploymentCapability: "Content drafts + manual deployment packages only — no direct publish hook verified.",
      },
      currentBlocker,
    };
  });

// ── Trigger sync / inspection ─────────────────────────────────────────────────

export const triggerGscSyncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { runGscSyncForWorkspace } = await import("@/lib/growthmind/gsc-sync-core");
    return await runGscSyncForWorkspace(workspaceId);
  });

export const inspectPriorityUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ url: z.string().url().max(2000) }).parse(input))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { inspectAndStoreUrl } = await import("@/lib/growthmind/gsc-sync-core");
    return await inspectAndStoreUrl(workspaceId, data.url);
  });

// ── Query / Page intelligence ─────────────────────────────────────────────────

export const getSeoIntelligence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      dimension: z.enum(["query", "page", "country", "device", "search_appearance"]),
      days: z.number().int().min(7).max(480).default(90),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(input))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { analyseDimension } = await import("@/lib/growthmind/seo-intelligence.server");
    return await analyseDimension(workspaceId, data.dimension, { days: data.days, limit: data.limit });
  });

export const getSeoOpportunities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ kinds: z.array(z.string()).default([]) }).parse(input))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { detectOpportunities } = await import("@/lib/growthmind/seo-intelligence.server");
    return await detectOpportunities(workspaceId, data.kinds);
  });

// ── Teachings (Teach GrowthMind SEO) ─────────────────────────────────────────

const teachingTypes = [
  "priority_product","priority_service","target_industry","target_country","target_language",
  "customer_problem","customer_question","sales_objection","search_topic","topic_to_avoid",
  "competitor","restricted_claim","preferred_cta","publishing_limit","approval_requirement",
  "commercial_objective","temporary_instruction","experiment",
] as const;

export const listSeoTeachings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data, error } = await sb
      .from("growthmind_seo_teachings")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { teachings: data ?? [] };
  });

export const saveSeoTeaching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      teachingType: z.enum(teachingTypes),
      content: z.string().min(2).max(4000),
      expiresAt: z.string().datetime().nullable().optional(),
      status: z.enum(["active", "expired", "retracted", "confirmed", "contradicted"]).optional(),
      resultNote: z.string().max(2000).nullable().optional(),
    }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const row: any = {
      workspace_id: workspaceId,
      teaching_type: data.teachingType,
      content: data.content,
      source: "user",
      owner_user_id: context.user?.id ?? null,
      expires_at: data.expiresAt ?? null,
      updated_at: new Date().toISOString(),
    };
    if (data.status) row.status = data.status;
    if (data.resultNote !== undefined) row.result_note = data.resultNote;
    if (data.id) {
      const { error } = await sb.from("growthmind_seo_teachings").update(row).eq("id", data.id).eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: ins, error } = await sb.from("growthmind_seo_teachings").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: ins.id };
  });

export const deleteSeoTeaching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { error } = await sb.from("growthmind_seo_teachings").delete().eq("id", data.id).eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Campaigns ────────────────────────────────────────────────────────────────

export const listSeoCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data, error } = await sb
      .from("growthmind_seo_campaigns")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { campaigns: data ?? [] };
  });

export const createSeoCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      name: z.string().min(3).max(200),
      campaignType: z.enum(["strategy","general","product","service","industry","country","local","existing_page_improvement","content_refresh","internal_link","metadata","technical","blog"]).default("blog"),
      objective: z.string().max(2000).optional(),
      productService: z.string().max(500).optional(),
      targetIndustry: z.string().max(300).optional(),
      targetCountry: z.string().max(100).optional(),
      language: z.string().max(50).optional(),
      customerProblem: z.string().max(2000).optional(),
      primaryTopic: z.string().max(500).optional(),
    }).parse(input))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { createSeoCampaignCore } = await import("@/lib/growthmind/seo-blog-campaign.server");
    return await createSeoCampaignCore({
      workspaceId,
      userId: context.user?.id ?? null,
      ...data,
    });
  });

export const approveSeoCampaignStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      campaignId: z.string().uuid(),
      stage: z.enum(["strategy", "brief", "content", "deployment"]),
    }).parse(input))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    // Stage approvals are sensitive (category "campaign") — enforce the same
    // entitlement the HiveMind Action Centre requires, so this direct path
    // cannot bypass approval controls (fail closed, audited).
    const { requireAction } = await import("@/lib/permissions/permissions.server");
    await requireAction(workspaceId, context.user?.id ?? null, "campaign_activation");
    const { advanceSeoCampaign } = await import("@/lib/growthmind/seo-blog-campaign.server");
    return await advanceSeoCampaign(workspaceId, data.campaignId, data.stage, context.user?.id ?? null);
  });

export const markSeoPackageDeployed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ packageId: z.string().uuid(), liveUrl: z.string().url().max(2000) }).parse(input))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { markPackageDeployed } = await import("@/lib/growthmind/seo-blog-campaign.server");
    return await markPackageDeployed(workspaceId, data.packageId, data.liveUrl);
  });

export const cancelSeoCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ campaignId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { error } = await sb
      .from("growthmind_seo_campaigns")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", data.campaignId)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getSeoCampaignDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ campaignId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data: campaign, error } = await sb
      .from("growthmind_seo_campaigns")
      .select("*")
      .eq("id", data.campaignId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!campaign) throw new Error("Campaign not found");
    let pkg: any = null;
    if (campaign.deployment_package_id) {
      const { data: p } = await sb
        .from("growthmind_seo_deployment_packages")
        .select("*")
        .eq("id", campaign.deployment_package_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      pkg = p ?? null;
    }
    return { campaign, deploymentPackage: pkg };
  });
