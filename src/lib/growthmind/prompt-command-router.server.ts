// ── Prompt Command Router ───────────────────────────────────────────────────────
// Maps strategy types to prompt engines; builds generation prompts.
// This module is server-only — never import from client components.

export type PromptEngine =
  | "seo"
  | "content_studio"
  | "video_studio"
  | "campaign_factory"
  | "whatsapp"
  | "hexmail"
  | "ai_calling"
  | "landing_page";

export type StrategyCentreType =
  | "30_day"
  | "60_day"
  | "90_day"
  | "seo_campaign"
  | "meta_ads"
  | "google_ads"
  | "linkedin"
  | "whatsapp_campaign"
  | "hexmail_campaign"
  | "video_ad"
  | "ai_calling_campaign"
  | "landing_page_campaign"
  | "full_multi_channel";

export const ENGINE_LABELS: Record<PromptEngine, string> = {
  seo:              "SEO Campaign Engine",
  content_studio:   "Content Studio Engine",
  video_studio:     "Video Studio Engine",
  campaign_factory: "Campaign Factory Engine",
  whatsapp:         "WhatsApp Campaign Engine",
  hexmail:          "HexMail Campaign Engine",
  ai_calling:       "AI Calling Script Engine",
  landing_page:     "Landing Page Engine",
};

export const ENGINE_DESCRIPTIONS: Record<PromptEngine, string> = {
  seo:              "Keyword strategy, on-page SEO, content clusters, link building",
  content_studio:   "Blog posts, social media, authority content, thought leadership",
  video_studio:     "Video ad scripts, Reels, YouTube, testimonial formats",
  campaign_factory: "Paid ad copy, audiences, bidding strategy, creative briefs",
  whatsapp:         "Broadcast sequences, message templates, follow-up flows",
  hexmail:          "Email sequences, subject lines, segmentation, nurture flows",
  ai_calling:       "Call scripts, qualification questions, objection handling",
  landing_page:     "Page structure, headline, benefits, CTA, social proof",
};

export const STRATEGY_TYPE_LABELS: Record<StrategyCentreType, string> = {
  "30_day":               "30-Day Growth Strategy",
  "60_day":               "60-Day Growth Strategy",
  "90_day":               "90-Day Growth Strategy",
  "seo_campaign":         "SEO Campaign",
  "meta_ads":             "Meta Ads Campaign",
  "google_ads":           "Google Ads Campaign",
  "linkedin":             "LinkedIn Campaign",
  "whatsapp_campaign":    "WhatsApp Campaign",
  "hexmail_campaign":     "HexMail Campaign",
  "video_ad":             "Video Ad Campaign",
  "ai_calling_campaign":  "AI Calling Campaign",
  "landing_page_campaign":"Landing Page Campaign",
  "full_multi_channel":   "Full Multi-Channel Campaign",
};

const ENGINE_ROUTING: Record<StrategyCentreType, PromptEngine[]> = {
  "30_day":               ["content_studio", "seo", "hexmail"],
  "60_day":               ["content_studio", "seo", "campaign_factory", "hexmail"],
  "90_day":               ["content_studio", "seo", "campaign_factory", "video_studio", "hexmail", "whatsapp"],
  "seo_campaign":         ["seo"],
  "meta_ads":             ["campaign_factory", "video_studio"],
  "google_ads":           ["campaign_factory", "landing_page"],
  "linkedin":             ["campaign_factory", "content_studio"],
  "whatsapp_campaign":    ["whatsapp"],
  "hexmail_campaign":     ["hexmail"],
  "video_ad":             ["video_studio"],
  "ai_calling_campaign":  ["ai_calling"],
  "landing_page_campaign":["landing_page"],
  "full_multi_channel":   ["seo", "content_studio", "video_studio", "campaign_factory", "whatsapp", "hexmail", "ai_calling", "landing_page"],
};

export function routeToEngines(strategyType: StrategyCentreType): PromptEngine[] {
  return ENGINE_ROUTING[strategyType] ?? ["content_studio"];
}

function planFieldsForEngines(engines: PromptEngine[]): string {
  const has = (e: PromptEngine) => engines.includes(e);
  const fields: string[] = [
    `"campaign_plan": "Overall campaign execution plan: specific steps, timelines, ownership. Be detailed and actionable."`,
  ];
  if (has("content_studio"))
    fields.push(`"content_plan": "Exact content to create: blog topics with angles, social post formats, posting frequency per platform, content pillars"`);
  if (has("video_studio"))
    fields.push(`"video_plan": "Video ad scripts: hook (first 3 seconds), body, CTA. Formats (Reels/YouTube/LinkedIn). Production requirements."`);
  if (has("seo"))
    fields.push(`"seo_plan": "Priority keywords with intent, content cluster structure, technical SEO quick wins, 30/60/90-day milestones"`);
  if (has("whatsapp"))
    fields.push(`"whatsapp_plan": "WhatsApp sequence: message 1 (opening), message 2 (value), message 3 (CTA). Audience segments, timing, opt-in approach."`);
  if (has("hexmail"))
    fields.push(`"email_plan": "Email sequence: subject lines, preview text, body copy angle per email, send cadence, segmentation rules"`);
  if (has("ai_calling"))
    fields.push(`"ai_calling_plan": "Call script: opener, qualification questions (max 3), objection handling (top 3), soft close, follow-up protocol"`);
  if (has("landing_page"))
    fields.push(`"landing_page_plan": "Page structure: headline, subheadline, hero image brief, 3-5 benefits, social proof types needed, CTA button copy, form fields"`);
  return fields.join(",\n    ");
}

export function buildStrategyGenerationPrompt(
  strategyType: StrategyCentreType,
  engines: PromptEngine[],
  businessContext: string,
  snapshot: Record<string, any>,
): string {
  const typeLabel  = STRATEGY_TYPE_LABELS[strategyType];
  const engineList = engines.map(e => ENGINE_LABELS[e]).join(", ");

  return `You are GrowthMind, the AI CMO. Generate a complete ${typeLabel} for this specific business.

Prompt engines that will execute this strategy: ${engineList}.

CRITICAL RULES:
- Choose the single best service/product to promote. Do NOT ask the user. Score each from DNA and pick the winner.
- Reference actual business data (DNA, leads, calls, channels). No generic advice.
- Every plan section must be specific: names, formats, numbers, timelines.
- Be the world's best CMO advising this exact business.

## BUSINESS CONTEXT
${businessContext}

## LIVE PERFORMANCE SNAPSHOT
${JSON.stringify(snapshot, null, 2)}

## OUTPUT FORMAT — return ONLY valid JSON

{
  "executive_summary": "2-3 sentences: what this strategy does, why this business can win with it, and the core growth mechanism",
  "selected_service": "Exact service/product name from DNA to promote",
  "service_selection_reason": "Why this service was chosen: reference specific DNA data, lead signals, competitor gaps, and profit potential",
  "service_scores": {
    "ServiceName": 9.2
  },
  "target_audience": "Specific: job title or demographic, pain point, buying trigger, where they spend time online",
  "channel_recommendation": ["Channel 1", "Channel 2", "Channel 3"],
  "budget_recommendation": "Specific split: e.g. £3,000/month — Meta 40%, SEO 30%, Email 20%, WhatsApp 10%",
  "expected_outcome": "Specific: leads/month, conversion rate target, revenue impact, timeline to results",
  ${planFieldsForEngines(engines)},
  "kpis": [
    {"metric": "Leads Generated", "target": "50/month", "period": "30 days"},
    {"metric": "Conversion Rate", "target": "12%", "period": "90 days"}
  ],
  "risks": "Top 3 risks with specific mitigation strategies for this business",
  "required_assets": ["Asset name and specification"],
  "approval_actions": ["Specific approval action the user needs to take"],
  "confidence_score": 0.87
}`;
}
