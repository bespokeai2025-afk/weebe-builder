import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createImageProvider, type ImageConfig } from "@/lib/providers/image";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AssetType = "ad_creative" | "social_image" | "product_image" | "blog_image" | "hero_image" | "variation" | "edit";
export type PlatformHint = "meta" | "instagram" | "linkedin" | "tiktok" | "google" | "generic";
export type KnowledgeContextType = "default" | "specific_kb" | "custom_campaign" | "none";

export interface ImageAsset {
  id: string;
  workspace_id: string;
  campaign_id: string | null;
  strategy_id: string | null;
  content_asset_id: string | null;
  provider: string;
  prompt: string;
  revised_prompt: string | null;
  image_url: string;
  thumbnail_url: string | null;
  status: "generating" | "ready" | "failed" | "deleted";
  error_message: string | null;
  knowledge_context_type: string;
  knowledge_context_id: string | null;
  business_name: string | null;
  asset_type: AssetType;
  platform_hint: PlatformHint;
  width: number | null;
  height: number | null;
  style: string | null;
  parent_asset_id: string | null;
  cost_usd: number;
  created_at: string;
  updated_at: string;
}

export interface ImageStudioStatus {
  connected: boolean;
  providerName: string;
  displayName: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveImageProvider(workspaceId: string): Promise<{ config: ImageConfig; displayName: string } | null> {
  const sb = supabaseAdmin as any;

  const { data: ps } = await sb
    .from("provider_settings")
    .select("provider_name, credentials, status")
    .eq("workspace_id", workspaceId)
    .eq("provider_category", "image")
    .in("status", ["connected"])
    .order("priority", { ascending: true })
    .limit(5);

  for (const row of (ps ?? [])) {
    const c = row.credentials ?? {};
    if (row.provider_name === "gpt_image" && c.apiKey) {
      return { config: { provider: "gpt_image", apiKey: c.apiKey }, displayName: "GPT Image" };
    }
    if (row.provider_name === "imagen" && c.gcpProject && c.accessToken) {
      return { config: { provider: "imagen", gcpProject: c.gcpProject, accessToken: c.accessToken }, displayName: "Google Imagen" };
    }
  }

  const { data: ws } = await sb
    .from("workspace_settings")
    .select("openai_api_key")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const openaiKey = (ws as any)?.openai_api_key || process.env.OPENAI_API_KEY || "";
  if (openaiKey) {
    return { config: { provider: "gpt_image", apiKey: openaiKey }, displayName: "GPT Image" };
  }

  return null;
}

async function buildBusinessContext(workspaceId: string, contextType: KnowledgeContextType, kbId?: string, customContext?: string): Promise<string> {
  if (contextType === "none") return "";

  const sb = supabaseAdmin as any;

  const [wsRes, dnaRes] = await Promise.all([
    sb.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle(),
    Promise.resolve(sb.from("growthmind_business_dna").select("business_summary, target_audience, usp, tone_of_voice, primary_color, secondary_color, brand_personality").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle()).catch(() => ({ data: null })),
  ]);

  const ws = wsRes.data as any;
  const dna = dnaRes.data as any;
  const parts: string[] = [];

  if (ws?.name) parts.push(`Business: ${ws.name}`);
  if (dna?.business_summary) parts.push(`About: ${dna.business_summary}`);
  if (dna?.target_audience) parts.push(`Target audience: ${dna.target_audience}`);
  if (dna?.usp) parts.push(`USP: ${dna.usp}`);
  if (dna?.tone_of_voice) parts.push(`Brand tone: ${dna.tone_of_voice}`);
  if (dna?.primary_color) parts.push(`Brand colour: ${dna.primary_color}`);

  if (contextType === "specific_kb" && kbId) {
    const { data: docs } = await Promise.resolve(sb.from("documents").select("content").eq("knowledge_base_id", kbId).limit(3)).catch(() => ({ data: [] }));
    const kbText = (docs ?? []).map((d: any) => d.content ?? "").join("\n").slice(0, 600);
    if (kbText) parts.push(`Knowledge base context: ${kbText}`);
  }

  if (contextType === "custom_campaign" && customContext) {
    parts.push(`Campaign context: ${customContext}`);
  }

  return parts.join("\n");
}

function buildImagePrompt(
  userPrompt: string,
  assetType: AssetType,
  platformHint: PlatformHint,
  businessContext: string,
): string {
  const assetDescriptions: Record<AssetType, string> = {
    ad_creative: "advertising creative image for digital ads",
    social_image: "social media image optimised for engagement",
    product_image: "product showcase image",
    blog_image: "blog header illustration",
    hero_image: "landing page hero image",
    variation: "image variation",
    edit: "edited image",
  };

  const platformSpecs: Record<PlatformHint, string> = {
    meta: "Facebook/Instagram ad format, 1:1 or 4:5 ratio, high impact visuals",
    instagram: "Instagram-optimised square or portrait, vibrant and eye-catching",
    linkedin: "LinkedIn professional format, clean and corporate",
    tiktok: "TikTok vertical 9:16 format, bold and dynamic",
    google: "Google Display Network banner, clear CTA area",
    generic: "versatile digital format",
  };

  const parts = [
    `Professional ${assetDescriptions[assetType]}.`,
    userPrompt,
    businessContext ? `Context: ${businessContext.slice(0, 400)}` : "",
    `Platform: ${platformSpecs[platformHint]}.`,
    "High quality, photorealistic or professional illustration style, no text overlays unless specified, clean composition.",
  ].filter(Boolean);

  return parts.join(" ");
}

// ── Server Functions ───────────────────────────────────────────────────────────

export const getImageStudioStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ImageStudioStatus> => {
    const { workspaceId } = context;
    const resolved = await resolveImageProvider(workspaceId);
    return {
      connected: !!resolved,
      providerName: resolved?.config.provider ?? "",
      displayName: resolved?.displayName ?? "",
    };
  });

export const generateImageAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    data: {
      prompt: string;
      assetType: AssetType;
      platformHint: PlatformHint;
      knowledgeContextType: KnowledgeContextType;
      knowledgeContextId?: string;
      customContext?: string;
      campaignId?: string;
      contentAssetId?: string;
      width?: number;
      height?: number;
      style?: string;
    };
  }) => d)
  .handler(async ({ data, context }): Promise<ImageAsset> => {
    const { workspaceId } = context;
    const input = data.data;
    const sb = supabaseAdmin as any;

    const resolved = await resolveImageProvider(workspaceId);
    if (!resolved) throw new Error("No image provider connected. Add an OpenAI API key in Settings → Providers → Image Generation.");

    const businessContext = await buildBusinessContext(workspaceId, input.knowledgeContextType, input.knowledgeContextId, input.customContext);
    const fullPrompt = buildImagePrompt(input.prompt, input.assetType, input.platformHint, businessContext);

    const wsRes = await sb.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
    const businessName = (wsRes.data as any)?.name ?? null;

    const { data: insertedRow, error: insertErr } = await sb
      .from("growthmind_image_assets")
      .insert({
        workspace_id: workspaceId,
        campaign_id: input.campaignId ?? null,
        content_asset_id: input.contentAssetId ?? null,
        provider: resolved.config.provider,
        prompt: fullPrompt,
        status: "generating",
        knowledge_context_type: input.knowledgeContextType,
        knowledge_context_id: input.knowledgeContextId ?? null,
        business_name: businessName,
        asset_type: input.assetType,
        platform_hint: input.platformHint,
        width: input.width ?? null,
        height: input.height ?? null,
        style: input.style ?? null,
      })
      .select()
      .single();

    if (insertErr || !insertedRow) throw new Error(`Failed to create image asset record: ${insertErr?.message}`);

    try {
      const provider = createImageProvider({ ...resolved.config, workspaceId });
      const result = await provider.generate({ prompt: fullPrompt, width: input.width, height: input.height, style: input.style });

      const imageUrl = result.images[0]?.url ?? "";
      if (!imageUrl) throw new Error("No image URL returned from provider");

      const { data: updated, error: updateErr } = await sb
        .from("growthmind_image_assets")
        .update({
          image_url: imageUrl,
          revised_prompt: result.revisedPrompt ?? null,
          status: "ready",
          updated_at: new Date().toISOString(),
        })
        .eq("id", (insertedRow as any).id)
        .select()
        .single();

      if (updateErr) throw new Error(`Failed to update asset: ${updateErr.message}`);
      return updated as ImageAsset;
    } catch (err: any) {
      await sb.from("growthmind_image_assets")
        .update({ status: "failed", error_message: err?.message ?? "Unknown error", updated_at: new Date().toISOString() })
        .eq("id", (insertedRow as any).id);
      throw err;
    }
  });

export const editImageAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { data: { assetId: string; editInstruction: string } }) => d)
  .handler(async ({ data, context }): Promise<ImageAsset> => {
    const { workspaceId } = context;
    const { assetId, editInstruction } = data.data;
    const sb = supabaseAdmin as any;

    const { data: original } = await sb
      .from("growthmind_image_assets")
      .select()
      .eq("id", assetId)
      .eq("workspace_id", workspaceId)
      .single();
    if (!original) throw new Error("Asset not found");

    const resolved = await resolveImageProvider(workspaceId);
    if (!resolved) throw new Error("No image provider connected.");

    const { data: newRow } = await sb
      .from("growthmind_image_assets")
      .insert({
        workspace_id: workspaceId,
        campaign_id: (original as any).campaign_id,
        content_asset_id: (original as any).content_asset_id,
        provider: resolved.config.provider,
        prompt: editInstruction,
        status: "generating",
        knowledge_context_type: (original as any).knowledge_context_type,
        knowledge_context_id: (original as any).knowledge_context_id,
        business_name: (original as any).business_name,
        asset_type: "edit" as AssetType,
        platform_hint: (original as any).platform_hint,
        parent_asset_id: assetId,
      })
      .select().single();

    try {
      const provider = createImageProvider({ ...resolved.config, workspaceId });
      if (!provider.edit) throw new Error("Edit not supported by this provider");
      const result = await provider.edit({ originalPrompt: (original as any).prompt, editInstruction });
      const imageUrl = result.images[0]?.url ?? "";

      const { data: updated } = await sb
        .from("growthmind_image_assets")
        .update({ image_url: imageUrl, revised_prompt: result.revisedPrompt ?? null, status: "ready", updated_at: new Date().toISOString() })
        .eq("id", (newRow as any).id)
        .select().single();
      return updated as ImageAsset;
    } catch (err: any) {
      await sb.from("growthmind_image_assets")
        .update({ status: "failed", error_message: err?.message ?? "Unknown error", updated_at: new Date().toISOString() })
        .eq("id", (newRow as any).id);
      throw err;
    }
  });

export const createImageVariation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { data: { assetId: string; variationHint?: string } }) => d)
  .handler(async ({ data, context }): Promise<ImageAsset> => {
    const { workspaceId } = context;
    const { assetId, variationHint } = data.data;
    const sb = supabaseAdmin as any;

    const { data: original } = await sb
      .from("growthmind_image_assets")
      .select()
      .eq("id", assetId)
      .eq("workspace_id", workspaceId)
      .single();
    if (!original) throw new Error("Asset not found");

    const resolved = await resolveImageProvider(workspaceId);
    if (!resolved) throw new Error("No image provider connected.");

    const { data: newRow } = await sb
      .from("growthmind_image_assets")
      .insert({
        workspace_id: workspaceId,
        campaign_id: (original as any).campaign_id,
        content_asset_id: (original as any).content_asset_id,
        provider: resolved.config.provider,
        prompt: (original as any).prompt,
        status: "generating",
        knowledge_context_type: (original as any).knowledge_context_type,
        knowledge_context_id: (original as any).knowledge_context_id,
        business_name: (original as any).business_name,
        asset_type: "variation" as AssetType,
        platform_hint: (original as any).platform_hint,
        parent_asset_id: assetId,
      })
      .select().single();

    try {
      const provider = createImageProvider({ ...resolved.config, workspaceId });
      if (!provider.createVariation) throw new Error("Variation not supported by this provider");
      const result = await provider.createVariation({ originalPrompt: (original as any).prompt, variationHint });
      const imageUrl = result.images[0]?.url ?? "";

      const { data: updated } = await sb
        .from("growthmind_image_assets")
        .update({ image_url: imageUrl, revised_prompt: result.revisedPrompt ?? null, status: "ready", updated_at: new Date().toISOString() })
        .eq("id", (newRow as any).id)
        .select().single();
      return updated as ImageAsset;
    } catch (err: any) {
      await sb.from("growthmind_image_assets")
        .update({ status: "failed", error_message: err?.message ?? "Unknown error", updated_at: new Date().toISOString() })
        .eq("id", (newRow as any).id);
      throw err;
    }
  });

export const listImageAssets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    data: {
      campaignId?: string;
      contentAssetId?: string;
      assetType?: AssetType;
      platformHint?: PlatformHint;
      provider?: string;
      limit?: number;
      offset?: number;
    };
  }) => d)
  .handler(async ({ data, context }): Promise<{ assets: ImageAsset[]; total: number }> => {
    const { workspaceId } = context;
    const input = data.data;
    const sb = supabaseAdmin as any;

    let q = sb
      .from("growthmind_image_assets")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .neq("status", "deleted")
      .order("created_at", { ascending: false });

    if (input.campaignId)    q = q.eq("campaign_id", input.campaignId);
    if (input.contentAssetId) q = q.eq("content_asset_id", input.contentAssetId);
    if (input.assetType)     q = q.eq("asset_type", input.assetType);
    if (input.platformHint)  q = q.eq("platform_hint", input.platformHint);
    if (input.provider)      q = q.eq("provider", input.provider);

    q = q.range(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 40) - 1);

    const { data: rows, count } = await q;
    return { assets: (rows ?? []) as ImageAsset[], total: count ?? 0 };
  });

export const attachImageToCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { data: { assetId: string; campaignDraftId: string } }) => d)
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { workspaceId } = context;
    const { assetId, campaignDraftId } = data.data;
    const sb = supabaseAdmin as any;

    await sb
      .from("growthmind_image_assets")
      .update({ campaign_id: campaignDraftId, updated_at: new Date().toISOString() })
      .eq("id", assetId)
      .eq("workspace_id", workspaceId);

    const { data: draft } = await sb
      .from("growthmind_campaign_drafts")
      .select("ad_structure")
      .eq("id", campaignDraftId)
      .eq("workspace_id", workspaceId)
      .single();

    const adStructure = (draft as any)?.ad_structure ?? {};
    const existing: string[] = adStructure.image_asset_ids ?? [];
    if (!existing.includes(assetId)) {
      await sb
        .from("growthmind_campaign_drafts")
        .update({ ad_structure: { ...adStructure, image_asset_ids: [...existing, assetId] } })
        .eq("id", campaignDraftId)
        .eq("workspace_id", workspaceId);
    }

    return { ok: true };
  });

export const attachImageToContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { data: { assetId: string; contentCalendarId: string } }) => d)
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { workspaceId } = context;
    const { assetId, contentCalendarId } = data.data;
    const sb = supabaseAdmin as any;

    await sb
      .from("growthmind_image_assets")
      .update({ content_asset_id: contentCalendarId, updated_at: new Date().toISOString() })
      .eq("id", assetId)
      .eq("workspace_id", workspaceId);

    await sb
      .from("growthmind_content_calendar")
      .update({ image_asset_id: assetId })
      .eq("id", contentCalendarId)
      .eq("workspace_id", workspaceId);

    return { ok: true };
  });

export const deleteImageAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { data: { assetId: string } }) => d)
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { workspaceId } = context;
    const sb = supabaseAdmin as any;
    await sb
      .from("growthmind_image_assets")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", data.data.assetId)
      .eq("workspace_id", workspaceId);
    return { ok: true };
  });

export const listCampaignDraftsForPicker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Array<{ id: string; name: string; campaign_type: string }>> => {
    const sb = supabaseAdmin as any;
    const { data } = await sb
      .from("growthmind_campaign_drafts")
      .select("id, name, campaign_type")
      .eq("workspace_id", context.workspaceId)
      .neq("status", "rejected")
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []) as Array<{ id: string; name: string; campaign_type: string }>;
  });
