// SERVER ONLY — never import from a client component.
// Blog Writer engine — generates full SEO-optimised blog posts using Business DNA context,
// saves to growthmind_content_calendar, and publishes to WordPress or Webflow.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildBusinessContext, formatContextForAI } from "./growthmind.business-context";

// ── Types ──────────────────────────────────────────────────────────────────────

export type BlogPostStatus = "Draft" | "Scheduled" | "Published" | "Archived";

export type BlogSeoData = {
  primaryKeyword:     string;
  secondaryKeywords:  string[];
  metaTitle:          string;
  metaDescription:    string;
  suggestedHeadings:  string[];
  slug:               string;
  seoScore:           number;
  readingTimeMin:     number;
  wordCount:          number;
};

export type BlogPost = {
  id:             string;
  title:          string;
  excerpt:        string;
  body:           string;
  seoData:        BlogSeoData;
  status:         BlogPostStatus;
  scheduledDate:  string | null;
  publishedUrl:   string | null;
  wordpressPostId: number | null;
  webflowItemId:  string | null;
  createdAt:      string;
  updatedAt:      string;
};

export type BlogPublishSettings = {
  wordpressUrl:       string;
  wordpressUsername:  string;
  wordpressAppPassword: string;
  webflowApiToken:    string;
  webflowCollectionId: string;
  wordpressConnected: boolean;
  webflowConnected:   boolean;
};

export type GenerateBlogInput = {
  topic:        string;
  keyword:      string;
  tone:         string;
  wordCount:    number;
  audience:     string;
  cta:          string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function estimateReadingTime(body: string): number {
  const words = body.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function countWords(body: string): number {
  return body.split(/\s+/).filter(Boolean).length;
}

// Count how many times `needle` occurs in `haystack` using indexOf (no regex,
// so keyword metacharacters like C++, A/B testing? can never cause SyntaxError).
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

function calcSeoScore(seoData: Omit<BlogSeoData, "seoScore">, body: string): number {
  let score = 0;
  const lowerBody = body.toLowerCase();
  const lowerKw = seoData.primaryKeyword.toLowerCase();

  if (seoData.metaTitle.length >= 40 && seoData.metaTitle.length <= 65) score += 20;
  else if (seoData.metaTitle.length > 0) score += 10;

  if (seoData.metaDescription.length >= 120 && seoData.metaDescription.length <= 160) score += 20;
  else if (seoData.metaDescription.length > 0) score += 10;

  if (lowerKw && lowerBody.includes(lowerKw)) {
    const freq = countOccurrences(lowerBody, lowerKw);
    const words = countWords(body);
    const density = words > 0 ? (freq / words) * 100 : 0;
    if (density >= 0.5 && density <= 3) score += 20;
    else if (density > 0) score += 10;
  }

  if (seoData.suggestedHeadings.length >= 3) score += 15;
  else if (seoData.suggestedHeadings.length > 0) score += 8;

  if (seoData.secondaryKeywords.length >= 3) score += 15;
  else if (seoData.secondaryKeywords.length > 0) score += 8;

  if (seoData.wordCount >= 800) score += 10;

  return Math.min(100, score);
}

// ── AI blog post generation ────────────────────────────────────────────────────

async function generateWithAI(
  input: GenerateBlogInput,
  businessContext: string,
  apiKey: string,
  provider: "openai" | "gemini",
): Promise<{ title: string; excerpt: string; body: string; seoData: Omit<BlogSeoData, "seoScore"> }> {
  const targetWords = input.wordCount ?? 1200;

  const systemPrompt = `You are GrowthMind, an expert SEO content writer and AI Chief Marketing Officer. Write comprehensive, SEO-optimised blog posts that rank on Google and convert readers into leads.

BUSINESS CONTEXT:
${businessContext}

WRITING RULES:
- Use markdown formatting: # H1, ## H2, ### H3, **bold**, *italic*, bullet lists
- The H1 title should include the primary keyword naturally
- Open with a compelling hook (problem/question/stat)
- Include data, examples, and actionable advice
- End with a clear CTA that matches the business
- Write in the specified tone throughout
- Target exactly ${targetWords} words`;

  const userPrompt = `Write a full blog post with these requirements:

Topic: ${input.topic}
Primary Keyword: ${input.keyword || input.topic}
Tone: ${input.tone || "Professional"}
Target Audience: ${input.audience || "business owners and decision makers"}
Call-to-Action: ${input.cta || "Book a free consultation"}
Target Word Count: ${targetWords} words

Return ONLY valid JSON (no markdown fences) with this exact structure:
{
  "title": "SEO-optimised H1 title with keyword",
  "excerpt": "2-3 sentence compelling summary for blog listings (max 200 chars)",
  "body": "Full markdown blog post body (${targetWords}+ words, all headings and formatting included)",
  "seoData": {
    "primaryKeyword": "exact target keyword",
    "secondaryKeywords": ["keyword2", "keyword3", "keyword4", "keyword5"],
    "metaTitle": "SEO meta title 50-65 chars with keyword",
    "metaDescription": "SEO meta description 120-160 chars with keyword and CTA",
    "suggestedHeadings": ["H2 heading 1", "H2 heading 2", "H2 heading 3", "H2 heading 4"],
    "slug": "url-friendly-slug-with-keyword",
    "readingTimeMin": 6,
    "wordCount": ${targetWords}
  }
}`;

  if (provider === "gemini") {
    const geminiKey = process.env.GEMINI_API_KEY ?? apiKey;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
          },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = await res.json() as any;
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    return JSON.parse(raw);
  }

  // OpenAI fallback
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      max_tokens: 6000,
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const json = await res.json() as any;
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(raw);
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function rowToPost(r: any): BlogPost {
  let meta: any = {};
  try { meta = r.notes ? JSON.parse(r.notes) : {}; } catch { meta = {}; }

  return {
    id:              r.id,
    title:           r.title,
    excerpt:         meta.excerpt ?? "",
    body:            r.description ?? "",
    seoData:         meta.seoData ?? {
      primaryKeyword: "", secondaryKeywords: [], metaTitle: r.title,
      metaDescription: "", suggestedHeadings: [], slug: slugify(r.title),
      seoScore: 0, readingTimeMin: 1, wordCount: 0,
    },
    status:          r.status as BlogPostStatus,
    scheduledDate:   r.scheduled_date ?? null,
    publishedUrl:    meta.publishedUrl ?? null,
    wordpressPostId: meta.wordpressPostId ?? null,
    webflowItemId:   meta.webflowItemId  ?? null,
    createdAt:       r.created_at,
    updatedAt:       r.updated_at,
  };
}

// ── Server functions ───────────────────────────────────────────────────────────

export const generateBlogPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      topic:     z.string().min(3).max(500),
      keyword:   z.string().max(200).default(""),
      tone:      z.string().max(100).default("Professional"),
      wordCount: z.number().int().min(300).max(3000).default(1200),
      audience:  z.string().max(300).default(""),
      cta:       z.string().max(300).default(""),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const [settingsRes, ctx] = await Promise.all([
      sb.from("workspace_settings")
        .select("openai_api_key, gemini_api_key")
        .eq("workspace_id", workspaceId)
        .maybeSingle()
        .catch(() => ({ data: null })),
      buildBusinessContext(sb, workspaceId),
    ]);

    const wsSettings = (settingsRes as any)?.data ?? {};
    const geminiKey = process.env.GEMINI_API_KEY ?? wsSettings.gemini_api_key ?? null;
    const openaiKey = process.env.OPENAI_API_KEY  ?? wsSettings.openai_api_key ?? null;

    if (!geminiKey && !openaiKey) {
      throw new Error("No AI API key configured. Add an OpenAI or Gemini key in Settings.");
    }

    const businessContext = formatContextForAI(ctx);
    const provider: "openai" | "gemini" = geminiKey ? "gemini" : "openai";
    const apiKey = (geminiKey ?? openaiKey)!;

    const raw = await generateWithAI(data, businessContext, apiKey, provider);

    // Build full seo data with score
    const partial: Omit<BlogSeoData, "seoScore"> = {
      primaryKeyword:    raw.seoData?.primaryKeyword    ?? (data.keyword || data.topic),
      secondaryKeywords: raw.seoData?.secondaryKeywords ?? [],
      metaTitle:         raw.seoData?.metaTitle         ?? raw.title,
      metaDescription:   raw.seoData?.metaDescription   ?? "",
      suggestedHeadings: raw.seoData?.suggestedHeadings ?? [],
      slug:              raw.seoData?.slug              ?? slugify(raw.title ?? data.topic),
      readingTimeMin:    raw.seoData?.readingTimeMin    ?? estimateReadingTime(raw.body ?? ""),
      wordCount:         raw.seoData?.wordCount         ?? countWords(raw.body ?? ""),
    };

    const seoScore = calcSeoScore(partial, raw.body ?? "");

    const post: Omit<BlogPost, "id" | "createdAt" | "updatedAt"> = {
      title:          raw.title   ?? data.topic,
      excerpt:        raw.excerpt ?? "",
      body:           raw.body    ?? "",
      seoData:        { ...partial, seoScore },
      status:         "Draft",
      scheduledDate:  null,
      publishedUrl:   null,
      wordpressPostId: null,
      webflowItemId:  null,
    };

    return { post };
  });

export const getBlogPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_content_calendar")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("content_type", "Blog")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    return { posts: (data ?? []).map(rowToPost) as BlogPost[] };
  });

export const saveBlogPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:            z.string().uuid().optional(),
      title:         z.string().min(1).max(500),
      excerpt:       z.string().max(500).default(""),
      body:          z.string().default(""),
      seoData:       z.any().optional(),
      status:        z.enum(["Draft", "Scheduled", "Published", "Archived"]).default("Draft"),
      scheduledDate: z.string().nullable().optional(),
      publishedUrl:  z.string().nullable().optional(),
      wordpressPostId: z.number().nullable().optional(),
      webflowItemId: z.string().nullable().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const meta = JSON.stringify({
      excerpt:         data.excerpt,
      seoData:         data.seoData ?? {},
      publishedUrl:    data.publishedUrl   ?? null,
      wordpressPostId: data.wordpressPostId ?? null,
      webflowItemId:   data.webflowItemId   ?? null,
    });

    const row = {
      workspace_id:   workspaceId,
      title:          data.title,
      content_type:   "Blog",
      channel:        "Blog",
      status:         data.status,
      description:    data.body,
      notes:          meta,
      scheduled_date: data.scheduledDate ?? null,
      updated_at:     new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await sb
        .from("growthmind_content_calendar")
        .update(row)
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    } else {
      const { data: inserted, error } = await sb
        .from("growthmind_content_calendar")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: (inserted as any).id as string };
    }
  });

export const deleteBlogPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { error } = await sb
      .from("growthmind_content_calendar")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Publish settings ──────────────────────────────────────────────────────────

export const getBlogPublishSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: ws } = await sb
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .maybeSingle();

    const s = ws?.settings ?? {};
    return {
      wordpressUrl:         (s.blog_wp_url          ?? "") as string,
      wordpressUsername:    (s.blog_wp_username      ?? "") as string,
      wordpressAppPassword: (s.blog_wp_app_password  ?? "") as string,
      webflowApiToken:      (s.blog_webflow_token    ?? "") as string,
      webflowCollectionId:  (s.blog_webflow_coll_id  ?? "") as string,
      wordpressConnected:   !!(s.blog_wp_url && s.blog_wp_username && s.blog_wp_app_password),
      webflowConnected:     !!(s.blog_webflow_token && s.blog_webflow_coll_id),
    } as BlogPublishSettings;
  });

export const saveBlogPublishSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      wordpressUrl:         z.string().max(500).default(""),
      wordpressUsername:    z.string().max(200).default(""),
      wordpressAppPassword: z.string().max(500).default(""),
      webflowApiToken:      z.string().max(500).default(""),
      webflowCollectionId:  z.string().max(200).default(""),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: ws } = await sb
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .maybeSingle();

    const current = ws?.settings ?? {};
    const { error } = await sb
      .from("workspaces")
      .update({
        settings: {
          ...current,
          blog_wp_url:          data.wordpressUrl,
          blog_wp_username:     data.wordpressUsername,
          blog_wp_app_password: data.wordpressAppPassword,
          blog_webflow_token:   data.webflowApiToken,
          blog_webflow_coll_id: data.webflowCollectionId,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── WordPress publish ─────────────────────────────────────────────────────────

export const publishToWordPress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      postId:    z.string().uuid(),
      scheduleDate: z.string().nullable().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Load post
    const { data: row, error: rowErr } = await sb
      .from("growthmind_content_calendar")
      .select("*")
      .eq("id", data.postId)
      .eq("workspace_id", workspaceId)
      .single();
    if (rowErr) throw new Error(rowErr.message);

    const post = rowToPost(row);

    // Load WP settings
    const { data: ws } = await sb
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .maybeSingle();

    const s = ws?.settings ?? {};
    const wpUrl  = (s.blog_wp_url          ?? "") as string;
    const wpUser = (s.blog_wp_username      ?? "") as string;
    const wpPass = (s.blog_wp_app_password  ?? "") as string;

    if (!wpUrl || !wpUser || !wpPass) {
      throw new Error("WordPress credentials not configured. Add them in the Publish Settings panel.");
    }

    // SSRF guard — only allow external http/https targets, never internal networks.
    // Block private CIDRs, loopback, link-local, and cloud metadata endpoints.
    function assertSafeUrl(raw: string): void {
      let parsed: URL;
      try { parsed = new URL(raw); }
      catch { throw new Error("Invalid WordPress URL — must be a valid absolute URL (https://yoursite.com)."); }

      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("WordPress URL must use http or https.");
      }

      const hostname = parsed.hostname.toLowerCase();

      const BLOCKED_HOSTS = [
        "localhost", "metadata.google.internal",
        "169.254.169.254", // AWS/GCP/Azure metadata
        "100.100.100.200",  // Alibaba metadata
        "192.0.2.1",
      ];
      if (BLOCKED_HOSTS.includes(hostname)) {
        throw new Error("WordPress URL targets a blocked host.");
      }

      // Block private IPv4 CIDRs using a regex check on the raw hostname.
      const PRIVATE_PATTERNS = [
        /^127\./,          // 127.0.0.0/8 loopback
        /^10\./,           // 10.0.0.0/8 private
        /^172\.(1[6-9]|2\d|3[01])\./,  // 172.16.0.0/12 private
        /^192\.168\./,     // 192.168.0.0/16 private
        /^169\.254\./,     // 169.254.0.0/16 link-local
        /^::1$/,           // IPv6 loopback
        /^fd[0-9a-f]{2}:/i, // IPv6 ULA
      ];
      if (PRIVATE_PATTERNS.some(r => r.test(hostname))) {
        throw new Error("WordPress URL targets a private network address. Only public URLs are allowed.");
      }
    }

    assertSafeUrl(wpUrl);

    // Convert markdown body → simple HTML (basic conversion)
    const htmlBody = post.body
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
      .replace(/\n\n/g, "</p><p>")
      .replace(/^(?!<[hul])/gm, "<p>")
      .replace(/(?<![>])$/gm, "</p>");

    const credentials = Buffer.from(`${wpUser}:${wpPass}`).toString("base64");
    const baseUrl = wpUrl.replace(/\/$/, "");

    const status = data.scheduleDate ? "future" : "publish";
    const payload: Record<string, any> = {
      title:   post.title,
      content: htmlBody,
      status,
      excerpt: post.excerpt,
      slug:    post.seoData.slug || slugify(post.title),
    };

    if (data.scheduleDate) {
      payload.date = data.scheduleDate;
    }
    if (post.seoData.metaTitle || post.seoData.metaDescription) {
      payload.meta = {
        _yoast_wpseo_title:    post.seoData.metaTitle,
        _yoast_wpseo_metadesc: post.seoData.metaDescription,
      };
    }

    const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Basic ${credentials}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => res.statusText);
      throw new Error(`WordPress API error (${res.status}): ${errBody.slice(0, 300)}`);
    }

    const wpPost = await res.json() as any;
    const publishedUrl    = wpPost.link as string;
    const wordpressPostId = wpPost.id  as number;

    // Update DB record
    const updatedMeta = JSON.stringify({
      excerpt:         post.excerpt,
      seoData:         post.seoData,
      publishedUrl,
      wordpressPostId,
      webflowItemId:   post.webflowItemId,
    });

    await sb
      .from("growthmind_content_calendar")
      .update({
        status:      data.scheduleDate ? "Scheduled" : "Published",
        notes:       updatedMeta,
        updated_at:  new Date().toISOString(),
      })
      .eq("id", data.postId)
      .eq("workspace_id", workspaceId);

    return { ok: true, publishedUrl, wordpressPostId };
  });

// ── Webflow publish ───────────────────────────────────────────────────────────

export const publishToWebflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      postId:       z.string().uuid(),
      scheduleDate: z.string().nullable().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Load post
    const { data: row, error: rowErr } = await sb
      .from("growthmind_content_calendar")
      .select("*")
      .eq("id", data.postId)
      .eq("workspace_id", workspaceId)
      .single();
    if (rowErr) throw new Error(rowErr.message);

    const post = rowToPost(row);

    // Load Webflow settings
    const { data: ws } = await sb
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .maybeSingle();

    const s = ws?.settings ?? {};
    const token  = (s.blog_webflow_token    ?? "") as string;
    const collId = (s.blog_webflow_coll_id  ?? "") as string;

    if (!token || !collId) {
      throw new Error("Webflow credentials not configured. Add them in the Publish Settings panel.");
    }

    const isDraft = !!data.scheduleDate;

    const res = await fetch(`https://api.webflow.com/v2/collections/${collId}/items`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
        "accept-version": "1.0.0",
      },
      body: JSON.stringify({
        isArchived: false,
        isDraft,
        fieldData: {
          name:            post.title,
          slug:            post.seoData.slug || slugify(post.title),
          "post-body":     post.body,
          "post-summary":  post.excerpt,
          "meta-title":    post.seoData.metaTitle,
          "meta-description": post.seoData.metaDescription,
          "publish-date":  data.scheduleDate ?? new Date().toISOString(),
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => res.statusText);
      throw new Error(`Webflow API error (${res.status}): ${errBody.slice(0, 300)}`);
    }

    const wfItem = await res.json() as any;
    const webflowItemId = wfItem.id as string;

    // Update DB record
    const updatedMeta = JSON.stringify({
      excerpt:         post.excerpt,
      seoData:         post.seoData,
      publishedUrl:    post.publishedUrl,
      wordpressPostId: post.wordpressPostId,
      webflowItemId,
    });

    await sb
      .from("growthmind_content_calendar")
      .update({
        status:     isDraft ? "Scheduled" : "Published",
        notes:      updatedMeta,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.postId)
      .eq("workspace_id", workspaceId);

    return { ok: true, webflowItemId };
  });

// ── Autonomous draft mode (operator) ─────────────────────────────────────────
// Auto-queues weekly blog post drafts + creates hivemind_actions for approval.

export const autoQueueBlogDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Only runs in assistant or operator mode
    const settingsRes = await sb
      .from("workspace_settings")
      .select("hivemind_mode, openai_api_key, gemini_api_key")
      .eq("workspace_id", workspaceId)
      .maybeSingle()
      .catch(() => ({ data: null }));

    const mode = (settingsRes as any)?.data?.hivemind_mode ?? null;
    if (mode !== "assistant" && mode !== "operator") {
      return { ok: true, queued: 0, message: "Autonomous draft mode is only active in Assistant or Operator HiveMind mode." };
    }

    const wsSettings = (settingsRes as any)?.data ?? {};
    const geminiKey = process.env.GEMINI_API_KEY ?? wsSettings.gemini_api_key ?? null;
    const openaiKey = process.env.OPENAI_API_KEY  ?? wsSettings.openai_api_key ?? null;

    if (!geminiKey && !openaiKey) {
      return { ok: false, queued: 0, message: "No AI API key configured." };
    }

    // Check if a blog auto-draft was already created this week
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartIso = weekStart.toISOString().split("T")[0];

    const { data: existing } = await sb
      .from("growthmind_content_calendar")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("content_type", "Blog")
      .ilike("title", "[Auto-Draft]%")
      .gte("created_at", weekStartIso)
      .limit(1)
      .catch(() => ({ data: null }));

    if ((existing ?? []).length > 0) {
      return { ok: true, queued: 0, message: "Auto-draft already queued for this week." };
    }

    // Build business context + generate 1 blog post idea
    const ctx = await buildBusinessContext(sb, workspaceId);
    const company  = ctx.companyName  ?? "your business";
    const industry = ctx.industry     ?? "your industry";
    const service  = ctx.services[0]  ?? ctx.products[0] ?? "your services";
    const keyword  = ctx.uniqueSellingPoints
      ? ctx.uniqueSellingPoints.split(/[,\n;]/)[0].trim().slice(0, 60)
      : service;

    const topic = `How ${company} helps ${ctx.idealCustomerProfiles ?? "businesses"} achieve better results with ${service}`;

    const provider: "openai" | "gemini" = geminiKey ? "gemini" : "openai";
    const apiKey = (geminiKey ?? openaiKey)!;

    let body = "";
    let title = `[Auto-Draft] ${topic}`;
    let excerpt = "";
    let seoData: any = {};

    try {
      const raw = await generateWithAI(
        { topic, keyword, tone: "Professional", wordCount: 1000, audience: ctx.idealCustomerProfiles ?? "business owners", cta: "Book a free consultation" },
        formatContextForAI(ctx),
        apiKey,
        provider,
      );
      title   = `[Auto-Draft] ${raw.title ?? topic}`;
      excerpt = raw.excerpt ?? "";
      body    = raw.body    ?? "";
      const partial: Omit<BlogSeoData, "seoScore"> = {
        primaryKeyword:    raw.seoData?.primaryKeyword    ?? keyword,
        secondaryKeywords: raw.seoData?.secondaryKeywords ?? [],
        metaTitle:         raw.seoData?.metaTitle         ?? raw.title,
        metaDescription:   raw.seoData?.metaDescription   ?? "",
        suggestedHeadings: raw.seoData?.suggestedHeadings ?? [],
        slug:              raw.seoData?.slug              ?? slugify(raw.title ?? topic),
        readingTimeMin:    estimateReadingTime(body),
        wordCount:         countWords(body),
      };
      seoData = { ...partial, seoScore: calcSeoScore(partial, body) };
    } catch {
      // Fallback: placeholder draft
      title   = `[Auto-Draft] ${topic}`;
      excerpt = `A blog post about how ${company} helps customers in ${industry}.`;
      body    = `# ${topic}\n\nThis is an auto-queued blog post draft. Click 'Regenerate' to generate the full article.`;
      seoData = { primaryKeyword: keyword, secondaryKeywords: [], metaTitle: title, metaDescription: excerpt, suggestedHeadings: [], slug: slugify(topic), seoScore: 0, readingTimeMin: 1, wordCount: 30 };
    }

    const nextMonday = new Date();
    nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));
    const scheduledDate = nextMonday.toISOString().split("T")[0];

    const meta = JSON.stringify({ excerpt, seoData, publishedUrl: null, wordpressPostId: null, webflowItemId: null });

    const { data: inserted } = await sb
      .from("growthmind_content_calendar")
      .insert({
        workspace_id:   workspaceId,
        title,
        content_type:   "Blog",
        channel:        "Blog",
        status:         "Draft",
        description:    body,
        notes:          meta,
        scheduled_date: scheduledDate,
        updated_at:     new Date().toISOString(),
      })
      .select("id")
      .single()
      .catch(() => ({ data: null }));

    const insertedId = (inserted as any)?.id;

    // Create hivemind approval action
    if (insertedId) {
      await sb.from("hivemind_actions").insert({
        workspace_id: workspaceId,
        action_type:  "blog_draft",
        title:        `Blog Draft Ready: ${title.replace("[Auto-Draft] ", "")}`,
        description:  `GrowthMind auto-drafted a weekly blog post.\n\nTopic: ${topic}\nKeyword: ${keyword}\nScheduled: ${scheduledDate}\nSEO Score: ${seoData.seoScore ?? 0}/100\n\nReview and approve in the Blog Writer.`,
        status:       "pending",
        priority:     "medium",
        source:       "growthmind",
        metadata:     { calendarEntryId: insertedId, type: "auto_blog_draft", seoScore: seoData.seoScore },
      }).catch(() => {});
    }

    return { ok: true, queued: 1, message: `Auto-drafted: "${title}"` };
  });
