import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useRef } from "react";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  Users, CalendarCheck, MessageSquare, AlertTriangle,
  CheckCircle2, Loader2, RefreshCw, Clock,
  ChevronDown, Settings2, ArrowRight, Timer, Bot,
  Zap, MailOpen, XCircle, EyeOff, Brain, Bell, X, Newspaper,
} from "lucide-react";
import { HiveMindProviderHealth } from "@/components/hivemind/HiveMindProviderHealth";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { HiveMindShell, useHiveMindMode } from "@/components/hivemind/HiveMindShell";
import { getHiveMindBriefing, getHiveMindPlatformData } from "@/lib/hivemind/hivemind.functions";
import { generateRecommendations } from "@/lib/hivemind/recommendations";
import { Button } from "@/components/ui/button";
import {
  runHiveMindScan, getHiveMindTasksAndEvents, markHiveMindEventsRead,
  type HiveMindEvent,
} from "@/lib/hivemind/hivemind.tasks";

export const Route = createFileRoute("/_authenticated/hivemind/")({
  head: () => ({ meta: [{ title: "HiveMind — Webee" }] }),
  component: HiveMindOverview,
});

// ── Prefs ──────────────────────────────────────────────────────────────────────
type BriefingPrefs = {
  newLeads: boolean; newBookings: boolean; staleClients: boolean;
  pipeline: boolean; whatsapp: boolean; email: boolean; systemIssues: boolean;
};
const DEFAULT_PREFS: BriefingPrefs = {
  newLeads: true, newBookings: true, staleClients: true,
  pipeline: true, whatsapp: true, email: true, systemIssues: true,
};
const STALE_OPTIONS = [3, 5, 7, 10, 14, 30];
const SINCE_OPTIONS = [
  { label: "Last 1 hour",   hours: 1 },
  { label: "Last 4 hours",  hours: 4 },
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 3 days",   hours: 72 },
  { label: "Last 7 days",   hours: 168 },
];
const REFRESH_MS = 90_000;

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtDateTime(isoStr: string) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
function fmtStatus(s: string) {
  return (s ?? "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Dismiss store (localStorage) ──────────────────────────────────────────────
// Fix #13: stale client dismiss/snooze
function loadDismissed(): Record<string, number> {
  try {
    const raw = localStorage.getItem("hivemind-dismissed-stale");
    if (!raw) return {};
    const map: Record<string, number> = JSON.parse(raw);
    // remove expired (older than 7 days)
    const cutoff = Date.now() - 7 * 86400000;
    return Object.fromEntries(Object.entries(map).filter(([, ts]) => ts > cutoff));
  } catch { return {}; }
}
function saveDismissed(map: Record<string, number>) {
  try { localStorage.setItem("hivemind-dismissed-stale", JSON.stringify(map)); } catch {}
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function Count({ n, color = "violet" }: { n: number; color?: string }) {
  const cls: Record<string, string> = {
    violet: "bg-violet-500/20 text-violet-300",
    amber:  "bg-amber-500/20 text-amber-300",
    emerald:"bg-emerald-500/20 text-emerald-300",
    red:    "bg-red-500/20 text-red-300",
    blue:   "bg-blue-500/20 text-blue-300",
    green:  "bg-green-500/20 text-green-300",
    sky:    "bg-sky-500/20 text-sky-300",
  };
  return <span className={cn("ml-1.5 rounded-full px-1.5 py-0 text-[10px] font-bold tabular-nums", cls[color] ?? cls.violet)}>{n}</span>;
}

function Toggle({ label, checked, onChange, icon: Icon, color }: {
  label: string; checked: boolean; onChange: () => void;
  icon: React.ElementType; color: "violet" | "amber";
}) {
  return (
    <button onClick={onChange} className={cn(
      "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium border transition-all",
      checked
        ? color === "violet"
          ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
          : "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : "bg-white/[0.02] text-muted-foreground border-white/[0.08] hover:text-foreground",
    )}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", checked && (color === "violet" ? "text-violet-400" : "text-amber-400"))} />
      {label}
    </button>
  );
}

function SectionHead({ icon: Icon, label, count, color }: {
  icon: React.ElementType; label: string; count?: number; color: string;
}) {
  const colorKey = color.includes("violet") ? "violet" : color.includes("amber") ? "amber" :
    color.includes("emerald") ? "emerald" : color.includes("red") ? "red" :
    color.includes("green") ? "green" : color.includes("sky") ? "sky" : "blue";
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className={cn("h-4 w-4", color)} />
      <span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      {!!count && <Count n={count} color={colorKey} />}
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/[0.06] px-4 py-4 flex items-center gap-3 text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0 opacity-40" />
      <p className="text-xs">{text}</p>
    </div>
  );
}

function AllClear({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <CheckCircle2 className="h-9 w-9 text-emerald-400/50" />
      <p className="text-sm font-semibold text-emerald-300">All clear</p>
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

// Fix #3: error card
function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 py-4 flex items-center gap-3">
      <XCircle className="h-4 w-4 text-red-400 shrink-0" />
      <div>
        <p className="text-xs font-semibold text-red-300">Failed to load briefing data</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{message}</p>
      </div>
    </div>
  );
}

function NewPill() {
  return (
    <span className="rounded-full bg-violet-500/25 text-violet-300 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide animate-pulse">
      New
    </span>
  );
}

// Fix #14: "X more" overflow notice
function MoreNotice({ total, shown, noun }: { total: number; shown: number; noun: string }) {
  if (total <= shown) return null;
  return (
    <p className="text-[11px] text-muted-foreground/60 px-4 pt-1.5">
      + {total - shown} more {noun} not shown
    </p>
  );
}

function LiveIndicator({ lastUpdated, loading }: { lastUpdated: Date | null; loading: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin text-violet-400" />
      ) : (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
        </span>
      )}
      <span className={cn("font-medium", loading ? "text-violet-400" : "text-emerald-400")}>
        {loading ? "Checking…" : "Live"}
      </span>
      {lastUpdated && !loading && (
        <span className="text-muted-foreground">· <RelativeTime date={lastUpdated} short /></span>
      )}
    </div>
  );
}

// ── Dropdown ───────────────────────────────────────────────────────────────────
function Dropdown<T extends string | number>({ value, options, onChange, renderLabel }: {
  value: T; options: T[]; onChange: (v: T) => void; renderLabel: (v: T) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(p => !p)} className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-foreground hover:bg-white/[0.06]">
        {renderLabel(value)} <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-30 min-w-[120px] rounded-xl border border-white/[0.08] bg-card shadow-xl overflow-hidden">
          {options.map((o, i) => (
            <button key={i} className={cn(
              "w-full px-3 py-2 text-left text-xs hover:bg-white/[0.04] whitespace-nowrap",
              o === value && "text-violet-400 font-medium"
            )} onClick={() => { onChange(o); setOpen(false); }}>
              {renderLabel(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Event notification strip for overview ─────────────────────────────────────
function OverviewEventStrip({ events, onMarkRead }: { events: HiveMindEvent[]; onMarkRead: () => void }) {
  const unread = events.filter(e => !e.is_read);
  const [dismissed, setDismissed] = useState(false);
  if (!unread.length || dismissed) return null;
  const hasCritical = unread.some(e => e.severity === "critical");
  const hasWarning  = unread.some(e => e.severity === "warning");
  const color = hasCritical ? "border-red-500/30 bg-red-500/[0.05]" : hasWarning ? "border-amber-500/30 bg-amber-500/[0.05]" : "border-violet-500/20 bg-violet-500/[0.04]";
  const iconColor = hasCritical ? "text-red-400" : hasWarning ? "text-amber-400" : "text-violet-400";
  return (
    <div className={cn("rounded-xl border px-4 py-3 flex items-start gap-3", color)}>
      <Bell className={cn("h-4 w-4 shrink-0 mt-0.5", iconColor)} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold">
          HiveMind detected {unread.length} new issue{unread.length !== 1 ? "s" : ""}
        </p>
        <ul className="mt-1.5 space-y-0.5">
          {unread.slice(0, 3).map(ev => (
            <li key={ev.id} className="text-[11px] text-muted-foreground">
              • {ev.title}
            </li>
          ))}
          {unread.length > 3 && (
            <li className="text-[11px] text-muted-foreground">• +{unread.length - 3} more</li>
          )}
        </ul>
        <div className="flex items-center gap-3 mt-2">
          <Link to="/hivemind/tasks" className={cn("text-[11px] font-medium hover:underline", iconColor)}>
            View tasks →
          </Link>
          <button onClick={onMarkRead} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            Mark read
          </button>
        </div>
      </div>
      <button onClick={() => setDismissed(true)} className="p-0.5 text-muted-foreground hover:text-foreground transition-colors shrink-0">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
function HiveMindOverview() {
  const mode       = useHiveMindMode();
  const briefingFn = useServerFn(getHiveMindBriefing);
  const platformFn = useServerFn(getHiveMindPlatformData);
  const scanFn     = useServerFn(runHiveMindScan);
  const getTasksFn = useServerFn(getHiveMindTasksAndEvents);
  const markReadFn = useServerFn(markHiveMindEventsRead);

  const [prefs, setPrefs]       = useState<BriefingPrefs>(DEFAULT_PREFS);
  const [staleDays, setStaleDays] = useState(7);
  const [sinceHours, setSinceHours] = useState(24); // Fix #6: sinceHours restored
  const [configOpen, setConfigOpen] = useState(false);
  const [activeTab, setActiveTab]   = useState<"business" | "system">("business");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Fix #13: dismissed stale IDs (snooze for 7 days)
  const [dismissed, setDismissed] = useState<Record<string, number>>({});

  const prevLeadIds    = useRef<Set<string>>(new Set());
  const prevBookingIds = useRef<Set<string>>(new Set());
  const [newLeadIds,    setNewLeadIds]    = useState<Set<string>>(new Set());
  const [newBookingIds, setNewBookingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const p = localStorage.getItem("hivemind-briefing-prefs");
      if (p) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(p) });
      const sd = localStorage.getItem("hivemind-stale-days");
      if (sd) setStaleDays(Number(sd));
      const sh = localStorage.getItem("hivemind-since-hours");
      if (sh) setSinceHours(Number(sh));
    } catch {}
    setDismissed(loadDismissed());
  }, []);

  function savePrefs(next: BriefingPrefs) {
    setPrefs(next);
    try { localStorage.setItem("hivemind-briefing-prefs", JSON.stringify(next)); } catch {}
  }
  function togglePref(key: keyof BriefingPrefs) { savePrefs({ ...prefs, [key]: !prefs[key] }); }

  function dismissStale(id: string) {
    const next = { ...dismissed, [id]: Date.now() };
    setDismissed(next);
    saveDismissed(next);
  }

  // Fix #6: since is computed inside queryFn so it's fresh on every refetch
  const briefingQ = useQuery({
    queryKey: ["hivemind-briefing-live", staleDays, sinceHours],
    queryFn: async () => {
      const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
      return briefingFn({ data: { since, staleDays } });
    },
    staleTime: 0,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const platformQ = useQuery({
    queryKey: ["hivemind-platform"],
    queryFn: () => platformFn(),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });

  // Tasks + events query (for notification strip)
  const tasksQ = useQuery({
    queryKey: ["hivemind-tasks"],
    queryFn: () => getTasksFn(),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  // Auto-scan once on mount (fire-and-forget, refresh tasks after)
  useEffect(() => {
    let mounted = true;
    scanFn().then(() => { if (mounted) tasksQ.refetch(); }).catch(() => {});
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleMarkEventsRead() {
    await markReadFn({ data: {} });
    tasksQ.refetch();
  }

  // Detect newly arrived items between fetches
  useEffect(() => {
    if (!briefingQ.data) return;
    const arrivedLeads = briefingQ.data.newLeads
      .filter((l: any) => prevLeadIds.current.size > 0 && !prevLeadIds.current.has(l.id))
      .map((l: any) => l.id);
    const arrivedBks = briefingQ.data.newBookings
      .filter((b: any) => prevBookingIds.current.size > 0 && !prevBookingIds.current.has(b.id))
      .map((b: any) => b.id);

    if (arrivedLeads.length) setNewLeadIds(new Set(arrivedLeads));
    if (arrivedBks.length)   setNewBookingIds(new Set(arrivedBks));

    prevLeadIds.current    = new Set(briefingQ.data.newLeads.map((l: any) => l.id));
    prevBookingIds.current = new Set(briefingQ.data.newBookings.map((b: any) => b.id));
    setLastUpdated(new Date());

    const t = setTimeout(() => { setNewLeadIds(new Set()); setNewBookingIds(new Set()); }, 10_000);
    return () => clearTimeout(t);
  }, [briefingQ.data]);

  const sysRecs   = generateRecommendations(platformQ.data);
  const sysIssues = sysRecs.filter(r => r.priority === "critical" || r.priority === "high");
  const b = briefingQ.data;

  // Fix #13: filter dismissed stale clients
  const visibleStale = (b?.staleClients ?? []).filter((c: any) => !dismissed[c.id]);

  const sinceLabel = SINCE_OPTIONS.find(o => o.hours === sinceHours)?.label ?? "Last 24 hours";

  const businessCount =
    (prefs.newLeads     ? (b?.newLeads?.length             ?? 0) : 0) +
    (prefs.newBookings  ? (b?.newBookings?.length           ?? 0) : 0) +
    (prefs.staleClients ? visibleStale.length                        : 0) +
    (prefs.pipeline     ? (b?.recentPipelineChanges?.length ?? 0) : 0) +
    (prefs.whatsapp     ? (b?.inboundWA?.length             ?? 0) : 0) +
    (prefs.email        ? (b?.recentEmailCampaigns?.length  ?? 0) : 0);

  const systemCount = prefs.systemIssues ? sysIssues.length : 0;
  const isFetching  = briefingQ.isFetching || platformQ.isFetching;

  return (
    <HiveMindShell>
      <div className="px-6 py-5 max-w-4xl space-y-5">

        {/* HEADER */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5 mb-0.5">
              <h1 className="text-lg font-semibold">Live Briefing</h1>
              <LiveIndicator lastUpdated={lastUpdated} loading={isFetching} />
            </div>
            <p className="text-xs text-muted-foreground">
              Watching {sinceLabel.toLowerCase()} · auto-refreshes every 90s
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/hivemind/chat"
              className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/[0.06] px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-500/15 hover:text-violet-200 transition-colors"
            >
              <Brain className="h-3.5 w-3.5" />
              Activate HiveMind
            </Link>
            <Button variant="outline" size="sm" onClick={() => { briefingQ.refetch(); platformQ.refetch(); }} disabled={isFetching}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
              Refresh now
            </Button>
          </div>
        </div>

        {/* EVENT NOTIFICATIONS */}
        {tasksQ.data?.events && tasksQ.data.events.length > 0 && (
          <OverviewEventStrip
            events={tasksQ.data.events}
            onMarkRead={handleMarkEventsRead}
          />
        )}

        {/* EXECUTIVE BRIEFING BANNER */}
        <Link
          to="/hivemind/briefing"
          className="flex items-center gap-3 rounded-xl border border-violet-500/20 bg-gradient-to-r from-violet-500/[0.07] to-transparent px-4 py-3 hover:from-violet-500/[0.12] transition-all group"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 ring-1 ring-violet-500/30 shrink-0">
            <Newspaper className="h-4 w-4 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-violet-200">Executive Briefing</p>
            <p className="text-[11px] text-violet-400/60 mt-0.5">
              Monthly stats · lead velocity · costs · risks · recommendations
            </p>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-violet-400/60 group-hover:text-violet-300 transition-colors shrink-0">
            View briefing
            <ArrowRight className="h-3 w-3" />
          </div>
        </Link>

        {/* CONFIGURE PANEL */}
        <div className="rounded-xl border border-white/[0.07] bg-card/50 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
            onClick={() => setConfigOpen(p => !p)}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Settings2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-muted-foreground shrink-0">What to watch</span>
              <span className="text-[10px] text-muted-foreground/50 truncate">
                ({[
                  prefs.newLeads     && "Leads",
                  prefs.newBookings  && "Bookings",
                  prefs.staleClients && `Stale (${staleDays}d)`,
                  prefs.pipeline     && "Pipeline",
                  prefs.whatsapp     && "WhatsApp",
                  prefs.email        && "Email",
                  prefs.systemIssues && "System",
                ].filter(Boolean).join(" · ")})
              </span>
            </div>
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", !configOpen && "-rotate-90")} />
          </button>

          {configOpen && (
            <div className="border-t border-white/[0.06] px-4 pb-4 pt-3 space-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-400/70 mb-2">Business</p>
                <div className="flex flex-wrap gap-2">
                  <Toggle label="New Leads"        checked={prefs.newLeads}     onChange={() => togglePref("newLeads")}     icon={Users}         color="violet" />
                  <Toggle label="New Bookings"      checked={prefs.newBookings}  onChange={() => togglePref("newBookings")}  icon={CalendarCheck} color="violet" />
                  <Toggle label="Stale Pipeline"    checked={prefs.staleClients} onChange={() => togglePref("staleClients")} icon={Timer}         color="violet" />
                  <Toggle label="Pipeline Activity" checked={prefs.pipeline}     onChange={() => togglePref("pipeline")}     icon={ArrowRight}    color="violet" />
                  <Toggle label="WhatsApp"          checked={prefs.whatsapp}     onChange={() => togglePref("whatsapp")}     icon={MessageSquare} color="violet" />
                  <Toggle label="Email Campaigns"   checked={prefs.email}        onChange={() => togglePref("email")}        icon={MailOpen}      color="violet" />
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-400/70 mb-2">System</p>
                <div className="flex flex-wrap gap-2">
                  <Toggle label="Platform Issues" checked={prefs.systemIssues} onChange={() => togglePref("systemIssues")} icon={AlertTriangle} color="amber" />
                </div>
              </div>

              {/* Fix #6: time window + stale threshold controls */}
              <div className="flex items-center gap-4 flex-wrap border-t border-white/[0.05] pt-2.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>Window:</span>
                  <Dropdown
                    value={sinceHours}
                    options={SINCE_OPTIONS.map(o => o.hours)}
                    onChange={h => { setSinceHours(h); try { localStorage.setItem("hivemind-since-hours", String(h)); } catch {} }}
                    renderLabel={h => SINCE_OPTIONS.find(o => o.hours === h)?.label ?? "Last 24h"}
                  />
                </div>
                {prefs.staleClients && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Timer className="h-3 w-3" />
                    <span>Stale after:</span>
                    <Dropdown
                      value={staleDays}
                      options={STALE_OPTIONS}
                      onChange={d => { setStaleDays(d); try { localStorage.setItem("hivemind-stale-days", String(d)); } catch {} }}
                      renderLabel={d => `${d} days`}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Fix #3: error states */}
        {briefingQ.isError && <ErrorCard message={String((briefingQ.error as any)?.message ?? "Unknown error")} />}
        {platformQ.isError && <ErrorCard message={String((platformQ.error as any)?.message ?? "Could not load platform data")} />}

        {/* Initial load */}
        {briefingQ.isLoading && !b && (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
            <span className="text-sm">Scanning your platform…</span>
          </div>
        )}

        {/* CONTENT */}
        {(b || platformQ.data) && !briefingQ.isError && (
          <div className="space-y-4">

            {/* Tabs */}
            <div className="flex gap-1 border-b border-white/[0.06]">
              {([
                ["business", "Business", businessCount, "violet"],
                ["system",   "System",   systemCount,   "amber"],
              ] as const).map(([id, label, cnt, color]) => (
                <button key={id} onClick={() => setActiveTab(id)} className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                  activeTab === id
                    ? color === "violet" ? "border-violet-400 text-foreground" : "border-amber-400 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}>
                  {label}
                  {cnt > 0 && <Count n={cnt} color={color} />}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground/50 py-2 shrink-0">
                <Clock className="h-3 w-3" />
                {lastUpdated ? <RelativeTime date={lastUpdated} short /> : "Checking…"}
              </div>
            </div>

            {/* ── BUSINESS ── */}
            {activeTab === "business" && (
              <div className="space-y-5">

                {/* NEW LEADS */}
                {prefs.newLeads && (
                  <section>
                    <SectionHead icon={Users} label={`New Leads (${sinceLabel.toLowerCase()})`} count={b?.newLeads?.length} color="text-violet-400" />
                    {!b?.newLeads?.length ? (
                      <EmptyState icon={Users} text={`No new leads ${sinceLabel.toLowerCase()}`} />
                    ) : (
                      <>
                        <div className="rounded-xl border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04]">
                          {b.newLeads.map((lead: any) => (
                            <div key={lead.id} className={cn(
                              "flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.015] transition-colors",
                              newLeadIds.has(lead.id) && "bg-violet-500/[0.06]"
                            )}>
                              <div className="h-7 w-7 rounded-full bg-violet-500/15 flex items-center justify-center shrink-0 text-xs font-bold text-violet-300">
                                {(lead.name || "?")[0]?.toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-xs font-semibold">{lead.name}</p>
                                  {newLeadIds.has(lead.id) && <NewPill />}
                                </div>
                                <p className="text-[11px] text-muted-foreground">{fmtStatus(lead.status)}{lead.phone ? " · " + lead.phone : ""}</p>
                              </div>
                              <span className="text-[10px] text-muted-foreground shrink-0"><RelativeTime date={lead.created_at} short /></span>
                              <Button asChild size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0">
                                <Link to="/leads"><ArrowRight className="h-3 w-3" /></Link>
                              </Button>
                            </div>
                          ))}
                        </div>
                        {/* Fix #14: overflow notice */}
                        <MoreNotice total={b.newLeads.length} shown={50} noun="leads" />
                      </>
                    )}
                  </section>
                )}

                {/* NEW BOOKINGS */}
                {prefs.newBookings && (
                  <section>
                    <SectionHead icon={CalendarCheck} label={`New Bookings (${sinceLabel.toLowerCase()})`} count={b?.newBookings?.length} color="text-emerald-400" />
                    {!b?.newBookings?.length ? (
                      <EmptyState icon={CalendarCheck} text={`No new bookings ${sinceLabel.toLowerCase()}`} />
                    ) : (
                      <>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {b.newBookings.map((bk: any) => (
                            <div key={bk.id} className={cn(
                              "rounded-xl border p-3.5 transition-colors",
                              newBookingIds.has(bk.id)
                                ? "border-violet-500/30 bg-violet-500/[0.07]"
                                : "border-emerald-500/15 bg-emerald-500/[0.03]",
                            )}>
                              <div className="flex items-start justify-between gap-2 mb-1.5">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-sm font-semibold leading-snug">{bk.title}</p>
                                  {newBookingIds.has(bk.id) && <NewPill />}
                                </div>
                                <span className={cn(
                                  "rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize shrink-0",
                                  bk.status === "confirmed" ? "bg-emerald-500/15 text-emerald-400" :
                                  bk.status === "cancelled" ? "bg-red-500/15 text-red-400" :
                                  "bg-white/[0.05] text-muted-foreground"
                                )}>{bk.status ?? "booked"}</span>
                              </div>
                              {bk.attendee_name && (
                                <p className="text-xs mb-1">
                                  <span className="font-medium">{bk.attendee_name}</span>
                                  {bk.attendee_email && <span className="text-muted-foreground ml-1">· {bk.attendee_email}</span>}
                                </p>
                              )}
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                                <CalendarCheck className="h-3 w-3 text-emerald-400 shrink-0" />
                                {bk.start_at ? fmtDateTime(bk.start_at) : "Time TBC"}
                              </div>
                              {bk.agent_name && (
                                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <Bot className="h-3 w-3 text-violet-400 shrink-0" />
                                  Booked by {bk.agent_name}
                                </div>
                              )}
                              {bk.notes && (
                                <p className="text-[11px] text-muted-foreground/70 mt-1.5 italic border-t border-white/[0.04] pt-1.5 line-clamp-2">{bk.notes}</p>
                              )}
                            </div>
                          ))}
                        </div>
                        <MoreNotice total={b.newBookings.length} shown={20} noun="bookings" />
                      </>
                    )}
                  </section>
                )}

                {/* STALE PIPELINE */}
                {prefs.staleClients && (
                  <section>
                    <SectionHead icon={Timer} label={`Stale Clients (${staleDays}+ days no movement)`} count={visibleStale.length} color="text-amber-400" />
                    {!visibleStale.length ? (
                      <EmptyState icon={Timer} text={
                        (b?.staleClients?.length ?? 0) > 0
                          ? "All stale clients dismissed — they'll reappear in 7 days"
                          : `No clients stuck for ${staleDays}+ days — pipeline is moving`
                      } />
                    ) : (
                      <>
                        <div className="rounded-xl border border-amber-500/15 overflow-hidden divide-y divide-white/[0.04]">
                          {visibleStale.map((c: any) => (
                            <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.015] group">
                              <div className="h-7 w-7 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 text-xs font-bold text-amber-300">
                                {(c.name || "?")[0]?.toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold">{c.name}</p>
                                <p className="text-[11px] text-muted-foreground">{fmtStatus(c.status)}{c.pipeline_stage ? " · " + fmtStatus(c.pipeline_stage) : ""}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className={cn("text-xs font-bold tabular-nums", c.days > staleDays * 2 ? "text-red-400" : "text-amber-400")}>
                                  {c.days}d idle
                                </p>
                                <p className="text-[10px] text-muted-foreground">{c.phone ?? c.email ?? ""}</p>
                              </div>
                              {/* Fix #13: dismiss button */}
                              <button
                                onClick={() => dismissStale(c.id)}
                                title="Snooze for 7 days"
                                className="h-6 w-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] transition-all shrink-0"
                              >
                                <EyeOff className="h-3 w-3 text-muted-foreground" />
                              </button>
                              <Button asChild size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0">
                                <Link to="/pipeline"><ArrowRight className="h-3 w-3" /></Link>
                              </Button>
                            </div>
                          ))}
                        </div>
                        <MoreNotice total={b?.staleClients?.length ?? 0} shown={30} noun="stale clients" />
                        {dismissed && Object.keys(dismissed).length > 0 && (
                          <button
                            onClick={() => { setDismissed({}); saveDismissed({}); }}
                            className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground mt-1.5 block"
                          >
                            Clear all dismissed ({Object.keys(dismissed).length})
                          </button>
                        )}
                      </>
                    )}
                  </section>
                )}

                {/* PIPELINE ACTIVITY */}
                {prefs.pipeline && (
                  <section>
                    <SectionHead icon={Zap} label={`Pipeline Activity (${sinceLabel.toLowerCase()})`} count={b?.recentPipelineChanges?.length} color="text-blue-400" />
                    {!b?.recentPipelineChanges?.length ? (
                      <EmptyState icon={Zap} text={`No pipeline changes ${sinceLabel.toLowerCase()}`} />
                    ) : (
                      <>
                        <div className="rounded-xl border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04]">
                          {b.recentPipelineChanges.map((c: any) => (
                            <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.015]">
                              <div className="h-7 w-7 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                                <Zap className="h-3.5 w-3.5 text-blue-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold">{c.name}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {fmtStatus(c.status)}{c.pipeline_stage ? " · " + fmtStatus(c.pipeline_stage) : ""}
                                </p>
                              </div>
                              <span className="text-[10px] text-muted-foreground shrink-0"><RelativeTime date={c.updated_at} short /></span>
                              <Button asChild size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0">
                                <Link to="/pipeline"><ArrowRight className="h-3 w-3" /></Link>
                              </Button>
                            </div>
                          ))}
                        </div>
                        <MoreNotice total={b.recentPipelineChanges.length} shown={20} noun="changes" />
                      </>
                    )}
                  </section>
                )}

                {/* WHATSAPP — Fix #12: show actual message previews */}
                {prefs.whatsapp && (
                  <section>
                    <SectionHead icon={MessageSquare} label={`WhatsApp Inbound (${sinceLabel.toLowerCase()})`} count={b?.inboundWA?.length || undefined} color="text-green-400" />
                    {!b?.inboundWA?.length ? (
                      <EmptyState icon={MessageSquare} text={`No new inbound WhatsApp messages ${sinceLabel.toLowerCase()}`} />
                    ) : (
                      <div className="rounded-xl border border-green-500/15 overflow-hidden divide-y divide-white/[0.04]">
                        {b.inboundWA.map((m: any) => (
                          <div key={m.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-white/[0.015]">
                            <div className="h-7 w-7 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                              <MessageSquare className="h-3.5 w-3.5 text-green-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold">{m.contact_name ?? m.contact_phone ?? "Unknown"}</p>
                              {m.contact_name && m.contact_phone && (
                                <p className="text-[10px] text-muted-foreground">{m.contact_phone}</p>
                              )}
                              {m.body && (
                                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 italic">"{m.body}"</p>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              <span className="text-[10px] text-muted-foreground"><RelativeTime date={m.sent_at} short /></span>
                              <div className="mt-1">
                                <Button asChild size="sm" variant="ghost" className="h-6 w-6 p-0">
                                  <Link to="/whatsapp"><ArrowRight className="h-3 w-3" /></Link>
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                        {(b.newInboundWA ?? 0) > b.inboundWA.length && (
                          <div className="px-4 py-2.5 flex items-center justify-between">
                            <p className="text-[11px] text-muted-foreground">+ {b.newInboundWA - b.inboundWA.length} more messages</p>
                            <Button asChild size="sm" variant="outline" className="h-6 text-xs">
                              <Link to="/whatsapp">Open all →</Link>
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}

                {/* EMAIL CAMPAIGNS — Fix #11 */}
                {prefs.email && (
                  <section>
                    <SectionHead icon={MailOpen} label={`Email Campaign Activity (${sinceLabel.toLowerCase()})`} count={b?.recentEmailCampaigns?.length} color="text-sky-400" />
                    {!b?.recentEmailCampaigns?.length ? (
                      <EmptyState icon={MailOpen} text={`No email campaign activity ${sinceLabel.toLowerCase()}`} />
                    ) : (
                      <div className="rounded-xl border border-sky-500/10 overflow-hidden divide-y divide-white/[0.04]">
                        {b.recentEmailCampaigns.map((c: any) => (
                          <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.015]">
                            <div className="h-7 w-7 rounded-full bg-sky-500/10 flex items-center justify-center shrink-0">
                              <MailOpen className="h-3.5 w-3.5 text-sky-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-semibold">{c.name}</p>
                                {c.isNew && <NewPill />}
                              </div>
                              <p className="text-[11px] text-muted-foreground">{fmtStatus(c.status)}</p>
                            </div>
                            <span className="text-[10px] text-muted-foreground shrink-0"><RelativeTime date={c.updated_at} short /></span>
                            <Button asChild size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0">
                              <Link to="/campaigns"><ArrowRight className="h-3 w-3" /></Link>
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {businessCount === 0 && !briefingQ.isLoading && (
                  <AllClear text={`Nothing new across leads, bookings or pipeline ${sinceLabel.toLowerCase()}.`} />
                )}
              </div>
            )}

            {/* ── SYSTEM ── */}
            {activeTab === "system" && (
              <div className="space-y-3">
                {!prefs.systemIssues ? (
                  <EmptyState icon={Settings2} text='System Issues are off — enable in "What to watch" above.' />
                ) : platformQ.isLoading && !sysIssues.length ? (
                  <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                    <span className="text-sm">Checking platform…</span>
                  </div>
                ) : sysIssues.length === 0 ? (
                  <AllClear text="No critical or high-priority system issues detected." />
                ) : (
                  <>
                    {sysIssues.map(r => (
                      <div key={r.id} className={cn(
                        "rounded-xl border px-4 py-3.5 flex items-start gap-3",
                        r.priority === "critical" ? "border-red-500/20 bg-red-500/[0.03]" : "border-amber-500/15 bg-amber-500/[0.03]",
                      )}>
                        <AlertTriangle className={cn("h-4 w-4 shrink-0 mt-0.5", r.priority === "critical" ? "text-red-400" : "text-amber-400")} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                              r.priority === "critical" ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"
                            )}>{r.priority}</span>
                            <span className="text-[10px] text-muted-foreground bg-white/[0.04] rounded px-1.5 py-0.5">{r.category}</span>
                          </div>
                          <p className="text-sm font-semibold">{r.problem}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{r.fix}</p>
                        </div>
                        {r.action && (
                          <Button asChild size="sm" variant="outline" className="h-7 text-xs shrink-0">
                            <Link to={r.action.href}>{r.action.label} →</Link>
                          </Button>
                        )}
                      </div>
                    ))}
                    <div className="flex justify-end">
                      <Button asChild size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground">
                        <Link to="/hivemind/recommendations">View all recommendations →</Link>
                      </Button>
                    </div>
                  </>
                )}

                {/* Provider Health */}
                <HiveMindProviderHealth />
              </div>
            )}
          </div>
        )}
      </div>
    </HiveMindShell>
  );
}
