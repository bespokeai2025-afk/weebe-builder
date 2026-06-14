import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Platform types ───────────────────────────────────────────────────────────────
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
  has_token:  boolean;   // token_enc is NEVER returned to the client
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

// ── Encryption helpers ─────────────────────────────────────────────────────────
// AES-256-GCM with a 32-byte key derived from TOKEN_ENCRYPTION_KEY env var.
// Falls back to hashing SUPABASE_SERVICE_ROLE_KEY if TOKEN_ENCRYPTION_KEY is absent.
// Format stored in DB: <iv_hex>:<authTag_hex>:<ciphertext_hex>
// Uses dynamic import so the Node crypto module is never bundled into the client.

async function getEncryptionKey(): Promise<Buffer> {
  const { createHash } = await import("crypto");
  const raw =
    process.env.TOKEN_ENCRYPTION_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "growthmind-fallback-key-not-for-production";
  return createHash("sha256").update(raw).digest(); // always 32 bytes
}

async function encryptToken(plaintext: string): Promise<string> {
  const { createCipheriv, randomBytes } = await import("crypto");
  const key = await getEncryptionKey();
  const iv  = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

// Server-side only — never called from any client path
export async function decryptToken(stored: string): Promise<string> {
  const { createDecipheriv } = await import("crypto");
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid token format");
  const [ivHex, tagHex, ctHex] = parts;
  const key      = await getEncryptionKey();
  const iv       = Buffer.from(ivHex,  "hex");
  const tag      = Buffer.from(tagHex, "hex");
  const ct       = Buffer.from(ctHex,  "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
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
      token:      z.string().optional(),       // raw token — encrypted before storage
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

    // Encrypt token before storing — only updated when a new token is supplied
    if (data.token && data.token.trim()) {
      row.token_enc = await encryptToken(data.token.trim());
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

// ── Delete an ad account (campaigns cascade-deleted by FK) ────────────────────
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

// ── Get campaigns for an account (or all for the workspace) ───────────────────
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

// ── Save a campaign row (create or update) ────────────────────────────────────
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
    // Note: cpl is a generated/computed column — do NOT include it in insert/update
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

// ── Delete a campaign ─────────────────────────────────────────────────────────
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

// ── Generate AI ad recommendations and persist to growthmind_recommendations ──
export const getAdsRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      accounts:  z.array(z.any()),
      campaigns: z.array(z.any()),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;

    const { accounts, campaigns } = data;

    if (!apiKey || campaigns.length === 0) {
      const fallback = [{
        priority: "medium",
        title:    "No ad campaign data logged yet",
        detail:   "Connect an ad account and log your first campaign to unlock AI-powered budget recommendations.",
      }];
      return { recommendations: fallback };
    }

    // Aggregate by platform
    const byPlatform: Record<string, { spend: number; conversions: number; clicks: number; impressions: number; roas?: number; campaigns: any[] }> = {};
    for (const c of campaigns) {
      if (!byPlatform[c.platform]) byPlatform[c.platform] = { spend: 0, conversions: 0, clicks: 0, impressions: 0, campaigns: [] };
      byPlatform[c.platform].spend       += Number(c.spend ?? 0);
      byPlatform[c.platform].conversions += Number(c.conversions ?? 0);
      byPlatform[c.platform].clicks      += Number(c.clicks ?? 0);
      byPlatform[c.platform].impressions += Number(c.impressions ?? 0);
      if (c.roas) byPlatform[c.platform].roas = Number(c.roas);
      byPlatform[c.platform].campaigns.push(c);
    }

    const totalSpend       = campaigns.reduce((s: number, c: any) => s + Number(c.spend ?? 0), 0);
    const totalConversions = campaigns.reduce((s: number, c: any) => s + Number(c.conversions ?? 0), 0);
    const avgCPL           = totalConversions > 0 ? (totalSpend / totalConversions).toFixed(2) : "N/A";

    const prompt = `You are GrowthMind, an AI Chief Marketing Officer. Analyse this paid advertising data and return 3-5 specific, actionable recommendations.

AD ACCOUNT SUMMARY:
Connected platforms: ${accounts.map((a: any) => a.platform).join(", ") || "none"}
Total campaigns logged: ${campaigns.length}
Total ad spend: £${totalSpend.toFixed(2)}
Total conversions: ${totalConversions}
Blended CPL: £${avgCPL}

BY PLATFORM:
${Object.entries(byPlatform).map(([platform, stats]) => {
  const cpl = stats.conversions > 0 ? (stats.spend / stats.conversions).toFixed(2) : "N/A";
  const ctr = stats.impressions > 0 ? ((stats.clicks / stats.impressions) * 100).toFixed(2) : "N/A";
  return `${platform.toUpperCase()}: spend=£${stats.spend.toFixed(2)}, conversions=${stats.conversions}, CPL=£${cpl}, CTR=${ctr}%, ROAS=${stats.roas ?? "not set"}, campaigns=${stats.campaigns.length}`;
}).join("\n")}

TOP CAMPAIGNS BY SPEND:
${[...campaigns]
  .sort((a: any, b: any) => Number(b.spend) - Number(a.spend))
  .slice(0, 5)
  .map((c: any) => `  - "${c.name}" (${c.platform}): spend=£${Number(c.spend).toFixed(2)}, conversions=${c.conversions}, ROAS=${c.roas ?? "?"}, status=${c.status}`)
  .join("\n")}

Respond ONLY with a JSON array — no other text:
[{"priority":"high|medium|low","title":"short title (max 10 words)","detail":"specific action with numbers (max 40 words)"}]`;

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
      const content = (json.choices?.[0]?.message?.content as string ?? "[]").trim();
      const recs: Array<{ priority: string; title: string; detail: string }> = JSON.parse(content);
      if (!Array.isArray(recs)) return { recommendations: [] };

      // ── Persist to growthmind_recommendations ────────────────────────────────
      // Upsert ads-category recs so GrowthMind overview can surface them
      try {
        await sb
          .from("growthmind_recommendations")
          .delete()
          .eq("workspace_id", workspaceId)
          .eq("category", "Advertising");

        if (recs.length > 0) {
          const now = new Date().toISOString();
          const rows = recs.map(r => ({
            workspace_id:  workspaceId,
            category:      "Advertising",
            priority:      r.priority,
            problem:       r.title,
            impact:        r.detail,
            fix:           r.detail,
            action_href:   "/growthmind/ads",
            action_label:  "View Ads",
            is_dismissed:  false,
            refreshed_at:  now,
          }));
          await sb.from("growthmind_recommendations").insert(rows);
        }
      } catch {
        // Persist failure is non-fatal — still return recs to the UI
      }

      return { recommendations: recs };
    } catch {
      return { recommendations: [] };
    }
  });
