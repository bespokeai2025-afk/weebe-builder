import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Platform type ───────────────────────────────────────────────────────────────
export type AdsPlatform = "google" | "meta" | "linkedin" | "tiktok";
export type AdsAccountStatus = "active" | "paused" | "disconnected";
export type CampaignStatus = "active" | "paused" | "ended";

export interface AdsAccount {
  id:         string;
  platform:   AdsPlatform;
  label:      string;
  account_id: string;
  status:     AdsAccountStatus;
  created_at: string;
  updated_at: string;
  // token_enc is NEVER returned to the client
  has_token:  boolean;
}

export interface AdsCampaign {
  id:             string;
  ads_account_id: string;
  platform:       AdsPlatform;
  name:           string;
  status:         CampaignStatus;
  spend:          number;
  impressions:    number;
  clicks:         number;
  conversions:    number;
  cpl:            number | null;
  roas:           number | null;
  period_start:   string | null;
  period_end:     string | null;
  created_at:     string;
  updated_at:     string;
}

// ── Get all ad accounts for the workspace ──────────────────────────────────────
export const getAdsAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_ads_accounts")
      .select("id, platform, label, account_id, status, token_enc, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) return { accounts: [] as AdsAccount[] };

    const accounts: AdsAccount[] = (data ?? []).map((r: any) => ({
      id:         r.id,
      platform:   r.platform,
      label:      r.label,
      account_id: r.account_id,
      status:     r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      has_token:  !!r.token_enc,
      // token_enc intentionally omitted — never returned to client
    }));

    return { accounts };
  });

// ── Create or update an ad account connection ──────────────────────────────────
export const saveAdsAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:         z.string().uuid().optional(),
      platform:   z.enum(["google", "meta", "linkedin", "tiktok"]),
      label:      z.string().min(1).max(120),
      account_id: z.string().min(1).max(200),
      token:      z.string().optional(),       // raw token — stored server-side only
      status:     z.enum(["active", "paused", "disconnected"]).default("active"),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const now = new Date().toISOString();
    const row: Record<string, any> = {
      workspace_id: workspaceId,
      platform:     data.platform,
      label:        data.label,
      account_id:   data.account_id,
      status:       data.status,
      updated_at:   now,
    };

    // Only set token_enc when a new token is provided
    if (data.token && data.token.trim()) {
      row.token_enc = data.token.trim();
    }

    let result: any;
    if (data.id) {
      const { data: updated, error } = await sb
        .from("growthmind_ads_accounts")
        .update(row)
        .eq("id", data.id)
        .eq("workspace_id", workspaceId)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      result = updated;
    } else {
      row.created_at = now;
      const { data: inserted, error } = await sb
        .from("growthmind_ads_accounts")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      result = inserted;
    }

    return { ok: true, id: result.id };
  });

// ── Delete an ad account (and cascade deletes its campaigns) ───────────────────
export const deleteAdsAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_ads_accounts")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Get campaigns for an account (or all for the workspace) ────────────────────
export const getAdsCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid().optional() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    let query = sb
      .from("growthmind_campaigns")
      .select("id, ads_account_id, platform, name, status, spend, impressions, clicks, conversions, cpl, roas, period_start, period_end, created_at, updated_at")
      .eq("workspace_id", workspaceId);

    if (data.accountId) {
      query = query.eq("ads_account_id", data.accountId);
    }

    const { data: rows, error } = await query.order("created_at", { ascending: false }).limit(200);
    if (error) return { campaigns: [] as AdsCampaign[] };

    return { campaigns: (rows ?? []) as AdsCampaign[] };
  });

// ── Save a campaign row (create or update) ─────────────────────────────────────
export const saveAdsCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:             z.string().uuid().optional(),
      ads_account_id: z.string().uuid(),
      platform:       z.enum(["google", "meta", "linkedin", "tiktok"]),
      name:           z.string().min(1).max(200),
      status:         z.enum(["active", "paused", "ended"]).default("active"),
      spend:          z.number().min(0).default(0),
      impressions:    z.number().int().min(0).default(0),
      clicks:         z.number().int().min(0).default(0),
      conversions:    z.number().int().min(0).default(0),
      roas:           z.number().min(0).nullable().optional(),
      period_start:   z.string().nullable().optional(),
      period_end:     z.string().nullable().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Verify the account belongs to this workspace
    const { data: acct } = await sb
      .from("growthmind_ads_accounts")
      .select("id")
      .eq("id", data.ads_account_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!acct) throw new Error("Account not found or not in workspace");

    const now = new Date().toISOString();
    const row: Record<string, any> = {
      workspace_id:   workspaceId,
      ads_account_id: data.ads_account_id,
      platform:       data.platform,
      name:           data.name,
      status:         data.status,
      spend:          data.spend,
      impressions:    data.impressions,
      clicks:         data.clicks,
      conversions:    data.conversions,
      roas:           data.roas ?? null,
      period_start:   data.period_start ?? null,
      period_end:     data.period_end ?? null,
      updated_at:     now,
    };

    let result: any;
    if (data.id) {
      const { data: updated, error } = await sb
        .from("growthmind_campaigns")
        .update(row)
        .eq("id", data.id)
        .eq("workspace_id", workspaceId)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      result = updated;
    } else {
      row.created_at = now;
      const { data: inserted, error } = await sb
        .from("growthmind_campaigns")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      result = inserted;
    }

    return { ok: true, id: result.id };
  });

// ── Delete a campaign ──────────────────────────────────────────────────────────
export const deleteAdsCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_campaigns")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Generate AI recommendations from campaign data ─────────────────────────────
export const getAdsRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      accounts:  z.array(z.any()),
      campaigns: z.array(z.any()),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
    if (!apiKey) return { recommendations: [] };

    const { accounts, campaigns } = data;
    if (campaigns.length === 0) {
      return { recommendations: [
        {
          priority: "medium",
          title:    "No ad campaign data logged yet",
          detail:   "Connect an ad account and log your first campaign to unlock AI-powered budget recommendations.",
        },
      ]};
    }

    // Aggregate by platform
    const byPlatform: Record<string, { spend: number; conversions: number; clicks: number; roas?: number; campaigns: any[] }> = {};
    for (const c of campaigns) {
      if (!byPlatform[c.platform]) byPlatform[c.platform] = { spend: 0, conversions: 0, clicks: 0, campaigns: [] };
      byPlatform[c.platform].spend       += Number(c.spend ?? 0);
      byPlatform[c.platform].conversions += Number(c.conversions ?? 0);
      byPlatform[c.platform].clicks      += Number(c.clicks ?? 0);
      if (c.roas) byPlatform[c.platform].roas = c.roas;
      byPlatform[c.platform].campaigns.push(c);
    }

    const totalSpend = campaigns.reduce((s, c) => s + Number(c.spend ?? 0), 0);
    const totalConversions = campaigns.reduce((s, c) => s + Number(c.conversions ?? 0), 0);
    const avgCPL = totalConversions > 0 ? (totalSpend / totalConversions).toFixed(2) : "N/A";

    const prompt = `You are GrowthMind, an AI Chief Marketing Officer. Analyse this paid advertising data and give 3-5 specific, actionable recommendations.

AD ACCOUNT SUMMARY:
Connected platforms: ${accounts.map((a: any) => a.platform).join(", ") || "none"}
Total campaigns logged: ${campaigns.length}
Total ad spend: £${totalSpend.toFixed(2)}
Total conversions: ${totalConversions}
Blended CPL: £${avgCPL}

BY PLATFORM:
${Object.entries(byPlatform).map(([platform, stats]) => {
  const cpl = stats.conversions > 0 ? (stats.spend / stats.conversions).toFixed(2) : "N/A";
  return `${platform.toUpperCase()}: spend=£${stats.spend.toFixed(2)}, conversions=${stats.conversions}, CPL=£${cpl}, ROAS=${stats.roas ?? "not set"}, campaigns=${stats.campaigns.length}`;
}).join("\n")}

TOP CAMPAIGNS (by spend):
${campaigns
  .sort((a: any, b: any) => Number(b.spend) - Number(a.spend))
  .slice(0, 5)
  .map((c: any) => `  - ${c.name} (${c.platform}): spend=£${Number(c.spend).toFixed(2)}, conversions=${c.conversions}, ROAS=${c.roas ?? "?"}, status=${c.status}`)
  .join("\n")}

Provide exactly 3-5 recommendations as a JSON array with this shape:
[{"priority":"high|medium|low","title":"short title","detail":"specific action with numbers"}]
Respond ONLY with the JSON array, no other text.`;

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 600,
          temperature: 0.5,
        }),
      });
      if (!res.ok) return { recommendations: [] };
      const json = await res.json() as any;
      const content = json.choices?.[0]?.message?.content ?? "[]";
      const recs = JSON.parse(content.trim());
      return { recommendations: Array.isArray(recs) ? recs : [] };
    } catch {
      return { recommendations: [] };
    }
  });
