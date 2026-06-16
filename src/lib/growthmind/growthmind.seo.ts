import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildGscEncodedSiteUrl } from "./gsc-utils";

// ── Types ───────────────────────────────────────────────────────────────────

export type SeoKeyword = {
  id:              string;
  term:            string;
  volume:          number | null;
  difficulty:      number | null;
  rank:            number | null;
  gsc_clicks?:     number | null;
  gsc_impressions?: number | null;
  gsc_position?:   number | null;
};

export type ContentIdea = {
  id:            string;
  title:         string;
  targetKeyword: string;
  status:        "idea" | "in-progress" | "published";
};

export type SeoSite = {
  id:           string;
  url:          string;
  keywords:     SeoKeyword[];
  contentIdeas: ContentIdea[];
  aiRecs:       string | null;
  aiRecAt:      string | null;
  createdAt:    string;
  updatedAt:    string;
};

export type GscQuery = {
  term:        string;
  clicks:      number;
  impressions: number;
  position:    number | null;
};

// ── Server functions ─────────────────────────────────────────────────────────

export const getSeoSite = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data } = await sb
      .from("growthmind_seo_sites")
      .select("id, url, keywords, content_ideas, ai_recs, ai_rec_at, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return { site: null };

    // ai_recs is stored as [{ text, at }]; grab the latest entry's text
    const aiRecsArr = Array.isArray(data.ai_recs) ? data.ai_recs : [];
    const latestRec = aiRecsArr.length > 0 ? aiRecsArr[aiRecsArr.length - 1] : null;

    return {
      site: {
        id:           data.id,
        url:          data.url,
        keywords:     (data.keywords     ?? []) as SeoKeyword[],
        contentIdeas: (data.content_ideas ?? []) as ContentIdea[],
        aiRecs:       latestRec?.text ?? null,
        aiRecAt:      data.ai_rec_at ?? null,
        createdAt:    data.created_at,
        updatedAt:    data.updated_at,
      } as SeoSite,
    };
  });

export const saveSeoSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:           z.string().uuid().optional(),
      url:          z.string().url("Please enter a valid URL"),
      keywords:     z.array(z.object({
        id:              z.string(),
        term:            z.string(),
        volume:          z.number().nullable(),
        difficulty:      z.number().min(0).max(100).nullable(),
        rank:            z.number().nullable(),
        gsc_clicks:      z.number().nullable().optional(),
        gsc_impressions: z.number().nullable().optional(),
        gsc_position:    z.number().nullable().optional(),
      })).default([]),
      contentIdeas: z.array(z.object({
        id:            z.string(),
        title:         z.string(),
        targetKeyword: z.string(),
        status:        z.enum(["idea","in-progress","published"]),
      })).default([]),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const payload = {
      workspace_id:  workspaceId,
      url:           data.url,
      keywords:      data.keywords,
      content_ideas: data.contentIdeas,
      updated_at:    new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await sb
        .from("growthmind_seo_sites")
        .update(payload)
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb
        .from("growthmind_seo_sites")
        .insert({ ...payload, created_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });

export const saveAiRecs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:   z.string().uuid(),
      text: z.string(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const now = new Date().toISOString();

    const { error } = await sb
      .from("growthmind_seo_sites")
      .update({
        ai_recs:    [{ text: data.text, at: now }],
        ai_rec_at:  now,
        updated_at: now,
      })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Google Search Console OAuth ───────────────────────────────────────────────

const GSC_SCOPES = "https://www.googleapis.com/auth/webmasters.readonly";
const GSC_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function gscClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID is not configured");
  return id;
}

function gscClientSecret(): string {
  const s = process.env.GOOGLE_CLIENT_SECRET;
  if (!s) throw new Error("GOOGLE_CLIENT_SECRET is not configured");
  return s;
}

async function signGscState(workspaceId: string, ts: number): Promise<string> {
  const { createHmac } = await import("crypto");
  const secret = gscClientSecret();
  const payload = `${workspaceId}.${ts}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

async function verifyGscState(state: string, workspaceId: string): Promise<void> {
  const { createHmac, timingSafeEqual } = await import("crypto");
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    throw new Error("Invalid OAuth state");
  }
  const parts = decoded.split(".");
  if (parts.length !== 3) throw new Error("Invalid OAuth state format");
  const [wid, tsStr, sig] = parts;
  if (wid !== workspaceId) throw new Error("OAuth state workspace mismatch");
  const ts = parseInt(tsStr, 10);
  if (isNaN(ts) || Date.now() - ts > GSC_STATE_TTL_MS) throw new Error("OAuth state expired");
  const secret  = gscClientSecret();
  const payload = `${wid}.${tsStr}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const sigBuf  = Buffer.from(sig,      "hex");
  const expBuf  = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("OAuth state signature invalid");
  }
}

export const getGscStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data } = await sb
      .from("workspace_settings")
      .select("gsc_access_token, gsc_property_url, gsc_token_expiry, gsc_auto_matched")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const configured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    const connected  = !!(data?.gsc_access_token);

    return {
      configured,
      connected,
      propertyUrl:  (data?.gsc_property_url  as string  | null)  ?? null,
      autoMatched:  (data?.gsc_auto_matched   as boolean | null)  ?? false,
    };
  });

export const getGscAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ redirectUri: z.string().url() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const clientId = gscClientId();
    const state    = await signGscState(workspaceId, Date.now());
    const params   = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  data.redirectUri,
      response_type: "code",
      scope:         GSC_SCOPES,
      access_type:   "offline",
      prompt:        "consent",
      state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  });

export const connectGscToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      code:        z.string(),
      redirectUri: z.string().url(),
      state:       z.string(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    await verifyGscState(data.state, workspaceId);

    const clientId     = gscClientId();
    const clientSecret = gscClientSecret();

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        code:          data.code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  data.redirectUri,
        grant_type:    "authorization_code",
      }).toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Token exchange failed: ${err}`);
    }

    const tokens = await tokenRes.json() as {
      access_token:  string;
      refresh_token?: string;
      expires_in:    number;
    };

    const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const { error } = await sb
      .from("workspace_settings")
      .upsert({
        workspace_id:      workspaceId,
        gsc_access_token:  tokens.access_token,
        gsc_refresh_token: tokens.refresh_token ?? null,
        gsc_token_expiry:  expiry,
      }, { onConflict: "workspace_id" });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const disconnectGsc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("workspace_settings")
      .upsert({
        workspace_id:      workspaceId,
        gsc_access_token:  null,
        gsc_refresh_token: null,
        gsc_token_expiry:  null,
        gsc_property_url:  null,
      }, { onConflict: "workspace_id" });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveGscProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      propertyUrl:  z.string(),
      autoMatched:  z.boolean().default(false),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("workspace_settings")
      .upsert({
        workspace_id:     workspaceId,
        gsc_property_url: data.propertyUrl,
        gsc_auto_matched: data.autoMatched,
      }, { onConflict: "workspace_id" });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function refreshGscToken(sb: any, workspaceId: string, refreshToken: string): Promise<string> {
  const clientId     = gscClientId();
  const clientSecret = gscClientSecret();

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    "refresh_token",
    }).toString(),
  });

  if (!res.ok) throw new Error("Failed to refresh GSC token");

  const tokens = await res.json() as { access_token: string; expires_in: number };
  const expiry  = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await sb.from("workspace_settings").upsert({
    workspace_id:     workspaceId,
    gsc_access_token: tokens.access_token,
    gsc_token_expiry: expiry,
  }, { onConflict: "workspace_id" });

  return tokens.access_token;
}

export const listGscProperties = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: settings } = await sb
      .from("workspace_settings")
      .select("gsc_access_token, gsc_refresh_token, gsc_token_expiry")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!settings?.gsc_access_token) throw new Error("Google Search Console is not connected");

    let accessToken: string = settings.gsc_access_token;

    if (settings.gsc_token_expiry) {
      const expiry = new Date(settings.gsc_token_expiry).getTime();
      if (Date.now() > expiry - 60_000 && settings.gsc_refresh_token) {
        accessToken = await refreshGscToken(sb, workspaceId, settings.gsc_refresh_token);
      }
    }

    const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GSC API error: ${err}`);
    }

    const json = await res.json() as { siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> };
    const sites = (json.siteEntry ?? []).map(s => s.siteUrl);

    return { sites };
  });

export const fetchGscQueries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      propertyUrl: z.string(),
      rowLimit:    z.number().int().min(1).max(500).default(50),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: settings } = await sb
      .from("workspace_settings")
      .select("gsc_access_token, gsc_refresh_token, gsc_token_expiry")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!settings?.gsc_access_token) throw new Error("Google Search Console is not connected");

    let accessToken: string = settings.gsc_access_token;

    if (settings.gsc_token_expiry) {
      const expiry = new Date(settings.gsc_token_expiry).getTime();
      if (Date.now() > expiry - 60_000 && settings.gsc_refresh_token) {
        accessToken = await refreshGscToken(sb, workspaceId, settings.gsc_refresh_token);
      }
    }

    const endDate   = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 90);

    const fmtDate = (d: Date) => d.toISOString().split("T")[0];

    const encodedUrl = buildGscEncodedSiteUrl(data.propertyUrl);

    const res = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodedUrl}/searchAnalytics/query`,
      {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate:  fmtDate(startDate),
          endDate:    fmtDate(endDate),
          dimensions: ["query"],
          rowLimit:   data.rowLimit,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GSC Search Analytics error: ${err}`);
    }

    const json = await res.json() as {
      rows?: Array<{
        keys:        string[];
        clicks:      number;
        impressions: number;
        position:    number;
      }>;
    };

    const queries: GscQuery[] = (json.rows ?? [])
      .map(r => ({
        term:        r.keys[0] ?? "",
        clicks:      Math.round(r.clicks),
        impressions: Math.round(r.impressions),
        position:    r.position ? Math.round(r.position) : null,
      }))
      .sort((a, b) => b.impressions - a.impressions);

    return { queries };
  });

export const syncGscToKeywords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      siteId:      z.string().uuid(),
      propertyUrl: z.string(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Load the site + its keywords
    const { data: siteRow } = await sb
      .from("growthmind_seo_sites")
      .select("keywords")
      .eq("id", data.siteId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!siteRow) throw new Error("Site not found");
    const keywords: SeoKeyword[] = siteRow.keywords ?? [];
    if (keywords.length === 0) return { matched: 0 };

    // Fetch GSC data — up to 500 rows to maximise match rate
    const { data: settings } = await sb
      .from("workspace_settings")
      .select("gsc_access_token, gsc_refresh_token, gsc_token_expiry")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!settings?.gsc_access_token) throw new Error("Google Search Console is not connected");

    let accessToken: string = settings.gsc_access_token;

    if (settings.gsc_token_expiry) {
      const expiry = new Date(settings.gsc_token_expiry).getTime();
      if (Date.now() > expiry - 60_000 && settings.gsc_refresh_token) {
        accessToken = await refreshGscToken(sb, workspaceId, settings.gsc_refresh_token);
      }
    }

    const endDate   = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 90);
    const fmtDate = (d: Date) => d.toISOString().split("T")[0];

    const encodedUrl = buildGscEncodedSiteUrl(data.propertyUrl);
    const res = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodedUrl}/searchAnalytics/query`,
      {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate:  fmtDate(startDate),
          endDate:    fmtDate(endDate),
          dimensions: ["query"],
          rowLimit:   500,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GSC Search Analytics error: ${err}`);
    }

    const gscJson = await res.json() as {
      rows?: Array<{
        keys:        string[];
        clicks:      number;
        impressions: number;
        position:    number;
      }>;
    };

    // Build lookup map: lowercased term → GSC metrics
    const gscMap = new Map<string, { clicks: number; impressions: number; position: number | null }>();
    for (const row of gscJson.rows ?? []) {
      const term = (row.keys[0] ?? "").toLowerCase();
      gscMap.set(term, {
        clicks:      Math.round(row.clicks),
        impressions: Math.round(row.impressions),
        position:    row.position ? Math.round(row.position * 10) / 10 : null,
      });
    }

    // Merge GSC data into tracked keywords
    let matched = 0;
    const updated: SeoKeyword[] = keywords.map(kw => {
      const gsc = gscMap.get(kw.term.toLowerCase());
      if (!gsc) return kw;
      matched++;
      return {
        ...kw,
        gsc_clicks:      gsc.clicks,
        gsc_impressions: gsc.impressions,
        gsc_position:    gsc.position,
      };
    });

    // Persist updated keywords
    const now = new Date().toISOString();
    const { error } = await sb
      .from("growthmind_seo_sites")
      .update({ keywords: updated, updated_at: now })
      .eq("id", data.siteId)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);

    return { matched, total: keywords.length };
  });

// ── SEO Briefs ────────────────────────────────────────────────────────────────

export type SeoBrief = {
  id:           string;
  url:          string;
  pageTitle:    string | null;
  brief:        string;
  targetKws:    string[];
  wordCount:    number | null;
  metaTitle:    string | null;
  metaDesc:     string | null;
  score:        number | null;
  generatedAt:  string;
  createdAt:    string;
};

export const listSeoBriefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_seo_briefs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("generated_at", { ascending: false })
      .limit(100);

    if (error && error.code !== "42P01") throw new Error(error.message);
    const briefs: SeoBrief[] = (data ?? []).map((r: any) => ({
      id:          r.id,
      url:         r.url,
      pageTitle:   r.page_title ?? null,
      brief:       r.brief,
      targetKws:   r.target_kws ?? [],
      wordCount:   r.word_count ?? null,
      metaTitle:   r.meta_title ?? null,
      metaDesc:    r.meta_desc ?? null,
      score:       r.score ?? null,
      generatedAt: r.generated_at,
      createdAt:   r.created_at,
    }));
    return { briefs };
  });

export const generateSeoBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      url:        z.string().url(),
      pageTitle:  z.string().max(300).default(""),
      targetKws:  z.array(z.string()).default([]),
      wordCount:  z.number().int().nullable().default(null),
    }).parse(input)
  )
  .handler(async ({ context, data: input }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const dnaRes = await sb
      .from("growthmind_business_dna")
      .select("company_name, industry, services, products, unique_selling_points, ideal_customer_profiles, brand_voice")
      .eq("workspace_id", workspaceId)
      .maybeSingle()
      .catch(() => ({ data: null }));

    const dna = dnaRes?.data;
    const dnaCtx = dna
      ? [
          dna.company_name ? `Company: ${dna.company_name}` : "",
          dna.industry     ? `Industry: ${dna.industry}` : "",
          dna.services     ? `Services: ${dna.services}` : "",
          dna.products     ? `Products: ${dna.products}` : "",
          dna.unique_selling_points ? `USPs: ${dna.unique_selling_points}` : "",
          dna.ideal_customer_profiles ? `Ideal Customers: ${dna.ideal_customer_profiles}` : "",
          dna.brand_voice  ? `Brand Voice: ${dna.brand_voice}` : "",
        ].filter(Boolean).join("\n")
      : "No business DNA configured.";

    const kwList = input.targetKws.length > 0 ? input.targetKws.join(", ") : "Not specified";

    const prompt = `You are GrowthMind, an expert SEO strategist and content architect.

## Business Context
${dnaCtx}

## Page Details
- URL: ${input.url}
- Page Title: ${input.pageTitle || "Not specified"}
- Target Keywords: ${kwList}
- Target Word Count: ${input.wordCount ? `~${input.wordCount} words` : "Not specified"}

## Instructions
Generate a detailed on-page SEO brief. Respond ONLY with valid JSON (no markdown):
{
  "brief": "Full SEO brief with: purpose of page, content strategy, H1/H2/H3 structure, internal linking suggestions, semantic keywords to include, E-E-A-T signals to add, conversion intent alignment",
  "metaTitle": "Optimised meta title (50-60 chars)",
  "metaDesc": "Optimised meta description (140-160 chars)",
  "score": 75,
  "improvements": ["improvement 1", "improvement 2", "improvement 3"]
}

The brief should be specific, actionable, and tailored to the business above.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model:       "gpt-4o-mini",
        messages:    [{ role: "user", content: prompt }],
        temperature: 0.5,
        max_tokens:  1500,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
    }

    const json = await res.json() as any;
    const raw  = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try {
      const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = { brief: raw, metaTitle: "", metaDesc: "", score: null, improvements: [] };
    }

    const now = new Date().toISOString();
    const { data: row, error: insErr } = await sb
      .from("growthmind_seo_briefs")
      .insert({
        workspace_id: workspaceId,
        url:          input.url,
        page_title:   input.pageTitle || null,
        brief:        parsed.brief ?? "",
        target_kws:   input.targetKws,
        word_count:   input.wordCount,
        meta_title:   parsed.metaTitle ?? null,
        meta_desc:    parsed.metaDesc ?? null,
        score:        parsed.score ?? null,
        generated_at: now,
        created_at:   now,
      })
      .select("*")
      .single();

    if (insErr) throw new Error(insErr.message);

    return {
      brief: {
        id:          row.id,
        url:         row.url,
        pageTitle:   row.page_title ?? null,
        brief:       row.brief,
        targetKws:   row.target_kws ?? [],
        wordCount:   row.word_count ?? null,
        metaTitle:   row.meta_title ?? null,
        metaDesc:    row.meta_desc ?? null,
        score:       row.score ?? null,
        generatedAt: row.generated_at,
        createdAt:   row.created_at,
      } as SeoBrief,
      improvements: (parsed.improvements ?? []) as string[],
    };
  });

export const deleteSeoBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_seo_briefs")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Content Gap Analysis ──────────────────────────────────────────────────────

export type ContentGapResult = {
  generatedAt:   string;
  gaps:          ContentGap[];
  quickWins:     string[];
  opportunities: string[];
};

export type ContentGap = {
  topic:       string;
  keywords:    string[];
  intent:      "informational" | "navigational" | "transactional" | "commercial";
  priority:    "high" | "medium" | "low";
  rationale:   string;
};

export const generateContentGap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const [dnaRes, siteRes, competitorsRes] = await Promise.all([
      sb.from("growthmind_business_dna")
        .select("*")
        .eq("workspace_id", workspaceId)
        .maybeSingle()
        .catch(() => ({ data: null })),
      sb.from("growthmind_seo_sites")
        .select("keywords, content_ideas")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
        .catch(() => ({ data: null })),
      sb.from("growthmind_competitors")
        .select("name, website, services, positioning")
        .eq("workspace_id", workspaceId)
        .limit(10)
        .catch(() => ({ data: [] })),
    ]);

    const dna = dnaRes?.data;
    const site = siteRes?.data;
    const competitors = competitorsRes?.data ?? [];

    const dnaCtx = dna
      ? [
          dna.company_name ? `Company: ${dna.company_name}` : "",
          dna.industry     ? `Industry: ${dna.industry}` : "",
          dna.services     ? `Services: ${dna.services}` : "",
          dna.products     ? `Products: ${dna.products}` : "",
          dna.unique_selling_points ? `USPs: ${dna.unique_selling_points}` : "",
          dna.ideal_customer_profiles ? `Ideal Customers: ${dna.ideal_customer_profiles}` : "",
          dna.target_markets ? `Target Markets: ${dna.target_markets}` : "",
          dna.competitors_summary ? `Competitor Notes: ${dna.competitors_summary}` : "",
        ].filter(Boolean).join("\n")
      : "No business DNA configured.";

    const trackedKws = ((site?.keywords ?? []) as any[]).map((k: any) => k.term).join(", ") || "None tracked";
    const contentIdeas = ((site?.content_ideas ?? []) as any[]).map((c: any) => c.title).join(", ") || "None";
    const competitorCtx = competitors.length > 0
      ? competitors.map((c: any) => `- ${c.name} (${c.website}): ${c.services || ""} ${c.positioning || ""}`).join("\n")
      : "No competitors tracked.";

    const prompt = `You are GrowthMind, an expert SEO strategist.

## Business Context
${dnaCtx}

## Current SEO State
- Tracked keywords: ${trackedKws}
- Existing content ideas: ${contentIdeas}

## Competitors
${competitorCtx}

## Instructions
Identify content gaps — topics and keywords the business should be ranking for but isn't targeting. Respond ONLY with valid JSON (no markdown):
{
  "gaps": [
    {
      "topic": "Topic/content page idea",
      "keywords": ["primary keyword", "secondary kw"],
      "intent": "informational|navigational|transactional|commercial",
      "priority": "high|medium|low",
      "rationale": "Why this gap matters for this business"
    }
  ],
  "quickWins": ["3-5 quick win opportunities the business can act on this week"],
  "opportunities": ["3-5 bigger strategic opportunities"]
}

Return 8-12 gaps. Focus on topics that directly support the business's revenue goals and ideal customer profile.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model:       "gpt-4o-mini",
        messages:    [{ role: "user", content: prompt }],
        temperature: 0.6,
        max_tokens:  2000,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
    }

    const json = await res.json() as any;
    const raw  = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try {
      const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      throw new Error("Failed to parse AI content gap response");
    }

    return {
      generatedAt:   new Date().toISOString(),
      gaps:          (parsed.gaps          ?? []) as ContentGap[],
      quickWins:     (parsed.quickWins     ?? []) as string[],
      opportunities: (parsed.opportunities ?? []) as string[],
    } as ContentGapResult;
  });

// ── Meta Tag Generator ────────────────────────────────────────────────────────

export type MetaTagResult = {
  url:         string;
  metaTitle:   string;
  metaDesc:    string;
  ogTitle:     string;
  ogDesc:      string;
  slug:        string;
  h1:          string;
  schema:      string;
};

export const generateMetaTags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      url:        z.string().url(),
      pageTitle:  z.string().max(300).default(""),
      targetKw:   z.string().max(200).default(""),
      pageType:   z.enum(["homepage","service","product","blog","about","contact","landing"]).default("service"),
    }).parse(input)
  )
  .handler(async ({ context, data: input }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const dnaRes = await sb
      .from("growthmind_business_dna")
      .select("company_name, industry, services, unique_selling_points, brand_voice, locations")
      .eq("workspace_id", workspaceId)
      .maybeSingle()
      .catch(() => ({ data: null }));

    const dna = dnaRes?.data;
    const dnaCtx = dna
      ? [
          dna.company_name ? `Company: ${dna.company_name}` : "",
          dna.industry     ? `Industry: ${dna.industry}` : "",
          dna.services     ? `Services: ${dna.services}` : "",
          dna.unique_selling_points ? `USPs: ${dna.unique_selling_points}` : "",
          dna.brand_voice  ? `Brand Voice: ${dna.brand_voice}` : "",
          dna.locations    ? `Locations: ${dna.locations}` : "",
        ].filter(Boolean).join("\n")
      : "No business DNA configured.";

    const prompt = `You are GrowthMind, an expert technical SEO specialist.

## Business Context
${dnaCtx}

## Page Request
- URL: ${input.url}
- Page Title/Topic: ${input.pageTitle || "Not specified"}
- Primary Target Keyword: ${input.targetKw || "Not specified"}
- Page Type: ${input.pageType}

## Instructions
Generate optimised meta tags and page SEO elements. Respond ONLY with valid JSON (no markdown):
{
  "metaTitle": "Meta title 50-60 chars, include primary keyword near start",
  "metaDesc": "Meta description 140-160 chars, compelling, include keyword naturally",
  "ogTitle": "Open Graph title for social sharing (can be slightly more engaging)",
  "ogDesc": "OG description for social sharing",
  "slug": "url-friendly-slug-for-this-page",
  "h1": "H1 heading for the page",
  "schema": "JSON-LD schema markup as a string (LocalBusiness or Service schema appropriate for this page)"
}

Optimise for both search engines and click-through rate. Make the meta description a genuine value proposition.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model:       "gpt-4o-mini",
        messages:    [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens:  1000,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
    }

    const json = await res.json() as any;
    const raw  = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try {
      const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      throw new Error("Failed to parse AI meta tag response");
    }

    return {
      url:       input.url,
      metaTitle: parsed.metaTitle ?? "",
      metaDesc:  parsed.metaDesc  ?? "",
      ogTitle:   parsed.ogTitle   ?? "",
      ogDesc:    parsed.ogDesc    ?? "",
      slug:      parsed.slug      ?? "",
      h1:        parsed.h1        ?? "",
      schema:    parsed.schema    ?? "",
    } as MetaTagResult;
  });
