import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatDnaAsContext } from "./growthmind.business-dna";
import {
  routeToEngines, buildStrategyGenerationPrompt,
  STRATEGY_TYPE_LABELS, ENGINE_LABELS,
  type StrategyCentreType, type PromptEngine,
} from "./prompt-command-router.server";

// ── Types ───────────────────────────────────────────────────────────────────────

export type StrategyCentreKpi = { metric: string; target: string; period: string };

export type StrategyCentre = {
  id:                     string;
  workspaceId:            string;
  strategyType:           StrategyCentreType;
  status:                 string;
  selectedService:        string | null;
  serviceSelectionReason: string | null;
  serviceScores:          Record<string, number>;
  executiveSummary:       string;
  targetAudience:         string;
  channelRecommendation:  string[];
  budgetRecommendation:   string;
  expectedOutcome:        string;
  campaignPlan:           string;
  contentPlan:            string;
  videoPlan:              string;
  seoPlan:                string;
  whatsappPlan:           string;
  emailPlan:              string;
  aiCallingPlan:          string;
  landingPagePlan:        string;
  kpis:                   StrategyCentreKpi[];
  risks:                  string;
  requiredAssets:         string[];
  approvalActions:        string[];
  promptEnginesUsed:      PromptEngine[];
  confidenceScore:        number;
  generatedByModel:       string | null;
  hivemindActionId:       string | null;
  rejectionReason:        string | null;
  userBudget:             string | null;
  userGoal:               string | null;
  createdAt:              string;
  updatedAt:              string;
};

// ── Mappers ─────────────────────────────────────────────────────────────────────

function mapStrategy(r: any): StrategyCentre {
  return {
    id:                     r.id,
    workspaceId:            r.workspace_id,
    strategyType:           r.strategy_type as StrategyCentreType,
    status:                 r.status,
    selectedService:        r.selected_service ?? null,
    serviceSelectionReason: r.service_selection_reason ?? null,
    serviceScores:          r.service_scores ?? {},
    executiveSummary:       r.executive_summary ?? "",
    targetAudience:         r.target_audience ?? "",
    channelRecommendation:  r.channel_recommendation ?? [],
    budgetRecommendation:   r.budget_recommendation ?? "",
    expectedOutcome:        r.expected_outcome ?? "",
    campaignPlan:           r.campaign_plan ?? "",
    contentPlan:            r.content_plan ?? "",
    videoPlan:              r.video_plan ?? "",
    seoPlan:                r.seo_plan ?? "",
    whatsappPlan:           r.whatsapp_plan ?? "",
    emailPlan:              r.email_plan ?? "",
    aiCallingPlan:          r.ai_calling_plan ?? "",
    landingPagePlan:        r.landing_page_plan ?? "",
    kpis:                   r.kpis ?? [],
    risks:                  r.risks ?? "",
    requiredAssets:         r.required_assets ?? [],
    approvalActions:        r.approval_actions ?? [],
    promptEnginesUsed:      r.prompt_engines_used ?? [],
    confidenceScore:        r.confidence_score ?? 0,
    generatedByModel:       r.generated_by_model ?? null,
    hivemindActionId:       r.hivemind_action_id ?? null,
    rejectionReason:        r.rejection_reason ?? null,
    userBudget:             r.user_budget  ?? null,
    userGoal:               r.user_goal    ?? null,
    createdAt:              r.created_at,
    updatedAt:              r.updated_at,
  };
}

// ── Data collection helper ──────────────────────────────────────────────────────

async function collectBusinessContext(sb: any, workspaceId: string) {
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    dnaRes, settingsRes, valuePointRes, opportunityRes, competitorRes,
    leadsRes, callsRes, bookingsRes,
    seoRes, waRes, hexmailRes, adsRes, contentRes, kbRes,
  ] = await Promise.all([
    sb.from("growthmind_business_dna").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    sb.from("workspace_settings").select("revenue_goals, monthly_marketing_budget, business_name, industry").eq("workspace_id", workspaceId).maybeSingle(),
    sb.from("growthmind_value_points").select("current_highest_value").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("growthmind_opportunities").select("title, recommended_action, urgency, score").eq("workspace_id", workspaceId).order("score", { ascending: false }).limit(5),
    sb.from("growthmind_competitors").select("name, website, positioning").eq("workspace_id", workspaceId).limit(10),
    sb.from("leads").select("id, status").eq("workspace_id", workspaceId).limit(2000),
    sb.from("calls").select("id, call_successful").eq("workspace_id", workspaceId).gte("started_at", since90).limit(3000),
    sb.from("calendar_bookings").select("id").eq("workspace_id", workspaceId).limit(500),
    sb.from("growthmind_seo_sites").select("keywords").eq("workspace_id", workspaceId).limit(10),
    sb.from("whatsapp_contacts").select("id").eq("workspace_id", workspaceId).limit(1),
    sb.from("hexmail_campaigns").select("status, open_rate, click_rate").eq("workspace_id", workspaceId).limit(50),
    sb.from("growthmind_ads_accounts").select("status, platform").eq("workspace_id", workspaceId).limit(20),
    sb.from("growthmind_content_assets").select("status").eq("workspace_id", workspaceId).gte("created_at", since30).limit(100),
    sb.from("weebee_kb").select("title, content").or(`workspace_id.eq.${workspaceId},scope.eq.platform`).limit(5).order("created_at", { ascending: false }),
  ].map(p => p.catch(() => ({ data: null }))));

  const dna         = dnaRes.data;
  const settings    = settingsRes.data;
  const leads: any[]     = leadsRes.data    ?? [];
  const calls: any[]     = callsRes.data    ?? [];
  const bookings: any[]  = bookingsRes.data ?? [];
  const seoSites: any[]  = seoRes.data      ?? [];
  const hexmail: any[]   = hexmailRes.data  ?? [];
  const adsAccounts: any[] = adsRes.data    ?? [];
  const contentAssets: any[] = contentRes.data ?? [];
  const opportunities: any[] = opportunityRes.data ?? [];
  const competitors: any[]   = competitorRes.data  ?? [];

  const kbDocs: any[] = kbRes.data ?? [];
  const kbContext = kbDocs.length > 0
    ? "\n## Knowledge Base\n" + kbDocs.map((r: any) =>
        `### ${r.title ?? "Document"}\n${String(r.content ?? "").slice(0, 500)}`
      ).join("\n\n")
    : "";

  const totalLeads   = leads.length;
  const wonLeads     = leads.filter(l => l.status === "sale" || l.status === "won").length;
  const convRate     = totalLeads > 0 ? wonLeads / totalLeads : 0;
  const callSuccRate = calls.length > 0 ? calls.filter(c => c.call_successful).length / calls.length : 0;
  const seoKeywords  = seoSites.reduce((a: number, s: any) => a + ((s.keywords as any[])?.length ?? 0), 0);
  const activeHexmail = hexmail.filter((h: any) => h.status === "active");
  const hexOpenRate  = activeHexmail.filter((h: any) => h.open_rate != null).length > 0
    ? Math.round(activeHexmail.reduce((a: number, h: any) => a + (h.open_rate ?? 0), 0) / activeHexmail.filter((h: any) => h.open_rate != null).length)
    : null;

  const snapshot = {
    totalLeads,
    wonLeads,
    conversionRate:         Math.round(convRate * 100) + "%",
    totalBookings:          bookings.length,
    callSuccessRate:        Math.round(callSuccRate * 100) + "%",
    totalCalls90d:          calls.length,
    seoKeywordsTracked:     seoKeywords,
    publishedContent30d:    contentAssets.filter((a: any) => a.status === "published").length,
    hasWhatsApp:            (waRes.data ?? []).length > 0,
    hasActiveAds:           adsAccounts.some((a: any) => a.status === "active"),
    activeAdPlatforms:      adsAccounts.filter((a: any) => a.status === "active").map((a: any) => a.platform).filter(Boolean),
    activeHexmailCampaigns: activeHexmail.length,
    hexmailAvgOpenRate:     hexOpenRate != null ? hexOpenRate + "%" : "N/A",
    topOpportunities:       opportunities.map((o: any) => ({ title: o.title, urgency: o.urgency, score: o.score })),
    competitors:            competitors.map((c: any) => ({ name: c.name, website: c.website ?? null, positioning: c.positioning ?? null })).filter((c: any) => c.name),
    revenueGoal:            settings?.revenue_goals ?? null,
    monthlyBudget:          settings?.monthly_marketing_budget ?? null,
  };

  const dnaContext = dna ? formatDnaAsContext({
    id: dna.id, workspaceId,
    companyName: dna.company_name ?? "",
    website: dna.website ?? "",
    industry: dna.industry ?? "",
    products: dna.products ?? "",
    services: dna.services ?? "",
    pricing: dna.pricing ?? "",
    offers: dna.offers ?? "",
    locations: dna.locations ?? "",
    idealCustomerProfiles: dna.ideal_customer_profiles ?? "",
    targetMarkets: dna.target_markets ?? "",
    uniqueSellingPoints: dna.unique_selling_points ?? "",
    competitorsSummary: dna.competitors_summary ?? "",
    revenueGoals: dna.revenue_goals ?? "",
    monthlyMarketingBudget: dna.monthly_marketing_budget ?? null,
    mainGrowthObjective: dna.main_growth_objective ?? "",
    salesProcess: dna.sales_process ?? "",
    averageDealValue: dna.average_deal_value ?? null,
    profitMarginPct: dna.profit_margin_pct ?? null,
    bestCustomers: dna.best_customers ?? "",
    worstCustomers: dna.worst_customers ?? "",
    caseStudies: dna.case_studies ?? "",
    brandVoice: dna.brand_voice ?? "",
    complianceNotes: dna.compliance_notes ?? "",
    updatedAt: dna.updated_at ?? "",
  }) : "## Business DNA\nNot yet configured. Add DNA data in GrowthMind → Business DNA.";

  const valuePoint = (valuePointRes.data as any)?.current_highest_value ?? null;

  return { dnaContext, snapshot, valuePoint, kbContext };
}

// ── generateStrategyCentre ──────────────────────────────────────────────────────

export const generateStrategyCentre = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      strategyType: z.enum([
        "30_day", "60_day", "90_day",
        "seo_campaign", "meta_ads", "google_ads", "linkedin",
        "whatsapp_campaign", "hexmail_campaign",
        "video_ad", "ai_calling_campaign", "landing_page_campaign",
        "full_multi_channel",
      ]),
      budget: z.string().optional(),
      goal:   z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const model   = "gpt-4o-mini";
    const engines = routeToEngines(data.strategyType);
    const t0      = Date.now();

    const { dnaContext, snapshot, valuePoint, kbContext } = await collectBusinessContext(sb, workspaceId);

    const valueContext  = valuePoint ? `\n## Current Highest-Value Offer\n${valuePoint}` : "";
    const campaignBrief = (data.budget || data.goal)
      ? `\n## Campaign Brief (User-Specified)\nGoal: ${data.goal ?? "Grow the business"}\nBudget: ${data.budget ?? "See DNA"}`
      : "";
    const fullContext   = dnaContext + valueContext + kbContext + campaignBrief;

    const prompt = buildStrategyGenerationPrompt(
      data.strategyType, engines, fullContext, snapshot,
    );

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages:        [{ role: "user", content: prompt }],
        max_tokens:      data.strategyType === "full_multi_channel" ? 5500 : 3500,
        temperature:     0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI error: ${errText.slice(0, 300)}`);
    }

    const json         = await res.json() as any;
    const raw          = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
    const inputTokens  = json.usage?.prompt_tokens     ?? 0;
    const outputTokens = json.usage?.completion_tokens ?? 0;
    const durationMs   = Date.now() - t0;

    const payload = {
      workspace_id:            workspaceId,
      strategy_type:           data.strategyType,
      status:                  "draft",
      selected_service:        raw.selected_service         ?? null,
      service_selection_reason:raw.service_selection_reason ?? null,
      service_scores:          raw.service_scores           ?? {},
      executive_summary:       raw.executive_summary        ?? "",
      target_audience:         raw.target_audience          ?? "",
      channel_recommendation:  raw.channel_recommendation   ?? [],
      budget_recommendation:   raw.budget_recommendation    ?? "",
      expected_outcome:        raw.expected_outcome         ?? "",
      campaign_plan:           raw.campaign_plan            ?? "",
      content_plan:            raw.content_plan             ?? "",
      video_plan:              raw.video_plan               ?? "",
      seo_plan:                raw.seo_plan                 ?? "",
      whatsapp_plan:           raw.whatsapp_plan            ?? "",
      email_plan:              raw.email_plan               ?? "",
      ai_calling_plan:         raw.ai_calling_plan          ?? "",
      landing_page_plan:       raw.landing_page_plan        ?? "",
      kpis:                    raw.kpis                     ?? [],
      risks:                   raw.risks                    ?? "",
      required_assets:         raw.required_assets          ?? [],
      approval_actions:        raw.approval_actions         ?? [],
      prompt_engines_used:     engines,
      source_data_snapshot:    snapshot,
      confidence_score:        Math.min(1, Math.max(0, Number(raw.confidence_score) || 0.75)),
      generated_by_model:      model,
      user_budget:             data.budget ?? null,
      user_goal:               data.goal   ?? null,
      updated_at:              new Date().toISOString(),
    };

    const { data: inserted, error } = await sb
      .from("growthmind_strategy_centre")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Log prompt run
    await sb.from("growthmind_prompt_runs").insert({
      workspace_id: workspaceId,
      strategy_id:  inserted.id,
      engine:       "strategy_centre",
      prompt_type:  data.strategyType,
      model_used:   model,
      tokens_used:  inputTokens + outputTokens,
      duration_ms:  durationMs,
      status:       "success",
    }).catch(() => {/* non-critical */});

    // Audit log (best-effort)
    await sb.from("growthmind_generation_audit").insert({
      workspace_id:  workspaceId,
      event_type:    `strategy_centre_${data.strategyType}`,
      entity_type:   "strategy_centre",
      model_used:    model,
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
      triggered_by:  "user",
      duration_ms:   durationMs,
      status:        "success",
    }).catch(() => {/* non-critical */});

    // ── Generate per-engine campaign assets (single consolidated LLM call) ─────
    try {
      const assetEngineList = engines.join(", ");
      const assetLabels     = engines.map(e => ENGINE_LABELS[e]).join(", ");
      const assetsPrompt    = `You are GrowthMind. Generate specific, ready-to-use marketing deliverables for: ${assetLabels}.

BUSINESS: ${raw.selected_service ?? "the business"} | AUDIENCE: ${raw.target_audience ?? "target audience"}
STRATEGY: ${raw.executive_summary ? String(raw.executive_summary).slice(0, 300) : "See strategy above"}

Return ONLY valid JSON with one key per engine from [${assetEngineList}]. Each value must be a detailed, specific deliverable (100-300 words):
- seo: Top 10 priority keywords + content cluster brief
- content_studio: 3 blog post outlines with hooks and structure  
- video_studio: Complete 60-second ad script with hook, body, and CTA
- campaign_factory: 3 ad headlines + 3 descriptions + targeting brief
- whatsapp: 3-message sequence with exact copy
- hexmail: 3-email sequence with subject lines + preview text + body angles
- ai_calling: Full call script with opener, 3 qualification questions, 3 objections + responses
- landing_page: Full page structure with headline, 5 bullet benefits, social proof, CTA copy

Only include keys from: [${assetEngineList}]`;

      const assetsApiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages:        [{ role: "user", content: assetsPrompt }],
          max_tokens:      data.strategyType === "full_multi_channel" ? 4500 : 3000,
          temperature:     0.65,
          response_format: { type: "json_object" },
        }),
      });
      if (assetsApiRes.ok) {
        const assetsJson = await assetsApiRes.json() as any;
        const assetsRaw  = JSON.parse(assetsJson.choices?.[0]?.message?.content ?? "{}");
        const assetRows  = Object.entries(assetsRaw)
          .filter(([, v]) => typeof v === "string" && (v as string).trim().length > 0)
          .map(([engineKey, content]) => ({
            workspace_id: workspaceId,
            strategy_id:  inserted.id,
            engine:       engineKey,
            asset_type:   "plan_deliverable",
            title:        ENGINE_LABELS[engineKey as PromptEngine] ?? engineKey,
            content:      content as string,
            status:       "draft",
          }));
        if (assetRows.length > 0) {
          await Promise.resolve(sb.from("growthmind_strategy_assets").insert(assetRows)).catch(() => {});
        }
      }
    } catch { /* non-critical — asset generation is best-effort */ }

    // ── Auto-send to HiveMind for approval ──────────────────────────────────
    let hivemindActionId: string | null = null;
    try {
      const typeLabel2    = STRATEGY_TYPE_LABELS[data.strategyType];
      const engineList2   = engines.map(e => ENGINE_LABELS[e]).join(", ");
      const hmDescription = [
        `**Strategy:** ${typeLabel2}`,
        raw.selected_service ? `**Service to Promote:** ${raw.selected_service}` : null,
        raw.service_selection_reason
          ? `**Why:** ${String(raw.service_selection_reason ?? "").slice(0, 250)}`
          : null,
        `**Target Audience:** ${raw.target_audience ?? ""}`,
        `**Channels:** ${(raw.channel_recommendation as string[] ?? []).join(", ")}`,
        `**Budget:** ${raw.budget_recommendation ?? ""}`,
        `**Expected Outcome:** ${raw.expected_outcome ?? ""}`,
        `**Engines Used:** ${engineList2}`,
        `**Confidence:** ${Math.round(Math.min(1, Math.max(0, Number(raw.confidence_score) || 0.75)) * 100)}%`,
        (raw.approval_actions as string[] ?? []).length > 0
          ? `\n**Actions Required:**\n${(raw.approval_actions as string[]).map((a: string, i: number) => `${i + 1}. ${a}`).join("\n")}`
          : null,
      ].filter(Boolean).join("\n");

      const { data: hmAction } = await sb.from("hivemind_actions").insert({
        workspace_id:   workspaceId,
        title:          `GrowthMind ${typeLabel2}: ${raw.selected_service ?? "Growth Strategy"}`,
        description:    hmDescription,
        action_type:    "review_strategy",
        action_payload: {
          strategy_id:   inserted.id,
          strategy_type: data.strategyType,
          channels:      raw.channel_recommendation ?? [],
          engines,
        },
        proposed_by: "growthmind",
        status:      "pending",
      }).select("id").single();

      if (hmAction?.id) {
        hivemindActionId = hmAction.id;
        await sb.from("growthmind_strategy_centre").update({
          status:             "proposed_to_hivemind",
          hivemind_action_id: hmAction.id,
          updated_at:         new Date().toISOString(),
        }).eq("id", inserted.id).eq("workspace_id", workspaceId);
      }
    } catch { /* non-critical — HiveMind tables may not exist in all environments */ }

    // Re-read final state (may be proposed_to_hivemind if auto-send succeeded)
    const { data: full } = await sb
      .from("growthmind_strategy_centre")
      .select("*")
      .eq("id", inserted.id)
      .single();

    return { strategy: mapStrategy(full), autoSentToHiveMind: !!hivemindActionId };
  });

// ── listStrategyCentre ──────────────────────────────────────────────────────────

export const listStrategyCentre = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_strategy_centre")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);
    return { strategies: (data ?? []).map(mapStrategy) };
  });

// ── getStrategyCentre ───────────────────────────────────────────────────────────

export const getStrategyCentre = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: row, error } = await sb
      .from("growthmind_strategy_centre")
      .select("*")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .single();
    if (error) throw new Error(error.message);

    return { strategy: mapStrategy(row) };
  });

// ── sendStrategyCentreToHiveMind ────────────────────────────────────────────────

export const sendStrategyCentreToHiveMind = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ strategyId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: s, error: se } = await sb
      .from("growthmind_strategy_centre")
      .select("*")
      .eq("id", data.strategyId)
      .eq("workspace_id", workspaceId)
      .single();
    if (se) throw new Error(se.message);

    const strategy = mapStrategy(s);

    // Guard: already proposed — return existing action instead of creating a duplicate
    if (strategy.hivemindActionId) {
      return { actionId: strategy.hivemindActionId };
    }

    const typeLabel = STRATEGY_TYPE_LABELS[strategy.strategyType];
    const engines   = strategy.promptEnginesUsed.map(e => ENGINE_LABELS[e as PromptEngine]).join(", ");

    const description = [
      `**Strategy:** ${typeLabel}`,
      strategy.selectedService ? `**Service:** ${strategy.selectedService}` : null,
      strategy.selectedService && strategy.serviceSelectionReason ? `**Why:** ${strategy.serviceSelectionReason.slice(0, 200)}` : null,
      `**Target Audience:** ${strategy.targetAudience}`,
      `**Channels:** ${strategy.channelRecommendation.join(", ")}`,
      `**Budget:** ${strategy.budgetRecommendation}`,
      `**Expected Outcome:** ${strategy.expectedOutcome}`,
      `**Engines Used:** ${engines}`,
      `**Confidence:** ${Math.round(strategy.confidenceScore * 100)}%`,
      strategy.approvalActions.length > 0
        ? `\n**Actions Required:**\n${strategy.approvalActions.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
        : null,
    ].filter(Boolean).join("\n");

    // Create hivemind_action
    const { data: action, error: ae } = await sb.from("hivemind_actions").insert({
      workspace_id:   workspaceId,
      title:          `GrowthMind ${typeLabel}: ${strategy.selectedService ?? "Growth Strategy"}`,
      description,
      action_type:    "review_strategy",
      action_payload: {
        strategy_id:   strategy.id,
        strategy_type: strategy.strategyType,
        channels:      strategy.channelRecommendation,
        engines:       strategy.promptEnginesUsed,
      },
      proposed_by: "growthmind",
      status:      "pending",
    }).select("id").single();

    if (ae) throw new Error(ae.message);

    await sb.from("growthmind_strategy_centre").update({
      status:             "proposed_to_hivemind",
      hivemind_action_id: action.id,
      updated_at:         new Date().toISOString(),
    }).eq("id", data.strategyId).eq("workspace_id", workspaceId);

    return { actionId: action.id };
  });

// ── approveStrategyCentre ───────────────────────────────────────────────────────

export const approveStrategyCentre = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ strategyId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: s, error: se } = await sb
      .from("growthmind_strategy_centre")
      .select("*")
      .eq("id", data.strategyId)
      .eq("workspace_id", workspaceId)
      .single();
    if (se) throw new Error(se.message);

    const strategy = mapStrategy(s);

    // Create tasks from approval actions — distribute across weeks, smart priority
    const channels = strategy.channelRecommendation;
    const taskRows = strategy.approvalActions.map((action, i) => ({
      workspace_id: workspaceId,
      strategy_id:  data.strategyId,
      title:        action,
      description:  `From ${STRATEGY_TYPE_LABELS[strategy.strategyType]}`,
      channel:      channels.length > 0 ? channels[i % channels.length] : "general",
      priority:     i === 0 ? "high" : i < 3 ? "medium" : "low",
      week_number:  Math.floor(i / 2) + 1,
      status:       "pending",
    }));

    if (taskRows.length > 0) {
      await Promise.resolve(sb.from("growthmind_strategy_tasks").insert(taskRows)).catch(() => {/* graceful */});
    }

    // Update hivemind_action if it exists
    if (strategy.hivemindActionId) {
      await sb.from("hivemind_actions")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", strategy.hivemindActionId)
        .catch(() => {});
    }

    await sb.from("growthmind_strategy_centre").update({
      status:     "approved",
      updated_at: new Date().toISOString(),
    }).eq("id", data.strategyId).eq("workspace_id", workspaceId);

    return { ok: true, tasksCreated: taskRows.length };
  });

// ── rejectStrategyCentre ────────────────────────────────────────────────────────

export const rejectStrategyCentre = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ strategyId: z.string().uuid(), reason: z.string().optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: s } = await sb
      .from("growthmind_strategy_centre")
      .select("hivemind_action_id")
      .eq("id", data.strategyId)
      .eq("workspace_id", workspaceId)
      .single();

    if (s?.hivemind_action_id) {
      await sb.from("hivemind_actions")
        .update({ status: "dismissed", updated_at: new Date().toISOString() })
        .eq("id", s.hivemind_action_id)
        .catch(() => {});
    }

    await sb.from("growthmind_strategy_centre").update({
      status:           "rejected",
      rejection_reason: data.reason ?? null,
      updated_at:       new Date().toISOString(),
    }).eq("id", data.strategyId).eq("workspace_id", workspaceId);

    return { ok: true };
  });

// ── deleteStrategyCentre ────────────────────────────────────────────────────────

export const deleteStrategyCentre = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ strategyId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Dismiss linked hivemind_action before deleting so it doesn't stay pending
    const { data: forDelete } = await sb
      .from("growthmind_strategy_centre")
      .select("hivemind_action_id")
      .eq("id", data.strategyId)
      .eq("workspace_id", workspaceId)
      .single()
      .catch(() => ({ data: null }));

    if (forDelete?.hivemind_action_id) {
      await sb.from("hivemind_actions")
        .update({ status: "dismissed", updated_at: new Date().toISOString() })
        .eq("id", forDelete.hivemind_action_id)
        .catch(() => {});
    }

    const { error } = await sb
      .from("growthmind_strategy_centre")
      .delete()
      .eq("id", data.strategyId)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

// ── getStrategyCentreSummary (for HiveMind — plain async, not a server fn) ──────

export async function getStrategyCentreSummary(sb: any, workspaceId: string) {
  try {
    const { data } = await sb
      .from("growthmind_strategy_centre")
      .select("id, strategy_type, status, selected_service, confidence_score, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (!data?.length) return null;

    const pending  = data.filter((s: any) => s.status === "proposed_to_hivemind");
    const approved = data.filter((s: any) => s.status === "approved");
    const latest   = data[0];

    return {
      total:   data.length,
      pending: pending.length,
      approved: approved.length,
      latest: latest ? {
        type:       latest.strategy_type as StrategyCentreType,
        status:     latest.status,
        service:    latest.selected_service ?? null,
        confidence: latest.confidence_score ?? 0,
        createdAt:  latest.created_at,
      } : null,
    };
  } catch {
    return null;
  }
}

// ── updateStrategyCentre ─────────────────────────────────────────────────────────

export const updateStrategyCentre = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      strategyId:            z.string().uuid(),
      executiveSummary:      z.string().optional(),
      selectedService:       z.string().optional(),
      targetAudience:        z.string().optional(),
      channelRecommendation: z.array(z.string()).optional(),
      budgetRecommendation:  z.string().optional(),
      expectedOutcome:       z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { strategyId, ...fields } = data;
    const update: Record<string, any> = { updated_at: new Date().toISOString() };
    if (fields.executiveSummary      !== undefined) update.executive_summary       = fields.executiveSummary;
    if (fields.selectedService       !== undefined) update.selected_service        = fields.selectedService;
    if (fields.targetAudience        !== undefined) update.target_audience         = fields.targetAudience;
    if (fields.channelRecommendation !== undefined) update.channel_recommendation  = fields.channelRecommendation;
    if (fields.budgetRecommendation  !== undefined) update.budget_recommendation   = fields.budgetRecommendation;
    if (fields.expectedOutcome       !== undefined) update.expected_outcome        = fields.expectedOutcome;

    const { error } = await sb
      .from("growthmind_strategy_centre")
      .update(update)
      .eq("id", strategyId)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── getStrategyTasks ─────────────────────────────────────────────────────────────

export const getStrategyTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ strategyId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: rows } = await sb
      .from("growthmind_strategy_tasks")
      .select("id, title, description, channel, priority, week_number, status, created_at")
      .eq("strategy_id", data.strategyId)
      .eq("workspace_id", workspaceId)
      .order("week_number", { ascending: true })
      .catch(() => ({ data: [] }));

    // Sort by priority in JS — DB text sort gives wrong order (high < low < medium)
    const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const sorted = (rows ?? []).sort(
      (a: any, b: any) =>
        (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99),
    );

    return { tasks: sorted };
  });

// ── getStrategyAssets ─────────────────────────────────────────────────────────────

export const getStrategyAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ strategyId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: rows } = await sb
      .from("growthmind_strategy_assets")
      .select("id, engine, asset_type, title, content, status, created_at")
      .eq("strategy_id", data.strategyId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .catch(() => ({ data: [] }));

    return { assets: rows ?? [] };
  });

// ── updateStrategyTask ────────────────────────────────────────────────────────────

export const updateStrategyTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      taskId: z.string().uuid(),
      status: z.enum(["pending", "in_progress", "completed"]),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_strategy_tasks")
      .update({ status: data.status })
      .eq("id", data.taskId)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
