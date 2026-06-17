import { createFileRoute } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import {
  BarChart2, RefreshCw, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle2, XCircle, ExternalLink, MousePointerClick,
  Eye, ShoppingCart, DollarSign, Loader2, Zap, Bell, Settings2,
  Activity, Clock, X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/growthmind/ads-performance")({
  head: () => ({ meta: [{ title: "Ads Performance — GrowthMind" }] }),
  component: AdsPerformancePage,
});

// ── Types ──────────────────────────────────────────────────────────────────────

interface PlatformTotals {
  count:        number;
  spend:        number;
  impressions:  number;
  clicks:       number;
  conversions:  number;
  avgRoas:      number | null;
  ctr:          number | null;
  lastSyncedAt: string | null;
}

interface AdCampaign {
  id:          string;
  name:        string;
  platform:    "meta" | "google";
  status:      string;
  spend:       number;
  impressions: number;
  clicks:      number;
  conversions: number;
  roas:        number | null;
  dateStart:   string | null;
  dateEnd:     string | null;
  syncedAt:    string | null;
}

interface BudgetAlert {
  id:           string;
  platform:     string;
  alert_type:   string;
  current_value: number;
  threshold:    number | null;
  message:      string;
  created_at:   string;
}

interface BudgetCapSummary {
  platform:          "meta" | "google";
  monthly_budget_cap: number | null;
  alert_at_pct:      number;
  currency:          string;
}

interface WeekDeltas {
  spendPct:       number | null;
  roasPct:        number | null;
  impressionsPct: number | null;
  conversionsPct: number | null;
}

interface SyncHealthEntry {
  id:           string;
  platform:     string;
  status:       string;
  errorMessage: string | null;
  syncedAt:     string;
}

interface SyncHealth {
  overallStatus:    "success" | "partial" | "error" | "never";
  lastSyncedAt:     string | null;
  minutesSinceSync: number | null;
  healthLevel:      "green" | "amber" | "red";
  recentErrors:     SyncHealthEntry[];
}

interface AdsPerformanceData {
  hasSyncedData:  boolean;
  hasMetaCreds:   boolean;
  hasGoogleCreds: boolean;
  totalCampaigns: number;
  totalSpend:     number;
  meta:           PlatformTotals;
  google:         PlatformTotals;
  campaigns:      AdCampaign[];
  alerts:         BudgetAlert[];
  caps:           BudgetCapSummary[];
  lastSyncedAt:   string | null;
  deltas:         WeekDeltas;
  syncHealth:     SyncHealth;
}

// ── Server fns ─────────────────────────────────────────────────────────────────

const getAdsPerformanceData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdsPerformanceData> => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // 30-day rolling window — prevents stale snapshots from inflating aggregates
    const thirtyDaysAgo    = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo  = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo     = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      campaignsRes,
      alertsRes,
      wsRes,
      psRes,
      capsRes,
      deltaLogRes,
      deltaRoasRes,
      latestSyncRes,
      allSyncLogRes,
    ] = await Promise.all([
      Promise.resolve(
        sb.from("growthmind_ad_campaigns")
          .select("id,platform,name,status,spend,impressions,clicks,conversions,roas,date_start,date_end,synced_at")
          .eq("workspace_id", workspaceId)
          .not("synced_at", "is", null)
          .gte("synced_at", thirtyDaysAgo)
          .order("spend", { ascending: false })
          .limit(200),
      ).catch(() => ({ data: [] })),

      Promise.resolve(
        sb.from("growthmind_ad_budget_alerts")
          .select("id,platform,alert_type,current_value,threshold,message,created_at")
          .eq("workspace_id", workspaceId)
          .eq("acknowledged", false)
          .order("created_at", { ascending: false })
          .limit(20),
      ).catch(() => ({ data: [] })),

      Promise.resolve(
        sb.from("workspace_settings")
          .select("meta_ads_access_token,meta_ads_account_id")
          .eq("workspace_id", workspaceId)
          .maybeSingle(),
      ).catch(() => ({ data: null })),

      Promise.resolve(
        sb.from("provider_settings")
          .select("provider_name,status")
          .eq("workspace_id", workspaceId)
          .eq("provider_category", "advertising")
          .eq("status", "connected"),
      ).catch(() => ({ data: [] })),

      Promise.resolve(
        sb.from("growthmind_ad_budget_caps")
          .select("platform,monthly_budget_cap,alert_at_pct,currency")
          .eq("workspace_id", workspaceId)
          .in("platform", ["meta", "google"]),
      ).catch(() => ({ data: [] })),

      // Sync log for the last 14 days — used for WoW spend/impressions/conversions deltas.
      // Scoped to meta+google only to match the hero card totals.
      // Values are cumulative snapshots; we compare latest-per-platform in each
      // 7-day window rather than summing across days to avoid distortion.
      Promise.resolve(
        sb.from("growthmind_ad_sync_log")
          .select("platform,spend_total,impressions_total,conversions_total,synced_at")
          .eq("workspace_id", workspaceId)
          .eq("status", "success")
          .gte("synced_at", fourteenDaysAgo)
          .in("platform", ["meta", "google"])
          .order("synced_at", { ascending: true })
          .limit(5_000),
      ).catch(() => ({ data: [] })),

      // Campaign ROAS for the last 14 days — used for WoW ROAS delta.
      // Scoped to meta+google only to match Blended ROAS on hero cards.
      Promise.resolve(
        sb.from("growthmind_ad_campaigns")
          .select("platform,roas,synced_at")
          .eq("workspace_id", workspaceId)
          .not("roas", "is", null)
          .gt("roas", 0)
          .gte("synced_at", fourteenDaysAgo)
          .in("platform", ["meta", "google"])
          .order("synced_at", { ascending: true })
          .limit(5_000),
      ).catch(() => ({ data: [] })),

      // Most recent successful sync row — used for the "Last synced X min ago" header indicator.
      Promise.resolve(
        sb.from("growthmind_ad_sync_log")
          .select("synced_at")
          .eq("workspace_id", workspaceId)
          .eq("status", "success")
          .order("synced_at", { ascending: false })
          .limit(1),
      ).catch(() => ({ data: [] })),

      // All recent rows (any status) for health badge + error banners.
      Promise.resolve(
        sb.from("growthmind_ad_sync_log")
          .select("id,platform,status,error_message,synced_at")
          .eq("workspace_id", workspaceId)
          .order("synced_at", { ascending: false })
          .limit(20),
      ).catch(() => ({ data: [] })),
    ]);

    const campaigns: any[]   = campaignsRes.data  ?? [];
    const alerts:    any[]   = alertsRes.data     ?? [];
    const ws                 = wsRes.data;
    const connectedAds       = new Set((psRes.data ?? []).map((r: any) => r.provider_name as string));
    const capsRaw: any[]     = capsRes.data       ?? [];
    const deltaLogRows: any[] = deltaLogRes.data  ?? [];
    const deltaRoasRows: any[] = deltaRoasRes.data ?? [];
    const latestSyncRow: any = (latestSyncRes.data as any[])?.[0] ?? null;
    const allSyncRows: any[] = allSyncLogRes.data ?? [];

    // ── Sync health ────────────────────────────────────────────────────────────
    function deriveSyncHealth(): SyncHealth {
      if (allSyncRows.length === 0) {
        return { overallStatus: "never", lastSyncedAt: null, minutesSinceSync: null, healthLevel: "red", recentErrors: [] };
      }
      const sorted = [...allSyncRows].sort((a, b) => (b.synced_at > a.synced_at ? 1 : -1));
      const latest = sorted[0];
      const latestAt: string = latest.synced_at;
      const minutesSinceSync = Math.floor((Date.now() - new Date(latestAt).getTime()) / 60_000);
      const overallStatus: SyncHealth["overallStatus"] =
        latest.status === "success" ? "success"
        : latest.status === "error"   ? "error"
        : "partial";

      let healthLevel: SyncHealth["healthLevel"];
      if (overallStatus === "error") {
        healthLevel = "red";
      } else if (overallStatus === "partial") {
        healthLevel = "amber";
      } else if (minutesSinceSync > 60) {
        healthLevel = "red";
      } else if (minutesSinceSync > 30) {
        healthLevel = "amber";
      } else {
        healthLevel = "green";
      }

      const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const recentErrors: SyncHealthEntry[] = sorted
        .filter(r => r.status !== "success" && r.synced_at >= cutoff && r.error_message)
        .slice(0, 5)
        .map(r => ({
          id:           r.id as string,
          platform:     r.platform as string,
          status:       r.status as string,
          errorMessage: r.error_message as string | null,
          syncedAt:     r.synced_at as string,
        }));

      return { overallStatus, lastSyncedAt: latestAt, minutesSinceSync, healthLevel, recentErrors };
    }

    const syncHealth = deriveSyncHealth();

    const hasMetaCreds   = !!(ws?.meta_ads_access_token && ws?.meta_ads_account_id) || connectedAds.has("meta_ads");
    const hasGoogleCreds = connectedAds.has("google_ads");

    const metaCamps   = campaigns.filter(c => c.platform === "meta");
    const googleCamps = campaigns.filter(c => c.platform === "google");

    function totals(camps: any[]): PlatformTotals {
      const spend       = +camps.reduce((a, c) => a + Number(c.spend ?? 0), 0).toFixed(2);
      const impressions = camps.reduce((a, c) => a + Number(c.impressions ?? 0), 0);
      const clicks      = camps.reduce((a, c) => a + Number(c.clicks ?? 0), 0);
      const conversions = camps.reduce((a, c) => a + Number(c.conversions ?? 0), 0);
      const roasCamps   = camps.filter(c => c.roas != null && c.roas > 0);
      const avgRoas     = roasCamps.length > 0
        ? +(roasCamps.reduce((a, c) => a + Number(c.roas), 0) / roasCamps.length).toFixed(2)
        : null;
      const ctr = impressions > 0 ? +(clicks / impressions * 100).toFixed(2) : null;
      const lastSyncedAt = camps.reduce((best: string | null, c) => {
        if (!c.synced_at) return best;
        if (!best || c.synced_at > best) return c.synced_at;
        return best;
      }, null);
      return { count: camps.length, spend, impressions, clicks, conversions, avgRoas, ctr, lastSyncedAt };
    }

    const metaTotals   = totals(metaCamps);
    const googleTotals = totals(googleCamps);
    const totalSpend   = +(metaTotals.spend + googleTotals.spend).toFixed(2);
    // lastSyncedAt — sourced from the most recent successful row in growthmind_ad_sync_log
    // so the header indicator always reflects the sync engine's last run, not stale campaign data.
    const lastSyncedAt: string | null = latestSyncRow?.synced_at ?? null;

    // ── Week-over-week deltas ──────────────────────────────────────────────────
    // sync_log rows are cumulative snapshots — each row reflects the platform's
    // running total at sync time. Correct WoW comparison: compare the LATEST
    // snapshot per platform in the current 7-day window vs the latest in the
    // prior 7-14 day window, then sum across platforms. Summing across multiple
    // days in a window would add up cumulative totals, which is incorrect.
    function pctChange(curr: number, prev: number): number | null {
      if (prev <= 0) return null;
      return +((curr - prev) / prev * 100).toFixed(1);
    }

    type PlatformKey = "meta" | "google";
    type Snap = { spend: number; impressions: number; conversions: number };

    // Ascending order → later rows overwrite; keyed by platform only so the
    // map retains the single latest entry per platform per window.
    const currLatest = new Map<PlatformKey, Snap>();
    const prevLatest = new Map<PlatformKey, Snap>();

    for (const r of deltaLogRows) {
      const platform = r.platform as PlatformKey;
      if (platform !== "meta" && platform !== "google") continue;
      const snap: Snap = {
        spend:       Number(r.spend_total        ?? 0),
        impressions: Number(r.impressions_total  ?? 0),
        conversions: Number(r.conversions_total  ?? 0),
      };
      if (r.synced_at >= sevenDaysAgo) {
        currLatest.set(platform, snap);
      } else {
        prevLatest.set(platform, snap);
      }
    }

    function sumLatest(m: Map<PlatformKey, Snap>): Snap {
      let spend = 0, impressions = 0, conversions = 0;
      for (const v of m.values()) { spend += v.spend; impressions += v.impressions; conversions += v.conversions; }
      return { spend, impressions, conversions };
    }

    const currPeriod = sumLatest(currLatest);
    const prevPeriod = sumLatest(prevLatest);

    // ROAS delta — average across campaign rows per period (campaigns table,
    // keyed by synced_at range; meta+google only, matching Blended ROAS).
    const currRoasRows = deltaRoasRows.filter((r: any) => r.synced_at >= sevenDaysAgo);
    const prevRoasRows = deltaRoasRows.filter((r: any) => r.synced_at < sevenDaysAgo);
    const avgRoasFn = (rows: any[]) =>
      rows.length > 0 ? rows.reduce((a: number, r: any) => a + Number(r.roas), 0) / rows.length : 0;
    const currAvgRoas = avgRoasFn(currRoasRows);
    const prevAvgRoas = avgRoasFn(prevRoasRows);

    const deltas: WeekDeltas = {
      spendPct:       pctChange(currPeriod.spend,       prevPeriod.spend),
      impressionsPct: pctChange(currPeriod.impressions, prevPeriod.impressions),
      conversionsPct: pctChange(currPeriod.conversions, prevPeriod.conversions),
      roasPct:        currRoasRows.length > 0 && prevRoasRows.length > 0
                        ? pctChange(currAvgRoas, prevAvgRoas)
                        : null,
    };

    const mapped: AdCampaign[] = campaigns.map(c => ({
      id:          c.id,
      name:        c.name,
      platform:    c.platform,
      status:      c.status,
      spend:       Number(c.spend ?? 0),
      impressions: Number(c.impressions ?? 0),
      clicks:      Number(c.clicks ?? 0),
      conversions: Number(c.conversions ?? 0),
      roas:        c.roas ? Number(c.roas) : null,
      dateStart:   c.date_start ?? null,
      dateEnd:     c.date_end   ?? null,
      syncedAt:    c.synced_at  ?? null,
    }));

    return {
      hasSyncedData:  campaigns.length > 0,
      hasMetaCreds,
      hasGoogleCreds,
      totalCampaigns: campaigns.length,
      totalSpend,
      meta:           metaTotals,
      google:         googleTotals,
      campaigns:      mapped,
      alerts:         alerts.map((a: any) => ({
        id:           a.id,
        platform:     a.platform,
        alert_type:   a.alert_type,
        current_value: Number(a.current_value ?? 0),
        threshold:    a.threshold ? Number(a.threshold) : null,
        message:      a.message,
        created_at:   a.created_at,
      })),
      caps: capsRaw.map((r: any) => ({
        platform:           r.platform as "meta" | "google",
        monthly_budget_cap: r.monthly_budget_cap ? Number(r.monthly_budget_cap) : null,
        alert_at_pct:       Number(r.alert_at_pct ?? 80),
        currency:           r.currency ?? "GBP",
      })),
      lastSyncedAt,
      deltas,
      syncHealth,
    };
  });

const triggerAdsSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");

    // Use the same orchestrator as the cron/dev tick so that sync log rows
    // and budget alerts are generated consistently on every sync path.
    const { runAdsSyncTick } = await import("@/lib/growthmind/growthmind.ads-sync-tick");
    const summary = await runAdsSyncTick({ workspaceId });

    const results = summary.results
      .filter(r => r.status !== "skipped")
      .map(r => ({
        platform:  r.platform,
        campaigns: r.campaignsSynced,
        status:    r.status,
        error:     r.error,
      }));

    if (results.length === 0) {
      throw new Error("No ads accounts connected. Connect Meta Ads or Google Ads in Provider Settings.");
    }

    return { results };
  });

const acknowledgeAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { alertId: string }) => i)
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await sb.from("growthmind_ad_budget_alerts")
      .update({ acknowledged: true })
      .eq("id", data.alertId)
      .eq("workspace_id", context.workspaceId);
    return { ok: true };
  });

// ── Sync history server fn ──────────────────────────────────────────────────────

interface SyncHistoryRow {
  id:               string;
  platform:         string;
  campaignsSynced:  number;
  spendTotal:       number | null;
  impressionsTotal: number | null;
  conversionsTotal: number | null;
  status:           string;
  errorMessage:     string | null;
  syncedAt:         string;
}

const getSyncHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyncHistoryRow[]> => {
    const sb = context.supabase as any;
    const { workspaceId } = context;
    if (!workspaceId) return [];
    try {
      const { data } = await sb
        .from("growthmind_ad_sync_log")
        .select("id,platform,campaigns_synced,spend_total,impressions_total,conversions_total,status,error_message,synced_at")
        .eq("workspace_id", workspaceId)
        .order("synced_at", { ascending: false })
        .limit(20);
      return (data ?? []).map((r: any) => ({
        id:               r.id,
        platform:         r.platform,
        campaignsSynced:  r.campaigns_synced ?? 0,
        spendTotal:       r.spend_total       != null ? Number(r.spend_total)       : null,
        impressionsTotal: r.impressions_total != null ? Number(r.impressions_total) : null,
        conversionsTotal: r.conversions_total != null ? Number(r.conversions_total) : null,
        status:           r.status,
        errorMessage:     r.error_message ?? null,
        syncedAt:         r.synced_at,
      }));
    } catch {
      return [];
    }
  });

// ── Trend data server fn ────────────────────────────────────────────────────────

interface TrendPoint {
  date:                 string;
  meta_spend?:          number;
  google_spend?:        number;
  tiktok_spend?:        number;
  meta_impressions?:    number;
  google_impressions?:  number;
  tiktok_impressions?:  number;
  meta_conversions?:    number;
  google_conversions?:  number;
  tiktok_conversions?:  number;
  meta_roas?:           number;
  google_roas?:         number;
  tiktok_roas?:         number;
}

const getAdsTrendData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { days: number }) => i)
  .handler(async ({ data, context }): Promise<TrendPoint[]> => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) return [];

    // Clamp to allowed range values only
    const allowedDays = [7, 30, 90] as const;
    const days   = allowedDays.includes(data.days as any) ? data.days : 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // growthmind_ad_sync_log is the canonical table written by the sync engine
    // (growthmind.ads-sync-tick.ts). Each row is a *snapshot* of cumulative
    // totals at sync time — not an incremental delta. To get the correct daily
    // value we take the LATEST row per (day, platform). Rows are fetched
    // ascending so later rows overwrite earlier ones in the accumulator.
    //
    // Limit: 90d × 3 platforms × 96 syncs/day ≈ 25 000 rows worst-case.
    // 50 000 covers this with room to spare.
    const [perfRes, roasRes] = await Promise.all([
      sb.from("growthmind_ad_sync_log")
        .select("platform,spend_total,impressions_total,conversions_total,synced_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "success")
        .gte("synced_at", cutoff)
        .in("platform", ["meta", "google", "tiktok"])
        .order("synced_at", { ascending: true })
        .limit(50_000),

      // ROAS is not stored in the performance log — derive it from campaigns.
      // Campaigns are upserted on each sync; average ROAS per day/platform.
      sb.from("growthmind_ad_campaigns")
        .select("platform,roas,synced_at")
        .eq("workspace_id", workspaceId)
        .not("roas", "is", null)
        .gte("synced_at", cutoff)
        .in("platform", ["meta", "google", "tiktok"])
        .order("synced_at", { ascending: true })
        .limit(50_000),
    ]);

    const perfRows: any[] = perfRes.data ?? [];
    const roasRows: any[] = roasRes.data ?? [];

    type DayKey = string; // ISO date "2026-06-10"
    type Platform = "meta" | "google" | "tiktok";

    // For spend/impressions/conversions: keep only the LATEST snapshot per
    // (day, platform). Iterating in ascending order means later rows win.
    const latestSnap = new Map<`${DayKey}:${Platform}`, {
      spend: number; impressions: number; conversions: number;
    }>();

    for (const r of perfRows) {
      const platform = r.platform as Platform;
      if (platform !== "meta" && platform !== "google" && platform !== "tiktok") continue;
      const day = r.synced_at.slice(0, 10) as DayKey;
      latestSnap.set(`${day}:${platform}`, {
        spend:       Number(r.spend_total        ?? 0),
        impressions: Number(r.impressions_total  ?? 0),
        conversions: Number(r.conversions_total  ?? 0),
      });
    }

    // For ROAS: average across all campaign records on that day/platform.
    const roasAcc = new Map<`${DayKey}:${Platform}`, { sum: number; count: number }>();

    for (const r of roasRows) {
      const platform = r.platform as Platform;
      if (platform !== "meta" && platform !== "google" && platform !== "tiktok") continue;
      const day = r.synced_at.slice(0, 10) as DayKey;
      const key = `${day}:${platform}` as `${DayKey}:${Platform}`;
      const prev = roasAcc.get(key) ?? { sum: 0, count: 0 };
      roasAcc.set(key, { sum: prev.sum + Number(r.roas), count: prev.count + 1 });
    }

    // Collect all distinct days from both sources
    const allDays = new Set<DayKey>();
    for (const k of latestSnap.keys()) allDays.add(k.split(":")[0] as DayKey);
    for (const k of roasAcc.keys())    allDays.add(k.split(":")[0] as DayKey);

    return [...allDays].sort().map(day => {
      const metaSnap   = latestSnap.get(`${day}:meta`);
      const googleSnap = latestSnap.get(`${day}:google`);
      const tiktokSnap = latestSnap.get(`${day}:tiktok`);
      const metaRoas   = roasAcc.get(`${day}:meta`);
      const googleRoas = roasAcc.get(`${day}:google`);
      const tiktokRoas = roasAcc.get(`${day}:tiktok`);

      const dt    = new Date(day + "T00:00:00Z");
      const label = dt.toLocaleDateString("en-GB", { month: "short", day: "numeric", timeZone: "UTC" });

      const point: TrendPoint = { date: label };

      if (metaSnap)   { point.meta_spend = +metaSnap.spend.toFixed(2); point.meta_impressions = metaSnap.impressions; point.meta_conversions = metaSnap.conversions; }
      if (googleSnap) { point.google_spend = +googleSnap.spend.toFixed(2); point.google_impressions = googleSnap.impressions; point.google_conversions = googleSnap.conversions; }
      if (tiktokSnap) { point.tiktok_spend = +tiktokSnap.spend.toFixed(2); point.tiktok_impressions = tiktokSnap.impressions; point.tiktok_conversions = tiktokSnap.conversions; }
      if (metaRoas   && metaRoas.count   > 0) point.meta_roas   = +(metaRoas.sum   / metaRoas.count).toFixed(2);
      if (googleRoas && googleRoas.count > 0) point.google_roas = +(googleRoas.sum / googleRoas.count).toFixed(2);
      if (tiktokRoas && tiktokRoas.count > 0) point.tiktok_roas = +(tiktokRoas.sum / tiktokRoas.count).toFixed(2);

      return point;
    });
  });

// ── Budget cap CRUD ─────────────────────────────────────────────────────────────

interface BudgetCap {
  platform: "meta" | "google";
  monthly_budget_cap: number | null;
  alert_at_pct: number;
  currency: string;
}

const getBudgetCaps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BudgetCap[]> => {
    const sb = context.supabase as any;
    const { workspaceId } = context;
    if (!workspaceId) return [];
    try {
      const { data } = await sb
        .from("growthmind_ad_budget_caps")
        .select("platform,monthly_budget_cap,alert_at_pct,currency")
        .eq("workspace_id", workspaceId)
        .in("platform", ["meta", "google"]);
      return (data ?? []).map((r: any) => ({
        platform:           r.platform,
        monthly_budget_cap: r.monthly_budget_cap ? Number(r.monthly_budget_cap) : null,
        alert_at_pct:       Number(r.alert_at_pct ?? 80),
        currency:           r.currency ?? "GBP",
      }));
    } catch {
      return [];
    }
  });

const saveBudgetCap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { platform: string; monthly_budget_cap: number | null; alert_at_pct: number; currency: string }) => i)
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const now = new Date().toISOString();
    await sb.from("growthmind_ad_budget_caps").upsert(
      {
        workspace_id:       workspaceId,
        platform:           data.platform,
        monthly_budget_cap: data.monthly_budget_cap,
        alert_at_pct:       data.alert_at_pct,
        currency:           data.currency,
        updated_at:         now,
      },
      { onConflict: "workspace_id,platform" },
    );
    return { ok: true };
  });

// ── Delta badge ────────────────────────────────────────────────────────────────

function DeltaBadge({ pct }: { pct: number }) {
  const up   = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <div className={cn("flex items-center gap-0.5 text-[9px] font-semibold leading-none", up ? "text-emerald-400" : "text-red-400")}>
      <Icon className="h-2.5 w-2.5 shrink-0" />
      <span>{up ? "+" : ""}{pct.toFixed(1)}%</span>
      <span className="text-muted-foreground/40 font-normal ml-0.5">vs last wk</span>
    </div>
  );
}

// ── Hero aggregate stats ────────────────────────────────────────────────────────

function HeroStats({ data }: { data: AdsPerformanceData }) {
  const totalImpressions = data.meta.impressions + data.google.impressions;
  const totalClicks      = data.meta.clicks      + data.google.clicks;
  const totalConversions = data.meta.conversions  + data.google.conversions;

  const roasCamps = data.campaigns.filter(c => c.roas != null && c.roas > 0);
  const blendedRoas = roasCamps.length > 0
    ? +(roasCamps.reduce((a, c) => a + Number(c.roas), 0) / roasCamps.length).toFixed(2)
    : null;

  const overallCtr = totalImpressions > 0
    ? +(totalClicks / totalImpressions * 100).toFixed(2)
    : null;

  const d = data.deltas;

  const stats = [
    { label: "Total Spend",    value: fmtCurrency(data.totalSpend),                                   icon: DollarSign,        cls: "text-foreground",     delta: d.spendPct       },
    { label: "Blended ROAS",   value: blendedRoas !== null ? `${blendedRoas.toFixed(2)}x` : "—",      icon: TrendingUp,        cls: roasColor(blendedRoas),delta: d.roasPct        },
    { label: "Impressions",    value: fmt(totalImpressions),                                           icon: Eye,               cls: "text-foreground",     delta: d.impressionsPct },
    { label: "Clicks",         value: fmt(totalClicks),                                               icon: MousePointerClick, cls: "text-foreground",     delta: null             },
    { label: "CTR",            value: overallCtr !== null ? `${overallCtr}%` : "—",                   icon: TrendingUp,        cls: "text-foreground",     delta: null             },
    { label: "Conversions",    value: fmt(totalConversions),                                          icon: ShoppingCart,      cls: "text-foreground",     delta: d.conversionsPct },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {stats.map(s => (
        <div key={s.label} className="rounded-xl border border-white/[0.06] bg-card/40 p-3.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <s.icon className="h-3 w-3 text-muted-foreground/50 shrink-0" />
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">{s.label}</span>
          </div>
          <p className={cn("text-lg font-bold tabular-nums leading-none", s.cls)}>{s.value}</p>
          {s.delta !== null && <DeltaBadge pct={s.delta} />}
        </div>
      ))}
    </div>
  );
}

// ── Sync history panel ──────────────────────────────────────────────────────────

function SyncHistoryPanel() {
  const histFn = useServerFn(getSyncHistory);
  const [open, setOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey:  ["ads-sync-history"],
    queryFn:   () => histFn(),
    enabled:   open,
    staleTime: 60_000,
  });

  const STATUS_ICON: Record<string, React.ReactNode> = {
    success: <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />,
    error:   <XCircle      className="h-3 w-3 text-red-400    shrink-0" />,
    partial: <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />,
  };

  const PLATFORM_BADGE: Record<string, string> = {
    meta:   "bg-blue-500/15 text-blue-400",
    google: "bg-emerald-500/15 text-emerald-400",
    tiktok: "bg-pink-500/15 text-pink-400",
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/40">
      <button
        className="w-full flex items-center gap-2 px-5 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <RefreshCw className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/60 flex-1">
          Sync History
        </span>
        <span className="text-[10px] text-muted-foreground/40">{open ? "Hide" : "View recent syncs"}</span>
      </button>

      {open && (
        <div className="border-t border-white/[0.06]">
          {isLoading ? (
            <div className="flex items-center gap-2 p-5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sync log…
            </div>
          ) : rows.length === 0 ? (
            <div className="p-5 text-center">
              <p className="text-xs text-muted-foreground/60">No sync history yet. Click "Sync Now" to start your first sync.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.04]">
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Platform</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Status</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Campaigns</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Spend</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Impressions</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Conversions</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">When</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5">
                        <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded-full", PLATFORM_BADGE[r.platform] ?? "bg-slate-500/15 text-slate-400")}>
                          {r.platform.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {STATUS_ICON[r.status] ?? <Minus className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
                          <span className={cn(
                            "text-[10px] font-medium capitalize",
                            r.status === "success" ? "text-emerald-400" : r.status === "error" ? "text-red-400" : "text-amber-400",
                          )}>
                            {r.status}
                          </span>
                          {r.errorMessage && (
                            <span className="text-[10px] text-muted-foreground/50 truncate max-w-[180px]" title={r.errorMessage}>
                              — {r.errorMessage}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{r.campaignsSynced}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                        {r.spendTotal != null ? fmtCurrency(r.spendTotal) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {r.impressionsTotal != null ? fmt(r.impressionsTotal) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {r.conversionsTotal != null ? fmt(r.conversionsTotal) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground/60 whitespace-nowrap">
                        {timeAgo(r.syncedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Budget caps configuration panel ────────────────────────────────────────────

const PLATFORM_CAP_CONFIG = [
  { platform: "meta"   as const, label: "Meta Ads",   color: "text-blue-400" },
  { platform: "google" as const, label: "Google Ads", color: "text-emerald-400" },
];

function BudgetCapsPanel({ hasAnyCap }: { hasAnyCap: boolean }) {
  const qc          = useQueryClient();
  const getCapsFn   = useServerFn(getBudgetCaps);
  const saveCapFn   = useServerFn(saveBudgetCap);

  const { data: caps = [], isLoading } = useQuery({
    queryKey: ["budget-caps"],
    queryFn:  () => getCapsFn(),
    staleTime: 30_000,
  });

  type DraftCap = { monthly_budget_cap: string; alert_at_pct: string; currency: string };
  const [drafts,  setDrafts]  = useState<Record<string, DraftCap>>({});
  const [saving,  setSaving]  = useState<Record<string, boolean>>({});
  const [open,    setOpen]    = useState(!hasAnyCap);

  function getDraft(platform: string): DraftCap {
    if (drafts[platform]) return drafts[platform];
    const existing = caps.find(c => c.platform === platform);
    return {
      monthly_budget_cap: existing?.monthly_budget_cap != null ? String(existing.monthly_budget_cap) : "",
      alert_at_pct:       String(existing?.alert_at_pct ?? 80),
      currency:           existing?.currency ?? "GBP",
    };
  }

  function setDraft(platform: string, patch: Partial<DraftCap>) {
    setDrafts(d => ({ ...d, [platform]: { ...getDraft(platform), ...patch } }));
  }

  async function handleSave(platform: string) {
    setSaving(s => ({ ...s, [platform]: true }));
    try {
      const draft = getDraft(platform);
      const cap   = draft.monthly_budget_cap.trim() === "" ? null : Number(draft.monthly_budget_cap);
      const pct   = Math.max(1, Math.min(100, Number(draft.alert_at_pct) || 80));
      await saveCapFn({ data: { platform, monthly_budget_cap: cap, alert_at_pct: pct, currency: draft.currency || "GBP" } });
      toast.success(`${platform === "meta" ? "Meta" : "Google"} Ads budget cap saved`);
      qc.invalidateQueries({ queryKey: ["budget-caps"] });
      qc.invalidateQueries({ queryKey: ["ads-performance"] });
      setDrafts(d => { const n = { ...d }; delete n[platform]; return n; });
    } catch (e: any) { toast.error(e.message); }
    setSaving(s => ({ ...s, [platform]: false }));
  }

  const configuredCaps = PLATFORM_CAP_CONFIG.filter(({ platform }) => {
    const existing = caps.find(c => c.platform === platform);
    return existing?.monthly_budget_cap != null;
  });

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/40">
      <button
        className="w-full flex items-center gap-2 px-5 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <Settings2 className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/60 flex-1">
          Budget Caps & Alert Thresholds
        </span>
        {!open && configuredCaps.length > 0 && (
          <span className="text-[10px] text-emerald-400/80 font-medium">
            {configuredCaps.map(({ platform, label }) => {
              const cap = caps.find(c => c.platform === platform);
              const sym = cap?.currency === "USD" ? "$" : cap?.currency === "EUR" ? "€" : "£";
              return `${label}: ${sym}${(cap?.monthly_budget_cap ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
            }).join(" · ")}
          </span>
        )}
        {!open && configuredCaps.length === 0 && !isLoading && (
          <span className="text-[10px] text-amber-400/70">No caps set — click to configure</span>
        )}
        <Bell className="h-3 w-3 text-muted-foreground/40 ml-1" />
        <span className="text-[10px] text-muted-foreground/40 ml-1">{open ? "Hide" : "Edit"}</span>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-5 pb-5 pt-4 space-y-5">
          <p className="text-[11px] text-muted-foreground/70">
            Set per-platform monthly spend caps. Alerts fire at your chosen percentage (default 80%) and again at 100%.
          </p>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PLATFORM_CAP_CONFIG.map(({ platform, label, color }) => {
                const draft = getDraft(platform);
                return (
                  <div key={platform} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
                    <span className={cn("text-xs font-semibold", color)}>{label}</span>

                    <div className="space-y-2">
                      <label className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
                        Monthly Budget Cap
                        <span className="normal-case font-normal text-muted-foreground/50">(leave blank to disable)</span>
                      </label>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={draft.currency}
                          onChange={e => setDraft(platform, { currency: e.target.value })}
                          className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                        >
                          <option value="GBP">£ GBP</option>
                          <option value="USD">$ USD</option>
                          <option value="EUR">€ EUR</option>
                        </select>
                        <Input
                          type="number"
                          min="0"
                          step="100"
                          placeholder="e.g. 5000"
                          value={draft.monthly_budget_cap}
                          onChange={e => setDraft(platform, { monthly_budget_cap: e.target.value })}
                          className="h-7 text-xs flex-1"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                        Alert at (% of budget)
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          max="100"
                          placeholder="80"
                          value={draft.alert_at_pct}
                          onChange={e => setDraft(platform, { alert_at_pct: e.target.value })}
                          className="h-7 text-xs w-20"
                        />
                        <span className="text-xs text-muted-foreground/60">%</span>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-3 text-[10px] gap-1"
                      disabled={saving[platform]}
                      onClick={() => handleSave(platform)}
                    >
                      {saving[platform] ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
                      Save
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Historical trend charts ─────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { label: "7d",  days: 7  },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

type RangeDays = 7 | 30 | 90;

const CHART_PANELS = [
  {
    key:        "spend" as const,
    label:      "Spend",
    metaKey:    "meta_spend",
    googleKey:  "google_spend",
    tiktokKey:  "tiktok_spend",
    fmt:        (v: number) => `£${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`,
    yFmt:       (v: number) => `£${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v}`,
  },
  {
    key:        "roas" as const,
    label:      "ROAS",
    metaKey:    "meta_roas",
    googleKey:  "google_roas",
    tiktokKey:  "tiktok_roas",
    fmt:        (v: number) => `${v.toFixed(2)}x`,
    yFmt:       (v: number) => `${v.toFixed(1)}x`,
  },
  {
    key:        "impressions" as const,
    label:      "Impressions",
    metaKey:    "meta_impressions",
    googleKey:  "google_impressions",
    tiktokKey:  "tiktok_impressions",
    fmt:        (v: number) => v.toLocaleString("en-GB"),
    yFmt:       (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
  },
  {
    key:        "conversions" as const,
    label:      "Conversions",
    metaKey:    "meta_conversions",
    googleKey:  "google_conversions",
    tiktokKey:  "tiktok_conversions",
    fmt:        (v: number) => v.toLocaleString("en-GB"),
    yFmt:       (v: number) => String(v),
  },
] as const;

function AdsTrendCharts() {
  const trendFn          = useServerFn(getAdsTrendData);
  const [range, setRange] = useState<RangeDays>(30);

  const { data: points = [], isLoading } = useQuery({
    queryKey:  ["ads-trend", range],
    queryFn:   () => trendFn({ data: { days: range } }),
    staleTime: 5 * 60_000,
  });

  const hasAnyData = points.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">
          Historical Trends
        </h2>
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.days}
              onClick={() => setRange(opt.days as RangeDays)}
              className={cn(
                "px-2.5 py-1 rounded text-[10px] font-semibold transition-colors",
                range === opt.days
                  ? "bg-white/[0.08] text-foreground"
                  : "text-muted-foreground/60 hover:text-muted-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 rounded-xl border border-white/[0.06] bg-card/40">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
        </div>
      ) : !hasAnyData ? (
        <div className="flex flex-col items-center justify-center h-40 rounded-xl border border-dashed border-white/[0.08] text-center gap-2">
          <TrendingUp className="h-6 w-6 text-muted-foreground/20" />
          <p className="text-xs text-muted-foreground/60">No sync history yet for this range</p>
          <p className="text-[10px] text-muted-foreground/40">Charts populate after your first successful sync</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CHART_PANELS.map(panel => {
            const hasMetaData   = points.some(p => (p as any)[panel.metaKey]   != null);
            const hasGoogleData = points.some(p => (p as any)[panel.googleKey] != null);
            const hasTiktokData = points.some(p => (p as any)[panel.tiktokKey] != null);

            if (!hasMetaData && !hasGoogleData && !hasTiktokData) return null;

            return (
              <div key={panel.key} className="rounded-xl border border-white/[0.06] bg-card/40 p-4 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">
                  {panel.label}
                </p>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`meta-${panel.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}    />
                      </linearGradient>
                      <linearGradient id={`google-${panel.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}    />
                      </linearGradient>
                      <linearGradient id={`tiktok-${panel.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#e879f9" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#e879f9" stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: "rgba(255,255,255,0.35)" }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "rgba(255,255,255,0.35)" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={panel.yFmt}
                      width={52}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(15,15,20,0.92)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 8,
                        fontSize: 11,
                        color: "rgba(255,255,255,0.85)",
                      }}
                      labelStyle={{ color: "rgba(255,255,255,0.55)", marginBottom: 4, fontSize: 10 }}
                      formatter={(value: number) => [panel.fmt(value)]}
                    />
                    {hasMetaData && (
                      <Area
                        type="monotone"
                        dataKey={panel.metaKey}
                        name="Meta"
                        stroke="#3b82f6"
                        strokeWidth={1.5}
                        fill={`url(#meta-${panel.key})`}
                        dot={false}
                        connectNulls
                      />
                    )}
                    {hasGoogleData && (
                      <Area
                        type="monotone"
                        dataKey={panel.googleKey}
                        name="Google"
                        stroke="#10b981"
                        strokeWidth={1.5}
                        fill={`url(#google-${panel.key})`}
                        dot={false}
                        connectNulls
                      />
                    )}
                    {hasTiktokData && (
                      <Area
                        type="monotone"
                        dataKey={panel.tiktokKey}
                        name="TikTok"
                        stroke="#e879f9"
                        strokeWidth={1.5}
                        fill={`url(#tiktok-${panel.key})`}
                        dot={false}
                        connectNulls
                      />
                    )}
                    {(hasMetaData || hasGoogleData || hasTiktokData) && (
                      <Legend
                        iconType="circle"
                        iconSize={6}
                        wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
                        formatter={(value) => (
                          <span style={{ color: "rgba(255,255,255,0.55)" }}>{value}</span>
                        )}
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Spend-by-platform bar chart ────────────────────────────────────────────────

function SpendComparisonChart({ meta, google }: { meta: PlatformTotals; google: PlatformTotals }) {
  const totalSpend = meta.spend + google.spend;
  if (totalSpend === 0) return null;

  const metaPct   = totalSpend > 0 ? (meta.spend   / totalSpend) * 100 : 0;
  const googlePct = totalSpend > 0 ? (google.spend / totalSpend) * 100 : 0;

  const items = [
    { label: "Meta Ads",   spend: meta.spend,   pct: metaPct,   roas: meta.avgRoas,   color: "bg-blue-500", textColor: "text-blue-400" },
    { label: "Google Ads", spend: google.spend, pct: googlePct, roas: google.avgRoas, color: "bg-emerald-500", textColor: "text-emerald-400" },
  ];

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/40 p-5 space-y-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">Spend by Platform</h3>
      <div className="space-y-3">
        {items.map(item => (
          <div key={item.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className={item.textColor + " font-semibold"}>{item.label}</span>
              <div className="flex items-center gap-3">
                <span className="font-bold tabular-nums">£{item.spend.toFixed(2)}</span>
                {item.roas !== null && (
                  <span className={cn("text-[10px] tabular-nums", roasColor(item.roas))}>
                    {item.roas.toFixed(2)}x ROAS
                  </span>
                )}
                <span className="text-muted-foreground/50 text-[10px] tabular-nums w-8 text-right">
                  {item.pct.toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-white/[0.05] overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500", item.color)}
                style={{ width: `${item.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("en-GB", { maximumFractionDigits: decimals });
}

function fmtCurrency(n: number): string {
  return `£${fmt(n, 2)}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function roasColor(roas: number | null): string {
  if (roas === null) return "text-muted-foreground";
  if (roas >= 3)     return "text-emerald-400";
  if (roas >= 1)     return "text-amber-400";
  return "text-red-400";
}

function alertTypeLabel(type: string): string {
  switch (type) {
    case "zero_spend":       return "Zero Spend";
    case "budget_80pct":     return "Budget 80%";
    case "budget_exceeded":  return "Budget Exceeded";
    case "roas_drop":        return "Low ROAS";
    case "high_cpl":         return "High CPL";
    default: return type.replace(/_/g, " ");
  }
}

// ── Budget utilization bar ─────────────────────────────────────────────────────

function BudgetUtilizationBar({
  spend, cap, alertAtPct, currency,
}: {
  spend: number;
  cap: number;
  alertAtPct: number;
  currency: string;
}) {
  const pct         = Math.min((spend / cap) * 100, 100);
  const alertPct    = Math.min(alertAtPct, 100);
  const sym         = currency === "USD" ? "$" : currency === "EUR" ? "€" : "£";
  const isExceeded  = spend >= cap;
  const isWarning   = !isExceeded && spend >= cap * (alertAtPct / 100);

  const barColor = isExceeded
    ? "bg-red-500"
    : isWarning
      ? "bg-amber-500"
      : "bg-emerald-500";

  const labelColor = isExceeded
    ? "text-red-400"
    : isWarning
      ? "text-amber-400"
      : "text-muted-foreground/70";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground/60 font-medium uppercase tracking-wider">Monthly Budget</span>
        <span className={cn("font-semibold tabular-nums", labelColor)}>
          {sym}{spend.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
          {" / "}
          {sym}{cap.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
          {" "}
          <span className="font-normal opacity-70">({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-white/[0.05] overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", barColor)}
          style={{ width: `${pct}%` }}
        />
        {alertPct < 100 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-white/20"
            style={{ left: `${alertPct}%` }}
            title={`Alert threshold: ${alertPct}%`}
          />
        )}
      </div>
      {isExceeded && (
        <p className="text-[10px] text-red-400 font-medium">Monthly budget exceeded — review campaigns</p>
      )}
      {isWarning && !isExceeded && (
        <p className="text-[10px] text-amber-400">
          {Math.round(pct)}% used — approaching {sym}{cap.toLocaleString("en-GB", { maximumFractionDigits: 0 })} cap
        </p>
      )}
    </div>
  );
}

// ── Platform summary card ──────────────────────────────────────────────────────

function PlatformCard({
  name, logo, totals, hasCreds, cap,
}: {
  name: string;
  logo: React.ReactNode;
  totals: PlatformTotals;
  hasCreds: boolean;
  cap?: BudgetCapSummary | null;
}) {
  if (!hasCreds) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-card/40 p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {logo}
          <span className="text-sm font-semibold">{name}</span>
          <span className="ml-auto text-[10px] bg-slate-500/15 text-slate-400 px-2 py-0.5 rounded-full font-semibold">Not Connected</span>
        </div>
        <p className="text-xs text-muted-foreground">Connect your {name} account in Provider Settings to start syncing campaign data.</p>
        <Link to="/settings/providers" className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 mt-auto">
          Connect <ExternalLink className="h-2.5 w-2.5" />
        </Link>
      </div>
    );
  }

  if (totals.count === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-card/40 p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {logo}
          <span className="text-sm font-semibold">{name}</span>
          <span className="ml-auto text-[10px] bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full font-semibold">Awaiting Sync</span>
        </div>
        <p className="text-xs text-muted-foreground">Credentials saved. Click "Sync Now" to pull campaign data from {name}.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/40 p-5 space-y-4">
      <div className="flex items-center gap-2">
        {logo}
        <span className="text-sm font-semibold">{name}</span>
        <span className="ml-auto text-[10px] bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">
          {totals.count} campaign{totals.count !== 1 ? "s" : ""}
        </span>
      </div>

      {cap?.monthly_budget_cap ? (
        <BudgetUtilizationBar
          spend={totals.spend}
          cap={cap.monthly_budget_cap}
          alertAtPct={cap.alert_at_pct}
          currency={cap.currency}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Metric label="Spend" value={fmtCurrency(totals.spend)} icon={DollarSign} />
        <Metric label="ROAS"
          value={totals.avgRoas !== null ? `${totals.avgRoas.toFixed(2)}x` : "—"}
          icon={TrendingUp}
          valueClass={roasColor(totals.avgRoas)}
        />
        <Metric label="Impressions" value={fmt(totals.impressions)} icon={Eye} />
        <Metric label="Clicks"      value={fmt(totals.clicks)}      icon={MousePointerClick} />
        <Metric label="CTR"         value={totals.ctr !== null ? `${totals.ctr}%` : "—"} icon={TrendingUp} />
        <Metric label="Conversions" value={fmt(totals.conversions)} icon={ShoppingCart} />
      </div>

      <p className="text-[10px] text-muted-foreground/60">
        Last synced: {timeAgo(totals.lastSyncedAt)}
      </p>
    </div>
  );
}

function Metric({
  label, value, icon: Icon, valueClass,
}: {
  label: string; value: string; icon: React.ElementType; valueClass?: string;
}) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-2.5">
      <div className="flex items-center gap-1 mb-1">
        <Icon className="h-2.5 w-2.5 text-muted-foreground/50" />
        <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn("text-sm font-bold tabular-nums", valueClass ?? "text-foreground")}>{value}</p>
    </div>
  );
}

// ── Sortable table header ──────────────────────────────────────────────────────

type SortKey = "spend" | "impressions" | "clicks" | "ctr" | "conversions" | "roas" | "cpl";

function SortTh({
  label, sortKey, current, dir, onClick, align = "right",
}: {
  label: string; sortKey: SortKey; current: SortKey; dir: "asc" | "desc";
  onClick: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onClick(sortKey)}
      className={cn(
        "px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground transition-colors",
        align === "left" ? "text-left" : "text-right",
      )}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active ? (
          dir === "desc"
            ? <TrendingDown className="h-2.5 w-2.5 text-emerald-400" />
            : <TrendingUp className="h-2.5 w-2.5 text-emerald-400" />
        ) : (
          <Minus className="h-2 w-2 opacity-30" />
        )}
      </span>
    </th>
  );
}

// ── Campaign row ───────────────────────────────────────────────────────────────

function CampaignRow({ c }: { c: AdCampaign }) {
  const ctr = c.impressions > 0 ? (c.clicks / c.impressions * 100).toFixed(2) : null;
  const cpl  = c.conversions > 0 ? (c.spend / c.conversions).toFixed(2) : null;

  const PLATFORM_BADGE: Record<string, string> = {
    meta:   "bg-blue-500/15 text-blue-400",
    google: "bg-emerald-500/15 text-emerald-400",
  };

  return (
    <tr className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      <td className="px-3 py-3 max-w-[180px]">
        <div className="flex items-center gap-2">
          <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0", PLATFORM_BADGE[c.platform] ?? "bg-slate-500/15 text-slate-400")}>
            {c.platform === "meta" ? "META" : "GOOGLE"}
          </span>
          <span className="text-xs font-medium truncate" title={c.name}>{c.name}</span>
        </div>
      </td>
      <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums">{fmtCurrency(c.spend)}</td>
      <td className="px-3 py-3 text-right text-xs text-muted-foreground tabular-nums">{fmt(c.impressions)}</td>
      <td className="px-3 py-3 text-right text-xs text-muted-foreground tabular-nums">{fmt(c.clicks)}</td>
      <td className="px-3 py-3 text-right text-xs text-muted-foreground tabular-nums">{ctr !== null ? `${ctr}%` : "—"}</td>
      <td className="px-3 py-3 text-right text-xs text-muted-foreground tabular-nums">{fmt(c.conversions)}</td>
      <td className="px-3 py-3 text-right text-xs tabular-nums">
        {c.roas !== null
          ? <span className={cn("font-semibold", roasColor(c.roas))}>{c.roas.toFixed(2)}x</span>
          : <span className="text-muted-foreground">—</span>
        }
      </td>
      <td className="px-3 py-3 text-right text-xs text-muted-foreground tabular-nums">
        {cpl !== null ? `£${cpl}` : "—"}
      </td>
    </tr>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

function AdsPerformancePage() {
  const qc        = useQueryClient();
  const dataFn    = useServerFn(getAdsPerformanceData);
  const syncFn    = useServerFn(triggerAdsSync);
  const ackFn     = useServerFn(acknowledgeAlert);

  const [sortKey, setSortKey]               = useState<SortKey>("spend");
  const [sortDir, setSortDir]               = useState<"asc" | "desc">("desc");
  const [dismissedErrorIds, setDismissedErrorIds] = useState<Set<string>>(new Set());

  function dismissSyncError(id: string) {
    setDismissedErrorIds(prev => new Set([...prev, id]));
  }

  const { data, isLoading } = useQuery({
    queryKey: ["ads-performance"],
    queryFn:  () => dataFn(),
    staleTime: 60_000,
  });

  const syncMut = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: (result) => {
      const total = result.results.reduce((a, r) => a + r.campaigns, 0);
      const errors = result.results.filter(r => r.status === "error");
      if (errors.length > 0) {
        toast.error(`Sync partially failed: ${errors.map(e => `${e.platform}: ${e.error}`).join("; ")}`);
      } else {
        toast.success(`Synced ${total} campaign${total !== 1 ? "s" : ""} from ${result.results.length} platform(s)`);
      }
      qc.invalidateQueries({ queryKey: ["ads-performance"] });
      qc.invalidateQueries({ queryKey: ["ads-sync-history"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Sync failed"),
  });

  const ackMut = useMutation({
    mutationFn: (alertId: string) => ackFn({ data: { alertId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ads-performance"] }),
  });

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const hasAnyCreds = (data?.hasMetaCreds || data?.hasGoogleCreds) ?? false;
  const alerts      = data?.alerts ?? [];

  const campaigns = [...(data?.campaigns ?? [])].sort((a, b) => {
    function val(c: AdCampaign): number {
      switch (sortKey) {
        case "spend":       return c.spend;
        case "impressions": return c.impressions;
        case "clicks":      return c.clicks;
        case "conversions": return c.conversions;
        case "roas":        return c.roas ?? -Infinity;
        case "ctr":         return c.impressions > 0 ? c.clicks / c.impressions : -Infinity;
        case "cpl":         return c.conversions > 0 ? c.spend / c.conversions : Infinity;
        default:            return 0;
      }
    }
    const diff = val(a) - val(b);
    return sortDir === "desc" ? -diff : diff;
  });

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-6xl space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/15 ring-1 ring-blue-500/25">
            <BarChart2 className="h-4 w-4 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold">Ads Performance</h1>
            <p className="text-xs text-muted-foreground">Live campaign metrics from Meta & Google Ads</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Sync health badge */}
            {data?.syncHealth && (() => {
              const h = data.syncHealth;
              const dotCls =
                h.healthLevel === "green" ? "bg-emerald-400 shadow-[0_0_5px_1px_rgba(52,211,153,0.45)]" :
                h.healthLevel === "amber" ? "bg-amber-400  shadow-[0_0_5px_1px_rgba(251,191,36,0.35)]"  :
                                            "bg-red-400    shadow-[0_0_5px_1px_rgba(248,113,113,0.35)]";
              const textCls =
                h.healthLevel === "green" ? "text-emerald-400" :
                h.healthLevel === "amber" ? "text-amber-400"   :
                                            "text-red-400";
              const statusLabel =
                h.overallStatus === "success" ? "Healthy" :
                h.overallStatus === "partial" ? "Partial" :
                h.overallStatus === "error"   ? "Error"   : "No data";
              return (
                <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5">
                  <Activity className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                  <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold", textCls)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotCls)} />
                    {statusLabel}
                  </span>
                  {h.lastSyncedAt && (
                    <>
                      <span className="h-2.5 w-px bg-white/10 shrink-0" />
                      <Clock className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
                      <span className="text-[10px] text-muted-foreground/60">{timeAgo(h.lastSyncedAt)}</span>
                    </>
                  )}
                </div>
              );
            })()}
            <Button
              size="sm"
              variant="outline"
              onClick={() => syncMut.mutate()}
              disabled={syncMut.isPending || isLoading}
              className="h-8 gap-1.5 text-xs border-white/[0.08]"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncMut.isPending && "animate-spin")} />
              {syncMut.isPending ? "Syncing…" : "Sync Now"}
            </Button>
          </div>
        </div>

        {/* Sync error banners (separate from budget alerts — dismissible, from sync log) */}
        {(() => {
          const visibleErrors = (data?.syncHealth?.recentErrors ?? []).filter(e => !dismissedErrorIds.has(e.id));
          if (visibleErrors.length === 0) return null;
          return (
            <div className="space-y-2">
              {visibleErrors.map(err => (
                <div
                  key={err.id}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-xl border px-4 py-2.5",
                    err.status === "error"
                      ? "border-red-500/20 bg-red-500/[0.05]"
                      : "border-amber-500/20 bg-amber-500/[0.05]",
                  )}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {err.status === "error"
                      ? <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                      : <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />}
                    <div className="min-w-0">
                      <p className={cn("text-xs font-semibold", err.status === "error" ? "text-red-300" : "text-amber-300")}>
                        {err.status === "error" ? "Sync error" : "Partial sync"} · {err.platform} · {timeAgo(err.syncedAt)}
                      </p>
                      {err.errorMessage && (
                        <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate max-w-lg" title={err.errorMessage}>
                          {err.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => dismissSyncError(err.id)}
                    className="shrink-0 p-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors mt-0.5"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* No credentials state */}
        {!isLoading && !hasAnyCreds && (
          <div className="rounded-xl border border-white/[0.06] bg-card/60 p-8 text-center space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 ring-1 ring-blue-500/20 mx-auto">
              <BarChart2 className="h-5 w-5 text-blue-400" />
            </div>
            <h2 className="text-sm font-semibold">No Ads Accounts Connected</h2>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Connect your Meta Ads or Google Ads account in Provider Settings to start pulling live campaign performance data.
            </p>
            <Link to="/settings/providers">
              <Button size="sm" className="mt-2 bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5">
                <Zap className="h-3.5 w-3.5" /> Connect Ads
              </Button>
            </Link>
          </div>
        )}

        {!isLoading && hasAnyCreds && (
          <>
            {/* Hero aggregate stats — only once there is synced data */}
            {data?.hasSyncedData && <HeroStats data={data} />}

            {/* Budget alerts */}
            {alerts.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">Budget Alerts</h2>
                <div className="space-y-2">
                  {alerts.map(a => (
                    <div key={a.id} className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 flex items-start gap-3">
                      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[10px] font-semibold text-amber-400 uppercase">{alertTypeLabel(a.alert_type)}</span>
                          <span className="text-[10px] text-muted-foreground/60">{a.platform}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{a.message}</p>
                      </div>
                      <button
                        onClick={() => ackMut.mutate(a.id)}
                        className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground shrink-0 mt-0.5"
                      >
                        Dismiss
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Spend-by-platform comparison chart */}
            {(data?.meta.spend ?? 0) + (data?.google.spend ?? 0) > 0 && (
              <SpendComparisonChart
                meta={data?.meta   ?? { count: 0, spend: 0, impressions: 0, clicks: 0, conversions: 0, avgRoas: null, ctr: null, lastSyncedAt: null }}
                google={data?.google ?? { count: 0, spend: 0, impressions: 0, clicks: 0, conversions: 0, avgRoas: null, ctr: null, lastSyncedAt: null }}
              />
            )}

            {/* Historical trend charts */}
            <AdsTrendCharts />

            {/* Platform cards */}
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">Platform Overview</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <PlatformCard
                  name="Meta Ads"
                  hasCreds={data?.hasMetaCreds ?? false}
                  totals={data?.meta ?? { count: 0, spend: 0, impressions: 0, clicks: 0, conversions: 0, avgRoas: null, ctr: null, lastSyncedAt: null }}
                  cap={(data?.caps ?? []).find(c => c.platform === "meta") ?? null}
                  logo={<div className="h-5 w-5 rounded bg-blue-600/20 flex items-center justify-center shrink-0">
                    <span className="text-[9px] font-bold text-blue-400">M</span>
                  </div>}
                />
                <PlatformCard
                  name="Google Ads"
                  hasCreds={data?.hasGoogleCreds ?? false}
                  totals={data?.google ?? { count: 0, spend: 0, impressions: 0, clicks: 0, conversions: 0, avgRoas: null, ctr: null, lastSyncedAt: null }}
                  cap={(data?.caps ?? []).find(c => c.platform === "google") ?? null}
                  logo={<div className="h-5 w-5 rounded bg-emerald-600/20 flex items-center justify-center shrink-0">
                    <span className="text-[9px] font-bold text-emerald-400">G</span>
                  </div>}
                />
              </div>
            </div>

            {/* Campaign table */}
            {campaigns.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">
                    All Campaigns ({campaigns.length})
                  </h2>
                  <span className="text-[10px] text-muted-foreground/50">Last 30 days</span>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-card/40 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/[0.06]">
                          <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 text-left">Campaign</th>
                          <SortTh label="Spend"       sortKey="spend"       current={sortKey} dir={sortDir} onClick={handleSort} />
                          <SortTh label="Impressions" sortKey="impressions" current={sortKey} dir={sortDir} onClick={handleSort} />
                          <SortTh label="Clicks"      sortKey="clicks"      current={sortKey} dir={sortDir} onClick={handleSort} />
                          <SortTh label="CTR"         sortKey="ctr"         current={sortKey} dir={sortDir} onClick={handleSort} />
                          <SortTh label="Conversions" sortKey="conversions" current={sortKey} dir={sortDir} onClick={handleSort} />
                          <SortTh label="ROAS"        sortKey="roas"        current={sortKey} dir={sortDir} onClick={handleSort} />
                          <SortTh label="CPL"         sortKey="cpl"         current={sortKey} dir={sortDir} onClick={handleSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.map(c => <CampaignRow key={c.id} c={c} />)}
                      </tbody>
                      {/* Totals row */}
                      <tfoot>
                        <tr className="border-t border-white/[0.06] bg-white/[0.02]">
                          <td className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">Total</td>
                          <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums">{fmtCurrency(data?.totalSpend ?? 0)}</td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                            {fmt(campaigns.reduce((a, c) => a + c.impressions, 0))}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                            {fmt(campaigns.reduce((a, c) => a + c.clicks, 0))}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">—</td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                            {fmt(campaigns.reduce((a, c) => a + c.conversions, 0))}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">—</td>
                          <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">—</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* No campaigns yet */}
            {campaigns.length === 0 && (
              <div className="rounded-xl border border-dashed border-white/[0.1] p-8 text-center space-y-2">
                <RefreshCw className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                <p className="text-sm font-medium">No campaign data yet</p>
                <p className="text-xs text-muted-foreground">
                  Click "Sync Now" above to pull live campaign metrics from your connected ad accounts.
                </p>
              </div>
            )}

            {/* Sync history */}
            <SyncHistoryPanel />

            {/* Budget alert threshold configuration */}
            <BudgetCapsPanel hasAnyCap={(data?.caps ?? []).some(c => c.monthly_budget_cap != null)} />

            {/* Connect more platforms */}
            {!(data?.hasMetaCreds && data?.hasGoogleCreds) && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex items-center gap-3">
                <Zap className="h-4 w-4 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium">Connect more ad platforms</p>
                  <p className="text-[11px] text-muted-foreground">
                    {!data?.hasMetaCreds && !data?.hasGoogleCreds
                      ? "Meta Ads and Google Ads are both available to connect."
                      : !data?.hasMetaCreds
                        ? "Meta Ads is not yet connected."
                        : "Google Ads is not yet connected."}
                  </p>
                </div>
                <Link to="/settings/providers">
                  <Button size="sm" variant="outline" className="text-xs border-white/[0.08] gap-1">
                    Connect <ExternalLink className="h-3 w-3" />
                  </Button>
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </GrowthMindShell>
  );
}
