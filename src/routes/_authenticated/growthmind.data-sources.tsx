import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Loader2, CheckCircle2, XCircle, AlertCircle, Database, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/growthmind/data-sources")({
  head: () => ({ meta: [{ title: "Data Sources — GrowthMind" }] }),
  component: DataSourcesPage,
});

// ── Types ──────────────────────────────────────────────────────────────────────

type SourceStatus = "connected" | "not_connected" | "partial";

type DataSource = {
  id:          string;
  label:       string;
  category:    string;
  status:      SourceStatus;
  detail:      string;
  lastSync:    string | null;
  usedBy:      string[];
  setupHref:   string | null;
  dataPoints:  number | null;
};

// ── Server fn ─────────────────────────────────────────────────────────────────

const getDataSourceStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const [
      settingsRes, dnaRes, adsPsRes, adsCampaignsRes, adsSyncLogRes, watiRes,
      leadsRes, callsRes, waContactsRes,
      competitorsRes, calendarRes, tasksRes,
      hexmailRes, bookingsRes, seoRes,
    ] = await Promise.all([
      sb.from("workspace_settings")
        .select("calcom_api_key,whatsapp_phone_id,gsc_access_token,gsc_property_url,hexmail_active_provider,meta_phone_number_id,retell_workspace_id,meta_ads_access_token,meta_ads_account_id")
        .eq("workspace_id", workspaceId).maybeSingle(),
      sb.from("growthmind_business_dna")
        .select("website,industry,updated_at").eq("workspace_id", workspaceId).maybeSingle(),
      // New: check provider_settings for advertising credentials
      sb.from("provider_settings")
        .select("provider_name,status,updated_at")
        .eq("workspace_id", workspaceId)
        .eq("provider_category", "advertising")
        .in("status", ["connected", "partial"])
        .limit(10)
        .catch(() => ({ data: [] })),
      // New: check growthmind_campaigns for synced data
      sb.from("growthmind_campaigns")
        .select("platform,status,synced_at")
        .eq("workspace_id", workspaceId)
        .order("synced_at", { ascending: false })
        .limit(100)
        .catch(() => ({ data: [] })),
      // Sync log: last sync attempt per platform (includes error status)
      sb.from("growthmind_ad_performance_log")
        .select("platform,status,error_message,synced_at,campaigns_synced")
        .eq("workspace_id", workspaceId)
        .order("synced_at", { ascending: false })
        .limit(20)
        .catch(() => ({ data: [] })),
      sb.from("wati_connections")
        .select("id,status,last_tested_at").eq("workspace_id", workspaceId).maybeSingle(),
      sb.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      sb.from("calls").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      sb.from("whatsapp_contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      sb.from("growthmind_competitors").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      sb.from("growthmind_content_calendar").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      sb.from("growthmind_marketing_tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      sb.from("hexmail_campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      sb.from("calendar_bookings").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      sb.from("growthmind_seo_sites").select("id,keywords,updated_at").eq("workspace_id", workspaceId).limit(10),
    ]);

    const settings    = settingsRes.data;
    const dna         = dnaRes.data;
    const adsPsList: any[] = (adsPsRes as any).data ?? [];
    const adsCampaigns: any[] = (adsCampaignsRes as any).data ?? [];
    const adsSyncLog: any[] = (adsSyncLogRes as any).data ?? [];
    const wati        = watiRes.data;
    const leadCount   = leadsRes.count    ?? 0;
    const callCount   = callsRes.count    ?? 0;
    const waCount     = waContactsRes.count ?? 0;
    const compCount   = competitorsRes.count ?? 0;
    const calCount    = calendarRes.count  ?? 0;
    const taskCount   = tasksRes.count     ?? 0;
    const hexCount    = hexmailRes.count   ?? 0;
    const bookingCount = bookingsRes.count ?? 0;
    const seoSites: any[] = seoRes.data ?? [];
    const seoKeywords = seoSites.reduce((a: number, s: any) => a + ((s.keywords as any[])?.length ?? 0), 0);

    // Derive ads connection status from provider_settings + workspace_settings token + synced campaigns
    const hasMetaAdsCred = !!(settings?.meta_ads_access_token && settings?.meta_ads_account_id)
      || adsPsList.some((p: any) => p.provider_name === "meta_ads");
    const hasGoogleAdsCred = adsPsList.some((p: any) => p.provider_name === "google_ads");

    const metaSyncCamps   = adsCampaigns.filter((c: any) => c.platform === "meta");
    const googleSyncCamps = adsCampaigns.filter((c: any) => c.platform === "google");
    const metaLastSync    = metaSyncCamps[0]?.synced_at ?? null;
    const googleLastSync  = googleSyncCamps[0]?.synced_at ?? null;
    const metaCampCount   = metaSyncCamps.length;
    const googleCampCount = googleSyncCamps.length;

    // Sync log: most recent attempt per platform (errors surface even if campaigns table has data)
    const metaSyncLogLast    = adsSyncLog.find((l: any) => l.platform === "meta") ?? null;
    const googleSyncLogLast  = adsSyncLog.find((l: any) => l.platform === "google") ?? null;
    const metaSyncError      = metaSyncLogLast?.status === "error" ? metaSyncLogLast.error_message : null;
    const googleSyncError    = googleSyncLogLast?.status === "error" ? googleSyncLogLast.error_message : null;

    // Legacy growthmind_ads_accounts fallback (LinkedIn/TikTok only — they have no sync adapter yet)
    const linkedinAds = null;
    const tiktokAds   = null;

    const hasWhatsapp = !!(settings?.whatsapp_phone_id || settings?.meta_phone_number_id || wati?.status === "connected");
    const hasWati     = wati?.status === "connected";
    const hasMeta     = !!settings?.meta_phone_number_id;
    const hasCalcom   = !!settings?.calcom_api_key;
    const hasGsc      = !!settings?.gsc_access_token;
    const hasHexmail  = !!settings?.hexmail_active_provider;
    const hasRetell   = !!settings?.retell_workspace_id;

    const sources: DataSource[] = [
      // ── Web ─────────────────────────────────────────────────────────────────
      {
        id: "website", label: "Website", category: "Web Presence",
        status: dna?.website ? "connected" : "not_connected",
        detail: dna?.website ? `URL recorded: ${dna.website}` : "Add your website URL in Business DNA.",
        lastSync: dna?.updated_at ?? null,
        usedBy: ["Business DNA", "SEO", "Strategy"],
        setupHref: "/growthmind/business-dna",
        dataPoints: dna?.website ? 1 : null,
      },
      {
        id: "gsc", label: "Google Search Console", category: "Web Presence",
        status: hasGsc ? "connected" : "not_connected",
        detail: hasGsc
          ? `Connected${settings?.gsc_property_url ? ` — ${settings.gsc_property_url}` : ""}`
          : "Connect GSC for real keyword ranking and impression data.",
        lastSync: null,
        usedBy: ["SEO", "Content Strategy", "Opportunity Engine"],
        setupHref: "/settings/providers",
        dataPoints: hasGsc ? seoKeywords : null,
      },

      // ── Ads ──────────────────────────────────────────────────────────────────
      {
        id: "google_ads", label: "Google Ads", category: "Paid Advertising",
        status: googleSyncError && googleCampCount === 0
          ? "partial"
          : googleCampCount > 0 ? "connected" : hasGoogleAdsCred ? "partial" : "not_connected",
        detail: googleSyncError
          ? `Last sync failed: ${googleSyncError.slice(0, 120)}`
          : googleCampCount > 0
            ? `${googleCampCount} campaign(s) synced — ${googleSyncLogLast?.campaigns_synced ?? googleCampCount} pulled last run`
            : hasGoogleAdsCred
              ? "Credentials saved — sync pending (first tick in 90s)"
              : "No Google Ads credentials. Add them in Provider Settings.",
        lastSync: googleSyncLogLast?.synced_at ?? googleLastSync,
        usedBy: ["Ads Performance", "Recommendations", "GrowthMind CMO"],
        setupHref: "/settings/providers",
        dataPoints: googleCampCount || null,
      },
      {
        id: "meta_ads", label: "Meta Ads", category: "Paid Advertising",
        status: metaSyncError && metaCampCount === 0
          ? "partial"
          : metaCampCount > 0 ? "connected" : hasMetaAdsCred ? "partial" : "not_connected",
        detail: metaSyncError
          ? `Last sync failed: ${metaSyncError.slice(0, 120)}`
          : metaCampCount > 0
            ? `${metaCampCount} campaign(s) synced — ${metaSyncLogLast?.campaigns_synced ?? metaCampCount} pulled last run`
            : hasMetaAdsCred
              ? "Credentials saved — sync pending (first tick in 90s)"
              : "No Meta Ads credentials. Add access token and account ID in Provider Settings.",
        lastSync: metaSyncLogLast?.synced_at ?? metaLastSync,
        usedBy: ["Ads Performance", "Recommendations", "GrowthMind CMO"],
        setupHref: "/settings/providers",
        dataPoints: metaCampCount || null,
      },
      {
        id: "linkedin_ads", label: "LinkedIn Ads", category: "Paid Advertising",
        status: linkedinAds ? "partial" : "not_connected",
        detail: "LinkedIn Ads sync coming soon. Not yet supported.",
        lastSync: null,
        usedBy: ["Campaign Factory"],
        setupHref: null,
        dataPoints: null,
      },
      {
        id: "tiktok_ads", label: "TikTok Ads", category: "Paid Advertising",
        status: tiktokAds ? "partial" : "not_connected",
        detail: "TikTok Ads sync coming soon. Not yet supported.",
        lastSync: null,
        usedBy: ["Campaign Factory"],
        setupHref: null,
        dataPoints: null,
      },

      // ── CRM & Calls ──────────────────────────────────────────────────────────
      {
        id: "crm", label: "CRM (Leads & Pipeline)", category: "CRM & Calls",
        status: leadCount > 0 ? "connected" : "not_connected",
        detail: leadCount > 0 ? `${leadCount.toLocaleString()} leads in pipeline` : "No leads yet. Add leads or connect your CRM.",
        lastSync: null,
        usedBy: ["Opportunity Engine", "Lead Opportunities", "Forecasts", "Strategy"],
        setupHref: "/leads",
        dataPoints: leadCount,
      },
      {
        id: "calls", label: "AI Call Logs", category: "CRM & Calls",
        status: callCount > 0 ? "connected" : (hasRetell ? "partial" : "not_connected"),
        detail: callCount > 0
          ? `${callCount.toLocaleString()} calls recorded`
          : hasRetell ? "OmniVoice connected — no calls yet" : "No call data available.",
        lastSync: null,
        usedBy: ["Opportunity Engine", "Conversion Analysis", "Strategy"],
        setupHref: "/calls",
        dataPoints: callCount,
      },
      {
        id: "bookings", label: "Calendar Bookings", category: "CRM & Calls",
        status: bookingCount > 0 ? "connected" : (hasCalcom ? "partial" : "not_connected"),
        detail: bookingCount > 0
          ? `${bookingCount.toLocaleString()} bookings recorded`
          : hasCalcom ? "Cal.com connected — no bookings yet" : "No booking data available.",
        lastSync: null,
        usedBy: ["Funnel Analysis", "Strategy"],
        setupHref: "/settings",
        dataPoints: bookingCount,
      },

      // ── Messaging ────────────────────────────────────────────────────────────
      {
        id: "whatsapp", label: "WhatsApp", category: "Messaging",
        status: hasWhatsapp ? "connected" : "not_connected",
        detail: hasWhatsapp
          ? `${hasWati ? "WATI" : hasMeta ? "Meta" : "Connected"} — ${waCount.toLocaleString()} contacts`
          : "No WhatsApp provider connected.",
        lastSync: wati?.last_tested_at ?? null,
        usedBy: ["Campaign Factory", "Opportunity Engine", "Audience Analysis"],
        setupHref: "/settings",
        dataPoints: waCount > 0 ? waCount : null,
      },
      {
        id: "hexmail", label: "HexMail (Email)", category: "Messaging",
        status: hasHexmail ? "connected" : "not_connected",
        detail: hasHexmail
          ? `${settings?.hexmail_active_provider} connected — ${hexCount} campaign(s)`
          : "No email provider configured in HexMail.",
        lastSync: null,
        usedBy: ["Campaign Factory", "Follow-Up Analysis"],
        setupHref: "/hexmail",
        dataPoints: hexCount > 0 ? hexCount : null,
      },

      // ── Competitive ──────────────────────────────────────────────────────────
      {
        id: "competitors", label: "Competitors", category: "Market Intelligence",
        status: compCount > 0 ? "connected" : "not_connected",
        detail: compCount > 0 ? `${compCount} competitor(s) tracked` : "No competitors tracked yet.",
        lastSync: null,
        usedBy: ["Opportunity Engine", "Strategy", "Value Point Engine"],
        setupHref: "/growthmind/competitors",
        dataPoints: compCount,
      },
      {
        id: "seo", label: "SEO Keywords", category: "Market Intelligence",
        status: seoKeywords > 0 ? "connected" : "not_connected",
        detail: seoKeywords > 0 ? `${seoKeywords} keyword(s) being tracked` : "No keywords tracked yet.",
        lastSync: seoSites[0]?.updated_at ?? null,
        usedBy: ["SEO", "Opportunity Engine", "Content Strategy"],
        setupHref: "/growthmind/seo",
        dataPoints: seoKeywords,
      },

      // ── Content ──────────────────────────────────────────────────────────────
      {
        id: "content_calendar", label: "Content Calendar", category: "Content & Scheduling",
        status: calCount > 0 ? "connected" : "not_connected",
        detail: calCount > 0 ? `${calCount} calendar item(s)` : "No content calendar entries yet.",
        lastSync: null,
        usedBy: ["Opportunity Engine", "Content Strategy"],
        setupHref: "/growthmind/content-calendar",
        dataPoints: calCount,
      },
      {
        id: "growth_scheduler", label: "Growth Scheduler", category: "Content & Scheduling",
        status: taskCount > 0 ? "connected" : "not_connected",
        detail: taskCount > 0 ? `${taskCount} growth task(s) scheduled` : "No growth tasks created yet.",
        lastSync: null,
        usedBy: ["Strategy Execution"],
        setupHref: "/growthmind/growth-scheduler",
        dataPoints: taskCount,
      },
    ];

    const connected    = sources.filter(s => s.status === "connected").length;
    const partial      = sources.filter(s => s.status === "partial").length;
    const notConnected = sources.filter(s => s.status === "not_connected").length;

    return { sources, summary: { connected, partial, notConnected, total: sources.length } };
  });

// ── Component ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  connected:     { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", badge: "Connected",     badgeClass: "bg-emerald-500/15 text-emerald-400" },
  partial:       { icon: AlertCircle,  color: "text-amber-400",   bg: "bg-amber-500/10",   badge: "Partial",       badgeClass: "bg-amber-500/15 text-amber-400" },
  not_connected: { icon: XCircle,      color: "text-red-400/70",  bg: "bg-red-500/[0.07]", badge: "Not Connected", badgeClass: "bg-slate-500/15 text-slate-400" },
} as const;

const CATEGORIES = [
  "Web Presence", "Paid Advertising", "CRM & Calls",
  "Messaging", "Market Intelligence", "Content & Scheduling",
];

function SourceCard({ source }: { source: DataSource }) {
  const cfg = STATUS_CONFIG[source.status];
  const Icon = cfg.icon;

  return (
    <div className={cn("rounded-xl border border-white/[0.06] p-4 flex flex-col gap-3", cfg.bg)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn("h-4 w-4 shrink-0", cfg.color)} />
          <span className="text-sm font-medium truncate">{source.label}</span>
        </div>
        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0", cfg.badgeClass)}>
          {cfg.badge}
        </span>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{source.detail}</p>

      <div className="flex items-center justify-between gap-2 mt-auto">
        <div className="flex flex-wrap gap-1">
          {source.usedBy.slice(0, 2).map(u => (
            <span key={u} className="text-[10px] bg-white/[0.04] text-muted-foreground px-1.5 py-0.5 rounded">
              {u}
            </span>
          ))}
          {source.usedBy.length > 2 && (
            <span className="text-[10px] text-muted-foreground/50">+{source.usedBy.length - 2}</span>
          )}
        </div>
        {source.setupHref && source.status !== "connected" && (
          <Link to={source.setupHref} className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 shrink-0">
            Set up <ExternalLink className="h-2.5 w-2.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

function DataSourcesPage() {
  const fn = useServerFn(getDataSourceStatus);
  const { data, isLoading } = useQuery({
    queryKey: ["growthmind-data-sources"],
    queryFn:  () => fn(),
    staleTime: 60_000,
  });

  const sources  = data?.sources ?? [];
  const summary  = data?.summary ?? { connected: 0, partial: 0, notConnected: 0, total: 0 };
  const coveragePct = summary.total > 0 ? Math.round(((summary.connected + summary.partial * 0.5) / summary.total) * 100) : 0;

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-5xl space-y-6">

        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/25">
            <Database className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Data Source Map</h1>
            <p className="text-xs text-muted-foreground">Connected sources powering GrowthMind intelligence</p>
          </div>
        </div>

        {/* Summary bar */}
        <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Marketing Data Coverage</span>
            <span className="text-xl font-bold text-emerald-400 tabular-nums">{coveragePct}%</span>
          </div>
          <div className="h-1.5 w-full bg-white/[0.06] rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${coveragePct}%` }} />
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400" />{summary.connected} connected</span>
            <span className="flex items-center gap-1"><AlertCircle className="h-3 w-3 text-amber-400" />{summary.partial} partial</span>
            <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-red-400/70" />{summary.notConnected} missing</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          CATEGORIES.map(category => {
            const catSources = sources.filter(s => s.category === category);
            if (catSources.length === 0) return null;
            return (
              <div key={category}>
                <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/60 mb-3">{category}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {catSources.map(source => <SourceCard key={source.id} source={source} />)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </GrowthMindShell>
  );
}
