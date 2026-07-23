import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatDnaAsContext } from "./growthmind.business-dna";

// ── Types ──────────────────────────────────────────────────────────────────────

export const CAMPAIGN_TYPES = [
  { id: "google_ads",          label: "Google Ads",           icon: "🔍" },
  { id: "meta_ads",            label: "Meta Ads",             icon: "📘" },
  { id: "linkedin_ads",        label: "LinkedIn Ads",         icon: "💼" },
  { id: "seo_content",         label: "SEO Content",          icon: "📝" },
  { id: "whatsapp_broadcast",  label: "WhatsApp Broadcast",   icon: "💬" },
  { id: "hexmail_sequence",    label: "HexMail Sequence",     icon: "📧" },
  { id: "ai_calling",          label: "AI Calling Campaign",  icon: "📞" },
  { id: "referral",            label: "Referral Campaign",    icon: "🤝" },
  { id: "reactivation",        label: "Reactivation Campaign", icon: "🔄" },
  { id: "launch",              label: "Launch Campaign",      icon: "🚀" },
] as const;

export type CampaignTypeId = typeof CAMPAIGN_TYPES[number]["id"];

export type CampaignDraft = {
  id:                 string;
  workspaceId:        string;
  campaignType:       string;
  name:               string;
  description:        string;
  targetAudience:     string;
  coreOffer:          string;
  budget:             number | null;
  goal:               string;
  channels:           string[];
  copyBlocks:         CopyCopyBlock[];
  adStructure:        Record<string, unknown>;
  sequence:           SequenceStep[];
  kpis:               string[];
  expectedOutcome:    string;
  confidenceScore:    number;
  evidence:           string;
  hivemindActionId:   string | null;
  status:             "draft" | "sent_for_approval" | "approved" | "rejected";
  generatedByModel:   string | null;
  lastCalculatedAt:   string;
  createdAt:          string;
  sourceProposalId:   string | null;
  sourceProposalTitle: string | null;
};

export type CopyCopyBlock = {
  type:    string;
  label:   string;
  content: string;
};

export type SequenceStep = {
  day:     number;
  channel: string;
  action:  string;
  copy:    string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

async function logAudit(
  sb: any, workspaceId: string, campaignType: string, status: "success" | "error",
  durationMs: number, model?: string, inputTokens?: number, outputTokens?: number, errorMsg?: string,
) {
  try {
    await sb.from("growthmind_generation_audit").insert({
      workspace_id:  workspaceId,
      event_type:    `campaign_factory_generate_${campaignType}`,
      entity_type:   "campaign_drafts",
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

function buildCampaignPrompt(
  campaignType: string,
  dnaContext: string,
  valuePoint: string | null,
  budget: number | null,
  goal: string,
  snapshot: Record<string, unknown>,
  proposalContext?: {
    audience?:    string;
    channels?:    string[];
    contentPlan?: string;
  },
): string {
  const typeLabel = CAMPAIGN_TYPES.find(t => t.id === campaignType)?.label ?? campaignType;

  const proposalSection = proposalContext && (proposalContext.audience || proposalContext.contentPlan || proposalContext.channels?.length)
    ? `\n## Pre-Approved Proposal Context (use as primary guidance)
${proposalContext.audience    ? `- Target Audience: ${proposalContext.audience}` : ""}
${proposalContext.channels?.length ? `- Approved Channels: ${proposalContext.channels.join(", ")}` : ""}
${proposalContext.contentPlan ? `- Content Plan Direction:\n${proposalContext.contentPlan}` : ""}
`
    : "";

  return `You are GrowthMind, an expert AI CMO. Generate a complete ${typeLabel} campaign draft.

${dnaContext}

## Current Business Performance
- Total leads: ${snapshot.totalLeads ?? 0}
- Conversion rate: ${((Number(snapshot.convRate ?? 0)) * 100).toFixed(1)}%
- Avg deal value: ${snapshot.averageDealValue ?? "Unknown"}
${valuePoint ? `\n## Current Highest Value Point\n${valuePoint}` : ""}${proposalSection}

## Campaign Request
- Type: ${typeLabel}
- Budget: ${budget ? `£${budget}/month` : "Not specified"}
- Goal: ${goal || "Not specified"}

## Instructions
Generate a complete, ready-to-use ${typeLabel} campaign draft. Respond ONLY with valid JSON (no markdown fences):
{
  "name": "Campaign name (specific and compelling)",
  "description": "2-3 sentence campaign overview",
  "target_audience": "Precise audience definition",
  "core_offer": "The specific offer/hook",
  "channels": ["primary channel", "secondary channel"],
  "copy_blocks": [
    { "type": "headline", "label": "Primary Headline", "content": "actual copy here" },
    { "type": "body", "label": "Body Copy", "content": "actual copy here" },
    { "type": "cta", "label": "Call to Action", "content": "actual CTA here" },
    { "type": "hook", "label": "Opening Hook", "content": "actual hook here" }
  ],
  "ad_structure": {
    "format": "campaign format",
    "duration": "campaign duration",
    "budget_breakdown": "how to split budget",
    "targeting": "targeting parameters",
    "bidding_strategy": "bidding approach"
  },
  "sequence": [
    { "day": 1, "channel": "channel", "action": "action description", "copy": "message copy" },
    { "day": 3, "channel": "channel", "action": "action description", "copy": "message copy" },
    { "day": 7, "channel": "channel", "action": "action description", "copy": "message copy" }
  ],
  "kpis": ["KPI 1 with target", "KPI 2 with target", "KPI 3 with target"],
  "expected_outcome": "What success looks like at end of campaign",
  "confidence_score": 0.80,
  "evidence": "Why this campaign will work for this business"
}

Write real, specific copy — not placeholders. Tailor everything to the business DNA above.`;
}

function mapRow(r: any): CampaignDraft {
  const adStructure: Record<string, unknown> = r.ad_structure ?? {};
  return {
    id:                  r.id,
    workspaceId:         r.workspace_id,
    campaignType:        r.campaign_type,
    name:                r.name,
    description:         r.description,
    targetAudience:      r.target_audience,
    coreOffer:           r.core_offer,
    budget:              r.budget != null ? Number(r.budget) : null,
    goal:                r.goal,
    channels:            r.channels ?? [],
    copyBlocks:          r.copy_blocks ?? [],
    adStructure,
    sequence:            r.sequence ?? [],
    kpis:                r.kpis ?? [],
    expectedOutcome:     r.expected_outcome,
    confidenceScore:     Number(r.confidence_score),
    evidence:            r.evidence,
    hivemindActionId:    r.hivemind_action_id ?? null,
    status:              r.status ?? "draft",
    generatedByModel:    r.generated_by_model ?? null,
    lastCalculatedAt:    r.last_calculated_at,
    createdAt:           r.created_at,
    sourceProposalId:    (adStructure.source_proposal_id as string) ?? null,
    sourceProposalTitle: (adStructure.source_proposal_title as string) ?? null,
  };
}

// ── Server fns ─────────────────────────────────────────────────────────────────

export const getCampaignDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_campaign_drafts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error && error.code !== "42P01") throw new Error(error.message);
    return { drafts: (data ?? []).map(mapRow) };
  });

export const generateCampaignDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      campaignType:         z.string(),
      budget:               z.number().nullable().default(null),
      goal:                 z.string().default(""),
      sourceProposalId:     z.string().uuid().nullable().optional(),
      sourceProposalTitle:  z.string().optional(),
      proposalAudience:     z.string().optional(),
      proposalChannels:     z.array(z.string()).optional(),
      proposalContentPlan:  z.string().optional(),
    }).parse(data),
  )
  .handler(async ({ context, data: input }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const t0    = Date.now();
    const model = "gpt-4o-mini";

    try {
      const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

      const [dnaRes, leadsRes, callsRes, valuePointRes] = await Promise.all([
        sb.from("growthmind_business_dna").select("*").eq("workspace_id", workspaceId).maybeSingle(),
        sb.from("leads").select("id, status").eq("workspace_id", workspaceId).limit(2000),
        sb.from("calls").select("id, call_successful").eq("workspace_id", workspaceId).gte("started_at", since90).limit(2000),
        sb.from("growthmind_value_points").select("current_highest_value").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

      const dna          = dnaRes.data;
      const leads: any[] = leadsRes.data ?? [];
      const calls: any[] = callsRes.data ?? [];
      const totalLeads   = leads.length;
      const wonLeads     = leads.filter(l => l.status === "sale" || l.status === "won").length;
      const convRate     = totalLeads > 0 ? wonLeads / totalLeads : 0;

      const snapshot = {
        totalLeads,
        convRate,
        averageDealValue: dna?.average_deal_value ?? null,
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
      const proposalContext = (input.proposalAudience || input.proposalChannels?.length || input.proposalContentPlan)
        ? {
            audience:    input.proposalAudience,
            channels:    input.proposalChannels,
            contentPlan: input.proposalContentPlan,
          }
        : undefined;
      const prompt = buildCampaignPrompt(input.campaignType, dnaContext, valuePoint, input.budget, input.goal, snapshot, proposalContext);

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1600,
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

      const adStructure = {
        ...(raw.ad_structure ?? {}),
        ...(input.sourceProposalId ? { source_proposal_id: input.sourceProposalId } : {}),
        ...(input.sourceProposalTitle ? { source_proposal_title: input.sourceProposalTitle } : {}),
      };

      const { data: saved, error: insertErr } = await sb
        .from("growthmind_campaign_drafts")
        .insert({
          workspace_id:       workspaceId,
          campaign_type:      input.campaignType,
          name:               raw.name               ?? `${input.campaignType} Campaign`,
          description:        raw.description        ?? "",
          target_audience:    raw.target_audience    ?? "",
          core_offer:         raw.core_offer         ?? "",
          budget:             input.budget,
          goal:               input.goal,
          channels:           raw.channels           ?? [],
          copy_blocks:        raw.copy_blocks        ?? [],
          ad_structure:       adStructure,
          sequence:           raw.sequence           ?? [],
          kpis:               raw.kpis               ?? [],
          expected_outcome:   raw.expected_outcome   ?? "",
          confidence_score:   Math.max(0, Math.min(1, Number(raw.confidence_score ?? 0.75))),
          evidence:           raw.evidence           ?? "",
          source_snapshot:    snapshot,
          status:             "draft",
          generated_by_model: model,
          last_calculated_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (insertErr) throw new Error(insertErr.message);

      if (input.sourceProposalId) {
        await sb
          .from("growthmind_campaign_proposals")
          .update({ status: "in_progress" })
          .eq("id", input.sourceProposalId)
          .eq("workspace_id", workspaceId)
          .catch(() => {});
      }

      await logAudit(sb, workspaceId, input.campaignType, "success", Date.now() - t0, model, inputTokens, outputTokens);
      return { draft: mapRow(saved) };
    } catch (err: any) {
      await logAudit(sb, workspaceId, input.campaignType, "error", Date.now() - t0, model, 0, 0, err.message);
      throw err;
    }
  });

export const deleteCampaignDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ draftId: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_campaign_drafts")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", data.draftId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendCampaignToHiveMind = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ draftId: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: draft, error: draftErr } = await sb
      .from("growthmind_campaign_drafts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", data.draftId)
      .single();

    if (draftErr || !draft) throw new Error("Campaign draft not found");

    const typeLabel = CAMPAIGN_TYPES.find(t => t.id === draft.campaign_type)?.label ?? draft.campaign_type;

    const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
    await assertProposalAllowed(sb, workspaceId);

    const { data: action, error: actionErr } = await sb
      .from("hivemind_actions")
      .insert({
        workspace_id:   workspaceId,
        title:          `GrowthMind Campaign Draft: ${draft.name}`,
        description:    `Type: ${typeLabel}\nTarget Audience: ${draft.target_audience}\nCore Offer: ${draft.core_offer}\n\nExpected Outcome: ${draft.expected_outcome}`,
        action_type:    "growthmind_campaign_draft",
        action_payload: {
          draft_id:       draft.id,
          campaign_type:  draft.campaign_type,
          channels:       draft.channels,
          budget:         draft.budget,
          confidence_score: draft.confidence_score,
        },
        proposed_by:    "growthmind",
        status:         "pending",
      })
      .select("id")
      .single();

    if (actionErr) throw new Error(actionErr.message);

    // Update draft status
    await sb
      .from("growthmind_campaign_drafts")
      .update({ status: "sent_for_approval", hivemind_action_id: action.id })
      .eq("workspace_id", workspaceId)
      .eq("id", data.draftId);

    await sb.from("growthmind_generation_audit").insert({
      workspace_id:  workspaceId,
      event_type:    "campaign_sent_to_hivemind",
      entity_type:   "campaign_drafts",
      entity_id:     data.draftId,
      triggered_by:  "user",
      status:        "success",
    }).catch(() => {});

    return { actionId: action.id };
  });
