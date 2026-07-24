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
  // Preferred path: the live gads engine (structured runs, date-segmented daily
  // metrics, overlap prevention). Used whenever an advertising account has been
  // selected (customer_id present). gads-live-core.server.ts is alias-free, so
  // it is safe to import from this vite-config-loaded module.
  let googleHandledByLiveEngine = false;
  try {
    const { data: gadsAccounts } = await sb
      .from("growthmind_ads_accounts")
      .select("id, customer_id, sync_config")
      .eq("workspace_id", workspaceId)
      .eq("platform", "google")
      .eq("status", "active")
      .not("customer_id", "is", null);
    if (gadsAccounts && gadsAccounts.length > 0) {
      googleHandledByLiveEngine = true;
      const { runGadsSync } = await import("./gads-live-core.server");
      for (const acc of gadsAccounts) {
        // Cadence is configurable per account via sync_config (JSON):
        //   incrementalMinutes (default 15) — min gap between incremental runs
        //   historicalHours    (default 24) — gap between 35-day historical refreshes
        const cfg = ((acc as any).sync_config ?? {}) as Record<string, unknown>;
        const incMinutes  = Math.max(5, Number(cfg.incrementalMinutes ?? 15) || 15);
        const histHours   = Math.max(1, Number(cfg.historicalHours ?? 24) || 24);

        const { data: recentRuns } = await sb
          .from("growthmind_gads_sync_runs")
          .select("run_type, status, started_at")
          .eq("account_row_id", (acc as any).id)
          .eq("status", "success")
          .order("started_at", { ascending: false })
          .limit(30);
        const ageMin = (ts?: string | null) =>
          ts ? (Date.now() - new Date(ts).getTime()) / 60000 : Infinity;
        const lastOf = (...types: string[]) =>
          (recentRuns ?? []).find(r => types.includes((r as any).run_type))?.started_at as string | undefined;

        // Daily historical refresh takes priority; otherwise incremental at the
        // configured cadence; otherwise skip this tick quietly.
        let runType: "historical" | "incremental" | null = null;
        if (ageMin(lastOf("historical", "initial")) >= histHours * 60) runType = "historical";
        else if (ageMin(lastOf("incremental", "manual", "historical", "initial")) >= incMinutes) runType = "incremental";

        if (!runType) {
          results.push({ platform: "google", workspaceId, campaignsSynced: 0, spendTotal: 0, impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0, status: "skipped", error: `Next sync not due yet (every ${incMinutes} min, historical every ${histHours}h)` });
          continue;
        }
        const r = await runGadsSync(workspaceId, (acc as any).id, runType);
        results.push({
          platform: "google", workspaceId,
          campaignsSynced: r.campaigns, spendTotal: r.spend,
          impressionsTotal: 0, clicksTotal: 0, conversionsTotal: 0,
          status: r.ok ? "success" : r.status === "skipped" ? "skipped" : "error",
          error: r.error,
        });
      }
    }
  } catch (err: any) {
    console.error(`[ads-sync] gads live engine error (ws ${workspaceId}):`, err?.message);
  }

  // Google syncs ONLY through the live gads engine above — there is intentionally
  // no legacy fallback. If OAuth is done but no advertising account has been
  // selected yet, we record an honest "skipped" so the health surface shows
  // the true state instead of pretending an old sync path still works.
  if (!googleHandledByLiveEngine) {
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
