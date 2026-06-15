// SERVER ONLY — never import from a client component.
// Uses real workspace data + AI synthesis to identify the current highest-value point.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatDnaAsContext } from "./growthmind.business-dna";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ValuePoint = {
  id:                  string;
  workspaceId:         string;
  currentHighestValue: string;
  whyItMatters:        string;
  whoToTarget:         string;
  bestChannels:        string;
  recommendedOffer:    string;
  recommendedCampaign: string;
  recommendedContent:  string;
  recommendedFollowUp: string;
  confidenceScore:     number;
  evidence:            string;
  generatedByModel:    string | null;
  lastCalculatedAt:    string;
  createdAt:           string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

async function logAudit(
  sb: any, workspaceId: string, status: "success" | "error",
  durationMs: number, model?: string, inputTokens?: number, outputTokens?: number, errorMsg?: string,
) {
  try {
    await sb.from("growthmind_generation_audit").insert({
      workspace_id: workspaceId,
      event_type:   "value_point_engine_run",
      entity_type:  "value_points",
      model_used:   model ?? null,
      input_tokens: inputTokens ?? null,
      output_tokens: outputTokens ?? null,
      triggered_by: "user",
      duration_ms:  durationMs,
      status,
      error_message: errorMsg ?? null,
    });
  } catch { /* never block */ }
}

function buildPrompt(snapshot: Record<string, unknown>, dnaContext: string): string {
  return `You are GrowthMind, an expert AI CMO. Analyse the business data below and identify the single highest-value marketing opportunity this business should focus on RIGHT NOW.

${dnaContext}

## Live Business Metrics
- Total leads: ${snapshot.totalLeads ?? 0}
- Never contacted leads: ${snapshot.neverCalled ?? 0}
- Stale leads (14d+): ${snapshot.staleLeads ?? 0}
- Conversion rate: ${((Number(snapshot.convRate ?? 0)) * 100).toFixed(1)}%
- Call success rate: ${((Number(snapshot.callSuccRate ?? 0)) * 100).toFixed(1)}%
- Total bookings: ${snapshot.totalBookings ?? 0}
- SEO keywords tracked: ${snapshot.seoKeywords ?? 0}
- Competitors tracked: ${snapshot.competitors ?? 0}
- Content published (30d): ${snapshot.publishedContent30d ?? 0}
- WhatsApp messages (30d): ${snapshot.waMessages ?? 0}
- Active HexMail campaigns: ${snapshot.activeHexmail ?? 0}
- Ad accounts connected: ${snapshot.hasAds ? "Yes" : "No"}
- Top lead source: ${snapshot.topLeadSource ?? "Unknown"}
- Business DNA completion: ${snapshot.dnaCompletedFields ?? 0} fields

## Task
Respond ONLY with a valid JSON object (no markdown, no explanation outside JSON):
{
  "current_highest_value": "Short name of the opportunity (e.g. 'AI Receptionist for Estate Agents')",
  "why_it_matters": "2-3 sentences on why this is the #1 priority right now, citing specific numbers from the data",
  "who_to_target": "Specific audience segment to target",
  "best_channels": "Top 2-3 channels for this opportunity",
  "recommended_offer": "Specific offer or lead magnet to use",
  "recommended_campaign": "Name and 1-sentence description of the campaign to run",
  "recommended_content": "1-2 content pieces to create that support this value point",
  "recommended_follow_up": "Follow-up sequence recommendation",
  "confidence_score": 0.85,
  "evidence": "Key data points that support this recommendation"
}`;
}

// ── Server fn: run the engine (AI call + save) ─────────────────────────────────

export const runTrendingValueEngine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const t0 = Date.now();
    const model = "gpt-4o-mini";

    try {
      // Gather real data
      const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

      const [
        dnaRes, leadsRes, callsRes, bookingsRes,
        seoRes, competitorsRes, hexmailRes, waRes, adsRes,
        contentAssetsRes,
      ] = await Promise.all([
        sb.from("growthmind_business_dna").select("*").eq("workspace_id", workspaceId).maybeSingle(),
        sb.from("leads").select("id, status, source").eq("workspace_id", workspaceId).limit(2000),
        sb.from("calls").select("id, call_successful").eq("workspace_id", workspaceId).gte("started_at", since90).limit(3000),
        sb.from("calendar_bookings").select("id").eq("workspace_id", workspaceId).limit(500),
        sb.from("growthmind_seo_sites").select("keywords").eq("workspace_id", workspaceId).limit(10),
        sb.from("growthmind_competitors").select("id").eq("workspace_id", workspaceId).limit(20),
        sb.from("hexmail_campaigns").select("status").eq("workspace_id", workspaceId).limit(50),
        sb.from("whatsapp_messages").select("id").eq("workspace_id", workspaceId).gte("created_at", since30).limit(500).catch(() => ({ data: [] })),
        sb.from("growthmind_ads_accounts").select("status").eq("workspace_id", workspaceId).limit(20),
        sb.from("growthmind_content_assets").select("status").eq("workspace_id", workspaceId).gte("created_at", since30).limit(100),
      ]);

      const dna           = dnaRes.data;
      const leads: any[]  = leadsRes.data ?? [];
      const calls: any[]  = callsRes.data ?? [];
      const bookings: any[] = bookingsRes.data ?? [];
      const seoSites: any[] = seoRes.data ?? [];
      const seoKeywords   = seoSites.reduce((a: number, s: any) => a + ((s.keywords as any[])?.length ?? 0), 0);
      const competitors   = (competitorsRes.data ?? []).length;
      const hexmail: any[] = hexmailRes.data ?? [];
      const waMessages: any[] = (waRes as any).data ?? [];
      const adsAccounts: any[] = adsRes.data ?? [];
      const contentAssets: any[] = contentAssetsRes.data ?? [];

      const totalLeads    = leads.length;
      const wonLeads      = leads.filter(l => l.status === "sale" || l.status === "won").length;
      const neverCalled   = leads.filter(l => l.status === "new" || l.status === "not_contacted").length;
      const staleLeads    = leads.filter(l => {
        const u = new Date((l as any).updated_at ?? 0);
        return Date.now() - u.getTime() > 14 * 24 * 60 * 60 * 1000;
      }).length;
      const callSuccRate  = calls.length > 0 ? calls.filter(c => c.call_successful).length / calls.length : 0;
      const convRate      = totalLeads > 0 ? wonLeads / totalLeads : 0;
      const topSource     = leads.reduce((acc: Record<string, number>, l: any) => {
        if (l.source) acc[l.source] = (acc[l.source] ?? 0) + 1;
        return acc;
      }, {});
      const topLeadSource = Object.entries(topSource).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      const snapshot = {
        totalLeads, neverCalled, staleLeads, convRate, callSuccRate,
        totalBookings: bookings.length, seoKeywords, competitors,
        publishedContent30d: contentAssets.filter((a: any) => a.status === "published").length,
        waMessages: waMessages.length,
        activeHexmail: hexmail.filter((h: any) => h.status === "active").length,
        hasAds: adsAccounts.some((a: any) => a.status === "active"),
        topLeadSource,
        dnaCompletedFields: dna ? Object.values(dna).filter(v => v && String(v).trim().length > 0).length : 0,
      };

      const dnaContext = dna ? formatDnaAsContext({
        id: dna.id, workspaceId, companyName: dna.company_name ?? "", website: dna.website ?? "",
        industry: dna.industry ?? "", products: dna.products ?? "", services: dna.services ?? "",
        pricing: dna.pricing ?? "", offers: dna.offers ?? "", locations: dna.locations ?? "",
        idealCustomerProfiles: dna.ideal_customer_profiles ?? "", targetMarkets: dna.target_markets ?? "",
        uniqueSellingPoints: dna.unique_selling_points ?? "", competitorsSummary: dna.competitors_summary ?? "",
        revenueGoals: dna.revenue_goals ?? "", monthlyMarketingBudget: dna.monthly_marketing_budget ?? null,
        mainGrowthObjective: dna.main_growth_objective ?? "", salesProcess: dna.sales_process ?? "",
        averageDealValue: dna.average_deal_value ?? null, profitMarginPct: dna.profit_margin_pct ?? null,
        bestCustomers: dna.best_customers ?? "", worstCustomers: dna.worst_customers ?? "",
        caseStudies: dna.case_studies ?? "", brandVoice: dna.brand_voice ?? "",
        complianceNotes: dna.compliance_notes ?? "", updatedAt: dna.updated_at ?? "",
      }) : "## Business DNA\nNot yet configured.";

      const prompt = buildPrompt(snapshot, dnaContext);

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 800,
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

      const row = {
        workspace_id:          workspaceId,
        current_highest_value: raw.current_highest_value ?? "Not determined",
        why_it_matters:        raw.why_it_matters        ?? "",
        who_to_target:         raw.who_to_target         ?? "",
        best_channels:         raw.best_channels         ?? "",
        recommended_offer:     raw.recommended_offer     ?? "",
        recommended_campaign:  raw.recommended_campaign  ?? "",
        recommended_content:   raw.recommended_content   ?? "",
        recommended_follow_up: raw.recommended_follow_up ?? "",
        confidence_score:      Math.max(0, Math.min(1, Number(raw.confidence_score ?? 0.7))),
        evidence:              raw.evidence              ?? "",
        source_snapshot:       snapshot,
        generated_by_model:    model,
        last_calculated_at:    new Date().toISOString(),
      };

      const { data: saved, error: insertErr } = await sb
        .from("growthmind_value_points")
        .insert(row)
        .select("*")
        .single();

      if (insertErr) throw new Error(insertErr.message);

      await logAudit(sb, workspaceId, "success", Date.now() - t0, model, inputTokens, outputTokens);

      return {
        valuePoint: mapRow(saved),
      };
    } catch (err: any) {
      await logAudit(sb, workspaceId, "error", Date.now() - t0, model, 0, 0, err.message);
      throw err;
    }
  });

// ── Server fn: get current (latest) value point ────────────────────────────────

export const getCurrentValuePoint = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_value_points")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== "42P01") throw new Error(error.message);
    return { valuePoint: data ? mapRow(data) : null };
  });

function mapRow(r: any): ValuePoint {
  return {
    id:                  r.id,
    workspaceId:         r.workspace_id,
    currentHighestValue: r.current_highest_value,
    whyItMatters:        r.why_it_matters,
    whoToTarget:         r.who_to_target,
    bestChannels:        r.best_channels,
    recommendedOffer:    r.recommended_offer,
    recommendedCampaign: r.recommended_campaign,
    recommendedContent:  r.recommended_content,
    recommendedFollowUp: r.recommended_follow_up,
    confidenceScore:     Number(r.confidence_score),
    evidence:            r.evidence,
    generatedByModel:    r.generated_by_model ?? null,
    lastCalculatedAt:    r.last_calculated_at,
    createdAt:           r.created_at,
  };
}
