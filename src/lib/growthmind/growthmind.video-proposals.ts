// SERVER ONLY — never import from a client component.
// Video Campaign Proposal Engine — auto-generates video campaign concepts (hook, platform,
// audience, storyboard, creative angle) using business context and trend signals.
// Persists to growthmind_video_proposals.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildBusinessContext, type BusinessContext } from "./growthmind.business-context";
import type { TrendSignal } from "./growthmind.trend-engine";

// ── Types ──────────────────────────────────────────────────────────────────────

export type VideoProposalStatus = "draft" | "approved" | "rejected";

export type VideoProposal = {
  id?:             string;
  title:           string;
  hook:            string;
  platform:        string;
  targetAudience:  string;
  storyboard:      string;
  creativeAngles:  string[];
  expectedOutcome: string;
  duration:        string;
  callToAction:    string;
  status:          VideoProposalStatus;
  generatedAt:     string;
};

// ── Deterministic video proposals ─────────────────────────────────────────────

export function generateVideoProposals(ctx: BusinessContext): VideoProposal[] {
  const proposals: VideoProposal[] = [];
  const ts = new Date().toISOString();

  const company  = ctx.companyName ?? "us";
  const service  = ctx.services[0] ?? ctx.products[0] ?? "our service";
  const industry = ctx.industry ?? "your industry";
  const audience = ctx.idealCustomerProfiles ?? ctx.targetMarkets ?? "potential customers";

  // Video 1: Problem/Solution (universal)
  proposals.push({
    title:          `"The Problem Most ${industry} Customers Face" — Short-Form Problem/Solution`,
    hook:           `"Most ${audience} make this mistake and it costs them [outcome]…"`,
    platform:       "YouTube Shorts + LinkedIn + TikTok",
    targetAudience: audience,
    storyboard:     [
      "0–3s: Hook — state the problem with visual emphasis (text overlay)",
      `3–15s: Agitate — show the pain/frustration in 3 quick scenes`,
      `15–35s: Solution — introduce ${service} as the answer, show the process`,
      `35–50s: Proof — quick results/testimonial moment or before/after`,
      `50–60s: CTA — "Book your free call today [link in bio]"`,
    ].join("\n"),
    creativeAngles: [
      "Talking-head style — authentic, camera-direct monologue from a founder/specialist",
      "B-roll + voiceover — show the work process with professional narration",
      "Text-on-screen hook + customer testimonial — social proof led",
    ],
    expectedOutcome: "60–90 second video format. Target: 15% watch-through rate on LinkedIn, 4% CTR to booking page.",
    duration:       "60–90 seconds",
    callToAction:   "Book a free call / claim your free consultation",
    status:         "draft",
    generatedAt:    ts,
  });

  // Video 2: Testimonial/Proof (if sales have been made)
  if (ctx.salesDone > 0 || ctx.totalBookings > 5) {
    proposals.push({
      title:          `"Real Results from ${company}" — Testimonial/Case Study Video`,
      hook:           `"Here's what happened when a ${audience} member tried ${service}…"`,
      platform:       "YouTube + LinkedIn + Website",
      targetAudience: audience,
      storyboard:     [
        "0–5s: Hook — text: '[Result number] in [time frame]' with bold visual",
        "5–20s: Context — set up the customer's before-state (problem they had)",
        "20–50s: Journey — document the process and transformation",
        "50–80s: Results — concrete numbers/outcomes (bookings, savings, growth)",
        "80–90s: CTA — book/enquire now",
      ].join("\n"),
      creativeAngles: [
        "Interview-style case study with real client (or actor/voiceover)",
        "Before/after data comparison with animated charts",
        "Day-in-the-life following a client through their journey",
      ],
      expectedOutcome: `Social proof video builds trust and drives 35% higher conversion on landing pages. Repurpose as 3 social clips.`,
      duration:       "90 seconds",
      callToAction:   "Get results like this — book a call",
      status:         "draft",
      generatedAt:    ts,
    });
  }

  // Video 3: Educational/Authority
  proposals.push({
    title:          `"How ${service} Works" — Educational Explainer`,
    hook:           `"Here's exactly how we [deliver result] in [time frame] — no fluff"`,
    platform:       "YouTube (SEO) + LinkedIn",
    targetAudience: `Decision-makers researching ${service}`,
    storyboard:     [
      "0–5s: Hook — bold claim or surprising statistic",
      "5–30s: The process — walk through exactly how it works (3 clear steps)",
      "30–60s: What makes it different — your unique approach vs competitors",
      "60–80s: What to expect — realistic outcomes and timeline",
      "80–90s: CTA — get started / book your free discovery call",
    ].join("\n"),
    creativeAngles: [
      "Screen-share walkthrough of the platform/tool/process",
      "Whiteboard animation explaining the methodology",
      "Talking-head with slide overlays for clarity",
    ],
    expectedOutcome: "Longer-form (2–3 min) version ranks on YouTube. 60-second cut for LinkedIn generates organic reach.",
    duration:       "60–90 seconds (LinkedIn cut) / 2–3 minutes (YouTube)",
    callToAction:   "See it in action — book a free demo",
    status:         "draft",
    generatedAt:    ts,
  });

  // Video 4: WhatsApp/Social quick hit (if WA active)
  if (ctx.systemHealth.whatsapp || ctx.waMessages > 0) {
    proposals.push({
      title:          `"Quick Win" — 15-Second WhatsApp/Reels Hook Video`,
      hook:           `"Stop scrolling — ${audience} are getting [result] with this one change"`,
      platform:       "Instagram Reels + WhatsApp Status + TikTok",
      targetAudience: audience,
      storyboard:     [
        "0–2s: Bold text hook on screen",
        "2–8s: The one insight or tip (rapid delivery, high energy)",
        "8–13s: The outcome/result they'll get",
        "13–15s: CTA — 'DM us [keyword] to find out more'",
      ].join("\n"),
      creativeAngles: [
        "Rapid-cut talking head — fast paced, high energy",
        "Text animation only — hook + insight as text overlays on branded background",
        "Before/after still image with voice overlay",
      ],
      expectedOutcome: "High frequency, low production — post 3× per week for 2 weeks. Goal: 100+ profile visits per video.",
      duration:       "15 seconds",
      callToAction:   "DM us '[keyword]' to get started",
      status:         "draft",
      generatedAt:    ts,
    });
  }

  return proposals;
}

// ── AI-powered video proposal generation ──────────────────────────────────────
// Attempts to generate contextual video concepts from GPT-4o using trend signals.
// Falls back to deterministic proposals if AI is unavailable or fails.

async function generateAIVideoProposals(
  ctx: BusinessContext,
  signals: TrendSignal[],
  apiKey: string,
): Promise<VideoProposal[]> {
  const ts = new Date().toISOString();

  const growingSignals   = signals.filter(s => s.classification === "Growing" || s.classification === "Emerging");
  const decliningSignals = signals.filter(s => s.classification === "Declining");

  const signalSummary = signals.slice(0, 8).map(s =>
    `• ${s.label}: ${s.classification} — ${s.insight}`
  ).join("\n");

  const service  = ctx.services[0] ?? ctx.products[0] ?? "our service";
  const audience = ctx.idealCustomerProfiles ?? ctx.targetMarkets ?? "potential customers";
  const industry = ctx.industry ?? "your industry";

  const systemPrompt = `You are GrowthMind, an elite AI Chief Marketing Officer specialising in video content strategy. Generate specific, production-ready video campaign concepts for this business.

BUSINESS CONTEXT:
Company: ${ctx.companyName ?? "Unknown"}
Industry: ${industry}
Services: ${ctx.services.join(", ") || service}
Target Audience: ${audience}
Brand Voice: ${ctx.brandVoice ?? "professional and trustworthy"}
USPs: ${ctx.uniqueSellingPoints ?? "not specified"}

LIVE SIGNALS:
${signalSummary || "No trend data — use business context."}

SENTIMENT & PIPELINE INSIGHTS:
- Call sentiment: ${ctx.callSentiment.positiveRate}% positive (${ctx.callSentiment.totalWithSentiment} calls scored)
- WhatsApp reply rate: ${ctx.waReplyRate !== null ? ctx.waReplyRate + "%" : "unknown"}
- Pipeline bottleneck: ${ctx.stalledStage ?? "unknown"} stage
- Growing areas: ${growingSignals.map(s => s.label).join(", ") || "none identified"}
- Declining areas: ${decliningSignals.map(s => s.label).join(", ") || "none identified"}`;

  const userPrompt = `Generate exactly 3 video campaign concepts. Each must be directly tied to the signals and business data above — be specific. Return ONLY valid JSON as an array:
[
  {
    "title": "Specific video campaign title",
    "hook": "The exact opening line or visual — make it arresting and specific to this business",
    "platform": "Primary platform(s) — be specific (e.g. 'LinkedIn Ads + YouTube Shorts')",
    "targetAudience": "Precise audience for this specific video",
    "storyboard": "Scene-by-scene breakdown with timestamps (e.g. 0-3s: ..., 3-15s: ..., etc.)",
    "creativeAngles": ["angle 1", "angle 2", "angle 3"],
    "expectedOutcome": "Specific projected result (views, CTR, leads, bookings)",
    "duration": "e.g. '60 seconds' or '15 seconds'",
    "callToAction": "Exact CTA wording"
  }
]
Return only the JSON array. No markdown, no preamble.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      max_tokens: 1800,
      temperature: 0.65,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const json = await res.json() as any;
  const raw = json.choices?.[0]?.message?.content ?? "[]";

  let parsed: any[];
  try {
    const obj = JSON.parse(raw);
    parsed = Array.isArray(obj) ? obj : (obj.proposals ?? obj.videos ?? Object.values(obj));
  } catch {
    throw new Error("Failed to parse AI video response as JSON");
  }

  return parsed.slice(0, 4).map((p: any) => ({
    title:           String(p.title ?? "AI Video Concept"),
    hook:            String(p.hook ?? ""),
    platform:        String(p.platform ?? "LinkedIn + YouTube"),
    targetAudience:  String(p.targetAudience ?? audience),
    storyboard:      String(p.storyboard ?? ""),
    creativeAngles:  Array.isArray(p.creativeAngles) ? p.creativeAngles.map(String) : [],
    expectedOutcome: String(p.expectedOutcome ?? ""),
    duration:        String(p.duration ?? "60 seconds"),
    callToAction:    String(p.callToAction ?? "Book a free call"),
    status:          "draft" as VideoProposalStatus,
    generatedAt:     ts,
  }));
}

// ── Autonomous video studio queue creation ────────────────────────────────────

export async function createAutonomousVideoQueueEntries(
  sb: any,
  workspaceId: string,
  proposals: VideoProposal[],
): Promise<void> {
  const settingsRes = await sb.from("workspace_settings")
    .select("hivemind_mode")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
    .catch(() => ({ data: null }));

  const mode = settingsRes?.data?.hivemind_mode ?? null;
  if (mode !== "assistant" && mode !== "operator") return;

  for (const proposal of proposals.slice(0, 2)) {
    try {
      await sb.from("hivemind_actions").insert({
        workspace_id: workspaceId,
        action_type:  "video_proposal",
        title:        `Video Concept: ${proposal.title}`,
        description:  `GrowthMind CMO auto-generated this video concept.\n\nHook: ${proposal.hook}\nPlatform: ${proposal.platform}\n\nStoryboard:\n${proposal.storyboard}`,
        status:       "pending",
        priority:     "medium",
        source:       "growthmind",
        metadata:     { proposal },
      });
    } catch { /* table may not exist — fail silently */ }
  }
}

// ── Server functions ───────────────────────────────────────────────────────────

export const getVideoProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    try {
      const { data } = await sb
        .from("growthmind_video_proposals")
        .select("id, title, hook, platform, target_audience, storyboard, creative_angles, expected_outcome, duration, call_to_action, status, generated_at")
        .eq("workspace_id", workspaceId)
        .order("generated_at", { ascending: false })
        .limit(20);
      return {
        proposals: (data ?? []).map((r: any) => ({
          id:              r.id,
          title:           r.title,
          hook:            r.hook,
          platform:        r.platform,
          targetAudience:  r.target_audience,
          storyboard:      r.storyboard,
          creativeAngles:  r.creative_angles ?? [],
          expectedOutcome: r.expected_outcome,
          duration:        r.duration,
          callToAction:    r.call_to_action,
          status:          r.status as VideoProposalStatus,
          generatedAt:     r.generated_at,
        })) as VideoProposal[],
      };
    } catch {
      return { proposals: [] };
    }
  });

export const updateVideoProposalStatus = createServerFn({ method: "POST" })
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
      await sb.from("growthmind_video_proposals")
        .update({ status: data.status })
        .eq("id", data.proposalId)
        .eq("workspace_id", workspaceId);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

export const runVideoProposalEngine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Pull trend signals and workspace API key to power AI generation
    const [signalsRes, settingsRes] = await Promise.all([
      sb.from("growthmind_trend_signals")
        .select("signal_type, label, classification, current_value, previous_value, change_percent, insight, action_hint")
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

    const dbSignals: TrendSignal[] = ((signalsRes as any).data ?? []).map((r: any) => ({
      signalType:     r.signal_type,
      label:          r.label,
      classification: r.classification,
      currentValue:   r.current_value,
      previousValue:  r.previous_value,
      changePercent:  r.change_percent,
      insight:        r.insight,
      actionHint:     r.action_hint ?? "",
      computedAt:     new Date().toISOString(),
    }));

    const apiKey: string | null = process.env.OPENAI_API_KEY
      ?? (settingsRes as any)?.data?.openai_api_key
      ?? null;

    const ctx: BusinessContext = await buildBusinessContext(sb, workspaceId);

    // Attempt AI-powered video proposals; fall back to deterministic on any failure
    let proposals: VideoProposal[];
    let aiGenerated = false;
    if (apiKey) {
      try {
        proposals = await generateAIVideoProposals(ctx, dbSignals, apiKey);
        aiGenerated = true;
      } catch {
        proposals = generateVideoProposals(ctx);
      }
    } else {
      proposals = generateVideoProposals(ctx);
    }

    if (proposals.length === 0) return { ok: true, count: 0, aiGenerated };

    await sb.from("growthmind_video_proposals").delete().eq("workspace_id", workspaceId).catch(() => {});

    const rows = proposals.map(p => ({
      workspace_id:    workspaceId,
      title:           p.title,
      hook:            p.hook,
      platform:        p.platform,
      target_audience: p.targetAudience,
      storyboard:      p.storyboard,
      creative_angles: p.creativeAngles,
      expected_outcome: p.expectedOutcome,
      duration:        p.duration,
      call_to_action:  p.callToAction,
      status:          "draft",
      generated_at:    p.generatedAt,
    }));

    await sb.from("growthmind_video_proposals").insert(rows).catch(() => {});

    await createAutonomousVideoQueueEntries(sb, workspaceId, proposals);

    return { ok: true, count: proposals.length, aiGenerated };
  });
