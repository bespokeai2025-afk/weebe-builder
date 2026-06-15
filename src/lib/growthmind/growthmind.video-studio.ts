import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { routeGenerate } from "./model-router.server";
import {
  parseJobSentinel, isJobPending,
} from "./video-job-poller";
import { optimiseVideoPrompt } from "./video-prompt-engine.server";
import { VeoProvider, resolveVeoConfig } from "@/lib/video/providers/veo.provider";

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
  id:           string;
  title:        string;
  videoType:    VideoType;
  provider:     VideoProvider | null;
  script:       string;
  storyboard:   StoryboardScene[];
  videoUrl:     string | null;
  audioUrl:     string | null;
  voiceId:      string | null;
  qualityMode:  QualityMode;
  costEstimate: number;
  scheduledAt:  string | null;
  createdAt:    string;
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

// ── Veo 3 video generation ─────────────────────────────────────────────────────

async function generateVeo3Video(
  prompt:      string,
  credentials: { gcpProject?: string; accessToken?: string },
): Promise<string | null> {
  try {
    const projectId   = credentials.gcpProject?.trim()   || process.env.GOOGLE_CLOUD_PROJECT   || "";
    const accessToken = credentials.accessToken?.trim()  || process.env.GOOGLE_CLOUD_ACCESS_TOKEN || "";
    if (!projectId || !accessToken) return null;

    const endpoint =
      `https://us-central1-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
      `/locations/us-central1/publishers/google/models/veo-3.0-generate-preview:predictLongRunning`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances:  [{ prompt }],
        parameters: { aspectRatio: "16:9", durationSeconds: 8, sampleCount: 1 },
      }),
    });

    if (!res.ok) return null;
    const json = await res.json() as any;
    return json?.name ?? null;
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
    const res = await fetch("https://api.dev.runwayml.com/v1/image_to_video", {
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

// ── Build generation prompts ──────────────────────────────────────────────────

function buildVideoPrompts(params: {
  videoType:      VideoType;
  companyName:    string;
  industry:       string;
  targetAudience: string;
  offer:          string;
  tone:           string;
  cta:            string;
  keywords:       string;
  competitors:    string;
  playbook:       string;
  kbSummary:      string;
  docSummary:     string;
  qualityMode:    QualityMode;
}): { strategySystem: string; strategyUser: string; scriptSystem: string; scriptUser: string } {
  const label = VIDEO_TYPE_LABELS[params.videoType];

  const kbContext = [
    params.kbSummary  ? `## Knowledge Bases\n${params.kbSummary}` : "",
    params.docSummary ? `## Company Documents\n${params.docSummary}` : "",
  ].filter(Boolean).join("\n\n");

  const strategySystem = `You are GrowthMind Video Studio, an expert AI marketing strategist specialising in video content.

## Company Context
Business: ${params.companyName || "the business"}
Industry: ${params.industry || "not specified"}
SEO Keywords: ${params.keywords || "None tracked"}
Competitors: ${params.competitors || "None tracked"}
${params.playbook ? `Active Playbook: ${params.playbook}` : ""}
${kbContext}

## Your Role
Generate a concise video strategy brief (3-5 sentences) for a ${label}. Focus on unique angle, differentiation, and primary message. Output only the brief, no headings.`;

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
  videoType:     z.string().min(1),
  qualityMode:   z.enum(["fast", "balanced", "premium"]),
  targetAudience: z.string().default(""),
  offer:         z.string().default(""),
  tone:          z.string().default("professional"),
  cta:           z.string().default(""),
  voiceId:       z.string().default("21m00Tcm4TlvDq8ikWAM"),
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
    const [wsRes, seoRes, compRes, playbookRes, kbRes, docsRes] = await Promise.all([
      sb.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle(),
      sb.from("growthmind_seo_sites").select("keywords").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("growthmind_competitors").select("name, positioning").eq("workspace_id", workspaceId).limit(10),
      sb.from("growthmind_playbooks").select("industry").eq("workspace_id", workspaceId).eq("status", "active").maybeSingle(),
      Promise.resolve(sb.from("knowledge_bases").select("name, description").eq("workspace_id", workspaceId).limit(5)).catch(() => ({ data: [] })),
      Promise.resolve(sb.from("documents").select("name, content").eq("workspace_id", workspaceId).limit(3)).catch(() => ({ data: [] })),
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

    const kbSummary = ((kbRes.data ?? []) as any[])
      .map((k: any) => `${k.name}${k.description ? `: ${k.description}` : ""}`)
      .join("; ") || "";

    const docSummary = ((docsRes.data ?? []) as any[])
      .map((d: any) => {
        const excerpt = typeof d.content === "string" ? d.content.slice(0, 300) : "";
        return `${d.name}${excerpt ? `: ${excerpt}` : ""}`;
      })
      .join("\n") || "";

    const prompts = buildVideoPrompts({
      videoType, companyName, industry, keywords, competitors, playbook,
      kbSummary, docSummary,
      targetAudience: data.targetAudience,
      offer:          data.offer,
      tone:           data.tone,
      cta:            data.cta,
      qualityMode,
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
          .maybeSingle()
          .catch(() => ({ data: null })),
        sb.from("provider_settings")
          .select("credentials, status")
          .eq("workspace_id", workspaceId)
          .eq("provider_category", "video")
          .eq("provider_name", "runway")
          .maybeSingle()
          .catch(() => ({ data: null })),
      ]);

      const veoCreds = (veoSettingsRes.data?.credentials ?? {}) as Record<string, string>;
      const runwayCreds = (runwaySettingsRes.data?.credentials ?? {}) as Record<string, string>;
      const runwayKey = runwayCreds.apiKey?.trim() || process.env.RUNWAY_API_KEY || settings.runway_api_key || "";

      const visualPrompt = [
        storyboard[0]?.visual ?? "",
        `Style: ${data.tone ?? "professional"}, brand: ${companyName}`,
      ].filter(Boolean).join(". ");

      if (primaryProvider === "runway_gen4") {
        // UGC / Testimonial → Runway Gen-4
        if (runwayKey) {
          const runResult = await generateRunwayVideo(visualPrompt, runwayKey);
          if (runResult) { videoUrl = `[runway_job:${runResult}]`; provider = "runway_gen4"; }
        }
        // Fallback to Veo 3 if Runway failed or no key
        if (!videoUrl) {
          const veoResult = await generateVeo3Video(visualPrompt, veoCreds);
          if (veoResult) { videoUrl = `[veo3_job:${veoResult}]`; provider = "veo3"; }
        }
      } else {
        // All other types → Veo 3 primary
        const veoResult = await generateVeo3Video(visualPrompt, veoCreds);
        if (veoResult) { videoUrl = `[veo3_job:${veoResult}]`; provider = "veo3"; }
        // Fallback to Runway Gen-4 if Veo 3 failed or missing credentials
        if (!videoUrl && runwayKey) {
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
    const { data: inserted, error: insertErr } = await sb
      .from("growthmind_video_assets")
      .insert({
        workspace_id:  workspaceId,
        title,
        video_type:    videoType,
        provider:      provider ?? null,
        script,
        storyboard,
        video_url:     videoUrl   ?? null,
        audio_url:     audioUrl   ?? null,
        voice_id:      data.voiceId ?? null,
        quality_mode:  qualityMode,
        cost_estimate: totalCost,
        created_at:    new Date().toISOString(),
      })
      .select("id")
      .single();

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
    };
  });

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
    const [wsRes, seoRes, compRes, playbookRes, kbRes] = await Promise.all([
      sb.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle(),
      sb.from("growthmind_seo_sites").select("keywords").eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("growthmind_competitors").select("name, positioning")
        .eq("workspace_id", workspaceId).limit(10),
      sb.from("growthmind_playbooks").select("industry").eq("workspace_id", workspaceId)
        .eq("status", "active").maybeSingle(),
      sb.from("knowledge_bases").select("name, description").eq("workspace_id", workspaceId)
        .limit(5).catch(() => ({ data: [] })),
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
    const kbSummary = ((kbRes.data ?? []) as any[])
      .map((k: any) => `${k.name}${k.description ? `: ${k.description}` : ""}`).join("; ") || "";

    // ── Run prompt optimisation engine ───────────────────────────────────────
    const engineResult = await optimiseVideoPrompt({
      userPrompt:     data.userPrompt,
      businessGoal:   data.businessGoal,
      targetAudience: data.targetAudience,
      platform:       data.platform,
      videoLength:    data.videoLength,
      aspectRatio:    data.aspectRatio,
      brandStyle:     data.brandStyle,
      cta:            data.cta,
      voiceoverNeeded: data.voiceoverNeeded,
      companyName,
      industry,
      keywords,
      competitors,
      playbook,
      kbSummary,
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
      .maybeSingle()
      .catch(() => ({ data: null }));

    const runwaySettingsRes = await sb.from("provider_settings")
      .select("credentials, status")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", "video")
      .eq("provider_name", "runway")
      .maybeSingle()
      .catch(() => ({ data: null }));

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

    // ── Step: Video generation ───────────────────────────────────────────────
    // Use the per-scene veoPrompts joined together for a richer generation prompt;
    // fall back to the master optimisedPrompt.
    const scenePrompts = engineResult.storyboard
      .map(s => s.veoPrompt).filter(Boolean).join(" | ");
    const masterPrompt = scenePrompts || engineResult.optimisedPrompt;

    let videoUrl: string | null = null;
    let provider: VideoProvider | null = null;

    if (data.preferredProvider === "runway_gen4" && runwayKey) {
      const runResult = await generateRunwayVideo(masterPrompt, runwayKey);
      if (runResult) { videoUrl = `[runway_job:${runResult}]`; provider = "runway_gen4"; }
    }

    if (!videoUrl) {
      // Try Gemini API key path first, then fall back to OAuth token path
      const veoCfg = resolveVeoConfig(veoCreds);
      const veoProvider = new VeoProvider(veoCfg);

      if (veoProvider.authMode) {
        try {
          const veoResult = await veoProvider.generateVideo({
            prompt:          masterPrompt,
            aspectRatio:     data.aspectRatio,
            durationSeconds: Math.min(data.videoLength, 8),
          });
          videoUrl = `[veo3_job:${veoResult.jobId}]`;
          provider = "veo3";
        } catch {
          // Fall back to legacy adapter
          const veoResult = await generateVeo3Video(masterPrompt, veoCreds);
          if (veoResult) { videoUrl = `[veo3_job:${veoResult}]`; provider = "veo3"; }
        }
      } else {
        const veoResult = await generateVeo3Video(masterPrompt, veoCreds);
        if (veoResult) { videoUrl = `[veo3_job:${veoResult}]`; provider = "veo3"; }
      }
    }

    if (!videoUrl && runwayKey && data.preferredProvider !== "runway_gen4") {
      const runResult = await generateRunwayVideo(masterPrompt, runwayKey);
      if (runResult) { videoUrl = `[runway_job:${runResult}]`; provider = "runway_gen4"; }
    }

    // ── Cost estimate ────────────────────────────────────────────────────────
    const aiTextCost = engineResult.costUsd ?? 0;
    const voiceCost  = data.voiceoverNeeded ? 0.30 : 0;
    const videoCost  = provider === "veo3" ? 2.40 : provider === "runway_gen4" ? 1.70 : 0;
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

    const { data: inserted, error: insertErr } = await sb
      .from("growthmind_video_assets")
      .insert({
        workspace_id:     workspaceId,
        title:            engineResult.title,
        video_type:       videoType,
        provider:         provider ?? null,
        script:           engineResult.script,
        storyboard,
        video_url:        videoUrl  ?? null,
        audio_url:        audioUrl  ?? null,
        voice_id:         data.voiceId ?? null,
        quality_mode:     "premium",
        cost_estimate:    totalCost,
        original_prompt:  data.userPrompt,
        optimized_prompt: engineResult.optimisedPrompt,
        generation_mode:  "freeform",
        platform:         data.platform,
        aspect_ratio:     data.aspectRatio,
        quality_checks:   JSON.stringify(engineResult.qualityChecks),
        created_at:       new Date().toISOString(),
      })
      .select("id")
      .single();

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

    const assets: VideoAsset[] = (rows ?? []).map((r: any) => ({
      id:           r.id,
      title:        r.title,
      videoType:    r.video_type as VideoType,
      provider:     r.provider   ?? null,
      script:       r.script     ?? "",
      storyboard:   Array.isArray(r.storyboard) ? r.storyboard : [],
      videoUrl:     r.video_url  ?? null,
      audioUrl:     r.audio_url  ?? null,
      voiceId:      r.voice_id   ?? null,
      qualityMode:  r.quality_mode as QualityMode,
      costEstimate: r.cost_estimate ?? 0,
      scheduledAt:  r.scheduled_at ?? null,
      createdAt:    r.created_at,
    }));

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
    const ws = await sb.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle();
    const companyName = ws.data?.name ?? ws.data?.settings?.company_name ?? "";
    const tone = "professional";

    const visualPrompt = [
      storyboard[0]?.visual ?? "",
      `Style: ${tone}, brand: ${companyName}`,
    ].filter(Boolean).join(". ") || (asset.title ?? "promotional video");

    const runwayKey = process.env.RUNWAY_API_KEY ?? settings.runway_api_key ?? "";
    let newVideoUrl: string | null = null;
    let newProvider: VideoProvider | null = asset.provider ?? null;

    if (newProvider === "runway_gen4" || (!newProvider && runwayKey)) {
      if (runwayKey) {
        const runResult = await generateRunwayVideo(visualPrompt, runwayKey);
        if (runResult) { newVideoUrl = `[runway_job:${runResult}]`; newProvider = "runway_gen4"; }
      }
    }

    if (!newVideoUrl) {
      const veoResult = await generateVeo3Video(visualPrompt, "");
      if (veoResult) { newVideoUrl = `[veo3_job:${veoResult}]`; newProvider = "veo3"; }
    }

    if (!newVideoUrl && runwayKey) {
      const runResult = await generateRunwayVideo(visualPrompt, runwayKey);
      if (runResult) { newVideoUrl = `[runway_job:${runResult}]`; newProvider = "runway_gen4"; }
    }

    if (!newVideoUrl) throw new Error("No video provider credentials available for retry");

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

    const accessToken = process.env.GOOGLE_CLOUD_ACCESS_TOKEN ?? settings.google_cloud_access_token ?? "";
    const runwayKey   = process.env.RUNWAY_API_KEY ?? settings.runway_api_key ?? "";

    let pollResult:
      | { done: false }
      | { done: true; videoUrl: string }
      | { done: true; error: string };

    if (job.type === "veo3") {
      if (!accessToken) return { status: "pending" as const, videoUrl };
      pollResult = await pollVeo3JobFn(job.jobId, accessToken);
    } else {
      if (!runwayKey) return { status: "pending" as const, videoUrl };
      pollResult = await pollRunwayJobFn(job.jobId, runwayKey);
    }

    if (!pollResult.done) return { status: "pending" as const, videoUrl };

    const newUrl = "videoUrl" in pollResult
      ? pollResult.videoUrl
      : `[error:${"error" in pollResult ? pollResult.error : "Generation failed"}]`;

    const { error: updateErr } = await sb
      .from("growthmind_video_assets")
      .update({ video_url: newUrl })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (updateErr) {
      throw new Error(`Failed to persist video result: ${updateErr.message}`);
    }

    return {
      status: ("videoUrl" in pollResult ? "resolved" : "failed") as "resolved" | "failed",
      videoUrl: newUrl,
    };
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
