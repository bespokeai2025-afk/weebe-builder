import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContentType =
  | "blog_article" | "landing_page" | "google_ad" | "meta_ad"
  | "linkedin_post" | "facebook_post" | "instagram_caption" | "x_post"
  | "email_campaign" | "whatsapp_campaign" | "lead_magnet" | "case_study"
  | "video_script" | "vsl_script" | "podcast_script" | "ai_call_script"
  | "follow_up_sequence" | "review_request_campaign" | "referral_campaign"
  | "sales_letter";

export type ContentStatus = "draft" | "published" | "archived";

export type SeoData = {
  primaryKeyword:        string;
  secondaryKeywords:     string[];
  metaTitle:             string;
  metaDescription:       string;
  suggestedHeadings:     string[];
  suggestedInternalLinks: string[];
  seoScore:              number;
};

export type ContentAsset = {
  id:           string;
  folderId:     string | null;
  title:        string;
  contentType:  ContentType;
  content:      string;
  brief:        Record<string, string>;
  seoData:      Partial<SeoData>;
  status:       ContentStatus;
  isFavourite:  boolean;
  scheduledAt:  string | null;
  createdAt:    string;
  updatedAt:    string;
};

export type ContentFolder = {
  id:        string;
  name:      string;
  icon:      string;
  assetCount: number;
  createdAt: string;
};

export type ContentBrief = {
  contentType:   ContentType;
  businessType:  string;
  targetAudience: string;
  offer:         string;
  goal:          string;
  keyword:       string;
  location:      string;
  platform:      string;
  tone:          string;
  cta:           string;
  campaignType:  string;
  length:        string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  blog_article:            "Blog Article",
  landing_page:            "Landing Page",
  google_ad:               "Google Ad",
  meta_ad:                 "Meta Ad",
  linkedin_post:           "LinkedIn Post",
  facebook_post:           "Facebook Post",
  instagram_caption:       "Instagram Caption",
  x_post:                  "X Post",
  email_campaign:          "Email Campaign",
  whatsapp_campaign:       "WhatsApp Campaign",
  lead_magnet:             "Lead Magnet",
  case_study:              "Case Study",
  video_script:            "Video Script",
  vsl_script:              "VSL Script",
  podcast_script:          "Podcast Script",
  ai_call_script:          "AI Call Script",
  follow_up_sequence:      "Follow-Up Sequence",
  review_request_campaign: "Review Request Campaign",
  referral_campaign:       "Referral Campaign",
  sales_letter:            "Sales Letter",
};

function maxTokensForType(type: ContentType, length: string): number {
  const base: Record<ContentType, number> = {
    x_post: 200, instagram_caption: 200, google_ad: 300, meta_ad: 300,
    linkedin_post: 600, facebook_post: 600,
    email_campaign: 800, whatsapp_campaign: 600,
    follow_up_sequence: 1000, review_request_campaign: 600, referral_campaign: 600,
    blog_article: 2000, landing_page: 1800, lead_magnet: 2000, case_study: 2000,
    sales_letter: 2000, video_script: 1500, vsl_script: 2000,
    podcast_script: 2500, ai_call_script: 1500,
  };
  const multiplier = length === "short" ? 0.5 : length === "long" ? 1.5 : length === "comprehensive" ? 2 : 1;
  return Math.round((base[type] ?? 1000) * multiplier);
}

function buildContentPrompt(
  brief: ContentBrief,
  context: {
    companyName:    string;
    industry:       string;
    siteUrl:        string;
    keywords:       string;
    competitors:    string;
    activePlaybook: string;
  },
): { system: string; user: string } {
  const typeLabel = CONTENT_TYPE_LABELS[brief.contentType];

  const system = `You are GrowthMind Content Studio, an expert AI marketing content creator.

## Company Context
Business Name: ${context.companyName || "the business"}
Industry: ${context.industry || "not specified"}
Website: ${context.siteUrl || "not specified"}
${context.activePlaybook ? `Active Marketing Playbook: ${context.activePlaybook}` : ""}

## Tracked SEO Keywords
${context.keywords || "None tracked yet."}

## Competitor Landscape
${context.competitors || "No competitors tracked."}

## Your Role
You create high-converting, SEO-optimised ${typeLabel} content. Match the tone, platform conventions, and content length requested. Apply copywriting best practices. Use the company and competitor context to make the content specific and differentiated.`;

  const user = `Create a ${typeLabel} with the following brief:

Business Type: ${brief.businessType || context.industry || "not specified"}
Target Audience: ${brief.targetAudience || "not specified"}
Offer: ${brief.offer || "not specified"}
Goal: ${brief.goal || "awareness"}
Primary Keyword: ${brief.keyword || "not specified"}
${brief.location ? `Location: ${brief.location}` : ""}
${brief.platform ? `Platform: ${brief.platform}` : ""}
Tone of Voice: ${brief.tone || "professional"}
Call to Action: ${brief.cta || "Contact us today"}
${brief.campaignType ? `Campaign Type: ${brief.campaignType}` : ""}
Length: ${brief.length || "medium"}

Write the complete ${typeLabel} now. Make it compelling, specific, and immediately usable.

${["blog_article", "landing_page", "lead_magnet", "case_study", "sales_letter"].includes(brief.contentType) ? `
After the content, append this exact block:
SEO_DATA_JSON:
{
  "primaryKeyword": "...",
  "secondaryKeywords": ["...", "..."],
  "metaTitle": "...",
  "metaDescription": "...",
  "suggestedHeadings": ["...", "..."],
  "suggestedInternalLinks": ["...", "..."],
  "seoScore": 85
}` : ""}`;

  return { system, user };
}

// ── Server Functions ──────────────────────────────────────────────────────────

export const getContentAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      folderId:    z.string().uuid().nullish(),
      contentType: z.string().nullish(),
      status:      z.enum(["draft", "published", "archived"]).nullish(),
      favourites:  z.boolean().nullish(),
      limit:       z.number().int().min(1).max(200).default(100),
    }).parse(input ?? {})
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    let q = sb
      .from("growthmind_content_assets")
      .select("id, folder_id, title, content_type, content, brief, seo_data, status, is_favourite, scheduled_at, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.folderId)    q = q.eq("folder_id", data.folderId);
    if (data.contentType) q = q.eq("content_type", data.contentType);
    if (data.status)      q = q.eq("status", data.status);
    if (data.favourites)  q = q.eq("is_favourite", true);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const assets: ContentAsset[] = (rows ?? []).map((r: any) => ({
      id:          r.id,
      folderId:    r.folder_id ?? null,
      title:       r.title,
      contentType: r.content_type as ContentType,
      content:     r.content ?? "",
      brief:       r.brief ?? {},
      seoData:     r.seo_data ?? {},
      status:      r.status as ContentStatus,
      isFavourite: r.is_favourite ?? false,
      scheduledAt: r.scheduled_at ?? null,
      createdAt:   r.created_at,
      updatedAt:   r.updated_at,
    }));

    return { assets };
  });

export const getContentFolders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: rows, error } = await sb
      .from("growthmind_content_folders")
      .select("id, name, icon, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);

    const folders: ContentFolder[] = (rows ?? []).map((r: any) => ({
      id:         r.id,
      name:       r.name,
      icon:       r.icon ?? "folder",
      assetCount: 0,
      createdAt:  r.created_at,
    }));

    return { folders };
  });

const assetInputSchema = z.object({
  id:          z.string().uuid().nullish(),
  folderId:    z.string().uuid().nullish(),
  title:       z.string().min(1).max(500),
  contentType: z.string().min(1),
  content:     z.string().default(""),
  brief:       z.record(z.string()).default({}),
  seoData:     z.record(z.any()).default({}),
  status:      z.enum(["draft", "published", "archived"]).default("draft"),
  isFavourite: z.boolean().default(false),
  scheduledAt: z.string().nullish(),
});

export const saveContentAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => assetInputSchema.parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const payload = {
      workspace_id: workspaceId,
      folder_id:    data.folderId ?? null,
      title:        data.title,
      content_type: data.contentType,
      content:      data.content,
      brief:        data.brief,
      seo_data:     data.seoData,
      status:       data.status,
      is_favourite: data.isFavourite,
      scheduled_at: data.scheduledAt ?? null,
      updated_at:   new Date().toISOString(),
    };

    let id = data.id;

    if (id) {
      const { error } = await sb
        .from("growthmind_content_assets")
        .update(payload)
        .eq("id", id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await sb
        .from("growthmind_content_assets")
        .insert({ ...payload, created_at: new Date().toISOString() })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      id = inserted.id;
    }

    return { ok: true, id };
  });

export const deleteContentAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_content_assets")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleFavourite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), isFavourite: z.boolean() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_content_assets")
      .update({ is_favourite: data.isFavourite, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

const briefSchema = z.object({
  contentType:    z.string().min(1),
  businessType:   z.string().default(""),
  targetAudience: z.string().default(""),
  offer:          z.string().default(""),
  goal:           z.string().default("awareness"),
  keyword:        z.string().default(""),
  location:       z.string().default(""),
  platform:       z.string().default(""),
  tone:           z.string().default("professional"),
  cta:            z.string().default(""),
  campaignType:   z.string().default(""),
  length:         z.string().default("medium"),
});

export const generateContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => briefSchema.parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    const settings    = (context as any).settings ?? {};
    if (!workspaceId) throw new Error("No workspace");

    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
    if (!apiKey) throw new Error("OpenAI API key not configured. Add it in Settings → Integrations.");

    // ── Pull context in parallel ─────────────────────────────────────────────
    const [wsRes, seoRes, compRes, playbookRes] = await Promise.all([
      sb.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle(),
      sb.from("growthmind_seo_sites").select("keywords").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("growthmind_competitors").select("name, positioning").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(10),
      sb.from("growthmind_playbooks").select("industry").eq("workspace_id", workspaceId).eq("status", "active").maybeSingle(),
    ]);

    const ws         = wsRes.data;
    const wsSettings = ws?.settings ?? {};
    const companyName = ws?.name ?? wsSettings.company_name ?? "";
    const industry    = wsSettings.industry ?? data.businessType ?? "";
    const siteUrl     = wsSettings.website_url ?? "";

    const keywords = ((seoRes.data?.keywords ?? []) as any[])
      .slice(0, 15)
      .map((k: any) => `"${k.term}"${k.volume ? ` (vol: ${k.volume})` : ""}${k.difficulty ? ` diff: ${k.difficulty}` : ""}`)
      .join(", ") || "None tracked";

    const competitors = ((compRes.data ?? []) as any[])
      .map((c: any) => `${c.name}${c.positioning ? ` — ${c.positioning}` : ""}`)
      .join("; ") || "None tracked";

    const activePlaybook = playbookRes.data?.industry ?? "";

    const brief: ContentBrief = {
      contentType:    data.contentType as ContentType,
      businessType:   data.businessType || industry,
      targetAudience: data.targetAudience,
      offer:          data.offer,
      goal:           data.goal,
      keyword:        data.keyword,
      location:       data.location,
      platform:       data.platform,
      tone:           data.tone,
      cta:            data.cta,
      campaignType:   data.campaignType,
      length:         data.length,
    };

    const { system, user } = buildContentPrompt(brief, {
      companyName, industry, siteUrl, keywords, competitors, activePlaybook,
    });

    const maxTokens = maxTokensForType(data.contentType as ContentType, data.length);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model:       "gpt-4o",
        messages:    [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens:  maxTokens,
        temperature: 0.75,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
    }

    const json = await res.json() as any;
    const rawText: string = json.choices?.[0]?.message?.content ?? "";
    const tokensUsed: number = json.usage?.total_tokens ?? 0;

    // ── Parse SEO block if present ────────────────────────────────────────────
    let mainContent = rawText;
    let seoData: Partial<SeoData> = {};

    const seoMarker = "SEO_DATA_JSON:";
    const seoIdx    = rawText.indexOf(seoMarker);
    if (seoIdx !== -1) {
      mainContent = rawText.slice(0, seoIdx).trim();
      const jsonStr = rawText.slice(seoIdx + seoMarker.length).trim();
      try {
        const parsed = JSON.parse(jsonStr.replace(/```json|```/g, "").trim());
        seoData = parsed as Partial<SeoData>;
      } catch {
        // SEO parse failed — main content still returned
      }
    }

    // ── Auto-generate a title from the brief ──────────────────────────────────
    const typeLabel = CONTENT_TYPE_LABELS[data.contentType as ContentType] ?? data.contentType;
    const title = [typeLabel, brief.offer || brief.targetAudience || brief.keyword]
      .filter(Boolean).join(" — ") || typeLabel;

    // ── Save asset ────────────────────────────────────────────────────────────
    const assetPayload = {
      workspace_id: workspaceId,
      folder_id:    null,
      title,
      content_type: data.contentType,
      content:      mainContent,
      brief:        { ...data },
      seo_data:     seoData,
      status:       "draft",
      is_favourite: false,
      scheduled_at: null,
      created_at:   new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    };

    const { data: inserted, error: assetErr } = await sb
      .from("growthmind_content_assets")
      .insert(assetPayload)
      .select("id")
      .single();

    if (assetErr) throw new Error(assetErr.message);

    // ── Log generation record ─────────────────────────────────────────────────
    await sb.from("growthmind_content_generations").insert({
      workspace_id: workspaceId,
      asset_id:     inserted.id,
      content_type: data.contentType,
      brief:        { ...data },
      tokens_used:  tokensUsed,
      created_at:   new Date().toISOString(),
    });

    return {
      assetId:  inserted.id as string,
      title,
      content:  mainContent,
      seoData,
      tokensUsed,
    };
  });

export const getContentStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: rows, error } = await sb
      .from("growthmind_content_assets")
      .select("content_type, status, is_favourite, created_at")
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);

    const all = rows ?? [];
    const byType: Record<string, number> = {};
    for (const r of all) {
      byType[r.content_type] = (byType[r.content_type] ?? 0) + 1;
    }

    return {
      total:      all.length,
      draft:      all.filter((r: any) => r.status === "draft").length,
      published:  all.filter((r: any) => r.status === "published").length,
      archived:   all.filter((r: any) => r.status === "archived").length,
      favourites: all.filter((r: any) => r.is_favourite).length,
      byType,
    };
  });
