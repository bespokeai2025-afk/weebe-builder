import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
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
import { KpiCard, SummaryTooltip } from "@/components/dashboard/PageShell";
import { useTablePagination, TablePagBar } from "@/components/ui/table-pagination";
import { toast } from "sonner";
import { listQualifiedLeads, getQualificationStats } from "@/lib/dashboard/qualified.functions";
import { setLeadStatus, listLeads } from "@/lib/dashboard/leads.functions";
import { normalizeSentiment } from "@/lib/sentiment";
import { listLiveAgents } from "@/lib/agents/agents.functions";
import { NotesBookingSheet } from "@/components/dashboard/NotesBookingSheet";
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

function fmtDate(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString(); } catch { return d; }
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
};

function QualifiedPage() {
  const qc = useQueryClient();
  const getLeads = useServerFn(listQualifiedLeads);
  const getAllLeads = useServerFn(listLeads);
  const getStats = useServerFn(getQualificationStats);
  const setStatusFn = useServerFn(setLeadStatus);

  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const [wbahTranscript, setWbahTranscript] = useState<string | null>(null);
  const [qualTab, setQualTab] = useState<"contacts" | "campaigns">("contacts");
  const listAgentsFn = useServerFn(listLiveAgents);

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
    refetchOnWindowFocus: false,
    throwOnError: false,
  });
  const qualAgents = (agentsQ.data ?? []) as Array<{ id: string; name: string; retell_agent_id?: string | null }>;

  const leadsQ = useQuery({
    queryKey: ["leads-qualified", search],
    queryFn: () =>
      getLeads({
        data: {
          search: search || undefined,
          qualificationStatus: "qualified",
          limit: 200,
        },
      }),
    enabled: isWbahResolved && !isWbah,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const wbahLeadsQ = useQuery({
    queryKey: ["leads-wbah-all-qual"],
    queryFn: () => getAllLeads({ data: { limit: 5000 } }),
    enabled: isWbahResolved && isWbah,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const statsQ = useQuery({
    queryKey: ["qualification-stats"],
    queryFn: () => getStats(),
    refetchOnWindowFocus: false,
    throwOnError: false,
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
    if (isWbah) out = out.filter((r: any) => normalizeSentiment(r.sentiment) === "positive");
    return out;
  }, [rows, search, isWbah]);

  useEffect(() => {
    if (!isWbah || !import.meta.env.DEV) return;
    const all = (wbahLeadsQ.data ?? []) as any[];
    const pos = all.filter((r: any) => normalizeSentiment(r.sentiment) === "positive").length;
    const neu = all.filter((r: any) => normalizeSentiment(r.sentiment) === "neutral").length;
    const neg = all.filter((r: any) => normalizeSentiment(r.sentiment) === "negative").length;
    const unk = all.filter((r: any) => normalizeSentiment(r.sentiment) === "unknown").length;
    console.log("[WBAH Qualified] total=%d positive=%d neutral=%d negative=%d unknown=%d qualifiedPageCount=%d",
      all.length, pos, neu, neg, unk, pos);
  }, [isWbah, wbahLeadsQ.data]);

  const qualPag = useTablePagination(filtered, 50);


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

  function refresh() {
    qc.invalidateQueries({ queryKey: ["leads-qualified"] });
    qc.invalidateQueries({ queryKey: ["qualification-stats"] });
    qc.invalidateQueries({ queryKey: ["leads-all"] });
  }

  function openPanel(lead: any) {
    setPanel({
      entityType: "lead",
      entityId: lead.id,
      entityName: lead.full_name ?? lead.phone ?? "Lead",
      defaultPhone: lead.phone ?? undefined,
      defaultEmail: lead.email ?? undefined,
      leadId: lead.id,
    });
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-5">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Qualified</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Contacts scored and routed after qualification calls
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-white/[0.06]">
        {(["contacts", "campaigns"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setQualTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
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
        const wbahAll = (wbahLeadsQ.data ?? []) as any[];
        const wbahPos = isWbah ? filtered.length : 0;
        const wbahNeu = isWbah ? wbahAll.filter((r: any) => normalizeSentiment(r.sentiment) === "neutral").length : 0;
        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-5">
            <KpiCard label="Total Qualified" value={isWbah ? wbahPos : (stats?.total ?? "—")} icon={Users} iconBg="bg-blue-500/15" iconColor="text-blue-400" />
            <KpiCard
              label="Qualified"
              value={isWbah ? wbahPos : (stats?.qualified ?? "—")}
              icon={ShieldCheck}
              iconBg="bg-emerald-500/15"
              iconColor="text-emerald-400"
              hint={isWbah ? "positive sentiment only" : (stats && stats.total > 0 ? `${stats.qualificationRate}% rate` : undefined)}
            />
            <KpiCard label="Partly Qualified" value={isWbah ? wbahNeu : (stats?.partiallyQualified ?? "—")} icon={TrendingUp} iconBg="bg-amber-500/15" iconColor="text-amber-400" />
            <KpiCard label="Avg Score" value={isWbah ? "—" : (stats?.avgScore ?? "—")} icon={Target} iconBg="bg-violet-500/15" iconColor="text-violet-400" />
          </div>
        );
      })()}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone…"
            className="h-8 w-52 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
        <div className="p-0">
          {leadsQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <h3 className="mt-3 text-sm font-medium">No qualified contacts yet</h3>
              <p className="mt-1 text-xs text-muted-foreground max-w-xs mx-auto">
                Build a Client Qualification agent, run calls, and qualified contacts will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-card/30">
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Name</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Phone</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Score</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Budget</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Decision</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Interest</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Urgency</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Summary</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Next Step</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Last Contact</th>
                    {isRetell && <>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">Call Status</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">Duration</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Recording</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Transcript</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">End Reason</th>
                    </>}
                    {isWbah && <>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">Call Status</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">Duration</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Recording</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Transcript</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">Appt Date</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">Appt Time</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">Booking</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">End Reason</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground whitespace-nowrap">Disconnection</th>
                    </>}
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Actions</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {qualPag.sliced.map((lead: any) => (
                    <tr
                      key={lead.id}
                      className="h-9 border-b border-white/[0.04] align-middle hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-3 py-1.5 text-xs font-medium whitespace-nowrap">
                        {lead.full_name ?? "—"}
                        {lead.company_name && (
                          <div className="text-[11px] text-muted-foreground font-normal">{lead.company_name}</div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap text-[11px] font-mono">
                        {lead.phone}
                      </td>
                      <td className="px-3 py-1.5">
                        {qualStatusBadge(lead.qualification_status ?? lead.status)}
                      </td>
                      <td className="px-3 py-1.5">{scoreBadge(lead.qualification_score ?? lead.lead_score)}</td>
                      <td className="px-3 py-1.5">{boolBadge(lead.budget_confirmed, "✓", "—")}</td>
                      <td className="px-3 py-1.5">{boolBadge(lead.decision_maker, "✓", "—")}</td>
                      <td className="px-3 py-1.5">
                        {lead.interest_level ? (
                          <span className="text-[11px] capitalize text-muted-foreground">{lead.interest_level}</span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-1.5">{urgencyBadge(lead.urgency)}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground max-w-[200px] align-middle">
                        <SummaryTooltip text={lead.call_summary} lines={2} />
                      </td>
                      <td className="px-3 py-1.5 text-[11px] text-muted-foreground max-w-[160px] align-middle">
                        <span className="line-clamp-1">{lead.next_step ?? lead.next_action ?? "—"}</span>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap text-[11px]">
                        {fmtDate(lead.last_contacted_at)}
                      </td>
                      {isRetell && <>
                        <td className="px-3 py-1.5">{callStatusBadge(lead.retell_call?.call_status)}</td>
                        <td className="px-3 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">{fmtDuration((lead.retell_call?.duration_seconds ?? 0) * 1000)}</td>
                        <td className="px-3 py-1.5">
                          {lead.retell_call?.recording_url
                            ? <a href={lead.retell_call.recording_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-blue-400/80 hover:text-blue-400 hover:bg-blue-500/10 border border-blue-500/20 transition-colors whitespace-nowrap"><PlayCircle className="h-3 w-3" /><span>Play</span></a>
                            : <span className="text-muted-foreground text-[11px]">—</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {lead.retell_call?.transcript
                            ? <button onClick={() => setWbahTranscript(lead.retell_call.transcript)} className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-violet-400/80 hover:text-violet-400 hover:bg-violet-500/10 border border-violet-500/20 transition-colors whitespace-nowrap"><span>Transcript</span></button>
                            : <span className="text-muted-foreground text-[11px]">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
                          {lead.retell_call?.disconnection_reason ? String(lead.retell_call.disconnection_reason).replace(/_/g, " ") : "—"}
                        </td>
                      </>}
                      {isWbah && <>
                        <td className="px-3 py-1.5">{callStatusBadge(lead.meta?.call_status)}</td>
                        <td className="px-3 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">{fmtDuration(lead.meta?.duration_ms)}</td>
                        <td className="px-3 py-1.5">
                          {lead.meta?.recording_url
                            ? <a href={lead.meta.recording_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-blue-400/80 hover:text-blue-400 hover:bg-blue-500/10 border border-blue-500/20 transition-colors whitespace-nowrap"><PlayCircle className="h-3 w-3" /><span>Play</span></a>
                            : <span className="text-muted-foreground text-[11px]">—</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {lead.call_summary
                            ? <button onClick={() => setWbahTranscript(lead.call_summary)} className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-violet-400/80 hover:text-violet-400 hover:bg-violet-500/10 border border-violet-500/20 transition-colors whitespace-nowrap"><span>Transcript</span></button>
                            : <span className="text-muted-foreground text-[11px]">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">{lead.meta?.appointment_date ?? "—"}</td>
                        <td className="px-3 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">{lead.meta?.appointment_time ?? "—"}</td>
                        <td className="px-3 py-1.5">{bookingStatusBadge(lead.meta?.booking_status)}</td>
                        <td className="px-3 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">{lead.meta?.end_reason ?? "—"}</td>
                        <td className="px-3 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">{lead.meta?.disconnection_reason ?? "—"}</td>
                      </>}
                      <td className="px-3 py-1.5">
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
                      <td className="px-3 py-1.5">
                        <button
                          onClick={() => openPanel(lead)}
                          title="Notes & appointment"
                          className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
                        >
                          <StickyNote className="h-3 w-3" />
                          <span>Notes</span>
                        </button>
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
        />
      )}
    </div>
  );
}
