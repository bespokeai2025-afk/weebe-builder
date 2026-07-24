import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatDnaAsContext } from "./growthmind.business-dna";

// ── Types ──────────────────────────────────────────────────────────────────────

export type StrategyPeriod = "30_day" | "60_day" | "90_day";

export type Strategy = {
  id:               string;
  workspaceId:      string;
  planPeriod:       StrategyPeriod;
  primaryAngle:     string;
  targetAudience:   string;
  coreOffer:        string;
  channels:         string[];
  campaigns:        StrategyCampaign[];
  contentPlan:      string;
  seoPlan:          string;
  paidAdsPlan:      string;
  whatsappPlan:     string;
  emailPlan:        string;
  aiCallingPlan:    string;
  followUpPlan:     string;
  kpis:             StrategyKpi[];
  expectedOutcomes: string;
  tasks:            StrategyTask[];
  confidenceScore:  number;
  evidence:         string;
  generatedByModel: string | null;
  lastCalculatedAt: string;
  createdAt:        string;
};

export type StrategyCampaign = {
  name:     string;
  type:     string;
  channel:  string;
  goal:     string;
  timeline: string;
};

export type StrategyKpi = {
  metric:  string;
  target:  string;
  period:  string;
};

export type StrategyTask = {
  week:    number;
  task:    string;
  owner:   string;
  channel: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

async function logAudit(
  sb: any, workspaceId: string, period: string, status: "success" | "error",
  durationMs: number, model?: string, inputTokens?: number, outputTokens?: number, errorMsg?: string,
) {
  try {
    await sb.from("growthmind_generation_audit").insert({
      workspace_id:  workspaceId,
      event_type:    `strategy_generate_${period}`,
      entity_type:   "strategies",
      model_used:    model ?? null,
      input_tokens:  inputTokens ?? null,
      output_tokens: outputTokens ?? null,
      triggered_by:  "user",
      duration_ms:   durationMs,
      status,
      error_message: errorMsg ?? null,
    });
  } catch { /* never block */ }
}

function periodLabel(period: StrategyPeriod): string {
  return period === "30_day" ? "30-Day" : period === "60_day" ? "60-Day" : "90-Day";
}

function buildStrategyPrompt(
  period: StrategyPeriod,
  dnaContext: string,
  snapshot: Record<string, unknown>,
  valuePoint: string | null,
): string {
  const label = periodLabel(period);
  return `You are GrowthMind, an expert AI CMO. Generate a tailored ${label} marketing strategy based on the business data below.

${dnaContext}

## Current Business Performance
- Total leads: ${snapshot.totalLeads ?? 0}
- Conversion rate: ${((Number(snapshot.convRate ?? 0)) * 100).toFixed(1)}%
- Call success rate: ${((Number(snapshot.callSuccRate ?? 0)) * 100).toFixed(1)}%
- Total bookings: ${snapshot.totalBookings ?? 0}
- SEO keywords tracked: ${snapshot.seoKeywords ?? 0}
- Content published (30d): ${snapshot.publishedContent30d ?? 0}
- WhatsApp outreach active: ${snapshot.hasWa ? "Yes" : "No"}
- Ad accounts connected: ${snapshot.hasAds ? "Yes" : "No"}
- Active HexMail campaigns: ${snapshot.activeHexmail ?? 0}
${valuePoint ? `\n## Current Highest Value Point\n${valuePoint}` : ""}

## Instructions
Generate a ${label} marketing strategy. Respond ONLY with valid JSON (no markdown fences):
{
  "primary_angle": "The main growth angle for this ${label} plan (1-2 sentences)",
  "target_audience": "Specific audience to focus on",
  "core_offer": "The offer or hook to lead with",
  "channels": ["channel1", "channel2", "channel3"],
  "campaigns": [
    { "name": "Campaign name", "type": "campaign type", "channel": "channel", "goal": "goal", "timeline": "week 1-2" }
  ],
  "content_plan": "Content strategy for this period (3-5 sentences)",
  "seo_plan": "SEO actions for this period",
  "paid_ads_plan": "Paid advertising plan or 'Not recommended yet' if budget/setup not ready",
  "whatsapp_plan": "WhatsApp outreach plan",
  "email_plan": "HexMail / email nurture plan",
  "ai_calling_plan": "AI calling campaign plan",
  "follow_up_plan": "Follow-up cadence and re-engagement plan",
  "kpis": [
    { "metric": "metric name", "target": "target value", "period": "${label}" }
  ],
  "expected_outcomes": "What success looks like at the end of this period",
  "tasks": [
    { "week": 1, "task": "task description", "owner": "GrowthMind / Human", "channel": "channel" }
  ],
  "confidence_score": 0.82,
  "evidence": "Why this strategy is right for this business right now"
}

Generate exactly 3-5 campaigns, 4-6 KPIs, and 8-12 tasks spread across the ${period === "30_day" ? "4 weeks" : period === "60_day" ? "8 weeks" : "12 weeks"}.`;
}

function mapRow(r: any): Strategy {
  return {
    id:               r.id,
    workspaceId:      r.workspace_id,
    planPeriod:       r.plan_period as StrategyPeriod,
    primaryAngle:     r.primary_angle,
    targetAudience:   r.target_audience,
    coreOffer:        r.core_offer,
    channels:         r.channels ?? [],
    campaigns:        r.campaigns ?? [],
    contentPlan:      r.content_plan,
    seoPlan:          r.seo_plan,
    paidAdsPlan:      r.paid_ads_plan,
    whatsappPlan:     r.whatsapp_plan,
    emailPlan:        r.email_plan,
    aiCallingPlan:    r.ai_calling_plan,
    followUpPlan:     r.follow_up_plan,
    kpis:             r.kpis ?? [],
    expectedOutcomes: r.expected_outcomes,
    tasks:            r.tasks ?? [],
    confidenceScore:  Number(r.confidence_score),
    evidence:         r.evidence,
    generatedByModel: r.generated_by_model ?? null,
    lastCalculatedAt: r.last_calculated_at,
    createdAt:        r.created_at,
  };
}

// ── Server fn: get all strategies ─────────────────────────────────────────────

export const getStrategies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_strategies")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("plan_period", { ascending: true });

    if (error && error.code !== "42P01") throw new Error(error.message);
    return { strategies: (data ?? []).map(mapRow) };
  });

// ── Server fn: generate a strategy via AI ──────────────────────────────────────

export const generateStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ period: z.enum(["30_day", "60_day", "90_day"]) }).parse(data),
  )
  .handler(async ({ context, data: { period } }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const t0    = Date.now();
    const model = "gpt-4o-mini";

    try {
      const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [
        dnaRes, leadsRes, callsRes, bookingsRes,
        seoRes, waRes, hexmailRes, adsRes, contentRes, valuePointRes,
      ] = await Promise.all([
        sb.from("growthmind_business_dna").select("*").eq("workspace_id", workspaceId).maybeSingle(),
        sb.from("leads").select("id, status").eq("workspace_id", workspaceId).limit(2000),
        sb.from("calls").select("id, call_successful").eq("workspace_id", workspaceId).gte("started_at", since90).limit(3000),
        sb.from("calendar_bookings").select("id").eq("workspace_id", workspaceId).limit(500),
        sb.from("growthmind_seo_sites").select("keywords").eq("workspace_id", workspaceId).limit(10),
        sb.from("whatsapp_contacts").select("id").eq("workspace_id", workspaceId).limit(1),
        sb.from("hexmail_campaigns").select("status").eq("workspace_id", workspaceId).limit(50),
        sb.from("growthmind_ads_accounts").select("status").eq("workspace_id", workspaceId).limit(20),
        sb.from("growthmind_content_assets").select("status").eq("workspace_id", workspaceId).gte("created_at", since30).limit(100),
        sb.from("growthmind_value_points").select("current_highest_value").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

      const dna           = dnaRes.data;
      const leads: any[]  = leadsRes.data  ?? [];
      const calls: any[]  = callsRes.data  ?? [];
      const bookings: any[] = bookingsRes.data ?? [];
      const seoSites: any[] = seoRes.data  ?? [];
      const hexmail: any[] = hexmailRes.data ?? [];
      const adsAccounts: any[] = adsRes.data ?? [];
      const contentAssets: any[] = contentRes.data ?? [];

      const totalLeads  = leads.length;
      const wonLeads    = leads.filter(l => l.status === "sale" || l.status === "won").length;
      const convRate    = totalLeads > 0 ? wonLeads / totalLeads : 0;
      const callSuccRate = calls.length > 0 ? calls.filter(c => c.call_successful).length / calls.length : 0;
      const seoKeywords = seoSites.reduce((a: number, s: any) => a + ((s.keywords as any[])?.length ?? 0), 0);

      const snapshot = {
        totalLeads, convRate, callSuccRate,
        totalBookings: bookings.length,
        seoKeywords,
        publishedContent30d: contentAssets.filter((a: any) => a.status === "published").length,
        hasWa: (waRes.data ?? []).length > 0,
        hasAds: adsAccounts.some((a: any) => a.status === "active"),
        activeHexmail: hexmail.filter((h: any) => h.status === "active").length,
      };

      const dnaContext = dna ? formatDnaAsContext({
        id: dna.id, workspaceId,
        companyName: dna.company_name ?? "", website: dna.website ?? "",
        industry: dna.industry ?? "", products: dna.products ?? "",
        services: dna.services ?? "", pricing: dna.pricing ?? "",
        offers: dna.offers ?? "", locations: dna.locations ?? "",
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
      }) : "## Business DNA\nNot yet configured.";

      const valuePoint = (valuePointRes.data as any)?.current_highest_value ?? null;
      const prompt = buildStrategyPrompt(period as StrategyPeriod, dnaContext, snapshot, valuePoint);

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1800,
          temperature: 0.7,
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`OpenAI error: ${errText.slice(0, 300)}`);
      }

      const json = await res.json() as any;
      const raw  = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
      const inputTokens  = json.usage?.prompt_tokens     ?? 0;
      const outputTokens = json.usage?.completion_tokens ?? 0;

      const payload = {
        workspace_id:      workspaceId,
        plan_period:       period,
        primary_angle:     raw.primary_angle     ?? "",
        target_audience:   raw.target_audience   ?? "",
        core_offer:        raw.core_offer        ?? "",
        channels:          raw.channels          ?? [],
        campaigns:         raw.campaigns         ?? [],
        content_plan:      raw.content_plan      ?? "",
        seo_plan:          raw.seo_plan          ?? "",
        paid_ads_plan:     raw.paid_ads_plan     ?? "",
        whatsapp_plan:     raw.whatsapp_plan     ?? "",
        email_plan:        raw.email_plan        ?? "",
        ai_calling_plan:   raw.ai_calling_plan   ?? "",
        follow_up_plan:    raw.follow_up_plan    ?? "",
        kpis:              raw.kpis              ?? [],
        expected_outcomes: raw.expected_outcomes ?? "",
        tasks:             raw.tasks             ?? [],
        confidence_score:  Math.max(0, Math.min(1, Number(raw.confidence_score ?? 0.75))),
        evidence:          raw.evidence          ?? "",
        source_snapshot:   snapshot,
        generated_by_model: model,
        last_calculated_at: new Date().toISOString(),
      };

      const { data: saved, error: upsertErr } = await sb
        .from("growthmind_strategies")
        .upsert(payload, { onConflict: "workspace_id,plan_period" })
        .select("*")
        .single();

      if (upsertErr) throw new Error(upsertErr.message);

      await logAudit(sb, workspaceId, period, "success", Date.now() - t0, model, inputTokens, outputTokens);
      return { strategy: mapRow(saved) };
    } catch (err: any) {
      await logAudit(sb, workspaceId, period, "error", Date.now() - t0, model, 0, 0, err.message);
      throw err;
    }
  });

// ── Server fn: delete a strategy ──────────────────────────────────────────────

export const deleteStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ period: z.enum(["30_day", "60_day", "90_day"]) }).parse(data))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_strategies")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("plan_period", data.period);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Server fn: send strategy to HiveMind for approval ─────────────────────────

export const sendStrategyToHiveMind = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ strategyId: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: strat, error: stratErr } = await sb
      .from("growthmind_strategies")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", data.strategyId)
      .single();

    if (stratErr || !strat) throw new Error("Strategy not found");

    const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
    await assertProposalAllowed(sb, workspaceId);

    const { data: action, error: actionErr } = await sb
      .from("hivemind_actions")
      .insert({
        workspace_id:   workspaceId,
        title:          `GrowthMind ${periodLabel(strat.plan_period as StrategyPeriod)} Strategy`,
        description:    `Primary Angle: ${strat.primary_angle}\nTarget Audience: ${strat.target_audience}\nCore Offer: ${strat.core_offer}\n\nExpected Outcomes: ${strat.expected_outcomes}`,
        action_type:    "growthmind_strategy",
        action_payload: {
          strategy_id:   strat.id,
          plan_period:   strat.plan_period,
          channels:      strat.channels,
          confidence_score: strat.confidence_score,
        },
        proposed_by:    "growthmind",
        status:         "pending",
      })
      .select("id")
      .single();

    if (actionErr) throw new Error(actionErr.message);

    await sb.from("growthmind_generation_audit").insert({
      workspace_id:  workspaceId,
      event_type:    "strategy_sent_to_hivemind",
      entity_type:   "strategies",
      entity_id:     data.strategyId,
      triggered_by:  "user",
      status:        "success",
    }).catch(() => {});

    return { actionId: action.id };
  });
