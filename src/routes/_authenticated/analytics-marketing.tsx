import { createFileRoute } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ProviderCreditsBar } from "@/components/providers/ProviderCreditsBar";
import {
  PageHeader,
  PanelCard,
  StatCard,
  EmptyState,
} from "@/components/dashboard/PageShell";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  TrendingUp,
  Search,
  Mail,
  MessageSquare,
  BarChart2,
  DollarSign,
  Eye,
  MousePointerClick,
  Target,
  Megaphone,
  CheckCircle2,
  Clock,
  PauseCircle,
  XCircle,
  Send,
  CheckCheck,
  BookOpen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/analytics-marketing")({
  head: () => ({ meta: [{ title: "Marketing Analytics — Webee" }] }),
  component: MarketingAnalyticsPage,
});

// ── Types ──────────────────────────────────────────────────────────────────────

interface AdsPlatformTotals {
  campaigns:    number;
  spend:        number;
  impressions:  number;
  clicks:       number;
  conversions:  number;
  roas:         number | null;
  ctr:          number | null;
  lastSyncedAt: string | null;
}

interface AdsData {
  hasSyncedData: boolean;
  byPlatform:    Record<string, AdsPlatformTotals>;
  totalSpend:    number;
  topCampaigns:  Array<{
    name: string; platform: string; spend: number;
    roas: number | null; clicks: number; impressions: number;
  }>;
}

interface SeoSite {
  url:              string;
  keywordCount:     number;
  totalImpressions: number;
  totalClicks:      number;
  avgPosition:      number | null;
  hasGscData:       boolean;
}

interface EmailData {
  total:          number;
  byStatus:       Record<string, number>;
  recentCampaigns: Array<{ id: string; name: string; status: string; createdAt: string }>;
}

interface WaCampaign {
  id:        string;
  name:      string;
  type:      string;
  status:    string;
  stats:     { sent: number; delivered: number; read: number; replied: number };
  createdAt: string;
}

interface WhatsAppData {
  total:          number;
  totalSent:      number;
  totalDelivered: number;
  totalRead:      number;
  totalReplied:   number;
  recentCampaigns: WaCampaign[];
}

interface MarketingAnalyticsData {
  ads:      AdsData;
  seo:      { sites: SeoSite[] };
  email:    EmailData;
  whatsapp: WhatsAppData;
}

// ── Server fn ──────────────────────────────────────────────────────────────────

const getMarketingAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MarketingAnalyticsData> => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;

    const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [adsRes, seoRes, emailRes, waRes] = await Promise.all([
      Promise.resolve(
        sb.from("growthmind_ad_campaigns")
          .select("platform,spend,impressions,clicks,conversions,roas,name,synced_at")
          .eq("workspace_id", workspaceId)
          .gte("synced_at", cutoff30)
          .not("synced_at", "is", null)
          .order("spend", { ascending: false })
          .limit(200),
      ).catch(() => ({ data: [] })),

      Promise.resolve(
        sb.from("growthmind_seo_sites")
          .select("url,keywords")
          .eq("workspace_id", workspaceId),
      ).catch(() => ({ data: [] })),

      Promise.resolve(
        sb.from("hexmail_campaigns")
          .select("id,name,status,created_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(50),
      ).catch(() => ({ data: [] })),

      Promise.resolve(
        sb.from("whatsapp_campaigns")
          .select("id,name,type,status,stats,created_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(50),
      ).catch(() => ({ data: [] })),
    ]);

    // ── Ads ────────────────────────────────────────────────────────────────────
    const adRows: any[] = adsRes.data ?? [];
    const byPlatform: Record<string, AdsPlatformTotals> = {};

    for (const row of adRows) {
      const p = String(row.platform ?? "unknown");
      if (!byPlatform[p]) {
        byPlatform[p] = {
          campaigns: 0, spend: 0, impressions: 0, clicks: 0,
          conversions: 0, roas: null, ctr: null, lastSyncedAt: null,
        };
      }
      const t = byPlatform[p];
      t.campaigns   += 1;
      t.spend       += Number(row.spend       ?? 0);
      t.impressions += Number(row.impressions ?? 0);
      t.clicks      += Number(row.clicks      ?? 0);
      t.conversions += Number(row.conversions ?? 0);
      if (row.synced_at && (!t.lastSyncedAt || row.synced_at > t.lastSyncedAt)) {
        t.lastSyncedAt = row.synced_at;
      }
    }

    for (const p of Object.keys(byPlatform)) {
      const t = byPlatform[p];
      const totalRevenue = adRows
        .filter((r: any) => r.platform === p && r.roas && r.spend)
        .reduce((a: number, r: any) => a + Number(r.roas ?? 0) * Number(r.spend ?? 0), 0);
      t.roas = t.spend > 0 && totalRevenue > 0 ? +(totalRevenue / t.spend).toFixed(2) : null;
      t.ctr  = t.impressions > 0 ? +((t.clicks / t.impressions) * 100).toFixed(2) : null;
    }

    const topCampaigns = adRows.slice(0, 10).map((r: any) => ({
      name:        String(r.name ?? "—"),
      platform:    String(r.platform ?? ""),
      spend:       Number(r.spend       ?? 0),
      roas:        r.roas != null ? Number(r.roas) : null,
      clicks:      Number(r.clicks      ?? 0),
      impressions: Number(r.impressions ?? 0),
    }));

    const totalSpend = Object.values(byPlatform).reduce((a, t) => a + t.spend, 0);

    // ── SEO ────────────────────────────────────────────────────────────────────
    const seoRows: any[] = seoRes.data ?? [];
    const seoSites: SeoSite[] = seoRows.map((row: any) => {
      const keywords: any[] = Array.isArray(row.keywords) ? row.keywords : [];
      const withGsc = keywords.filter((k: any) => k.gsc_impressions != null || k.gsc_clicks != null);
      const totalImpressions = withGsc.reduce((a: number, k: any) => a + Number(k.gsc_impressions ?? 0), 0);
      const totalClicks      = withGsc.reduce((a: number, k: any) => a + Number(k.gsc_clicks      ?? 0), 0);
      const positions        = withGsc.map((k: any) => Number(k.gsc_position ?? 0)).filter(Boolean);
      const avgPosition      = positions.length > 0
        ? +(positions.reduce((a: number, p: number) => a + p, 0) / positions.length).toFixed(1)
        : null;
      return {
        url:              String(row.url ?? ""),
        keywordCount:     keywords.length,
        totalImpressions,
        totalClicks,
        avgPosition,
        hasGscData:       withGsc.length > 0,
      };
    });

    // ── Email ──────────────────────────────────────────────────────────────────
    const emailRows: any[] = emailRes.data ?? [];
    const emailByStatus: Record<string, number> = {};
    for (const r of emailRows) {
      const s = String(r.status ?? "unknown");
      emailByStatus[s] = (emailByStatus[s] ?? 0) + 1;
    }
    const recentEmails = emailRows.slice(0, 8).map((r: any) => ({
      id:        String(r.id),
      name:      String(r.name ?? "—"),
      status:    String(r.status ?? "draft"),
      createdAt: String(r.created_at ?? ""),
    }));

    // ── WhatsApp ───────────────────────────────────────────────────────────────
    const waRows: any[] = waRes.data ?? [];
    let waSent = 0, waDelivered = 0, waRead = 0, waReplied = 0;
    const recentWa: WaCampaign[] = waRows.slice(0, 8).map((r: any) => {
      const stats = typeof r.stats === "object" && r.stats !== null ? r.stats : {};
      waSent      += Number(stats.sent      ?? 0);
      waDelivered += Number(stats.delivered ?? 0);
      waRead      += Number(stats.read      ?? 0);
      waReplied   += Number(stats.replied   ?? 0);
      return {
        id:        String(r.id),
        name:      String(r.name ?? "—"),
        type:      String(r.type ?? "broadcast"),
        status:    String(r.status ?? "draft"),
        stats: {
          sent:      Number(stats.sent      ?? 0),
          delivered: Number(stats.delivered ?? 0),
          read:      Number(stats.read      ?? 0),
          replied:   Number(stats.replied   ?? 0),
        },
        createdAt: String(r.created_at ?? ""),
      };
    });

    return {
      ads: { hasSyncedData: adRows.length > 0, byPlatform, totalSpend, topCampaigns },
      seo: { sites: seoSites },
      email:    { total: emailRows.length, byStatus: emailByStatus, recentCampaigns: recentEmails },
      whatsapp: { total: waRows.length, totalSent: waSent, totalDelivered: waDelivered, totalRead: waRead, totalReplied: waReplied, recentCampaigns: recentWa },
    };
  });

// ── Helpers ────────────────────────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, string> = {
  meta:    "#1877f2",
  google:  "#ea4335",
  tiktok:  "#fe2c55",
};

const PLATFORM_LABELS: Record<string, string> = {
  meta:   "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
};

const STATUS_COLORS: Record<string, string> = {
  active:   "#22c55e",
  draft:    "#94a3b8",
  paused:   "#f59e0b",
  archived: "#64748b",
};

function fmtCurrency(n: number) {
  return `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}
function fmtNum(n: number) {
  return n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `${(n / 1_000).toFixed(1)}K`
    : String(n);
}
function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const TABS = [
  { key: "ads",      label: "Paid Ads",  icon: BarChart2    },
  { key: "seo",      label: "SEO",       icon: Search       },
  { key: "email",    label: "Email",     icon: Mail         },
  { key: "whatsapp", label: "WhatsApp",  icon: MessageSquare },
] as const;
type TabKey = typeof TABS[number]["key"];

// ── Main component ─────────────────────────────────────────────────────────────

function MarketingAnalyticsPage() {
  const [tab, setTab] = useState<TabKey>("ads");

  const fn = useServerFn(getMarketingAnalytics);
  const { data, isLoading } = useQuery({
    queryKey: ["marketing-analytics"],
    queryFn:  () => fn(),
    staleTime: 60_000,
  });

  return (
    <div className="min-h-screen p-6 space-y-6">
      {/* ── Header ── */}
      <PageHeader
        icon={Megaphone}
        title="Marketing Analytics"
        subtitle="Paid ads, SEO, email campaigns and WhatsApp performance"
        actions={
          <Link
            to="/analytics"
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            ← Voice Analytics
          </Link>
        }
      />

      <ProviderCreditsBar />

      {/* ── Tab bar ── */}
      <div className="flex gap-1 border-b border-white/[0.06]">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
          Loading…
        </div>
      )}

      {!isLoading && data && (
        <>
          {tab === "ads"      && <AdsTab      data={data.ads} />}
          {tab === "seo"      && <SeoTab      data={data.seo} />}
          {tab === "email"    && <EmailTab    data={data.email} />}
          {tab === "whatsapp" && <WhatsAppTab data={data.whatsapp} />}
        </>
      )}
    </div>
  );
}

// ── Paid Ads Tab ───────────────────────────────────────────────────────────────

function AdsTab({ data }: { data: AdsData }) {
  const platforms = Object.keys(data.byPlatform);

  if (!data.hasSyncedData) {
    return (
      <EmptyState
        icon={BarChart2}
        title="No ad data synced yet"
        message="Connect Meta Ads, Google Ads, or TikTok Ads in GrowthMind → Data Sources to start pulling campaign performance."
      />
    );
  }

  const barData = platforms.map((p) => ({
    name:  PLATFORM_LABELS[p] ?? p,
    spend: +data.byPlatform[p].spend.toFixed(2),
    clicks: data.byPlatform[p].clicks,
    conversions: data.byPlatform[p].conversions,
    fill:  PLATFORM_COLORS[p] ?? "#7c3aed",
  }));

  return (
    <div className="space-y-6">
      {/* ── Platform stat cards ── */}
      <div className={cn("grid gap-4", platforms.length >= 3 ? "grid-cols-3" : "grid-cols-2")}>
        {platforms.map((p) => {
          const t = data.byPlatform[p];
          return (
            <PanelCard key={p} className="space-y-3">
              <div className="flex items-center justify-between">
                <span
                  className="text-sm font-semibold"
                  style={{ color: PLATFORM_COLORS[p] ?? "inherit" }}
                >
                  {PLATFORM_LABELS[p] ?? p}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t.campaigns} campaign{t.campaigns !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Spend"       value={fmtCurrency(t.spend)} />
                <Metric label="ROAS"        value={t.roas != null ? `${t.roas}×` : "—"} />
                <Metric label="Impressions" value={fmtNum(t.impressions)} />
                <Metric label="Clicks"      value={fmtNum(t.clicks)} />
                <Metric label="CTR"         value={t.ctr != null ? `${t.ctr}%` : "—"} />
                <Metric label="Conversions" value={fmtNum(t.conversions)} />
              </div>
              {t.lastSyncedAt && (
                <p className="text-[10px] text-muted-foreground">
                  Synced {fmtDate(t.lastSyncedAt)}
                </p>
              )}
            </PanelCard>
          );
        })}
      </div>

      {/* ── Spend by platform bar chart ── */}
      <Panel title="Spend by platform (30 days)">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => `£${v}`} />
            <Tooltip
              contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
              formatter={(v: number) => fmtCurrency(v)}
            />
            <Bar dataKey="spend" radius={[4, 4, 0, 0]}>
              {barData.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      {/* ── Top campaigns table ── */}
      {data.topCampaigns.length > 0 && (
        <Panel title="Top campaigns by spend">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <Th>Campaign</Th>
                  <Th>Platform</Th>
                  <Th align="right">Spend</Th>
                  <Th align="right">Impressions</Th>
                  <Th align="right">Clicks</Th>
                  <Th align="right">ROAS</Th>
                </tr>
              </thead>
              <tbody>
                {data.topCampaigns.map((c, i) => (
                  <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="py-2 pr-4 max-w-[200px] truncate font-medium">{c.name}</td>
                    <td className="py-2 pr-4">
                      <Badge
                        variant="outline"
                        className="text-[10px]"
                        style={{ borderColor: PLATFORM_COLORS[c.platform] ?? "#7c3aed", color: PLATFORM_COLORS[c.platform] ?? "inherit" }}
                      >
                        {PLATFORM_LABELS[c.platform] ?? c.platform}
                      </Badge>
                    </td>
                    <Td align="right">{fmtCurrency(c.spend)}</Td>
                    <Td align="right">{fmtNum(c.impressions)}</Td>
                    <Td align="right">{fmtNum(c.clicks)}</Td>
                    <Td align="right">{c.roas != null ? `${c.roas}×` : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ── SEO Tab ────────────────────────────────────────────────────────────────────

function SeoTab({ data }: { data: { sites: SeoSite[] } }) {
  if (data.sites.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No SEO sites tracked"
        message="Add a site in GrowthMind → SEO and connect Google Search Console to pull keyword performance data."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary stats ── */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Sites tracked"
          value={data.sites.length}
          tone="primary"
        />
        <StatCard
          label="Total keywords"
          value={data.sites.reduce((a, s) => a + s.keywordCount, 0)}
          tone="info"
        />
        <StatCard
          label="Total impressions"
          value={fmtNum(data.sites.reduce((a, s) => a + s.totalImpressions, 0))}
          tone="info"
        />
        <StatCard
          label="Total GSC clicks"
          value={fmtNum(data.sites.reduce((a, s) => a + s.totalClicks, 0))}
          tone="primary"
        />
      </div>

      {/* ── Site-by-site breakdown ── */}
      {data.sites.map((site) => (
        <Panel key={site.url} title={site.url}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <Metric label="Keywords tracked" value={site.keywordCount} />
            <Metric label="GSC impressions"  value={fmtNum(site.totalImpressions)} />
            <Metric label="GSC clicks"       value={fmtNum(site.totalClicks)} />
            <Metric
              label="Avg position"
              value={site.avgPosition != null ? `#${site.avgPosition}` : "—"}
            />
          </div>
          {!site.hasGscData && (
            <p className="text-xs text-amber-400/80">
              Connect Google Search Console in GrowthMind → SEO to pull live position data.
            </p>
          )}
          {site.hasGscData && site.avgPosition != null && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Average position</span>
                <span>#{site.avgPosition}</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{ width: `${Math.max(5, Math.min(100, 100 - (site.avgPosition / 100) * 100))}%` }}
                />
              </div>
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

// ── Email Tab ──────────────────────────────────────────────────────────────────

const EMAIL_STATUS_ICONS: Record<string, React.ElementType> = {
  active:   CheckCircle2,
  draft:    Clock,
  paused:   PauseCircle,
  archived: XCircle,
};

function EmailTab({ data }: { data: EmailData }) {
  if (data.total === 0) {
    return (
      <EmptyState
        icon={Mail}
        title="No email campaigns yet"
        message="Create your first campaign in HexMail to start tracking email success metrics."
      />
    );
  }

  const pieData = Object.entries(data.byStatus).map(([status, count]) => ({
    name:  status.charAt(0).toUpperCase() + status.slice(1),
    value: count,
    fill:  STATUS_COLORS[status] ?? "#7c3aed",
  }));

  return (
    <div className="space-y-6">
      {/* ── Stat cards ── */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total campaigns" value={data.total}                           tone="primary" />
        <StatCard label="Active"           value={data.byStatus.active   ?? 0}         tone="info"    />
        <StatCard label="Draft"            value={data.byStatus.draft    ?? 0}         tone="primary" />
        <StatCard label="Paused/archived"  value={(data.byStatus.paused ?? 0) + (data.byStatus.archived ?? 0)} tone="primary" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* ── Status pie chart ── */}
        <Panel title="Status breakdown">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
              >
                {pieData.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>

        {/* ── Recent campaigns ── */}
        <Panel title="Recent campaigns">
          <div className="space-y-2">
            {data.recentCampaigns.map((c) => {
              const Icon = EMAIL_STATUS_ICONS[c.status] ?? Mail;
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ color: STATUS_COLORS[c.status] ?? "#94a3b8" }}
                    />
                    <span className="text-sm truncate">{c.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-foreground">{fmtDate(c.createdAt)}</span>
                    <Badge
                      variant="outline"
                      className="text-[10px]"
                      style={{ borderColor: STATUS_COLORS[c.status] ?? "#94a3b8", color: STATUS_COLORS[c.status] ?? "#94a3b8" }}
                    >
                      {c.status}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ── WhatsApp Tab ───────────────────────────────────────────────────────────────

function WhatsAppTab({ data }: { data: WhatsAppData }) {
  if (data.total === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No WhatsApp campaigns yet"
        message="Create a broadcast or follow-up campaign in Buzzchat to track delivery and read rates here."
      />
    );
  }

  const deliveryRate  = data.totalSent > 0 ? Math.round((data.totalDelivered / data.totalSent) * 100) : 0;
  const readRate      = data.totalSent > 0 ? Math.round((data.totalRead      / data.totalSent) * 100) : 0;
  const replyRate     = data.totalSent > 0 ? Math.round((data.totalReplied   / data.totalSent) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Campaigns"     value={data.total}             tone="primary" />
        <StatCard label="Messages sent" value={fmtNum(data.totalSent)} tone="info"    />
        <StatCard label="Delivered"     value={`${deliveryRate}%`}     tone="info"    />
        <StatCard label="Read rate"     value={`${readRate}%`}         tone="primary" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* ── Funnel chart ── */}
        <Panel title="Campaign funnel (all time)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              layout="vertical"
              data={[
                { stage: "Sent",      count: data.totalSent,      fill: "#7c3aed" },
                { stage: "Delivered", count: data.totalDelivered, fill: "#22c55e" },
                { stage: "Read",      count: data.totalRead,      fill: "#3b82f6" },
                { stage: "Replied",   count: data.totalReplied,   fill: "#f59e0b" },
              ]}
              margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={fmtNum} />
              <YAxis type="category" dataKey="stage" tick={{ fontSize: 11, fill: "#94a3b8" }} width={68} />
              <Tooltip
                contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                formatter={(v: number) => fmtNum(v)}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {[0, 1, 2, 3].map((i) => (
                  <Cell key={i} fill={["#7c3aed", "#22c55e", "#3b82f6", "#f59e0b"][i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* ── Recent campaigns table ── */}
        <Panel title="Recent campaigns">
          <div className="space-y-2">
            {data.recentCampaigns.map((c) => (
              <div
                key={c.id}
                className="border-b border-white/[0.04] last:border-0 pb-2 last:pb-0"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium truncate max-w-[160px]">{c.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px]">{c.type}</Badge>
                    <Badge
                      variant="outline"
                      className="text-[10px]"
                      style={{ borderColor: STATUS_COLORS[c.status] ?? "#94a3b8", color: STATUS_COLORS[c.status] ?? "#94a3b8" }}
                    >
                      {c.status}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-4 text-[11px] text-muted-foreground">
                  <span>{c.stats.sent} sent</span>
                  <span>{c.stats.delivered} delivered</span>
                  <span>{c.stats.read} read</span>
                  {c.stats.replied > 0 && <span>{c.stats.replied} replied</span>}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* ── Rate summary ── */}
      <Panel title="Engagement rates">
        <div className="space-y-3">
          {[
            { label: "Delivery rate", pct: deliveryRate, color: "#22c55e" },
            { label: "Read rate",     pct: readRate,     color: "#3b82f6" },
            { label: "Reply rate",    pct: replyRate,    color: "#f59e0b" },
          ].map(({ label, pct, color }) => (
            <div key={label}>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{label}</span>
                <span style={{ color }}>{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: color }}
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ── Small shared primitives ────────────────────────────────────────────────────

function Panel({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <PanelCard className={className}>
      {title && (
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
      )}
      {children}
    </PanelCard>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={cn("py-2 pr-4 text-xs font-medium text-muted-foreground uppercase tracking-wide", align === "right" && "text-right")}>
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td className={cn("py-2 pr-4 text-sm text-muted-foreground", align === "right" && "text-right")}>
      {children}
    </td>
  );
}
