import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
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
  PlayCircle,
  StickyNote,
  MessageCircle,
  Contact,
  UserPlus,
  Sparkles,
} from "lucide-react";
import { ORIGIN_FILTER_OPTIONS } from "@/lib/leads/lead-origin.shared";
import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeSentiment } from "@/lib/sentiment";
import { wbahAppointmentDate, wbahAppointmentTime, wbahBookingStatus } from "@/lib/dashboard/wbah-appointment-display";
import { Button } from "@/components/ui/button";
import { SavedFiltersSection } from "@/components/people-views/SavedFiltersSection";
import { DashboardPage, KpiCard, MiniKpiCard, SummaryTooltip, stickyCell, stickyHead } from "@/components/dashboard/PageShell";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { AssignLeadsDialog } from "@/components/leads/AssignLeadsDialog";
import { QuickDialerCallButton } from "@/components/leads/QuickDialerCallButton";
import { getMyPermissions } from "@/lib/permissions/team-access.functions";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  listLeads,
  listLeadsPage,
  setLeadStatus,
  startQualificationCallsForLeads,
  scheduleQualificationCalls,
  fireScheduledCalls,
  removeLeads,
  upsertLead,
} from "@/lib/dashboard/leads.functions";
import { pageLevelRank } from "@/lib/permissions/permissions.shared";
import { buildManualLeadPayload, isManualLeadSubmittable } from "@/lib/dashboard/manual-lead.shared";
import { LeadAiAssistantPanel, type AssistantTarget } from "@/components/leads/LeadAiAssistantPanel";
import { useSalesAssistantAccess } from "@/hooks/useSalesAssistantAccess";
import { getWbahContactCallHistory, getWbahCallDetail } from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import { LEAD_STATUS_CATEGORIES, isLeadStatusCategory, type LeadStatusCategory } from "@/lib/dashboard/lead-status-categories";
import { NotesBookingSheet } from "@/components/dashboard/NotesBookingSheet";
import { LeadEmailDialog } from "@/components/dashboard/LeadEmailDialog";
import { PlayRecordingButton } from "@/components/RecordingPlayerDialog";
import { WbahNotesButton, WbahBookedStickyBadge, WbahCallCountBadge, WbahCalendlyLink } from "@/components/dashboard/WbahNotesButton";
import { WbahContactCallHistoryTable } from "@/components/dashboard/WbahContactCallHistoryTable";
import type { WbahContactCallHistoryItem } from "@/lib/dashboard/wbah-call-history.types";
import type { NotesEntityType } from "@/components/dashboard/NotesBookingSheet";
import { DialogDescription } from "@/components/ui/dialog";
import { getCampaignStats } from "@/lib/dashboard/campaigns.functions";
import { getDashboardLiveAgents } from "@/lib/agents/agents.functions";
import { CallSchedulingSection } from "@/components/dashboard/CallSchedulingSection";
import { StartCallsDialog } from "@/components/dashboard/StartCallsDialog";
import { TablePagBar, type PageSize } from "@/components/ui/table-pagination";
import type { LeadPageRow, LeadsPageFilters, LeadsPageResult } from "@/lib/dashboard/leads-page.shared";
import { buildWbahAgentColorMap } from "@/lib/dashboard/wbah-agent-colors";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useWbahAgentOptions } from "@/hooks/useWbahAgentOptions";
import { useWorkspaceAgentOptions, agentTypeLabel } from "@/components/shared/AgentFilterSelect";
import { wbahDateTimeOptions } from "@/lib/dashboard/wbah-timezone";
import { formatCallMs as fmtDuration } from "@/lib/format/duration.shared";
import { BookingFailedBadge, LeadSourceBadge, PreferredContactBadge, bookingStatusBadge, callStatusBadge, interestBadge, scoreBadge, sentimentBadge } from "@/components/leads/LeadBadges";
import { STATUS_OPTIONS, filterToDates, fmtCallDate, fmtDate, statusDisplay } from "@/components/leads/leads-page-format";

export const Route = createFileRoute("/_authenticated/leads/")({
  validateSearch: (search: Record<string, unknown>): { id?: string } => {
    const parsed = z.object({ id: z.string().uuid().optional() }).safeParse(search);
    return { id: parsed.success ? parsed.data.id : undefined };
  },
  head: () => ({ meta: [{ title: "Leads — Webee" }] }),
  component: LeadsPage,
});

function LeadsPage() {
  const { id: requestedLeadId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const listLeadsFn = useServerFn(listLeads);
  const listLeadsPageFn = useServerFn(listLeadsPage);
  const setStatusFn = useServerFn(setLeadStatus);
  const getCampaignStatsFn = useServerFn(getCampaignStats);
  const getAgentsFn = useServerFn(getDashboardLiveAgents);
  const startQualFn = useServerFn(startQualificationCallsForLeads);
  const scheduleCallsFn = useServerFn(scheduleQualificationCalls);
  const fireScheduledFn = useServerFn(fireScheduledCalls);
  const removeLeadsFn = useServerFn(removeLeads);

  const [tab, setTab] = useState<"leads" | "campaigns">("leads");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [leadStatusCat, setLeadStatusCat] = useState<LeadStatusCategory>("all");
  const [sentimentFilter, setSentimentFilter] = useState("");
  const [callStatusFilter, setCallStatusFilter] = useState("");
  const [quickFilter, setQuickFilter] = useState("");
  const [wbahDaysFilter, setWbahDaysFilter] = useState("30");
  // Call duration threshold, outcome, and custom date range filters.
  const [leadsDuration, setLeadsDuration] = useState(""); // min seconds ("" = any)
  const [leadsOutcome, setLeadsOutcome] = useState(""); // "" | "successful" | "unsuccessful"
  const [leadsFrom, setLeadsFrom] = useState(""); // yyyy-mm-dd
  const [leadsTo, setLeadsTo] = useState("");
  const [wbahAgentFilter, setWbahAgentFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState("");
  const workspaceAgents = useWorkspaceAgentOptions();
  const selectedAgent =
    agentFilter !== "all" ? (workspaceAgents.find((a) => a.id === agentFilter) ?? null) : null;

  // Effective {dateFrom,dateTo}: "custom" uses the Between inputs, else a preset.
  const leadsDateRange = useMemo<{ dateFrom?: string; dateTo?: string }>(() => {
    if (wbahDaysFilter === "custom") {
      const r: { dateFrom?: string; dateTo?: string } = {};
      if (leadsFrom) r.dateFrom = new Date(`${leadsFrom}T00:00:00`).toISOString();
      if (leadsTo) r.dateTo = new Date(`${leadsTo}T23:59:59.999`).toISOString();
      return r;
    }
    return filterToDates(wbahDaysFilter);
  }, [wbahDaysFilter, leadsFrom, leadsTo]);

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
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const myPermsFn = useServerFn(getMyPermissions);
  const myPermsQ = useQuery({
    queryKey: ["my-permissions"],
    queryFn: () => myPermsFn(),
    staleTime: 5 * 60_000,
    throwOnError: false,
  });
  const canAssign = myPermsQ.data?.actionAccess?.lead_assignment === true;
  // Creating a lead is an edit of the Leads page; there is no separate action
  // key for it, so gate on the page level the same way the rest of the app does.
  const leadsLevel = String(myPermsQ.data?.pageAccess?.leads ?? "hidden");
  const canCreateLead = pageLevelRank(leadsLevel) >= pageLevelRank("edit");

  const canUseAssistant = useSalesAssistantAccess();
  const [assistantTarget, setAssistantTarget] = useState<AssistantTarget | null>(null);
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const emptyNewLead = { full_name: "", phone: "", email: "", company_name: "", notes: "" };
  const [newLead, setNewLead] = useState(emptyNewLead);
  const upsertLeadFn = useServerFn(upsertLead);
  const [firingScheduled, setFiringScheduled] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  type PanelTarget = {
    entityType: NotesEntityType;
    entityId: string;
    entityName: string;
    defaultPhone?: string;
    defaultEmail?: string;
    leadId?: string | null;
    callSummary?: string | null;
  };
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const [wbahTranscript, setWbahTranscript] = useState<string | null>(null);
  const [emailDialogLead, setEmailDialogLead] = useState<any | null>(null);
  const getContactHistoryFn = useServerFn(getWbahContactCallHistory);
  const getCallDetailFn = useServerFn(getWbahCallDetail);
  const [callHistory, setCallHistory] = useState<{
    name: string;
    phone: string;
    loading: boolean;
    calls: WbahContactCallHistoryItem[];
  } | null>(null);

  async function openCallHistory(lead: LeadPageRow) {
    const phone = lead.phone;
    if (!phone) return;
    setCallHistory({ name: lead.full_name ?? "Contact", phone, loading: true, calls: [] });
    try {
      const res = await getContactHistoryFn({ data: { phone } });
      setCallHistory({
        name: lead.full_name ?? "Contact",
        phone,
        loading: false,
        calls: ((res as { calls?: WbahContactCallHistoryItem[] })?.calls ??
          []) as WbahContactCallHistoryItem[],
      });
    } catch {
      setCallHistory({ name: lead.full_name ?? "Contact", phone, loading: false, calls: [] });
    }
  }

  async function openHistoryTranscript(call: WbahContactCallHistoryItem) {
    if (!call?.id) return;
    setWbahTranscript("Loading transcript…");
    try {
      const d = await getCallDetailFn({ data: { id: String(call.id) } });
      setWbahTranscript(d?.transcript || "No transcript available.");
    } catch {
      setWbahTranscript("Failed to load transcript.");
    }
  }

  // Workspace detection drives this window's data source.
  const [isWbah, setIsWbah] = useState(false);
  const [wsResolved, setWsResolved] = useState(false);

  function openLeadPanel(lead: LeadPageRow) {
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

  async function openWbahTranscriptFromLead(lead: LeadPageRow) {
    if (!lead?.id) return;
    setWbahTranscript("Loading transcript…");
    try {
      const d = await getCallDetailFn({ data: { id: String(lead.id) } });
      setWbahTranscript(d?.transcript || "No transcript available.");
    } catch {
      setWbahTranscript("Failed to load transcript.");
    }
  }

  // One page at a time from the server, which applies every filter (leads-page.shared.ts).
  const [leadsPage, setLeadsPage] = useState(1);
  const [leadsPageSize, setLeadsPageSize] = useState<PageSize>(25);
  const debouncedSearch = useDebouncedValue(search, 300);
  const pageFilters = useMemo<LeadsPageFilters>(
    () => ({
      search: debouncedSearch.trim() || undefined,
      status: statusFilter || undefined,
      statusCategory: leadStatusCat,
      sentiment: sentimentFilter || undefined,
      callStatus: callStatusFilter || undefined,
      wbahAgent: wbahAgentFilter,
      agent: !isWbah && selectedAgent
        ? { id: selectedAgent.id, name: selectedAgent.name, retellAgentId: selectedAgent.retellAgentId ?? null }
        : null,
      minDurationSec: leadsDuration ? parseInt(leadsDuration, 10) || undefined : undefined,
      outcome: (leadsOutcome || "") as LeadsPageFilters["outcome"],
      ...(wbahDaysFilter !== "all" ? leadsDateRange : {}),
      origin: originFilter || undefined,
      quick: quickFilter || undefined,
    }),
    [
      debouncedSearch, statusFilter, leadStatusCat, sentimentFilter, callStatusFilter, wbahAgentFilter,
      isWbah, selectedAgent, leadsDuration, leadsOutcome, wbahDaysFilter, leadsDateRange, originFilter,
      quickFilter,
    ],
  );
  const pageFiltersKey = JSON.stringify(pageFilters);
  useEffect(() => setLeadsPage(1), [pageFiltersKey]);

  const leadsQ = useQuery({
    // "leads-all" prefix kept: mutations invalidate by it.
    queryKey: ["leads-all", "page", isWbah, pageFiltersKey, leadsPage, leadsPageSize],
    queryFn: () =>
      listLeadsPageFn({ data: { filters: pageFilters, page: leadsPage, pageSize: leadsPageSize } }) as Promise<
        LeadsPageResult
      >,
    enabled: wsResolved,
    placeholderData: keepPreviousData,
    staleTime: isWbah ? 180_000 : 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchInterval: isWbah ? false : 5 * 60 * 1000,
    throwOnError: false,
  });

  const requestedLeadQ = useQuery({
    queryKey: ["lead-by-id", requestedLeadId],
    queryFn: () => listLeadsFn({ data: { id: requestedLeadId!, limit: 1 } }),
    enabled: wsResolved && !isWbah && Boolean(requestedLeadId),
    staleTime: 5 * 60_000,
    throwOnError: false,
  });

  const statsQ = useQuery({
    queryKey: ["campaign-stats"],
    queryFn: () => getCampaignStatsFn({ data: {} }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  // Declared after leadsQ/statsQ because onSuccess refetches both.
  const createLead = useMutation({
    mutationFn: () =>
      // Status is deliberately unset so the table default applies rather than
      // this dialog inventing one.
      upsertLeadFn({ data: buildManualLeadPayload(newLead) }),
    onSuccess: () => {
      toast.success("Lead added");
      setNewLead(emptyNewLead);
      setAddLeadOpen(false);
      leadsQ.refetch();
      statsQ.refetch();
    },
    onError: (e: Error) => toast.error("Could not add lead", { description: e.message }),
  });

  const agentsQ = useQuery({
    queryKey: ["dashboard-live-agents"],
    queryFn: () => getAgentsFn(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const pageRows: LeadPageRow[] = leadsQ.data?.rows ?? [];
  const matching = leadsQ.data?.matching ?? 0;
  const summary = leadsQ.data?.summary;
  const requestedLead = ((requestedLeadQ.data ?? []) as LeadPageRow[])[0] ?? null;

  useEffect(() => {
    if (!requestedLeadId || !requestedLead || panel) return;
    openLeadPanel(requestedLead);
  }, [panel, requestedLead, requestedLeadId]);

  const wbahAgentNamesFromData = useMemo(() => summary?.agentNames ?? [], [summary]);
  const { options: wbahAgentOptions } = useWbahAgentOptions(wbahAgentNamesFromData, isWbah);
  const stats = statsQ.data;
  const allAgents = agentsQ.data ?? [];
  const qualAgents = allAgents
    .filter((a) => a.agentType === "client_qualification")
    .sort((a, b) => (b.defaultForLeads ? 1 : 0) - (a.defaultForLeads ? 1 : 0));
  const scheduledCount = summary?.scheduled ?? 0;

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
      } catch {
      } finally {
        if (active) setWsResolved(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const isRetell = summary?.isRetell ?? false;

  const leadsPag = {
    page: leadsQ.data?.page ?? leadsPage,
    pageSize: leadsPageSize,
    totalPages: Math.max(1, Math.ceil(matching / leadsPageSize)),
    total: matching,
    sliced: pageRows,
    setPage: setLeadsPage,
    changePageSize: (size: PageSize) => {
      setLeadsPageSize(size);
      setLeadsPage(1);
    },
  };

  const wbahAgentColorMap = useMemo(
    () => (isWbah ? buildWbahAgentColorMap(summary?.bookedAgentNames ?? []) : new Map()),
    [isWbah, summary],
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

  const hasLeadFilters =
    search.trim() ||
    statusFilter ||
    leadStatusCat !== "all" ||
    sentimentFilter ||
    callStatusFilter ||
    quickFilter ||
    leadsDuration ||
    leadsOutcome ||
    wbahDaysFilter === "custom" ||
    wbahAgentFilter !== "all" ||
    agentFilter !== "all" ||
    originFilter;

  const totalLeads = summary?.total ?? 0;
  const positive = summary?.positive ?? 0;
  const avgScore = summary?.avgScore ?? null;
  const meetingsReq = summary?.meetingsRequested ?? 0;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allMatchingSelected = matching > 0 && selectedIds.size === matching;

  /** Select every lead matching the filters, across all pages. */
  async function toggleSelectAll() {
    if (allMatchingSelected) {
      setSelectedIds(new Set());
      return;
    }
    try {
      const res = (await listLeadsPageFn({ data: { filters: pageFilters, idsOnly: true } })) as {
        ids: string[];
        matching: number;
      };
      setSelectedIds(new Set(res.ids));
      if (res.ids.length < res.matching) {
        toast.info(`Selected the first ${res.ids.length.toLocaleString()} of ${res.matching.toLocaleString()} leads`);
      }
    } catch (e) {
      toast.error("Could not select all leads", { description: (e as Error).message });
    }
  }

  async function handleSetStatus(id: string, status: (typeof STATUS_OPTIONS)[number]["value"]) {
    try {
      await setStatusFn({ data: { id, status } });
      qc.invalidateQueries({ queryKey: ["leads-all"] });
      // The Qualified tab lives on a separate route with its own cached
      // queries (staleTime 5min) — without invalidating these too, a status
      // change made here doesn't show up there until the cache expires.
      qc.invalidateQueries({ queryKey: ["leads-qualified"] });
      qc.invalidateQueries({ queryKey: ["qualification-stats"] });
      qc.invalidateQueries({ queryKey: ["wbah-qualified-leads"] });
    } catch (e) {
      toast.error("Failed to update status", { description: (e as Error).message });
    }
  }

  async function handleStartQualification({
    agentId,
    fromNumber,
  }: {
    agentId: string;
    fromNumber: string | null;
  }) {
    try {
      const result = await startQualFn({
        data: {
          leadIds: Array.from(selectedIds),
          agentId,
          fromNumber,
        },
      });
      const limitMsg =
        result.limitReached > 0 ? ` · ${result.limitReached} at daily limit` : "";
      const firstError = result.errors?.[0]?.message;
      const failMsg =
        result.failed > 0
          ? `${result.failed} failed${firstError ? ` — ${firstError}` : ""}${limitMsg}`
          : limitMsg || undefined;
      if (result.placed === 0 && result.failed > 0) {
        toast.error("Qualification calls failed", { description: failMsg });
      } else {
        toast.success(`Qualification started — ${result.placed} calls placed`, {
          description: failMsg,
        });
      }
      setQualDialogOpen(false);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["leads-all"] });
    } catch (e) {
      toast.error("Failed to start qualification", { description: (e as Error).message });
    }
  }

  async function handleScheduleQualification({
    agentId,
    fromNumber,
    scheduledAtIso,
  }: {
    agentId: string;
    fromNumber: string | null;
    scheduledAtIso: string;
  }) {
    try {
      const result = await scheduleCallsFn({
        data: {
          leadIds: Array.from(selectedIds),
          agentId,
          fromNumber,
          scheduledAt: scheduledAtIso,
        },
      });
      toast.success(`${result.scheduled} lead${result.scheduled !== 1 ? "s" : ""} scheduled`, {
        description: `Calls will be placed at ${new Date(scheduledAtIso).toLocaleString(undefined, wbahDateTimeOptions(isWbah))}`,
      });
      setQualDialogOpen(false);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["leads-all"] });
    } catch (e) {
      toast.error("Failed to schedule qualification calls", { description: (e as Error).message });
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
          description: (result.failed ?? 0) > 0 ? `${result.failed} failed` : undefined,
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
    setQualDialogOpen(true);
  }

  function openRemoveDialog() {
    if (selectedIds.size === 0) {
      toast.error("Select at least one lead first");
      return;
    }
    setRemoveDialogOpen(true);
  }

  async function handleRemoveLeads() {
    setIsRemoving(true);
    try {
      const result = await removeLeadsFn({ data: { leadIds: Array.from(selectedIds) } });
      toast.success(`Removed ${result.removed} lead${result.removed !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      setRemoveDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["leads-all"] });
      qc.invalidateQueries({ queryKey: ["leads-qualified"] });
      qc.invalidateQueries({ queryKey: ["qualification-stats"] });
    } catch (e) {
      toast.error("Failed to remove leads", { description: (e as Error).message });
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <DashboardPage>
      {!isWbah && <SavedFiltersSection pageKey="leads" />}
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
            <Button
              size="sm"
              variant="outline"
              className="border-blue-500/30 text-blue-400 hover:text-blue-300"
              onClick={openQualDialog}
            >
              <ShieldCheck className="mr-1 h-4 w-4" />
              Qualify {selectedIds.size} Lead{selectedIds.size !== 1 ? "s" : ""}
            </Button>
          )}
          {tab === "leads" && !isWbah && selectedIds.size > 0 && canAssign && (
            <Button
              size="sm"
              variant="outline"
              className="border-emerald-500/30 text-emerald-400 hover:text-emerald-300"
              onClick={() => setAssignDialogOpen(true)}
            >
              <UserPlus className="mr-1 h-4 w-4" />
              Assign {selectedIds.size}
            </Button>
          )}
          {tab === "leads" && !isWbah && selectedIds.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-red-500/30 text-red-400 hover:text-red-300"
              onClick={openRemoveDialog}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Remove {selectedIds.size} Lead{selectedIds.size !== 1 ? "s" : ""}
            </Button>
          )}
          {tab === "leads" && !isWbah && canCreateLead && (
            <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => setAddLeadOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Lead
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => {
              leadsQ.refetch();
              statsQ.refetch();
            }}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard
          label="Total Leads"
          value={totalLeads}
          icon={Users}
          iconBg="bg-blue-500/15"
          iconColor="text-blue-400"
        />
        <KpiCard
          label="Positive Sentiment"
          value={positive}
          icon={TrendingUp}
          iconBg="bg-emerald-500/15"
          iconColor="text-emerald-400"
          hint={totalLeads > 0 ? `${Math.round((positive / totalLeads) * 100)}%` : undefined}
        />
        <KpiCard
          label="Avg Lead Score"
          value={avgScore ?? "—"}
          icon={Target}
          iconBg="bg-violet-500/15"
          iconColor="text-violet-400"
        />
        <KpiCard
          label="Meetings Req."
          value={meetingsReq}
          icon={CalendarCheck}
          iconBg="bg-amber-500/15"
          iconColor="text-amber-400"
        />
      </div>

      {/* Campaign stats mini strip */}
      {stats && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MiniKpiCard label="Calls Made" value={stats.called} hint={`of ${stats.total} records`} />
          <MiniKpiCard
            label="Contacts Reached"
            value={stats.reached}
            hint={`${stats.conversionRate}% connect rate`}
          />
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
        <div className="min-w-0 overflow-hidden rounded-xl border border-border dark:border-white/[0.06] bg-card/60">
          <div className="flex flex-col gap-1.5 border-b border-border dark:border-white/[0.06] px-2.5 py-1.5 sm:px-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {isWbah ? "Positive / Neutral Leads" : "Lead Records"}
              {hasLeadFilters && (
                <span className="ml-2 normal-case text-xs font-normal text-muted-foreground tracking-normal">
                  {matching.toLocaleString()} matching
                </span>
              )}
              {selectedIds.size > 0 && (
                <span className="ml-2 normal-case text-xs font-normal text-blue-400 tracking-normal">
                  {selectedIds.size} selected
                </span>
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
                className="h-6 rounded-md border border-border dark:border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
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
                className="h-6 rounded-md border border-border dark:border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                <option value="">All Statuses</option>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                value={sentimentFilter}
                onChange={(e) => setSentimentFilter(e.target.value)}
                className="h-6 rounded-md border border-border dark:border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                <option value="">All Sentiments</option>
                <option value="positive">Positive</option>
                <option value="neutral">Neutral</option>
                {!isWbah && <option value="negative">Negative</option>}
              </select>
              <select
                value={originFilter}
                onChange={(e) => setOriginFilter(e.target.value)}
                className="h-6 rounded-md border border-border dark:border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                title="Lead source / origin"
              >
                {ORIGIN_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {(isRetell || isWbah) && (
                <select
                  value={callStatusFilter}
                  onChange={(e) => setCallStatusFilter(e.target.value)}
                  className="h-6 rounded-md border border-border dark:border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
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
                className="h-6 rounded-md border border-border dark:border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
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
                className="h-6 rounded-md border border-border dark:border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                title="Call outcome"
              >
                <option value="">All Outcomes</option>
                <option value="successful">Successful</option>
                <option value="unsuccessful">Unsuccessful</option>
              </select>
              <select
                value={wbahDaysFilter}
                onChange={(e) => setWbahDaysFilter(e.target.value)}
                className="h-6 rounded-md border border-border dark:border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
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
                    className="h-6 rounded-md border border-border dark:border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                    title="From date"
                  />
                  <span className="text-[11px] text-muted-foreground">to</span>
                  <input
                    type="date"
                    value={leadsTo}
                    min={leadsFrom || undefined}
                    onChange={(e) => setLeadsTo(e.target.value)}
                    className="h-6 rounded-md border border-border dark:border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                    title="To date"
                  />
                </div>
              )}
              {(isWbah || wbahAgentOptions.length > 0) && (
                <select
                  value={wbahAgentFilter}
                  onChange={(e) => setWbahAgentFilter(e.target.value)}
                  className="h-6 rounded-md border border-border dark:border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                >
                  <option value="all">All agents</option>
                  {wbahAgentOptions.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              )}
              {!isWbah && workspaceAgents.length > 0 && (
                <select
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                  className="h-6 rounded-md border border-border dark:border-white/[0.08] bg-card/80 px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  title="Filter by agent"
                >
                  <option value="all">All agents</option>
                  {workspaceAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {agentTypeLabel(a.agentType)}
                    </option>
                  ))}
                </select>
              )}
              {hasLeadFilters && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("");
                    setLeadStatusCat("all");
                    setSentimentFilter("");
                    setCallStatusFilter("");
                    setQuickFilter("");
                    setLeadsDuration("");
                    setLeadsOutcome("");
                    setWbahAgentFilter("all");
                    setAgentFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border dark:border-white/[0.06] px-2.5 py-1.5 sm:px-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mr-1">
              Quick filter
            </span>
            {[
              { value: "positive", label: "Positive" },
              { value: "neutral", label: "Neutral" },
              ...(isWbah ? [{ value: "partial_qualified", label: "Partial Qualified" }] : []),
              ...(!isWbah ? [{ value: "buzzchat_replied", label: "BuzzChat Replied" }] : []),
            ].map((c) => {
              const active = quickFilter === c.value;
              return (
                <button
                  key={c.value}
                  onClick={() => setQuickFilter(active ? "" : c.value)}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 transition-colors ${
                    active
                      ? "bg-primary/15 text-primary ring-primary/30"
                      : "bg-card/80 text-muted-foreground ring-border dark:ring-white/[0.08] hover:text-foreground ring-border dark:hover:ring-white/20"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
            <span className="ml-auto text-[11px] text-muted-foreground">
              {matching.toLocaleString()} shown
            </span>
          </div>
          <div className="p-0">
            {leadsQ.isLoading || !wsResolved ? (
              <LoadingProgress label="Loading leads" estimatedMs={8000} />
            ) : matching === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Users className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No leads yet</p>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Once a Lead Generation agent completes a call, lead intelligence will appear here
                  automatically.
                </p>
              </div>
            ) : (
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border dark:border-white/[0.06] bg-card/30">
                      <th className={cn("px-2 py-1 w-8", isWbah && cn(stickyHead, "left-0"))}>
                        <Checkbox
                          checked={allMatchingSelected}
                          onCheckedChange={toggleSelectAll}
                        />
                      </th>
                      <th
                        className={cn(
                          "px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
                          isWbah && cn(stickyHead, "left-8 w-44"),
                        )}
                      >
                        Name
                      </th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Phone
                      </th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Status
                      </th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Sentiment
                      </th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Score
                      </th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Interest
                      </th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Summary
                      </th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Next Action
                      </th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                        Last Contact
                      </th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                        Last Called At
                      </th>
                      {isRetell && (
                        <>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                            Call Status
                          </th>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                            Duration
                          </th>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            Recording
                          </th>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            Transcript
                          </th>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                            End Reason
                          </th>
                        </>
                      )}
                      {isWbah && (
                        <>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                            Call Status
                          </th>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                            Duration
                          </th>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            Recording
                          </th>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            Transcript
                          </th>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                            Appt Date
                          </th>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                            Appt Time
                          </th>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                            Booking
                          </th>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                            Calendly
                          </th>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                            End Reason
                          </th>
                          <th className="px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
                            Disconnection
                          </th>
                        </>
                      )}
                      <th className="px-2 py-1 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadsPag.sliced.map((lead) => (
                      <tr
                        key={lead.id}
                        className={`group h-8 border-b border-border/60 dark:border-white/[0.04] align-middle hover:bg-muted/40 dark:hover:bg-white/[0.02] transition-colors ${selectedIds.has(lead.id) ? "bg-blue-500/5" : ""}`}
                      >
                        <td className={cn("px-2 py-0.5", isWbah && cn(stickyCell, "left-0 w-8"))}>
                          <Checkbox
                            checked={selectedIds.has(lead.id)}
                            onCheckedChange={() => toggleSelect(lead.id)}
                          />
                        </td>
                        <td
                          className={cn(
                            "px-2 py-0.5",
                            isWbah && cn(stickyCell, "left-8 w-44 overflow-hidden"),
                          )}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1 min-w-0">
                              <span className="truncate text-[11px] font-medium min-w-0">
                                {lead.full_name ?? "—"}
                              </span>
                              <LeadSourceBadge lead={lead} />
                              <BookingFailedBadge lead={lead} />
                              {!isWbah && lead.has_buzzchat_reply && (
                                <span
                                  title="BuzzChat reply received"
                                  className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30 whitespace-nowrap"
                                >
                                  <MessageCircle className="h-2.5 w-2.5" />
                                  BuzzChat
                                </span>
                              )}
                              {isWbah && (
                                <WbahCallCountBadge
                                  count={lead.meta?.call_count ?? 1}
                                  onClick={() => openCallHistory(lead)}
                                />
                              )}
                              {isWbah && (
                                <WbahBookedStickyBadge
                                  lead={lead}
                                  agentColorMap={wbahAgentColorMap}
                                />
                              )}
                            </div>
                          </div>
                          {lead.company_name && (
                            <div className="truncate text-[10px] text-muted-foreground font-normal">
                              {lead.company_name}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-0.5 text-muted-foreground whitespace-nowrap text-[10px] font-mono">
                          <span className="inline-flex items-center gap-1">
                            {lead.phone}
                            <PreferredContactBadge lead={lead} onEmailClick={setEmailDialogLead} />
                            <QuickDialerCallButton phone={lead.phone} name={lead.full_name} />
                          </span>
                          {String(
                            lead?.preferred_contact ??
                              lead?.preferred_contact_method ??
                              lead?.meta?.preferred_contact ??
                              lead?.meta?.preferred_contact_method ??
                              "",
                          )
                            .toLowerCase()
                            .trim() === "email" &&
                            lead.email && (
                              <button
                                type="button"
                                title={`Email ${lead.email}`}
                                onClick={() => setEmailDialogLead(lead)}
                                className="block truncate max-w-[140px] text-left text-orange-400 hover:underline"
                              >
                                {lead.email}
                              </button>
                            )}
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
                                  return lead.meta?.partial_qualified ? (
                                    <StatusBadge
                                      tone="sky"
                                      size="sm"
                                      className="ring-1 ring-sky-500/20"
                                    >
                                      Partial Qualified
                                    </StatusBadge>
                                  ) : (
                                    <StatusBadge
                                      tone="warning"
                                      size="sm"
                                      className="ring-1 ring-amber-500/20"
                                    >
                                      Neutral
                                    </StatusBadge>
                                  );
                                }
                                const cfg: Record<
                                  string,
                                  { label: string; tone: "success" | "danger" | "neutral" }
                                > = {
                                  positive: {
                                    label: "Qualified",
                                    tone: "success",
                                  },
                                  negative: {
                                    label: "Not Qualified",
                                    tone: "danger",
                                  },
                                  unknown: {
                                    label: "Unknown",
                                    tone: "neutral",
                                  },
                                };
                                const { label, tone } = cfg[ns] ?? cfg.unknown;
                                return (
                                  <StatusBadge tone={tone} size="sm" className="font-medium">
                                    {label}
                                  </StatusBadge>
                                );
                              }
                              const sd = statusDisplay(lead.status);
                              return (
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${sd.color}`}
                                >
                                  {sd.label}
                                </span>
                              );
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
                          {fmtDate(lead.last_contacted_at, isWbah)}
                        </td>
                        <td className="px-2 py-0.5 text-muted-foreground whitespace-nowrap text-[11px]">
                          {fmtCallDate(
                            isWbah
                              ? lead.meta?.last_called_at
                              : isRetell
                                ? lead.retell_call?.started_at
                                : lead.last_contacted_at,
                            isWbah,
                          )}
                        </td>
                        {isRetell && (
                          <>
                            <td className="px-2 py-0.5">
                              {callStatusBadge(lead.retell_call?.call_status)}
                            </td>
                            <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
                              {fmtDuration((lead.retell_call?.duration_seconds ?? 0) * 1000)}
                            </td>
                            <td className="px-2 py-0.5">
                              {lead.retell_call?.recording_url ? (
                                <PlayRecordingButton
                                  url={lead.retell_call.recording_url}
                                  contact={lead.name ?? lead.phone ?? "Lead"}
                                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-blue-400/80 hover:text-blue-400 hover:bg-blue-500/10 border border-blue-500/20 transition-colors whitespace-nowrap"
                                />
                              ) : (
                                <span className="text-muted-foreground text-[11px]">—</span>
                              )}
                            </td>
                            <td className="px-2 py-0.5">
                              {lead.retell_call?.transcript ? (
                                <button
                                  onClick={() => setWbahTranscript(lead.retell_call?.transcript ?? null)}
                                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-violet-400/80 hover:text-violet-400 hover:bg-violet-500/10 border border-violet-500/20 transition-colors whitespace-nowrap"
                                >
                                  <span>Transcript</span>
                                </button>
                              ) : (
                                <span className="text-muted-foreground text-[11px]">—</span>
                              )}
                            </td>
                            <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
                              {lead.retell_call?.disconnection_reason
                                ? String(lead.retell_call.disconnection_reason).replace(/_/g, " ")
                                : "—"}
                            </td>
                          </>
                        )}
                        {isWbah && (
                          <>
                            <td className="px-2 py-0.5">
                              {callStatusBadge(lead.meta?.call_status)}
                            </td>
                            <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
                              {fmtDuration(lead.meta?.duration_ms ?? null)}
                            </td>
                            <td className="px-2 py-0.5">
                              {lead.meta?.recording_url ? (
                                <PlayRecordingButton
                                  url={lead.meta.recording_url}
                                  contact={lead.name ?? lead.phone ?? "Lead"}
                                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-blue-400/80 hover:text-blue-400 hover:bg-blue-500/10 border border-blue-500/20 transition-colors whitespace-nowrap"
                                />
                              ) : (
                                <span className="text-muted-foreground text-[11px]">—</span>
                              )}
                            </td>
                            <td className="px-2 py-0.5">
                              {isWbah ? (
                                lead.meta?.has_transcript ? (
                                  <button
                                    onClick={() => openWbahTranscriptFromLead(lead)}
                                    className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-violet-400/80 hover:text-violet-400 hover:bg-violet-500/10 border border-violet-500/20 transition-colors whitespace-nowrap"
                                  >
                                    <span>Transcript</span>
                                  </button>
                                ) : (
                                  <span className="text-muted-foreground text-[11px]">—</span>
                                )
                              ) : lead.call_summary ? (
                                <button
                                  onClick={() => setWbahTranscript(lead.call_summary ?? null)}
                                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-violet-400/80 hover:text-violet-400 hover:bg-violet-500/10 border border-violet-500/20 transition-colors whitespace-nowrap"
                                >
                                  <span>Transcript</span>
                                </button>
                              ) : (
                                <span className="text-muted-foreground text-[11px]">—</span>
                              )}
                            </td>
                            <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
                              {wbahAppointmentDate(lead) ?? "—"}
                            </td>
                            <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
                              {wbahAppointmentTime(lead) ?? "—"}
                            </td>
                            <td className="px-2 py-0.5">
                              {bookingStatusBadge(wbahBookingStatus(lead))}
                            </td>
                            <td className="px-2 py-0.5">
                              <WbahCalendlyLink lead={lead} />
                            </td>
                            <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
                              {lead.meta?.end_reason ?? "—"}
                            </td>
                            <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
                              {lead.meta?.disconnection_reason ?? "—"}
                            </td>
                          </>
                        )}
                        <td className="px-2 py-0.5">
                          <div className="flex items-center gap-1">
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
                            {/* Not on WBAH: that tab is derived from wbah_calls, so
                                `lead.id` there is a Retell call id ("call_…") and
                                there is no lead record behind the row for the
                                assistant to read. Every other lead-specific action
                                on this page is gated the same way. */}
                            {!isWbah && canUseAssistant && (
                              <button
                                onClick={() =>
                                  setAssistantTarget({
                                    id: lead.id,
                                    source: "lead",
                                    name: lead.full_name ?? null,
                                    company: lead.company_name ?? null,
                                  })
                                }
                                title="AI Sales Assistant"
                                className="flex items-center gap-1 rounded border border-primary/25 px-1.5 py-1 text-[10px] font-medium text-primary/80 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
                              >
                                <Sparkles className="h-3 w-3" />
                                <span>Generate</span>
                              </button>
                            )}
                          </div>
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
                  loading={leadsQ.isFetching}
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
      <StartCallsDialog
        open={qualDialogOpen}
        onOpenChange={setQualDialogOpen}
        count={selectedIds.size}
        entityLabel="lead"
        title="Assign Qualification Agent"
        agents={qualAgents}
        defaultAgentId={qualAgents[0]?.id}
        footerNote="Max 3 call attempts per lead per day — leads at the limit will be skipped."
        scheduleHint='Click "Run Scheduled" on the Leads page when the time arrives to fire the calls.'
        onStart={handleStartQualification}
        onSchedule={handleScheduleQualification}
      />

      {/* Remove Leads confirmation */}
      <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Remove {selectedIds.size} lead{selectedIds.size !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription>
              This permanently deletes the selected lead{selectedIds.size !== 1 ? "s" : ""} and
              cannot be undone. Their call history is not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRemoveDialogOpen(false)}
              disabled={isRemoving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-red-600 text-white hover:bg-red-500"
              onClick={handleRemoveLeads}
              disabled={isRemoving}
            >
              {isRemoving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-4 w-4" />
              )}
              Remove
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
                {callHistory.phone} · {callHistory.calls.length} call
                {callHistory.calls.length !== 1 ? "s" : ""}. The main lead shows the definitive
                outcome (a positive call wins); here are all attempts.
              </DialogDescription>
            </DialogHeader>
            {callHistory.loading ? (
              <div className="py-8 flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading calls…
              </div>
            ) : callHistory.calls.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No calls found.</p>
            ) : (
              <WbahContactCallHistoryTable
                calls={callHistory.calls}
                contactLabel={callHistory.name || callHistory.phone || "Lead"}
                onViewTranscript={openHistoryTranscript}
              />
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
            <pre className="whitespace-pre-wrap text-xs text-muted-foreground font-sans leading-relaxed">
              {wbahTranscript}
            </pre>
          </DialogContent>
        </Dialog>
      )}

      {/* Notes & Booking sheet */}
      {panel && (
        <NotesBookingSheet
          open={!!panel}
          onOpenChange={(o) => {
            if (o) return;
            setPanel(null);
            if (requestedLeadId) {
              navigate({ to: "/leads", search: { id: undefined }, replace: true });
            }
          }}
          entityType={panel.entityType}
          entityId={panel.entityId}
          entityName={panel.entityName}
          defaultPhone={panel.defaultPhone}
          defaultEmail={panel.defaultEmail}
          leadId={panel.leadId}
          callSummary={panel.callSummary}
        />
      )}

      <LeadEmailDialog lead={emailDialogLead} onClose={() => setEmailDialogLead(null)} />

      {assignDialogOpen && (
        <AssignLeadsDialog
          open={assignDialogOpen}
          onOpenChange={setAssignDialogOpen}
          leadIds={Array.from(selectedIds)}
          onAssigned={() => setSelectedIds(new Set())}
        />
      )}

      {/* Manual lead entry. upsertLead already handles the insert, the new-lead
          notification and the auto-call trigger, so this is only the form. */}
      <LeadAiAssistantPanel
        target={assistantTarget}
        onOpenChange={(o) => !o && setAssistantTarget(null)}
      />

      <Dialog
        open={addLeadOpen}
        onOpenChange={(o) => {
          setAddLeadOpen(o);
          if (!o) setNewLead(emptyNewLead);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a lead</DialogTitle>
            <DialogDescription>
              Phone number is required — it is how calls and WhatsApp replies are matched back to
              this lead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="nl-phone" className="text-xs">
                Phone <span className="text-destructive">*</span>
              </Label>
              <Input
                id="nl-phone"
                type="tel"
                value={newLead.phone}
                onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })}
                placeholder="+44 7700 900000"
                className="h-8 text-sm"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nl-name" className="text-xs">
                Full name
              </Label>
              <Input
                id="nl-name"
                value={newLead.full_name}
                onChange={(e) => setNewLead({ ...newLead, full_name: e.target.value })}
                placeholder="Jane Smith"
                className="h-8 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="nl-email" className="text-xs">
                  Email
                </Label>
                <Input
                  id="nl-email"
                  type="email"
                  value={newLead.email}
                  onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
                  placeholder="jane@example.com"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="nl-company" className="text-xs">
                  Company
                </Label>
                <Input
                  id="nl-company"
                  value={newLead.company_name}
                  onChange={(e) => setNewLead({ ...newLead, company_name: e.target.value })}
                  placeholder="Acme Ltd"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="nl-notes" className="text-xs">
                Notes
              </Label>
              <Input
                id="nl-notes"
                value={newLead.notes}
                onChange={(e) => setNewLead({ ...newLead, notes: e.target.value })}
                placeholder="Where this lead came from, what they asked for…"
                className="h-8 text-sm"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Saved with source “Manual entry”. If auto-call is enabled for this workspace, adding a
              lead can start a qualification call straight away.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddLeadOpen(false)}
              disabled={createLead.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => createLead.mutate()}
              disabled={createLead.isPending || !isManualLeadSubmittable(newLead)}
            >
              {createLead.isPending ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Adding…
                </>
              ) : (
                "Add lead"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardPage>
  );
}
