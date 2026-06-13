import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useRef } from "react";
import {
  Users, CalendarCheck, MessageSquare, AlertTriangle,
  CheckCircle2, Loader2, RefreshCw, Clock,
  ChevronDown, Settings2, ArrowRight, Timer, Bot,
  Zap, Radio, Bell, Circle,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import { getHiveMindBriefing, getHiveMindPlatformData } from "@/lib/hivemind/hivemind.functions";
import { generateRecommendations } from "@/lib/hivemind/recommendations";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/hivemind")({
  head: () => ({ meta: [{ title: "HiveMind — Webee" }] }),
  component: HiveMindOverview,
});

// ── Prefs ──────────────────────────────────────────────────────────────────────
type BriefingPrefs = {
  newLeads: boolean; newBookings: boolean; staleClients: boolean;
  pipeline: boolean; whatsapp: boolean; systemIssues: boolean;
};
const DEFAULT_PREFS: BriefingPrefs = {
  newLeads: true, newBookings: true, staleClients: true,
  pipeline: true, whatsapp: true, systemIssues: true,
};
const STALE_OPTIONS = [3, 5, 7, 10, 14, 30];
const REFRESH_INTERVAL = 90_000; // 90s live polling

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtRelative(isoStr: string) {
  const mins = Math.round((Date.now() - new Date(isoStr).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
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

// ── Sub-components ─────────────────────────────────────────────────────────────
function Count({ n, color = "violet" }: { n: number; color?: string }) {
  const cls: Record<string, string> = {
    violet: "bg-violet-500/20 text-violet-300",
    amber:  "bg-amber-500/20 text-amber-300",
    emerald:"bg-emerald-500/20 text-emerald-300",
    red:    "bg-red-500/20 text-red-300",
    blue:   "bg-blue-500/20 text-blue-300",
    green:  "bg-green-500/20 text-green-300",
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
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className={cn("h-4 w-4", color)} />
      <span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      {!!count && <Count n={count} color={
        color.includes("violet") ? "violet" : color.includes("amber") ? "amber" :
        color.includes("emerald") ? "emerald" : color.includes("red") ? "red" :
        color.includes("green") ? "green" : "blue"
      } />}
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

// ── NEW pill ───────────────────────────────────────────────────────────────────
function NewPill() {
  return (
    <span className="rounded-full bg-violet-500/25 text-violet-300 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide animate-pulse">
      New
    </span>
  );
}

// ── Live indicator ─────────────────────────────────────────────────────────────
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
        <span className="text-muted-foreground">· updated {fmtRelative(lastUpdated.toISOString())}</span>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
function HiveMindOverview() {
  const briefingFn = useServerFn(getHiveMindBriefing);
  const platformFn = useServerFn(getHiveMindPlatformData);

  const [prefs, setPrefs] = useState<BriefingPrefs>(DEFAULT_PREFS);
  const [staleDays, setStaleDays] = useState(7);
  const [staleDropOpen, setStaleDropOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"business" | "system">("business");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Track IDs seen before latest fetch to highlight truly new items
  const prevLeadIds = useRef<Set<string>>(new Set());
  const prevBookingIds = useRef<Set<string>>(new Set());
  const [newLeadIds, setNewLeadIds] = useState<Set<string>>(new Set());
  const [newBookingIds, setNewBookingIds] = useState<Set<string>>(new Set());

  // Load prefs from localStorage (client-only)
  useEffect(() => {
    try {
      const p = localStorage.getItem("hivemind-briefing-prefs");
      if (p) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(p) });
      const sd = localStorage.getItem("hivemind-stale-days");
      if (sd) setStaleDays(Number(sd));
    } catch {}
  }, []);

  function savePrefs(next: BriefingPrefs) {
    setPrefs(next);
    try { localStorage.setItem("hivemind-briefing-prefs", JSON.stringify(next)); } catch {}
  }
  function togglePref(key: keyof BriefingPrefs) { savePrefs({ ...prefs, [key]: !prefs[key] }); }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // ── LIVE briefing query — always on, refetches every 90s ──
  const briefingQ = useQuery({
    queryKey: ["hivemind-briefing-live", staleDays],
    queryFn: async () => {
      const result = await briefingFn({ data: { since: since24h, staleDays } });
      return result;
    },
    staleTime: 0,
    refetchInterval: REFRESH_INTERVAL,
    refetchIntervalInBackground: false,
  });

  const platformQ = useQuery({
    queryKey: ["hivemind-data"],
    queryFn: () => platformFn(),
    staleTime: 60_000,
    refetchInterval: REFRESH_INTERVAL,
  });

  // Detect newly arrived items between fetches
  useEffect(() => {
    if (!briefingQ.data) return;
    const newIds = briefingQ.data.newLeads
      .filter((l: any) => !prevLeadIds.current.has(l.id))
      .map((l: any) => l.id);
    const newBIds = briefingQ.data.newBookings
      .filter((b: any) => !prevBookingIds.current.has(b.id))
      .map((b: any) => b.id);

    // Only animate "new" if we have a previous fetch to compare to
    if (prevLeadIds.current.size > 0 && newIds.length > 0) setNewLeadIds(new Set(newIds));
    if (prevBookingIds.current.size > 0 && newBIds.length > 0) setNewBookingIds(new Set(newBIds));

    prevLeadIds.current   = new Set(briefingQ.data.newLeads.map((l: any) => l.id));
    prevBookingIds.current = new Set(briefingQ.data.newBookings.map((b: any) => b.id));
    setLastUpdated(new Date());

    // Clear "new" badges after 10s
    const t = setTimeout(() => {
      setNewLeadIds(new Set());
      setNewBookingIds(new Set());
    }, 10_000);
    return () => clearTimeout(t);
  }, [briefingQ.data]);

  const sysRecs   = generateRecommendations(platformQ.data);
  const sysIssues = sysRecs.filter(r => r.priority === "critical" || r.priority === "high");
  const b = briefingQ.data;

  const businessCount =
    (prefs.newLeads     ? (b?.newLeads?.length            ?? 0) : 0) +
    (prefs.newBookings  ? (b?.newBookings?.length          ?? 0) : 0) +
    (prefs.staleClients ? (b?.staleClients?.length         ?? 0) : 0) +
    (prefs.pipeline     ? (b?.recentPipelineChanges?.length ?? 0) : 0) +
    (prefs.whatsapp     ? (b?.newInboundWA                 ?? 0) : 0);

  const systemCount = prefs.systemIssues ? sysIssues.length : 0;
  const isLoading   = briefingQ.isLoading || platformQ.isLoading;

  return (
    <HiveMindShell>
      <div className="px-6 py-5 max-w-4xl space-y-5">

        {/* ── HEADER ── */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5 mb-0.5">
              <h1 className="text-lg font-semibold">Live Briefing</h1>
              <LiveIndicator lastUpdated={lastUpdated} loading={briefingQ.isFetching || platformQ.isFetching} />
            </div>
            <p className="text-xs text-muted-foreground">
              Watching for new leads, bookings, pipeline changes and system issues · auto-refreshes every 90s
            </p>
          </div>
          <Button
            variant="outline" size="sm"
            onClick={() => { briefingQ.refetch(); platformQ.refetch(); }}
            disabled={briefingQ.isFetching || platformQ.isFetching}
          >
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", (briefingQ.isFetching || platformQ.isFetching) && "animate-spin")} />
            Refresh now
          </Button>
        </div>

        {/* ── CONFIGURE PANEL (collapsible) ── */}
        <div className="rounded-xl border border-white/[0.07] bg-card/50 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
            onClick={() => setConfigOpen(p => !p)}
          >
            <div className="flex items-center gap-2">
              <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">What to watch</span>
              <span className="text-[10px] text-muted-foreground/50">
                ({[
                  prefs.newLeads && "Leads",
                  prefs.newBookings && "Bookings",
                  prefs.staleClients && `Stale (${staleDays}d)`,
                  prefs.pipeline && "Pipeline",
                  prefs.whatsapp && "WhatsApp",
                  prefs.systemIssues && "System",
                ].filter(Boolean).join(" · ")})
              </span>
            </div>
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !configOpen && "-rotate-90")} />
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
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-400/70 mb-2">System</p>
                <div className="flex flex-wrap gap-2">
                  <Toggle label="Platform Issues" checked={prefs.systemIssues} onChange={() => togglePref("systemIssues")} icon={AlertTriangle} color="amber" />
                </div>
              </div>
              {prefs.staleClients && (
                <div className="flex items-center gap-2 border-t border-white/[0.05] pt-2.5">
                  <Timer className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Client is stale after</span>
                  <div className="relative">
                    <button
                      onClick={() => setStaleDropOpen(p => !p)}
                      className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-foreground"
                    >
                      {staleDays} days <ChevronDown className="h-3 w-3" />
                    </button>
                    {staleDropOpen && (
                      <div className="absolute left-0 top-8 z-20 w-24 rounded-xl border border-white/[0.08] bg-card shadow-xl overflow-hidden">
                        {STALE_OPTIONS.map(d => (
                          <button key={d} className={cn(
                            "w-full px-3 py-2 text-left text-xs hover:bg-white/[0.04]",
                            d === staleDays && "text-violet-400 font-medium"
                          )} onClick={() => {
                            setStaleDays(d);
                            setStaleDropOpen(false);
                            try { localStorage.setItem("hivemind-stale-days", String(d)); } catch {}
                          }}>
                            {d} days
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">with no pipeline movement</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── LOADING STATE ── */}
        {isLoading && !b && (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
            <span className="text-sm">Scanning your platform…</span>
          </div>
        )}

        {/* ── CONTENT ── */}
        {(b || platformQ.data) && (
          <div className="space-y-4">

            {/* Tabs */}
            <div className="flex gap-1 border-b border-white/[0.06] pb-0">
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
              {/* Refresh badge */}
              <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground/50 py-2">
                <Clock className="h-3 w-3" />
                {lastUpdated ? `Checked ${fmtRelative(lastUpdated.toISOString())}` : "Checking…"}
              </div>
            </div>

            {/* ─── BUSINESS ─── */}
            {activeTab === "business" && (
              <div className="space-y-5">

                {/* NEW LEADS */}
                {prefs.newLeads && (
                  <section>
                    <SectionHead icon={Users} label="New Leads (last 24h)" count={b?.newLeads?.length} color="text-violet-400" />
                    {!b?.newLeads?.length ? (
                      <EmptyState icon={Users} text="No new leads in the last 24 hours" />
                    ) : (
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
                            <span className="text-[10px] text-muted-foreground shrink-0">{fmtRelative(lead.created_at)}</span>
                            <Button asChild size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0">
                              <Link to="/leads"><ArrowRight className="h-3 w-3" /></Link>
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {/* NEW BOOKINGS */}
                {prefs.newBookings && (
                  <section>
                    <SectionHead icon={CalendarCheck} label="New Bookings (last 24h)" count={b?.newBookings?.length} color="text-emerald-400" />
                    {!b?.newBookings?.length ? (
                      <EmptyState icon={CalendarCheck} text="No new bookings in the last 24 hours" />
                    ) : (
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
                    )}
                  </section>
                )}

                {/* STALE PIPELINE */}
                {prefs.staleClients && (
                  <section>
                    <SectionHead icon={Timer} label={`Stale Clients (${staleDays}+ days no movement)`} count={b?.staleClients?.length} color="text-amber-400" />
                    {!b?.staleClients?.length ? (
                      <EmptyState icon={Timer} text={`No clients stuck for ${staleDays}+ days — pipeline is moving`} />
                    ) : (
                      <div className="rounded-xl border border-amber-500/15 overflow-hidden divide-y divide-white/[0.04]">
                        {b.staleClients.map((c: any) => (
                          <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.015]">
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
                            <Button asChild size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0">
                              <Link to="/pipeline"><ArrowRight className="h-3 w-3" /></Link>
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {/* PIPELINE ACTIVITY */}
                {prefs.pipeline && (
                  <section>
                    <SectionHead icon={Zap} label="Pipeline Activity (last 24h)" count={b?.recentPipelineChanges?.length} color="text-blue-400" />
                    {!b?.recentPipelineChanges?.length ? (
                      <EmptyState icon={Zap} text="No pipeline changes in the last 24 hours" />
                    ) : (
                      <div className="rounded-xl border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04]">
                        {b.recentPipelineChanges.map((c: any) => (
                          <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.015]">
                            <div className="h-7 w-7 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                              <Zap className="h-3.5 w-3.5 text-blue-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold">{c.name}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {fmtStatus(c.status)}
                                {c.pipeline_stage ? <span> · {fmtStatus(c.pipeline_stage)}</span> : ""}
                              </p>
                            </div>
                            <span className="text-[10px] text-muted-foreground shrink-0">{fmtRelative(c.updated_at)}</span>
                            <Button asChild size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0">
                              <Link to="/pipeline"><ArrowRight className="h-3 w-3" /></Link>
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {/* WHATSAPP */}
                {prefs.whatsapp && (
                  <section>
                    <SectionHead icon={MessageSquare} label="WhatsApp Inbound (last 24h)" count={b?.newInboundWA || undefined} color="text-green-400" />
                    {!b?.newInboundWA ? (
                      <EmptyState icon={MessageSquare} text="No new inbound WhatsApp messages" />
                    ) : (
                      <div className="rounded-xl border border-green-500/15 bg-green-500/[0.03] px-4 py-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
                            <MessageSquare className="h-4 w-4 text-green-400" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold">{b.newInboundWA} new inbound message{b.newInboundWA > 1 ? "s" : ""}</p>
                            <p className="text-[11px] text-muted-foreground">Received in the last 24 hours</p>
                          </div>
                        </div>
                        <Button asChild size="sm" variant="outline" className="h-7 text-xs shrink-0">
                          <Link to="/whatsapp">Open WhatsApp →</Link>
                        </Button>
                      </div>
                    )}
                  </section>
                )}

                {businessCount === 0 && !briefingQ.isLoading && (
                  <AllClear text="Nothing new across leads, bookings or pipeline in the last 24 hours." />
                )}
              </div>
            )}

            {/* ─── SYSTEM ─── */}
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
              </div>
            )}
          </div>
        )}
      </div>
    </HiveMindShell>
  );
}
