import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useState, useEffect, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FlaskConical,
  MessageSquare,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneCall,
  PlayCircle,
  RefreshCw,
  StickyNote,
  X,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DashboardPage, KpiCard, SummaryTooltip, stickyCell, stickyHead } from "@/components/dashboard/PageShell";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { cn } from "@/lib/utils";
import { listCalls, listTestCalls } from "@/lib/dashboard/calls.functions";
import { listWbahCallsLive, getWbahCallDetail } from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import { NotesBookingSheet } from "@/components/dashboard/NotesBookingSheet";
import type { NotesEntityType } from "@/components/dashboard/NotesBookingSheet";
import { RelativeTime } from "@/components/ui/relative-time";
import { supabase } from "@/integrations/supabase/client";
import { useTablePagination, TablePagBar } from "@/components/ui/table-pagination";

export const Route = createFileRoute("/_authenticated/calls")({
  head: () => ({ meta: [{ title: "Calls — Webee" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    vm: (search.vm as "exclude" | "all" | "only" | undefined) ?? undefined,
  }),
  component: CallsPage,
});

function fmtDuration(s?: number | null) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function sentimentClass(v?: string | null) {
  if (v === "positive") return "bg-emerald-500/15 text-emerald-400";
  if (v === "negative") return "bg-destructive/15 text-destructive";
  if (v === "neutral") return "bg-muted text-muted-foreground";
  return "bg-muted/40 text-muted-foreground";
}

function statusClass(s?: string | null) {
  if (s === "completed") return "bg-emerald-500/15 text-emerald-400";
  if (s === "in_progress" || s === "ringing") return "bg-primary/15 text-primary";
  if (s === "failed" || s === "no_answer" || s === "busy")
    return "bg-destructive/15 text-destructive";
  if (s === "voicemail") return "bg-amber-500/15 text-amber-400";
  return "bg-muted text-muted-foreground";
}

function RecordingDialog({
  url,
  contact,
  onClose,
}: {
  url: string;
  contact: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Call Recording</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{contact}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <audio controls autoPlay={false} className="w-full" src={url} style={{ colorScheme: "dark" }}>
          Your browser does not support audio playback.
        </audio>
        <a
          href={url}
          download
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-muted/40 px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          <Download className="h-4 w-4" />
          Download recording
        </a>
      </div>
    </div>
  );
}

type PanelTarget = {
  entityType: NotesEntityType;
  entityId: string;
  entityName: string;
  defaultPhone?: string;
  defaultEmail?: string;
  leadId?: string | null;
};

function fmtCost(cents?: number | null) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(3)}`;
}

function channelLabel(fromNumber?: string | null, callType?: string | null) {
  // HyperStream web calls use from_number="web" as a proxy until the
  // provider column migration is applied (20260613_calls_provider_channel.sql).
  if (fromNumber === "web") return "web";
  if (callType === "inbound") return "phone_call";
  return "phone_call";
}

function TestCallRow({ c }: { c: ReturnType<typeof listTestCalls> extends Promise<infer T> ? T extends Array<infer U> ? U : never : never }) {
  const [expanded, setExpanded] = useState(false);
  const [recordingPlayer, setRecordingPlayer] = useState<{ url: string; contact: string } | null>(null);
  const label = c.agent_name ?? c.agent_id ?? "Builder test";
  const sessionId = c.retell_call_id ?? "—";
  const shortSessionId = sessionId !== "—" && sessionId.length > 24
    ? sessionId.slice(0, 24) + "…"
    : sessionId;

  return (
    <>
      {recordingPlayer && (
        <RecordingDialog
          url={recordingPlayer.url}
          contact={recordingPlayer.contact}
          onClose={() => setRecordingPlayer(null)}
        />
      )}
      <tr
        className="group h-8 border-b border-white/[0.04] last:border-0 align-middle hover:bg-white/[0.02] transition-colors cursor-pointer"
        onClick={() => c.transcript && setExpanded((p) => !p)}
      >
        <td className="px-2 py-0.5">
          {c.transcript ? (
            expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )
          ) : (
            <span className="h-3 w-3 inline-block" />
          )}
        </td>
        <td className="px-2 py-0.5 text-xs font-medium whitespace-nowrap">{label}</td>
        <td className="px-2 py-0.5 text-muted-foreground tabular-nums text-[11px] whitespace-nowrap">
          {fmtDuration(c.duration_seconds)}
        </td>
        <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
          {channelLabel(c.from_number, c.call_type)}
        </td>
        <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">
          {fmtCost(c.cost_cents)}
        </td>
        <td className="px-2 py-0.5 text-[11px] text-muted-foreground font-mono max-w-[200px] truncate" title={sessionId !== "—" ? sessionId : undefined}>
          {shortSessionId}
        </td>
        <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
          {c.disconnection_reason
            ? String(c.disconnection_reason).replace(/_/g, " ")
            : "—"}
        </td>
        <td className="px-2 py-0.5">
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] capitalize", statusClass(c.call_status))}>
            {String(c.call_status ?? "").replace(/_/g, " ").trim() || "—"}
          </span>
        </td>
        <td className="px-2 py-0.5">
          {c.sentiment ? (
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] capitalize", sentimentClass(c.sentiment))}>
              {c.sentiment}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
          {c.from_number ?? "—"}
        </td>
        <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
          {c.to_number ?? "—"}
        </td>
        <td className="px-2 py-0.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            {c.call_type === "inbound" ? (
              <PhoneIncoming className="h-3 w-3 text-primary" />
            ) : (
              <PhoneOutgoing className="h-3 w-3" />
            )}
            {c.call_type === "inbound" ? "Inbound" : "Outbound"}
          </span>
        </td>
        <td className="px-2 py-0.5" onClick={(e) => e.stopPropagation()}>
          {c.recording_url ? (
            <button
              onClick={() => setRecordingPlayer({ url: c.recording_url!, contact: label })}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <PlayCircle className="h-3 w-3" /> Play
            </button>
          ) : (
            <span className="text-[11px] text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-2 py-0.5 text-muted-foreground text-[11px] whitespace-nowrap">
          <RelativeTime date={c.started_at} fallback="—" />
        </td>
      </tr>
      {expanded && c.transcript && (
        <tr className="border-b border-white/[0.04]">
          <td colSpan={14} className="px-4 pb-3 pt-1">
            <div className="rounded-lg bg-black/30 border border-white/[0.06] p-3 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">
              {c.transcript}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function filterToDates(filter: string): { dateFrom?: string; dateTo?: string } {
  if (filter === "all") return {};
  if (filter === "today") {
    const d = new Date();
    const from = new Date(d); from.setUTCHours(0, 0, 0, 0);
    const to   = new Date(d); to.setUTCHours(23, 59, 59, 999);
    return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
  }
  if (filter === "yesterday") {
    const d = new Date(Date.now() - 86_400_000);
    const from = new Date(d); from.setUTCHours(0, 0, 0, 0);
    const to   = new Date(d); to.setUTCHours(23, 59, 59, 999);
    return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
  }
  const days = parseInt(filter, 10);
  return isNaN(days) ? {} : { dateFrom: new Date(Date.now() - days * 86_400_000).toISOString() };
}

function CallsPage() {
  const { vm } = useSearch({ from: "/_authenticated/calls" });
  const [tab, setTab] = useState<"live" | "test">("live");
  const [isWbah, setIsWbah] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("default_workspace_id")
          .eq("user_id", sess.session.user.id)
          .maybeSingle();
        if (!profile?.default_workspace_id || !active) return;
        const { data: ws } = await supabase
          .from("workspaces")
          .select("slug")
          .eq("id", profile.default_workspace_id)
          .maybeSingle();
        if (active) setIsWbah(ws?.slug === "webuyanyhouse");
      } catch {}
    })();
    return () => { active = false; };
  }, []);

  // Native WEBEE calls (all workspaces except WBAH)
  // throwOnError: false — TanStack Router Suspense context would otherwise
  // re-throw query errors to the route error boundary instead of storing them.
  // ?vm=only pre-selects the voicemail filter (e.g. linked from the dashboard card).
  const [voicemailFilter, setVoicemailFilter] = useState<"exclude" | "all" | "only">(
    vm === "only" || vm === "all" ? vm : "exclude",
  );
  const [daysFilter, setDaysFilter] = useState("30");
  // Additional filters (call duration threshold, outcome, custom date range).
  const [durationFilter, setDurationFilter] = useState("");   // min seconds ("" = any)
  const [outcomeFilter, setOutcomeFilter]   = useState("");   // "" | "successful" | "unsuccessful"
  const [customFrom, setCustomFrom]         = useState("");   // yyyy-mm-dd
  const [customTo, setCustomTo]             = useState("");

  // Effective {dateFrom,dateTo} — "custom" reveals a Between range; else a preset.
  const effectiveDateRange = useMemo<{ dateFrom?: string; dateTo?: string }>(() => {
    if (daysFilter === "custom") {
      const r: { dateFrom?: string; dateTo?: string } = {};
      if (customFrom) r.dateFrom = new Date(`${customFrom}T00:00:00`).toISOString();
      if (customTo)   r.dateTo   = new Date(`${customTo}T23:59:59.999`).toISOString();
      return r;
    }
    return filterToDates(daysFilter);
  }, [daysFilter, customFrom, customTo]);

  const fn = useServerFn(listCalls);
  const q = useQuery({
    queryKey:             ["calls", voicemailFilter, daysFilter, customFrom, customTo],
    queryFn:              () => fn({ data: { voicemailFilter, ...effectiveDateRange } }),
    enabled:              !isWbah,
    staleTime:            3 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError:         false,
    retry:                0,
  });

  // WeeBespoke calls — pulled LIVE from WeeBespoke on open (incremental + capped),
  // then read from the freshly-updated wbah_calls table. staleTime 60s keeps it
  // fresh on open without a background timer repeatedly touching the single
  // WeeBespoke session while the tab sits idle.
  const wbahFn = useServerFn(listWbahCallsLive);
  const wbahQ = useQuery({
    queryKey: ["wbah-calls"],
    queryFn: () => wbahFn(),
    enabled: isWbah,
    staleTime:            60_000,
    refetchOnWindowFocus: false,
    retry: 0,
    throwOnError: false,
  });

  // Auto-reload on stale server-fn ID error. Timestamp guard: max once per 20s.
  useEffect(() => {
    const anyError = (!isWbah && q.isError) || (isWbah && wbahQ.isError);
    if (anyError) {
      const key = "calls-autoreload-ts";
      const last = parseInt(sessionStorage.getItem(key) ?? "0");
      if (Date.now() - last > 20_000) {
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
      }
    }
  }, [isWbah, q.isError, wbahQ.isError]);

  // Sort newest-first for display; freshness is handled server-side by the live fn.
  const wbahRows = useMemo(() => {
    return ((wbahQ.data ?? []) as any[]).slice().sort((a, b) => {
      const ta = a.started_at ? new Date(a.started_at).getTime() : 0;
      const tb = b.started_at ? new Date(b.started_at).getTime() : 0;
      return tb - ta;
    });
  }, [wbahQ.data]);

  // WBAH calls live in wbah_calls, which has no is_voicemail flag — the "voicemail"
  // result is encoded in disconnection_reason / end_reason ("voicemail_reached").
  // Native calls are already voicemail-filtered server-side by listCalls, so the
  // client-side voicemail filter only applies to WBAH here. Filtering at the `rows`
  // level keeps the KPI counts and the table consistent with the filter pill.
  const rows = useMemo<any[]>(() => {
    const base = (isWbah ? wbahRows : (q.data ?? [])) as any[];
    if (!isWbah || voicemailFilter === "all") return base;
    const isVoicemail = (r: any) =>
      /voicemail/i.test(String(r.disconnection_reason ?? "")) ||
      /voicemail/i.test(String(r.end_reason ?? ""));
    return voicemailFilter === "only"
      ? base.filter(isVoicemail)
      : base.filter((r) => !isVoicemail(r));
  }, [isWbah, wbahRows, q.data, voicemailFilter]);

  const testFn = useServerFn(listTestCalls);
  const testQ = useQuery({
    queryKey:             ["test-calls"],
    queryFn:              () => testFn({ data: {} }),
    staleTime:            3 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError:         false,
  });
  const testRows = testQ.data ?? [];

  const completed = rows.filter((r) => r.call_status === "completed").length;
  const failed = rows.filter((r) => ["failed", "no_answer", "busy"].includes(r.call_status)).length;
  const totalSec = rows.reduce((a: number, r: any) => a + (r.duration_seconds ?? 0), 0);

  const [recordingPlayer, setRecordingPlayer] = useState<{ url: string; contact: string } | null>(null);
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const [wbahTranscript, setWbahTranscript] = useState<{ text: string; name: string } | null>(null);
  const getWbahCallDetailFn = useServerFn(getWbahCallDetail);

  // Transcripts are omitted from the list payload — load on demand when opened.
  async function openWbahTranscript(c: any, name: string) {
    if (c?.transcript) { setWbahTranscript({ text: c.transcript, name }); return; }
    if (!c?.id) return;
    setWbahTranscript({ text: "Loading transcript…", name });
    try {
      const d = await getWbahCallDetailFn({ data: { id: String(c.id) } });
      setWbahTranscript({ text: (d as any)?.transcript || "No transcript available.", name });
    } catch {
      setWbahTranscript({ text: "Failed to load transcript.", name });
    }
  }
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [callTypeFilter, setCallTypeFilter] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState("");

  const filteredRows = useMemo(() => {
    const { dateFrom: cutFrom, dateTo: cutTo } = effectiveDateRange;
    const minDur = durationFilter ? parseInt(durationFilter, 10) : 0;
    return rows.filter((r: any) => {
      if (search.trim()) {
        const q = search.toLowerCase();
        const name = (r.wbah_name ?? r.lead?.full_name ?? r.to_number ?? r.from_number ?? "").toLowerCase();
        const phone = (r.wbah_contact ?? r.to_number ?? r.from_number ?? "").toLowerCase();
        if (!name.includes(q) && !phone.includes(q)) return false;
      }
      if (statusFilter && r.call_status !== statusFilter) return false;
      if (callTypeFilter && r.call_type !== callTypeFilter) return false;
      if (sentimentFilter && r.sentiment !== sentimentFilter) return false;
      // Call duration greater than N minutes.
      if (minDur > 0 && (r.duration_seconds ?? 0) < minDur) return false;
      // Call outcome: successful = completed; unsuccessful = failed/no-answer/busy.
      if (outcomeFilter === "successful" && r.call_status !== "completed") return false;
      if (outcomeFilter === "unsuccessful" && !["failed", "no_answer", "busy"].includes(r.call_status)) return false;
      if (cutFrom || cutTo) {
        const dateStr = r.started_at ?? null;
        if (!dateStr) return false;
        const ts = new Date(dateStr).getTime();
        if (isNaN(ts)) return false;
        if (cutFrom && ts < new Date(cutFrom).getTime()) return false;
        if (cutTo && ts > new Date(cutTo).getTime()) return false;
      }
      return true;
    });
  }, [rows, search, effectiveDateRange, statusFilter, callTypeFilter, sentimentFilter, durationFilter, outcomeFilter]);

  const callsPag = useTablePagination(filteredRows, 50);

  const hasCallFilters = search.trim() || statusFilter || callTypeFilter || sentimentFilter || durationFilter || outcomeFilter || daysFilter === "custom";

  function openPanel(c: any) {
    const inbound = c.call_type === "inbound";
    const rawContact = c.lead?.full_name ?? (inbound ? c.from_number : c.to_number) ?? "Call";
    const contact = typeof rawContact === "string" && rawContact.startsWith("web:") ? "Web session" : rawContact;
    const rawPhone = inbound ? c.from_number : c.to_number;
    const phone = typeof rawPhone === "string" && rawPhone.startsWith("web:") ? undefined : rawPhone;
    setPanel({
      entityType: "call",
      entityId: c.id,
      entityName: contact,
      defaultPhone: phone ?? undefined,
      leadId: c.lead_id ?? null,
    });
  }

  const isRefetching = tab === "live"
    ? (isWbah ? wbahQ.isFetching : q.isRefetching)
    : testQ.isRefetching;

  return (
    <DashboardPage>
      {recordingPlayer && (
        <RecordingDialog
          url={recordingPlayer.url}
          contact={recordingPlayer.contact}
          onClose={() => setRecordingPlayer(null)}
        />
      )}

      {/* Transcript modal — WBAH calls */}
      {wbahTranscript && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setWbahTranscript(null)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Transcript</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{wbahTranscript.name}</p>
              </div>
              <button onClick={() => setWbahTranscript(null)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-lg bg-black/30 border border-white/[0.06] p-3 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {wbahTranscript.text || "No transcript available."}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm font-semibold tracking-tight">Calls</h1>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Call activity, transcripts and outcomes</p>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Tab switcher */}
          <div className="flex items-center rounded-lg border border-white/[0.06] bg-card/40 p-0.5">
            <button
              onClick={() => setTab("live")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
                tab === "live"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Phone className="h-3 w-3" />
              Live Calls
            </button>
            <button
              onClick={() => setTab("test")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
                tab === "test"
                  ? "bg-violet-500/15 text-violet-300"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <FlaskConical className="h-3 w-3" />
              Test Calls
              {testRows.length > 0 && (
                <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-bold text-violet-300">
                  {testRows.length}
                </span>
              )}
            </button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2.5 text-xs"
            onClick={() => {
              if (tab === "live") isWbah ? wbahQ.refetch() : q.refetch();
              else testQ.refetch();
            }}
            disabled={isRefetching}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {tab === "live" ? (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <KpiCard label="Total Calls" value={rows.length} icon={Phone} iconBg="bg-blue-500/15" iconColor="text-blue-400" />
            <KpiCard label="Completed" value={completed} icon={Phone} iconBg="bg-emerald-500/15" iconColor="text-emerald-400" />
            <KpiCard label="Failed" value={failed} icon={Phone} iconBg="bg-red-500/15" iconColor="text-red-400" />
            <KpiCard label="Total Talk" value={fmtDuration(totalSec)} icon={Phone} iconBg="bg-violet-500/15" iconColor="text-violet-400" />
          </div>

          {/* Filter bar */}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Input
              placeholder="Search name or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-6 min-w-0 flex-1 basis-28 max-w-[180px] text-[11px] sm:flex-none sm:w-36"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            >
              <option value="">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="no_answer">No Answer</option>
              <option value="busy">Busy</option>
              <option value="voicemail">Voicemail</option>
            </select>
            {!isWbah && (
              <select
                value={callTypeFilter}
                onChange={(e) => setCallTypeFilter(e.target.value)}
                className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                <option value="">All Types</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
            )}
            <select
              value={sentimentFilter}
              onChange={(e) => setSentimentFilter(e.target.value)}
              className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            >
              <option value="">All Sentiments</option>
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
            </select>
            <select
              value={durationFilter}
              onChange={(e) => setDurationFilter(e.target.value)}
              className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              title="Call duration"
            >
              <option value="">Any duration</option>
              <option value="60">&gt; 1 min</option>
              <option value="300">&gt; 5 min</option>
              <option value="600">&gt; 10 min</option>
              <option value="900">&gt; 15 min</option>
              <option value="1800">&gt; 30 min</option>
            </select>
            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
              className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              title="Call outcome"
            >
              <option value="">All Outcomes</option>
              <option value="successful">Successful</option>
              <option value="unsuccessful">Unsuccessful</option>
            </select>
            <select
              value={daysFilter}
              onChange={(e) => setDaysFilter(e.target.value)}
              className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 6 months</option>
              <option value="all">All time</option>
              <option value="custom">Custom range…</option>
            </select>
            {daysFilter === "custom" && (
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  title="From date"
                />
                <span className="text-[11px] text-muted-foreground">to</span>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  title="To date"
                />
              </div>
            )}

            {/* Three-state voicemail filter pill — native filters server-side, WBAH client-side */}
            <div className="flex items-center rounded-md border border-white/[0.08] bg-card/60 p-0.5 gap-0.5">
                {(
                  [
                    { value: "exclude", label: "No Voicemails" },
                    { value: "all",     label: "Show All" },
                    { value: "only",    label: "Voicemails Only" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setVoicemailFilter(opt.value)}
                    className={cn(
                      "rounded px-2 py-1 text-[10px] font-medium transition-colors whitespace-nowrap",
                      voicemailFilter === opt.value
                        ? opt.value === "only"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

            {hasCallFilters && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => { setSearch(""); setStatusFilter(""); setCallTypeFilter(""); setSentimentFilter(""); setDurationFilter(""); setOutcomeFilter(""); }}
              >
                Clear filters
              </Button>
            )}
            {hasCallFilters && (
              <span className="text-[11px] text-muted-foreground">
                {filteredRows.length} of {rows.length}
              </span>
            )}
          </div>

          {/* Calls table */}
          <div className="min-w-0 overflow-hidden rounded-xl border border-white/[0.06] bg-card/60">
            {wbahQ.isFetching && isWbah && rows.length === 0 ? (
              <LoadingProgress label="Loading calls" estimatedMs={9000} />
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10">
                <Phone className="h-7 w-7 text-muted-foreground" />
                <p className="text-sm font-medium">No calls yet</p>
                <p className="text-xs text-muted-foreground">Outbound and inbound calls will be logged here.</p>
              </div>
            ) : isWbah ? (
              /* ── WeeBespoke calls table ──────────────────────────────────── */
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-card/30">
                      {["SR No","Times Called","Dial","Name","Contact","Type","Last Called At","Call Status","Call Duration","Recording","Sentiment Analysis","Transcript","View","Appointment Date","Appointment Time","Booking Status","Calendly Booking Url","End Reason","Disconnection Reason"].map((h, i) => (
                        <th
                          key={h}
                          className={cn(
                            "px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap",
                            i === 0 && cn(stickyHead, "left-0 w-9"),
                            i === 1 && cn(stickyHead, "left-9 w-14"),
                            i === 2 && cn(stickyHead, "left-[5.75rem] w-10"),
                            i === 3 && cn(stickyHead, "left-[8.25rem] w-24"),
                            i === 4 && cn(stickyHead, "left-[14.25rem] w-28 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.45)]"),
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {callsPag.sliced.map((c: any, idx: number) => {
                      const name = c.wbah_name ?? c.lead?.full_name ?? "—";
                      const phone = c.wbah_contact ?? c.to_number ?? c.from_number ?? null;
                      const callType = c.call_type === "inbound" ? "Inbound" : "Outbound";
                      return (
                        <tr key={c.id} className="group h-8 border-b border-white/[0.04] last:border-0 align-middle hover:bg-white/[0.02] transition-colors">
                          <td className={cn("px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums", stickyCell, "left-0 w-9")}>{idx + 1}</td>
                          <td className={cn("px-2 py-0.5", stickyCell, "left-9 w-14")}>
                            {(c.call_count ?? 1) > 1 ? (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400 tabular-nums">×{c.call_count}</span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground tabular-nums">1</span>
                            )}
                          </td>
                          <td className={cn("px-2 py-0.5", stickyCell, "left-[5.75rem] w-10")} onClick={(e) => e.stopPropagation()}>
                            {phone
                              ? <a href={`tel:${phone}`} className="inline-flex rounded p-0.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"><Phone className="h-3 w-3" /></a>
                              : <Phone className="h-3 w-3 text-muted-foreground/30" />}
                          </td>
                          <td className={cn("max-w-[6rem] truncate px-2 py-0.5 text-[11px] font-medium", stickyCell, "left-[8.25rem] w-24")}>{name}</td>
                          <td className={cn("max-w-[7rem] truncate px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums", stickyCell, "left-[14.25rem] w-28 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.35)]")}>{phone ?? "N/A"}</td>
                          <td className="px-2 py-0.5 text-[10px] text-muted-foreground whitespace-nowrap">{callType}</td>
                          <td className="px-2 py-0.5 text-[10px] text-muted-foreground whitespace-nowrap">
                            {c.started_at
                              ? new Date(c.started_at).toLocaleString(undefined, { timeStyle: "short", dateStyle: "medium" })
                              : "N/A"}
                          </td>
                          <td className="px-2 py-0.5">
                            <span className={cn("rounded-full px-2 py-0.5 text-[10px] capitalize", statusClass(c.call_status))}>
                              {String(c.call_status ?? "").replace(/_/g, " ").trim() || "—"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-0.5 text-muted-foreground tabular-nums text-[11px]">{fmtDuration(c.duration_seconds)}</td>
                          <td className="px-2 py-0.5" onClick={(e) => e.stopPropagation()}>
                            {c.recording_url
                              ? <button onClick={() => setRecordingPlayer({ url: c.recording_url, contact: name })} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline whitespace-nowrap"><PlayCircle className="h-3 w-3" /> Play</button>
                              : <span className="text-[11px] text-muted-foreground">N/A</span>}
                          </td>
                          <td className="px-2 py-0.5">
                            <span className={cn("text-[11px] capitalize", sentimentClass(c.sentiment ?? "neutral").replace(/bg-\S+/g, "").replace(/\s+/g, " ").trim())}>
                              {c.sentiment ? c.sentiment.charAt(0).toUpperCase() + c.sentiment.slice(1) : "Neutral"}
                            </span>
                          </td>
                          <td className="px-2 py-0.5" onClick={(e) => e.stopPropagation()}>
                            {(c.transcript || c.hasTranscript)
                              ? <button onClick={() => openWbahTranscript(c, name)} className="inline-flex items-center gap-1 text-[11px] rounded bg-primary/20 text-primary px-2 py-0.5 hover:bg-primary/30 whitespace-nowrap font-medium">Transcript</button>
                              : <span className="text-[11px] text-muted-foreground">N/A</span>}
                          </td>
                          <td className="px-2 py-0.5" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => openPanel(c)} className="inline-flex items-center gap-1 text-[11px] rounded border border-white/20 px-2 py-0.5 text-muted-foreground hover:text-foreground hover:border-white/40 whitespace-nowrap transition-colors">View</button>
                          </td>
                          <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{c.appointment_date ?? "N/A"}</td>
                          <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{c.appointment_time ?? "N/A"}</td>
                          <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{c.booking_status ?? "N/A"}</td>
                          <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
                            {c.calendly_booking_url
                              ? <a href={c.calendly_booking_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Link</a>
                              : "N/A"}
                          </td>
                          <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{c.end_reason ?? "N/A"}</td>
                          <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{c.disconnection_reason ?? "N/A"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <TablePagBar page={callsPag.page} pageSize={callsPag.pageSize} totalPages={callsPag.totalPages} total={callsPag.total} setPage={callsPag.setPage} changePageSize={callsPag.changePageSize} />
              </div>
            ) : (
              /* ── Standard WEBEE calls table ──────────────────────────────── */
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-card/30">
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Contact</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Type</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Agent</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Status</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sentiment</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Summary</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Duration</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Rec</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Transcript</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">End Reason</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">Last Called At</th>
                      <th className="sticky right-0 bg-card/80 px-2 py-1 w-20 backdrop-blur-sm"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {callsPag.sliced.map((c: any) => {
                      const inbound = c.call_type === "inbound";
                      const rawContact = c.lead?.full_name ?? (inbound ? c.from_number : c.to_number) ?? "Unknown";
                      const contact = typeof rawContact === "string" && rawContact.startsWith("web:") ? "Web session" : rawContact;
                      const isVmMode = voicemailFilter === "only";
                      const rawPhone = inbound ? c.from_number : c.to_number;
                      const callbackPhone = typeof rawPhone === "string" && !rawPhone.startsWith("web:") ? rawPhone : null;
                      const transcriptSnippet = isVmMode && c.transcript
                        ? c.transcript.slice(0, 100).trim() + (c.transcript.length > 100 ? "…" : "")
                        : null;
                      return (
                        <Fragment key={c.id}>
                          <tr onClick={() => openPanel(c)} className={cn("group border-b border-white/[0.04] last:border-0 align-middle hover:bg-white/[0.02] transition-colors cursor-pointer", isVmMode ? "h-auto" : "h-8", isVmMode && "bg-amber-500/[0.015]")}>
                            <td className={cn("px-2 py-0.5 text-xs font-medium whitespace-nowrap", isVmMode && "border-l-2 border-l-amber-500/50")}>
                              {contact}
                              {c.is_voicemail && (
                                <span className="ml-1.5 inline-block rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-400">Voicemail</span>
                              )}
                            </td>
                            <td className="px-2 py-0.5">
                              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                {inbound ? <PhoneIncoming className="h-3 w-3 text-primary" /> : <PhoneOutgoing className="h-3 w-3" />}
                                {inbound ? "Inbound" : "Outbound"}
                              </span>
                              {(c.provider as string | null) === "ELEVENLABS" && (
                                <span className="ml-1 inline-block rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-400">VoxStream</span>
                              )}
                              {(c.to_number as string | null)?.startsWith("web:") && (
                                <span className="ml-1 inline-block rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-400">Web</span>
                              )}
                            </td>
                            <td className="px-2 py-0.5 text-muted-foreground text-[11px] whitespace-nowrap">{c.agent_name ?? "—"}</td>
                            <td className="px-2 py-0.5">
                              <span className={cn("rounded-full px-2 py-0.5 text-[10px] capitalize", statusClass(c.call_status))}>
                                {String(c.call_status ?? "").replace(/_/g, " ").trim() || "—"}
                              </span>
                            </td>
                            <td className="px-2 py-0.5">
                              {c.sentiment
                                ? <span className={cn("rounded-full px-2 py-0.5 text-[10px] capitalize", sentimentClass(c.sentiment))}>{c.sentiment}</span>
                                : <span className="text-[11px] text-muted-foreground">—</span>}
                            </td>
                            <td className="max-w-[300px] px-2 py-0.5 text-xs text-muted-foreground align-middle"><SummaryTooltip text={c.call_summary} lines={2} /></td>
                            <td className="whitespace-nowrap px-2 py-0.5 text-muted-foreground tabular-nums text-[11px]">{fmtDuration(c.duration_seconds)}</td>
                            <td className="px-2 py-0.5" onClick={(e) => e.stopPropagation()}>
                              {c.recording_url
                                ? <button onClick={() => setRecordingPlayer({ url: c.recording_url, contact })} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"><PlayCircle className="h-3 w-3" /> Play</button>
                                : <span className="text-[11px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-0.5" onClick={(e) => e.stopPropagation()}>
                              {(c.transcript || c.hasTranscript)
                                ? <button onClick={() => openWbahTranscript(c, contact)} className="inline-flex items-center gap-1 text-[11px] rounded bg-primary/20 text-primary px-2 py-0.5 hover:bg-primary/30 whitespace-nowrap font-medium">Transcript</button>
                                : <span className="text-[11px] text-muted-foreground">—</span>}
                            </td>
                            <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
                              {c.disconnection_reason ? String(c.disconnection_reason).replace(/_/g, " ") : "—"}
                            </td>
                            <td className="whitespace-nowrap px-2 py-0.5 text-muted-foreground text-[11px]">
                              {c.started_at
                                ? new Date(c.started_at).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                                : "Not called yet"}
                            </td>
                            <td className="sticky right-0 bg-card/80 backdrop-blur-sm px-2 py-0.5" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1">
                                {isVmMode && callbackPhone && (
                                  <div className="relative group/callback">
                                    <a
                                      href={`tel:${callbackPhone}`}
                                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors whitespace-nowrap"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <PhoneCall className="h-3 w-3" />
                                      Call back
                                    </a>
                                  </div>
                                )}
                                <div className="relative group/notes flex justify-center">
                                  <button onClick={() => openPanel(c)} className="rounded p-1.5 text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10 transition-colors">
                                    <StickyNote className="h-3.5 w-3.5" />
                                  </button>
                                  <span className="pointer-events-none absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-popover border border-border px-2 py-1 text-[10px] text-foreground shadow opacity-0 group-hover/notes:opacity-100 transition-opacity z-50">Notes</span>
                                </div>
                              </div>
                            </td>
                          </tr>
                          {transcriptSnippet && (
                            <tr className={cn("border-b border-white/[0.04] bg-amber-500/[0.015]")}>
                              <td colSpan={12} className="border-l-2 border-l-amber-500/50 px-2.5 pb-2 pt-0">
                                <div className="flex items-start gap-1.5 text-[11px] text-amber-400/70">
                                  <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
                                  <span className="italic leading-relaxed">{transcriptSnippet}</span>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <TablePagBar page={callsPag.page} pageSize={callsPag.pageSize} totalPages={callsPag.totalPages} total={callsPag.total} setPage={callsPag.setPage} changePageSize={callsPag.changePageSize} />
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Test calls KPI strip */}
          <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-3">
            <KpiCard
              label="Test Calls"
              value={testRows.length}
              icon={FlaskConical}
              iconBg="bg-violet-500/15"
              iconColor="text-violet-400"
            />
            <KpiCard
              label="With Recording"
              value={testRows.filter((r) => r.recording_url).length}
              icon={PlayCircle}
              iconBg="bg-sky-500/15"
              iconColor="text-sky-400"
            />
            <KpiCard
              label="Total Talk"
              value={fmtDuration(testRows.reduce((a, r) => a + (r.duration_seconds ?? 0), 0))}
              icon={Phone}
              iconBg="bg-emerald-500/15"
              iconColor="text-emerald-400"
            />
          </div>

          {/* Test calls table */}
          <div className="min-w-0 overflow-hidden rounded-xl border border-white/[0.06] bg-card/60">
            {testRows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16">
                <FlaskConical className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No test calls yet</p>
                <p className="text-xs text-muted-foreground">Calls made from the builder will appear here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-card/30">
                      <th className="w-6 px-2 py-1" />
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Agent</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Duration</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Channel Type</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Cost</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Session ID</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">End Reason</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Session Status</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sentiment</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">From</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">To</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Direction</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Recording</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testRows.map((c) => (
                      <TestCallRow key={c.id} c={c} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Notes & Booking sheet */}
      {panel && (
        <NotesBookingSheet
          open={!!panel}
          onOpenChange={(o) => { if (!o) setPanel(null); }}
          entityType={panel.entityType}
          entityId={panel.entityId}
          entityName={panel.entityName}
          defaultPhone={panel.defaultPhone}
          defaultEmail={panel.defaultEmail}
          leadId={panel.leadId}
        />
      )}
    </DashboardPage>
  );
}
