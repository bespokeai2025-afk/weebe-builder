/**
 * Blog Draft Tick — autonomous weekly blog draft generator.
 *
 * Called by the campaign-scheduler executor (every 5 min in dev via Vite plugin,
 * every 5 min in prod via /api/public/campaign-executor + pg_cron).
 *
 * Iterates every workspace that has HiveMind mode = "assistant" or "operator",
 * checks weekly deduplication, then generates + queues one blog draft per workspace
 * and creates a hivemind_actions approval item.
 */

import { createClient } from "@supabase/supabase-js";

// ── helpers copied locally to avoid importing a server-fn module ──────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function countWords(body: string): number {
  return body.split(/\s+/).filter(Boolean).length;
}

function estimateReadingTime(body: string): number {
  return Math.max(1, Math.round(countWords(body) / 200));
}

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

function calcSeoScore(primaryKeyword: string, metaTitle: string, metaDescription: string, body: string): number {
  let score = 0;
  if (metaTitle.length >= 40 && metaTitle.length <= 65) score += 20;
  else if (metaTitle.length > 0) score += 10;
  if (metaDescription.length >= 120 && metaDescription.length <= 160) score += 20;
  else if (metaDescription.length > 0) score += 10;
  const lowerKw = primaryKeyword.toLowerCase();
  const lowerBody = body.toLowerCase();
  if (lowerKw && lowerBody.includes(lowerKw)) {
    const freq = countOccurrences(lowerBody, lowerKw);
    const words = countWords(body);
    const density = words > 0 ? (freq / words) * 100 : 0;
    if (density >= 0.5 && density <= 3) score += 20;
    else if (density > 0) score += 10;
  }
  score += 25;
  return Math.min(100, score);
}

// ── AI generation (minimal inline version for scheduler) ─────────────────────

async function generateBlogDraftAI(
  topic: string,
  keyword: string,
  context: string,
  apiKey: string,
  provider: "openai" | "gemini",
): Promise<{ title: string; body: string; excerpt: string; metaTitle: string; metaDescription: string }> {
  const prompt = `You are an expert content writer. Write a 1000-word SEO-optimised blog post.

Business context:
${context}

Topic: ${topic}
Primary keyword: ${keyword}
Tone: Professional
Audience: Business owners and decision makers

Return JSON only:
{
  "title": "...",
  "excerpt": "...(120-160 chars)...",
  "metaTitle": "...(50-65 chars)...",
  "metaDescription": "...(120-160 chars)...",
  "body": "...(full markdown body)..."
}`;

  if (provider === "gemini") {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-06-05:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    const j: any = await resp.json();
    const text: string = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(clean);
  } else {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4.1",
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const j: any = await resp.json();
    return JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
  }
}

// ── per-workspace tick ────────────────────────────────────────────────────────

export type BlogDraftTickResult = {
  workspaceId: string;
  skipped: boolean;
  skipReason?: string;
  queued: boolean;
  title?: string;
  error?: string;
};

async function tickWorkspace(
  sb: ReturnType<typeof createClient>,
  workspaceId: string,
  geminiKey: string | null,
  openaiKey: string | null,
): Promise<BlogDraftTickResult> {
  const base = { workspaceId };

  if (!geminiKey && !openaiKey) {
    return { ...base, skipped: true, skipReason: "no_ai_key", queued: false };
  }

  // Weekly deduplication — skip if an auto-draft already exists this week
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartIso = weekStart.toISOString().split("T")[0];

  const { data: existing } = await Promise.resolve((sb as any)
    .from("growthmind_content_calendar")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("content_type", "Blog")
    .ilike("title", "[Auto-Draft]%")
    .gte("created_at", weekStartIso)
    .limit(1)
  ).catch(() => ({ data: null }));

  if ((existing ?? []).length > 0) {
    return { ...base, skipped: true, skipReason: "already_drafted_this_week", queued: false };
  }

  // Build minimal business context from DNA / workspace settings
  const { data: dna } = await Promise.resolve((sb as any)
    .from("growthmind_business_dna")
    .select("company_name, industry, core_services, ideal_customer_profile, value_proposition")
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  ).catch(() => ({ data: null }));

  const company  = dna?.company_name ?? "the company";
  const industry = dna?.industry     ?? "the industry";
  const service  = (dna?.core_services ?? "").split(/[,\n;]/)[0].trim() || "services";
  const audience = dna?.ideal_customer_profile ?? "business owners";
  const usp      = dna?.value_proposition ?? service;
  const keyword  = usp.split(/[,\n;]/)[0].trim().slice(0, 60) || service;

  const topic = `How ${company} helps ${audience} achieve better results with ${service}`;
  const contextText = `Company: ${company}\nIndustry: ${industry}\nServices: ${service}\nIdeal customers: ${audience}\nValue proposition: ${usp}`;

  const provider: "openai" | "gemini" = geminiKey ? "gemini" : "openai";
  const apiKey = (geminiKey ?? openaiKey)!;

  let title          = `[Auto-Draft] ${topic}`;
  let body           = `# ${topic}\n\nThis is an auto-queued blog post draft. Open in Blog Writer to regenerate the full article.`;
  let excerpt        = `A blog post about how ${company} helps customers in ${industry}.`;
  let metaTitle      = title.slice(0, 65);
  let metaDescription = excerpt.slice(0, 160);
  let seoScore       = 0;

  try {
    const raw = await generateBlogDraftAI(topic, keyword, contextText, apiKey, provider);
    title           = `[Auto-Draft] ${raw.title ?? topic}`;
    body            = raw.body    ?? body;
    excerpt         = raw.excerpt ?? excerpt;
    metaTitle       = raw.metaTitle      ?? title.slice(0, 65);
    metaDescription = raw.metaDescription ?? excerpt.slice(0, 160);
    seoScore        = calcSeoScore(keyword, metaTitle, metaDescription, body);
  } catch (e: any) {
    console.warn(`[blog-draft-tick] AI generation failed for workspace ${workspaceId}:`, e?.message ?? e);
  }

  const nextMonday = new Date();
  nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));
  const scheduledDate = nextMonday.toISOString().split("T")[0];

  const meta = JSON.stringify({
    excerpt,
    seoData: {
      primaryKeyword: keyword,
      secondaryKeywords: [],
      metaTitle,
      metaDescription,
      suggestedHeadings: [],
      slug: slugify(title.replace("[Auto-Draft] ", "")),
      seoScore,
      readingTimeMin: estimateReadingTime(body),
      wordCount: countWords(body),
    },
    publishedUrl: null,
    wordpressPostId: null,
    webflowItemId: null,
  });

  const { data: inserted, error: insertErr } = await Promise.resolve((sb as any)
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
  ).catch((e: any) => ({ data: null, error: e }));

  if (insertErr) {
    return { ...base, skipped: false, queued: false, error: insertErr?.message ?? String(insertErr) };
  }

  const insertedId = (inserted as any)?.id;

  if (insertedId) {
    await Promise.resolve((sb as any).from("hivemind_actions").insert({
      workspace_id: workspaceId,
      action_type:  "blog_draft",
      title:        `Blog Draft Ready: ${title.replace("[Auto-Draft] ", "")}`,
      description:  `GrowthMind auto-drafted a weekly blog post.\n\nTopic: ${topic}\nKeyword: ${keyword}\nScheduled: ${scheduledDate}\nSEO Score: ${seoScore}/100\n\nReview in the Blog Writer.`,
      status:       "pending",
      priority:     "medium",
      source:       "growthmind",
      metadata:     { calendarEntryId: insertedId, type: "auto_blog_draft", seoScore },
    })).catch(() => {});
  }

  return { ...base, skipped: false, queued: true, title };
}

// ── main export ───────────────────────────────────────────────────────────────

export type BlogDraftTickReport = {
  queued: BlogDraftTickResult[];
  skipped: BlogDraftTickResult[];
  failed: BlogDraftTickResult[];
  error?: string;
};

export async function runBlogDraftTick(): Promise<BlogDraftTickReport> {
  const supabaseUrl     = process.env.SUPABASE_URL      ?? process.env.VITE_SUPABASE_URL ?? "";
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return { queued: [], skipped: [], failed: [], error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }

  const sb = createClient(supabaseUrl, serviceRoleKey);

  // Platform-level AI keys (fall back to per-workspace below)
  const platformGemini = process.env.GEMINI_API_KEY ?? null;
  const platformOpenAI = process.env.OPENAI_API_KEY  ?? null;

  // Find all workspaces with assistant or operator hivemind_mode
  const { data: eligibleSettings, error: settingsErr } = await Promise.resolve((sb as any)
    .from("workspace_settings")
    .select("workspace_id, hivemind_mode, gemini_api_key, openai_api_key")
    .in("hivemind_mode", ["assistant", "operator"])
  ).catch(() => ({ data: null, error: "query failed" }));

  if (settingsErr || !eligibleSettings) {
    return { queued: [], skipped: [], failed: [], error: String(settingsErr ?? "No data") };
  }

  const results: BlogDraftTickResult[] = await Promise.all(
    (eligibleSettings as any[]).map((row: any) =>
      tickWorkspace(
        sb,
        row.workspace_id,
        platformGemini ?? row.gemini_api_key ?? null,
        platformOpenAI ?? row.openai_api_key ?? null,
      ).catch((e: any) => ({
        workspaceId: row.workspace_id,
        skipped: false,
        queued: false,
        error: e?.message ?? String(e),
      })),
    ),
  );

  return {
    queued:  results.filter(r => r.queued),
    skipped: results.filter(r => r.skipped),
    failed:  results.filter(r => !r.skipped && !r.queued),
  };
}
