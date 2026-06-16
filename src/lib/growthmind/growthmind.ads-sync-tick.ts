// ── Ads Sync Tick — platform-wide cron entry point ────────────────────────────
// SERVER ONLY. Imported by the Vite plugin (dev) and public API route (prod).
// Uses createClient directly (no @/ alias) so it is safe to import from
// vite.config.ts at config-load time — same pattern as cmo-analysis-tick.ts.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function getAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface AdsSyncResult {
  platform:         "meta" | "google";
  workspaceId:      string;
  campaignsSynced:  number;
  spendTotal:       number;
  impressionsTotal: number;
  clicksTotal:      number;
  conversionsTotal: number;
  status:           "success" | "error" | "skipped";
  error?:           string;
}

export interface AdsSyncSummary {
  results: AdsSyncResult[];
  synced:  number;
  errors:  number;
  skipped: number;
}

// ── Credential readers ─────────────────────────────────────────────────────────

async function getMetaCreds(sb: ReturnType<typeof getAdminClient>, workspaceId: string): Promise<{ accessToken: string; accountId: string } | null> {
  const { data: ws } = await sb
    .from("workspace_settings")
    .select("meta_ads_access_token, meta_ads_account_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if ((ws as any)?.meta_ads_access_token && (ws as any)?.meta_ads_account_id) {
    return { accessToken: (ws as any).meta_ads_access_token, accountId: (ws as any).meta_ads_account_id };
  }

  const { data: ps } = await sb
    .from("provider_settings")
    .select("credentials")
    .eq("workspace_id", workspaceId)
    .eq("provider_category", "advertising")
    .eq("provider_name", "meta_ads")
    .maybeSingle();

  const c = (ps as any)?.credentials as Record<string, string> | undefined;
  if (c?.accessToken && c?.accountId) {
    return { accessToken: c.accessToken, accountId: c.accountId };
  }
  return null;
}

async function getGoogleCreds(sb: ReturnType<typeof getAdminClient>, workspaceId: string): Promise<{
  developerToken: string;
  customerId:     string;
  accessToken?:   string;
  refreshToken?:  string;
  clientId?:      string;
  clientSecret?:  string;
} | null> {
  const { data: ps } = await sb
    .from("provider_settings")
    .select("credentials")
    .eq("workspace_id", workspaceId)
    .eq("provider_category", "advertising")
    .eq("provider_name", "google_ads")
    .maybeSingle();

  const c = (ps as any)?.credentials as Record<string, string> | undefined;
  if (!c?.developerToken || !c?.customerId) return null;
  return {
    developerToken: c.developerToken,
    customerId:     c.customerId,
    accessToken:    c.accessToken,
    refreshToken:   c.refreshToken,
    clientId:       c.clientId,
    clientSecret:   c.clientSecret,
  };
}

// ── Campaign upsert helper ─────────────────────────────────────────────────────

async function upsertCampaigns(sb: ReturnType<typeof getAdminClient>, workspaceId: string, campaigns: any[]): Promise<void> {
  if (campaigns.length === 0) return;
  const now  = new Date().toISOString();
  const rows = campaigns.map((c: any) => ({
    workspace_id: workspaceId,
    platform:     c.platform,
    name:         c.name,
    external_id:  c.externalId,
    status:       c.status === "active" || c.status === "enabled" ? "active" : "paused",
    spend:        c.spend,
    impressions:  c.impressions,
    clicks:       c.clicks,
    conversions:  c.conversions,
    revenue:      c.revenue ?? 0,
    roas:         c.roas,
    date_start:   c.dateStart || null,
    date_end:     c.dateEnd   || null,
    synced_at:    now,
    updated_at:   now,
  }));

  const { error } = await sb
    .from("growthmind_campaigns")
    .upsert(rows, { onConflict: "workspace_id,platform,external_id,date_start" });

  if (error) {
    for (const row of rows) {
      await sb.from("growthmind_campaigns")
        .upsert(row, { onConflict: "workspace_id,platform,external_id" })
        .catch(() => {});
    }
  }
}

// ── Per-workspace sync ─────────────────────────────────────────────────────────

async function syncWorkspace(sb: ReturnType<typeof getAdminClient>, workspaceId: string): Promise<AdsSyncResult[]> {
  const results: AdsSyncResult[] = [];

  // ── Meta ────────────────────────────────────────────────────────────────────
  const metaCreds = await getMetaCreds(sb, workspaceId);
  if (metaCreds) {
    try {
      const { syncMetaAdsCampaigns } = await import("./ads-sync-meta.server");
      const campaigns = await syncMetaAdsCampaigns(metaCreds.accessToken, metaCreds.accountId);
      await upsertCampaigns(sb, workspaceId, campaigns);

      const totals = campaigns.reduce(
        (a, c) => ({ spend: a.spend + c.spend, impressions: a.impressions + c.impressions, clicks: a.clicks + c.clicks, conversions: a.conversions + c.conversions }),
        { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
      );

      await sb.from("growthmind_ad_performance_log").insert({
        workspace_id: workspaceId, platform: "meta",
        campaigns_synced: campaigns.length, spend_total: totals.spend,
        impressions_total: totals.impressions, clicks_total: totals.clicks,
        conversions_total: totals.conversions, status: "success",
      }).catch(() => {});

      results.push({ platform: "meta", workspaceId, campaignsSynced: campaigns.length, spendTotal: totals.spend, impressionsTotal: totals.impressions, clicksTotal: totals.clicks, conversionsTotal: totals.conversions, status: "success" });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await sb.from("growthmind_ad_performance_log").insert({ workspace_id: workspaceId, platform: "meta", status: "error", error_message: msg }).catch(() => {});
      results.push({ platform: "meta", workspaceId, campaignsSynced: 0, spendTotal: 0, impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0, status: "error", error: msg });
    }
  } else {
    results.push({ platform: "meta", workspaceId, campaignsSynced: 0, spendTotal: 0, impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0, status: "skipped" });
  }

  // ── Google ──────────────────────────────────────────────────────────────────
  const gCreds = await getGoogleCreds(sb, workspaceId);
  if (gCreds) {
    try {
      const { syncGoogleAdsCampaigns } = await import("./ads-sync-google.server");
      const campaigns = await syncGoogleAdsCampaigns(gCreds);
      await upsertCampaigns(sb, workspaceId, campaigns);

      const totals = campaigns.reduce(
        (a, c) => ({ spend: a.spend + c.spend, impressions: a.impressions + c.impressions, clicks: a.clicks + c.clicks, conversions: a.conversions + c.conversions }),
        { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
      );

      await sb.from("growthmind_ad_performance_log").insert({
        workspace_id: workspaceId, platform: "google",
        campaigns_synced: campaigns.length, spend_total: totals.spend,
        impressions_total: totals.impressions, clicks_total: totals.clicks,
        conversions_total: totals.conversions, status: "success",
      }).catch(() => {});

      results.push({ platform: "google", workspaceId, campaignsSynced: campaigns.length, spendTotal: totals.spend, impressionsTotal: totals.impressions, clicksTotal: totals.clicks, conversionsTotal: totals.conversions, status: "success" });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await sb.from("growthmind_ad_performance_log").insert({ workspace_id: workspaceId, platform: "google", status: "error", error_message: msg }).catch(() => {});
      results.push({ platform: "google", workspaceId, campaignsSynced: 0, spendTotal: 0, impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0, status: "error", error: msg });
    }
  } else {
    results.push({ platform: "google", workspaceId, campaignsSynced: 0, spendTotal: 0, impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0, status: "skipped" });
  }

  return results;
}

// ── Platform tick ─────────────────────────────────────────────────────────────

export async function runAdsSyncTick(): Promise<AdsSyncSummary> {
  const sb = getAdminClient();
  const workspaceSet = new Set<string>();

  const [wsRows, psRows] = await Promise.all([
    sb.from("workspace_settings").select("workspace_id")
      .not("meta_ads_access_token", "is", null),
    sb.from("provider_settings").select("workspace_id")
      .eq("provider_category", "advertising").eq("status", "connected"),
  ]);

  for (const r of wsRows?.data  ?? []) workspaceSet.add((r as any).workspace_id);
  for (const r of psRows?.data  ?? []) workspaceSet.add((r as any).workspace_id);

  const allResults: AdsSyncResult[] = [];
  for (const wid of workspaceSet) {
    const res = await syncWorkspace(sb, wid).catch(err => {
      console.error(`[ads-sync] workspace ${wid} error:`, err?.message);
      return [] as AdsSyncResult[];
    });
    allResults.push(...res);
  }

  const summary: AdsSyncSummary = {
    results: allResults,
    synced:  allResults.filter(r => r.status === "success").length,
    errors:  allResults.filter(r => r.status === "error").length,
    skipped: allResults.filter(r => r.status === "skipped").length,
  };

  console.log(`[ads-sync] tick done — synced=${summary.synced} errors=${summary.errors} skipped=${summary.skipped}`);
  return summary;
}
