import { createFileRoute } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import {
  BarChart2, RefreshCw, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle2, XCircle, ExternalLink, MousePointerClick,
  Eye, ShoppingCart, DollarSign, Loader2, Zap,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  lastSyncedAt:   string | null;
}

// ── Server fns ─────────────────────────────────────────────────────────────────

const getAdsPerformanceData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdsPerformanceData> => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // 30-day rolling window — prevents stale snapshots from inflating aggregates
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [
      campaignsRes,
      alertsRes,
      wsRes,
      psRes,
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
    ]);

    const campaigns: any[] = campaignsRes.data ?? [];
    const alerts:    any[] = alertsRes.data    ?? [];
    const ws               = wsRes.data;
    const connectedAds     = new Set((psRes.data ?? []).map((r: any) => r.provider_name as string));

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
    const lastSyncedAt = [metaTotals.lastSyncedAt, googleTotals.lastSyncedAt]
      .filter(Boolean)
      .sort()
      .pop() ?? null;

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
      lastSyncedAt,
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
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
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

// ── Platform summary card ──────────────────────────────────────────────────────

function PlatformCard({
  name, logo, totals, hasCreds,
}: {
  name: string;
  logo: React.ReactNode;
  totals: PlatformTotals;
  hasCreds: boolean;
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

  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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
            {data?.lastSyncedAt && (
              <span className="text-[10px] text-muted-foreground/60">
                Last synced {timeAgo(data.lastSyncedAt)}
              </span>
            )}
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

            {/* Platform cards */}
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">Platform Overview</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <PlatformCard
                  name="Meta Ads"
                  hasCreds={data?.hasMetaCreds ?? false}
                  totals={data?.meta ?? { count: 0, spend: 0, impressions: 0, clicks: 0, conversions: 0, avgRoas: null, ctr: null, lastSyncedAt: null }}
                  logo={<div className="h-5 w-5 rounded bg-blue-600/20 flex items-center justify-center shrink-0">
                    <span className="text-[9px] font-bold text-blue-400">M</span>
                  </div>}
                />
                <PlatformCard
                  name="Google Ads"
                  hasCreds={data?.hasGoogleCreds ?? false}
                  totals={data?.google ?? { count: 0, spend: 0, impressions: 0, clicks: 0, conversions: 0, avgRoas: null, ctr: null, lastSyncedAt: null }}
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
