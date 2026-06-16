/**
 * GrowthMind Ads Live Sync Engine
 *
 * Pulls real campaign stats from Meta, Google Ads, LinkedIn, and TikTok APIs
 * using the encrypted access tokens stored in growthmind_ads_accounts.
 *
 * Each platform adapter returns a normalised array of campaigns that are
 * upserted into growthmind_campaigns and logged in growthmind_ad_sync_log.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptToken } from "./growthmind.ads";

// ── Normalised campaign shape returned by all platform adapters ───────────────
interface SyncedCampaign {
  external_id: string;
  name:        string;
  status:      "active" | "paused" | "ended";
  spend:       number;
  impressions: number;
  clicks:      number;
  conversions: number;
  roas:        number | null;
  period_start: string;
  period_end:   string;
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function last30Days() {
  const end   = new Date();
  const start = new Date(); start.setDate(end.getDate() - 30);
  return {
    since: start.toISOString().slice(0, 10),
    until: end.toISOString().slice(0, 10),
  };
}

// ── Meta Ads (Facebook / Instagram) ──────────────────────────────────────────
async function syncMeta(accountId: string, token: string): Promise<SyncedCampaign[]> {
  const { since, until } = last30Days();
  const base = `https://graph.facebook.com/v19.0/act_${accountId}`;

  const insightsUrl = `${base}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,purchase_roas&date_preset=last_30d&limit=200&access_token=${token}`;
  const res = await fetch(insightsUrl);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Meta API ${res.status}: ${err.slice(0, 200)}`);
  }
  const json = await res.json() as any;
  const rows = json?.data ?? [];

  return rows.map((r: any) => {
    const conversions = (r.actions ?? [])
      .filter((a: any) => ["purchase","lead","complete_registration","subscribe"].includes(a.action_type))
      .reduce((sum: number, a: any) => sum + Number(a.value ?? 0), 0);
    const roas = r.purchase_roas?.[0]?.value ? Number(r.purchase_roas[0].value) : null;
    return {
      external_id:  r.campaign_id,
      name:         r.campaign_name ?? r.campaign_id,
      status:       "active" as const,
      spend:        Number(r.spend ?? 0),
      impressions:  Number(r.impressions ?? 0),
      clicks:       Number(r.clicks ?? 0),
      conversions,
      roas,
      period_start: since,
      period_end:   until,
    };
  });
}

// ── Google Ads ────────────────────────────────────────────────────────────────
async function syncGoogle(accountId: string, token: string): Promise<SyncedCampaign[]> {
  const { since, until } = last30Days();
  // customer_id is the account_id without dashes
  const customerId = accountId.replace(/-/g, "");
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${since}' AND '${until}'
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/v16/customers/${customerId}/googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization:    `Bearer ${token}`,
        "Content-Type":   "application/json",
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Ads API ${res.status}: ${err.slice(0, 200)}`);
  }

  const json = await res.json() as any;
  const results = json?.results ?? [];

  const byCampaign: Record<string, any> = {};
  for (const row of results) {
    const id = row.campaign?.id;
    if (!id) continue;
    if (!byCampaign[id]) {
      byCampaign[id] = {
        external_id:  String(id),
        name:         row.campaign?.name ?? String(id),
        status:       (row.campaign?.status ?? "ENABLED").toLowerCase() === "enabled" ? "active" : "paused",
        spend:        0, impressions: 0, clicks: 0, conversions: 0, roas: null,
        period_start: since, period_end: until,
      };
    }
    const c = byCampaign[id];
    c.spend       += (row.metrics?.costMicros ?? 0) / 1_000_000;
    c.impressions += Number(row.metrics?.impressions ?? 0);
    c.clicks      += Number(row.metrics?.clicks ?? 0);
    c.conversions += Number(row.metrics?.conversions ?? 0);
    if (c.spend > 0 && (row.metrics?.conversionsValue ?? 0) > 0) {
      c.roas = (row.metrics.conversionsValue / c.spend);
    }
  }
  return Object.values(byCampaign) as SyncedCampaign[];
}

// ── LinkedIn Marketing API ────────────────────────────────────────────────────
async function syncLinkedIn(accountId: string, token: string): Promise<SyncedCampaign[]> {
  const { since, until } = last30Days();
  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(until).getTime();
  const sponsoredAccountUrn = `urn:li:sponsoredAccount:${accountId}`;

  const campaignsUrl = `https://api.linkedin.com/rest/adCampaigns?q=search&search.account.values[0]=${encodeURIComponent(sponsoredAccountUrn)}&fields=id,name,status,totalBudget,costType&count=200`;
  const res = await fetch(campaignsUrl, {
    headers: {
      Authorization:    `Bearer ${token}`,
      "LinkedIn-Version": "202401",
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LinkedIn API ${res.status}: ${err.slice(0, 200)}`);
  }

  const json = await res.json() as any;
  const campaigns: any[] = json?.elements ?? [];

  const synced: SyncedCampaign[] = [];
  for (const c of campaigns.slice(0, 50)) {
    const campId = String(c.id);
    const analyticsUrl = `https://api.linkedin.com/rest/adAnalytics?q=analytics&pivot=CAMPAIGN&dateRange.start.year=${new Date(since).getFullYear()}&dateRange.start.month=${new Date(since).getMonth() + 1}&dateRange.start.day=${new Date(since).getDate()}&dateRange.end.year=${new Date(until).getFullYear()}&dateRange.end.month=${new Date(until).getMonth() + 1}&dateRange.end.day=${new Date(until).getDate()}&campaigns[0]=urn:li:sponsoredCampaign:${campId}&fields=costInLocalCurrency,impressions,clicks,externalWebsiteConversions`;
    let spend = 0, impressions = 0, clicks = 0, conversions = 0;
    try {
      const aRes = await fetch(analyticsUrl, {
        headers: { Authorization: `Bearer ${token}`, "LinkedIn-Version": "202401" },
      });
      if (aRes.ok) {
        const aJson = await aRes.json() as any;
        const elements: any[] = aJson?.elements ?? [];
        for (const e of elements) {
          spend       += Number(e.costInLocalCurrency ?? 0);
          impressions += Number(e.impressions ?? 0);
          clicks      += Number(e.clicks ?? 0);
          conversions += Number(e.externalWebsiteConversions ?? 0);
        }
      }
    } catch { /* skip analytics if fail */ }

    synced.push({
      external_id:  campId,
      name:         c.name ?? campId,
      status:       (c.status ?? "ACTIVE").toUpperCase() === "ACTIVE" ? "active" : "paused",
      spend, impressions, clicks, conversions, roas: null,
      period_start: since, period_end: until,
    });
  }
  return synced;
}

// ── TikTok Ads ────────────────────────────────────────────────────────────────
async function syncTikTok(advertiserId: string, token: string): Promise<SyncedCampaign[]> {
  const { since, until } = last30Days();

  const campUrl = `https://business-api.tiktok.com/open_api/v1.3/campaign/get/?advertiser_id=${advertiserId}&page_size=100`;
  const res = await fetch(campUrl, {
    headers: { "Access-Token": token, "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TikTok API ${res.status}: ${err.slice(0, 200)}`);
  }

  const json = await res.json() as any;
  if (json?.code !== 0) throw new Error(`TikTok API error: ${json?.message}`);
  const campaigns: any[] = json?.data?.list ?? [];

  const campIds = campaigns.slice(0, 50).map((c: any) => c.campaign_id).join(",");
  if (!campIds) return [];

  const reportUrl = `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?advertiser_id=${advertiserId}&report_type=BASIC&dimensions[]=campaign_id&metrics[]=spend&metrics[]=impressions&metrics[]=clicks&metrics[]=conversion&data_level=AUCTION_CAMPAIGN&start_date=${since}&end_date=${until}&page_size=100`;
  const rRes = await fetch(reportUrl, {
    headers: { "Access-Token": token },
  });

  const reportMap: Record<string, any> = {};
  if (rRes.ok) {
    const rJson = await rRes.json() as any;
    for (const row of (rJson?.data?.list ?? [])) {
      reportMap[row.dimensions?.campaign_id] = row.metrics ?? {};
    }
  }

  return campaigns.slice(0, 50).map((c: any) => {
    const m = reportMap[c.campaign_id] ?? {};
    return {
      external_id:  String(c.campaign_id),
      name:         c.campaign_name ?? String(c.campaign_id),
      status:       c.operation_status === "ENABLE" ? "active" : "paused",
      spend:        Number(m.spend ?? 0),
      impressions:  Number(m.impressions ?? 0),
      clicks:       Number(m.clicks ?? 0),
      conversions:  Number(m.conversion ?? 0),
      roas:         null,
      period_start: since,
      period_end:   until,
    };
  });
}

// ── Core sync dispatcher ──────────────────────────────────────────────────────
export async function syncAdAccountById(
  accountRowId: string,
  workspaceId: string,
): Promise<{ ok: boolean; campaigns: number; spend: number; error?: string }> {
  const sb = supabaseAdmin as any;
  const { data: acc, error: fe } = await sb
    .from("growthmind_ads_accounts")
    .select("id, platform, account_id, token_enc, status")
    .eq("id", accountRowId)
    .eq("workspace_id", workspaceId)
    .single();

  if (fe || !acc) return { ok: false, campaigns: 0, spend: 0, error: "Account not found" };
  if (acc.status === "disconnected") return { ok: false, campaigns: 0, spend: 0, error: "Account disconnected" };
  if (!acc.token_enc) return { ok: false, campaigns: 0, spend: 0, error: "No access token saved for this account" };

  let token: string;
  try { token = await decryptToken(acc.token_enc); }
  catch { return { ok: false, campaigns: 0, spend: 0, error: "Failed to decrypt token" }; }

  // Mark as syncing
  await sb.from("growthmind_ads_accounts")
    .update({ sync_status: "syncing", updated_at: new Date().toISOString() })
    .eq("id", accountRowId);

  let campaigns: SyncedCampaign[] = [];
  let syncError: string | undefined;

  try {
    switch (acc.platform) {
      case "meta":     campaigns = await syncMeta(acc.account_id, token);     break;
      case "google":   campaigns = await syncGoogle(acc.account_id, token);   break;
      case "linkedin": campaigns = await syncLinkedIn(acc.account_id, token); break;
      case "tiktok":   campaigns = await syncTikTok(acc.account_id, token);   break;
      default: throw new Error(`Unknown platform: ${acc.platform}`);
    }
  } catch (err: any) {
    syncError = err?.message ?? String(err);
    await sb.from("growthmind_ads_accounts").update({
      sync_status: "error", sync_error: syncError, updated_at: new Date().toISOString(),
    }).eq("id", accountRowId);
    await sb.from("growthmind_ad_sync_log").insert({
      workspace_id: workspaceId, account_id: accountRowId,
      platform: acc.platform, status: "error", campaigns_synced: 0,
      spend_total: 0, error_message: syncError,
    });
    return { ok: false, campaigns: 0, spend: 0, error: syncError };
  }

  // Upsert campaigns into growthmind_campaigns
  const now = new Date().toISOString();
  let totalSpend = 0;
  for (const c of campaigns) {
    totalSpend += c.spend;
    const row = {
      workspace_id:   workspaceId,
      ads_account_id: accountRowId,
      platform:       acc.platform,
      external_id:    c.external_id,
      name:           c.name,
      status:         c.status,
      spend:          c.spend,
      impressions:    c.impressions,
      clicks:         c.clicks,
      conversions:    c.conversions,
      cpl:            c.conversions > 0 ? c.spend / c.conversions : null,
      roas:           c.roas,
      period_start:   c.period_start,
      period_end:     c.period_end,
      updated_at:     now,
    };
    // Try upsert by external_id+account
    await sb.from("growthmind_campaigns")
      .upsert({ ...row, created_at: now }, { onConflict: "ads_account_id,external_id", ignoreDuplicates: false })
      .catch(() => sb.from("growthmind_campaigns").insert({ ...row, created_at: now }).catch(() => {}));
  }

  // Update account sync status
  await sb.from("growthmind_ads_accounts").update({
    sync_status:         "synced",
    sync_error:          null,
    last_synced_at:      now,
    total_spend_synced:  totalSpend,
    updated_at:          now,
  }).eq("id", accountRowId);

  // Log the sync
  await sb.from("growthmind_ad_sync_log").insert({
    workspace_id: workspaceId, account_id: accountRowId,
    platform: acc.platform, status: "success",
    campaigns_synced: campaigns.length, spend_total: totalSpend,
  });

  // Check budget alerts
  await checkBudgetAlerts(sb, workspaceId, accountRowId, acc.platform, campaigns, totalSpend);

  return { ok: true, campaigns: campaigns.length, spend: totalSpend };
}

// ── Budget alert engine ───────────────────────────────────────────────────────
async function checkBudgetAlerts(
  sb: any, workspaceId: string, accountId: string,
  platform: string, campaigns: SyncedCampaign[], totalSpend: number,
) {
  const { data: acc } = await sb.from("growthmind_ads_accounts")
    .select("monthly_budget, currency").eq("id", accountId).single().catch(() => ({ data: null }));
  const budget = Number(acc?.monthly_budget ?? 0);

  if (budget > 0) {
    const pct = totalSpend / budget;
    if (pct >= 1.0) {
      await sb.from("growthmind_ad_budget_alerts").insert({
        workspace_id: workspaceId, account_id: accountId, platform,
        alert_type: "budget_exceeded", threshold: budget, current_value: totalSpend,
        message: `${platform} ad spend £${totalSpend.toFixed(2)} has exceeded your £${budget.toFixed(2)} monthly budget`,
      }).catch(() => {});
    } else if (pct >= 0.8) {
      await sb.from("growthmind_ad_budget_alerts").insert({
        workspace_id: workspaceId, account_id: accountId, platform,
        alert_type: "budget_80pct", threshold: budget, current_value: totalSpend,
        message: `${platform} ad spend has reached ${Math.round(pct * 100)}% of your monthly budget`,
      }).catch(() => {});
    }
  }

  // ROAS drop alert
  const activeCamps = campaigns.filter(c => c.status === "active" && c.roas !== null);
  for (const c of activeCamps) {
    if ((c.roas ?? 0) < 1 && c.spend > 50) {
      await sb.from("growthmind_ad_budget_alerts").insert({
        workspace_id: workspaceId, account_id: accountId, platform,
        alert_type: "roas_drop", threshold: 1, current_value: c.roas ?? 0,
        message: `Campaign "${c.name}" ROAS is ${(c.roas ?? 0).toFixed(2)}x — spending more than earning`,
      }).catch(() => {});
      break; // one alert per sync
    }
  }
}

// ── Sync all accounts for a workspace (admin, no auth) ────────────────────────
export async function syncAllAdsForWorkspace(workspaceId: string) {
  const sb = supabaseAdmin as any;
  const { data: accounts } = await sb
    .from("growthmind_ads_accounts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .not("token_enc", "is", null);

  const results = [];
  for (const acc of accounts ?? []) {
    const r = await syncAdAccountById(acc.id, workspaceId);
    results.push({ id: acc.id, ...r });
  }
  return results;
}

// ── Server function (authenticated — called from UI) ──────────────────────────
export const syncAdAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const results = await syncAllAdsForWorkspace(workspaceId);
    return { results };
  });

export const syncSingleAdAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }: any) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const accountId = (data as any)?.accountId as string;
    if (!accountId) throw new Error("accountId required");
    const result = await syncAdAccountById(accountId, workspaceId);
    return result;
  });

export const getAdSyncStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;

    const [accsRes, alertsRes] = await Promise.all([
      sb.from("growthmind_ads_accounts")
        .select("id, platform, label, sync_status, last_synced_at, sync_error, total_spend_synced, monthly_budget, currency")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
      sb.from("growthmind_ad_budget_alerts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("acknowledged", false)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const accounts = accsRes.data ?? [];
    const alerts   = alertsRes.data ?? [];
    const totalSpend = accounts.reduce((s: number, a: any) => s + Number(a.total_spend_synced ?? 0), 0);

    return { accounts, alerts, totalSpend };
  });

export const acknowledgeAdAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }: any) => {
    const { supabase, workspaceId } = context;
    const sb = supabase as any;
    await sb.from("growthmind_ad_budget_alerts")
      .update({ acknowledged: true })
      .eq("id", (data as any).alertId)
      .eq("workspace_id", workspaceId);
    return { ok: true };
  });
