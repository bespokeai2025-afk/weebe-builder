// SERVER ONLY — never import from a client component.
// Campaign Proposal Engine — auto-generates structured AI campaign proposals based on
// business context, opportunity scores, and trend signals. Persists to growthmind_campaign_proposals.
// In assistant/operator HiveMind mode, auto-creates draft content calendar entries.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildBusinessContext, formatContextForAI, type BusinessContext } from "./growthmind.business-context";
import type { ServiceOpportunityScore } from "./growthmind.opportunity-score";
import type { TrendSignal } from "./growthmind.trend-engine";

// ── Types ──────────────────────────────────────────────────────────────────────

export type CampaignProposalStatus = "draft" | "approved" | "rejected";

export type CampaignProposal = {
  id?:             string;
  title:           string;
  reason:          string;
  evidence:        string;
  audience:        string;
  expectedOutcome: string;
  budgetEstimate:  string;
  contentPlan:     string;
  videoPlan:       string;
  channels:        string[];
  status:          CampaignProposalStatus;
  generatedAt:     string;
};

// ── Deterministic proposals (no AI, instant) ───────────────────────────────────

export function generateDeterministicProposals(ctx: BusinessContext): CampaignProposal[] {
  const proposals: CampaignProposal[] = [];
  const ts = new Date().toISOString();

  const company = ctx.companyName ?? "your business";
  const audience = ctx.idealCustomerProfiles ?? ctx.targetMarkets ?? "your ideal customers";
  const service  = ctx.services[0] ?? ctx.products[0] ?? "your service";
  const budget   = ctx.monthlyBudget ? `£${Math.round(ctx.monthlyBudget * 0.4).toLocaleString()} of your £${ctx.monthlyBudget.toLocaleString()} monthly budget` : "£500–1,000 starter budget";

  // Proposal 1: Re-engagement (if stale/uncalled leads exist)
  if (ctx.activeLeads > 5 || ctx.totalLeads > 10) {
    proposals.push({
      title: `Re-Engage Dormant Pipeline — ${company}`,
      reason: `${ctx.activeLeads} active leads are in your pipeline but conversion rate is ${ctx.conversionRate}%. A targeted re-engagement campaign can recover lost deals.`,
      evidence: `${ctx.totalLeads} total leads; ${ctx.activeLeads} active; ${ctx.conversionRate}% conversion rate.`,
      audience: audience,
      expectedOutcome: `Re-engage 20–40% of dormant leads within 14 days. Estimated ${Math.max(1, Math.round(ctx.activeLeads * 0.15))} additional conversions.`,
      budgetEstimate: budget,
      contentPlan: `Week 1: AI calling campaign to all uncalled leads.\nWeek 2: WhatsApp re-engagement broadcast with a time-limited offer.\nWeek 3: HexMail follow-up sequence (3-email nurture).\nWeek 4: Final call attempt and pipeline review.`,
      videoPlan: `Hook video: "Why ${service} customers regret waiting" — 60-second testimonial-style video for LinkedIn and YouTube Shorts. Repurpose into 3 social clips.`,
      channels: ["AI Calling", "WhatsApp", "Email"],
      status: "draft",
      generatedAt: ts,
    });
  }

  // Proposal 2: Lead generation (if low new leads)
  if (ctx.newLeads30d < 20 || ctx.activeCampaigns === 0) {
    proposals.push({
      title: `Paid Acquisition Sprint — Generate ${Math.max(20, ctx.newLeads30d * 2)} Leads`,
      reason: `Only ${ctx.newLeads30d} new leads in the last 30 days. A paid acquisition sprint targeting your ideal profile will refill the pipeline quickly.`,
      evidence: `${ctx.newLeads30d} leads last 30 days; ${ctx.activeCampaigns} active campaigns; ${ctx.seoKeywords} SEO keywords tracked.`,
      audience: audience,
      expectedOutcome: `${Math.max(20, ctx.newLeads30d * 2)} new leads in 30 days via paid search and social. CPL target: £25–50.`,
      budgetEstimate: budget,
      contentPlan: `3 ad creative variants per platform (headline + body + CTA).\n1 landing page with a clear lead magnet offer.\n5 follow-up emails post-enquiry.\nWeekly performance review and bid optimisation.`,
      videoPlan: `15-second hook video for Meta Ads: "Get [result] without [pain point] — book your free call." 3 variants with different hooks for A/B testing.`,
      channels: ["Google Ads", "Meta Ads", "Content SEO"],
      status: "draft",
      generatedAt: ts,
    });
  }

  // Proposal 3: Content authority (if low SEO/content)
  if (ctx.seoKeywords < 10 || ctx.recentContentCount < 3) {
    proposals.push({
      title: `Authority Content Sprint — Dominate ${ctx.industry ?? "Your Industry"} Search`,
      reason: `With only ${ctx.seoKeywords} SEO keywords tracked and ${ctx.recentContentCount} recent content pieces, your organic presence is minimal. Consistent authority content drives inbound leads at zero ad cost.`,
      evidence: `${ctx.seoKeywords} SEO keywords; ${ctx.recentContentCount} content pieces (14d); ${ctx.competitorsCount} competitors tracked.`,
      audience: `Decision-makers searching for ${service} online`,
      expectedOutcome: `4+ content pieces published per month. Organic search impressions grow 40% within 60 days. 5–10 inbound leads per month by month 3.`,
      budgetEstimate: ctx.monthlyBudget ? `£${Math.round(ctx.monthlyBudget * 0.2).toLocaleString()} content budget` : "£200–400/month in time or copywriting",
      contentPlan: `Month 1: 2 long-form blog posts (1,500+ words), 8 social posts, 1 LinkedIn article.\nMonth 2: Add 1 case study, 1 FAQ page, 10 social posts.\nMonth 3: 1 pillar page + 3 supporting posts targeting top keywords.`,
      videoPlan: `"Explainer" video: "How ${service} works in 90 seconds" — posted to YouTube (for SEO) and repurposed as 3 LinkedIn clips.`,
      channels: ["SEO Content", "LinkedIn", "YouTube"],
      status: "draft",
      generatedAt: ts,
    });
  }

  // Proposal 4: WhatsApp nurture (if WA connected)
  if (ctx.systemHealth.whatsapp && ctx.waOutbound < 20) {
    proposals.push({
      title: `WhatsApp Nurture Sequence — Activate Your ${ctx.totalLeads} Leads`,
      reason: `WhatsApp is connected but only ${ctx.waOutbound} outbound messages sent in the last 30 days. A structured nurture sequence can dramatically increase engagement.`,
      evidence: `${ctx.waOutbound} WA outbound messages; ${ctx.totalLeads} leads in pipeline; 98% average WA open rate.`,
      audience: audience,
      expectedOutcome: `40–60% open rate on broadcast. 15–25% reply rate. 5–15% booking rate from engaged leads.`,
      budgetEstimate: "Included in platform — time investment only",
      contentPlan: `Day 1: Welcome broadcast with personalised value statement.\nDay 3: Educational message (tip or insight relevant to their challenge).\nDay 7: Social proof message (case study or testimonial).\nDay 14: Offer message with clear CTA (book a call / claim offer).`,
      videoPlan: `30-second WhatsApp video: personal greeting from your AI agent introducing the offer. Conversational, authentic tone.`,
      channels: ["WhatsApp"],
      status: "draft",
      generatedAt: ts,
    });
  }

  return proposals;
}

// ── AI-powered proposal generation ────────────────────────────────────────────
// Attempts to generate contextual, signals-aware proposals using GPT-4o.
// Falls back to deterministic proposals if AI is unavailable or fails.
// Status note: hivemind_actions uses `status: "pending"` which is the schema-valid
// value for "awaiting approval" — the CHECK constraint is ('pending','approved','rejected','executed','failed').

async function generateAIProposals(
  ctx: BusinessContext,
  scores: ServiceOpportunityScore[],
  signals: TrendSignal[],
  apiKey: string,
): Promise<CampaignProposal[]> {
  const ts = new Date().toISOString();

  const growingSignals = signals.filter(s => s.classification === "Growing" || s.classification === "Emerging");
  const decliningSignals = signals.filter(s => s.classification === "Declining");

  const signalSummary = signals.slice(0, 8).map(s =>
    `• ${s.label}: ${s.classification} (${s.changePercent !== null ? (s.changePercent >= 0 ? "+" : "") + s.changePercent + "%" : "n/a"}) — ${s.insight}`
  ).join("\n");

  const scoreSummary = scores.slice(0, 3).map(s =>
    `• ${s.serviceName}: score ${s.totalScore}/100 — ${s.recommendation}`
  ).join("\n");

  const systemPrompt = `You are GrowthMind, an elite AI Chief Marketing Officer. Generate highly specific, actionable campaign proposals for this business.

BUSINESS CONTEXT:
${formatContextForAI(ctx)}

SERVICE OPPORTUNITY SCORES (highest first):
${scoreSummary || "No scored services yet — use general context to generate proposals."}

TREND SIGNALS:
${signalSummary || "No trend data yet — use lead/call/campaign context to generate proposals."}

KEY INSIGHTS:
- Biggest pipeline bottleneck: ${ctx.stalledStage ?? "unknown"} stage
- Call sentiment: ${ctx.callSentiment.positiveRate}% positive (${ctx.callSentiment.totalWithSentiment} calls scored)
- WhatsApp reply rate: ${ctx.waReplyRate !== null ? ctx.waReplyRate + "%" : "unknown"}
- Campaign activity: ${ctx.campaignPerformance.activeCampaigns} active, ${ctx.campaignPerformance.campaignsLast30d} created this month
- Growing signals: ${growingSignals.map(s => s.label).join(", ") || "none"}
- Declining signals: ${decliningSignals.map(s => s.label).join(", ") || "none"}`;

  const userPrompt = `Generate exactly 3 campaign proposals. Each must be based on the specific signals above — reference exact numbers from the data. Return ONLY valid JSON (no markdown fences) as an array of objects with these exact keys:
[
  {
    "title": "Specific campaign name",
    "reason": "Why this campaign is the priority NOW — reference specific signal data",
    "evidence": "Exact numbers from the business data that justify this proposal",
    "audience": "Precise target audience for this campaign",
    "expectedOutcome": "Specific projected results with numbers (e.g. '12 additional conversions in 21 days')",
    "budgetEstimate": "Estimated spend or time investment",
    "contentPlan": "Week-by-week execution plan (4 weeks, specify each channel and action)",
    "videoPlan": "Specific video concept for this campaign (hook, platform, duration, CTA)",
    "channels": ["channel1", "channel2"]
  }
]
Return only the JSON array. No preamble, no explanation.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      max_tokens: 2000,
      temperature: 0.6,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const json = await res.json() as any;
  const raw = json.choices?.[0]?.message?.content ?? "[]";

  let parsed: any[];
  try {
    const obj = JSON.parse(raw);
    parsed = Array.isArray(obj) ? obj : (obj.proposals ?? obj.campaigns ?? Object.values(obj));
  } catch {
    throw new Error("Failed to parse AI response as JSON");
  }

  return parsed.slice(0, 4).map((p: any) => ({
    title:           String(p.title ?? "AI Campaign Proposal"),
    reason:          String(p.reason ?? ""),
    evidence:        String(p.evidence ?? ""),
    audience:        String(p.audience ?? ""),
    expectedOutcome: String(p.expectedOutcome ?? ""),
    budgetEstimate:  String(p.budgetEstimate ?? ""),
    contentPlan:     String(p.contentPlan ?? ""),
    videoPlan:       String(p.videoPlan ?? ""),
    channels:        Array.isArray(p.channels) ? p.channels.map(String) : ["Multi-channel"],
    status:          "draft" as CampaignProposalStatus,
    generatedAt:     ts,
  }));
}

// ── Autonomous draft mode — creates calendar entries + approval queue items ────
// Fires when hivemind_mode is "assistant" or "operator".
// Creates three categories of draft:
//   1. Campaign calendar entries (content_calendar) for multi-channel plans
//   2. Campaign proposal actions (hivemind_actions) for human approval
//   3. Funnel / WhatsApp / HexMail specific action entries for the approval queue

export async function createAutonomousDrafts(
  sb: any,
  workspaceId: string,
  proposals: CampaignProposal[],
): Promise<void> {
  const settingsRes = await sb.from("workspace_settings")
    .select("hivemind_mode")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
    .catch(() => ({ data: null }));

  const mode = settingsRes?.data?.hivemind_mode ?? null;
  if (mode !== "assistant" && mode !== "operator" && mode !== "executive_operator") return;

  const { isProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
  if (!(await isProposalAllowed(sb, workspaceId))) return;

  const week1 = new Date(Date.now() + 7  * 86400000).toISOString().split("T")[0];
  const week2 = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
  const week3 = new Date(Date.now() + 21 * 86400000).toISOString().split("T")[0];

  // 1. Content calendar + proposal action for each top campaign
  for (const proposal of proposals.slice(0, 3)) {
    // Calendar entry
    await sb.from("growthmind_content_calendar").insert({
      workspace_id:   workspaceId,
      title:          `[Auto-Draft] ${proposal.title}`,
      description:    `${proposal.reason}\n\nContent Plan:\n${proposal.contentPlan}`,
      channel:        proposal.channels[0] ?? "Multi-channel",
      status:         "Draft",
      scheduled_date: week1,
    }).catch(() => {});

    // Approval queue item
    await sb.from("hivemind_actions").insert({
      workspace_id: workspaceId,
      action_type:  "campaign_proposal",
      title:        `Campaign Proposal: ${proposal.title}`,
      description:  `GrowthMind CMO auto-generated this campaign proposal.\n\n${proposal.reason}\n\nExpected Outcome: ${proposal.expectedOutcome}\nBudget: ${proposal.budgetEstimate}`,
      status:       "pending",
      priority:     "medium",
      source:       "growthmind",
      metadata:     { proposal, channels: proposal.channels },
    }).catch(() => {});
  }

  // 2. Funnel re-engagement draft — always created so the approval queue always has a funnel item
  const funnelProposal = proposals.find(p => p.channels.includes("AI Calling") || p.title.toLowerCase().includes("re-engage"))
    ?? proposals[0];
  if (funnelProposal) {
    await sb.from("hivemind_actions").insert({
      workspace_id: workspaceId,
      action_type:  "funnel_reengagement",
      title:        "Funnel Re-Engagement — Stalled Leads Recovery",
      description:  `GrowthMind CMO detected stalled pipeline leads.\n\nRecommended action: activate a multi-step re-engagement sequence targeting uncalled and cold leads.\n\nSequence:\n• Day 1: AI calling campaign to all uncalled leads\n• Day 3: WhatsApp follow-up to non-responders\n• Day 7: HexMail nurture email with value offer\n• Day 14: Final outreach + pipeline decision\n\nLinked campaign: ${funnelProposal.title}`,
      status:       "pending",
      priority:     "high",
      source:       "growthmind",
      metadata:     { proposalId: funnelProposal.id, type: "funnel_recovery" },
    }).catch(() => {});

    // Calendar entry for funnel week
    await sb.from("growthmind_content_calendar").insert({
      workspace_id:   workspaceId,
      title:          "[Auto-Draft] Funnel Re-Engagement Sequence",
      description:    "Week-long AI calling + WhatsApp + email re-engagement sequence for stalled leads.",
      channel:        "AI Calling",
      status:         "Draft",
      scheduled_date: week1,
    }).catch(() => {});
  }

  // 3. WhatsApp broadcast draft
  const waDraft = proposals.find(p => p.channels.includes("WhatsApp"));
  if (waDraft) {
    await sb.from("hivemind_actions").insert({
      workspace_id: workspaceId,
      action_type:  "whatsapp_broadcast",
      title:        `WhatsApp Broadcast: ${waDraft.title}`,
      description:  `GrowthMind CMO auto-drafted a WhatsApp broadcast sequence.\n\n${waDraft.contentPlan}\n\nExpected: ${waDraft.expectedOutcome}`,
      status:       "pending",
      priority:     "medium",
      source:       "growthmind",
      metadata:     { proposal: waDraft, broadcastType: "nurture_sequence" },
    }).catch(() => {});

    await sb.from("growthmind_content_calendar").insert({
      workspace_id:   workspaceId,
      title:          "[Auto-Draft] WhatsApp Nurture Broadcast",
      description:    waDraft.contentPlan,
      channel:        "WhatsApp",
      status:         "Draft",
      scheduled_date: week2,
    }).catch(() => {});
  }

  // 4. HexMail email sequence draft — always created for email nurture
  const emailBody = proposals.find(p =>
    p.channels.includes("Email") || p.contentPlan.toLowerCase().includes("hexmail") || p.contentPlan.toLowerCase().includes("email")
  );
  if (emailBody) {
    await sb.from("hivemind_actions").insert({
      workspace_id: workspaceId,
      action_type:  "email_sequence",
      title:        "HexMail Nurture Sequence — Auto-Draft",
      description:  `GrowthMind CMO auto-drafted a 3-email HexMail nurture sequence.\n\nEmail 1 (Day 1): Value introduction — why ${funnelProposal?.title ?? "this campaign"} matters\nEmail 2 (Day 4): Social proof / case study\nEmail 3 (Day 8): Offer + CTA — book a call / claim your free session\n\nBased on campaign: ${emailBody.title}`,
      status:       "pending",
      priority:     "medium",
      source:       "growthmind",
      metadata:     { proposalTitle: emailBody.title, sequenceLength: 3, type: "hexmail_nurture" },
    }).catch(() => {});

    await sb.from("growthmind_content_calendar").insert({
      workspace_id:   workspaceId,
      title:          "[Auto-Draft] HexMail 3-Email Nurture Sequence",
      description:    "3-email nurture sequence: value intro → social proof → offer+CTA.",
      channel:        "Email",
      status:         "Draft",
      scheduled_date: week3,
    }).catch(() => {});
  }
}

// ── Server functions ───────────────────────────────────────────────────────────

export const getCampaignProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    try {
      const { data } = await sb
        .from("growthmind_campaign_proposals")
        .select([
          "id", "title", "reason", "evidence", "audience",
          "expected_outcome", "budget_estimate", "content_plan", "video_plan",
          "channels", "status", "generated_at",
          "video_prompt", "image_prompt", "ad_copy", "email_sequence",
          "whatsapp_sequence", "follow_up_campaign", "call_campaign",
          "landing_page_rec", "measurement_strategy",
          "estimated_leads", "estimated_cpl_pence", "expected_roi_pct",
          "estimated_cost_pence", "package_complete", "dna_snapshot",
        ].join(", "))
        .eq("workspace_id", workspaceId)
        .order("generated_at", { ascending: false })
        .limit(20);
      return {
        proposals: (data ?? []).map((r: any) => ({
          id:                  r.id,
          title:               r.title,
          reason:              r.reason,
          evidence:            r.evidence,
          audience:            r.audience,
          expected_outcome:    r.expected_outcome,
          budget_estimate:     r.budget_estimate,
          content_plan:        r.content_plan,
          video_plan:          r.video_plan,
          channels:            r.channels ?? [],
          status:              r.status as CampaignProposalStatus,
          generated_at:        r.generated_at,
          video_prompt:        r.video_prompt ?? null,
          image_prompt:        r.image_prompt ?? null,
          ad_copy:             r.ad_copy ?? {},
          email_sequence:      r.email_sequence ?? [],
          whatsapp_sequence:   r.whatsapp_sequence ?? [],
          follow_up_campaign:  r.follow_up_campaign ?? {},
          call_campaign:       r.call_campaign ?? {},
          landing_page_rec:    r.landing_page_rec ?? null,
          measurement_strategy: r.measurement_strategy ?? {},
          estimated_leads:     r.estimated_leads ?? null,
          estimated_cpl_pence: r.estimated_cpl_pence ?? null,
          expected_roi_pct:    r.expected_roi_pct ?? null,
          estimated_cost_pence: r.estimated_cost_pence ?? null,
          package_complete:    r.package_complete ?? false,
          dna_snapshot:        r.dna_snapshot ?? {},
        })),
      };
    } catch {
      return { proposals: [] };
    }
  });

export const updateProposalStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      proposalId: z.string().uuid(),
      status:     z.enum(["draft", "approved", "rejected"]),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    try {
      await sb.from("growthmind_campaign_proposals")
        .update({ status: data.status })
        .eq("id", data.proposalId)
        .eq("workspace_id", workspaceId);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

export const runCampaignProposalEngine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Fetch opportunity scores + trend signals to feed into the AI generator
    const [scoresRes, signalsRes, settingsRes] = await Promise.all([
      sb.from("growthmind_service_scores")
        .select("service_name, total_score, scores, recommendation")
        .eq("workspace_id", workspaceId)
        .order("total_score", { ascending: false })
        .limit(10)
        .catch(() => ({ data: [] })),
      sb.from("growthmind_trend_signals")
        .select("signal_type, label, classification, current_value, previous_value, change_percent, insight")
        .eq("workspace_id", workspaceId)
        .order("computed_at", { ascending: false })
        .limit(20)
        .catch(() => ({ data: [] })),
      sb.from("workspace_settings")
        .select("openai_api_key")
        .eq("workspace_id", workspaceId)
        .maybeSingle()
        .catch(() => ({ data: null })),
    ]);

    const dbScores: ServiceOpportunityScore[] = ((scoresRes as any).data ?? []).map((r: any) => ({
      serviceName:    r.service_name,
      totalScore:     r.total_score,
      dimensions:     r.scores?.dimensions ?? [],
      recommendation: r.recommendation,
      computedAt:     new Date().toISOString(),
    }));

    const dbSignals: TrendSignal[] = ((signalsRes as any).data ?? []).map((r: any) => ({
      signalType:     r.signal_type,
      label:          r.label,
      classification: r.classification,
      currentValue:   r.current_value,
      previousValue:  r.previous_value,
      changePercent:  r.change_percent,
      insight:        r.insight,
      actionHint:     "",
      computedAt:     new Date().toISOString(),
    }));

    const apiKey: string | null = process.env.OPENAI_API_KEY
      ?? (settingsRes as any)?.data?.openai_api_key
      ?? null;

    const ctx: BusinessContext = await buildBusinessContext(sb, workspaceId);

    // Attempt AI-powered proposals; fall back to deterministic on any failure
    let proposals: CampaignProposal[];
    let aiGenerated = false;
    if (apiKey) {
      try {
        proposals = await generateAIProposals(ctx, dbScores, dbSignals, apiKey);
        aiGenerated = true;
      } catch {
        proposals = generateDeterministicProposals(ctx);
      }
    } else {
      proposals = generateDeterministicProposals(ctx);
    }

    if (proposals.length === 0) return { ok: true, count: 0, aiGenerated };

    await Promise.resolve(sb.from("growthmind_campaign_proposals").delete().eq("workspace_id", workspaceId)).catch(() => {});

    const rows = proposals.map(p => ({
      workspace_id:    workspaceId,
      title:           p.title,
      reason:          p.reason,
      evidence:        p.evidence,
      audience:        p.audience,
      expected_outcome: p.expectedOutcome,
      budget_estimate:  p.budgetEstimate,
      content_plan:    p.contentPlan,
      video_plan:      p.videoPlan,
      channels:        p.channels,
      status:          "draft",
      generated_at:    p.generatedAt,
    }));

    await Promise.resolve(sb.from("growthmind_campaign_proposals").insert(rows)).catch(() => {});

    await createAutonomousDrafts(sb, workspaceId, proposals);

    return { ok: true, count: proposals.length, aiGenerated };
  });

// ── Full 15-Section Campaign Package Generator ────────────────────────────────
// Generates complete campaign packages with all extended fields (video prompt,
// ad copy, email sequence, WhatsApp sequence, etc.) driven by Business DNA.
// Called from business-dna.functions.ts generateDnaProposalsFn.

async function gptMiniPackage(apiKey: string, messages: any[], maxTokens = 3000): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o", messages, max_tokens: maxTokens, temperature: 0.5 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const j = (await res.json()) as any;
  return j.choices?.[0]?.message?.content ?? "";
}

function safeParse(raw: string, fallback: any = {}): any {
  try { return JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim()); }
  catch { return fallback; }
}

export async function generateFullCampaignPackage(
  workspaceId: string,
  apiKey: string,
  sb: any,
): Promise<{ count: number; ids: string[] }> {
  const ctx = await buildBusinessContext(sb, workspaceId);

  // Pull current DNA for snapshot + enhanced context
  const { data: dna } = await sb
    .from("growthmind_business_dna")
    .select("*")
    .eq("workspace_id", workspaceId)
    .single()
    .catch(() => ({ data: {} }));

  const dnaSnap = {
    company:   dna?.company_name ?? ctx.companyName ?? "",
    industry:  dna?.industry ?? ctx.industry ?? "",
    services:  dna?.services ?? "",
    icp:       dna?.ideal_customer_profiles ?? ctx.idealCustomerProfiles ?? "",
    usp:       dna?.unique_selling_points ?? ctx.uniqueSellingPoints ?? "",
    budget:    dna?.monthly_marketing_budget ?? ctx.monthlyBudget ?? 0,
    goal:      dna?.main_growth_objective ?? "",
    tone:      dna?.tone_of_voice ?? dna?.brand_voice ?? "",
    geo:       dna?.target_countries ?? dna?.country ?? "",
    adPlatforms: dna?.current_ad_platforms ?? "",
  };

  const systemPrompt = `You are GrowthMind, an elite AI CMO. Generate EXACTLY 3 full campaign packages for this business.
Each package must include all 15 sections listed below. Be specific, data-driven, and reference the business context.

BUSINESS DNA:
Company: ${dnaSnap.company}
Industry: ${dnaSnap.industry}
Services: ${dnaSnap.services.slice(0, 300)}
ICP: ${dnaSnap.icp.slice(0, 200)}
USP: ${dnaSnap.usp.slice(0, 200)}
Monthly Budget: £${dnaSnap.budget}
Goal: ${dnaSnap.goal}
Tone: ${dnaSnap.tone}
Geography: ${dnaSnap.geo}
Ad Platforms Used: ${dnaSnap.adPlatforms}

Pipeline: ${ctx.totalLeads} leads, ${ctx.conversionRate}% conversion, ${ctx.newLeads30d} new last 30d`;

  const userPrompt = `Return ONLY a valid JSON array of exactly 3 objects. Each object must have these exact keys:

[
  {
    "title": "Campaign name",
    "reason": "Why this campaign now — specific evidence",
    "evidence": "Data points justifying this",
    "audience": "Precise target audience",
    "expectedOutcome": "Specific projected results with numbers",
    "budgetEstimate": "Estimated spend",
    "contentPlan": "Week-by-week content execution (4 weeks)",
    "videoPlan": "Existing video plan / hook concept",
    "channels": ["channel1", "channel2"],
    "videoPrompt": "Detailed video generation prompt for AI video tool — describe scene, tone, CTA, platform, duration",
    "imagePrompt": "Detailed image/creative prompt for static ads — describe scene, brand style, copy overlay, platform",
    "adCopy": {
      "headlines": ["headline1", "headline2", "headline3"],
      "body": ["body variant 1", "body variant 2"],
      "cta": ["CTA 1", "CTA 2"],
      "platformVariants": { "meta": "Meta-optimised copy", "google": "Google-optimised copy", "linkedin": "LinkedIn copy" }
    },
    "emailSequence": [
      { "day": 1, "subject": "Subject line", "body": "Email body (2-3 paragraphs)", "cta": "CTA text" },
      { "day": 4, "subject": "Subject line", "body": "Email body", "cta": "CTA text" },
      { "day": 8, "subject": "Subject line", "body": "Email body", "cta": "CTA text" }
    ],
    "whatsappSequence": [
      { "day": 1, "message": "WhatsApp message (conversational, <160 chars)", "mediaSuggestion": "image/video/none" },
      { "day": 3, "message": "Follow-up message", "mediaSuggestion": "image/video/none" },
      { "day": 7, "message": "Offer message", "mediaSuggestion": "image/video/none" }
    ],
    "followUpCampaign": {
      "strategy": "Re-engagement strategy for non-responders",
      "timelineDays": 14,
      "callScriptHint": "AI call script opening line for follow-up"
    },
    "callCampaign": {
      "objective": "What the AI agent should achieve on the call",
      "targetListFilter": "Which leads to target (status/source/tag filter)",
      "aiAgentType": "inbound/outbound",
      "callScriptHint": "Opening line for the AI call agent"
    },
    "landingPageRec": "Landing page recommendation — headline, hero copy, CTA, trust signals",
    "measurementStrategy": {
      "kpis": ["KPI 1 with target", "KPI 2 with target"],
      "tracking": ["Tracking setup item 1", "Tracking setup item 2"],
      "reviewCadence": "Daily/weekly/monthly review recommendation"
    },
    "estimatedLeads": 25,
    "estimatedCplPence": 3500,
    "expectedRoiPct": 180,
    "estimatedCostPence": 75000
  }
]

Return only the JSON array.`;

  const raw = await gptMiniPackage(
    apiKey,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    4000,
  );

  let packages: any[];
  try {
    const parsed = safeParse(raw, []);
    packages = Array.isArray(parsed) ? parsed : (parsed.proposals ?? parsed.campaigns ?? Object.values(parsed));
  } catch {
    return { count: 0, ids: [] };
  }

  const ids: string[] = [];
  for (const pkg of packages.slice(0, 3)) {
    try {
      const { data: row } = await sb
        .from("growthmind_campaign_proposals")
        .insert({
          workspace_id:        workspaceId,
          title:               pkg.title ?? "AI Campaign Package",
          reason:              pkg.reason ?? "",
          evidence:            pkg.evidence ?? "",
          audience:            pkg.audience ?? "",
          expected_outcome:    pkg.expectedOutcome ?? "",
          budget_estimate:     pkg.budgetEstimate ?? "",
          content_plan:        pkg.contentPlan ?? "",
          video_plan:          pkg.videoPlan ?? "",
          channels:            pkg.channels ?? [],
          status:              "draft",
          generated_at:        new Date().toISOString(),
          video_prompt:        pkg.videoPrompt ?? null,
          image_prompt:        pkg.imagePrompt ?? null,
          ad_copy:             pkg.adCopy ?? {},
          email_sequence:      pkg.emailSequence ?? [],
          whatsapp_sequence:   pkg.whatsappSequence ?? [],
          follow_up_campaign:  pkg.followUpCampaign ?? {},
          call_campaign:       pkg.callCampaign ?? {},
          landing_page_rec:    pkg.landingPageRec ?? null,
          measurement_strategy: pkg.measurementStrategy ?? {},
          estimated_leads:     pkg.estimatedLeads ?? null,
          estimated_cpl_pence: pkg.estimatedCplPence ?? null,
          expected_roi_pct:    pkg.expectedRoiPct ?? null,
          estimated_cost_pence: pkg.estimatedCostPence ?? null,
          dna_snapshot:        dnaSnap,
          package_complete:    true,
        })
        .select("id")
        .single();
      if (row?.id) ids.push(row.id);
    } catch { /* skip failed inserts */ }
  }

  return { count: ids.length, ids };
}
