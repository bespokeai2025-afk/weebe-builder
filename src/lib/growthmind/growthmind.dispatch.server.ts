// ── GrowthMind Dispatch — server-only helpers called by HiveMind executor ─────
// SERVER ONLY. Never import from client code. These are called dynamically inside
// hivemind.actions.ts executeAction when the COO approves a GrowthMind action.

import { VIDEO_TYPE_LABELS, type VideoType, type QualityMode } from "./growthmind.video-studio";
import { formatDnaAsContext } from "./growthmind.business-dna";

// ── Video campaign dispatch ───────────────────────────────────────────────────
// Creates a video asset in the Video Studio queue (script + storyboard generated
// by AI). Actual Veo/Runway rendering is left for the user to trigger in Video
// Studio — the COO action surfaces the job and links to it.

export interface VideoDispatchPayload {
  video_type:      string;
  quality_mode?:   string;
  target_audience?: string;
  offer?:          string;
  tone?:           string;
  cta?:            string;
  voice_id?:       string;
  campaign_id?:    string;
}

export async function dispatchVideoGeneration(
  sb:          any,
  workspaceId: string,
  payload:     VideoDispatchPayload,
): Promise<{ video_asset_id: string; video_type: string; title: string }> {
  const videoType   = (payload.video_type ?? "meta_video_ad") as VideoType;
  const qualityMode = (payload.quality_mode ?? "fast") as QualityMode;

  const typeLabel = VIDEO_TYPE_LABELS[videoType] ?? videoType;

  // ── Pull workspace context ────────────────────────────────────────────────
  const [wsRes, dnaRes, vpRes, oppRes, kbRes] = await Promise.all([
    sb.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle(),
    Promise.resolve(sb.from("growthmind_business_dna").select("*").eq("workspace_id", workspaceId).maybeSingle()).catch(() => ({ data: null })),
    Promise.resolve(sb.from("growthmind_value_points").select("current_highest_value,who_to_target,recommended_offer,best_channels").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle()).catch(() => ({ data: null })),
    Promise.resolve(sb.from("growthmind_opportunities").select("title,recommended_action,urgency").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle()).catch(() => ({ data: null })),
    Promise.resolve(sb.from("knowledge_bases").select("name, description").eq("workspace_id", workspaceId).limit(5)).catch(() => ({ data: [] })),
  ]);

  const ws          = wsRes.data;
  const wsSettings  = ws?.settings ?? {};
  const companyName = ws?.name ?? wsSettings.company_name ?? "the business";
  const industry    = wsSettings.industry ?? "";

  const dna = dnaRes.data;
  const vp  = vpRes.data;
  const opp = oppRes.data;
  const kbs = (kbRes.data ?? []) as any[];

  const valuePoint = vp
    ? [vp.current_highest_value, vp.who_to_target ? `Target: ${vp.who_to_target}` : "", vp.recommended_offer ? `Offer: ${vp.recommended_offer}` : ""].filter(Boolean).join(" | ")
    : dna?.unique_selling_points ?? "";

  const topOppText = opp
    ? `${opp.title}${opp.recommended_action ? ` — ${opp.recommended_action}` : ""}`
    : "";

  const kbSummary = kbs.map((k: any) => `${k.name}${k.description ? `: ${k.description}` : ""}`).join("; ");

  // ── Generate script + storyboard via OpenAI ───────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const systemPrompt = `You are GrowthMind Video Studio, an expert AI marketing video strategist and scriptwriter.

## Company Context
Business: ${companyName}
Industry: ${industry || "not specified"}
${valuePoint ? `Value proposition: ${valuePoint}` : ""}
${topOppText ? `Top opportunity: ${topOppText}` : ""}
${kbSummary ? `Knowledge: ${kbSummary}` : ""}

## Your Role
Write a complete ${typeLabel} script with a detailed scene-by-scene storyboard in JSON.

Output format — return ONLY this JSON (no markdown fences, no extra text):
{
  "title": "...",
  "script": "Full voiceover script here...",
  "storyboard": [
    {
      "scene": 1,
      "visual": "Describe what the camera shows",
      "voiceover": "Exact words spoken",
      "onScreenText": "Text overlay shown",
      "duration": 5,
      "cta": "optional CTA text for last scene"
    }
  ]
}

Rules: 3-6 scenes, total 30-90 seconds, make it specific to the business.`;

  const userPrompt = `Create a ${typeLabel}:
Target Audience: ${payload.target_audience || "ideal customers"}
Offer: ${payload.offer || "our product/service"}
Tone: ${payload.tone || "professional"}
CTA: ${payload.cta || "Contact us today"}`;

  let title       = `${typeLabel} — ${new Date().toLocaleDateString()}`;
  let script      = "";
  let storyboard: any[] = [];

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model:           "gpt-4o-mini",
        messages:        [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens:      1500,
        temperature:     0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (res.ok) {
      const json   = await res.json() as any;
      const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
      title      = parsed.title     ?? title;
      script     = parsed.script    ?? userPrompt;
      storyboard = (parsed.storyboard ?? []).map((s: any, i: number) => ({
        scene:        s.scene        ?? i + 1,
        visual:       s.visual       ?? "",
        voiceover:    s.voiceover    ?? "",
        onScreenText: s.onScreenText ?? s.on_screen_text ?? "",
        duration:     Number(s.duration ?? 5),
        cta:          s.cta ?? undefined,
      }));
    }
  } catch {
    // Fallback to minimal storyboard
  }

  if (!script) {
    script = `${typeLabel} for ${companyName}: ${payload.offer || "our product/service"}. ${payload.cta || "Contact us today."}`;
  }
  if (storyboard.length === 0) {
    storyboard = [{ scene: 1, visual: "Brand visual", voiceover: script.slice(0, 300), onScreenText: payload.cta || "", duration: 30 }];
  }

  // ── Estimate cost ─────────────────────────────────────────────────────────
  const costMap: Record<string, number> = { fast: 0.05, balanced: 0.35, premium: 2.50 };
  const costEstimate = costMap[qualityMode] ?? 0.05;

  // ── Save to growthmind_video_assets ───────────────────────────────────────
  const { data: asset, error } = await sb.from("growthmind_video_assets").insert({
    workspace_id:   workspaceId,
    title,
    video_type:     videoType,
    provider:       qualityMode === "premium" ? "veo3" : null,
    quality_mode:   qualityMode,
    script,
    storyboard,
    voice_id:       payload.voice_id ?? "21m00Tcm4TlvDq8ikWAM",
    video_url:      null,
    audio_url:      null,
    cost_estimate:  costEstimate,
    campaign_id:    payload.campaign_id ?? null,
    is_composite:   false,
  }).select("id").single();

  if (error) throw new Error(`Failed to create video asset: ${error.message}`);

  return { video_asset_id: asset.id as string, video_type: videoType, title };
}

// ── Growth campaign dispatch ───────────────────────────────────────────────────
// Creates a campaign draft in GrowthMind's Campaign Factory. Mirrors the logic in
// generateCampaignDraft server fn, called directly from the HiveMind executor.

export interface CampaignDispatchPayload {
  campaign_type?: string;
  budget?:        number | null;
  goal?:          string;
}

export async function dispatchGrowthCampaign(
  sb:          any,
  workspaceId: string,
  payload:     CampaignDispatchPayload,
): Promise<{ campaign_draft_id: string; campaign_type: string; name: string }> {
  const campaignType = payload.campaign_type ?? "meta_ads";
  const budget       = payload.budget ?? null;
  const goal         = payload.goal ?? "";

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [dnaRes, leadsRes, valuePointRes] = await Promise.all([
    Promise.resolve(sb.from("growthmind_business_dna").select("*").eq("workspace_id", workspaceId).maybeSingle()).catch(() => ({ data: null })),
    Promise.resolve(sb.from("leads").select("id, status").eq("workspace_id", workspaceId).limit(2000)).catch(() => ({ data: [] })),
    Promise.resolve(sb.from("growthmind_value_points").select("current_highest_value").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle()).catch(() => ({ data: null })),
  ]);

  const dna          = dnaRes.data;
  const leads: any[] = leadsRes.data ?? [];
  const totalLeads   = leads.length;
  const wonLeads     = leads.filter((l: any) => l.status === "sale" || l.status === "won" || l.status === "sale_done").length;
  const convRate     = totalLeads > 0 ? wonLeads / totalLeads : 0;

  const snapshot = { totalLeads, convRate, averageDealValue: dna?.average_deal_value ?? null };

  const dnaContext = dna
    ? formatDnaAsContext({
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
      })
    : "## Business DNA\nNot yet configured.";

  const valuePoint = (valuePointRes.data as any)?.current_highest_value ?? null;

  const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
    google_ads: "Google Ads", meta_ads: "Meta Ads", linkedin_ads: "LinkedIn Ads",
    seo_content: "SEO Content", whatsapp_broadcast: "WhatsApp Broadcast",
    hexmail_sequence: "HexMail Sequence", ai_calling: "AI Calling Campaign",
    referral: "Referral Campaign", reactivation: "Reactivation Campaign", launch: "Launch Campaign",
  };
  const typeLabel = CAMPAIGN_TYPE_LABELS[campaignType] ?? campaignType;

  const prompt = `You are GrowthMind, an expert AI CMO. Generate a complete ${typeLabel} campaign draft.

${dnaContext}

## Current Business Performance
- Total leads: ${snapshot.totalLeads ?? 0}
- Conversion rate: ${((Number(snapshot.convRate ?? 0)) * 100).toFixed(1)}%
- Avg deal value: ${snapshot.averageDealValue ?? "Unknown"}
${valuePoint ? `\n## Current Highest Value Point\n${valuePoint}` : ""}

## Campaign Request
- Type: ${typeLabel}
- Budget: ${budget ? `£${budget}/month` : "Not specified"}
- Goal: ${goal || "Not specified"}
- Requested by: HiveMind COO (approved by user)

## Instructions
Generate a complete, ready-to-use ${typeLabel} campaign draft. Respond ONLY with valid JSON (no markdown fences):
{
  "name": "Campaign name",
  "description": "2-3 sentence overview",
  "target_audience": "Precise audience",
  "core_offer": "The specific offer/hook",
  "channels": ["channel"],
  "copy_blocks": [
    { "type": "headline", "label": "Primary Headline", "content": "copy" },
    { "type": "body", "label": "Body Copy", "content": "copy" },
    { "type": "cta", "label": "Call to Action", "content": "CTA" }
  ],
  "ad_structure": { "format": "...", "duration": "...", "targeting": "..." },
  "sequence": [
    { "day": 1, "channel": "channel", "action": "action", "copy": "message" }
  ],
  "kpis": ["KPI 1", "KPI 2"],
  "expected_outcome": "What success looks like",
  "confidence_score": 0.80,
  "evidence": "Why this will work"
}`;

  const model = "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages:        [{ role: "user", content: prompt }],
      max_tokens:      1400,
      temperature:     0.7,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI error: ${errText.slice(0, 200)}`);
  }

  const json = await res.json() as any;
  const raw  = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");

  const { data: saved, error: insertErr } = await sb.from("growthmind_campaign_drafts").insert({
    workspace_id:       workspaceId,
    campaign_type:      campaignType,
    name:               raw.name               ?? `${typeLabel} Campaign`,
    description:        raw.description        ?? "",
    target_audience:    raw.target_audience    ?? "",
    core_offer:         raw.core_offer         ?? "",
    budget,
    goal,
    channels:           raw.channels           ?? [],
    copy_blocks:        raw.copy_blocks        ?? [],
    ad_structure:       raw.ad_structure       ?? {},
    sequence:           raw.sequence           ?? [],
    kpis:               raw.kpis               ?? [],
    expected_outcome:   raw.expected_outcome   ?? "",
    confidence_score:   Math.max(0, Math.min(1, Number(raw.confidence_score ?? 0.75))),
    evidence:           raw.evidence           ?? "",
    source_snapshot:    snapshot,
    status:             "draft",
    generated_by_model: model,
    last_calculated_at: new Date().toISOString(),
  }).select("id, name").single();

  if (insertErr) throw new Error(`Failed to create campaign draft: ${insertErr.message}`);

  return { campaign_draft_id: saved.id as string, campaign_type: campaignType, name: saved.name as string };
}
