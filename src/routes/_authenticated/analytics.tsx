import { createFileRoute } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getDashboardLiveAgents } from "@/lib/agents/agents.functions";
import {
  AreaChart, Area,
  PieChart, Pie, Cell,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  BarChart3, PhoneCall, Phone, Clock, Activity, XCircle,
  AlertTriangle, ChevronDown, CheckCircle2, TrendingUp, Zap,
  ArrowDownLeft, ArrowUpRight, Megaphone,
  Search, Mail, MessageSquare, BarChart2, DollarSign,
  Eye, MousePointerClick, Target, PauseCircle, BookOpen, Send, CheckCheck,
  CreditCard, Wallet,
} from "lucide-react";
import {
  PageHeader, PanelCard, StatCard, EmptyState, TableHead,
  Th as PageTh,
} from "@/components/dashboard/PageShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getRetellAnalytics } from "@/lib/dashboard/analytics.functions";
import { getWbahCredits } from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import { ProviderCreditsBar } from "@/components/providers/ProviderCreditsBar";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Webee" }] }),
  component: AnalyticsPage,
});

// ── Call analytics constants ───────────────────────────────────────────────────
const RANGES = [
  { label: "Today", key: "today", days: 1  },
  { label: "7d",    key: "7d",    days: 7  },
  { label: "30d",   key: "30d",   days: 30 },
  { label: "60d",   key: "60d",   days: 60 },
  { label: "90d",   key: "90d",   days: 90 },
];

const CHART = {
  primary:     "#8B5CF6",
  primaryGlow: "#A78BFA",
  accent:      "#22D3EE",
  success:     "#22C55E",
  warning:     "#F59E0B",
  danger:      "#EF4444",
  neutral:     "#64748B",
  pink:        "#EC4899",
  orange:      "#F97316",
  grid:        "rgba(255,255,255,0.06)",
  axis:        "rgba(255,255,255,0.40)",
};

const SENTIMENT_COLORS  = [CHART.success, CHART.warning, CHART.danger, CHART.neutral];
const SUCCESS_COLORS    = [CHART.success, CHART.danger, CHART.neutral];
const DIRECTION_COLORS  = [CHART.primary, CHART.accent, CHART.pink];
const DISCONNECT_COLORS = [CHART.danger, CHART.warning, CHART.primary, CHART.accent, CHART.neutral, CHART.orange];

// ── Marketing types ────────────────────────────────────────────────────────────
interface AdsPlatformTotals {
  campaigns: number; spend: number; impressions: number; clicks: number;
  conversions: number; roas: number | null; ctr: number | null; lastSyncedAt: string | null;
}
interface AdsData {
  hasSyncedData: boolean;
  byPlatform:   Record<string, AdsPlatformTotals>;
  totalSpend:   number;
  topCampaigns: Array<{ name: string; platform: string; spend: number; roas: number | null; clicks: number; impressions: number }>;
}
interface SeoSite {
  url: string; keywordCount: number; totalImpressions: number;
  totalClicks: number; avgPosition: number | null; hasGscData: boolean;
}
interface EmailData {
  total: number; byStatus: Record<string, number>;
  recentCampaigns: Array<{ id: string; name: string; status: string; createdAt: string }>;
}
interface WaCampaign {
  id: string; name: string; type: string; status: string;
  stats: { sent: number; delivered: number; read: number; replied: number };
  createdAt: string;
}
interface WhatsAppData {
  total: number; totalSent: number; totalDelivered: number; totalRead: number; totalReplied: number;
  recentCampaigns: WaCampaign[];
}
interface MarketingAnalyticsData {
  ads: AdsData; seo: { sites: SeoSite[] }; email: EmailData; whatsapp: WhatsAppData;
}

// ── Marketing server fn ────────────────────────────────────────────────────────
const getMarketingAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MarketingAnalyticsData> => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    const cutoff30    = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

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

    const adRows: any[] = adsRes.data ?? [];
    const byPlatform: Record<string, AdsPlatformTotals> = {};
    for (const row of adRows) {
      const p = String(row.platform ?? "unknown");
      if (!byPlatform[p]) byPlatform[p] = { campaigns: 0, spend: 0, impressions: 0, clicks: 0, conversions: 0, roas: null, ctr: null, lastSyncedAt: null };
      const t = byPlatform[p];
      t.campaigns++; t.spend += Number(row.spend ?? 0); t.impressions += Number(row.impressions ?? 0);
      t.clicks += Number(row.clicks ?? 0); t.conversions += Number(row.conversions ?? 0);
      if (row.synced_at && (!t.lastSyncedAt || row.synced_at > t.lastSyncedAt)) t.lastSyncedAt = row.synced_at;
    }
    for (const p of Object.keys(byPlatform)) {
      const t = byPlatform[p];
      const rev = adRows.filter((r: any) => r.platform === p && r.roas && r.spend).reduce((a: number, r: any) => a + Number(r.roas ?? 0) * Number(r.spend ?? 0), 0);
      t.roas = t.spend > 0 && rev > 0 ? +(rev / t.spend).toFixed(2) : null;
      t.ctr  = t.impressions > 0 ? +((t.clicks / t.impressions) * 100).toFixed(2) : null;
    }
    const topCampaigns = adRows.slice(0, 10).map((r: any) => ({
      name: String(r.name ?? "—"), platform: String(r.platform ?? ""),
      spend: Number(r.spend ?? 0), roas: r.roas != null ? Number(r.roas) : null,
      clicks: Number(r.clicks ?? 0), impressions: Number(r.impressions ?? 0),
    }));
    const totalSpend = Object.values(byPlatform).reduce((a, t) => a + t.spend, 0);

    const seoRows: any[] = seoRes.data ?? [];
    const seoSites: SeoSite[] = seoRows.map((row: any) => {
      const keywords: any[] = Array.isArray(row.keywords) ? row.keywords : [];
      const withGsc = keywords.filter((k: any) => k.gsc_impressions != null || k.gsc_clicks != null);
      const totalImpressions = withGsc.reduce((a: number, k: any) => a + Number(k.gsc_impressions ?? 0), 0);
      const totalClicks      = withGsc.reduce((a: number, k: any) => a + Number(k.gsc_clicks ?? 0), 0);
      const positions        = withGsc.map((k: any) => Number(k.gsc_position ?? 0)).filter(Boolean);
      const avgPosition      = positions.length > 0 ? +(positions.reduce((a: number, p: number) => a + p, 0) / positions.length).toFixed(1) : null;
      return { url: String(row.url ?? ""), keywordCount: keywords.length, totalImpressions, totalClicks, avgPosition, hasGscData: withGsc.length > 0 };
    });

    const emailRows: any[] = emailRes.data ?? [];
    const emailByStatus: Record<string, number> = {};
    for (const r of emailRows) { const s = String(r.status ?? "unknown"); emailByStatus[s] = (emailByStatus[s] ?? 0) + 1; }
    const recentEmails = emailRows.slice(0, 8).map((r: any) => ({ id: String(r.id), name: String(r.name ?? "—"), status: String(r.status ?? "draft"), createdAt: String(r.created_at ?? "") }));

    const waRows: any[] = waRes.data ?? [];
    let waSent = 0, waDelivered = 0, waRead = 0, waReplied = 0;
    const recentWa: WaCampaign[] = waRows.slice(0, 8).map((r: any) => {
      const stats = typeof r.stats === "object" && r.stats !== null ? r.stats : {};
      waSent += Number(stats.sent ?? 0); waDelivered += Number(stats.delivered ?? 0);
      waRead += Number(stats.read ?? 0); waReplied += Number(stats.replied ?? 0);
      return { id: String(r.id), name: String(r.name ?? "—"), type: String(r.type ?? "broadcast"), status: String(r.status ?? "draft"), stats: { sent: Number(stats.sent ?? 0), delivered: Number(stats.delivered ?? 0), read: Number(stats.read ?? 0), replied: Number(stats.replied ?? 0) }, createdAt: String(r.created_at ?? "") };
    });

    return {
      ads:      { hasSyncedData: adRows.length > 0, byPlatform, totalSpend, topCampaigns },
      seo:      { sites: seoSites },
      email:    { total: emailRows.length, byStatus: emailByStatus, recentCampaigns: recentEmails },
      whatsapp: { total: waRows.length, totalSent: waSent, totalDelivered: waDelivered, totalRead: waRead, totalReplied: waReplied, recentCampaigns: recentWa },
    };
  });

// ── Marketing helpers ──────────────────────────────────────────────────────────
const PLATFORM_COLORS: Record<string, string> = { meta: "#1877f2", google: "#ea4335", tiktok: "#fe2c55" };
const PLATFORM_LABELS: Record<string, string> = { meta: "Meta Ads", google: "Google Ads", tiktok: "TikTok Ads" };
const STATUS_COLORS:   Record<string, string> = { active: "#22c55e", draft: "#94a3b8", paused: "#f59e0b", archived: "#64748b" };

function fmtCurrency(n: number) { return `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`; }
function fmtNum(n: number) { return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n); }
function fmtDateShort(iso: string) { if (!iso) return "—"; return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }

const MKTG_TABS = [
  { key: "ads",      label: "Paid Ads",  icon: BarChart2     },
  { key: "seo",      label: "SEO",       icon: Search        },
  { key: "email",    label: "Email",     icon: Mail          },
  { key: "whatsapp", label: "WhatsApp",  icon: MessageSquare },
] as const;
type MktgTabKey = typeof MKTG_TABS[number]["key"];

// ── Call analytics helpers ─────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {label && <div className="mb-1 font-medium text-foreground">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium tabular-nums">{p.value?.toLocaleString?.() ?? p.value}</span>
        </div>
      ))}
    </div>
  );
}

function fmtDuration(seconds: number) {
  if (!seconds || !isFinite(seconds)) return "0s";
  const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`; if (m > 0) return `${m}m ${s}s`; return `${s}s`;
}
function fmtMs(ms?: number | null) {
  if (ms === null || ms === undefined || !isFinite(ms) || ms === 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`; return `${(ms / 1000).toFixed(2)}s`;
}
function humanize(key: string) { return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
function shortDay(isoDate: string) { return isoDate.slice(5); }

// Voicemail keyword list — must match the DB migration and webhook processor.
const VOICEMAIL_KW = ["voicemail", "answering machine", "leave a message", "mailbox", "beep", "not available", "automated message"];
function hasVoicemailKeyword(text?: string | null): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return VOICEMAIL_KW.some((kw) => lower.includes(kw));
}
function isCallVoicemail(c: any): boolean {
  return (
    c.call_analysis?.in_voicemail === true ||
    c.call_status === "voicemail" ||
    hasVoicemailKeyword(c.disconnection_reason) ||
    hasVoicemailKeyword(c.call_analysis?.call_summary) ||
    hasVoicemailKeyword(c.call_analysis?.call_outcome) ||
    hasVoicemailKeyword(c.transcript)
  );
}

function computeAnalytics(allCalls: any[]) {
  // Exclude voicemails from Retell API calls using the full heuristic set
  // (ElevenLabs DB calls are already filtered at the server with is_voicemail=false).
  const voicemailCount_excluded = allCalls.filter(isCallVoicemail).length;
  if (voicemailCount_excluded > 0) {
    console.debug(`[voicemail] excluded ${voicemailCount_excluded} voicemail calls from analytics window`);
  }
  const calls = allCalls.filter((c) => !isCallVoicemail(c));
  const total    = calls.length;
  const inbound  = calls.filter((c) => c.direction === "inbound"  || c.call_direction === "inbound").length;
  const outbound = calls.filter((c) => c.direction === "outbound" || c.call_direction === "outbound").length;
  const webCalls = calls.filter((c) => c.call_type === "web_call" || c.call_type === "webcall").length;
  const byStatus:     Record<string, number> = {};
  const byDisconnect: Record<string, number> = {};
  const bySentiment:  Record<string, number> = { Positive: 0, Neutral: 0, Negative: 0, Unknown: 0 };
  const byAgent:      Record<string, { count: number; durationSec: number }> = {};
  const byDay:         Record<string, number> = {};
  const byDayDuration: Record<string, { total: number; count: number }> = {};
  const byDayOutcome:  Record<string, { success: number; unsuccessful: number; voicemail: number }> = {};
  const byDayLatency:  Record<string, { llm: number[]; e2e: number[]; tts: number[] }> = {};
  const byHour:        Record<number, number> = {};
  let totalDurationSec = 0, successCount = 0, unsuccessCount = 0, voicemailCount = 0, transferCount = 0;
  const llmLatencies: number[] = [], e2eLatencies: number[] = [], ttsLatencies: number[] = [];

  for (const c of calls) {
    byStatus[c.call_status ?? "unknown"] = (byStatus[c.call_status ?? "unknown"] ?? 0) + 1;
    const dr = c.disconnection_reason ?? c.disconnect_reason;
    if (dr) byDisconnect[dr] = (byDisconnect[dr] ?? 0) + 1;
    const sentiment = c.call_analysis?.user_sentiment ?? "Unknown";
    bySentiment[sentiment] = (bySentiment[sentiment] ?? 0) + 1;
    const durSec = c.call_cost?.total_duration_seconds ?? (c.duration_ms != null ? c.duration_ms / 1000 : c.end_timestamp && c.start_timestamp ? Math.max(0, (c.end_timestamp - c.start_timestamp) / 1000) : 0);
    totalDurationSec += durSec;
    if (c.call_analysis?.call_successful === true)  successCount++;
    else if (c.call_analysis?.call_successful === false) unsuccessCount++;
    if (c.call_analysis?.in_voicemail) voicemailCount++;
    if (c.disconnection_reason === "transfer_to_human" || c.transfer_destination) transferCount++;
    const aid = c.agent_id ?? "unknown"; const agg = byAgent[aid] ?? { count: 0, durationSec: 0 }; agg.count++; agg.durationSec += durSec; byAgent[aid] = agg;
    const llm = c.latency?.llm?.p50 ?? null; const e2e = c.latency?.e2e?.p50 ?? null; const tts = c.latency?.tts?.p50 ?? null;
    if (llm != null) llmLatencies.push(llm); if (e2e != null) e2eLatencies.push(e2e); if (tts != null) ttsLatencies.push(tts);
    if (c.start_timestamp) {
      const d = new Date(c.start_timestamp); const key = d.toISOString().slice(0, 10); const hr = d.getUTCHours();
      byDay[key] = (byDay[key] ?? 0) + 1; byHour[hr] = (byHour[hr] ?? 0) + 1;
      const dd = byDayDuration[key] ?? { total: 0, count: 0 }; dd.total += durSec; dd.count++; byDayDuration[key] = dd;
      const do_ = byDayOutcome[key] ?? { success: 0, unsuccessful: 0, voicemail: 0 };
      if (c.call_analysis?.call_successful === true) do_.success++; else if (c.call_analysis?.call_successful === false) do_.unsuccessful++;
      if (c.call_analysis?.in_voicemail) do_.voicemail++; byDayOutcome[key] = do_;
      const dl = byDayLatency[key] ?? { llm: [], e2e: [], tts: [] };
      if (llm != null) dl.llm.push(llm); if (e2e != null) dl.e2e.push(e2e); if (tts != null) dl.tts.push(tts); byDayLatency[key] = dl;
    }
  }
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  return { total, inbound, outbound, webCalls, byStatus, byDisconnect, bySentiment, byAgent, byDay, byDayDuration, byDayOutcome, byDayLatency, byHour, totalDurationSec, totalMinutes: Math.round(totalDurationSec / 60), avgDuration: total ? totalDurationSec / total : 0, successCount, unsuccessCount, voicemailCount, voicemailScreenedCount: voicemailCount_excluded, transferCount, successRate: total ? (successCount / total) * 100 : 0, avgLlmLatency: avg(llmLatencies), avgE2eLatency: avg(e2eLatencies), avgTtsLatency: avg(ttsLatencies) };
}

// ── Page ──────────────────────────────────────────────────────────────────────
const MAIN_TABS = [
  { key: "calls",     label: "Call Analytics", icon: PhoneCall },
  { key: "marketing", label: "Marketing",       icon: Megaphone },
  { key: "credits",   label: "Credits",         icon: CreditCard },
] as const;
type MainTabKey = typeof MAIN_TABS[number]["key"];

function AnalyticsPage() {
  const [mainTab, setMainTab] = useState<MainTabKey>("calls");

  // ── Call analytics state ──
  const fn              = useServerFn(getRetellAnalytics);
  const getLiveAgentsFn = useServerFn(getDashboardLiveAgents);
  const [rangeKey, setRangeKey] = useState("30d");
  const activeRange = RANGES.find((r) => r.key === rangeKey) ?? RANGES[2];
  const days = activeRange.days;
  const todayOnly = rangeKey === "today";
  // Start of today in UTC — charts and the call breakdown are UTC-based, so
  // "Today" means calls since 00:00 UTC. The server fetches a 1-day window
  // (days=1) and we narrow it to today client-side for an exact boundary.
  const startOfTodayMs = useMemo(() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }, [rangeKey]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);

  const q = useQuery({ queryKey: ["retell-analytics", days], queryFn: () => fn({ data: { days } }), staleTime: 15 * 60_000, refetchOnWindowFocus: false, throwOnError: false, placeholderData: keepPreviousData });
  const liveAgentsQ = useQuery({ queryKey: ["dashboard-live-agents"], queryFn: () => getLiveAgentsFn({ data: undefined }), staleTime: 60_000 ,
    throwOnError: false,
  });

  const result   = q.data;
  const allCalls = (result?.calls ?? []) as any[];
  const agentNames: Record<string, string> = (result?.agentNames ?? {}) as Record<string, string>;
  const isWbah = (result as any)?.workspaceSlug === "webuyanyhouse";
  // Build agent list from the Retell API response (agentNames) so the
  // dropdown appears for any workspace that has calls, not just those
  // whose agents happen to be in the local deployments DB.
  // Supplement with live-agent names from the DB for display.
  const agentList = useMemo(() => {
    const liveMap: Record<string, string> = {};
    for (const a of liveAgentsQ.data ?? []) {
      if (a.deployedRetellAgentId) liveMap[a.deployedRetellAgentId] = a.name;
    }
    return Object.entries(agentNames).map(([id, name]) => ({
      id,
      name: liveMap[id] ?? name,
    }));
  }, [agentNames, liveAgentsQ.data]);
  const calls    = useMemo(() => {
    let cs = selectedAgentId ? allCalls.filter((c) => c.agent_id === selectedAgentId) : allCalls;
    if (todayOnly) cs = cs.filter((c) => c.start_timestamp != null && c.start_timestamp >= startOfTodayMs);
    return cs;
  }, [allCalls, selectedAgentId, todayOnly, startOfTodayMs]);
  const analytics = useMemo(() => computeAnalytics(calls), [calls]);
  const sortedDays = useMemo(() => Object.keys(analytics.byDay).sort(), [analytics.byDay]);
  // Trend charts span the full selected window (7/30/60/90d) — the server already
  // scopes calls to `days`, so cap to `days` so each range renders distinctly
  // instead of being frozen at the last 30 days.
  const trendDays = useMemo(() => sortedDays.slice(-days), [sortedDays, days]);
  const callsPerDayData   = useMemo(() => trendDays.map((d) => ({ day: shortDay(d), calls: analytics.byDay[d] ?? 0 })), [trendDays, analytics.byDay]);
  const durationTrendData = useMemo(() => trendDays.map((d) => { const dd = analytics.byDayDuration[d]; return { day: shortDay(d), avg: dd && dd.count ? Math.round(dd.total / dd.count) : 0 }; }), [trendDays, analytics.byDayDuration]);
  const outcomeTrendData  = useMemo(() => trendDays.map((d) => { const o = analytics.byDayOutcome[d] ?? { success: 0, unsuccessful: 0, voicemail: 0 }; return { day: shortDay(d), ...o }; }), [trendDays, analytics.byDayOutcome]);
  const latencyTrendData  = useMemo(() => trendDays.map((d) => { const dl = analytics.byDayLatency[d] ?? { llm: [], e2e: [], tts: [] }; const a = (arr: number[]) => (arr.length ? Math.round(arr.reduce((x, y) => x + y, 0) / arr.length) : null); return { day: shortDay(d), LLM: a(dl.llm), E2E: a(dl.e2e), TTS: a(dl.tts) }; }), [trendDays, analytics.byDayLatency]);
  const hourData = useMemo(() => Array.from({ length: 24 }, (_, h) => ({ hour: `${h}h`, calls: analytics.byHour[h] ?? 0 })), [analytics.byHour]);
  const successRate    = analytics.total ? Math.round((analytics.successCount / analytics.total) * 100) : 0;
  const transferRate   = analytics.total ? ((analytics.transferCount / analytics.total) * 100).toFixed(1) : "0";
  const unknownSuccess = Math.max(0, analytics.total - analytics.successCount - analytics.unsuccessCount);
  const selectedAgentName = selectedAgentId ? (agentNames[selectedAgentId] ?? agentList.find((a) => a.id === selectedAgentId)?.name ?? selectedAgentId) : "All agents";

  // ── Marketing state ──
  const mktFn = useServerFn(getMarketingAnalytics);
  const [mktTab, setMktTab] = useState<MktgTabKey>("ads");
  const mktQ = useQuery({ queryKey: ["marketing-analytics"], queryFn: () => mktFn(), staleTime: 60_000, enabled: mainTab === "marketing" ,
    throwOnError: false,
  });

  // ── Credits state (WBAH only) ──
  const creditsFn = useServerFn(getWbahCredits);
  const creditsQ = useQuery({ queryKey: ["wbah-credits"], queryFn: () => creditsFn(), staleTime: 5 * 60_000, enabled: mainTab === "credits" && isWbah, throwOnError: false });

  const visibleTabs = MAIN_TABS.filter((t) => t.key !== "credits" || isWbah);

  return (
    <div className="pb-8">
      <PageHeader
        title="Analytics"
        subtitle="Call performance metrics and marketing channel intelligence"
        icon={BarChart3}
        onRefresh={() => mainTab === "calls" ? q.refetch() : mainTab === "credits" ? creditsQ.refetch() : mktQ.refetch()}
      />

      <ProviderCreditsBar />

      {/* ── Top-level tab bar ── */}
      <div className="flex gap-1 px-6 mt-4 border-b border-white/[0.06]">
        {visibleTabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setMainTab(key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              mainTab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── CALL ANALYTICS TAB ── */}
      {mainTab === "calls" && (
        <>
          {/* Controls row */}
          <div className="flex items-center justify-end gap-2 px-6 pt-4">
            {agentList.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setSelectorOpen((o) => !o)}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-card/60 px-3 py-1.5 text-sm font-medium hover:bg-card/80"
                >
                  <span className="max-w-[180px] truncate">{selectedAgentName}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                {selectorOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
                    <button className={`w-full px-4 py-2.5 text-left text-sm hover:bg-muted/60 ${!selectedAgentId ? "text-primary font-medium" : "text-foreground"}`} onClick={() => { setSelectedAgentId(null); setSelectorOpen(false); }}>All agents</button>
                    {agentList.map((a) => (
                      <button key={a.id} className={`w-full px-4 py-2.5 text-left text-sm hover:bg-muted/60 ${selectedAgentId === a.id ? "text-primary font-medium" : "text-foreground"}`} onClick={() => { setSelectedAgentId(a.id); setSelectorOpen(false); }}>{a.name}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-1 rounded-lg border border-white/[0.06] bg-card/40 p-1">
              {RANGES.map((r) => (
                <Button key={r.key} size="sm" variant={rangeKey === r.key ? "secondary" : "ghost"} onClick={() => setRangeKey(r.key)} className={rangeKey === r.key ? "bg-primary/20 text-primary" : ""}>{r.label}</Button>
              ))}
            </div>
          </div>

          {result?.error && (
            <div className="mx-6 mt-4 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <AlertTriangle className="h-4 w-4" /><span>Analytics error: {result.error}</span>
            </div>
          )}

          {result && !result.configured ? (
            <div className="px-6 pt-5">
              <PanelCard><EmptyState icon={BarChart3} title="No deployed agents" message="Deploy a voice agent to start collecting analytics." /></PanelCard>
            </div>
          ) : (
            <>
              {selectedAgentId && (
                <div className="mx-6 mt-4 flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm">
                  <span className="text-primary font-medium">Showing: <span className="font-semibold">{selectedAgentName}</span></span>
                  <button onClick={() => setSelectedAgentId(null)} className="text-xs text-muted-foreground hover:text-foreground">Clear filter</button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 px-6 pt-5 md:grid-cols-4">
                <StatCard label="Total calls"  tone="primary" value={analytics.total} />
                <StatCard label="Minutes used" tone="info"    value={`${analytics.totalMinutes}m`} />
                <StatCard label="Avg duration" tone="info"    value={fmtDuration(analytics.avgDuration)} />
                <StatCard label="E2E latency"  tone="primary" value={fmtMs(analytics.avgE2eLatency)} />
              </div>
              <div className="grid grid-cols-2 gap-3 px-6 pt-3 md:grid-cols-4">
                <StatCard label="Inbound"            tone="primary" value={analytics.inbound}                      icon={ArrowDownLeft} />
                <StatCard label="Outbound"           tone="info"    value={analytics.outbound}                     icon={ArrowUpRight} />
                <StatCard label="Success rate"       tone="success" value={`${successRate}%`}                      icon={CheckCircle2} />
                <StatCard label="Transfer rate"      tone="warning" value={`${transferRate}%`}                     icon={TrendingUp} />
              </div>
              <div className="grid grid-cols-2 gap-3 px-6 pt-3 md:grid-cols-4">
                <StatCard label="Voicemails screened" tone="info"  value={analytics.voicemailScreenedCount}        icon={PauseCircle} />
              </div>

              <div className="px-6 pt-4">
                <ChartCard title="Call Counts" icon={Activity} color={CHART.primary}>
                  {callsPerDayData.length === 0 ? <NoData /> : (
                    <div className="h-52 w-full">
                      <ResponsiveContainer>
                        <AreaChart data={callsPerDayData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                          <defs><linearGradient id="grad_calls" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART.primary} stopOpacity={0.55} /><stop offset="100%" stopColor={CHART.primary} stopOpacity={0} /></linearGradient></defs>
                          <CartesianGrid stroke={CHART.grid} vertical={false} />
                          <XAxis dataKey="day" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                          <YAxis stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                          <Tooltip content={<ChartTooltip />} />
                          <Area type="monotone" dataKey="calls" name="Calls" stroke={CHART.primaryGlow} strokeWidth={2} fill="url(#grad_calls)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </ChartCard>
              </div>

              <div className="grid grid-cols-1 gap-4 px-6 pt-4 md:grid-cols-3">
                <ChartCard title="Call Successful" icon={CheckCircle2} color={CHART.success}>
                  <CompactDonut data={[{ name: "Successful", value: analytics.successCount }, { name: "Unsuccessful", value: analytics.unsuccessCount }, { name: "Unknown", value: unknownSuccess }]} colors={SUCCESS_COLORS} centerLabel="Total" centerValue={analytics.total} />
                </ChartCard>
                <ChartCard title="Disconnection Reason" icon={XCircle} color={CHART.danger}>
                  <CompactDonut data={Object.entries(analytics.byDisconnect).sort(([, a], [, b]) => b - a).slice(0, 6).map(([k, v]) => ({ name: humanize(k), value: v }))} colors={DISCONNECT_COLORS} centerLabel="Reasons" centerValue={Object.keys(analytics.byDisconnect).length} />
                </ChartCard>
                <ChartCard title="User Sentiment" icon={Activity} color={CHART.warning}>
                  <CompactDonut data={[{ name: "Positive", value: analytics.bySentiment.Positive ?? 0 }, { name: "Neutral", value: analytics.bySentiment.Neutral ?? 0 }, { name: "Negative", value: analytics.bySentiment.Negative ?? 0 }, { name: "Unknown", value: analytics.bySentiment.Unknown ?? 0 }]} colors={SENTIMENT_COLORS} centerLabel="Calls" centerValue={analytics.total} />
                </ChartCard>
              </div>

              <div className="grid grid-cols-1 gap-4 px-6 pt-4 md:grid-cols-3">
                <ChartCard title="Phone Inbound / Outbound" icon={Phone} color={CHART.accent}>
                  <CompactDonut data={[{ name: "Inbound", value: analytics.inbound }, { name: "Outbound", value: analytics.outbound }, { name: "Web", value: analytics.webCalls }]} colors={DIRECTION_COLORS} centerLabel="Total" centerValue={analytics.total} />
                </ChartCard>
                <ChartCard title="Avg Call Duration (s)" icon={Clock} color={CHART.accent}>
                  {durationTrendData.length === 0 ? <NoData /> : (
                    <div className="h-48 w-full">
                      <ResponsiveContainer>
                        <AreaChart data={durationTrendData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                          <defs><linearGradient id="grad_dur" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART.accent} stopOpacity={0.5} /><stop offset="100%" stopColor={CHART.accent} stopOpacity={0} /></linearGradient></defs>
                          <CartesianGrid stroke={CHART.grid} vertical={false} />
                          <XAxis dataKey="day" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                          <YAxis stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} />
                          <Tooltip content={<ChartTooltip />} />
                          <Area type="monotone" dataKey="avg" name="Avg (s)" stroke={CHART.accent} strokeWidth={2} fill="url(#grad_dur)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </ChartCard>
                <ChartCard title="Call Success Rate (%)" icon={TrendingUp} color={CHART.success}>
                  {outcomeTrendData.length === 0 ? <NoData /> : (
                    <div className="h-48 w-full">
                      <ResponsiveContainer>
                        <LineChart data={outcomeTrendData.map((d) => { const total = d.success + d.unsuccessful; return { day: d.day, rate: total ? Math.round((d.success / total) * 100) : 0 }; })} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                          <CartesianGrid stroke={CHART.grid} vertical={false} />
                          <XAxis dataKey="day" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                          <YAxis stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
                          <Tooltip content={<ChartTooltip />} />
                          <Line type="monotone" dataKey="rate" name="Success %" stroke={CHART.success} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </ChartCard>
              </div>

              <div className="px-6 pt-4">
                <ChartCard title="Latency Trends — LLM / TTS / E2E (ms p50)" icon={Zap} color={CHART.warning}>
                  {latencyTrendData.every((d) => d.LLM == null && d.E2E == null && d.TTS == null) ? <NoData /> : (
                    <div className="h-52 w-full">
                      <ResponsiveContainer>
                        <LineChart data={latencyTrendData} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                          <CartesianGrid stroke={CHART.grid} vertical={false} />
                          <XAxis dataKey="day" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                          <YAxis stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} unit="ms" />
                          <Tooltip content={<ChartTooltip />} />
                          <Legend wrapperStyle={{ fontSize: 11, color: CHART.axis }} />
                          <Line type="monotone" dataKey="LLM" stroke={CHART.primary}  strokeWidth={2} dot={false} connectNulls />
                          <Line type="monotone" dataKey="TTS" stroke={CHART.accent}   strokeWidth={2} dot={false} connectNulls />
                          <Line type="monotone" dataKey="E2E" stroke={CHART.warning}  strokeWidth={2} dot={false} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </ChartCard>
              </div>

              <div className="grid grid-cols-1 gap-4 px-6 pt-4 md:grid-cols-2">
                <ChartCard title="Daily Call Outcomes" icon={BarChart3} color={CHART.success}>
                  {outcomeTrendData.length === 0 ? <NoData /> : (
                    <div className="h-52 w-full">
                      <ResponsiveContainer>
                        <BarChart data={outcomeTrendData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                          <CartesianGrid stroke={CHART.grid} vertical={false} />
                          <XAxis dataKey="day" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                          <YAxis stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                          <Tooltip content={<ChartTooltip />} />
                          <Legend wrapperStyle={{ fontSize: 11, color: CHART.axis }} />
                          <Bar dataKey="success"      name="Successful"   fill={CHART.success}  stackId="a" radius={[0,0,0,0]} />
                          <Bar dataKey="unsuccessful" name="Unsuccessful" fill={CHART.danger}   stackId="a" />
                          <Bar dataKey="voicemail"    name="Voicemail"    fill={CHART.neutral}  stackId="a" radius={[3,3,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </ChartCard>
                <ChartCard title="Call Volume by Hour (UTC)" icon={Clock} color={CHART.primary}>
                  {hourData.every((d) => d.calls === 0) ? <NoData /> : (
                    <div className="h-52 w-full">
                      <ResponsiveContainer>
                        <BarChart data={hourData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                          <CartesianGrid stroke={CHART.grid} vertical={false} />
                          <XAxis dataKey="hour" stroke={CHART.axis} fontSize={9} tickLine={false} axisLine={false} interval={3} />
                          <YAxis stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="calls" name="Calls" fill={CHART.primary} radius={[3,3,0,0]} barSize={14} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </ChartCard>
              </div>

              <div className="grid grid-cols-1 gap-4 px-6 pt-4 md:grid-cols-2">
                <ChartCard title="Average Latency (p50)" icon={Zap} color={CHART.warning}>
                  <div className="grid grid-cols-3 gap-3 pt-1">
                    <LatencyTile label="LLM"        value={fmtMs(analytics.avgLlmLatency)} color={CHART.primary} />
                    <LatencyTile label="End-to-end" value={fmtMs(analytics.avgE2eLatency)} color={CHART.warning} />
                    <LatencyTile label="TTS"        value={fmtMs(analytics.avgTtsLatency)} color={CHART.accent} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <LatencyTile label="Voicemails" value={String(analytics.voicemailCount)} color={CHART.neutral} />
                    <LatencyTile label="Transfers"  value={String(analytics.transferCount)}  color={CHART.pink} />
                  </div>
                </ChartCard>
                <ChartCard title="Call Status Breakdown" icon={PhoneCall} color={CHART.primary}>
                  <HBarChart data={Object.entries(analytics.byStatus).sort(([, a], [, b]) => b - a).map(([k, v]) => ({ name: humanize(k), value: v }))} />
                </ChartCard>
              </div>

              <div className="px-6 pt-4">
                <ChartCard title="Disconnection Reasons" icon={XCircle} color={CHART.danger}>
                  <HBarChart data={Object.entries(analytics.byDisconnect).sort(([, a], [, b]) => b - a).map(([k, v]) => ({ name: humanize(k), value: v }))} color={CHART.danger} />
                </ChartCard>
              </div>

              {!selectedAgentId && (
                <div className="px-6 pt-4">
                  <ChartCard title="Per-Agent Breakdown" icon={PhoneCall} color={CHART.primary}>
                    {Object.keys(analytics.byAgent).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No agent activity.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <TableHead>
                            <PageTh>Agent</PageTh><PageTh>Calls</PageTh><PageTh>Talk time</PageTh><PageTh>Avg duration</PageTh><PageTh />
                          </TableHead>
                          <tbody>
                            {Object.entries(analytics.byAgent).sort(([, a], [, b]) => b.count - a.count).map(([id, v]) => (
                              <tr key={id} className="h-11 border-b border-white/[0.04] transition-colors hover:bg-white/[0.02]">
                                <td className="px-3 py-2.5 text-sm font-medium">{agentNames[id] ?? agentList.find((a) => a.id === id)?.name ?? <span className="font-mono text-xs text-muted-foreground">{id}</span>}</td>
                                <td className="px-3 py-2.5 tabular-nums">{v.count}</td>
                                <td className="px-3 py-2.5 tabular-nums">{fmtDuration(v.durationSec)}</td>
                                <td className="px-3 py-2.5 tabular-nums">{fmtDuration(v.count ? v.durationSec / v.count : 0)}</td>
                                <td className="px-3 py-2.5"><button onClick={() => setSelectedAgentId(id)} className="text-xs text-primary hover:underline">View only</button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </ChartCard>
                </div>
              )}
            </>
          )}

          {q.isLoading && <div className="px-6 pt-5 text-sm text-muted-foreground">Loading analytics…</div>}
        </>
      )}

      {/* ── MARKETING TAB ── */}
      {mainTab === "marketing" && (
        <div className="px-6 pt-5 space-y-5">
          {/* Inner marketing sub-tab bar */}
          <div className="flex gap-1 border-b border-white/[0.06]">
            {MKTG_TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setMktTab(key)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                  mktTab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </div>

          {mktQ.isLoading && <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Loading…</div>}
          {!mktQ.isLoading && mktQ.data && (
            <>
              {mktTab === "ads"      && <AdsTab      data={mktQ.data.ads} />}
              {mktTab === "seo"      && <SeoTab      data={mktQ.data.seo} />}
              {mktTab === "email"    && <EmailTab    data={mktQ.data.email} />}
              {mktTab === "whatsapp" && <WhatsAppTab data={mktQ.data.whatsapp} />}
            </>
          )}
        </div>
      )}

      {/* ── CREDITS TAB ── */}
      {mainTab === "credits" && <CreditsTab q={creditsQ} />}
    </div>
  );
}

// ── Call analytics shared chart components ─────────────────────────────────────
function ChartCard({ title, icon: Icon, color, children }: { title: string; icon: React.ElementType; color: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-card/50 p-4 backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" style={{ color }} />
        <h3 className="text-xs font-semibold uppercase tracking-[0.10em] text-muted-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function NoData() { return <p className="py-8 text-center text-xs text-muted-foreground">No data in this range.</p>; }

function CompactDonut({ data, colors, centerLabel, centerValue }: { data: { name: string; value: number }[]; colors: string[]; centerLabel: string; centerValue: number }) {
  const filtered = data.filter((d) => d.value > 0);
  if (filtered.length === 0) return <NoData />;
  return (
    <div className="relative h-52 w-full">
      <ResponsiveContainer>
        <PieChart>
          <Tooltip content={<ChartTooltip />} />
          <Pie data={filtered} dataKey="value" nameKey="name" innerRadius={52} outerRadius={76} paddingAngle={2} stroke="none">
            {filtered.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Pie>
          <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 10, color: CHART.axis }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-8">
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{centerLabel}</span>
        <span className="text-xl font-bold tabular-nums">{centerValue}</span>
      </div>
    </div>
  );
}

function HBarChart({ data, color = CHART.primary }: { data: { name: string; value: number }[]; color?: string }) {
  if (data.length === 0) return <NoData />;
  const height = Math.max(140, data.length * 34);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 2, right: 16, left: 0, bottom: 2 }}>
          <CartesianGrid stroke={CHART.grid} horizontal={false} />
          <XAxis type="number" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} width={130} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(139,92,246,0.07)" }} />
          <Bar dataKey="value" fill={color} radius={[0, 5, 5, 0]} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function LatencyTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/40 px-3 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color }}>{label}</p>
      <p className="mt-1.5 text-xl font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

// ── Credits tab ────────────────────────────────────────────────────────────────
function fmtMins(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "0";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtCreditDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function CreditCardTile({ label, value, sub, color, icon: Icon }: { label: string; value: string; sub: string; color: string; icon: React.ElementType }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-card/50 p-4 backdrop-blur-sm">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" style={{ color }} />
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      </div>
      <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function CreditsTab({ q }: { q: any }) {
  if (q.isLoading && !q.data) return <div className="px-6 pt-6 text-sm text-muted-foreground">Loading credits…</div>;
  if (q.error) return (
    <div className="mx-6 mt-5 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <AlertTriangle className="h-4 w-4" /><span>Could not load credits: {String(q.error?.message ?? q.error)}</span>
    </div>
  );

  const d = q.data ?? {};
  const s: any = d.summary ?? {};
  const retell: any = d.retell ?? {};
  const allocated = s.allocated_minutes ?? retell.allocated_minutes ?? 0;
  const used      = s.used_minutes ?? retell.used_minutes ?? 0;
  const remaining = s.remaining_minutes ?? retell.remaining_minutes ?? 0;
  const pct       = Math.round(s.percent_used ?? retell.percent_used ?? 0);
  const carried   = s.carried_over_minutes;
  const months: any[]  = Array.isArray(d.months) ? d.months : [];
  const history: any[] = Array.isArray(d.history) ? d.history : [];
  const trendData = months.map((m: any) => ({ month: m.month, minutes: +(m.minutes_used ?? 0) }));
  const usageColor = pct >= 90 ? CHART.danger : pct >= 70 ? CHART.warning : CHART.success;
  const allocSub = carried != null && carried > 0 ? `Recharge + ${fmtMins(carried)} carryover` : "Recharge + carryover";

  return (
    <div className="px-6 pt-5 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Credit Dashboard</h2>
        <p className="text-sm text-muted-foreground">Track your AI calling minute allocations and consumption</p>
      </div>

      {/* Credit counter */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CreditCardTile label="Total Allocated"   value={`${fmtMins(allocated)} mins`} sub={allocSub}          color={CHART.primaryGlow} icon={Wallet} />
        <CreditCardTile label="Minutes Used"      value={`${fmtMins(used)} mins`}      sub="This cycle"        color={CHART.warning}     icon={Activity} />
        <CreditCardTile label="Remaining Balance" value={`${fmtMins(remaining)} mins`} sub="Available to use"  color={CHART.success}     icon={CheckCircle2} />
        <div className="rounded-2xl border border-white/[0.06] bg-card/50 p-4 backdrop-blur-sm">
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5" style={{ color: usageColor }} />
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Usage</p>
          </div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: usageColor }}>{pct}%</p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: usageColor }} />
          </div>
        </div>
      </div>

      {/* Consumption trend */}
      <ChartCard title="Consumption Trend — Minutes Used per Month" icon={BarChart3} color={CHART.primary}>
        {trendData.length === 0 || trendData.every((t) => t.minutes === 0) ? <NoData /> : (
          <div className="h-64 w-full">
            <ResponsiveContainer>
              <AreaChart data={trendData} margin={{ top: 6, right: 6, left: -6, bottom: 0 }}>
                <defs><linearGradient id="grad_credits" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CHART.primary} stopOpacity={0.55} /><stop offset="100%" stopColor={CHART.primary} stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="month" stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke={CHART.axis} fontSize={10} tickLine={false} axisLine={false} unit=" min" width={60} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="minutes" name="Minutes" stroke={CHART.primaryGlow} strokeWidth={2} fill="url(#grad_credits)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      {/* Recharge history */}
      <ChartCard title="Recharge History" icon={CreditCard} color={CHART.accent}>
        {history.length === 0 ? <p className="text-sm text-muted-foreground">No recharge history.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead>
                <PageTh>Date</PageTh><PageTh>Minutes Added</PageTh><PageTh>Notes</PageTh><PageTh>Added By</PageTh><PageTh>Status</PageTh>
              </TableHead>
              <tbody>
                {history.map((h: any, i: number) => (
                  <tr key={h.id ?? i} className="h-11 border-b border-white/[0.04] transition-colors hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5">{fmtCreditDate(h.createdAt ?? h.allocated_at)}</td>
                    <td className="px-3 py-2.5"><Badge className="border-emerald-500/20 bg-emerald-500/15 text-emerald-300">+{fmtMins(h.allocated_minutes)} min</Badge></td>
                    <td className="px-3 py-2.5 text-muted-foreground">{h.notes ?? "—"}</td>
                    <td className="px-3 py-2.5">{h.allocated_by ?? "—"}</td>
                    <td className="px-3 py-2.5"><span className="text-xs capitalize text-muted-foreground">{h.status ?? "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}

// ── Marketing sub-tab components ───────────────────────────────────────────────
function AdsTab({ data }: { data: AdsData }) {
  const platforms = Object.keys(data.byPlatform);
  if (!data.hasSyncedData) {
    return <EmptyState icon={BarChart2} title="No ad data synced yet" message="Connect Meta Ads, Google Ads, or TikTok Ads in GrowthMind → Data Sources to start pulling campaign performance." />;
  }
  const barData = platforms.map((p) => ({ name: PLATFORM_LABELS[p] ?? p, spend: +data.byPlatform[p].spend.toFixed(2), clicks: data.byPlatform[p].clicks, conversions: data.byPlatform[p].conversions, fill: PLATFORM_COLORS[p] ?? "#7c3aed" }));
  return (
    <div className="space-y-6">
      <div className={cn("grid gap-4", platforms.length >= 3 ? "grid-cols-3" : "grid-cols-2")}>
        {platforms.map((p) => {
          const t = data.byPlatform[p];
          return (
            <MktPanel key={p}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold" style={{ color: PLATFORM_COLORS[p] ?? "inherit" }}>{PLATFORM_LABELS[p] ?? p}</span>
                <span className="text-xs text-muted-foreground">{t.campaigns} campaign{t.campaigns !== 1 ? "s" : ""}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MktMetric label="Spend"       value={fmtCurrency(t.spend)} />
                <MktMetric label="ROAS"        value={t.roas != null ? `${t.roas}×` : "—"} />
                <MktMetric label="Impressions" value={fmtNum(t.impressions)} />
                <MktMetric label="Clicks"      value={fmtNum(t.clicks)} />
                <MktMetric label="CTR"         value={t.ctr != null ? `${t.ctr}%` : "—"} />
                <MktMetric label="Conversions" value={fmtNum(t.conversions)} />
              </div>
              {t.lastSyncedAt && <p className="text-[10px] text-muted-foreground mt-2">Synced {fmtDateShort(t.lastSyncedAt)}</p>}
            </MktPanel>
          );
        })}
      </div>
      <MktPanel title="Spend by platform (30 days)">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => `£${v}`} />
            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} formatter={(v: number) => fmtCurrency(v)} />
            <Bar dataKey="spend" radius={[4, 4, 0, 0]}>{barData.map((d, i) => <Cell key={i} fill={d.fill} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </MktPanel>
      {data.topCampaigns.length > 0 && (
        <MktPanel title="Top campaigns by spend">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <MTh>Campaign</MTh><MTh>Platform</MTh><MTh align="right">Spend</MTh><MTh align="right">Impressions</MTh><MTh align="right">Clicks</MTh><MTh align="right">ROAS</MTh>
                </tr>
              </thead>
              <tbody>
                {data.topCampaigns.map((c, i) => (
                  <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="py-2 pr-4 max-w-[200px] truncate font-medium">{c.name}</td>
                    <td className="py-2 pr-4"><Badge variant="outline" className="text-[10px]" style={{ borderColor: PLATFORM_COLORS[c.platform] ?? "#7c3aed", color: PLATFORM_COLORS[c.platform] ?? "inherit" }}>{PLATFORM_LABELS[c.platform] ?? c.platform}</Badge></td>
                    <MTd align="right">{fmtCurrency(c.spend)}</MTd>
                    <MTd align="right">{fmtNum(c.impressions)}</MTd>
                    <MTd align="right">{fmtNum(c.clicks)}</MTd>
                    <MTd align="right">{c.roas != null ? `${c.roas}×` : "—"}</MTd>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MktPanel>
      )}
    </div>
  );
}

function SeoTab({ data }: { data: { sites: SeoSite[] } }) {
  if (data.sites.length === 0) return <EmptyState icon={Search} title="No SEO sites tracked" message="Add a site in GrowthMind → SEO and connect Google Search Console to pull keyword performance data." />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Sites tracked"      value={data.sites.length}                                                  tone="primary" />
        <StatCard label="Total keywords"     value={data.sites.reduce((a, s) => a + s.keywordCount, 0)}                 tone="info"    />
        <StatCard label="Total impressions"  value={fmtNum(data.sites.reduce((a, s) => a + s.totalImpressions, 0))}     tone="info"    />
        <StatCard label="Total GSC clicks"   value={fmtNum(data.sites.reduce((a, s) => a + s.totalClicks, 0))}          tone="primary" />
      </div>
      {data.sites.map((site) => (
        <MktPanel key={site.url} title={site.url}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <MktMetric label="Keywords tracked" value={site.keywordCount} />
            <MktMetric label="GSC impressions"  value={fmtNum(site.totalImpressions)} />
            <MktMetric label="GSC clicks"       value={fmtNum(site.totalClicks)} />
            <MktMetric label="Avg position"     value={site.avgPosition != null ? `#${site.avgPosition}` : "—"} />
          </div>
          {!site.hasGscData && <p className="text-xs text-amber-400/80">Connect Google Search Console in GrowthMind → SEO to pull live position data.</p>}
          {site.hasGscData && site.avgPosition != null && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1"><span>Average position</span><span>#{site.avgPosition}</span></div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(5, Math.min(100, 100 - (site.avgPosition / 100) * 100))}%` }} /></div>
            </div>
          )}
        </MktPanel>
      ))}
    </div>
  );
}

const EMAIL_STATUS_ICONS: Record<string, React.ElementType> = { active: CheckCircle2, draft: Clock, paused: PauseCircle, archived: XCircle };

function EmailTab({ data }: { data: EmailData }) {
  if (data.total === 0) return <EmptyState icon={Mail} title="No email campaigns yet" message="Create your first campaign in HexMail to start tracking email success metrics." />;
  const pieData = Object.entries(data.byStatus).map(([status, count]) => ({ name: status.charAt(0).toUpperCase() + status.slice(1), value: count, fill: STATUS_COLORS[status] ?? "#7c3aed" }));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total campaigns" value={data.total}                                                               tone="primary" />
        <StatCard label="Active"           value={data.byStatus.active  ?? 0}                                             tone="info"    />
        <StatCard label="Draft"            value={data.byStatus.draft   ?? 0}                                             tone="primary" />
        <StatCard label="Paused/archived"  value={(data.byStatus.paused ?? 0) + (data.byStatus.archived ?? 0)}            tone="primary" />
      </div>
      <div className="grid grid-cols-2 gap-6">
        <MktPanel title="Status breakdown">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">{pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}</Pie>
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </MktPanel>
        <MktPanel title="Recent campaigns">
          <div className="space-y-2">
            {data.recentCampaigns.map((c) => {
              const Icon = EMAIL_STATUS_ICONS[c.status] ?? Mail;
              return (
                <div key={c.id} className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
                  <div className="flex items-center gap-2 min-w-0"><Icon className="h-3.5 w-3.5 shrink-0" style={{ color: STATUS_COLORS[c.status] ?? "#94a3b8" }} /><span className="text-sm truncate">{c.name}</span></div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-foreground">{fmtDateShort(c.createdAt)}</span>
                    <Badge variant="outline" className="text-[10px]" style={{ borderColor: STATUS_COLORS[c.status] ?? "#94a3b8", color: STATUS_COLORS[c.status] ?? "#94a3b8" }}>{c.status}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </MktPanel>
      </div>
    </div>
  );
}

function WhatsAppTab({ data }: { data: WhatsAppData }) {
  if (data.total === 0) return <EmptyState icon={MessageSquare} title="No WhatsApp campaigns yet" message="Create a campaign in the WhatsApp section to start tracking delivery and read rates." />;
  const deliveryRate = data.totalSent > 0 ? Math.round((data.totalDelivered / data.totalSent) * 100) : 0;
  const readRate     = data.totalSent > 0 ? Math.round((data.totalRead      / data.totalSent) * 100) : 0;
  const replyRate    = data.totalSent > 0 ? Math.round((data.totalReplied   / data.totalSent) * 100) : 0;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Campaigns"     value={data.total}             tone="primary" />
        <StatCard label="Messages sent" value={fmtNum(data.totalSent)} tone="info"    />
        <StatCard label="Delivered"     value={`${deliveryRate}%`}     tone="info"    />
        <StatCard label="Read rate"     value={`${readRate}%`}         tone="primary" />
      </div>
      <div className="grid grid-cols-2 gap-6">
        <MktPanel title="Campaign funnel (all time)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart layout="vertical" data={[{ stage: "Sent", count: data.totalSent, fill: "#7c3aed" }, { stage: "Delivered", count: data.totalDelivered, fill: "#22c55e" }, { stage: "Read", count: data.totalRead, fill: "#3b82f6" }, { stage: "Replied", count: data.totalReplied, fill: "#f59e0b" }]} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={fmtNum} />
              <YAxis type="category" dataKey="stage" tick={{ fontSize: 11, fill: "#94a3b8" }} width={68} />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} formatter={(v: number) => fmtNum(v)} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>{[0,1,2,3].map((i) => <Cell key={i} fill={["#7c3aed","#22c55e","#3b82f6","#f59e0b"][i]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </MktPanel>
        <MktPanel title="Recent campaigns">
          <div className="space-y-2">
            {data.recentCampaigns.map((c) => (
              <div key={c.id} className="border-b border-white/[0.04] last:border-0 pb-2 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium truncate max-w-[160px]">{c.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px]">{c.type}</Badge>
                    <Badge variant="outline" className="text-[10px]" style={{ borderColor: STATUS_COLORS[c.status] ?? "#94a3b8", color: STATUS_COLORS[c.status] ?? "#94a3b8" }}>{c.status}</Badge>
                  </div>
                </div>
                <div className="flex gap-4 text-[11px] text-muted-foreground">
                  <span>{c.stats.sent} sent</span><span>{c.stats.delivered} delivered</span><span>{c.stats.read} read</span>
                  {c.stats.replied > 0 && <span>{c.stats.replied} replied</span>}
                </div>
              </div>
            ))}
          </div>
        </MktPanel>
      </div>
      <MktPanel title="Engagement rates">
        <div className="space-y-3">
          {[{ label: "Delivery rate", pct: deliveryRate, color: "#22c55e" }, { label: "Read rate", pct: readRate, color: "#3b82f6" }, { label: "Reply rate", pct: replyRate, color: "#f59e0b" }].map(({ label, pct, color }) => (
            <div key={label}>
              <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>{label}</span><span style={{ color }}>{pct}%</span></div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} /></div>
            </div>
          ))}
        </div>
      </MktPanel>
    </div>
  );
}

// ── Marketing shared primitives ────────────────────────────────────────────────
function MktPanel({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <PanelCard className={className}>
      {title && <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>}
      {children}
    </PanelCard>
  );
}
function MktMetric({ label, value }: { label: string; value: string | number }) {
  return <div><p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p><p className="text-sm font-semibold">{value}</p></div>;
}
function MTh({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={cn("py-2 pr-4 text-xs font-medium text-muted-foreground uppercase tracking-wide", align === "right" && "text-right")}>{children}</th>;
}
function MTd({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <td className={cn("py-2 pr-4 text-sm text-muted-foreground", align === "right" && "text-right")}>{children}</td>;
}
