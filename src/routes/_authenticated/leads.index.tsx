import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Users,
  Phone,
  RefreshCw,
  TrendingUp,
  Target,
  CalendarCheck,
  BarChart3,
  Brain,
  Plus,
  Trash2,
  ShieldCheck,
  Loader2,
  Clock,
  CalendarClock,
  PlayCircle,
  StickyNote,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeSentiment } from "@/lib/sentiment";
import { Button } from "@/components/ui/button";
import { KpiCard, MiniKpiCard, SummaryTooltip } from "@/components/dashboard/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  listLeads,
  setLeadStatus,
  startQualificationCallsForLeads,
  scheduleQualificationCalls,
  fireScheduledCalls,
} from "@/lib/dashboard/leads.functions";
import { NotesBookingSheet } from "@/components/dashboard/NotesBookingSheet";
import type { NotesEntityType } from "@/components/dashboard/NotesBookingSheet";
import { DialogDescription } from "@/components/ui/dialog";
import {
  getCampaignStats,
} from "@/lib/dashboard/campaigns.functions";
import { getDashboardLiveAgents } from "@/lib/agents/agents.functions";
import { CallSchedulingSection } from "@/components/dashboard/CallSchedulingSection";
import { useTablePagination, TablePagBar } from "@/components/ui/table-pagination";

export const Route = createFileRoute("/_authenticated/leads/")({
  head: () => ({ meta: [{ title: "Leads — Webee" }] }),
  component: LeadsPage,
});

function fmtDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

function sentimentBadge(s: string | null) {
  if (!s) return null;
  const map: Record<string, string> = {
    positive: "bg-emerald-500/15 text-emerald-400",
    neutral: "bg-amber-500/15 text-amber-400",
    negative: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${map[s] ?? "bg-muted text-muted-foreground"}`}>
      {s}
    </span>
  );
}

function scoreBadge(score: number | null) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const color =
    score >= 70
      ? "text-emerald-400"
      : score >= 40
        ? "text-amber-400"
        : "text-red-400";
  return <span className={`font-semibold ${color}`}>{score}</span>;
}

function interestBadge(level: string | null) {
  if (!level) return null;
  const map: Record<string, string> = {
    high: "bg-emerald-500/15 text-emerald-400",
    medium: "bg-amber-500/15 text-amber-400",
    low: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${map[level] ?? "bg-muted text-muted-foreground"}`}>
      {level}
    </span>
  );
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

const STATUS_OPTIONS = [
  { value: "interested", label: "Open", color: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30" },
  { value: "qualified", label: "Qualified", color: "bg-violet-500/15 text-violet-400 ring-violet-500/30" },
  { value: "callback_requested", label: "Callback Requested", color: "bg-amber-500/15 text-amber-400 ring-amber-500/30" },
  { value: "need_to_call", label: "Needs to Call", color: "bg-sky-500/15 text-sky-400 ring-sky-500/30" },
  { value: "not_interested", label: "Closed", color: "bg-red-500/15 text-red-400 ring-red-500/30" },
  { value: "completed", label: "Completed", color: "bg-blue-500/15 text-blue-400 ring-blue-500/30" },
  { value: "no_answer", label: "No Answer", color: "bg-orange-500/15 text-orange-400 ring-orange-500/30" },
  { value: "scheduled", label: "Scheduled", color: "bg-purple-500/15 text-purple-400 ring-purple-500/30" },
] as const;

function statusDisplay(status: string | null) {
  const opt = STATUS_OPTIONS.find((o) => o.value === status);
  if (opt) return opt;
  return { value: status ?? "", label: status?.replace(/_/g, " ") ?? "—", color: "bg-muted text-muted-foreground ring-border" };
}

function LeadsPage() {
  const qc = useQueryClient();
  const listLeadsFn = useServerFn(listLeads);
  const setStatusFn = useServerFn(setLeadStatus);
  const getCampaignStatsFn = useServerFn(getCampaignStats);
  const getAgentsFn = useServerFn(getDashboardLiveAgents);
  const startQualFn = useServerFn(startQualificationCallsForLeads);
  const scheduleCallsFn = useServerFn(scheduleQualificationCalls);
  const fireScheduledFn = useServerFn(fireScheduledCalls);

  const [tab, setTab] = useState<"leads" | "campaigns">("leads");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState("");
  const [callStatusFilter, setCallStatusFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [qualDialogOpen, setQualDialogOpen] = useState(false);
  const [qualAgentId, setQualAgentId] = useState<string>("");
  const [qualFromNumber, setQualFromNumber] = useState<string>("");
  const [qualRunning, setQualRunning] = useState(false);
  const [qualSchedule, setQualSchedule] = useState(false);
  const [qualScheduledAt, setQualScheduledAt] = useState<string>("");
  const [firingScheduled, setFiringScheduled] = useState(false);

  type PanelTarget = {
    entityType: NotesEntityType;
    entityId: string;
    entityName: string;
    defaultPhone?: string;
    defaultEmail?: string;
    leadId?: string | null;
  };
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const [wbahTranscript, setWbahTranscript] = useState<string | null>(null);

  function openLeadPanel(lead: any) {
    setPanel({
      entityType: "lead",
      entityId: lead.id,
      entityName: lead.full_name ?? lead.phone ?? "Lead",
      defaultPhone: lead.phone ?? undefined,
      defaultEmail: lead.email ?? undefined,
      leadId: lead.id,
    });
  }

  const leadsQ = useQuery({
    queryKey: ["leads-all"],
    queryFn: () => listLeadsFn({ data: { limit: 5000 } }),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60 * 1000,
  });

  const statsQ = useQuery({
    queryKey: ["campaign-stats"],
    queryFn: () => getCampaignStatsFn({ data: {} }),
  });

  const agentsQ = useQuery({
    queryKey: ["dashboard-live-agents"],
    queryFn: () => getAgentsFn(),
    staleTime: 30_000,
  });

  const leads = (leadsQ.data ?? []) as any[];
  const stats = statsQ.data;
  const allAgents = (agentsQ.data ?? []) as any[];
  const qualAgents = allAgents.filter((a: any) => a.agentType === "client_qualification");
  const scheduledCount = leads.filter((l: any) => l.status === "scheduled").length;

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
        if (!active) return;
        setIsWbah(ws?.slug === "webuyanyhouse");
      } catch {}
    })();
    return () => { active = false; };
  }, []);

  const isRetell = useMemo(() =>
    !isWbah && leads.some((l: any) => l.retell_call != null),
    [leads, isWbah],
  );

  const filtered = leads.filter((l: any) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!(
        (l.full_name ?? "").toLowerCase().includes(q) ||
        (l.phone ?? "").includes(q) ||
        (l.email ?? "").toLowerCase().includes(q) ||
        (l.company_name ?? "").toLowerCase().includes(q)
      )) return false;
    }
    if (statusFilter && l.status !== statusFilter) return false;
    if (sentimentFilter && normalizeSentiment(l.sentiment) !== sentimentFilter) return false;
    if (callStatusFilter) {
      const cs = isRetell
        ? l.retell_call?.call_status
        : (isWbah ? l.meta?.call_status : null);
      if (cs !== callStatusFilter) return false;
    }
    return true;
  });

  const leadsPag = useTablePagination(filtered, 50);

  useEffect(() => {
    if (!isWbah || !import.meta.env.DEV) return;
    const pos = leads.filter((l: any) => normalizeSentiment(l.sentiment) === "positive").length;
    const neu = leads.filter((l: any) => normalizeSentiment(l.sentiment) === "neutral").length;
    const neg = leads.filter((l: any) => normalizeSentiment(l.sentiment) === "negative").length;
    const unk = leads.filter((l: any) => normalizeSentiment(l.sentiment) === "unknown").length;
    console.log("[WBAH Leads] total=%d positive=%d neutral=%d negative=%d unknown=%d",
      leads.length, pos, neu, neg, unk);
  }, [isWbah, leads]);

  const hasLeadFilters = search.trim() || statusFilter || sentimentFilter || callStatusFilter;

  const positive = leads.filter((l: any) => normalizeSentiment(l.sentiment) === "positive").length;
  const withScore = leads.filter((l: any) => l.lead_score != null);
  const avgScore =
    withScore.length > 0
      ? Math.round(withScore.reduce((a: number, l: any) => a + l.lead_score, 0) / withScore.length)
      : null;
  const meetingsReq = leads.filter((l: any) => l.meeting_requested).length;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((l: any) => l.id)));
    }
  }

  async function handleSetStatus(id: string, status: typeof STATUS_OPTIONS[number]["value"]) {
    try {
      await setStatusFn({ data: { id, status } });
      qc.invalidateQueries({ queryKey: ["leads-all"] });
    } catch (e) {
      toast.error("Failed to update status", { description: (e as Error).message });
    }
  }

  async function handleStartQualification() {
    if (!qualAgentId || selectedIds.size === 0) return;
    setQualRunning(true);
    try {
      if (qualSchedule) {
        if (!qualScheduledAt) {
          toast.error("Pick a date and time for the scheduled calls");
          setQualRunning(false);
          return;
        }
        const result = await scheduleCallsFn({
          data: {
            leadIds: Array.from(selectedIds),
            agentId: qualAgentId,
            fromNumber: qualFromNumber || null,
            scheduledAt: new Date(qualScheduledAt).toISOString(),
          },
        });
        toast.success(`${result.scheduled} lead${result.scheduled !== 1 ? "s" : ""} scheduled`, {
          description: `Calls will be placed at ${new Date(qualScheduledAt).toLocaleString()}`,
        });
      } else {
        const result = await startQualFn({
          data: {
            leadIds: Array.from(selectedIds),
            agentId: qualAgentId,
            fromNumber: qualFromNumber || null,
          },
        });
        const limitMsg = (result as any).limitReached > 0
          ? ` · ${(result as any).limitReached} at daily limit`
          : "";
        toast.success(`Qualification started — ${result.placed} calls placed`, {
          description: result.failed > 0 ? `${result.failed} failed${limitMsg}` : limitMsg || undefined,
        });
      }
      setQualDialogOpen(false);
      setQualSchedule(false);
      setQualScheduledAt("");
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["leads-all"] });
    } catch (e) {
      toast.error("Failed to start qualification", { description: (e as Error).message });
    } finally {
      setQualRunning(false);
    }
  }

  async function handleFireScheduled() {
    setFiringScheduled(true);
    try {
      const result = await fireScheduledFn();
      if (result.fired === 0) {
        toast.info("No scheduled calls are due yet");
      } else {
        toast.success(`Fired ${result.fired} scheduled call${result.fired !== 1 ? "s" : ""}`, {
          description: (result as any).failed > 0 ? `${(result as any).failed} failed` : undefined,
        });
      }
      qc.invalidateQueries({ queryKey: ["leads-all"] });
    } catch (e) {
      toast.error("Failed to fire scheduled calls", { description: (e as Error).message });
    } finally {
      setFiringScheduled(false);
    }
  }

  function openQualDialog() {
    if (selectedIds.size === 0) {
      toast.error("Select at least one lead first");
      return;
    }
    const defaultAgent = qualAgents[0];
    if (defaultAgent && !qualAgentId) setQualAgentId(defaultAgent.id);
    if (defaultAgent?.phoneNumber && !qualFromNumber) setQualFromNumber(defaultAgent.phoneNumber);
    setQualDialogOpen(true);
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Lead Generation intelligence — updated automatically after every call
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "leads" && scheduledCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-purple-500/30 text-purple-400 hover:text-purple-300"
              onClick={handleFireScheduled}
              disabled={firingScheduled}
            >
              {firingScheduled ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="mr-1 h-4 w-4" />
              )}
              Run Scheduled ({scheduledCount})
            </Button>
          )}
          {tab === "leads" && selectedIds.size > 0 && (
            <Button size="sm" variant="outline" className="border-blue-500/30 text-blue-400 hover:text-blue-300" onClick={openQualDialog}>
              <ShieldCheck className="mr-1 h-4 w-4" />
              Qualify {selectedIds.size} Lead{selectedIds.size !== 1 ? "s" : ""}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => {
            leadsQ.refetch();
            statsQ.refetch();
          }}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        <KpiCard label="Total Leads" value={leads.length} icon={Users} iconBg="bg-blue-500/15" iconColor="text-blue-400" />
        <KpiCard
          label="Positive Sentiment"
          value={positive}
          icon={TrendingUp}
          iconBg="bg-emerald-500/15"
          iconColor="text-emerald-400"
          hint={leads.length > 0 ? `${Math.round((positive / leads.length) * 100)}%` : undefined}
        />
        <KpiCard
          label="Avg Lead Score"
          value={avgScore ?? "—"}
          icon={Target}
          iconBg="bg-violet-500/15"
          iconColor="text-violet-400"
        />
        <KpiCard label="Meetings Req." value={meetingsReq} icon={CalendarCheck} iconBg="bg-amber-500/15" iconColor="text-amber-400" />
      </div>

      {/* Campaign stats mini strip */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
          <MiniKpiCard label="Calls Made" value={stats.called} hint={`of ${stats.total} records`} />
          <MiniKpiCard label="Contacts Reached" value={stats.reached} hint={`${stats.conversionRate}% connect rate`} />
          <MiniKpiCard label="Positive Sentiment" value={`${stats.positivePct}%`} />
          <MiniKpiCard label="Meetings Booked" value={stats.meetingsBooked} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        {(["leads", "campaigns"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "leads" ? (
              <span className="flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5" /> Lead Intelligence
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Campaigns
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Lead Intelligence Tab */}
      {tab === "leads" && (
        <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Lead Records
              {selectedIds.size > 0 && (
                <span className="ml-2 normal-case text-xs font-normal text-blue-400 tracking-normal">{selectedIds.size} selected</span>
              )}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {selectedIds.size > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </Button>
              )}
              <Input
                placeholder="Search name, phone, email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 w-44 text-xs"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-7 rounded-md border border-white/[0.08] bg-card/80 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                <option value="">All Statuses</option>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                value={sentimentFilter}
                onChange={(e) => setSentimentFilter(e.target.value)}
                className="h-7 rounded-md border border-white/[0.08] bg-card/80 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                <option value="">All Sentiments</option>
                <option value="positive">Positive</option>
                {!isWbah && <option value="neutral">Neutral</option>}
                <option value="negative">Negative</option>
              </select>
              {(isRetell || isWbah) && (
                <select
                  value={callStatusFilter}
                  onChange={(e) => setCallStatusFilter(e.target.value)}
                  className="h-7 rounded-md border border-white/[0.08] bg-card/80 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                >
                  <option value="">All Call Statuses</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="no_answer">No Answer</option>
                  <option value="busy">Busy</option>
                </select>
              )}
              {hasLeadFilters && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => { setSearch(""); setStatusFilter(""); setSentimentFilter(""); setCallStatusFilter(""); }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>
          <div className="p-0">
            {leadsQ.isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Users className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No leads yet</p>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Once a Lead Generation agent completes a call, lead intelligence will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-card/30">
                      <th className="px-3 py-2 w-8">
                        <Checkbox
                          checked={selectedIds.size === filtered.length && filtered.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Name</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Phone</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Status</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sentiment</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Score</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Interest</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Summary</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Next Action</th>
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
                      <th className="px-3 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadsPag.sliced.map((lead: any) => (
                      <tr
                        key={lead.id}
                        className={`h-9 border-b border-white/[0.04] align-middle hover:bg-white/[0.02] transition-colors ${selectedIds.has(lead.id) ? "bg-blue-500/5" : ""}`}
                      >
                        <td className="px-3 py-1.5">
                          <Checkbox
                            checked={selectedIds.has(lead.id)}
                            onCheckedChange={() => toggleSelect(lead.id)}
                          />
                        </td>
                        <td className="px-3 py-1.5 text-xs font-medium whitespace-nowrap">
                          {lead.full_name ?? "—"}
                          {lead.company_name && (
                            <div className="text-[11px] text-muted-foreground font-normal">{lead.company_name}</div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap text-[11px] font-mono">
                          {lead.phone}
                        </td>
                        {/* Status picker */}
                        <td className="px-3 py-1.5">
                          <div className="flex flex-col gap-1">
                            {(() => {
                              if (isWbah) {
                                const ns = normalizeSentiment(lead.sentiment);
                                const cfg: Record<string, { label: string; cls: string }> = {
                                  positive: { label: "Qualified",        cls: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/20" },
                                  neutral:  { label: "Partly Qualified", cls: "bg-amber-500/15   text-amber-400   ring-amber-500/20"   },
                                  negative: { label: "Not Qualified",    cls: "bg-red-500/15     text-red-400     ring-red-500/20"     },
                                  unknown:  { label: "Unknown",          cls: "bg-muted text-muted-foreground ring-border"            },
                                };
                                const { label, cls } = cfg[ns];
                                return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${cls}`}>{label}</span>;
                              }
                              const sd = statusDisplay(lead.status);
                              return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${sd.color}`}>{sd.label}</span>;
                            })()}
                            {!isWbah && (
                              <div className="flex gap-1 mt-0.5">
                                {STATUS_OPTIONS.map((opt) => (
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
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-1.5">{sentimentBadge(lead.sentiment)}</td>
                        <td className="px-3 py-1.5">{scoreBadge(lead.lead_score)}</td>
                        <td className="px-3 py-1.5">{interestBadge(lead.interest_level)}</td>
                        {/* Call summary */}
                        <td className="px-3 py-1.5 text-xs text-muted-foreground max-w-[200px] align-middle">
                          <SummaryTooltip text={lead.call_summary} lines={2} />
                        </td>
                        <td className="px-3 py-1.5 text-[11px] text-muted-foreground max-w-[180px] align-middle">
                          <span className="line-clamp-1">{lead.next_action ?? "—"}</span>
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
                          <button
                            onClick={() => openLeadPanel(lead)}
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
                <TablePagBar
                  page={leadsPag.page}
                  pageSize={leadsPag.pageSize}
                  totalPages={leadsPag.totalPages}
                  total={leadsPag.total}
                  setPage={leadsPag.setPage}
                  changePageSize={leadsPag.changePageSize}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Campaigns Tab */}
      {tab === "campaigns" && (
        <CallSchedulingSection
          pageType="leads"
          statusOptions={[
            { value: "interested", label: "Open" },
            { value: "qualified", label: "Qualified" },
            { value: "callback_requested", label: "Callback Requested" },
            { value: "need_to_call", label: "Needs to Call" },
            { value: "not_interested", label: "Closed" },
            { value: "completed", label: "Completed" },
            { value: "no_answer", label: "No Answer" },
            { value: "scheduled", label: "Scheduled" },
          ]}
          agents={allAgents}
        />
      )}

      {/* Assign Qualification Agent Dialog */}
      <Dialog open={qualDialogOpen} onOpenChange={(o) => { setQualDialogOpen(o); if (!o) { setQualSchedule(false); setQualScheduledAt(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-400" />
              Assign Qualification Agent
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              {qualSchedule ? "Schedule" : "Start"} qualification calls for <span className="font-semibold text-foreground">{selectedIds.size}</span> selected lead{selectedIds.size !== 1 ? "s" : ""}.
            </p>
            {qualAgents.length === 0 ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-400">
                No live Client Qualification agents found. Build and go-live with a qualification agent in the Builder first.
              </div>
            ) : (
              <>
                <div>
                  <Label className="text-xs">Qualification Agent</Label>
                  <Select value={qualAgentId} onValueChange={(v) => {
                    setQualAgentId(v);
                    const agent = qualAgents.find((a: any) => a.id === v);
                    if (agent?.phoneNumber) setQualFromNumber(agent.phoneNumber);
                  }}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select an agent…" />
                    </SelectTrigger>
                    <SelectContent>
                      {qualAgents.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                          {a.phoneNumber && <span className="ml-2 text-muted-foreground text-xs">{a.phoneNumber}</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">From Number (optional override)</Label>
                  <Input
                    value={qualFromNumber}
                    onChange={(e) => setQualFromNumber(e.target.value)}
                    placeholder="+1 555 000 0000"
                    className="mt-1 h-8 text-xs"
                  />
                </div>

                {/* Schedule toggle */}
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-3">
                  <button
                    type="button"
                    onClick={() => setQualSchedule((v) => !v)}
                    className="flex items-center justify-between w-full"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <CalendarClock className="h-4 w-4 text-purple-400" />
                      Schedule for later
                    </span>
                    <span className={`h-5 w-9 rounded-full transition-colors relative ${qualSchedule ? "bg-purple-500" : "bg-white/10"}`}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${qualSchedule ? "translate-x-4" : "translate-x-0.5"}`} />
                    </span>
                  </button>
                  {qualSchedule && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Call date &amp; time</Label>
                      <Input
                        type="datetime-local"
                        value={qualScheduledAt}
                        onChange={(e) => setQualScheduledAt(e.target.value)}
                        className="mt-1 h-8 text-xs"
                        min={new Date().toISOString().slice(0, 16)}
                      />
                      <p className="mt-1.5 text-[11px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Click "Run Scheduled" on the Leads page when the time arrives to fire the calls.
                      </p>
                    </div>
                  )}
                </div>

                {/* Daily limit notice */}
                <p className="text-[11px] text-muted-foreground">
                  Max 3 call attempts per lead per day — leads at the limit will be skipped.
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setQualDialogOpen(false)} disabled={qualRunning}>
              Cancel
            </Button>
            <Button
              onClick={handleStartQualification}
              disabled={!qualAgentId || qualAgents.length === 0 || qualRunning}
              className={qualSchedule ? "bg-purple-600 hover:bg-purple-500 text-white" : ""}
            >
              {qualRunning ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  {qualSchedule ? "Scheduling…" : "Starting…"}
                </>
              ) : qualSchedule ? (
                <>
                  <CalendarClock className="mr-1 h-4 w-4" />
                  Schedule {selectedIds.size} Call{selectedIds.size !== 1 ? "s" : ""}
                </>
              ) : (
                <>
                  <Phone className="mr-1 h-4 w-4" />
                  Start {selectedIds.size} Call{selectedIds.size !== 1 ? "s" : ""}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
