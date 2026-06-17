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
  platform:         "meta" | "google" | "tiktok" | "linkedin";
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
  // Form key is adAccountId; legacy rows may have accountId
  const accountId = c?.adAccountId || c?.accountId;
  if (c?.accessToken && accountId) {
    return { accessToken: c.accessToken, accountId };
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

async function getLinkedInCreds(sb: ReturnType<typeof getAdminClient>, workspaceId: string): Promise<{ accessToken: string; accountId: string } | null> {
  const { data: ps } = await sb
    .from("provider_settings")
    .select("credentials")
    .eq("workspace_id", workspaceId)
    .eq("provider_category", "advertising")
    .eq("provider_name", "linkedin_ads")
    .maybeSingle();

  const c = (ps as any)?.credentials as Record<string, string> | undefined;
  if (c?.accessToken && c?.accountId) {
    return { accessToken: c.accessToken, accountId: c.accountId };
  }
  return null;
}

async function getTikTokCreds(sb: ReturnType<typeof getAdminClient>, workspaceId: string): Promise<{ accessToken: string; advertiserId: string } | null> {
  const { data: ps } = await sb
    .from("provider_settings")
    .select("credentials")
    .eq("workspace_id", workspaceId)
    .eq("provider_category", "advertising")
    .eq("provider_name", "tiktok_ads")
    .maybeSingle();

  const c = (ps as any)?.credentials as Record<string, string> | undefined;
  if (c?.accessToken && c?.advertiserId) {
    return { accessToken: c.accessToken, advertiserId: c.advertiserId };
  }
  return null;
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
    .from("growthmind_ad_campaigns")
    .upsert(rows, { onConflict: "workspace_id,platform,external_id,date_start" });

  if (error) {
    for (const row of rows) {
      try {
        await sb.from("growthmind_ad_campaigns")
          .upsert(row, { onConflict: "workspace_id,platform,external_id,date_start" });
      } catch { /* best effort — individual row */ }
    }
  }
}

// ── Budget alert generation ────────────────────────────────────────────────────

async function generateAlerts(
  sb: ReturnType<typeof getAdminClient>,
  workspaceId: string,
  platform: "meta" | "google" | "tiktok" | "linkedin",
  campaigns: any[],
): Promise<void> {
  if (campaigns.length === 0) return;

  const now = new Date().toISOString();
  const alerts: Array<{
    workspace_id: string; platform: string; alert_type: string;
    current_value: number; threshold: number; message: string;
    created_at: string;
  }> = [];

  // Total spend and revenue across all synced campaigns (last 30 days window)
  const totalSpend       = campaigns.reduce((a, c) => a + Number(c.spend ?? 0), 0);
  const totalRevenue     = campaigns.reduce((a, c) => a + Number(c.revenue ?? 0), 0);
  const totalConversions = campaigns.reduce((a, c) => a + Number(c.conversions ?? 0), 0);
  const blendedRoas      = totalSpend > 0 && totalRevenue > 0
    ? +(totalRevenue / totalSpend).toFixed(3) : 0;

  const platformLabel = platform === "meta" ? "Meta" : platform === "tiktok" ? "TikTok" : platform === "linkedin" ? "LinkedIn" : "Google";

  // ROAS drop alert — spending more than earning back
  if (totalSpend >= 10 && blendedRoas < 1) {
    alerts.push({
      workspace_id: workspaceId,
      platform,
      alert_type: "roas_drop",
      current_value: blendedRoas,
      threshold: 1,
      message: `${platformLabel} Ads ROAS is ${blendedRoas.toFixed(2)}x — spending more than revenue generated. Review and optimise underperforming campaigns.`,
      created_at: now,
    });
  }

  // Zero spend despite campaigns being present
  if (totalSpend === 0 && campaigns.length > 0) {
    alerts.push({
      workspace_id: workspaceId,
      platform,
      alert_type: "zero_spend",
      current_value: 0,
      threshold: 0,
      message: `${platformLabel} Ads has ${campaigns.length} campaign(s) but zero spend recorded — campaigns may be paused or budgets exhausted.`,
      created_at: now,
    });
  }

  // High CPL alert — conversions exist but CPL is very high
  if (totalConversions > 0 && totalSpend > 0) {
    const avgCpl = totalSpend / totalConversions;
    if (avgCpl > 500) {
      alerts.push({
        workspace_id: workspaceId,
        platform,
        alert_type: "high_cpl",
        current_value: +avgCpl.toFixed(2),
        threshold: 500,
        message: `${platformLabel} Ads average cost-per-lead is £${avgCpl.toFixed(0)} — above the £500 alert threshold. Narrow targeting or pause high-cost campaigns.`,
        created_at: now,
      });
    }
  }

  // Monthly budget cap alerts — check growthmind_ad_budget_caps for configured limits
  try {
    const { data: cap } = await sb
      .from("growthmind_ad_budget_caps")
      .select("monthly_budget_cap,alert_at_pct,currency")
      .eq("workspace_id", workspaceId)
      .eq("platform", platform)
      .maybeSingle();

    if (cap?.monthly_budget_cap) {
      const monthlyCapNum  = Number(cap.monthly_budget_cap);
      const alertAtPct     = Number(cap.alert_at_pct ?? 80) / 100;
      const alertThreshold = monthlyCapNum * alertAtPct;
      const currency       = cap.currency ?? "GBP";
      const sym            = currency === "USD" ? "$" : "£";

      if (totalSpend >= monthlyCapNum) {
        // 100% — budget exceeded
        alerts.push({
          workspace_id: workspaceId,
          platform,
          alert_type: "budget_exceeded",
          current_value: +totalSpend.toFixed(2),
          threshold: +monthlyCapNum.toFixed(2),
          message: `${platformLabel} Ads monthly budget of ${sym}${monthlyCapNum.toLocaleString()} has been reached (${sym}${totalSpend.toFixed(0)} spent). Pause campaigns or increase budget.`,
          created_at: now,
        });
      } else if (totalSpend >= alertThreshold) {
        // alert_at_pct threshold (default 80%)
        const pctSpent = Math.round((totalSpend / monthlyCapNum) * 100);
        alerts.push({
          workspace_id: workspaceId,
          platform,
          alert_type: "budget_80pct",
          current_value: +totalSpend.toFixed(2),
          threshold: +alertThreshold.toFixed(2),
          message: `${platformLabel} Ads has used ${pctSpent}% of the monthly budget (${sym}${totalSpend.toFixed(0)} of ${sym}${monthlyCapNum.toLocaleString()}). Monitor spend carefully.`,
          created_at: now,
        });
      }
    }
  } catch {}

  // Deduplicate: only insert if there is no unacknowledged alert of this type in the last 24h
  for (const alert of alerts) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await sb
      .from("growthmind_ad_budget_alerts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("platform", platform)
      .eq("alert_type", alert.alert_type)
      .eq("acknowledged", false)
      .gte("created_at", cutoff)
      .limit(1);

    if (!existing || existing.length === 0) {
      try { await sb.from("growthmind_ad_budget_alerts").insert(alert); } catch {}
    }
  }
}

// ── Google OAuth token refresh ─────────────────────────────────────────────────

/**
 * Exchange a Google OAuth refresh token for a fresh access token.
 * Returns the new access token on success, or null if the exchange fails.
 */
async function refreshGoogleAccessToken(
  clientId:     string,
  clientSecret: string,
  refreshToken: string,
): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });

    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`[ads-sync] Google token refresh failed (${resp.status}): ${text}`);
      return null;
    }

    const json = await resp.json();
    const newToken: string | undefined = json?.access_token;
    if (!newToken) {
      console.error("[ads-sync] Google token refresh response missing access_token");
      return null;
    }
    return newToken;
  } catch (err: any) {
    console.error("[ads-sync] Google token refresh error:", err?.message);
    return null;
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

      try {
        await sb.from("growthmind_ad_sync_log").insert({
          workspace_id: workspaceId, platform: "meta",
          campaigns_synced: campaigns.length, spend_total: totals.spend,
          impressions_total: totals.impressions, clicks_total: totals.clicks,
          conversions_total: totals.conversions, status: "success",
        });
      } catch {}

      try { await generateAlerts(sb, workspaceId, "meta", campaigns); } catch {}

      results.push({ platform: "meta", workspaceId, campaignsSynced: campaigns.length, spendTotal: totals.spend, impressionsTotal: totals.impressions, clicksTotal: totals.clicks, conversionsTotal: totals.conversions, status: "success" });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      try { await sb.from("growthmind_ad_sync_log").insert({ workspace_id: workspaceId, platform: "meta", status: "error", error_message: msg }); } catch {}
      results.push({ platform: "meta", workspaceId, campaignsSynced: 0, spendTotal: 0, impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0, status: "error", error: msg });
    }
  } else {
    results.push({ platform: "meta", workspaceId, campaignsSynced: 0, spendTotal: 0, impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0, status: "skipped" });
  }

  // ── Google ──────────────────────────────────────────────────────────────────
  const gCreds = await getGoogleCreds(sb, workspaceId);
  if (gCreds) {
    // Attempt to get a fresh access token via OAuth refresh before syncing.
    // This keeps syncs working beyond the 1-hour access token expiry.
    if (gCreds.refreshToken && gCreds.clientId && gCreds.clientSecret) {
      const freshToken = await refreshGoogleAccessToken(
        gCreds.clientId,
        gCreds.clientSecret,
        gCreds.refreshToken,
      );
      if (freshToken) {
        gCreds.accessToken = freshToken;
        // Write the fresh token back so health checks and subsequent reads see it.
        try {
          const { data: psRow } = await sb
            .from("provider_settings")
            .select("credentials")
            .eq("workspace_id", workspaceId)
            .eq("provider_category", "advertising")
            .eq("provider_name", "google_ads")
            .maybeSingle();

          if (psRow) {
            const updated = { ...(psRow as any).credentials, accessToken: freshToken };
            await sb
              .from("provider_settings")
              .update({ credentials: updated })
              .eq("workspace_id", workspaceId)
              .eq("provider_category", "advertising")
              .eq("provider_name", "google_ads");
          }
        } catch (writeErr: any) {
          console.warn("[ads-sync] Could not write refreshed Google token back to DB:", writeErr?.message);
        }
      } else {
        // Refresh failed — log a warning and proceed with whatever accessToken
        // exists. If it is also expired/missing, the API call below will throw
        // and the existing catch block will record the error gracefully.
        console.warn(`[ads-sync] workspace ${workspaceId}: Google token refresh failed; attempting sync with existing token`);
      }
    }

    try {
      const { syncGoogleAdsCampaigns } = await import("./ads-sync-google.server");
      const campaigns = await syncGoogleAdsCampaigns(gCreds);
      await upsertCampaigns(sb, workspaceId, campaigns);

      const totals = campaigns.reduce(
        (a, c) => ({ spend: a.spend + c.spend, impressions: a.impressions + c.impressions, clicks: a.clicks + c.clicks, conversions: a.conversions + c.conversions }),
        { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
      );

      try {
        await sb.from("growthmind_ad_sync_log").insert({
          workspace_id: workspaceId, platform: "google",
          campaigns_synced: campaigns.length, spend_total: totals.spend,
          impressions_total: totals.impressions, clicks_total: totals.clicks,
          conversions_total: totals.conversions, status: "success",
        });
      } catch {}

      try { await generateAlerts(sb, workspaceId, "google", campaigns); } catch {}

      results.push({ platform: "google", workspaceId, campaignsSynced: campaigns.length, spendTotal: totals.spend, impressionsTotal: totals.impressions, clicksTotal: totals.clicks, conversionsTotal: totals.conversions, status: "success" });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      try { await sb.from("growthmind_ad_sync_log").insert({ workspace_id: workspaceId, platform: "google", status: "error", error_message: msg }); } catch {}
      results.push({ platform: "google", workspaceId, campaignsSynced: 0, spendTotal: 0, impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0, status: "error", error: msg });
    }
  } else {
    results.push({ platform: "google", workspaceId, campaignsSynced: 0, spendTotal: 0, impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0, status: "skipped" });
  }

  // ── TikTok ──────────────────────────────────────────────────────────────────
  const ttCreds = await getTikTokCreds(sb, workspaceId);
  if (ttCreds) {
    try {
      const { syncTikTokAdsCampaigns } = await import("./ads-sync-tiktok.server");
      const campaigns = await syncTikTokAdsCampaigns(ttCreds.accessToken, ttCreds.advertiserId);
      await upsertCampaigns(sb, workspaceId, campaigns);

      const totals = campaigns.reduce(
        (a, c) => ({ spend: a.spend + c.spend, impressions: a.impressions + c.impressions, clicks: a.clicks + c.clicks, conversions: a.conversions + c.conversions }),
        { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
      );

      try {
        await sb.from("growthmind_ad_sync_log").insert({
          workspace_id: workspaceId, platform: "tiktok",
          campaigns_synced: campaigns.length, spend_total: totals.spend,
          impressions_total: totals.impressions, clicks_total: totals.clicks,
          conversions_total: totals.conversions, status: "success",
        });
      } catch {}

      try { await generateAlerts(sb, workspaceId, "tiktok", campaigns); } catch {}
      results.push({ platform: "tiktok", workspaceId, campaignsSynced: campaigns.length, spendTotal: totals.spend, impressionsTotal: totals.impressions, clicksTotal: totals.clicks, conversionsTotal: totals.conversions, status: "success" });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      try { await sb.from("growthmind_ad_sync_log").insert({ workspace_id: workspaceId, platform: "tiktok", status: "error", error_message: msg }); } catch {}
      results.push({ platform: "tiktok", workspaceId, campaignsSynced: 0, spendTotal: 0, impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0, status: "error", error: msg });
    }
  } else {
    results.push({ platform: "tiktok", workspaceId, campaignsSynced: 0, spendTotal: 0, impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0, status: "skipped" });
  }

  // ── LinkedIn ─────────────────────────────────────────────────────────────────
  const liCreds = await getLinkedInCreds(sb, workspaceId);
  if (liCreds) {
    try {
      const { syncLinkedInAdsCampaigns } = await import("./ads-sync-linkedin.server");
      const campaigns = await syncLinkedInAdsCampaigns(liCreds.accessToken, liCreds.accountId);
      await upsertCampaigns(sb, workspaceId, campaigns);

      const totals = campaigns.reduce(
        (a, c) => ({ spend: a.spend + c.spend, impressions: a.impressions + c.impressions, clicks: a.clicks + c.clicks, conversions: a.conversions + c.conversions }),
        { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
      );

      try {
        await sb.from("growthmind_ad_sync_log").insert({
          workspace_id: workspaceId, platform: "linkedin",
          campaigns_synced: campaigns.length, spend_total: totals.spend,
          impressions_total: totals.impressions, clicks_total: totals.clicks,
          conversions_total: totals.conversions, status: "success",
        });
      } catch {}

      try { await generateAlerts(sb, workspaceId, "linkedin", campaigns); } catch {}
      results.push({ platform: "linkedin", workspaceId, campaignsSynced: campaigns.length, spendTotal: totals.spend, impressionsTotal: totals.impressions, clicksTotal: totals.clicks, conversionsTotal: totals.conversions, status: "success" });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      try { await sb.from("growthmind_ad_sync_log").insert({ workspace_id: workspaceId, platform: "linkedin", status: "error", error_message: msg }); } catch {}
      results.push({ platform: "linkedin", workspaceId, campaignsSynced: 0, spendTotal: 0, impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0, status: "error", error: msg });
    }
  } else {
    results.push({ platform: "linkedin", workspaceId, campaignsSynced: 0, spendTotal: 0, impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0, status: "skipped" });
  }

  return results;
}

// ── Platform tick ─────────────────────────────────────────────────────────────

// opts.workspaceId — when provided, only syncs that workspace (manual sync from dashboard).
// When omitted, syncs all workspaces with ads credentials (cron / dev plugin tick).
export async function runAdsSyncTick(opts?: { workspaceId?: string }): Promise<AdsSyncSummary> {
  const sb = getAdminClient();
  const workspaceSet = new Set<string>();

  if (opts?.workspaceId) {
    workspaceSet.add(opts.workspaceId);
  } else {
    const [wsRows, psRows] = await Promise.all([
      sb.from("workspace_settings").select("workspace_id")
        .not("meta_ads_access_token", "is", null),
      sb.from("provider_settings").select("workspace_id")
        .eq("provider_category", "advertising").eq("status", "connected"),
    ]);
    for (const r of wsRows?.data  ?? []) workspaceSet.add((r as any).workspace_id);
    for (const r of psRows?.data  ?? []) workspaceSet.add((r as any).workspace_id);
  }

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
