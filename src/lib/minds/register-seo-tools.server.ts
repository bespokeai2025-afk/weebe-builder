/**
 * GrowthMind SEO Department typed mind-tools (§3 master programme).
 *
 * Registered into the shared Mind tool registry — executeMindTool enforces
 * membership, entitlements, mode gates and (for sensitive tools) explicit
 * human approval. Every tool returns the standard SEO envelope from
 * seo-intelligence.server (no invented metrics; baseline_pending surfaced as
 * a limitation, never a failure).
 *
 * WBAH exclusion: campaign-creating tools re-check the workspace.
 */
import { z } from "zod";
import { registerMindTool, type MindToolContext, type MindToolRunResult } from "./tool-registry.server";

// ── Read/analysis tools ──────────────────────────────────────────────────────

registerMindTool({
  name: "growthmind.seo.get_search_performance",
  mind: "growthmind",
  title: "Get search performance",
  description: "Analyse synced Search Console performance for a dimension (query, page, country, device, search appearance) over a date window. Returns aggregated real metrics only; reports baseline_pending when Google has not published rows yet.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  requiredIntegrations: ["google_search_console"],
  mobileAvailable: true,
  currentHealth: "healthy",
  providerLimitations: "Requires Google Search Console property to be connected and have indexed data.",
  inputSchema: z.object({
    dimension: z.enum(["query", "page", "country", "device", "search_appearance"]).default("query"),
    days: z.number().int().min(7).max(480).default(90),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { analyseDimension } = await import("@/lib/growthmind/seo-intelligence.server");
    const env = await analyseDimension(ctx.workspaceId, input.dimension, { days: input.days, limit: input.limit });
    return { result: env as any };
  },
});

registerMindTool({
  name: "growthmind.seo.detect_opportunities",
  mind: "growthmind",
  title: "Detect SEO opportunities",
  description: "Scan synced Search Console data for opportunities: high-impression/low-click queries, low CTR, near-page-one rankings, declining or growing queries and pages. Evidence-based only.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  requiredIntegrations: ["google_search_console"],
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({ kinds: z.array(z.string()).default([]) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { detectOpportunities } = await import("@/lib/growthmind/seo-intelligence.server");
    const env = await detectOpportunities(ctx.workspaceId, input.kinds);
    return { result: env as any };
  },
});

registerMindTool({
  name: "growthmind.seo.audit_sitemaps",
  mind: "growthmind",
  title: "Audit sitemaps",
  description: "Report the sitemap situation for the connected Search Console property (submitted sitemaps, errors, warnings). Flags when no sitemap exists — submission itself requires approval.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  requiredIntegrations: ["google_search_console"],
  mobileAvailable: true,
  currentHealth: "healthy",
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    const { auditSitemaps } = await import("@/lib/growthmind/seo-intelligence.server");
    const env = await auditSitemaps(ctx.workspaceId);
    return { result: env as any };
  },
});

registerMindTool({
  name: "growthmind.seo.get_sync_status",
  mind: "growthmind",
  title: "Get Search Console sync status",
  description: "Report connection health, last sync outcome, data freshness (including baseline_pending for newly verified properties) and the next scheduled sync.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  requiredIntegrations: ["google_search_console"],
  mobileAvailable: true,
  currentHealth: "healthy",
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    const { getSyncStateForWorkspace } = await import("@/lib/growthmind/seo-intelligence.server");
    const r = await getSyncStateForWorkspace(ctx.workspaceId);
    return { result: { connected: r.connected, propertyUrl: r.propertyUrl, state: r.state } };
  },
});

registerMindTool({
  name: "growthmind.seo.list_campaigns",
  mind: "growthmind",
  title: "List SEO campaigns",
  description: "List SEO campaigns with their lifecycle stage, page decision, evidence summary and pending approvals.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  mobileAvailable: true,
  currentHealth: "healthy",
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("growthmind_seo_campaigns")
      .select("id, name, campaign_type, status, page_decision, primary_topic, proposed_url, blocked_reason, updated_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { result: { campaigns: data ?? [] } };
  },
});

// ── Write tools (approval-first) ─────────────────────────────────────────────

registerMindTool({
  name: "growthmind.seo.run_gsc_sync",
  mind: "growthmind",
  title: "Run Search Console sync",
  description: "Trigger an immediate Search Console data sync for this workspace (idempotent upserts; also runs automatically every day).",
  access: "write",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  requiredIntegrations: ["google_search_console"],
  mobileAvailable: true,
  currentHealth: "healthy",
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    const { runGscSyncForWorkspace } = await import("@/lib/growthmind/gsc-sync-core");
    const r = await runGscSyncForWorkspace(ctx.workspaceId);
    return { result: r as any, affectedRecordType: "growthmind_gsc_sync_state" };
  },
});

registerMindTool({
  name: "growthmind.seo.inspect_url",
  mind: "growthmind",
  title: "Inspect URL indexing",
  description: "Run Google URL Inspection for a specific URL on the connected property and store the verdict (indexed, crawled, canonical). Quota-limited — use selectively.",
  access: "write",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  requiredIntegrations: ["google_search_console"],
  mobileAvailable: true,
  currentHealth: "healthy",
  providerLimitations: "Google URL Inspection API quota-limited — use selectively, not in bulk.",
  inputSchema: z.object({ url: z.string().url().max(2000) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { inspectAndStoreUrl } = await import("@/lib/growthmind/gsc-sync-core");
    const r = await inspectAndStoreUrl(ctx.workspaceId, input.url);
    return { result: r as any, affectedRecordType: "growthmind_gsc_inspections" };
  },
});

registerMindTool({
  name: "growthmind.seo.create_seo_campaign",
  mind: "growthmind",
  title: "Create SEO campaign",
  description: "Propose a new SEO campaign (blog, product, service, industry, country, refresh, metadata…). The campaign starts at awaiting_strategy_approval — nothing is generated or published without explicit human approval at every stage.",
  access: "write",
  surface: "registry",
  sensitive: true,
  idempotent: false,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "approval_required",
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({
    name: z.string().min(3).max(200),
    campaignType: z.enum(["strategy","general","product","service","industry","country","local","existing_page_improvement","content_refresh","internal_link","metadata","technical","blog"]).default("blog"),
    objective: z.string().max(2000).optional(),
    productService: z.string().max(500).optional(),
    targetIndustry: z.string().max(300).optional(),
    targetCountry: z.string().max(100).optional(),
    language: z.string().max(50).optional(),
    customerProblem: z.string().max(2000).optional(),
    primaryTopic: z.string().max(500).optional(),
  }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { createSeoCampaignCore } = await import("@/lib/growthmind/seo-blog-campaign.server");
    const r = await createSeoCampaignCore({ workspaceId: ctx.workspaceId, userId: ctx.userId, ...input });
    if (!r.ok) throw new Error(r.error ?? "Campaign creation failed");
    return { result: r as any, affectedRecordType: "growthmind_seo_campaigns", affectedRecordId: r.campaignId ?? null };
  },
});

registerMindTool({
  name: "growthmind.seo.submit_approved_sitemap",
  mind: "growthmind",
  title: "Submit sitemap to Search Console",
  description: "Submit a sitemap URL to Google Search Console for the connected property. Consequential external change — always requires explicit approval.",
  access: "write",
  surface: "registry",
  sensitive: true,
  idempotent: true,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "approval_required",
  requiredIntegrations: ["google_search_console"],
  mobileAvailable: true,
  currentHealth: "healthy",
  providerLimitations: "Requires Google Search Console property to be connected and verified.",
  inputSchema: z.object({ sitemapUrl: z.string().url().max(2000) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { getValidGscToken, submitSitemapToGsc, fetchSitemapList } = await import("@/lib/growthmind/gsc-sync-core");
    const conn = await getValidGscToken(ctx.workspaceId);
    if (!conn.propertyUrl) throw new Error("No Search Console property selected");
    await submitSitemapToGsc(conn.accessToken, conn.propertyUrl, input.sitemapUrl);
    const after = await fetchSitemapList(conn.accessToken, conn.propertyUrl);
    return {
      result: { submitted: input.sitemapUrl, property: conn.propertyUrl, sitemapsNow: after.map((s: any) => s.path) },
      affectedRecordType: "growthmind_gsc_sitemaps",
    };
  },
});

// ── SystemMind SEO execution (§12 — evidence-attached technical audit) ──────

registerMindTool({
  name: "systemmind.seo_health_check",
  mind: "systemmind",
  title: "SEO technical health check",
  description: "Deterministic SEO technical audit with evidence: Search Console connection & token, sync jobs, sitemap accessibility (live fetch), robots.txt, noindex/canonical verification on deployed pages, GitHub status (read-only), deployment package health. Returns checks performed, records inspected, root causes and proposed fixes — never generic advice.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "monitoring",
  capabilityState: "available",
  mobileAvailable: true,
  currentHealth: "healthy",
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    const { runSeoTechAudit } = await import("@/lib/systemmind/seo-tech-audit.server");
    const r = await runSeoTechAudit(ctx.workspaceId);
    return { result: r as any };
  },
});

// ── AccountsMind SEO cost & attribution (§13 — evidence-only) ───────────────

registerMindTool({
  name: "accountsmind.seo_costs",
  mind: "accountsmind",
  title: "SEO campaign costs & returns",
  description: "SEO spend and outcomes where evidence exists: AI generation cost from logged usage (task_type seo_campaign), campaigns run, deployed pages, and organic leads only where a lead row is explicitly attributable. Attribution states: attributed, partially_attributed, unknown — financial attribution is never invented.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "finance",
  capabilityState: "available",
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({ days: z.number().int().min(7).max(365).default(90) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const since = new Date(Date.now() - input.days * 86400_000).toISOString();
    const [gen, camps, pkgs] = await Promise.all([
      admin.from("growthmind_generation_logs")
        .select("estimated_cost_usd, provider, model")
        .eq("workspace_id", ctx.workspaceId)
        .eq("task_type", "seo_campaign")
        .gte("created_at", since)
        .limit(1000),
      admin.from("growthmind_seo_campaigns")
        .select("id, name, status, created_at")
        .eq("workspace_id", ctx.workspaceId)
        .gte("created_at", since)
        .limit(200),
      admin.from("growthmind_seo_deployment_packages")
        .select("id, status, live_url, verified_at")
        .eq("workspace_id", ctx.workspaceId)
        .gte("created_at", since)
        .limit(200),
    ]);
    const aiCostUsd = (gen.data ?? []).reduce((s: number, r: any) => s + (Number(r.estimated_cost_usd) || 0), 0);
    const liveUrls = (pkgs.data ?? []).filter((p: any) => p.live_url && p.verified_at).map((p: any) => p.live_url);
    return {
      result: {
        windowDays: input.days,
        aiGenerationCostUsd: Math.round(aiCostUsd * 10000) / 10000,
        generationCalls: (gen.data ?? []).length,
        campaigns: (camps.data ?? []).length,
        deployedVerifiedPages: liveUrls.length,
        liveUrls,
        organicLeadAttribution: {
          state: "unknown",
          note: "No lead rows carry explicit SEO-page attribution yet; organic lead and revenue attribution will only be reported when evidence exists (never estimated).",
        },
      },
    };
  },
});

// ── HiveMind SEO command tools (§11 — chat-executable via hivemind.* names) ──

registerMindTool({
  name: "hivemind.seo_opportunities",
  mind: "hivemind",
  title: "SEO opportunities",
  description: "Best SEO opportunities from real Search Console data: high-impression/low-CTR queries, pages close to page one, declining pages. States when data is still processing (baseline_pending) instead of inventing results.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  mobileAvailable: true,
  currentHealth: "healthy",
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    const { detectOpportunities } = await import("@/lib/growthmind/seo-intelligence.server");
    const env = await detectOpportunities(ctx.workspaceId, []);
    return { result: env as any };
  },
});

registerMindTool({
  name: "hivemind.seo_performance",
  mind: "hivemind",
  title: "SEO search performance",
  description: "Real Search Console performance for queries, pages, countries or devices over a chosen window. Use for questions like 'find queries with impressions but poor CTR' or 'find pages close to page one'.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({
    dimension: z.enum(["query", "page", "country", "device", "search_appearance"]).default("query"),
    days: z.number().int().min(7).max(480).default(90),
  }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { analyseDimension } = await import("@/lib/growthmind/seo-intelligence.server");
    const env = await analyseDimension(ctx.workspaceId, input.dimension, { days: input.days, limit: 100 });
    return { result: env as any };
  },
});

registerMindTool({
  name: "hivemind.seo_status",
  mind: "hivemind",
  title: "SEO department status",
  description: "Search Console connection health, sync/data-processing state, sitemap situation and recent URL Inspection verdicts. Use for 'check the sitemap' or 'is the page indexed'.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  mobileAvailable: true,
  currentHealth: "healthy",
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    const [{ getSyncStateForWorkspace, auditSitemaps, listStoredInspections }] = await Promise.all([
      import("@/lib/growthmind/seo-intelligence.server"),
    ]);
    const [state, sitemaps, inspections] = await Promise.all([
      getSyncStateForWorkspace(ctx.workspaceId),
      auditSitemaps(ctx.workspaceId),
      listStoredInspections(ctx.workspaceId, 10),
    ]);
    return { result: { connection: { connected: state.connected, propertyUrl: state.propertyUrl }, sync: state.state, sitemaps: sitemaps.deliverables, recentInspections: inspections } };
  },
});

registerMindTool({
  name: "hivemind.seo_campaigns",
  mind: "hivemind",
  title: "SEO campaigns & blockers",
  description: "List SEO campaigns with lifecycle stage, pending approvals and blockers. Use for 'why is publication blocked' or campaign progress questions.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  mobileAvailable: true,
  currentHealth: "healthy",
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("growthmind_seo_campaigns")
      .select("id, name, campaign_type, status, page_decision, primary_topic, proposed_url, blocked_reason, data_limitations, updated_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return { result: { campaigns: data ?? [], approvalModel: "Each campaign pauses for explicit human approval at strategy, brief, content and deployment stages; publication is a manual Lovable deployment — never automatic." } };
  },
});

registerMindTool({
  name: "hivemind.create_seo_campaign",
  mind: "hivemind",
  title: "Create SEO campaign",
  description: "Create a connected SEO/blog campaign work order and dispatch GrowthMind. Campaign starts at awaiting_strategy_approval — nothing is generated or published without human approval.",
  access: "write",
  surface: "registry",
  sensitive: true,
  idempotent: false,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "approval_required",
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({
    name: z.string().min(3).max(200),
    campaignType: z.enum(["blog","product","service","industry","country","existing_page_improvement","content_refresh","metadata","strategy","general"]).default("blog"),
    objective: z.string().max(2000).optional(),
    primaryTopic: z.string().max(500).optional(),
    targetIndustry: z.string().max(300).optional(),
    targetCountry: z.string().max(100).optional(),
    customerProblem: z.string().max(2000).optional(),
  }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { createSeoCampaignCore } = await import("@/lib/growthmind/seo-blog-campaign.server");
    const r = await createSeoCampaignCore({ workspaceId: ctx.workspaceId, userId: ctx.userId, ...input });
    if (!r.ok) throw new Error(r.error ?? "Campaign creation failed");
    return { result: r as any, affectedRecordType: "growthmind_seo_campaigns", affectedRecordId: r.campaignId ?? null };
  },
});

registerMindTool({
  name: "hivemind.seo_inspect_url",
  mind: "hivemind",
  title: "Check page indexing",
  description: "Run Google URL Inspection for a URL and report the real verdict — never claims indexing without proof.",
  access: "write",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  requiredIntegrations: ["google_search_console"],
  mobileAvailable: true,
  currentHealth: "healthy",
  providerLimitations: "Google URL Inspection API quota-limited — use selectively, not in bulk.",
  inputSchema: z.object({ url: z.string().url().max(2000) }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { inspectAndStoreUrl } = await import("@/lib/growthmind/gsc-sync-core");
    const r = await inspectAndStoreUrl(ctx.workspaceId, input.url);
    return { result: r as any, affectedRecordType: "growthmind_gsc_inspections" };
  },
});

registerMindTool({
  name: "growthmind.seo.save_teaching",
  mind: "growthmind",
  title: "Teach GrowthMind SEO",
  description: "Record a durable SEO teaching (priority products, target industries, restricted claims, topics to avoid, publishing limits…). Teachings steer every future campaign and the safety gate.",
  access: "write",
  surface: "registry",
  sensitive: false,
  idempotent: false,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "seo",
  capabilityState: "available",
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({
    teachingType: z.enum(["priority_product","priority_service","target_industry","target_country","target_language","customer_problem","customer_question","sales_objection","search_topic","topic_to_avoid","competitor","restricted_claim","preferred_cta","publishing_limit","approval_requirement","commercial_objective","temporary_instruction","experiment"]),
    content: z.string().min(2).max(4000),
    expiresAt: z.string().datetime().nullable().optional(),
  }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("growthmind_seo_teachings")
      .insert({
        workspace_id: ctx.workspaceId,
        teaching_type: input.teachingType,
        content: input.content,
        source: "chat",
        owner_user_id: ctx.userId,
        expires_at: input.expiresAt ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { result: { ok: true, id: data.id }, affectedRecordType: "growthmind_seo_teachings", affectedRecordId: data.id };
  },
});
