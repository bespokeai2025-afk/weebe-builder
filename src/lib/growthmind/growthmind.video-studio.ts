import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { routeGenerate } from "./model-router.server";

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
// NOTE: Veo 3 is accessed via Google Cloud Vertex AI. API will return a job ID
// and the video URL is polled. For now we return null and log appropriately.

async function generateVeo3Video(
  prompt:   string,
  _apiKey:  string,
): Promise<string | null> {
  try {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    const accessToken = process.env.GOOGLE_CLOUD_ACCESS_TOKEN;
    if (!projectId || !accessToken) return null;

    const endpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/veo-3.0-generate-preview:predictLongRunning`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { aspectRatio: "16:9", durationSeconds: 8 },
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
      const runwayKey = process.env.RUNWAY_API_KEY ?? settings.runway_api_key ?? "";

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
          const veoResult = await generateVeo3Video(visualPrompt, "");
          if (veoResult) { videoUrl = `[veo3_job:${veoResult}]`; provider = "veo3"; }
        }
      } else {
        // All other types → Veo 3 primary
        const veoResult = await generateVeo3Video(visualPrompt, "");
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

    if (insertErr) throw new Error(insertErr.message);

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
    if (error) throw new Error(error.message);

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
