import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeGenerate } from "./model-router.server";
import {
  parseJobSentinel, isJobPending, archiveVideoToStorage,
} from "./video-job-poller";
import { optimiseVideoPrompt } from "./video-prompt-engine.server";
import { VeoProvider, resolveVeoConfig, isAudioCapableModel, type VeoConfig } from "@/lib/video/providers/veo.provider";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VideoType =
  | "meta_video_ad"
  | "linkedin_video"
  | "tiktok_video"
  | "explainer_video"
  | "ugc_ad"
  | "product_demo"
  | "youtube_short"
  | "youtube_ad"
  | "case_study_video"
  | "testimonial_video"
  | "webinar_clip"
  | "podcast_clip"
  | "receptionist_demo";

export type QualityMode = "fast" | "balanced" | "premium";
export type VideoProvider = "veo3" | "runway_gen4" | "kling" | "pika";

export type StoryboardScene = {
  scene:       number;
  visual:      string;
  voiceover:   string;
  onScreenText: string;
  duration:    number;
  cta?:        string;
};

export type VideoAsset = {
  id:               string;
  title:            string;
  videoType:        VideoType;
  provider:         VideoProvider | null;
  script:           string;
  storyboard:       StoryboardScene[];
  videoUrl:         string | null;
  audioUrl:         string | null;
  voiceId:          string | null;
  qualityMode:      QualityMode;
  costEstimate:     number;
  scheduledAt:      string | null;
  createdAt:        string;
  campaignId:       string | null;
  variantGroupId:   string | null;
  variantType:      string | null;
  creativeScore:    Record<string, number> | null;
  isComposite:      boolean;
  assemblyStatus:   string | null;
  assemblyError:    string | null;
  finalVideoUrl:    string | null;
  requestedDuration: number | null;
  hasNativeAudio:       boolean | null;
  knowledgeContextType: string | null;
  knowledgeContextName: string | null;
  businessName:         string | null;
};

export type VideoClip = {
  id:               string;
  workspaceId:      string;
  assetId:          string;
  sceneIndex:       number;
  sceneTitle:       string | null;
  scenePrompt:      string | null;
  durationSeconds:  number | null;
  provider:         string | null;
  providerJobId:    string | null;
  status:           "pending" | "processing" | "completed" | "failed";
  rawVideoUrl:      string | null;
  archivedVideoUrl: string | null;
  errorMessage:     string | null;
  createdAt:        string;
};

export const VIDEO_TYPE_LABELS: Record<VideoType, string> = {
  meta_video_ad:     "Meta Video Ad",
  linkedin_video:    "LinkedIn Video",
  tiktok_video:      "TikTok Video",
  explainer_video:   "Explainer Video",
  ugc_ad:            "UGC Ad",
  product_demo:      "Product Demo",
  youtube_short:     "YouTube Short",
  youtube_ad:        "YouTube Ad",
  case_study_video:  "Case Study Video",
  testimonial_video: "Testimonial Video",
  webinar_clip:      "Webinar Clip",
  podcast_clip:      "Podcast Clip",
  receptionist_demo: "Receptionist Demo",
};

export const VIDEO_TYPE_CATEGORIES: { label: string; types: VideoType[] }[] = [
  { label: "Ads", types: ["meta_video_ad", "linkedin_video", "tiktok_video", "youtube_ad", "ugc_ad"] },
  { label: "Awareness", types: ["explainer_video", "product_demo", "youtube_short", "receptionist_demo"] },
  { label: "Content", types: ["case_study_video", "testimonial_video", "webinar_clip", "podcast_clip"] },
];

function videoProviderForType(videoType: VideoType): VideoProvider {
  const runwayTypes: VideoType[] = ["ugc_ad", "testimonial_video"];
  return runwayTypes.includes(videoType) ? "runway_gen4" : "veo3";
}

function estimateCost(qualityMode: QualityMode, videoType: VideoType): number {
  if (qualityMode === "fast")     return 0.05;
  if (qualityMode === "balanced") return 0.35;
  const provider = videoProviderForType(videoType);
  return provider === "veo3" ? 2.50 : 1.80;
}

// ── Knowledge Context types ────────────────────────────────────────────────────

export type KnowledgeContextType =
  | "default"
  | "specific_kb"
  | "custom_campaign"
  | "none";

export type VideoKnowledgeBase = {
  id:            string;
  name:          string;
  description:   string | null;
  documentCount: number;
  updatedAt:     string | null;
  slug:          string;
};

/** List executive knowledge bases available for video context selection. */
export const listVideoKnowledgeBases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const [kbRes, docRes] = await Promise.all([
      sb.from("executive_knowledge_bases")
        .select("id, slug, name, description, updated_at")
        .eq("workspace_id", workspaceId)
        .order("name"),
      sb.from("executive_documents")
        .select("knowledge_base_id")
        .eq("workspace_id", workspaceId)
        .eq("embedding_status", "indexed"),
    ]);

    const kbs: any[]  = kbRes.data  ?? [];
    const docs: any[] = docRes.data ?? [];

    const countMap: Record<string, number> = {};
    for (const d of docs) {
      if (d.knowledge_base_id)
        countMap[d.knowledge_base_id] = (countMap[d.knowledge_base_id] ?? 0) + 1;
    }

    return kbs.map((kb: any): VideoKnowledgeBase => ({
      id:            kb.id,
      name:          kb.name,
      description:   kb.description ?? null,
      documentCount: countMap[kb.id] ?? 0,
      updatedAt:     kb.updated_at  ?? null,
      slug:          kb.slug,
    }));
  });

/** Resolve the effective company name, industry, kbSummary, and docSummary
 *  based on the selected knowledge context type.  Returns enriched context
 *  plus a human-readable `contextName` label and `contextType` tag. */
async function resolveVideoKnowledgeContext(
  sb:          any,
  workspaceId: string,
  opts: {
    knowledgeContextType?: string | null;
    knowledgeContextId?:   string | null;
    knowledgeContextName?: string | null;
    customBusinessName?:   string;
    customIndustry?:       string;
    customOffer?:          string;
    customBrandVoice?:     string;
    customWebsite?:        string;
    customCampaignGoal?:   string;
    targetAudience?:       string;
  },
  defaults: { companyName: string; industry: string; kbSummary: string; docSummary: string },
): Promise<{
  companyName:  string;
  industry:     string;
  kbSummary:    string;
  docSummary:   string;
  contextName:  string;
  contextType:  string;
}> {
  const type = opts.knowledgeContextType ?? "default";

  if (type === "none") {
    return {
      companyName: defaults.companyName,
      industry:    defaults.industry,
      kbSummary:   "",
      docSummary:  "",
      contextName: "No Context",
      contextType: "none",
    };
  }

  if (type === "custom_campaign") {
    const ctxParts = [
      opts.customOffer        ? `Offer: ${opts.customOffer}` : "",
      opts.customBrandVoice   ? `Brand voice: ${opts.customBrandVoice}` : "",
      opts.customWebsite      ? `Website: ${opts.customWebsite}` : "",
      opts.customCampaignGoal ? `Campaign goal: ${opts.customCampaignGoal}` : "",
      opts.targetAudience     ? `Target audience: ${opts.targetAudience}` : "",
    ].filter(Boolean);
    return {
      companyName: opts.customBusinessName || defaults.companyName,
      industry:    opts.customIndustry     || defaults.industry,
      kbSummary:   ctxParts.join(" | "),
      docSummary:  "",
      contextName: opts.customBusinessName || "Custom Campaign",
      contextType: "custom_campaign",
    };
  }

  if (type === "specific_kb" && opts.knowledgeContextId) {
    const [kbRes, docRes] = await Promise.all([
      sb.from("executive_knowledge_bases")
        .select("name, description")
        .eq("id", opts.knowledgeContextId)
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      sb.from("executive_documents")
        .select("title, content")
        .eq("knowledge_base_id", opts.knowledgeContextId)
        .eq("workspace_id", workspaceId)
        .eq("embedding_status", "indexed")
        .limit(6),
    ]);
    const kb   = kbRes.data;
    const docs: any[] = docRes.data ?? [];

    const kbSummary  = kb
      ? `${kb.name}${kb.description ? `: ${kb.description}` : ""}`
      : "";
    const docSummary = docs.map((d: any) => {
      const excerpt = typeof d.content === "string" ? d.content.slice(0, 300) : "";
      return `${d.title}${excerpt ? `: ${excerpt}` : ""}`;
    }).join("\n");

    return {
      companyName: defaults.companyName,
      industry:    defaults.industry,
      kbSummary,
      docSummary,
      contextName: opts.knowledgeContextName || kb?.name || "Knowledge Base",
      contextType: "specific_kb",
    };
  }

  // default — workspace context as-is
  return {
    ...defaults,
    contextName: defaults.companyName,
    contextType: "default",
  };
}

// ── Generate voiceover via ElevenLabs ─────────────────────────────────────────

async function generateVoiceover(
  script:   string,
  voiceId:  string,
  elKey:    string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: { "xi-api-key": elKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text:           script.slice(0, 4000),
          model_id:       "eleven_turbo_v2",
          voice_settings: { stability: 0.50, similarity_boost: 0.75 },
        }),
      }
    );
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    return `data:audio/mpeg;base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}


// ── Runway Gen-4 video generation ─────────────────────────────────────────────
// NOTE: Runway Gen-4 API — returns a task ID. Video URL available after polling.

async function generateRunwayVideo(
  prompt:      string,
  runwayKey:   string,
): Promise<string | null> {
  try {
    const res = await fetch("https://api.runwayml.com/v1/image_to_video", {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${runwayKey}`,
        "Content-Type": "application/json",
        "X-Runway-Version": "2024-11-06",
      },
      body: JSON.stringify({
        model:       "gen4_turbo",
        promptText:  prompt,
        ratio:       "1280:720",
        duration:    10,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json() as any;
    return json?.id ?? null;
  } catch {
    return null;
  }
}

// ── Full Veo prompt from all storyboard scenes ────────────────────────────────

function buildFullVeoPrompt(
  storyboard: StoryboardScene[],
  params: {
    companyName?:    string;
    tone?:           string;
    platform?:       string;
    aspectRatio?:    string;
    videoType?:      VideoType | string;
    targetAudience?: string;
    offer?:          string;
    cta?:            string;
  },
): string {
  const sceneLines = storyboard.map((s) => {
    const parts = [
      `Scene ${s.scene ?? 1} (${s.duration ?? 5}s):`,
      s.visual        ? `Visual — ${s.visual}`            : "",
      s.onScreenText  ? `On-screen — "${s.onScreenText}"` : "",
      s.cta           ? `CTA — "${s.cta}"`                : "",
    ].filter(Boolean);
    return parts.join(" ");
  }).filter(Boolean).join(" // ");

  const meta = [
    params.companyName    ? `Brand: ${params.companyName}`                                                    : "",
    params.platform       ? `Platform: ${params.platform}`                                                    : "",
    params.aspectRatio    ? `Aspect ratio: ${params.aspectRatio}`                                             : "",
    params.tone           ? `Style/tone: ${params.tone}`                                                      : "",
    params.targetAudience ? `Target audience: ${params.targetAudience}`                                       : "",
    params.offer          ? `Key offer: ${params.offer}`                                                      : "",
    params.cta            ? `Call to action: ${params.cta}`                                                   : "",
    params.videoType      ? `Format: ${VIDEO_TYPE_LABELS[params.videoType as VideoType] ?? params.videoType}` : "",
  ].filter(Boolean).join(" | ");

  return [sceneLines, meta].filter(Boolean).join("\n\n");
}

// ── Build generation prompts ──────────────────────────────────────────────────

function buildVideoPrompts(params: {
  videoType:       VideoType;
  companyName:     string;
  industry:        string;
  targetAudience:  string;
  offer:           string;
  tone:            string;
  cta:             string;
  keywords:        string;
  competitors:     string;
  playbook:        string;
  kbSummary:       string;
  docSummary:      string;
  qualityMode:     QualityMode;
  valuePoint?:     string;
  topOpportunity?: string;
}): { strategySystem: string; strategyUser: string; scriptSystem: string; scriptUser: string } {
  const label = VIDEO_TYPE_LABELS[params.videoType];

  const kbContext = [
    params.kbSummary  ? `## Knowledge Bases\n${params.kbSummary}` : "",
    params.docSummary ? `## Company Documents\n${params.docSummary}` : "",
  ].filter(Boolean).join("\n\n");

  const valueContext = [
    params.valuePoint     ? `## Current Highest Value Point\n${params.valuePoint}\nIMPORTANT: Lead with this value proposition — it is the strongest market angle right now.` : "",
    params.topOpportunity ? `## Top Live Opportunity\n${params.topOpportunity}` : "",
  ].filter(Boolean).join("\n\n");

  const strategySystem = `You are GrowthMind Video Studio, an expert AI marketing strategist specialising in video content.

## Company Context
Business: ${params.companyName || "the business"}
Industry: ${params.industry || "not specified"}
SEO Keywords: ${params.keywords || "None tracked"}
Competitors: ${params.competitors || "None tracked"}
${params.playbook ? `Active Playbook: ${params.playbook}` : ""}
${kbContext}
${valueContext}

## Your Role
Generate a concise video strategy brief (3-5 sentences) for a ${label}. Focus on unique angle, differentiation, and primary message. Lead with the current highest value point if available. Output only the brief, no headings.`;

  const strategyUser = `Create a strategy brief for a ${label} targeting ${params.targetAudience || "our ideal customer"}.
Offer: ${params.offer || "our product/service"}
Tone: ${params.tone || "professional"}
CTA: ${params.cta || "Contact us"}`;

  const scriptSystem = `You are GrowthMind Video Studio, an expert AI video scriptwriter and director.

## Company Context
Business: ${params.companyName || "the business"}
Industry: ${params.industry || "not specified"}
SEO Keywords: ${params.keywords || "None tracked"}
${params.playbook ? `Active Playbook: ${params.playbook}` : ""}
${kbContext}

## Your Role
Write a complete ${label} script with a detailed scene-by-scene storyboard in JSON.

Output format — return ONLY this JSON (no markdown code fences, no extra text):
{
  "title": "...",
  "script": "Full voiceover script here...",
  "storyboard": [
    {
      "scene": 1,
      "visual": "Describe what the camera shows / visual elements",
      "voiceover": "Exact words spoken",
      "onScreenText": "Text overlay / captions shown",
      "duration": 5,
      "cta": "optional CTA text for last scene"
    }
  ]
}

Rules:
- 3-8 scenes depending on video type
- Total duration: ${params.videoType === "youtube_short" || params.videoType === "tiktok_video" ? "30-60" : params.videoType === "youtube_ad" ? "15-30" : "60-90"} seconds
- Each scene duration in seconds
- Make it compelling and platform-appropriate`;

  const scriptUser = `Create a ${label} with this brief:
Target Audience: ${params.targetAudience || "our ideal customer"}
Offer: ${params.offer || "our product/service"}
Tone: ${params.tone || "professional"}
CTA: ${params.cta || "Contact us today"}
Strategy: Use the company context to make this specific and differentiated.`;

  return { strategySystem, strategyUser, scriptSystem, scriptUser };
}

// ── Generate video ─────────────────────────────────────────────────────────────

const generateVideoSchema = z.object({
  videoType:        z.string().min(1),
  qualityMode:      z.enum(["fast", "balanced", "premium"]),
  targetAudience:   z.string().default(""),
  offer:            z.string().default(""),
  tone:             z.string().default("professional"),
  cta:              z.string().default(""),
  voiceId:          z.string().default("21m00Tcm4TlvDq8ikWAM"),
  campaignId:       z.string().uuid().nullish(),
  includeKb:            z.boolean().default(true),
  generateVeoAudio:     z.boolean().default(true),
  knowledgeContextType: z.enum(["default", "specific_kb", "custom_campaign", "none"]).default("default"),
  knowledgeContextId:   z.string().uuid().nullish(),
  knowledgeContextName: z.string().nullish(),
  customBusinessName:   z.string().default(""),
  customIndustry:       z.string().default(""),
  customOffer:          z.string().default(""),
  customBrandVoice:     z.string().default(""),
  customWebsite:        z.string().default(""),
  customCampaignGoal:   z.string().default(""),
});

export const generateVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => generateVideoSchema.parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    const settings    = (context as any).settings ?? {};
    if (!workspaceId) throw new Error("No workspace");

    const videoType   = data.videoType as VideoType;
    const qualityMode = data.qualityMode;

    // ── Pull context ────────────────────────────────────────────────────────
    const [wsRes, seoRes, compRes, playbookRes, kbRes, docsRes, vpRes, oppRes] = await Promise.all([
      sb.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle(),
      sb.from("growthmind_seo_sites").select("keywords").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("growthmind_competitors").select("name, positioning").eq("workspace_id", workspaceId).limit(10),
      sb.from("growthmind_playbooks").select("industry").eq("workspace_id", workspaceId).eq("status", "active").maybeSingle(),
      Promise.resolve(sb.from("knowledge_bases").select("name, description").eq("workspace_id", workspaceId).limit(5)).catch(() => ({ data: [] })),
      Promise.resolve(sb.from("documents").select("name, content").eq("workspace_id", workspaceId).limit(3)).catch(() => ({ data: [] })),
      Promise.resolve(sb.from("growthmind_value_points").select("current_highest_value,who_to_target,recommended_offer,best_channels").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle()).catch(() => ({ data: null })),
      Promise.resolve(sb.from("growthmind_opportunities").select("title,recommended_action,urgency").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle()).catch(() => ({ data: null })),
    ]);

    const ws          = wsRes.data;
    const wsSettings  = ws?.settings ?? {};
    const companyName = ws?.name ?? wsSettings.company_name ?? "";
    const industry    = wsSettings.industry ?? "";

    const keywords = ((seoRes.data?.keywords ?? []) as any[])
      .slice(0, 10)
      .map((k: any) => `"${k.term}"`)
      .join(", ") || "None tracked";

    const competitors = ((compRes.data ?? []) as any[])
      .map((c: any) => `${c.name}${c.positioning ? ` — ${c.positioning}` : ""}`)
      .join("; ") || "None tracked";

    const playbook = playbookRes.data?.industry ?? "";

    const kbSummary = data.includeKb === false ? "" : ((kbRes.data ?? []) as any[])
      .map((k: any) => `${k.name}${k.description ? `: ${k.description}` : ""}`)
      .join("; ") || "";

    const docSummary = data.includeKb === false ? "" : ((docsRes.data ?? []) as any[])
      .map((d: any) => {
        const excerpt = typeof d.content === "string" ? d.content.slice(0, 300) : "";
        return `${d.name}${excerpt ? `: ${excerpt}` : ""}`;
      })
      .join("\n") || "";

    const vp = vpRes.data;
    const valuePoint = vp
      ? [
          vp.current_highest_value,
          vp.who_to_target   ? `Target: ${vp.who_to_target}` : "",
          vp.recommended_offer ? `Offer: ${vp.recommended_offer}` : "",
          vp.best_channels   ? `Channels: ${vp.best_channels}` : "",
        ].filter(Boolean).join(" | ")
      : "";

    const opp = oppRes.data;
    const topOpportunity = opp
      ? `${opp.title}${opp.recommended_action ? ` — ${opp.recommended_action}` : ""} (urgency: ${opp.urgency ?? "medium"})`
      : "";

    // ── Knowledge Context Resolution ──────────────────────────────────────────
    const ctx = await resolveVideoKnowledgeContext(sb, workspaceId, {
      knowledgeContextType: data.knowledgeContextType,
      knowledgeContextId:   data.knowledgeContextId,
      knowledgeContextName: data.knowledgeContextName,
      customBusinessName:   data.customBusinessName,
      customIndustry:       data.customIndustry,
      customOffer:          data.customOffer,
      customBrandVoice:     data.customBrandVoice,
      customWebsite:        data.customWebsite,
      customCampaignGoal:   data.customCampaignGoal,
      targetAudience:       data.targetAudience,
    }, { companyName, industry, kbSummary, docSummary });

    const prompts = buildVideoPrompts({
      videoType,
      companyName:    ctx.companyName,
      industry:       ctx.industry,
      keywords, competitors, playbook,
      kbSummary:      ctx.kbSummary,
      docSummary:     ctx.docSummary,
      targetAudience: data.targetAudience,
      offer:          data.customOffer || data.offer,
      tone:           data.customBrandVoice || data.tone,
      cta:            data.cta,
      qualityMode,
      valuePoint,
      topOpportunity,
    });

    // ── Step 1: Strategy brief (Gemini 2.5 Pro) ─────────────────────────────
    const strategyResult = await routeGenerate({
      system:      prompts.strategySystem,
      user:        prompts.strategyUser,
      contentType: videoType,
      maxTokens:   400,
      mode:        "manual",
      provider:    "gemini",
      model:       "gemini-2.5-pro",
      settings,
      workspaceId,
      sb,
    });

    // ── Step 2: Script + storyboard (Claude Sonnet 4) ──────────────────────
    const scriptResult = await routeGenerate({
      system:      prompts.scriptSystem,
      user:        `${prompts.scriptUser}\n\nStrategy brief: ${strategyResult.text}`,
      contentType: videoType,
      maxTokens:   2500,
      mode:        "manual",
      provider:    "claude",
      model:       "claude-sonnet-4-5",
      settings,
      workspaceId,
      sb,
    });

    // ── Parse script + storyboard JSON ────────────────────────────────────
    let title       = `${VIDEO_TYPE_LABELS[videoType]} — ${new Date().toLocaleDateString()}`;
    let script      = scriptResult.text;
    let storyboard: StoryboardScene[] = [];

    try {
      const cleaned = scriptResult.text
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/gi, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      title      = parsed.title ?? title;
      script     = parsed.script ?? scriptResult.text;
      storyboard = (parsed.storyboard ?? []).map((s: any, i: number) => ({
        scene:        s.scene ?? i + 1,
        visual:       s.visual ?? "",
        voiceover:    s.voiceover ?? "",
        onScreenText: s.onScreenText ?? s.on_screen_text ?? "",
        duration:     Number(s.duration ?? 5),
        cta:          s.cta ?? undefined,
      }));
    } catch {
      storyboard = [{
        scene:        1,
        visual:       "Auto-generated from script",
        voiceover:    script.slice(0, 500),
        onScreenText: "",
        duration:     30,
      }];
    }

    // ── Step 3: ElevenLabs voiceover (Balanced + Premium) ─────────────────
    let audioUrl: string | null = null;
    if (qualityMode === "balanced" || qualityMode === "premium") {
      const elKey = process.env.ELEVENLABS_API_KEY ?? settings.elevenlabs_api_key;
      if (elKey) {
        const voiceoverText = storyboard.map(s => s.voiceover).join(" ");
        audioUrl = await generateVoiceover(voiceoverText || script, data.voiceId, elKey);
      }
    }

    // ── Step 4: AI video (Premium only) ───────────────────────────────────
    let videoUrl:  string | null = null;
    let provider:  VideoProvider | null = null;

    if (qualityMode === "premium") {
      const primaryProvider = videoProviderForType(videoType);

      // Resolve video provider credentials: workspace provider_settings > env vars
      const [veoSettingsRes, runwaySettingsRes] = await Promise.all([
        sb.from("provider_settings")
          .select("credentials, status")
          .eq("workspace_id", workspaceId)
          .eq("provider_category", "video")
          .eq("provider_name", "google_veo")
          .maybeSingle(),
        sb.from("provider_settings")
          .select("credentials, status")
          .eq("workspace_id", workspaceId)
          .eq("provider_category", "video")
          .eq("provider_name", "runway")
          .maybeSingle(),
      ]);

      const veoCreds = (veoSettingsRes.data?.credentials ?? {}) as Record<string, string>;
      const runwayCreds = (runwaySettingsRes.data?.credentials ?? {}) as Record<string, string>;
      const runwayKey = runwayCreds.apiKey?.trim() || process.env.RUNWAY_API_KEY || settings.runway_api_key || "";

      const visualPrompt = buildFullVeoPrompt(storyboard, {
        companyName:    companyName,
        tone:           data.tone ?? "professional",
        videoType:      videoType,
        targetAudience: data.targetAudience,
        offer:          data.offer,
        cta:            data.cta,
      }) || `${storyboard[0]?.visual ?? data.offer ?? "promotional video"}. Style: ${data.tone ?? "professional"}, brand: ${companyName}`;

      // Helper: submit to Veo 3 using VeoProvider (supports Gemini API key + Vertex OAuth)
      const submitVeo3 = async (prompt: string): Promise<boolean> => {
        const veoCfg = resolveVeoConfig(veoCreds);
        const veoProvider = new VeoProvider(veoCfg);
        if (!veoProvider.authMode) {
          console.warn("[video-studio] Veo 3 skipped — no credentials configured (add Gemini API Key in Settings → Providers → Video)");
          return false;
        }
        try {
          const veoResult = await veoProvider.generateVideo({ prompt, aspectRatio: "16:9", durationSeconds: 8, generateAudio: data.generateVeoAudio });
          videoUrl = `[veo3_job:${veoResult.jobId}]`;
          provider = "veo3";
          return true;
        } catch (err: any) {
          console.error("[video-studio] Veo 3 generation failed:", err?.message ?? err);
          videoUrl = `[error:Veo 3 error: ${(err?.message ?? "unknown").slice(0, 200)}]`;
          return false;
        }
      };

      if (primaryProvider === "runway_gen4") {
        // UGC / Testimonial → Runway Gen-4 primary, Veo 3 fallback
        if (runwayKey) {
          const runResult = await generateRunwayVideo(visualPrompt, runwayKey);
          if (runResult) { videoUrl = `[runway_job:${runResult}]`; provider = "runway_gen4"; }
        }
        if (!videoUrl) await submitVeo3(visualPrompt);
      } else {
        // All other types → Veo 3 primary, Runway fallback
        const submitted = await submitVeo3(visualPrompt);
        if (!submitted && runwayKey) {
          const runResult = await generateRunwayVideo(visualPrompt, runwayKey);
          if (runResult) { videoUrl = `[runway_job:${runResult}]`; provider = "runway_gen4"; }
        }
      }
    }

    // ── Estimate total cost ────────────────────────────────────────────────
    // aiTextCost = actual LLM spend (strategy + script)
    // videoCostEst = estimated voice/video provider spend (not double-counted)
    const aiTextCost   = (strategyResult.costUsd ?? 0) + (scriptResult.costUsd ?? 0);
    const voiceVideoCostEst = (() => {
      if (qualityMode === "fast")     return 0;
      if (qualityMode === "balanced") return 0.30;  // ElevenLabs ~$0.30 per voiceover
      const prov = provider ?? videoProviderForType(videoType);
      return prov === "veo3" ? 2.40 : 1.70;         // Veo3 vs Runway (net video cost only)
    })();
    const totalCost    = Math.round((aiTextCost + voiceVideoCostEst) * 10000) / 10000;

    // ── Save to growthmind_video_assets ────────────────────────────────────
    // has_audio = true when Veo 3+ is the provider and native audio was requested.
    // On the Gemini API path, Veo 3 always generates audio regardless; on Vertex AI it is user-controllable.
    const hasNativeAudio = provider === "veo3" && data.generateVeoAudio;

    const guidedInsertRow = {
      workspace_id:           workspaceId,
      title,
      video_type:             videoType,
      provider:               provider ?? null,
      script,
      storyboard,
      video_url:              videoUrl   ?? null,
      audio_url:              audioUrl   ?? null,
      voice_id:               data.voiceId ?? null,
      quality_mode:           qualityMode,
      cost_estimate:          totalCost,
      campaign_id:            data.campaignId ?? null,
      has_audio:              hasNativeAudio,
      knowledge_context_type: ctx.contextType,
      knowledge_context_id:   data.knowledgeContextId ?? null,
      knowledge_context_name: ctx.contextType !== "default" ? ctx.contextName : null,
      business_name:          ctx.companyName,
      created_at:             new Date().toISOString(),
    };

    const isMissingCol = (e: any) =>
      e?.code === "PGRST204" ||
      (typeof e?.message === "string" && e.message.includes("column") && e.message.includes("schema cache"));

    let guidedRes = await sb
      .from("growthmind_video_assets")
      .insert(guidedInsertRow)
      .select("id")
      .single();

    // Graceful fallback: strip knowledge_context columns if migration not yet applied
    if (guidedRes.error && isMissingCol(guidedRes.error)) {
      console.warn("[video-studio] knowledge_context columns not found — apply KNOWLEDGE_CONTEXT_VIDEO_MIGRATION.sql");
      const { knowledge_context_type: _kct, knowledge_context_id: _kci, knowledge_context_name: _kcn, business_name: _bn, ...rowNoCtx } = guidedInsertRow as any;
      guidedRes = await sb.from("growthmind_video_assets").insert(rowNoCtx).select("id").single();
    }
    // Graceful fallback: if has_audio column not yet migrated, retry without it
    if (guidedRes.error && isMissingCol(guidedRes.error)) {
      console.warn("[video-studio] has_audio column not found — apply VEO_AUDIO_FIX_MIGRATION.sql to track native audio status");
      const { has_audio: _flag, ...rowWithoutAudio } = guidedInsertRow as any;
      guidedRes = await sb
        .from("growthmind_video_assets")
        .insert(rowWithoutAudio)
        .select("id")
        .single();
    }

    const { data: inserted, error: insertErr } = guidedRes;

    if (insertErr) {
      const isTableMissing =
        insertErr.code === "PGRST205" ||
        (insertErr.message?.includes("relation") && insertErr.message?.includes("does not exist"));
      if (isTableMissing) {
        throw new Error(
          "Video Studio database table is not set up yet. " +
          "Apply the migration: supabase/migrations/20260704000000_growthmind_video_assets.sql " +
          "or run: node scripts/apply-video-studio-migration.mjs"
        );
      }
      throw new Error(insertErr.message);
    }

    // ── Log to growthmind_generation_logs ─────────────────────────────────
    // asset_id is left null: the FK references growthmind_content_assets, not
    // growthmind_video_assets. Video generation logs are identified by task_type prefix.
    sb.from("growthmind_generation_logs").insert({
      workspace_id:       workspaceId,
      asset_id:           null,
      task_type:          `video_${videoType}`,
      provider:           "claude",
      model:              "claude-sonnet-4-5",
      input_tokens:       strategyResult.inputTokens + scriptResult.inputTokens,
      output_tokens:      strategyResult.outputTokens + scriptResult.outputTokens,
      estimated_cost_usd: totalCost,
      status:             "success",
      fallback_from:      null,
      created_at:         new Date().toISOString(),
    }).then(() => {}).catch(() => {});

    return {
      assetId:    inserted.id as string,
      title,
      script,
      storyboard,
      audioUrl,
      videoUrl,
      provider,
      qualityMode,
      costEstimate: totalCost,
      strategyBrief: strategyResult.text,
      valuePointUsed: valuePoint || null,
    };
  });

// ── Multi-clip helpers ────────────────────────────────────────────────────────

function buildSceneVeoPrompt(scene: StoryboardScene): string {
  const parts: string[] = [];
  if (scene.visual)       parts.push(scene.visual);
  if (scene.onScreenText) parts.push(`Text: "${scene.onScreenText}"`);
  return parts.join(". ") || scene.voiceover || "professional brand video scene";
}

async function submitMultiClipJobs(
  sb:            any,
  assetId:       string,
  scenes:        StoryboardScene[],
  veoCfg:        VeoConfig,
  aspectRatio:   string,
  workspaceId:   string,
  generateAudio: boolean = true,
): Promise<void> {
  const MAX_CLIPS     = 12;
  const BASE_DELAY_MS = 3000;  // 3s between submissions — stays under Gemini 10 req/min quota
  const MAX_RETRIES   = 3;
  const RETRY_DELAY_MS = 15_000; // 15s backoff on 429

  const clipsToSubmit = scenes.slice(0, MAX_CLIPS);

  for (let idx = 0; idx < clipsToSubmit.length; idx++) {
    const scene        = clipsToSubmit[idx];
    const clipDuration = Math.min(scene.duration || 8, 8);
    const scenePrompt  = buildSceneVeoPrompt(scene);

    const { data: clip, error: clipErr } = await sb
      .from("growthmind_video_clips")
      .insert({
        workspace_id:    workspaceId,
        asset_id:        assetId,
        scene_index:     idx,
        scene_title:     (scene.visual || "").slice(0, 100),
        scene_prompt:    scenePrompt,
        duration_seconds: clipDuration,
        provider:        "veo3",
        status:          "pending",
      })
      .select("id")
      .single();

    if (clipErr || !clip) {
      console.error(`[multi-clip] Failed to insert clip ${idx}:`, clipErr?.message ?? "unknown");
      continue;
    }

    let submitted = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const veo    = new VeoProvider(veoCfg);
        const result = await veo.generateVideo({
          prompt:          scenePrompt,
          aspectRatio,
          durationSeconds: clipDuration,
          generateAudio,
        });
        await sb.from("growthmind_video_clips")
          .update({ provider_job_id: result.jobId, status: "processing", updated_at: new Date().toISOString() })
          .eq("id", clip.id);
        submitted = true;
        break;
      } catch (e: any) {
        const is429 = e?.message?.includes("429") || e?.message?.includes("RESOURCE_EXHAUSTED");
        if (is429 && attempt < MAX_RETRIES) {
          const wait = RETRY_DELAY_MS * (attempt + 1);
          console.warn(`[multi-clip] Clip ${idx} rate-limited (429) — retrying in ${wait / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, wait));
        } else {
          await sb.from("growthmind_video_clips")
            .update({ status: "failed", error_message: (e?.message ?? "Veo submission failed").slice(0, 500), updated_at: new Date().toISOString() })
            .eq("id", clip.id);
          break;
        }
      }
    }

    if (submitted && idx < clipsToSubmit.length - 1) {
      await new Promise(r => setTimeout(r, BASE_DELAY_MS));
    }
  }

  console.log(`[multi-clip] Dispatched ${clipsToSubmit.length} clip jobs for asset ${assetId}`);
}

// ── Generate video from free-form prompt ──────────────────────────────────────

const generateVideoFromPromptSchema = z.object({
  userPrompt:        z.string().min(5),
  businessGoal:      z.string().default(""),
  targetAudience:    z.string().default(""),
  platform:          z.enum(["meta", "tiktok", "linkedin", "youtube", "instagram", "general"]).default("meta"),
  videoLength:       z.number().int().min(5).max(120).default(20),
  aspectRatio:       z.enum(["16:9", "9:16", "1:1", "4:5"]).default("16:9"),
  brandStyle:        z.string().default(""),
  cta:               z.string().default(""),
  voiceoverNeeded:   z.boolean().default(true),
  preferredProvider: z.enum(["veo3", "runway_gen4", "kling", "pika"]).default("veo3"),
  voiceId:           z.string().default("21m00Tcm4TlvDq8ikWAM"),
  campaignId:        z.string().uuid().nullish(),
  variantGroupId:    z.string().uuid().nullish(),
  variantType:       z.string().nullish(),
  includeKb:            z.boolean().default(true),
  generateVeoAudio:     z.boolean().default(true),
  knowledgeContextType: z.enum(["default", "specific_kb", "custom_campaign", "none"]).default("default"),
  knowledgeContextId:   z.string().uuid().nullish(),
  knowledgeContextName: z.string().nullish(),
  customBusinessName:   z.string().default(""),
  customIndustry:       z.string().default(""),
  customOffer:          z.string().default(""),
  customBrandVoice:     z.string().default(""),
  customWebsite:        z.string().default(""),
  customCampaignGoal:   z.string().default(""),
});

export const generateVideoFromPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => generateVideoFromPromptSchema.parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    const settings    = (context as any).settings ?? {};
    if (!workspaceId) throw new Error("No workspace");

    // ── Pull business DNA context ────────────────────────────────────────────
    const [wsRes, seoRes, compRes, playbookRes, kbRes, vpRes2, oppRes2] = await Promise.all([
      sb.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle(),
      sb.from("growthmind_seo_sites").select("keywords").eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("growthmind_competitors").select("name, positioning")
        .eq("workspace_id", workspaceId).limit(10),
      sb.from("growthmind_playbooks").select("industry").eq("workspace_id", workspaceId)
        .eq("status", "active").maybeSingle(),
      Promise.resolve(sb.from("knowledge_bases").select("name, description").eq("workspace_id", workspaceId).limit(5)).catch(() => ({ data: [] })),
      Promise.resolve(sb.from("growthmind_value_points").select("current_highest_value,who_to_target,recommended_offer,best_channels").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle()).catch(() => ({ data: null })),
      Promise.resolve(sb.from("growthmind_opportunities").select("title,recommended_action,urgency").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle()).catch(() => ({ data: null })),
    ]);

    const ws          = wsRes.data;
    const wsSettings  = ws?.settings ?? {};
    const companyName = ws?.name ?? wsSettings.company_name ?? "";
    const industry    = wsSettings.industry ?? "";

    const keywords = ((seoRes.data?.keywords ?? []) as any[])
      .slice(0, 10).map((k: any) => `"${k.term}"`).join(", ") || "";

    const competitors = ((compRes.data ?? []) as any[])
      .map((c: any) => `${c.name}${c.positioning ? ` — ${c.positioning}` : ""}`)
      .join("; ") || "";

    const playbook  = playbookRes.data?.industry ?? "";
    const kbSummary = data.includeKb === false ? "" : ((kbRes.data ?? []) as any[])
      .map((k: any) => `${k.name}${k.description ? `: ${k.description}` : ""}`).join("; ") || "";

    const vp2 = vpRes2.data;
    const valuePoint2 = vp2
      ? [vp2.current_highest_value, vp2.who_to_target ? `Target: ${vp2.who_to_target}` : "", vp2.recommended_offer ? `Offer: ${vp2.recommended_offer}` : ""].filter(Boolean).join(" | ")
      : "";
    const opp2 = oppRes2.data;
    const topOpp2 = opp2 ? `${opp2.title}${opp2.recommended_action ? ` — ${opp2.recommended_action}` : ""}` : "";

    // ── Knowledge Context Resolution ──────────────────────────────────────────
    const ctx2 = await resolveVideoKnowledgeContext(sb, workspaceId, {
      knowledgeContextType: data.knowledgeContextType,
      knowledgeContextId:   data.knowledgeContextId,
      knowledgeContextName: data.knowledgeContextName,
      customBusinessName:   data.customBusinessName,
      customIndustry:       data.customIndustry,
      customOffer:          data.customOffer,
      customBrandVoice:     data.customBrandVoice,
      customWebsite:        data.customWebsite,
      customCampaignGoal:   data.customCampaignGoal,
      targetAudience:       data.targetAudience,
    }, { companyName, industry, kbSummary, docSummary: "" });

    // ── Run prompt optimisation engine ───────────────────────────────────────
    const engineResult = await optimiseVideoPrompt({
      userPrompt:     data.userPrompt,
      businessGoal:   data.businessGoal || data.customCampaignGoal,
      targetAudience: data.targetAudience,
      platform:       data.platform,
      videoLength:    data.videoLength,
      aspectRatio:    data.aspectRatio,
      brandStyle:     data.customBrandVoice || data.brandStyle,
      cta:            data.cta,
      voiceoverNeeded: data.voiceoverNeeded,
      companyName:    ctx2.companyName,
      industry:       ctx2.industry,
      keywords,
      competitors,
      playbook,
      kbSummary:      ctx2.kbSummary,
      valuePoint:     valuePoint2,
      topOpportunity: topOpp2,
      settings,
      workspaceId,
      sb,
    });

    // ── Resolve video provider credentials ───────────────────────────────────
    const veoSettingsRes = await sb.from("provider_settings")
      .select("credentials, status")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", "video")
      .eq("provider_name", "google_veo")
      .maybeSingle();

    const runwaySettingsRes = await sb.from("provider_settings")
      .select("credentials, status")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", "video")
      .eq("provider_name", "runway")
      .maybeSingle();

    const veoCreds   = (veoSettingsRes.data?.credentials ?? {}) as Record<string, string>;
    const runwayCreds = (runwaySettingsRes.data?.credentials ?? {}) as Record<string, string>;
    const runwayKey  = runwayCreds.apiKey?.trim() || process.env.RUNWAY_API_KEY || settings.runway_api_key || "";

    // ── Step: ElevenLabs voiceover (if needed) ───────────────────────────────
    let audioUrl: string | null = null;
    if (data.voiceoverNeeded) {
      const elKey = process.env.ELEVENLABS_API_KEY ?? settings.elevenlabs_api_key;
      if (elKey) {
        const voiceText = engineResult.voiceoverScript || engineResult.script;
        audioUrl = await generateVoiceover(voiceText, data.voiceId, elKey);
      }
    }

    // ── Step: Video generation ────────────────────────────────────────────────
    // Multi-clip path: when videoLength > 8s and multiple storyboard scenes exist,
    // each scene becomes its own Veo job (tracked in growthmind_video_clips).
    // Single-clip: combine all scenes into one 8s Veo generation (existing flow).
    const scenePrompts = engineResult.storyboard
      .map(s => s.veoPrompt).filter(Boolean).join(" | ");
    const masterPrompt = scenePrompts || engineResult.optimisedPrompt;

    let videoUrl: string | null = null;
    let provider: VideoProvider | null = null;
    let isCompositeVideo = false;

    const veoCfg      = resolveVeoConfig(veoCreds);
    const veoProvider = new VeoProvider(veoCfg);

    const useMultiClip =
      data.preferredProvider === "veo3" &&
      data.videoLength > 8 &&
      engineResult.storyboard.length > 1 &&
      veoProvider.authMode;

    if (useMultiClip) {
      videoUrl         = "[composite_pending]";
      provider         = "veo3";
      isCompositeVideo = true;
    } else if (data.preferredProvider === "runway_gen4" && runwayKey) {
      const runResult = await generateRunwayVideo(masterPrompt, runwayKey);
      if (runResult) { videoUrl = `[runway_job:${runResult}]`; provider = "runway_gen4"; }
    }

    if (!isCompositeVideo && !videoUrl) {
      if (veoProvider.authMode) {
        try {
          const veoResult = await veoProvider.generateVideo({
            prompt:          masterPrompt,
            aspectRatio:     data.aspectRatio,
            durationSeconds: Math.min(data.videoLength, 8),
            generateAudio:   data.generateVeoAudio,
          });
          videoUrl = `[veo3_job:${veoResult.jobId}]`;
          provider = "veo3";
        } catch (veoErr: any) {
          console.error("[video-studio] Veo 3 generation failed:", veoErr?.message ?? veoErr);
          videoUrl = `[error:Veo 3 error: ${(veoErr?.message ?? "unknown").slice(0, 200)}]`;
        }
      }
    }

    if (!isCompositeVideo && !videoUrl && runwayKey && data.preferredProvider !== "runway_gen4") {
      const runResult = await generateRunwayVideo(masterPrompt, runwayKey);
      if (runResult) { videoUrl = `[runway_job:${runResult}]`; provider = "runway_gen4"; }
    }

    // ── Cost estimate ─────────────────────────────────────────────────────────
    const aiTextCost = engineResult.costUsd ?? 0;
    const voiceCost  = data.voiceoverNeeded ? 0.30 : 0;
    const clipCount  = isCompositeVideo ? Math.min(engineResult.storyboard.length, 12) : 1;
    const videoCost  = provider === "veo3" ? 2.40 * clipCount : provider === "runway_gen4" ? 1.70 : 0;
    const totalCost  = Math.round((aiTextCost + voiceCost + videoCost) * 10000) / 10000;

    // Map OptimisedScene → StoryboardScene for DB storage
    const storyboard: StoryboardScene[] = engineResult.storyboard.map(s => ({
      scene:        s.scene,
      visual:       s.visual,
      voiceover:    s.voiceover,
      onScreenText: s.onScreenText,
      duration:     s.duration,
      cta:          s.cta,
    }));

    // ── Save to growthmind_video_assets ──────────────────────────────────────
    // Map platform to nearest VideoType
    const platformToType: Record<string, VideoType> = {
      meta:      "meta_video_ad",
      tiktok:    "tiktok_video",
      linkedin:  "linkedin_video",
      youtube:   "youtube_ad",
      instagram: "meta_video_ad",
      general:   "explainer_video",
    };
    const videoType = platformToType[data.platform] ?? "explainer_video";

    // has_audio = true when Veo 3+ is the provider and native audio was requested.
    const freeFormHasNativeAudio = provider === "veo3" && data.generateVeoAudio;

    const baseInsertRow = {
      workspace_id:               workspaceId,
      title:                      engineResult.title,
      video_type:                 videoType,
      provider:                   provider ?? null,
      script:                     engineResult.script,
      storyboard,
      video_url:                  videoUrl  ?? null,
      audio_url:                  audioUrl  ?? null,
      voice_id:                   data.voiceId ?? null,
      quality_mode:               "premium",
      cost_estimate:              totalCost,
      original_prompt:            data.userPrompt,
      optimized_prompt:           engineResult.optimisedPrompt,
      generation_mode:            "freeform",
      platform:                   data.platform,
      aspect_ratio:               data.aspectRatio,
      quality_checks:             JSON.stringify(engineResult.qualityChecks),
      campaign_id:                data.campaignId      ?? null,
      variant_group_id:           data.variantGroupId  ?? null,
      variant_type:               data.variantType     ?? null,
      has_audio:                  freeFormHasNativeAudio,
      knowledge_context_type:     ctx2.contextType,
      knowledge_context_id:       data.knowledgeContextId ?? null,
      knowledge_context_name:     ctx2.contextType !== "default" ? ctx2.contextName : null,
      business_name:              ctx2.companyName,
      created_at:                 new Date().toISOString(),
    };
    const multiClipFields = {
      is_composite:               isCompositeVideo,
      assembly_status:            isCompositeVideo ? "clips_generating" : null,
      requested_duration_seconds: data.videoLength,
    };

    let firstRes = await sb
      .from("growthmind_video_assets")
      .insert({ ...baseInsertRow, ...multiClipFields })
      .select("id")
      .single();

    // Graceful fallback: if multi-clip columns don't exist yet (migration pending),
    // retry without them so single-clip generation still works.
    const isMissingColumn = (e: any) =>
      e?.code === "PGRST204" ||
      (typeof e?.message === "string" && e.message.includes("column") && e.message.includes("schema cache"));

    if (firstRes.error && isMissingColumn(firstRes.error)) {
      console.warn("[video-studio] Multi-clip columns not found — retrying without them (apply MULTI_CLIP_VIDEO_MIGRATION.sql to enable multi-clip)");
      isCompositeVideo = false;
      firstRes = await sb
        .from("growthmind_video_assets")
        .insert(baseInsertRow)
        .select("id")
        .single();
    }

    // Graceful fallback: strip knowledge_context columns if migration not yet applied
    if (firstRes.error && isMissingColumn(firstRes.error)) {
      console.warn("[video-studio] knowledge_context columns not found — apply KNOWLEDGE_CONTEXT_VIDEO_MIGRATION.sql");
      const { knowledge_context_type: _kct, knowledge_context_id: _kci, knowledge_context_name: _kcn, business_name: _bn, ...rowNoCtx } = baseInsertRow as any;
      firstRes = await sb.from("growthmind_video_assets").insert(rowNoCtx).select("id").single();
    }

    // Second-level fallback: if has_audio column not yet migrated, strip it and retry
    if (firstRes.error && isMissingColumn(firstRes.error)) {
      console.warn("[video-studio] has_audio column not found — apply VEO_AUDIO_FIX_MIGRATION.sql to track native audio status");
      const { has_audio: _flag, ...rowWithoutAudio } = baseInsertRow as any;
      firstRes = await sb
        .from("growthmind_video_assets")
        .insert(rowWithoutAudio)
        .select("id")
        .single();
    }

    const { data: inserted, error: insertErr } = firstRes;

    if (insertErr) {
      const isTableMissing =
        insertErr.code === "PGRST205" ||
        (insertErr.message?.includes("relation") && insertErr.message?.includes("does not exist"));
      if (isTableMissing) {
        throw new Error(
          "Video Studio database migration not applied yet. " +
          "Run VIDEO_STUDIO_FREEFORM_MIGRATION.sql in Supabase SQL Editor.",
        );
      }
      throw new Error(insertErr.message);
    }

    sb.from("growthmind_generation_logs").insert({
      workspace_id:       workspaceId,
      asset_id:           null,
      task_type:          `video_freeform_${data.platform}`,
      provider:           "claude",
      model:              "claude-sonnet-4-5",
      input_tokens:       0,
      output_tokens:      0,
      estimated_cost_usd: totalCost,
      status:             "success",
      fallback_from:      null,
      created_at:         new Date().toISOString(),
    }).then(() => {}).catch(() => {});

    // Dispatch multi-clip jobs (fire-and-forget — clips reference the inserted asset ID)
    if (isCompositeVideo && inserted?.id) {
      submitMultiClipJobs(
        sb, inserted.id as string, storyboard, veoCfg, data.aspectRatio, workspaceId, data.generateVeoAudio,
      ).catch((e: any) => {
        console.error("[video-studio] Multi-clip dispatch error:", e?.message ?? e);
      });
    }

    return {
      assetId:          inserted.id as string,
      title:            engineResult.title,
      script:           engineResult.script,
      storyboard,
      audioUrl,
      videoUrl,
      provider,
      qualityMode:      "premium" as QualityMode,
      costEstimate:     totalCost,
      marketingAngle:   engineResult.marketingAngle,
      hook:             engineResult.hook,
      cta:              engineResult.cta,
      optimisedPrompt:  engineResult.optimisedPrompt,
      qualityChecks:    engineResult.qualityChecks,
      allChecksPassed:  engineResult.allChecksPassed,
      strategyBrief:    engineResult.marketingAngle,
      isComposite:      isCompositeVideo,
      clipCount:        isCompositeVideo ? clipCount : 1,
    };
  });

// ── Get video assets ──────────────────────────────────────────────────────────

export const getVideoAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      videoType: z.string().nullish(),
      limit:     z.number().int().min(1).max(200).default(100),
    }).parse(input ?? {})
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    let q = sb
      .from("growthmind_video_assets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.videoType) q = q.eq("video_type", data.videoType);

    const { data: rows, error } = await q;
    if (error) {
      const isTableMissing =
        error.code === "PGRST205" ||
        (error.message?.includes("relation") && error.message?.includes("does not exist"));
      if (isTableMissing) return { assets: [] };
      throw new Error(error.message);
    }

    const assets: VideoAsset[] = (rows ?? []).map((r: any) => {
      // Data URIs can be 20-80 MB of base64 — never ship them in the list.
      // Replace with a stable marker so the card knows to lazy-fetch the real URL.
      const rawUrl: string | null = r.video_url ?? null;
      const videoUrl = rawUrl?.startsWith("data:video/") ? "__data_uri__" : rawUrl;

      return {
        id:               r.id,
        title:            r.title,
        videoType:        r.video_type as VideoType,
        provider:         r.provider   ?? null,
        script:           r.script     ?? "",
        storyboard:       Array.isArray(r.storyboard) ? r.storyboard : [],
        videoUrl,
        audioUrl:         r.audio_url  ?? null,
        voiceId:          r.voice_id   ?? null,
        qualityMode:      r.quality_mode as QualityMode,
        costEstimate:     r.cost_estimate ?? 0,
        scheduledAt:      r.scheduled_at ?? null,
        createdAt:        r.created_at,
        campaignId:       r.campaign_id      ?? null,
        variantGroupId:   r.variant_group_id ?? null,
        variantType:      r.variant_type     ?? null,
        creativeScore:    r.creative_score   ?? null,
        isComposite:      r.is_composite     ?? false,
        assemblyStatus:   r.assembly_status  ?? null,
        assemblyError:    r.assembly_error   ?? null,
        finalVideoUrl:    r.final_video_url  ?? null,
        requestedDuration:    r.requested_duration_seconds ?? null,
        hasNativeAudio:       r.has_audio                 ?? null,
        knowledgeContextType: r.knowledge_context_type   ?? null,
        knowledgeContextName: r.knowledge_context_name   ?? null,
        businessName:         r.business_name             ?? null,
      };
    });

    return { assets };
  });

// ── Delete video asset ────────────────────────────────────────────────────────

export const deleteVideoAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_video_assets")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Score video creative ──────────────────────────────────────────────────────

export type CreativeScore = {
  hook:         number;
  clarity:      number;
  emotion:      number;
  cta:          number;
  brand:        number;
  platform:     number;
  overall:      number;
  verdict:      string;
  improvements: string[];
};

export const scoreVideoCreative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      assetId: z.string().uuid(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: asset } = await sb
      .from("growthmind_video_assets")
      .select("title,script,storyboard,video_type,platform")
      .eq("id", data.assetId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!asset) throw new Error("Asset not found");

    const { routeGenerate } = await import(/* @vite-ignore */ "./model-router.server");
    const storyboardText = Array.isArray(asset.storyboard)
      ? asset.storyboard.map((s: any) => `Scene ${s.scene}: ${s.visual}. VO: ${s.voiceover}`).join("\n")
      : "";

    const result = await routeGenerate({
      system: `You are a senior creative director scoring a marketing video. Score each dimension 1-10.
Return ONLY valid JSON:
{
  "hook":         <1-10>,
  "clarity":      <1-10>,
  "emotion":      <1-10>,
  "cta":          <1-10>,
  "brand":        <1-10>,
  "platform":     <1-10>,
  "verdict":      "one sentence overall verdict",
  "improvements": ["up to 3 specific improvements"]
}`,
      user: `Score this ${asset.video_type} video:\n\nTitle: ${asset.title}\nScript: ${asset.script}\n\nStoryboard:\n${storyboardText}`,
      contentType: "analysis",
    });

    let scores: CreativeScore;
    try {
      const raw = result.text.replace(/```json\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(raw);
      const avg = ["hook","clarity","emotion","cta","brand","platform"]
        .reduce((sum, k) => sum + (Number(parsed[k]) || 5), 0) / 6;
      scores = {
        hook:         Number(parsed.hook)     || 5,
        clarity:      Number(parsed.clarity)  || 5,
        emotion:      Number(parsed.emotion)  || 5,
        cta:          Number(parsed.cta)      || 5,
        brand:        Number(parsed.brand)    || 5,
        platform:     Number(parsed.platform) || 5,
        overall:      Math.round(avg * 10) / 10,
        verdict:      parsed.verdict   ?? "",
        improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
      };
    } catch {
      scores = { hook: 5, clarity: 5, emotion: 5, cta: 5, brand: 5, platform: 5, overall: 5, verdict: "Unable to score", improvements: [] };
    }

    await sb
      .from("growthmind_video_assets")
      .update({ creative_score: scores.overall })
      .eq("id", data.assetId)
      .eq("workspace_id", workspaceId);

    return { score: scores };
  });

// ── Generate video variants ───────────────────────────────────────────────────

export const generateVideoVariants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      campaignId:  z.string().uuid().nullish(),
      videoType:   z.string().min(1),
      qualityMode: z.enum(["fast", "balanced", "premium"]),
      targetAudience: z.string().default(""),
      offer:       z.string().default(""),
      tone:        z.string().default("professional"),
      cta:         z.string().default(""),
      voiceId:     z.string().default("21m00Tcm4TlvDq8ikWAM"),
      count:       z.union([z.literal(1), z.literal(3), z.literal(5)]).default(3),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const variantGroupId = crypto.randomUUID();
    const VARIANT_ANGLES = [
      { type: "hook_emotion",    label: "Emotional Hook" },
      { type: "hook_curiosity",  label: "Curiosity Hook" },
      { type: "hook_social",     label: "Social Proof Hook" },
      { type: "hook_urgency",    label: "Urgency Hook" },
      { type: "hook_question",   label: "Question Hook" },
    ] as const;

    const selected = VARIANT_ANGLES.slice(0, data.count);

    const results = await Promise.allSettled(
      selected.map(async (angle) => {
        const [wsRes, vpRes] = await Promise.all([
          sb.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle(),
          Promise.resolve(sb.from("growthmind_value_points").select("current_highest_value,who_to_target,recommended_offer").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle()).catch(() => ({ data: null })),
        ]);

        const ws          = wsRes.data;
        const wsSettings  = ws?.settings ?? {};
        const companyName = ws?.name ?? wsSettings.company_name ?? "";

        const vp = vpRes.data;
        const valuePoint = vp ? vp.current_highest_value ?? "" : "";

        const { routeGenerate } = await import(/* @vite-ignore */ "./model-router.server");
        const strategy = await routeGenerate({
          system: `You are an expert video strategist. Create a ${angle.label} variant strategy for a ${data.videoType} video for ${companyName}. Focus on the hook style: ${angle.type}. ${valuePoint ? `Lead with this value point: ${valuePoint}` : ""}`,
          user:   `Target: ${data.targetAudience || "ideal customer"}\nOffer: ${data.offer || "our product"}\nTone: ${data.tone}\nCTA: ${data.cta || "Contact us"}`,
          contentType: "strategy",
        });

        const script = await routeGenerate({
          system: `You are an expert video scriptwriter creating a ${angle.label} variant. Hook style: ${angle.type}. Strategy: ${strategy.text}`,
          user:   `Write a complete video script for this ${data.videoType}. Include hook, body, CTA. Target: ${data.targetAudience}. Offer: ${data.offer}.`,
          contentType: "script",
        });

        const storyboard = [{
          scene: 1, visual: `${angle.label} opening shot`, voiceover: script.text.slice(0, 80),
          onScreenText: angle.label, duration: 5, cta: data.cta || "Learn more",
        }];

        const { data: inserted } = await sb
          .from("growthmind_video_assets")
          .insert({
            workspace_id:     workspaceId,
            title:            `${data.videoType} — ${angle.label}`,
            video_type:       data.videoType,
            provider:         null,
            script:           script.text,
            storyboard,
            quality_mode:     data.qualityMode,
            cost_estimate:    (strategy.inputTokens + strategy.outputTokens + script.inputTokens + script.outputTokens) * 0.000003,
            campaign_id:      data.campaignId ?? null,
            variant_group_id: variantGroupId,
            variant_type:     angle.type,
            created_at:       new Date().toISOString(),
          })
          .select("id")
          .single();

        return { id: inserted?.id, variantType: angle.type, label: angle.label };
      })
    );

    const succeeded = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
      .map(r => r.value);

    return { variantGroupId, count: succeeded.length, variants: succeeded };
  });

// ── Schedule video asset to content calendar ──────────────────────────────────

export const scheduleVideoAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      assetId:       z.string().uuid(),
      scheduledDate: z.string(),
      channel:       z.string().default(""),
      notes:         z.string().default(""),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: asset } = await sb
      .from("growthmind_video_assets")
      .select("title, video_type")
      .eq("id", data.assetId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!asset) throw new Error("Asset not found");

    const calendarContentType = "Video Script";

    const { data: inserted, error } = await sb
      .from("growthmind_content_calendar")
      .insert({
        workspace_id:   workspaceId,
        title:          asset.title,
        content_type:   calendarContentType,
        channel:        data.channel || "Video",
        status:         "Scheduled",
        scheduled_date: data.scheduledDate,
        description:    `Video Studio asset — ${VIDEO_TYPE_LABELS[asset.video_type as VideoType] ?? asset.video_type}`,
        notes:          data.notes,
        updated_at:     new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    await sb
      .from("growthmind_video_assets")
      .update({ scheduled_at: data.scheduledDate })
      .eq("id", data.assetId)
      .eq("workspace_id", workspaceId);

    return { ok: true, calendarEntryId: inserted.id as string };
  });

// ── Video cost panel stats ────────────────────────────────────────────────────

export const getVideoCostStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const s30 = new Date(); s30.setDate(s30.getDate() - 30);

    const { data: assets } = await sb
      .from("growthmind_video_assets")
      .select("cost_estimate, quality_mode, video_type, provider, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", s30.toISOString());

    const rows = assets ?? [];

    // cost_estimate per asset = aiTextCost + voiceVideoCostEst (no double-counting needed)
    const totalCost = rows.reduce((s: number, r: any) => s + (r.cost_estimate ?? 0), 0);

    // ElevenLabs: balanced + premium modes include a voice generation (~$0.30 each)
    const elCount = rows.filter((r: any) => r.quality_mode === "balanced" || r.quality_mode === "premium").length;
    const elCost  = elCount * 0.30;

    // Video generation: only premium assets with a real provider
    const videoPremiumRows = rows.filter((r: any) => r.quality_mode === "premium");
    const veo3Count    = videoPremiumRows.filter((r: any) => !r.provider || r.provider === "veo3").length;
    const runwayCount  = videoPremiumRows.filter((r: any) => r.provider === "runway_gen4").length;
    const videoCost    = veo3Count * 2.40 + runwayCount * 1.70;

    // AI text cost = totalCost minus estimated voice/video cost
    const aiTextCost = Math.max(0, totalCost - elCost - videoCost);

    // Storage estimate: ~1 MB per voiceover (audio), ~50 MB per premium video job
    const storageEstimateMb = elCount * 1 + videoPremiumRows.length * 50;
    const storageCostUsd    = storageEstimateMb * 0.000023; // AWS S3 ~$0.023/GB

    // Profit margin: assume 3× markup on total cost
    const estimatedRevenue = totalCost * 3;
    const profitMargin     = totalCost > 0 ? Math.round(((estimatedRevenue - totalCost) / estimatedRevenue) * 100) : 0;

    const byProvider: Record<string, { count: number; cost: number }> = {};
    for (const a of rows) {
      const prov = (a.provider as string) ?? "text_only";
      if (!byProvider[prov]) byProvider[prov] = { count: 0, cost: 0 };
      byProvider[prov].count++;
      byProvider[prov].cost += a.cost_estimate ?? 0;
    }

    const byQuality: Record<string, number> = {};
    for (const a of rows) {
      byQuality[a.quality_mode] = (byQuality[a.quality_mode] ?? 0) + 1;
    }

    const totalAssets = rows.length;

    return {
      totalAssets,
      totalCost:         Math.round(totalCost * 10000) / 10000,
      aiTextCost:        Math.round(aiTextCost * 10000) / 10000,
      elLabsCost:        Math.round(elCost * 10000) / 10000,
      elLabsCount:       elCount,
      videoCost:         Math.round(videoCost * 10000) / 10000,
      veo3Count,
      runwayCount,
      storageMb:         Math.round(storageEstimateMb),
      storageCostUsd:    Math.round(storageCostUsd * 10000) / 10000,
      profitMarginPct:   profitMargin,
      estimatedRevenue:  Math.round(estimatedRevenue * 10000) / 10000,
      byProvider,
      byQuality,
    };
  });

// ── Retry a failed video job ───────────────────────────────────────────────────

export const retryVideoJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    const settings    = (context as any).settings ?? {};
    if (!workspaceId) throw new Error("No workspace");

    const { data: asset, error: fetchErr } = await sb
      .from("growthmind_video_assets")
      .select("*")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (fetchErr || !asset) throw new Error("Asset not found");

    const storyboard: StoryboardScene[] = Array.isArray(asset.storyboard) ? asset.storyboard : [];

    // Load credentials from provider_settings (same path as generateVideo)
    const [veoSettingsRes, runwaySettingsRes] = await Promise.all([
      sb.from("provider_settings")
        .select("credentials")
        .eq("workspace_id", workspaceId)
        .eq("provider_category", "video")
        .eq("provider_name", "google_veo")
        .maybeSingle(),
      sb.from("provider_settings")
        .select("credentials")
        .eq("workspace_id", workspaceId)
        .eq("provider_category", "video")
        .eq("provider_name", "runway")
        .maybeSingle(),
    ]);

    const ws = await sb.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle();
    const companyName = ws.data?.name ?? ws.data?.settings?.company_name ?? "";

    const veoCreds   = (veoSettingsRes.data?.credentials   ?? {}) as Record<string, string>;
    const runwayCreds= (runwaySettingsRes.data?.credentials ?? {}) as Record<string, string>;
    const runwayKey  = runwayCreds.apiKey?.trim() || process.env.RUNWAY_API_KEY || "";

    // Build a full prompt from ALL storyboard scenes
    const visualPrompt = buildFullVeoPrompt(storyboard, {
      companyName,
      tone:      "professional",
      videoType: asset.video_type as VideoType,
    }) || `${storyboard[0]?.visual ?? asset.title ?? "promotional video"}. Brand: ${companyName}`;

    let newVideoUrl: string | null = null;
    let newProvider: VideoProvider | null = (asset.provider as VideoProvider) ?? null;

    const primaryProvider = newProvider ?? videoProviderForType(asset.video_type as VideoType);

    if (primaryProvider === "runway_gen4" && runwayKey) {
      const runResult = await generateRunwayVideo(visualPrompt, runwayKey);
      if (runResult) { newVideoUrl = `[runway_job:${runResult}]`; newProvider = "runway_gen4"; }
    }

    if (!newVideoUrl) {
      const veo = new VeoProvider(resolveVeoConfig(veoCreds));
      if (veo.authMode) {
        const veoResult = await veo.generateVideo({ prompt: visualPrompt });
        if (veoResult.status === "pending") { newVideoUrl = `[veo3_job:${veoResult.jobId}]`; newProvider = "veo3"; }
      }
    }

    if (!newVideoUrl && runwayKey) {
      const runResult = await generateRunwayVideo(visualPrompt, runwayKey);
      if (runResult) { newVideoUrl = `[runway_job:${runResult}]`; newProvider = "runway_gen4"; }
    }

    if (!newVideoUrl) throw new Error("No video provider credentials available for retry — add Gemini API Key or Runway Key in Settings → Providers");

    const { error: updateErr } = await sb
      .from("growthmind_video_assets")
      .update({ video_url: newVideoUrl, provider: newProvider })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (updateErr) throw new Error(updateErr.message);

    return { ok: true, videoUrl: newVideoUrl, provider: newProvider };
  });

// ── Poll a single video job (called on-demand from the UI) ────────────────────

export const pollVideoJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    const settings    = (context as any).settings ?? {};
    if (!workspaceId) throw new Error("No workspace");

    const { data: asset, error: fetchErr } = await sb
      .from("growthmind_video_assets")
      .select("id, video_url, provider")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (fetchErr || !asset) return { status: "not_found" as const };

    const videoUrl: string | null = asset.video_url ?? null;

    if (!isJobPending(videoUrl)) {
      return { status: "not_pending" as const, videoUrl };
    }

    const job = parseJobSentinel(videoUrl);
    if (!job) return { status: "not_pending" as const, videoUrl };

    // Load credentials from provider_settings (same canonical path as generateVideo)
    const [pollVeoRes, pollRunwayRes] = await Promise.all([
      sb.from("provider_settings")
        .select("credentials")
        .eq("workspace_id", workspaceId)
        .eq("provider_category", "video")
        .eq("provider_name", "google_veo")
        .maybeSingle(),
      sb.from("provider_settings")
        .select("credentials")
        .eq("workspace_id", workspaceId)
        .eq("provider_category", "video")
        .eq("provider_name", "runway")
        .maybeSingle(),
    ]);

    const pollVeoCreds  = (pollVeoRes.data?.credentials   ?? {}) as Record<string, string>;
    const pollRunwayCreds= (pollRunwayRes.data?.credentials ?? {}) as Record<string, string>;
    const runwayKey     = pollRunwayCreds.apiKey?.trim() || process.env.RUNWAY_API_KEY || "";

    let pollResult:
      | { done: false }
      | { done: true; videoUrl: string }
      | { done: true; error: string };

    if (job.type === "veo3") {
      const veo = new VeoProvider(resolveVeoConfig(pollVeoCreds));
      if (!veo.authMode) return { status: "pending" as const, videoUrl };
      const veoStatus = await veo.getStatus(job.jobId);
      if (veoStatus.status === "processing") {
        pollResult = { done: false };
      } else if (veoStatus.status === "completed") {
        pollResult = { done: true, videoUrl: veoStatus.videoUrl };
      } else {
        pollResult = { done: true, error: veoStatus.error ?? "Veo generation failed" };
      }
    } else {
      if (!runwayKey) return { status: "pending" as const, videoUrl };
      pollResult = await pollRunwayJobFn(job.jobId, runwayKey);
    }

    if (!pollResult.done) return { status: "pending" as const, videoUrl };

    let newUrl: string;

    if ("videoUrl" in pollResult) {
      // Archive to permanent Supabase Storage before saving — same path as runVideoJobPoller.
      // Use service-role client so storage writes bypass RLS (user-scoped client can't upload).
      const archiveSb = createClient(
        process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "",
      );
      const veoCfgForArchive = resolveVeoConfig(pollVeoCreds);
      const accessToken  = veoCfgForArchive.accessToken  ?? "";
      const geminiApiKey = veoCfgForArchive.geminiApiKey ?? "";
      const archived = await archiveVideoToStorage(
        archiveSb,
        pollResult.videoUrl,
        workspaceId,
        data.id,
        accessToken,
        geminiApiKey,
      );

      // If archive returned a raw gs:// (no access token available), mark as failed with
      // a clear, actionable message instead of storing an unplayable GCS URI.
      if (archived.startsWith("gs://")) {
        newUrl = `[error:Veo returned a Google Cloud Storage URI but no access token is configured to download it. ` +
          `Add Vertex AI credentials (GCP Project + Access Token) in Settings → Providers → Video → Google Veo 3, ` +
          `then retry this video.]`;
      } else {
        newUrl = archived;
      }
    } else {
      newUrl = `[error:${"error" in pollResult ? pollResult.error : "Generation failed"}]`;
    }

    const { error: updateErr } = await sb
      .from("growthmind_video_assets")
      .update({ video_url: newUrl })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (updateErr) {
      throw new Error(`Failed to persist video result: ${updateErr.message}`);
    }

    return {
      status: (newUrl.startsWith("[error:") ? "failed" : "resolved") as "resolved" | "failed",
      videoUrl: newUrl,
    };
  });

// ── Bulk-delete unrecoverable video assets ─────────────────────────────────────
// Deletes all assets whose video_url is an [error:…] sentinel (never had a real
// Veo job) or a raw gs:// URI (unplayable without credentials). Safe: skips
// any asset that has a real HTTPS/Supabase URL or a pending job sentinel.

export const clearFailedVideoAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: rows, error: fetchErr } = await sb
      .from("growthmind_video_assets")
      .select("id, video_url")
      .eq("workspace_id", workspaceId);

    if (fetchErr) throw new Error(fetchErr.message);

    const toDelete: string[] = (rows ?? [])
      .filter((r: any) => {
        const u: string = r.video_url ?? "";
        return u.startsWith("[error:") || u.startsWith("gs://");
      })
      .map((r: any) => r.id);

    if (toDelete.length === 0) return { deleted: 0 };

    const { error: delErr } = await sb
      .from("growthmind_video_assets")
      .delete()
      .in("id", toDelete)
      .eq("workspace_id", workspaceId);

    if (delErr) throw new Error(delErr.message);

    return { deleted: toDelete.length };
  });

// ── Get a usable download URL for a GCS-hosted video ─────────────────────────
// Veo 3 returns gs://bucket/path URIs. This server fn converts them to an
// authenticated HTTPS download URL the browser can fetch/open directly.

export const getVideoDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    const settings    = (context as any).settings ?? {};
    if (!workspaceId) throw new Error("No workspace");

    const { data: asset, error: fetchErr } = await sb
      .from("growthmind_video_assets")
      .select("video_url, title")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (fetchErr || !asset) throw new Error("Asset not found");

    const videoUrl: string = asset.video_url ?? "";

    if (!videoUrl.startsWith("gs://")) {
      return { downloadUrl: videoUrl };
    }

    // Parse gs://bucket/object
    const withoutScheme = videoUrl.slice("gs://".length);
    const slashIdx      = withoutScheme.indexOf("/");
    if (slashIdx === -1) throw new Error("Invalid GCS URI format");

    const bucket = withoutScheme.slice(0, slashIdx);
    const object = withoutScheme.slice(slashIdx + 1);

    const accessToken = process.env.GOOGLE_CLOUD_ACCESS_TOKEN ?? settings.google_cloud_access_token ?? "";

    if (!accessToken) {
      // No credentials — return the raw GCS URI so the caller can show it
      return { downloadUrl: null, gcsUri: videoUrl };
    }

    // GCS JSON API media download URL — valid while the access token is alive
    const encodedObject = encodeURIComponent(object);
    const downloadUrl   = `https://storage.googleapis.com/download/storage/v1/b/${bucket}/o/${encodedObject}?alt=media`;

    // Verify accessibility with a HEAD request before handing URL to client
    try {
      const probe = await fetch(downloadUrl, {
        method:  "HEAD",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!probe.ok) {
        return { downloadUrl: null, gcsUri: videoUrl, error: `GCS returned ${probe.status}` };
      }
    } catch {
      return { downloadUrl: null, gcsUri: videoUrl, error: "Could not reach GCS" };
    }

    // Return the URL + token so the client can open it.
    // Note: access tokens are short-lived (~1 h) and user-scoped — acceptable here.
    return { downloadUrl: `${downloadUrl}&access_token=${encodeURIComponent(accessToken)}` };
  });

// ── Provider poll helpers (mirrored from video-job-poller for server fn use) ──

async function pollVeo3JobFn(
  operationName: string,
  accessToken:   string,
): Promise<{ done: false } | { done: true; videoUrl: string } | { done: true; error: string }> {
  try {
    const res = await fetch(
      `https://us-central1-aiplatform.googleapis.com/v1/${operationName}`,
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { done: true, error: `Veo 3 poll HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = await res.json() as any;
    if (json.error) return { done: true, error: json.error.message ?? JSON.stringify(json.error).slice(0, 200) };
    if (!json.done) return { done: false };
    const predictions = json.response?.predictions ?? [];
    for (const pred of predictions) {
      if (typeof pred === "string" && (pred.startsWith("http") || pred.startsWith("gs://"))) return { done: true, videoUrl: pred };
      const uri = pred?.videoUri ?? pred?.gcsUri ?? pred?.uri ?? pred?.url;
      if (typeof uri === "string") return { done: true, videoUrl: uri };
      if (pred?.bytesBase64Encoded) return { done: true, videoUrl: `data:video/mp4;base64,${pred.bytesBase64Encoded}` };
    }
    return { done: true, error: "Veo 3 completed but no video URL found in response" };
  } catch (e: any) {
    return { done: true, error: `Veo 3 poll exception: ${e?.message ?? String(e)}` };
  }
}

async function pollRunwayJobFn(
  taskId:    string,
  runwayKey: string,
): Promise<{ done: false } | { done: true; videoUrl: string } | { done: true; error: string }> {
  try {
    const res = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${runwayKey}`, "X-Runway-Version": "2024-11-06" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { done: true, error: `Runway poll HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = await res.json() as any;
    const status: string = json.status ?? "";
    if (status === "PENDING" || status === "THROTTLED" || status === "RUNNING") return { done: false };
    if (status === "FAILED" || status === "CANCELLED") {
      return { done: true, error: json.failure ?? json.failureCode ?? `Runway task ${status.toLowerCase()}` };
    }
    if (status === "SUCCEEDED") {
      const output = json.output;
      const url = Array.isArray(output) ? output[0] : (typeof output === "string" ? output : null);
      if (url) return { done: true, videoUrl: url };
      return { done: true, error: "Runway succeeded but output URL missing" };
    }
    return { done: false };
  } catch (e: any) {
    return { done: true, error: `Runway poll exception: ${e?.message ?? String(e)}` };
  }
}

// ── HiveMind video summary ────────────────────────────────────────────────────

export async function getVideoSummaryForHiveMind(
  sb:          any,
  workspaceId: string,
): Promise<{
  totalThisMonth:  number;
  upcomingScheduled: number;
  missingTypes:    string[];
  byType:          Record<string, number>;
}> {
  try {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const today = new Date().toISOString();

    const [assetsRes, scheduledRes] = await Promise.all([
      sb.from("growthmind_video_assets")
        .select("video_type, created_at, scheduled_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", monthStart.toISOString())
        .limit(500),
      sb.from("growthmind_content_calendar")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("content_type", "Video Script")
        .gte("scheduled_date", today)
        .limit(50),
    ]);

    const assets   = assetsRes.data   ?? [];
    const scheduled = scheduledRes.data ?? [];

    const allVideoTypes: VideoType[] = [
      "meta_video_ad", "explainer_video", "ugc_ad", "product_demo", "testimonial_video",
    ];

    const byType: Record<string, number> = {};
    for (const a of assets) {
      const label = VIDEO_TYPE_LABELS[a.video_type as VideoType] ?? a.video_type;
      byType[label] = (byType[label] ?? 0) + 1;
    }

    const coveredTypes = new Set(assets.map((a: any) => a.video_type as VideoType));
    const missingTypes = allVideoTypes
      .filter(t => !coveredTypes.has(t))
      .map(t => VIDEO_TYPE_LABELS[t]);

    return {
      totalThisMonth:    assets.length,
      upcomingScheduled: scheduled.length,
      missingTypes,
      byType,
    };
  } catch {
    return { totalThisMonth: 0, upcomingScheduled: 0, missingTypes: [], byType: {} };
  }
}

// ── Veo connection status ────────────────────────────────────────────────────
export const getVeoStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) return { connected: false };

    // Use supabaseAdmin (service role) to bypass RLS — credentials are server-side secrets
    const { data } = await (supabaseAdmin as any)
      .from("provider_settings")
      .select("credentials")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", "video")
      .eq("provider_name", "google_veo")
      .maybeSingle();

    const creds = data?.credentials ?? {};
    const hasGeminiKey =
      !!(creds.geminiApiKey?.trim()) || !!(process.env.GEMINI_API_KEY);
    const hasVertexCreds =
      !!(creds.gcpProject?.trim()) &&
      (!!(creds.accessToken?.trim()) || !!(creds.refreshToken?.trim()));

    // Resolve the effective model (mirrors VeoProvider.model getter logic)
    const storedModel    = creds.veoModel?.trim() || process.env.VEO_MODEL || "";
    const effectiveModel = storedModel || "veo-3.0-generate-preview";
    const audioCapable   = isAudioCapableModel(effectiveModel);

    return {
      connected: hasGeminiKey || hasVertexCreds,
      hasGeminiKey,
      hasVertexCreds,
      veoModel:  effectiveModel,
      audioCapable,
    };
  });

// ── Get clips for a composite video asset ─────────────────────────────────────

export const getVideoClips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ assetId: z.string().uuid() }).parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: rows, error } = await Promise.resolve(
      sb.from("growthmind_video_clips")
        .select("*")
        .eq("asset_id", data.assetId)
        .eq("workspace_id", workspaceId)
        .order("scene_index", { ascending: true })
    ).catch((e: any) => ({ data: null, error: e }));

    if (error) {
      const isTableMissing =
        error.code === "PGRST205" ||
        (error.message?.includes("relation") && error.message?.includes("does not exist"));
      if (isTableMissing) return { clips: [] };
      throw new Error(error.message);
    }

    const clips: VideoClip[] = (rows ?? []).map((r: any) => ({
      id:               r.id,
      workspaceId:      r.workspace_id,
      assetId:          r.asset_id,
      sceneIndex:       r.scene_index,
      sceneTitle:       r.scene_title   ?? null,
      scenePrompt:      r.scene_prompt  ?? null,
      durationSeconds:  r.duration_seconds ?? null,
      provider:         r.provider      ?? null,
      providerJobId:    r.provider_job_id ?? null,
      status:           r.status        as VideoClip["status"],
      rawVideoUrl:      r.raw_video_url ?? null,
      archivedVideoUrl: r.archived_video_url ?? null,
      errorMessage:     r.error_message ?? null,
      createdAt:        r.created_at,
    }));

    return { clips };
  });

// ── Manually trigger assembly for a composite video ───────────────────────────

export const triggerVideoAssembly = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ assetId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Verify ownership
    const { data: asset } = await Promise.resolve(
      sb.from("growthmind_video_assets")
        .select("id, assembly_status, is_composite")
        .eq("id", data.assetId)
        .eq("workspace_id", workspaceId)
        .maybeSingle()
    ).catch(() => ({ data: null }));

    if (!asset) throw new Error("Asset not found");
    if (!asset.is_composite) throw new Error("Asset is not a composite video");
    if (asset.assembly_status === "assembling") throw new Error("Assembly already in progress");

    // Import and run assembly (service-role client already in sb)
    const { assembleCompositeVideo } = await import(/* @vite-ignore */ "./video-assembly.server");
    const result = await assembleCompositeVideo(sb, data.assetId, workspaceId);

    return result;
  });
