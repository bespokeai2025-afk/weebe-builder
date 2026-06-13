import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useCallback } from "react";
import {
  Users, CalendarCheck, MessageSquare, AlertTriangle,
  CheckCircle2, Loader2, RefreshCw, Play, Clock,
  ChevronDown, Settings2, PhoneCall, ArrowRight,
  ClipboardList, Zap, Bell, Timer, Bot, MailOpen,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import { getHiveMindBriefing } from "@/lib/hivemind/hivemind.functions";
import { getHiveMindPlatformData } from "@/lib/hivemind/hivemind.functions";
import { generateRecommendations } from "@/lib/hivemind/recommendations";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/hivemind")({
  head: () => ({ meta: [{ title: "HiveMind — Webee" }] }),
  component: HiveMindOverview,
});

// ── Prefs stored in localStorage ───────────────────────────────────────────────
type BriefingPrefs = {
  newLeads:    boolean;
  newBookings: boolean;
  staleClients: boolean;
  pipeline:    boolean;
  whatsapp:    boolean;
  systemIssues: boolean;
};
const DEFAULT_PREFS: BriefingPrefs = {
  newLeads: true, newBookings: true, staleClients: true,
  pipeline: true, whatsapp: false, systemIssues: true,
};
const SINCE_OPTIONS = [
  { label: "Last 1 hour",   value: 1 },
  { label: "Last 4 hours",  value: 4 },
  { label: "Last 24 hours", value: 24 },
  { label: "Last 3 days",   value: 72 },
  { label: "Last 7 days",   value: 168 },
];
const STALE_OPTIONS = [3, 5, 7, 10, 14, 30];

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
  const d = new Date(isoStr);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtDateOnly(isoStr: string) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function fmtStatus(s: string) {
  return (s ?? "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Badge ──────────────────────────────────────────────────────────────────────
function Count({ n, color = "violet" }: { n: number; color?: string }) {
  return (
    <span className={cn(
      "ml-1.5 rounded-full px-1.5 py-0 text-[10px] font-bold tabular-nums",
      color === "violet" && "bg-violet-500/20 text-violet-300",
      color === "amber"  && "bg-amber-500/20 text-amber-300",
      color === "emerald"&& "bg-emerald-500/20 text-emerald-300",
      color === "red"    && "bg-red-500/20 text-red-300",
      color === "blue"   && "bg-blue-500/20 text-blue-300",
    )}>{n}</span>
  );
}

// ── Pref toggle ────────────────────────────────────────────────────────────────
function Toggle({ label, checked, onChange, icon: Icon, type }: {
  label: string; checked: boolean; onChange: () => void;
  icon: React.ElementType; type: "business" | "system";
}) {
  return (
    <button
      onClick={onChange}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium border transition-all",
        checked
          ? type === "business"
            ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
            : "bg-amber-500/15 text-amber-300 border-amber-500/30"
          : "bg-white/[0.02] text-muted-foreground border-white/[0.08] hover:text-foreground",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", checked && (type === "business" ? "text-violet-400" : "text-amber-400"))} />
      {label}
      {checked && <CheckCircle2 className="h-3 w-3 ml-auto shrink-0" />}
    </button>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHead({ icon: Icon, label, count, color }: {
  icon: React.ElementType; label: string; count?: number; color: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className={cn("h-4 w-4", color)} />
      <span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      {count != null && count > 0 && <Count n={count} color={color.includes("violet") ? "violet" : color.includes("amber") ? "amber" : color.includes("emerald") ? "emerald" : color.includes("red") ? "red" : "blue"} />}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
function HiveMindOverview() {
  const briefingFn    = useServerFn(getHiveMindBriefing);
  const platformFn    = useServerFn(getHiveMindPlatformData);

  // ── prefs (localStorage, SSR-safe) ──
  const [prefs, setPrefs] = useState<BriefingPrefs>(DEFAULT_PREFS);
  const [sinceHours, setSinceHours] = useState(24);
  const [staleDays, setStaleDays]   = useState(7);
  const [sinceDropOpen, setSinceDropOpen]   = useState(false);
  const [staleDropOpen, setStaleDropOpen]   = useState(false);
  const [configOpen, setConfigOpen]         = useState(true);
  const [activeTab, setActiveTab]           = useState<"business" | "system">("business");
  const [lastRun, setLastRun]               = useState<Date | null>(null);
  const [hasRun, setHasRun]                 = useState(false);
  const [sinceIso, setSinceIso]             = useState<string>(() =>
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  );

  useEffect(() => {
    try {
      const p = localStorage.getItem("hivemind-briefing-prefs");
      if (p) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(p) });
      const s = localStorage.getItem("hivemind-since-hours");
      if (s) setSinceHours(Number(s));
      const sd = localStorage.getItem("hivemind-stale-days");
      if (sd) setStaleDays(Number(sd));
      const lr = localStorage.getItem("hivemind-last-run");
      if (lr) { setLastRun(new Date(lr)); setHasRun(true); }
    } catch {}
  }, []);

  function savePrefs(next: BriefingPrefs) {
    setPrefs(next);
    try { localStorage.setItem("hivemind-briefing-prefs", JSON.stringify(next)); } catch {}
  }
  function togglePref(key: keyof BriefingPrefs) {
    savePrefs({ ...prefs, [key]: !prefs[key] });
  }

  // ── briefing query (manual trigger) ──
  const [runKey, setRunKey] = useState(0);
  const briefingQ = useQuery({
    queryKey: ["hivemind-briefing", sinceIso, staleDays, runKey],
    queryFn: () => briefingFn({ data: { since: sinceIso, staleDays } }),
    enabled: hasRun,
    staleTime: 60_000,
  });
  const platformQ = useQuery({
    queryKey: ["hivemind-data"],
    queryFn: () => platformFn(),
    staleTime: 60_000,
  });

  const systemRecs = generateRecommendations(platformQ.data);
  const sysIssues  = systemRecs.filter(r => r.priority === "critical" || r.priority === "high");
  const b          = briefingQ.data;

  function runBriefing() {
    const iso = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
    setSinceIso(iso);
    setHasRun(true);
    setRunKey(k => k + 1);
    const now = new Date();
    setLastRun(now);
    try {
      localStorage.setItem("hivemind-last-run", now.toISOString());
      localStorage.setItem("hivemind-since-hours", String(sinceHours));
      localStorage.setItem("hivemind-stale-days", String(staleDays));
    } catch {}
  }

  const businessCount =
    (prefs.newLeads    ? (b?.newLeads?.length    ?? 0) : 0) +
    (prefs.newBookings ? (b?.newBookings?.length  ?? 0) : 0) +
    (prefs.staleClients? (b?.staleClients?.length ?? 0) : 0) +
    (prefs.pipeline    ? (b?.recentPipelineChanges?.length ?? 0) : 0) +
    (prefs.whatsapp    ? (b?.newInboundWA ?? 0) : 0);

  const systemCount = prefs.systemIssues ? sysIssues.length : 0;

  return (
    <HiveMindShell>
      <div className="px-6 py-5 max-w-4xl space-y-5">

        {/* ── HEADER ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold">Briefing Centre</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose what to check, run your briefing, and get a clear picture of what needs attention.
            </p>
          </div>
          {lastRun && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              Last briefing: {fmtRelative(lastRun.toISOString())}
            </div>
          )}
        </div>

        {/* ── BRIEFING CONFIGURATOR ── */}
        <div className="rounded-xl border border-white/[0.07] bg-card/60 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
            onClick={() => setConfigOpen(p => !p)}
          >
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-violet-400" />
              <span className="text-sm font-semibold">Configure Briefing</span>
            </div>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !configOpen && "-rotate-90")} />
          </button>

          {configOpen && (
            <div className="border-t border-white/[0.06] px-4 pb-4 pt-3 space-y-4">
              {/* Business items */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-400/80 mb-2">Business — what to check</p>
                <div className="flex flex-wrap gap-2">
                  <Toggle label="New Leads"        checked={prefs.newLeads}     onChange={() => togglePref("newLeads")}     icon={Users}         type="business" />
                  <Toggle label="New Bookings"      checked={prefs.newBookings}  onChange={() => togglePref("newBookings")}  icon={CalendarCheck} type="business" />
                  <Toggle label="Stale Pipeline"    checked={prefs.staleClients} onChange={() => togglePref("staleClients")} icon={Timer}         type="business" />
                  <Toggle label="Pipeline Activity" checked={prefs.pipeline}     onChange={() => togglePref("pipeline")}     icon={ArrowRight}    type="business" />
                  <Toggle label="WhatsApp"          checked={prefs.whatsapp}     onChange={() => togglePref("whatsapp")}     icon={MessageSquare} type="business" />
                </div>
              </div>

              {/* System items */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-400/80 mb-2">System — platform issues</p>
                <div className="flex flex-wrap gap-2">
                  <Toggle label="Platform Issues" checked={prefs.systemIssues} onChange={() => togglePref("systemIssues")} icon={AlertTriangle} type="system" />
                </div>
              </div>

              {/* Time controls */}
              <div className="flex items-center gap-3 flex-wrap border-t border-white/[0.05] pt-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Check since:</span>
                  <div className="relative">
                    <button
                      onClick={() => setSinceDropOpen(p => !p)}
                      className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-foreground hover:bg-white/[0.06] transition-colors"
                    >
                      {SINCE_OPTIONS.find(o => o.value === sinceHours)?.label ?? "Last 24 hours"}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {sinceDropOpen && (
                      <div className="absolute left-0 top-8 z-20 w-36 rounded-xl border border-white/[0.08] bg-card shadow-xl overflow-hidden">
                        {SINCE_OPTIONS.map(o => (
                          <button key={o.value} className={cn(
                            "w-full px-3 py-2 text-left text-xs hover:bg-white/[0.04] transition-colors",
                            o.value === sinceHours && "text-violet-400 font-medium"
                          )} onClick={() => { setSinceHours(o.value); setSinceDropOpen(false); }}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {prefs.staleClients && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Timer className="h-3.5 w-3.5" />
                    <span>Stale after:</span>
                    <div className="relative">
                      <button
                        onClick={() => setStaleDropOpen(p => !p)}
                        className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-foreground hover:bg-white/[0.06] transition-colors"
                      >
                        {staleDays} days
                        <ChevronDown className="h-3 w-3" />
                      </button>
                      {staleDropOpen && (
                        <div className="absolute left-0 top-8 z-20 w-28 rounded-xl border border-white/[0.08] bg-card shadow-xl overflow-hidden">
                          {STALE_OPTIONS.map(d => (
                            <button key={d} className={cn(
                              "w-full px-3 py-2 text-left text-xs hover:bg-white/[0.04] transition-colors",
                              d === staleDays && "text-violet-400 font-medium"
                            )} onClick={() => { setStaleDays(d); setStaleDropOpen(false); }}>
                              {d} days
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <Button
                  className="ml-auto gap-2 bg-violet-600 hover:bg-violet-500 text-white h-8 text-xs"
                  onClick={runBriefing}
                  disabled={briefingQ.isFetching || platformQ.isFetching}
                >
                  {briefingQ.isFetching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Run Briefing
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── NO RUN YET ── */}
        {!hasRun && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="h-12 w-12 rounded-full bg-violet-500/10 flex items-center justify-center">
              <Bell className="h-5 w-5 text-violet-400" />
            </div>
            <p className="text-sm font-semibold">Ready to brief you</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Select what you want to check above, then hit <strong>Run Briefing</strong> to see everything that needs your attention.
            </p>
          </div>
        )}

        {/* ── RESULTS ── */}
        {hasRun && (
          <div className="space-y-4">

            {/* Tab bar */}
            <div className="flex gap-1 border-b border-white/[0.06] pb-0">
              {([["business", "Business Tasks", businessCount, "violet"], ["system", "System Tasks", systemCount, "amber"]] as const).map(([id, label, count, color]) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                    activeTab === id
                      ? color === "violet" ? "border-violet-400 text-foreground" : "border-amber-400 text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                  {count > 0 && <Count n={count} color={color} />}
                </button>
              ))}
            </div>

            {/* ─── BUSINESS TASKS ─── */}
            {activeTab === "business" && (
              <div className="space-y-5">
                {briefingQ.isLoading ? (
                  <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
                    <span className="text-sm">Gathering your business data…</span>
                  </div>
                ) : (
                  <>
                    {/* ── NEW LEADS ── */}
                    {prefs.newLeads && (
                      <div>
                        <SectionHead icon={Users} label="New Leads" count={b?.newLeads?.length} color="text-violet-400" />
                        {!b?.newLeads?.length ? (
                          <EmptyState icon={Users} text={`No new leads in the last ${sinceHours < 24 ? sinceHours + "h" : sinceHours / 24 + "d"}`} />
                        ) : (
                          <div className="rounded-xl border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04]">
                            {b.newLeads.map((lead: any) => (
                              <div key={lead.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.015]">
                                <div className="h-7 w-7 rounded-full bg-violet-500/15 flex items-center justify-center shrink-0 text-xs font-bold text-violet-300">
                                  {(lead.name || "?")[0]?.toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold">{lead.name}</p>
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
                      </div>
                    )}

                    {/* ── NEW BOOKINGS ── */}
                    {prefs.newBookings && (
                      <div>
                        <SectionHead icon={CalendarCheck} label="New Bookings" count={b?.newBookings?.length} color="text-emerald-400" />
                        {!b?.newBookings?.length ? (
                          <EmptyState icon={CalendarCheck} text={`No new bookings in the last ${sinceHours < 24 ? sinceHours + "h" : sinceHours / 24 + "d"}`} />
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {b.newBookings.map((bk: any) => (
                              <div key={bk.id} className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.03] p-3.5">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <p className="text-sm font-semibold leading-snug">{bk.title}</p>
                                  <span className={cn(
                                    "rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize shrink-0",
                                    bk.status === "confirmed" ? "bg-emerald-500/15 text-emerald-400" :
                                    bk.status === "cancelled" ? "bg-red-500/15 text-red-400" :
                                    "bg-white/[0.05] text-muted-foreground"
                                  )}>{bk.status ?? "booked"}</span>
                                </div>
                                {bk.attendee_name && (
                                  <p className="text-xs text-muted-foreground mb-1">
                                    <span className="font-medium text-foreground/80">{bk.attendee_name}</span>
                                    {bk.attendee_email && <span className="ml-1">· {bk.attendee_email}</span>}
                                  </p>
                                )}
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <CalendarCheck className="h-3 w-3 text-emerald-400 shrink-0" />
                                  {bk.start_at ? fmtDateTime(bk.start_at) : "Time TBC"}
                                </div>
                                {bk.agent_name && (
                                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
                                    <Bot className="h-3 w-3 text-violet-400 shrink-0" />
                                    Booked by {bk.agent_name}
                                  </div>
                                )}
                                {bk.notes && (
                                  <p className="text-[11px] text-muted-foreground mt-1.5 italic border-t border-white/[0.04] pt-1.5 truncate">{bk.notes}</p>
                                )}
                                <p className="text-[10px] text-muted-foreground/60 mt-1.5">Booked {fmtRelative(bk.created_at)}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── STALE PIPELINE CLIENTS ── */}
                    {prefs.staleClients && (
                      <div>
                        <SectionHead icon={Timer} label={`Stale Pipeline Clients (${staleDays}+ days)`} count={b?.staleClients?.length} color="text-amber-400" />
                        {!b?.staleClients?.length ? (
                          <EmptyState icon={Timer} text={`No clients stuck for ${staleDays}+ days`} />
                        ) : (
                          <div className="rounded-xl border border-amber-500/15 overflow-hidden divide-y divide-white/[0.04]">
                            {b.staleClients.map((c: any) => (
                              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.015]">
                                <div className="h-7 w-7 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0 text-xs font-bold text-amber-300">
                                  {(c.name || "?")[0]?.toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold">{c.name}</p>
                                  <p className="text-[11px] text-muted-foreground">{fmtStatus(c.status)}{c.pipeline_stage ? " · " + fmtStatus(c.pipeline_stage) : ""}</p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className={cn("text-xs font-bold tabular-nums", c.days > staleDays * 2 ? "text-red-400" : "text-amber-400")}>{c.days}d idle</p>
                                  <p className="text-[10px] text-muted-foreground">Last: {fmtDateOnly(c.updated_at)}</p>
                                </div>
                                <Button asChild size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0">
                                  <Link to="/pipeline"><ArrowRight className="h-3 w-3" /></Link>
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── PIPELINE ACTIVITY ── */}
                    {prefs.pipeline && (
                      <div>
                        <SectionHead icon={ArrowRight} label="Pipeline Activity" count={b?.recentPipelineChanges?.length} color="text-blue-400" />
                        {!b?.recentPipelineChanges?.length ? (
                          <EmptyState icon={ArrowRight} text="No pipeline changes in this period" />
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
                                    Now: <span className="text-foreground/80">{fmtStatus(c.status)}</span>
                                    {c.pipeline_stage ? <span className="text-muted-foreground"> · {fmtStatus(c.pipeline_stage)}</span> : ""}
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
                      </div>
                    )}

                    {/* ── WHATSAPP ── */}
                    {prefs.whatsapp && (
                      <div>
                        <SectionHead icon={MessageSquare} label="WhatsApp Inbound" count={b?.newInboundWA} color="text-green-400" />
                        {!(b?.newInboundWA) ? (
                          <EmptyState icon={MessageSquare} text="No new inbound WhatsApp messages" />
                        ) : (
                          <div className="rounded-xl border border-green-500/15 bg-green-500/[0.03] px-4 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-full bg-green-500/15 flex items-center justify-center">
                                <MessageSquare className="h-4 w-4 text-green-400" />
                              </div>
                              <div>
                                <p className="text-sm font-semibold">{b.newInboundWA} new inbound message{b.newInboundWA > 1 ? "s" : ""}</p>
                                <p className="text-[11px] text-muted-foreground">Received in the last {sinceHours < 24 ? sinceHours + " hours" : sinceHours / 24 + " days"}</p>
                              </div>
                            </div>
                            <Button asChild size="sm" variant="outline" className="h-7 text-xs shrink-0">
                              <Link to="/whatsapp">Open WhatsApp →</Link>
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* All-clear */}
                    {businessCount === 0 && !briefingQ.isLoading && (
                      <AllClear text="Nothing requires your attention right now." />
                    )}
                  </>
                )}
              </div>
            )}

            {/* ─── SYSTEM TASKS ─── */}
            {activeTab === "system" && (
              <div className="space-y-3">
                {!prefs.systemIssues ? (
                  <EmptyState icon={Settings2} text='System Issues are turned off. Enable them in Configure Briefing.' />
                ) : platformQ.isLoading ? (
                  <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                    <span className="text-sm">Checking platform…</span>
                  </div>
                ) : sysIssues.length === 0 ? (
                  <AllClear text="No critical or high-priority system issues detected." />
                ) : (
                  sysIssues.map(r => (
                    <div key={r.id} className={cn(
                      "rounded-xl border px-4 py-3.5 flex items-start gap-3",
                      r.priority === "critical" ? "border-red-500/20 bg-red-500/[0.03]" : "border-amber-500/15 bg-amber-500/[0.03]",
                    )}>
                      <AlertTriangle className={cn("h-4 w-4 shrink-0 mt-0.5", r.priority === "critical" ? "text-red-400" : "text-amber-400")} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                            r.priority === "critical" ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"
                          )}>{r.priority}</span>
                          <span className="text-[10px] text-muted-foreground bg-white/[0.04] rounded px-1.5 py-0.5">{r.category}</span>
                        </div>
                        <p className="text-sm font-semibold">{r.problem}</p>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{r.fix}</p>
                      </div>
                      {r.action && (
                        <Button asChild size="sm" variant="outline" className="h-7 text-xs shrink-0">
                          <Link to={r.action.href}>{r.action.label} →</Link>
                        </Button>
                      )}
                    </div>
                  ))
                )}

                {sysIssues.length > 0 && (
                  <div className="flex justify-end">
                    <Button asChild size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground">
                      <Link to="/hivemind/recommendations">View all recommendations →</Link>
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </HiveMindShell>
  );
}

function EmptyState({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/[0.06] px-4 py-5 flex items-center gap-3 text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground/40" />
      <p className="text-xs">{text}</p>
    </div>
  );
}

function AllClear({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-3">
      <CheckCircle2 className="h-9 w-9 text-emerald-400/50" />
      <p className="text-sm font-semibold text-emerald-300">All clear</p>
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
