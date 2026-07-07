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
import {
  wbahAppointmentDate,
  wbahAppointmentTime,
  wbahBookingStatus,
} from "@/lib/dashboard/wbah-appointment-display";
import { Button } from "@/components/ui/button";
import { DashboardPage, KpiCard, MiniKpiCard, SummaryTooltip, stickyCell, stickyHead } from "@/components/dashboard/PageShell";
import { cn } from "@/lib/utils";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
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
import { listWbahPositiveNeutralLeads, getWbahContactCallHistory, getWbahCallDetail } from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import {
  LEAD_STATUS_CATEGORIES,
  leadMatchesStatusCategory,
  isLeadStatusCategory,
  type LeadStatusCategory,
} from "@/lib/dashboard/lead-status-categories";
import { NotesBookingSheet } from "@/components/dashboard/NotesBookingSheet";
import { WbahNotesButton, WbahBookedStickyBadge, wbahAgentColorMapFromLeads } from "@/components/dashboard/WbahNotesButton";
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
function fmtCallDate(iso: string | null | undefined) {
  if (!iso) return "Not called yet";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
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

function LeadsPage() {
  const qc = useQueryClient();
  const listLeadsFn = useServerFn(listLeads);
  const listWbahPositiveNeutralLeadsFn = useServerFn(listWbahPositiveNeutralLeads);
  const setStatusFn = useServerFn(setLeadStatus);
  const getCampaignStatsFn = useServerFn(getCampaignStats);
  const getAgentsFn = useServerFn(getDashboardLiveAgents);
  const startQualFn = useServerFn(startQualificationCallsForLeads);
  const scheduleCallsFn = useServerFn(scheduleQualificationCalls);
  const fireScheduledFn = useServerFn(fireScheduledCalls);

  const [tab, setTab] = useState<"leads" | "campaigns">("leads");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [leadStatusCat, setLeadStatusCat] = useState<LeadStatusCategory>("all");
  const [sentimentFilter, setSentimentFilter] = useState("");
  const [callStatusFilter, setCallStatusFilter] = useState("");
  const [quickFilter, setQuickFilter] = useState("");
  const [wbahDaysFilter, setWbahDaysFilter] = useState("30");
  // Call duration threshold, outcome, and custom date range filters.
  const [leadsDuration, setLeadsDuration] = useState("");  // min seconds ("" = any)
  const [leadsOutcome, setLeadsOutcome]   = useState("");  // "" | "successful" | "unsuccessful"
  const [leadsFrom, setLeadsFrom]         = useState("");  // yyyy-mm-dd
  const [leadsTo, setLeadsTo]             = useState("");

  // Effective {dateFrom,dateTo}: "custom" uses the Between inputs, else a preset.
  const leadsDateRange = useMemo<{ dateFrom?: string; dateTo?: string }>(() => {
    if (wbahDaysFilter === "custom") {
      const r: { dateFrom?: string; dateTo?: string } = {};
      if (leadsFrom) r.dateFrom = new Date(`${leadsFrom}T00:00:00`).toISOString();
      if (leadsTo)   r.dateTo   = new Date(`${leadsTo}T23:59:59.999`).toISOString();
      return r;
    }
    return filterToDates(wbahDaysFilter);
  }, [wbahDaysFilter, leadsFrom, leadsTo]);

  function leadDurationSeconds(l: any): number {
    if (l?.retell_call?.duration_seconds != null) return Number(l.retell_call.duration_seconds) || 0;
    if (l?.meta?.duration_ms != null) return (Number(l.meta.duration_ms) || 0) / 1000;
    return 0;
  }
  function leadCallStatus(l: any): string {
    return String(l?.retell_call?.call_status ?? l?.meta?.call_status ?? "").toLowerCase();
  }

  useEffect(() => {
    const stored = localStorage.getItem("wbahDaysFilter");
    if (stored) setWbahDaysFilter(stored);
    const storedCat = localStorage.getItem("leadStatusCategory");
    if (storedCat && isLeadStatusCategory(storedCat)) setLeadStatusCat(storedCat);
  }, []);

  useEffect(() => {
    localStorage.setItem("wbahDaysFilter", wbahDaysFilter);
  }, [wbahDaysFilter]);

  useEffect(() => {
    localStorage.setItem("leadStatusCategory", leadStatusCat);
  }, [leadStatusCat]);

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
  const getContactHistoryFn = useServerFn(getWbahContactCallHistory);
  const getCallDetailFn = useServerFn(getWbahCallDetail);
  const [callHistory, setCallHistory] = useState<{ name: string; phone: string; loading: boolean; calls: any[] } | null>(null);

  async function openCallHistory(lead: any) {
    const phone = lead.phone;
    if (!phone) return;
    setCallHistory({ name: lead.full_name ?? "Contact", phone, loading: true, calls: [] });
    try {
      const res = await getContactHistoryFn({ data: { phone } });
      setCallHistory({ name: lead.full_name ?? "Contact", phone, loading: false, calls: (res as any)?.calls ?? [] });
    } catch {
      setCallHistory({ name: lead.full_name ?? "Contact", phone, loading: false, calls: [] });
    }
  }

  async function openHistoryTranscript(call: any) {
    if (!call?.id) return;
    setWbahTranscript("Loading transcript…");
    try {
      const d = await getCallDetailFn({ data: { id: String(call.id) } });
      setWbahTranscript((d as any)?.transcript || "No transcript available.");
    } catch {
      setWbahTranscript("Failed to load transcript.");
    }
  }

  // Workspace detection drives this window's data source.
  const [isWbah, setIsWbah] = useState(false);
  const [wsResolved, setWsResolved] = useState(false);

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
    queryKey: ["leads-all", isWbah, wbahDaysFilter, leadsFrom, leadsTo],
    queryFn: () => {
      // WBAH "Leads window" = already-called contacts whose latest call came back
      // positive or neutral. For WBAH the server fn first refreshes the newest
      // calls from WeeBespoke (incremental) before deriving, so this is LIVE on
      // open. Date narrowing is applied client-side in `filtered`.
      if (isWbah) return listWbahPositiveNeutralLeadsFn();
      const { dateFrom, dateTo } = leadsDateRange;
      return listLeadsFn({ data: { limit: 1000, dateFrom, dateTo } });
    },
    enabled: wsResolved,
    staleTime: isWbah ? 60_000 : 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchInterval: isWbah ? false : 5 * 60 * 1000,
    throwOnError: false,
  });

  const statsQ = useQuery({
    queryKey:             ["campaign-stats"],
    queryFn:              () => getCampaignStatsFn({ data: {} }),
    staleTime:            5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError:         false,
  });

  const agentsQ = useQuery({
    queryKey:             ["dashboard-live-agents"],
    queryFn:              () => getAgentsFn(),
    staleTime:            5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError:         false,
  });

  const leads = (leadsQ.data ?? []) as any[];
  const stats = statsQ.data;
  const allAgents = (agentsQ.data ?? []) as any[];
  const qualAgents = allAgents.filter((a: any) => a.agentType === "client_qualification");
  const scheduledCount = leads.filter((l: any) => l.status === "scheduled").length;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (sess.session) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("default_workspace_id")
            .eq("user_id", sess.session.user.id)
            .maybeSingle();
          if (profile?.default_workspace_id && active) {
            const { data: ws } = await supabase
              .from("workspaces")
              .select("slug")
              .eq("id", profile.default_workspace_id)
              .maybeSingle();
            if (active && ws?.slug === "webuyanyhouse") setIsWbah(true);
          }
        }
      } catch {}
      finally { if (active) setWsResolved(true); }
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
    if (!leadMatchesStatusCategory(l.status, leadStatusCat)) return false;
    if (sentimentFilter && normalizeSentiment(l.sentiment) !== sentimentFilter) return false;
    if (callStatusFilter) {
      const cs = isRetell
        ? l.retell_call?.call_status
        : (isWbah ? l.meta?.call_status : null);
      if (cs !== callStatusFilter) return false;
    }
    // Call duration greater than N minutes.
    if (leadsDuration) {
      const minDur = parseInt(leadsDuration, 10);
      if (minDur > 0 && leadDurationSeconds(l) < minDur) return false;
    }
    // Call outcome: successful = completed / positive; unsuccessful = failed/no-answer/busy/negative.
    if (leadsOutcome === "successful") {
      const cs = leadCallStatus(l);
      const ok = cs === "completed" || normalizeSentiment(l.sentiment) === "positive";
      if (!ok) return false;
    }
    if (leadsOutcome === "unsuccessful") {
      const cs = leadCallStatus(l);
      const bad = ["failed", "no_answer", "busy", "not_connected"].includes(cs) || normalizeSentiment(l.sentiment) === "negative";
      if (!bad) return false;
    }
    // Date range (applies to all leads; "custom" = Between).
    if (wbahDaysFilter !== "all") {
      const { dateFrom, dateTo } = leadsDateRange;
      if (dateFrom || dateTo) {
        const dateStr = l.meta?.last_called_at ?? l.last_contacted_at ?? l.created_at ?? null;
        if (!dateStr) return false;
        const ts = new Date(dateStr).getTime();
        if (isNaN(ts)) return false;
        if (dateFrom && ts < new Date(dateFrom).getTime()) return false;
        if (dateTo && ts > new Date(dateTo).getTime()) return false;
      }
    }
    if (quickFilter && isWbah) {
      const ns = normalizeSentiment(l.sentiment);
      const st = l.status;
      switch (quickFilter) {
        case "before_call":  if (st !== "need_to_call") return false; break;
        case "after_call":   if (st === "need_to_call") return false; break;
        case "positive":     if (ns !== "positive") return false; break;
        case "neutral":      if (ns !== "neutral") return false; break;
        case "partial_qualified": if (!l.meta?.partial_qualified) return false; break;
        case "disqualified": if (st !== "not_interested") return false; break;
        case "callback":     if (!(l.callback_date || st === "callback_requested")) return false; break;
        case "not_called":   if (st !== "not_connected") return false; break;
      }
    }
    return true;
  });

  const leadsPag = useTablePagination(filtered, 50);

  const wbahAgentColorMap = useMemo(
    () => (isWbah ? wbahAgentColorMapFromLeads(leads) : new Map()),
    [isWbah, leads],
  );

  useEffect(() => {
    if (!leadsQ.isError) return;
    const key = "leads-autoreload-ts";
    const last = parseInt(sessionStorage.getItem(key) ?? "0");
    if (Date.now() - last > 20_000) {
      sessionStorage.setItem(key, String(Date.now()));
      window.location.reload();
    }
  }, [leadsQ.isError]);

  useEffect(() => {
    if (!isWbah || !import.meta.env.DEV) return;
    const pos = leads.filter((l: any) => normalizeSentiment(l.sentiment) === "positive").length;
    const neu = leads.filter((l: any) => normalizeSentiment(l.sentiment) === "neutral").length;
    const neg = leads.filter((l: any) => normalizeSentiment(l.sentiment) === "negative").length;
    const unk = leads.filter((l: any) => normalizeSentiment(l.sentiment) === "unknown").length;
    console.log("[WBAH Leads] total=%d positive=%d neutral=%d negative=%d unknown=%d",
      leads.length, pos, neu, neg, unk);
  }, [isWbah, leads]);

  const hasLeadFilters = search.trim() || statusFilter || leadStatusCat !== "all" || sentimentFilter || callStatusFilter || quickFilter || leadsDuration || leadsOutcome || wbahDaysFilter === "custom";

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
    <DashboardPage>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold tracking-tight">
            {isWbah ? "Positive / Neutral Leads" : "Leads"}
          </h1>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {isWbah
              ? "Already-called leads with positive or neutral sentiment — newest first"
              : "Lead Generation intelligence — updated automatically after every call"}
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
          {tab === "leads" && !isWbah && selectedIds.size > 0 && (
            <Button size="sm" variant="outline" className="border-blue-500/30 text-blue-400 hover:text-blue-300" onClick={openQualDialog}>
              <ShieldCheck className="mr-1 h-4 w-4" />
              Qualify {selectedIds.size} Lead{selectedIds.size !== 1 ? "s" : ""}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => {
            leadsQ.refetch();
            statsQ.refetch();
          }}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
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
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MiniKpiCard label="Calls Made" value={stats.called} hint={`of ${stats.total} records`} />
          <MiniKpiCard label="Contacts Reached" value={stats.reached} hint={`${stats.conversionRate}% connect rate`} />
          <MiniKpiCard label="Positive Sentiment" value={`${stats.positivePct}%`} />
          <MiniKpiCard label="Meetings Booked" value={stats.meetingsBooked} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b">
        {(["leads", "campaigns"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-2 py-0.5 text-[11px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
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
        <div className="min-w-0 overflow-hidden rounded-xl border border-white/[0.06] bg-card/60">
          <div className="flex flex-col gap-1.5 border-b border-white/[0.06] px-2.5 py-1.5 sm:px-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {isWbah ? "Positive / Neutral Leads" : "Lead Records"}
              {hasLeadFilters && (
                <span className="ml-2 normal-case text-xs font-normal text-muted-foreground tracking-normal">
                  {filtered.length} matching
                </span>
              )}
              {selectedIds.size > 0 && (
                <span className="ml-2 normal-case text-xs font-normal text-blue-400 tracking-normal">{selectedIds.size} selected</span>
              )}
            </p>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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
                className="h-6 min-w-0 flex-1 basis-28 max-w-[180px] text-[11px] sm:flex-none sm:w-36"
              />
              <select
                aria-label="Lead Status"
                value={leadStatusCat}
                onChange={(e) => setLeadStatusCat(e.target.value as LeadStatusCategory)}
                className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                {LEAD_STATUS_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.value === "all" ? "Lead Status: All" : c.label}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                <option value="">All Statuses</option>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                value={sentimentFilter}
                onChange={(e) => setSentimentFilter(e.target.value)}
                className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                <option value="">All Sentiments</option>
                <option value="positive">Positive</option>
                <option value="neutral">Neutral</option>
                {!isWbah && <option value="negative">Negative</option>}
              </select>
              {(isRetell || isWbah) && (
                <select
                  value={callStatusFilter}
                  onChange={(e) => setCallStatusFilter(e.target.value)}
                  className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                >
                  <option value="">All Call Statuses</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="no_answer">No Answer</option>
                  <option value="busy">Busy</option>
                </select>
              )}
              <select
                value={leadsDuration}
                onChange={(e) => setLeadsDuration(e.target.value)}
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
                value={leadsOutcome}
                onChange={(e) => setLeadsOutcome(e.target.value)}
                className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                title="Call outcome"
              >
                <option value="">All Outcomes</option>
                <option value="successful">Successful</option>
                <option value="unsuccessful">Unsuccessful</option>
              </select>
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
                <option value="custom">Custom range…</option>
              </select>
              {wbahDaysFilter === "custom" && (
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={leadsFrom}
                    max={leadsTo || undefined}
                    onChange={(e) => setLeadsFrom(e.target.value)}
                    className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                    title="From date"
                  />
                  <span className="text-[11px] text-muted-foreground">to</span>
                  <input
                    type="date"
                    value={leadsTo}
                    min={leadsFrom || undefined}
                    onChange={(e) => setLeadsTo(e.target.value)}
                    className="h-6 rounded-md border border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                    title="To date"
                  />
                </div>
              )}
              {hasLeadFilters && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => { setSearch(""); setStatusFilter(""); setLeadStatusCat("all"); setSentimentFilter(""); setCallStatusFilter(""); setQuickFilter(""); setLeadsDuration(""); setLeadsOutcome(""); }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>
          {isWbah && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-2.5 py-1.5 sm:px-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mr-1">Quick filter</span>
              {[
                { value: "positive",          label: "Positive" },
                { value: "neutral",           label: "Neutral" },
                { value: "partial_qualified", label: "Partial Qualified" },
              ].map((c) => {
                const active = quickFilter === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => setQuickFilter(active ? "" : c.value)}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 transition-colors ${
                      active
                        ? "bg-primary/15 text-primary ring-primary/30"
                        : "bg-card/80 text-muted-foreground ring-white/[0.08] hover:text-foreground hover:ring-white/20"
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
              <span className="ml-auto text-[11px] text-muted-foreground">{filtered.length} shown</span>
            </div>
          )}
          <div className="p-0">
            {(leadsQ.isLoading || !wsResolved) ? (
              <LoadingProgress label="Loading leads" estimatedMs={8000} />
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Users className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No leads yet</p>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Once a Lead Generation agent completes a call, lead intelligence will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-card/30">
                      <th className={cn("px-2 py-1 w-8", isWbah && cn(stickyHead, "left-0"))}>
                        <Checkbox
                          checked={selectedIds.size === filtered.length && filtered.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </th>
                      <th className={cn("px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground", isWbah && cn(stickyHead, "left-8 w-44"))}>Name</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Phone</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Status</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Sentiment</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Score</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Interest</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Summary</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Next Action</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Last Contact</th>
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
                        <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">End Reason</th>
                        <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Disconnection</th>
                      </>}
                      <th className="px-2 py-1 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadsPag.sliced.map((lead: any) => (
                      <tr
                        key={lead.id}
                        className={`group h-8 border-b border-white/[0.04] align-middle hover:bg-white/[0.02] transition-colors ${selectedIds.has(lead.id) ? "bg-blue-500/5" : ""}`}
                      >
                        <td className={cn("px-2 py-0.5", isWbah && cn(stickyCell, "left-0 w-8"))}>
                          <Checkbox
                            checked={selectedIds.has(lead.id)}
                            onCheckedChange={() => toggleSelect(lead.id)}
                          />
                        </td>
                        <td className={cn("px-2 py-0.5", isWbah && cn(stickyCell, "left-8 w-44 overflow-hidden"))}>
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-medium">{lead.full_name ?? "—"}</div>
                            {isWbah && (
                              <WbahBookedStickyBadge lead={lead} agentColorMap={wbahAgentColorMap} />
                            )}
                            {isWbah && (lead.meta?.call_count ?? 1) > 1 && (
                              <button
                                onClick={() => openCallHistory(lead)}
                                title="View all calls for this contact"
                                className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-blue-500/15 text-blue-400 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-blue-500/25 transition-colors"
                              >
                                <Phone className="h-2.5 w-2.5 shrink-0" />{lead.meta.call_count}×
                              </button>
                            )}
                          </div>
                          {lead.company_name && (
                            <div className="truncate text-[10px] text-muted-foreground font-normal">{lead.company_name}</div>
                          )}
                        </td>
                        <td className="px-2 py-0.5 text-muted-foreground whitespace-nowrap text-[10px] font-mono">
                          {lead.phone}
                        </td>
                        {/* Status picker */}
                        <td className="px-2 py-0.5">
                          <div className="flex flex-col gap-1">
                            {(() => {
                              if (isWbah) {
                                const ns = normalizeSentiment(lead.sentiment);
                                // Neutral + >5min call = "Partial Qualified" (distinct sky badge);
                                // shorter neutral calls are just "Neutral".
                                if (ns === "neutral") {
                                  return lead.meta?.partial_qualified
                                    ? <span className="rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 bg-sky-500/15 text-sky-400 ring-sky-500/20">Partial Qualified</span>
                                    : <span className="rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 bg-amber-500/15 text-amber-400 ring-amber-500/20">Neutral</span>;
                                }
                                const cfg: Record<string, { label: string; cls: string }> = {
                                  positive: { label: "Qualified",     cls: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/20" },
                                  negative: { label: "Not Qualified", cls: "bg-red-500/15     text-red-400     ring-red-500/20"     },
                                  unknown:  { label: "Unknown",       cls: "bg-muted text-muted-foreground ring-border"            },
                                };
                                const { label, cls } = cfg[ns] ?? cfg.unknown;
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
                        <td className="px-2 py-0.5">{sentimentBadge(lead.sentiment)}</td>
                        <td className="px-2 py-0.5">{scoreBadge(lead.lead_score)}</td>
                        <td className="px-2 py-0.5">{interestBadge(lead.interest_level)}</td>
                        {/* Call summary */}
                        <td className="px-2 py-0.5 text-xs text-muted-foreground max-w-[200px] align-middle">
                          <SummaryTooltip text={lead.call_summary} lines={2} />
                        </td>
                        <td className="px-2 py-0.5 text-[11px] text-muted-foreground max-w-[180px] align-middle">
                          <span className="line-clamp-1">{lead.next_action ?? "—"}</span>
                        </td>
                        <td className="px-2 py-0.5 text-muted-foreground whitespace-nowrap text-[11px]">
                          {fmtDate(lead.last_contacted_at)}
                        </td>
                        <td className="px-2 py-0.5 text-muted-foreground whitespace-nowrap text-[11px]">
                          {fmtCallDate(
                            isWbah ? lead.meta?.last_called_at
                            : isRetell ? lead.retell_call?.started_at
                            : lead.last_contacted_at
                          )}
                        </td>
                        {isRetell && <>
                          <td className="px-2 py-0.5">{callStatusBadge(lead.retell_call?.call_status)}</td>
                          <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{fmtDuration((lead.retell_call?.duration_seconds ?? 0) * 1000)}</td>
                          <td className="px-2 py-0.5">
                            {lead.retell_call?.recording_url
                              ? <a href={lead.retell_call.recording_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-blue-400/80 hover:text-blue-400 hover:bg-blue-500/10 border border-blue-500/20 transition-colors whitespace-nowrap"><PlayCircle className="h-3 w-3" /><span>Play</span></a>
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
                              ? <a href={lead.meta.recording_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-blue-400/80 hover:text-blue-400 hover:bg-blue-500/10 border border-blue-500/20 transition-colors whitespace-nowrap"><PlayCircle className="h-3 w-3" /><span>Play</span></a>
                              : <span className="text-muted-foreground text-[11px]">—</span>}
                          </td>
                          <td className="px-2 py-0.5">
                            {lead.call_summary
                              ? <button onClick={() => setWbahTranscript(lead.call_summary)} className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-violet-400/80 hover:text-violet-400 hover:bg-violet-500/10 border border-violet-500/20 transition-colors whitespace-nowrap"><span>Transcript</span></button>
                              : <span className="text-muted-foreground text-[11px]">—</span>}
                          </td>
                          <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{wbahAppointmentDate(lead) ?? "—"}</td>
                          <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{wbahAppointmentTime(lead) ?? "—"}</td>
                          <td className="px-2 py-0.5">{bookingStatusBadge(wbahBookingStatus(lead))}</td>
                          <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{lead.meta?.end_reason ?? "—"}</td>
                          <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">{lead.meta?.disconnection_reason ?? "—"}</td>
                        </>}
                        <td className="px-2 py-0.5">
                          {isWbah ? (
                            <WbahNotesButton
                              lead={lead}
                              agentColorMap={wbahAgentColorMap}
                              onClick={() => openLeadPanel(lead)}
                            />
                          ) : (
                          <button
                            onClick={() => openLeadPanel(lead)}
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

      {/* Contact call-history drill-down */}
      {callHistory !== null && (
        <Dialog open onOpenChange={() => setCallHistory(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{callHistory.name} — Call History</DialogTitle>
              <DialogDescription>
                {callHistory.phone} · {callHistory.calls.length} call{callHistory.calls.length !== 1 ? "s" : ""}. The main lead shows the definitive outcome (a positive call wins); here are all attempts.
              </DialogDescription>
            </DialogHeader>
            {callHistory.loading ? (
              <div className="py-8 flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading calls…
              </div>
            ) : callHistory.calls.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No calls found.</p>
            ) : (
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-1.5">Date</th>
                      <th className="px-2 py-1.5">Outcome</th>
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
                        <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{fmtCallDate(c.startedAt)}</td>
                        <td className="px-2 py-1.5">{callStatusBadge(c.callStatus)}</td>
                        <td className="px-2 py-1.5">{sentimentBadge(c.sentiment)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{fmtDuration(c.durationSeconds != null ? c.durationSeconds * 1000 : null)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{c.agentName ?? "—"}</td>
                        <td className="px-2 py-1.5">
                          {c.recordingUrl
                            ? <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><PlayCircle className="h-3 w-3" />Play</a>
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
        />
      )}

    </DashboardPage>
  );
}
