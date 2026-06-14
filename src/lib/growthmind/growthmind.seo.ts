import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export const getGscAuthUrl = createServerFn({ method: "GET" })
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

    const siteUrl    = data.propertyUrl;
    const encodedUrl = encodeURIComponent(siteUrl);

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

    const encodedUrl = encodeURIComponent(data.propertyUrl);
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
