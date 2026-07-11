import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
  Target,
  CheckCircle2,
  StickyNote,
  BarChart3,
  PlayCircle,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CallSchedulingSection } from "@/components/dashboard/CallSchedulingSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DashboardPage, KpiCard, SummaryTooltip, stickyCell, stickyHead } from "@/components/dashboard/PageShell";
import { cn } from "@/lib/utils";
import {
  wbahAppointmentDate,
  wbahAppointmentTime,
  wbahBookingStatus,
  isWbahPartialQualified,
  hasWbahAppointmentBooked,
  parseWbahAppointmentIso,
} from "@/lib/dashboard/wbah-appointment-display";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { useTablePagination, TablePagBar } from "@/components/ui/table-pagination";
import { toast } from "sonner";
import { listQualifiedLeads, getQualificationStats } from "@/lib/dashboard/qualified.functions";
import { setLeadStatus, startQualificationCallsForLeads, scheduleQualificationCalls } from "@/lib/dashboard/leads.functions";
import { StartCallsDialog } from "@/components/dashboard/StartCallsDialog";
import { listWbahQualifiedLeads, getWbahContactCallHistory, getWbahCallDetail } from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import { normalizeSentiment } from "@/lib/sentiment";
import { getDashboardLiveAgents } from "@/lib/agents/agents.functions";
import { NotesBookingSheet } from "@/components/dashboard/NotesBookingSheet";
import { PlayRecordingButton } from "@/components/RecordingPlayerDialog";
import { WbahNotesButton, WbahBookedStickyBadge, WbahCallCountBadge, WbahCalendlyLink, wbahAgentColorMapFromLeads } from "@/components/dashboard/WbahNotesButton";
import { useWbahAgentOptions } from "@/hooks/useWbahAgentOptions";
import { wbahDateTimeOptions, WBAH_TIMEZONE } from "@/lib/dashboard/wbah-timezone";
import type { NotesEntityType } from "@/components/dashboard/NotesBookingSheet";

function QualifiedErrorFallback() {
  // No hooks — called in error-recovery context where hooks may be invalid.
  // Trigger reload via setTimeout in render body (safe: no state mutation).
  if (typeof window !== "undefined" && typeof sessionStorage !== "undefined") {
    const key = "qualified-route-error-reload-ts";
    const last = parseInt(sessionStorage.getItem(key) ?? "0");
    if (Date.now() - last > 20_000) {
      sessionStorage.setItem(key, String(Date.now()));
      setTimeout(() => window.location.reload(), 300);
    }
  }
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
      <span className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
      Refreshing data connection…
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/qualified")({
  head: () => ({ meta: [{ title: "Qualified — Webee" }] }),
  component: QualifiedPage,
  errorComponent: QualifiedErrorFallback,
});

function fmtDate(d: string | null, isWbah = false) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString(undefined, wbahDateTimeOptions(isWbah)); } catch { return d; }
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
function fmtCallDate(iso: string | null | undefined, isWbah = false) {
  if (!iso) return "Not called yet";
  try {
    return new Date(iso).toLocaleString(undefined, wbahDateTimeOptions(isWbah, {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }));
  } catch { return iso; }
}

function qualStatusBadge(s: string | null) {
  if (!s) return <span className="text-muted-foreground text-xs">—</span>;
  const map: Record<string, string> = {
    qualified: "bg-emerald-500/15 text-emerald-400",
    partially_qualified: "bg-amber-500/15 text-amber-400",
    not_qualified: "bg-red-500/15 text-red-400",
    callback_required: "bg-blue-500/15 text-blue-400",
  };
  const label = s.replace(/_/g, " ");
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${map[s] ?? "bg-muted text-muted-foreground"}`}>
      {label}
    </span>
  );
}

function scoreBadge(score: number | null) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const color = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";
  return <span className={`font-semibold tabular-nums ${color}`}>{score}</span>;
}

function wbahLeadStatusBadge(lead: { sentiment?: string | null; meta?: { partial_qualified?: boolean } | null }) {
  const ns = normalizeSentiment(lead.sentiment);
  if (ns === "neutral") {
    return isWbahPartialQualified(lead)
      ? <span className="rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 bg-sky-500/15 text-sky-400 ring-sky-500/20">Partial Qualified</span>
      : <span className="rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 bg-amber-500/15 text-amber-400 ring-amber-500/20">Neutral</span>;
  }
  const cfg: Record<string, { label: string; cls: string }> = {
    positive: { label: "Qualified", cls: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/20" },
    negative: { label: "Not Qualified", cls: "bg-red-500/15 text-red-400 ring-red-500/20" },
    unknown: { label: "Unknown", cls: "bg-muted text-muted-foreground ring-border" },
  };
  const { label, cls } = cfg[ns] ?? cfg.unknown;
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${cls}`}>{label}</span>;
}

function boolBadge(v: boolean | null, trueLabel = "Yes", falseLabel = "No") {
  if (v == null) return <span className="text-muted-foreground text-xs">—</span>;
  return v
    ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-400">{trueLabel}</span>
    : <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{falseLabel}</span>;
}

function urgencyBadge(v: string | null) {
  if (!v || v === "none") return <span className="text-muted-foreground text-xs">—</span>;
  const map: Record<string, string> = {
    high: "bg-red-500/15 text-red-400",
    medium: "bg-amber-500/15 text-amber-400",
    low: "bg-emerald-500/15 text-emerald-400",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${map[v] ?? "bg-muted text-muted-foreground"}`}>{v}</span>;
}



function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function callStatusBadge(status: string | null) {
  if (!status) return <span className="text-muted-foreground text-[11px]">—</span>;
  const map: Record<string, string> = {
    completed:   "bg-emerald-500/15 text-emerald-400",
    failed:      "bg-red-500/15 text-red-400",
    no_answer:   "bg-orange-500/15 text-orange-400",
    initiated:   "bg-blue-500/15 text-blue-400",
    in_progress: "bg-blue-500/15 text-blue-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize whitespace-nowrap ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function bookingStatusBadge(status: string | null) {
  if (!status) return <span className="text-muted-foreground text-[11px]">—</span>;
  const lower = status.toLowerCase();
  const map: Record<string, string> = {
    booked:    "bg-emerald-500/15 text-emerald-400",
    confirmed: "bg-emerald-500/15 text-emerald-400",
    success:   "bg-emerald-500/15 text-emerald-400",
    pending:   "bg-amber-500/15 text-amber-400",
    cancelled: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize whitespace-nowrap ${map[lower] ?? "bg-muted text-muted-foreground"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const STATUS_ACTIONS = [
  { value: "qualified" as const, label: "Qualified", color: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30" },
  { value: "interested" as const, label: "Open", color: "bg-blue-500/15 text-blue-400 ring-blue-500/30" },
  { value: "not_interested" as const, label: "Closed", color: "bg-red-500/15 text-red-400 ring-red-500/30" },
];

type PanelTarget = {
  entityType: NotesEntityType;
  entityId: string;
  entityName: string;
  defaultPhone?: string;
  defaultEmail?: string;
  leadId?: string | null;
  callSummary?: string | null;
};

function QualifiedPage() {
  const qc = useQueryClient();
  const getLeads = useServerFn(listQualifiedLeads);
  const getWbahQualified = useServerFn(listWbahQualifiedLeads);
  const getStats = useServerFn(getQualificationStats);
  const setStatusFn = useServerFn(setLeadStatus);

  const [search, setSearch] = useState("");
  const [wbahDaysFilter, setWbahDaysFilter] = useState("30");
  const [wbahAgentFilter, setWbahAgentFilter] = useState("all");
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const [wbahTranscript, setWbahTranscript] = useState<string | null>(null);
  const [qualTab, setQualTab] = useState<"contacts" | "campaigns">("contacts");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const startCallsFn = useServerFn(startQualificationCallsForLeads);
  const scheduleCallsFn = useServerFn(scheduleQualificationCalls);
  const listAgentsFn = useServerFn(getDashboardLiveAgents);
  const getContactHistoryFn = useServerFn(getWbahContactCallHistory);
  const getCallDetailFn = useServerFn(getWbahCallDetail);
  const [callHistory, setCallHistory] = useState<{ name: string; phone: string; loading: boolean; calls: any[] } | null>(null);

  function fmtDurQ(sec: number | null | undefined) {
    if (sec == null) return "—";
    const m = Math.floor(sec / 60); const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  async function openCallHistory(lead: any) {
    if (!lead?.phone) return;
    setCallHistory({ name: lead.full_name ?? "Contact", phone: lead.phone, loading: true, calls: [] });
    try {
      const res = await getContactHistoryFn({ data: { phone: lead.phone } });
      setCallHistory({ name: lead.full_name ?? "Contact", phone: lead.phone, loading: false, calls: (res as any)?.calls ?? [] });
    } catch {
      setCallHistory({ name: lead.full_name ?? "Contact", phone: lead.phone, loading: false, calls: [] });
    }
  }
  async function openHistoryTranscript(call: any) {
    if (!call?.id) return;
    setWbahTranscript("Loading transcript…");
    try {
      const d = await getCallDetailFn({ data: { id: String(call.id) } });
      setWbahTranscript((d as any)?.transcript || "No transcript available.");
    } catch { setWbahTranscript("Failed to load transcript."); }
  }

  const [isWbah, setIsWbah] = useState(false);
  const [isWbahResolved, setIsWbahResolved] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) { if (active) setIsWbahResolved(true); return; }
        const { data: profile } = await supabase
          .from("profiles")
          .select("default_workspace_id")
          .eq("user_id", sess.session.user.id)
          .maybeSingle();
        if (!active) return;
        if (!profile?.default_workspace_id) { setIsWbahResolved(true); return; }
        const { data: ws } = await supabase
          .from("workspaces")
          .select("slug")
          .eq("id", profile.default_workspace_id)
          .maybeSingle();
        if (!active) return;
        setIsWbah(ws?.slug === "webuyanyhouse");
        setIsWbahResolved(true);
      } catch { if (active) setIsWbahResolved(true); }
    })();
    return () => { active = false; };
  }, []);

  const agentsQ = useQuery({
    queryKey: ["qual-agents"],
    queryFn: () => listAgentsFn(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });
  const callAgents = (agentsQ.data ?? [])
    .filter((a: any) => a.agentType === "client_qualification")
    .map((a: any) => ({ id: a.id, name: a.name, phoneNumber: a.phoneNumber ?? null }));
  const qualAgents = (agentsQ.data ?? []) as Array<{ id: string; name: string; retell_agent_id?: string | null }>;

  const leadsQ = useQuery({
    queryKey: ["leads-qualified", search],
    queryFn: () =>
      getLeads({
        data: {
          search: search || undefined,
          limit: 200,
        },
      }),
    enabled: isWbahResolved && !isWbah,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const wbahLeadsQ = useQuery({
    queryKey:             ["wbah-qualified-leads"],
    queryFn:              () => getWbahQualified(),
    enabled:              isWbahResolved && isWbah,
    staleTime:            5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError:         false,
  });

  const statsQ = useQuery({
    queryKey:             ["qualification-stats"],
    queryFn:              () => getStats(),
    staleTime:            5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError:         false,
  });

  const rows = (isWbah ? (wbahLeadsQ.data ?? []) : (leadsQ.data ?? [])) as any[];
  const stats = statsQ.data;

  const isRetell = useMemo(() =>
    !isWbah && rows.some((l: any) => l.retell_call != null),
    [rows, isWbah],
  );

  const filtered = useMemo(() => {
    let out = rows;
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((r: any) =>
      (r.full_name ?? "").toLowerCase().includes(q) ||
      (r.phone ?? "").toLowerCase().includes(q) ||
      (r.company_name ?? "").toLowerCase().includes(q));
    if (wbahAgentFilter !== "all") {
      out = out.filter((r: any) => (r.meta?.agent_name ?? "") === wbahAgentFilter);
    }
    if (wbahDaysFilter !== "all") {
      const { dateFrom, dateTo } = filterToDates(wbahDaysFilter);
      out = out.filter((r: any) => {
        // Booked contacts stay visible when the appointment falls in range,
        // even if the qualifying call was outside the window.
        if (hasWbahAppointmentBooked(r)) {
          const apptIso = parseWbahAppointmentIso(
            r.meta?.appointment_date,
            r.meta?.appointment_time,
            r.meta?.calendly_booking_url,
          );
          if (apptIso) {
            const ts = new Date(apptIso).getTime();
            if (!isNaN(ts)) {
              if (dateFrom && ts < new Date(dateFrom).getTime()) return false;
              if (dateTo && ts > new Date(dateTo).getTime()) return false;
              return true;
            }
          }
          // Booked but no parseable appt date — always show.
          return true;
        }
        const dateStr = r.meta?.last_called_at ?? r.last_contacted_at ?? r.created_at ?? null;
        if (!dateStr) return false;
        const ts = new Date(dateStr).getTime();
        if (isNaN(ts)) return false;
        if (dateFrom && ts < new Date(dateFrom).getTime()) return false;
        if (dateTo && ts > new Date(dateTo).getTime()) return false;
        return true;
      });
    }
    return out;
  }, [rows, search, isWbah, wbahDaysFilter, wbahAgentFilter]);

  const wbahAgentNamesFromData = useMemo(
    () => (rows as any[]).map((r) => r.meta?.agent_name as string | undefined),
    [rows],
  );
  const { options: wbahAgentOptions } = useWbahAgentOptions(wbahAgentNamesFromData, isWbah);

  const qualPag = useTablePagination(filtered);

  const wbahAgentColorMap = useMemo(
    () => (isWbah ? wbahAgentColorMapFromLeads(rows) : new Map()),
    [isWbah, rows],
  );


  async function handleSetStatus(id: string, status: typeof STATUS_ACTIONS[number]["value"]) {
    try {
      await setStatusFn({ data: { id, status } });
      toast.success("Status updated");
      qc.invalidateQueries({ queryKey: ["leads-qualified"] });
      qc.invalidateQueries({ queryKey: ["qualification-stats"] });
      qc.invalidateQueries({ queryKey: ["leads-all"] });
    } catch (e) {
      toast.error("Failed", { description: (e as Error).message });
    }
  }

  function openCallDialog() {
    if (selectedIds.size === 0) {
      toast.error("Select at least one contact first");
      return;
    }
    setCallDialogOpen(true);
  }

  async function handleStartCalls({ agentId, fromNumber }: { agentId: string; fromNumber: string | null }) {
    try {
      const result = await startCallsFn({
        data: { leadIds: Array.from(selectedIds), agentId, fromNumber },
      });
      const limitMsg = (result as any).limitReached > 0
        ? ` · ${(result as any).limitReached} at daily limit`
        : "";
      toast.success(`Calling started — ${result.placed} calls placed`, {
        description: result.failed > 0 ? `${result.failed} failed${limitMsg}` : limitMsg || undefined,
      });
      setCallDialogOpen(false);
      setSelectedIds(new Set());
      refresh();
    } catch (e) {
      toast.error("Failed to start calls", { description: (e as Error).message });
    }
  }

  async function handleScheduleCalls({
    agentId,
    fromNumber,
    scheduledAtIso,
  }: { agentId: string; fromNumber: string | null; scheduledAtIso: string }) {
    try {
      const result = await scheduleCallsFn({
        data: { leadIds: Array.from(selectedIds), agentId, fromNumber, scheduledAt: scheduledAtIso },
      });
      toast.success(`${result.scheduled} contact${result.scheduled !== 1 ? "s" : ""} scheduled`, {
        description: `Calls will be placed at ${new Date(scheduledAtIso).toLocaleString(undefined, wbahDateTimeOptions(isWbah))}`,
      });
      setCallDialogOpen(false);
      setSelectedIds(new Set());
      refresh();
    } catch (e) {
      toast.error("Failed to schedule calls", { description: (e as Error).message });
    }
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: ["leads-qualified"] });
    qc.invalidateQueries({ queryKey: ["wbah-qualified-leads"] });
    qc.invalidateQueries({ queryKey: ["qualification-stats"] });
    qc.invalidateQueries({ queryKey: ["leads-all"] });
    qc.invalidateQueries({ queryKey: ["calendar-bookings"] });
  }

  async function openWbahTranscriptFromLead(lead: any) {
    if (!lead?.id) return;
    setWbahTranscript("Loading transcript…");
    try {
      const d = await getCallDetailFn({ data: { id: String(lead.id) } });
      setWbahTranscript((d as any)?.transcript || "No transcript available.");
    } catch {
      setWbahTranscript("Failed to load transcript.");
    }
  }
  function openPanel(lead: any) {
    setPanel({
      entityType: "lead",
      entityId: lead.id,
      entityName: lead.full_name ?? lead.phone ?? "Lead",
      defaultPhone: lead.phone ?? undefined,
      defaultEmail: lead.email ?? undefined,
      leadId: lead.id,
      callSummary: lead.call_summary ?? null,
    });
  }

  return (
    <DashboardPage>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm font-semibold tracking-tight">Qualified</h1>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Contacts scored and routed after qualification calls
          </p>
        </div>
        <div className="flex items-center gap-2">
          {qualTab === "contacts" && !isWbah && selectedIds.size > 0 && (
            <Button size="sm" variant="outline" className="border-blue-500/30 text-blue-400 hover:text-blue-300" onClick={openCallDialog}>
              <ShieldCheck className="mr-1 h-4 w-4" />
              Call {selectedIds.size} Contact{selectedIds.size !== 1 ? "s" : ""}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2.5 text-xs" onClick={refresh}>
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06]">
        {(["contacts", "campaigns"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setQualTab(t)}
            className={`px-2 py-0.5 text-[11px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              qualTab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "contacts" ? (
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Contacts
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Campaigns
              </span>
            )}
          </button>
        ))}
      </div>

      {qualTab === "campaigns" && (
        <CallSchedulingSection
          pageType="qualified"
          statusOptions={[
            { value: "qualified", label: "Qualified" },
            { value: "partially_qualified", label: "Partially Qualified" },
            { value: "not_qualified", label: "Not Qualified" },
            { value: "callback_required", label: "Callback Required" },
          ]}
          agents={qualAgents}
        />
      )}

      {qualTab === "contacts" && (
      <>
      {/* KPI strip */}
      {(() => {
        const wbahTotal = isWbah ? filtered.length : 0;
        const wbahBooked = isWbah ? filtered.filter((r: any) => hasWbahAppointmentBooked(r)).length : 0;
        const wbahPositive = isWbah ? filtered.filter((r: any) => normalizeSentiment(r.sentiment) === "positive").length : 0;
        return (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <KpiCard
              label="Total Qualified"
              value={isWbah ? wbahTotal : (stats?.total ?? "—")}
              icon={Users}
              iconBg="bg-blue-500/15"
              iconColor="text-blue-400"
              hint={isWbah ? "positive or booked" : undefined}
            />
            <KpiCard
              label={isWbah ? "Positive Sentiment" : "Qualified"}
              value={isWbah ? wbahPositive : (stats?.qualified ?? "—")}
              icon={ShieldCheck}
              iconBg="bg-emerald-500/15"
              iconColor="text-emerald-400"
              hint={!isWbah && stats && stats.total > 0 ? `${stats.qualificationRate}% rate` : undefined}
            />
            <KpiCard
              label={isWbah ? "Booked Appointment" : "Partly Qualified"}
              value={isWbah ? wbahBooked : (stats?.partiallyQualified ?? "—")}
              icon={isWbah ? CheckCircle2 : TrendingUp}
              iconBg="bg-amber-500/15"
              iconColor="text-amber-400"
            />
            <KpiCard label="Avg Score" value={isWbah ? "—" : (stats?.avgScore ?? "—")} icon={Target} iconBg="bg-violet-500/15" iconColor="text-violet-400" />
          </div>
        );
      })()}

      {/* Filter bar — WBAH matches Calls page layout */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <div className="relative min-w-0 flex-shrink-0">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or phone…"
              className="h-6 min-w-0 flex-1 basis-28 max-w-[180px] pl-7 text-[11px] sm:flex-none sm:w-36"
            />
          </div>
          <select
            value={wbahDaysFilter}
            onChange={(e) => setWbahDaysFilter(e.target.value)}
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
          </select>
          {(isWbah || wbahAgentOptions.length > 0) && (
            <select
              value={wbahAgentFilter}
              onChange={(e) => setWbahAgentFilter(e.target.value)}
              className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            >
              <option value="all">All agents</option>
              {wbahAgentOptions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          )}
          {search.trim() && (
            <span className="text-[11px] text-muted-foreground">{filtered.length} matching</span>
          )}
      </div>

      {/* Table */}
      <div className="min-w-0 overflow-hidden rounded-xl border border-white/[0.06] bg-card/60">
        <div className="p-0">
          {(isWbah ? wbahLeadsQ.isLoading : leadsQ.isLoading) ? (
            <LoadingProgress label="Loading qualified contacts" estimatedMs={8000} />
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="h-7 w-7 text-muted-foreground/50" />
              <h3 className="mt-3 text-sm font-medium">No qualified contacts yet</h3>
              <p className="mt-1 text-xs text-muted-foreground max-w-xs mx-auto">
                Build a Client Qualification agent, run calls, and qualified contacts will appear here automatically.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="h-7 w-7 text-muted-foreground/50" />
              <h3 className="mt-3 text-sm font-medium">No contacts match your filters</h3>
              <p className="mt-1 text-xs text-muted-foreground max-w-xs mx-auto">
                Try widening the date range or clearing the search and agent filters.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-7 text-xs"
                onClick={() => { setSearch(""); setWbahAgentFilter("all"); setWbahDaysFilter("all"); }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-card/30">
                    {!isWbah && (
                      <th className="px-2 py-1 w-6">
                        <input
                          type="checkbox"
                          className="h-3 w-3 accent-blue-500"
                          checked={qualPag.sliced.length > 0 && qualPag.sliced.every((l: any) => selectedIds.has(l.id))}
                          onChange={(e) => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              for (const l of qualPag.sliced) {
                                if (e.target.checked) next.add(l.id); else next.delete(l.id);
                              }
                              return next;
                            });
                          }}
                        />
                      </th>
                    )}
                    <th className={cn("px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground", isWbah && cn(stickyHead, "left-0 w-28"))}>Name</th>
                    <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Phone</th>
                    <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Status</th>
                    {!isWbah && <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Score</th>}
                    {!isWbah && <>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Budget</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Decision</th>
                    </>}
                    {!isWbah && <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Interest</th>}
                    {!isWbah && <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Urgency</th>}
                    <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Summary</th>
                    {!isWbah && <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Next Step</th>}
                    {!isWbah && <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Last Contact</th>}
                    <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Last Called At</th>
                    {isRetell && <>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Call Status</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Duration</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recording</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Transcript</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">End Reason</th>
                    </>}
                    {isWbah && <>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Call Status</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Duration</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recording</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Transcript</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Appt Date</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Appt Time</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Booking</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Calendly</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">End Reason</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Disconnection</th>
                    </>}
                    {!isWbah && <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Actions</th>}
                    <th className="px-2 py-1 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {qualPag.sliced.map((lead: any) => (
                    <tr
                      key={lead.id}
                      className="group h-8 border-b border-white/[0.04] align-middle hover:bg-white/[0.02] transition-colors"
                    >
                      {!isWbah && (
                        <td className="px-2 py-0.5">
                          <input
                            type="checkbox"
                            className="h-3 w-3 accent-blue-500"
                            checked={selectedIds.has(lead.id)}
                            onChange={(e) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(lead.id); else next.delete(lead.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                      )}
                      <td className={cn("px-2 py-0.5", isWbah && cn(stickyCell, "left-0 w-28 max-w-[7rem] overflow-hidden"))}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="truncate text-[11px] font-medium min-w-0">{lead.full_name ?? "—"}</span>
                            {isWbah && (
                              <WbahCallCountBadge
                                count={lead.meta?.call_count ?? 1}
                                onClick={() => openCallHistory(lead)}
                              />
                            )}
                            {isWbah && (
                              <WbahBookedStickyBadge lead={lead} agentColorMap={wbahAgentColorMap} />
                            )}
                          </div>
                          {lead.company_name && !isWbah && (
                            <div className="truncate text-[10px] text-muted-foreground font-normal">{lead.company_name}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-0.5 text-muted-foreground whitespace-nowrap text-[10px] font-mono tabular-nums">
                        {lead.phone}
                      </td>
                      <td className="px-2 py-0.5">
                        {isWbah
                          ? wbahLeadStatusBadge(lead)
                          : qualStatusBadge(lead.qualification_status ?? lead.status)}
                      </td>
                      {!isWbah && <td className="px-2 py-0.5">{scoreBadge(lead.qualification_score ?? lead.lead_score)}</td>}
                      {!isWbah && <>
                        <td className="px-2 py-0.5">{boolBadge(lead.budget_confirmed, "✓", "—")}</td>
                        <td className="px-2 py-0.5">{boolBadge(lead.decision_maker, "✓", "—")}</td>
                      </>}
                      {!isWbah && (
                        <td className="px-2 py-0.5">
                          {lead.interest_level
                            ? <span className="text-[11px] capitalize text-muted-foreground">{lead.interest_level}</span>
                            : "—"}
                        </td>
                      )}
                      {!isWbah && <td className="px-2 py-0.5">{urgencyBadge(lead.urgency)}</td>}
                      <td className="px-2 py-0.5 text-[11px] text-muted-foreground max-w-[200px] align-middle">
                        <SummaryTooltip text={lead.call_summary} lines={2} />
                      </td>
                      {!isWbah && (
                        <td className="px-2 py-0.5 text-[11px] text-muted-foreground max-w-[160px] align-middle">
                          <span className="line-clamp-1">{lead.next_action ?? lead.next_step ?? "—"}</span>
                        </td>
                      )}
                      {!isWbah && (
                        <td className="px-2 py-0.5 text-muted-foreground whitespace-nowrap text-[11px]">
                          {fmtDate(lead.last_contacted_at, isWbah)}
                        </td>
                      )}
                      <td className="px-2 py-0.5 text-muted-foreground whitespace-nowrap text-[10px]">
                        {fmtCallDate(
                          isWbah ? lead.meta?.last_called_at
                          : isRetell ? lead.retell_call?.started_at
                          : lead.last_contacted_at,
                          isWbah
                        )}
                      </td>
                      {isRetell && <>
                        <td className="px-2 py-0.5">{callStatusBadge(lead.retell_call?.call_status)}</td>
                        <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{fmtDuration((lead.retell_call?.duration_seconds ?? 0) * 1000)}</td>
                        <td className="px-2 py-0.5">
                          {lead.retell_call?.recording_url
                            ? <PlayRecordingButton url={lead.retell_call.recording_url} contact={lead.name ?? lead.phone ?? "Lead"} className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-blue-400/80 hover:text-blue-400 hover:bg-blue-500/10 border border-blue-500/20 transition-colors whitespace-nowrap" />
                            : <span className="text-muted-foreground text-[11px]">—</span>}
                        </td>
                        <td className="px-2 py-0.5">
                          {lead.retell_call?.transcript
                            ? <button onClick={() => setWbahTranscript(lead.retell_call.transcript)} className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-violet-400/80 hover:text-violet-400 hover:bg-violet-500/10 border border-violet-500/20 transition-colors whitespace-nowrap"><span>Transcript</span></button>
                            : <span className="text-muted-foreground text-[11px]">—</span>}
                        </td>
                        <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
                          {lead.retell_call?.disconnection_reason ? String(lead.retell_call.disconnection_reason).replace(/_/g, " ") : "—"}
                        </td>
                      </>}
                      {isWbah && <>
                        <td className="px-2 py-0.5">{callStatusBadge(lead.meta?.call_status)}</td>
                        <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{fmtDuration(lead.meta?.duration_ms)}</td>
                        <td className="px-2 py-0.5">
                          {lead.meta?.recording_url
                            ? <PlayRecordingButton url={lead.meta.recording_url} contact={lead.name ?? lead.phone ?? "Lead"} className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-blue-400/80 hover:text-blue-400 hover:bg-blue-500/10 border border-blue-500/20 transition-colors whitespace-nowrap" />
                            : <span className="text-muted-foreground text-[11px]">—</span>}
                        </td>
                        <td className="px-2 py-0.5">
                          {isWbah
                            ? (lead.meta?.has_transcript
                              ? <button onClick={() => openWbahTranscriptFromLead(lead)} className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-violet-400/80 hover:text-violet-400 hover:bg-violet-500/10 border border-violet-500/20 transition-colors whitespace-nowrap"><span>Transcript</span></button>
                              : <span className="text-muted-foreground text-[11px]">—</span>)
                            : lead.call_summary
                            ? <button onClick={() => setWbahTranscript(lead.call_summary)} className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-violet-400/80 hover:text-violet-400 hover:bg-violet-500/10 border border-violet-500/20 transition-colors whitespace-nowrap"><span>Transcript</span></button>
                            : <span className="text-muted-foreground text-[11px]">—</span>}
                        </td>
                        <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{wbahAppointmentDate(lead) ?? "—"}</td>
                        <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{wbahAppointmentTime(lead) ?? "—"}</td>
                        <td className="px-2 py-0.5">{bookingStatusBadge(wbahBookingStatus(lead))}</td>
                        <td className="px-2 py-0.5"><WbahCalendlyLink lead={lead} /></td>
                        <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{lead.meta?.end_reason ?? "—"}</td>
                        <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{lead.meta?.disconnection_reason ?? "—"}</td>
                      </>}
                      {!isWbah && (
                      <td className="px-2 py-0.5">
                        <div className="flex gap-1">
                          {STATUS_ACTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              title={`Mark as ${opt.label}`}
                              onClick={() => handleSetStatus(lead.id, opt.value)}
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-opacity ring-1 ${opt.color} ${lead.status === opt.value ? "opacity-100" : "opacity-40 hover:opacity-80"}`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </td>
                      )}
                      <td className="px-2 py-0.5">
                        {isWbah ? (
                          <WbahNotesButton
                            lead={lead}
                            agentColorMap={wbahAgentColorMap}
                            onClick={() => openPanel(lead)}
                          />
                        ) : (
                        <button
                          onClick={() => openPanel(lead)}
                          title="Notes & appointment"
                          className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
                        >
                          <StickyNote className="h-3 w-3" />
                          <span>Notes</span>
                        </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagBar page={qualPag.page} pageSize={qualPag.pageSize} totalPages={qualPag.totalPages} total={qualPag.total} setPage={qualPag.setPage} changePageSize={qualPag.changePageSize} />
            </div>
          )}
        </div>
      </div>
      </>
      )}

      {/* Contact call-history drill-down */}
      {callHistory !== null && (
        <Dialog open onOpenChange={() => setCallHistory(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{callHistory.name} — Call History</DialogTitle>
              <DialogDescription>
                {callHistory.phone} · {callHistory.calls.length} call{callHistory.calls.length !== 1 ? "s" : ""}. The row shows the definitive outcome (a positive call wins); all attempts are listed here.
              </DialogDescription>
            </DialogHeader>
            {callHistory.loading ? (
              <div className="py-8 flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading calls…
              </div>
            ) : callHistory.calls.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No calls found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-1.5">Date</th>
                      <th className="px-2 py-1.5">Status</th>
                      <th className="px-2 py-1.5">Sentiment</th>
                      <th className="px-2 py-1.5">Duration</th>
                      <th className="px-2 py-1.5">Agent</th>
                      <th className="px-2 py-1.5">Recording</th>
                      <th className="px-2 py-1.5">Transcript</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callHistory.calls.map((c: any) => (
                      <tr key={c.id} className="border-b border-white/[0.04] align-middle">
                        <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{c.startedAt ? new Date(c.startedAt).toLocaleString(undefined, { timeZone: WBAH_TIMEZONE }) : "—"}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap capitalize">{(c.callStatus ?? "—").replace(/_/g, " ")}</td>
                        <td className="px-2 py-1.5 capitalize">{c.sentiment ?? "—"}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{fmtDurQ(c.durationSeconds)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{c.agentName ?? "—"}</td>
                        <td className="px-2 py-1.5">
                          {c.recordingUrl
                            ? <PlayRecordingButton url={c.recordingUrl} contact={callHistory.name || callHistory.phone || "Lead"} className="inline-flex items-center gap-1 text-primary hover:underline" />
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          {c.hasTranscript
                            ? <button onClick={() => openHistoryTranscript(c)} className="text-violet-400 hover:underline">View</button>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* WBAH Transcript modal */}
      {wbahTranscript !== null && (
        <Dialog open onOpenChange={() => setWbahTranscript(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Call Transcript</DialogTitle>
              <DialogDescription>Full transcript of the call recording.</DialogDescription>
            </DialogHeader>
            <pre className="whitespace-pre-wrap text-xs text-muted-foreground font-sans leading-relaxed">{wbahTranscript}</pre>
          </DialogContent>
        </Dialog>
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
          callSummary={panel.callSummary}
        />
      )}

      {/* Start/Schedule Calling Dialog */}
      <StartCallsDialog
        open={callDialogOpen}
        onOpenChange={setCallDialogOpen}
        count={selectedIds.size}
        entityLabel="contact"
        title="Call Qualified Contacts"
        agents={callAgents}
        defaultAgentId={callAgents[0]?.id}
        noAgentsMessage="No live Client Qualification agents found. Build and go-live with a qualification agent in the Builder first."
        footerNote="Max 3 call attempts per contact per day — contacts at the limit will be skipped."
        scheduleHint='Click "Run Scheduled" on the Leads page when the time arrives to fire the calls.'
        onStart={handleStartCalls}
        onSchedule={handleScheduleCalls}
      />
    </DashboardPage>
  );
}
