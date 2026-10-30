import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { firstText, mapWbahCatRow, type WbahCategorySourceRow, type WbahPeopleRow } from "@/components/data/wbah-people-row";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  Database,
  PhoneOutgoing,
  CalendarClock,
  UserCheck,
  Search,
  X,
  UserPlus,
  BarChart3,
  Users,
  RefreshCw,
  Download,
  AlertCircle,
  Phone,
  PhoneForwarded,
  Play,
  FileText,
  Eye,
  Trash2,
} from "lucide-react";
import { LeadAiAssistantPanel, type AssistantTarget } from "@/components/leads/LeadAiAssistantPanel";
import { useSalesAssistantAccess } from "@/hooks/useSalesAssistantAccess";
import { WbahCallSchedulingSection } from "@/components/dashboard/WbahCallSchedulingSection";
import { WbahTestLeadBadge } from "@/components/dashboard/WbahTestLeadBadge";
import { WbahNewLeadSubBadge } from "@/components/dashboard/WbahNewLeadSubBadge";
import { WbahNewLeadSyncToggle } from "@/components/dashboard/WbahNewLeadSyncToggle";
import { WbahCallbacksPanel } from "@/components/dashboard/WbahCallbacksPanel";
import { StartCallsDialog } from "@/components/dashboard/StartCallsDialog";
import { DashboardPage, KpiCard, stickyCell, stickyHead } from "@/components/dashboard/PageShell";
import { dqReasonLabel, isWbahLeadCallable, parseWbahCrmData, type WbahCrmData } from "@/lib/integrations/webespokeEnterprise/wbah-crm-data.types";
import { cn } from "@/lib/utils";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useTablePagination, TablePagBar, type PageSize } from "@/components/ui/table-pagination";
import { toast } from "sonner";
import { createDialerSessionFromDataRecords, getDialerQuickCallDefaults } from "@/lib/telephony/auto-dialer.functions";
import {
  listDataRecords,
  importDataRecords,
  assignAgentToRecords,
  scheduleCallsForRecords,
  startCallingRecords,
  resetDataRecord,
  deleteDataRecords,
  addDataRecordToLead,
  fetchCrmPeople,
  fetchQualifiedLeads,
  setRecordCallStatus,
  type CrmPersonRow,
  type QualifiedLeadRow,
} from "@/lib/dashboard/data-records.functions";
import { getCallSchedule, setCallSchedule } from "@/lib/dashboard/call-schedule.functions";
import { listLiveAgents } from "@/lib/agents/agents.functions";
import {
  listWbahCallsCount,
  listWbahCallsPaged,
  getWbahCallDetail,
  listWbahCategorizedLeads,
  listWbahPeopleCategories,
  getWbahCallbackSummary,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import type { CallbackSummary } from "@/lib/integrations/webespokeEnterprise/wbah-callbacks.types";
import { useWbahAgentOptions } from "@/hooks/useWbahAgentOptions";
import { agentTypeLabel } from "@/components/shared/AgentFilterSelect";
import { useIsWbahWorkspace } from "@/hooks/useIsWbahWorkspace";
import { CustomViewsSection } from "@/components/people-views/CustomViewsSection";
import { WbahCallBookingSection } from "@/components/dashboard/WbahCallBookingSection";
import { WbahCallCalendlyLink } from "@/components/dashboard/WbahCallCalendlyLink";
import {
  extractWbahCallBookingFields,
  isWbahCallAnalysisComplete,
  isWbahCallAnalysisPending,
  resolveWbahDisplaySentiment,
  wbahAppointmentDateCell,
  wbahAppointmentTimeCell,
  wbahBookingStatusCell,
} from "@/lib/dashboard/wbah-call-booking-display";
import { sanitizeWbahBookingFields } from "@/lib/dashboard/wbah-booking-meta";
import {
  isTestLeadStatus,
  isTestLeadSyncDisabledError,
  NEW_LEAD_STATUS,
  NEW_LEAD_SYNC_SUB_SLUGS,
  resolveWbahCrmPersonName,
  TEST_LEAD_STATUS,
} from "@/lib/integrations/webespokeEnterprise/wbah-campaign-sync.types";
import { callWbahDelayedLead } from "@/lib/qualification/auto-call.server";
import { AutoDialSetupDialog } from "@/components/data/AutoDialSetupDialog";
import { CallScheduleDialog } from "@/components/data/CallScheduleDialog";
import { CsvMappingDialog } from "@/components/data/CsvMappingDialog";
import { DynamicDataTable } from "@/components/data/DynamicDataTable";
import { ManualEntryDialog } from "@/components/data/ManualEntryDialog";
import { ScheduleCallsDialog } from "@/components/data/ScheduleCallsDialog";
import { StartCallingDialog } from "@/components/data/StartCallingDialog";
import { WbahLeadDetailModal, type WbahLeadDetailView, wbahCallDetailFromRow } from "@/components/data/WbahLeadDetailModal";
import { parseCsvLine, toMetaKey } from "@/components/data/data-csv.shared";
import { CALL_STATUSES, fmtDate, fmtMs, fmtTs, truncateDqReason, wbahCallStatusBadge, wbahDateCutoff, wbahSentimentBadge } from "@/components/data/data-format";
import { WBAH_CALLBACK_TAB, WBAH_PEOPLE_TABS, wbahCatStyle, wbahRowPasses } from "@/components/data/wbah-people-tabs";

export const Route = createFileRoute("/_authenticated/data")({
  head: () => ({ meta: [{ title: "Data Records — Webee" }] }),
  component: DataPage,
});

function DataPage() {
  const [search, setSearch] = useState("");
  const [callStatus, setCallStatus] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [startCallingOpen, setStartCallingOpen] = useState(false);
  const [autoDialOpen, setAutoDialOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [callScheduleOpen, setCallScheduleOpen] = useState(false);
  const { isWbah, resolved: isWbahResolved } = useIsWbahWorkspace();
  const [dataTab, setDataTab] = useState<"records" | "campaigns" | "people">("records");

  useEffect(() => {
    if (isWbahResolved && !isWbah) setDataTab("people");
  }, [isWbahResolved, isWbah]);

  const [crmPeople, setCrmPeople] = useState<CrmPersonRow[]>([]);
  const [crmPeopleLoading, setCrmPeopleLoading] = useState(false);
  const [crmPeopleError, setCrmPeopleError] = useState<string | null>(null);
  const [crmPeopleSelected, setCrmPeopleSelected] = useState<Set<string>>(new Set());
  const [crmImporting, setCrmImporting] = useState(false);
  const [crmImportAgentId, setCrmImportAgentId] = useState<string>("");
  const [crmSearch, setCrmSearch] = useState("");
  const [crmStatusFilter, setCrmStatusFilter] = useState("all");
  const [crmDateFilter, setCrmDateFilter] = useState("all");
  const [crmCallDialogOpen, setCrmCallDialogOpen] = useState(false);

  const [qualifiedLeads, setQualifiedLeads] = useState<QualifiedLeadRow[]>([]);
  const [qualifiedLoading, setQualifiedLoading] = useState(false);
  const [qualifiedError, setQualifiedError] = useState<string | null>(null);

  // WBAH Calls tab — server-side paginated (never loads the full ~20MB list).
  const [wbahCallsData, setWbahCallsData] = useState<WbahPeopleRow[]>([]); // current page rows
  const [wbahCallsLoading, setWbahCallsLoading] = useState(false);
  const [wbahCallsError, setWbahCallsError] = useState<string | null>(null);
  const [wbahCallsCount, setWbahCallsCount] = useState(0); // total (badge)
  const [wbahCallsPage, setWbahCallsPage] = useState(1);
  const [wbahCallsPageSize, setWbahCallsPageSize] = useState<number>(25);
  const [wbahCallsTotal, setWbahCallsTotal] = useState(0);
  // Fixed lead-filter categories from UAT CRM_data (one People sub-tab each).
  const [wbahCategories, setWbahCategories] = useState<{ name: string; count: number }[]>([]);
  const [wbahCatLoadingList, setWbahCatLoadingList] = useState(false);
  const [wbahCatListError, setWbahCatListError] = useState<string | null>(null);
  const [wbahCatData, setWbahCatData] = useState<Record<string, WbahPeopleRow[]>>({});
  const [wbahCatPage, setWbahCatPage] = useState(1);
  const [wbahCatPageSize, setWbahCatPageSize] = useState(50);
  const [wbahCatLoadingMap, setWbahCatLoadingMap] = useState<Record<string, boolean>>({});
  const [wbahCatErrorMap, setWbahCatErrorMap] = useState<Record<string, string | null>>({});
  // Active People sub-tab: a lead-filter category name, or the "calls" pseudo-tab.
  const [wbahPeopleSubTab, setWbahPeopleSubTab] = useState<string>("");
  const [wbahPeopleSearch, setWbahPeopleSearch] = useState("");
  const [wbahStatusFilter, setWbahStatusFilter] = useState("all");
  const [wbahSentimentFilter, setWbahSentimentFilter] = useState("all");
  const [wbahDateFilter, setWbahDateFilter] = useState("45d");
  const [wbahAgentFilter, setWbahAgentFilter] = useState("all");
  const [wbahSelected, setWbahSelected] = useState<Set<string>>(new Set());
  const [wbahCallDetailView, setWbahCallDetailView] = useState<{
    name: string;
    summary: string | null;
    transcript: string | null;
    loading?: boolean;
    polling?: boolean;
    callId?: string;
    callRow?: Record<string, unknown>;
  } | null>(null);
  const [wbahLeadDetail, setWbahLeadDetail] = useState<WbahLeadDetailView | null>(null);
  const [wbahNewLeadSyncOn, setWbahNewLeadSyncOn] = useState<boolean | null>(null);
  const [callingDelayedLeadId, setCallingDelayedLeadId] = useState<string | null>(null);

  const canUseAssistant = useSalesAssistantAccess();
  const [assistantTarget, setAssistantTarget] = useState<AssistantTarget | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [showCsvMapping, setShowCsvMapping] = useState(false);
  const [csvImportAgentId, setCsvImportAgentId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wbahCatCountsInFlightRef = useRef(false);

  const listFn = useServerFn(listDataRecords);
  const importFn = useServerFn(importDataRecords);
  const assignFn = useServerFn(assignAgentToRecords);
  const scheduleFn = useServerFn(scheduleCallsForRecords);
  const startCallFn = useServerFn(startCallingRecords);
  const createAutoDialFn = useServerFn(createDialerSessionFromDataRecords);
  const dialerDefaultsFn = useServerFn(getDialerQuickCallDefaults);
  const navigate = useNavigate();
  const resetFn = useServerFn(resetDataRecord);
  const deleteRecordsFn = useServerFn(deleteDataRecords);
  const addToLeadFn = useServerFn(addDataRecordToLead);
  const [addedLeadIds, setAddedLeadIds] = useState<Set<string>>(new Set());
  const getScheduleFn = useServerFn(getCallSchedule);
  const setScheduleFn = useServerFn(setCallSchedule);
  const listAgentsFn = useServerFn(listLiveAgents);
  const fetchCrmPeopleFn = useServerFn(fetchCrmPeople);
  const fetchQualifiedLeadsFn = useServerFn(fetchQualifiedLeads);
  const setStatusFn = useServerFn(setRecordCallStatus);
  const listWbahCallsPagedFn = useServerFn(listWbahCallsPaged);
  const getWbahCallDetailFn = useServerFn(getWbahCallDetail);
  const listWbahCallsCountFn = useServerFn(listWbahCallsCount);
  const listWbahCategorizedLeadsFn = useServerFn(listWbahCategorizedLeads);
  const listWbahPeopleCategoriesFn = useServerFn(listWbahPeopleCategories);
  const getWbahCallbackSummaryFn = useServerFn(getWbahCallbackSummary);
  const callWbahDelayedLeadFn = useServerFn(callWbahDelayedLead);
  const qc = useQueryClient();

  const filters = useMemo(() => {
    const f: Record<string, unknown> = { limit: 500, csvOnly: true };
    if (search.trim()) f.search = search.trim();
    if (callStatus !== "all") f.callStatus = callStatus;
    if (unassignedOnly) f.unassignedOnly = true;
    else if (agentFilter !== "all") f.assignedAgentId = agentFilter;
    return f;
  }, [search, callStatus, agentFilter, unassignedOnly]);

  const recordsQ = useQuery({
    queryKey: ["data-records", filters],
    queryFn: () => listFn({ data: filters }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const agentsQ = useQuery({
    queryKey: ["my-agents-mini"],
    queryFn: () => listAgentsFn(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const scheduleQ = useQuery({
    queryKey: ["call-schedule"],
    queryFn: () => getScheduleFn(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const agents = (agentsQ.data ?? []) as Array<{
    id: string;
    retell_agent_id: string | null;
    name: string;
    settings?: Record<string, unknown> | null;
  }>;
  const crmCallAgents = useMemo(
    () =>
      agents.map((a) => ({
        id: a.id,
        name: a.name,
        phoneNumber: (a.settings as { phoneNumber?: string | null } | null)?.phoneNumber ?? null,
      })),
    [agents],
  );
  const records = recordsQ.data ?? [];

  const stats = useMemo(() => {
    const total = records.length;
    const needToCall = records.filter((r) => r.call_status === "needs_to_call").length;
    const queued = records.filter((r) => r.call_status === "queued").length;
    const completed = records.filter((r) => r.call_status === "completed").length;
    return { total, needToCall, queued, completed };
  }, [records]);

  const allSelected = records.length > 0 && selected.size === records.length;

  const wbahDateCut = useMemo(() => wbahDateCutoff(wbahDateFilter), [wbahDateFilter]);

  // Rows for the currently-active lead-filter category sub-tab.
  const wbahActiveCatRows = useMemo(
    () =>
      wbahPeopleSubTab && wbahPeopleSubTab !== "calls" ? (wbahCatData[wbahPeopleSubTab] ?? []) : [],
    [wbahCatData, wbahPeopleSubTab],
  );

  const wbahAgentNamesFromData = useMemo(() => {
    const names: string[] = [];
    for (const arr of Object.values(wbahCatData)) {
      for (const r of arr) {
        const n = String(r?.agentName ?? "").trim();
        if (n) names.push(n);
      }
    }
    for (const r of wbahCallsData) {
      const n = String(r?.agent_name ?? r?.agentName ?? "").trim();
      if (n) names.push(n);
    }
    return names;
  }, [wbahCatData, wbahCallsData]);

  const { options: wbahAgentOptions } = useWbahAgentOptions(
    wbahAgentNamesFromData,
    isWbah && dataTab === "people",
  );

  const wbahCatFiltered = useMemo(() => {
    // Test Lead rows are CRM cohort records — call-status dropdown is for Calls tab.
    const statusF =
      wbahPeopleSubTab === TEST_LEAD_STATUS || wbahPeopleSubTab === NEW_LEAD_STATUS
        ? "all"
        : wbahStatusFilter;
    // Search is server-side for category tabs (passed to get-crm-data?search=).
    const searchF =
      wbahPeopleSubTab === "calls" || wbahPeopleSubTab === WBAH_CALLBACK_TAB
        ? wbahPeopleSearch
        : "";
    return wbahActiveCatRows.filter((r) =>
      wbahRowPasses(r, searchF, statusF, wbahSentimentFilter, wbahDateCut, wbahAgentFilter),
    );
  }, [
    wbahActiveCatRows,
    wbahPeopleSearch,
    wbahStatusFilter,
    wbahSentimentFilter,
    wbahDateCut,
    wbahAgentFilter,
    wbahPeopleSubTab,
  ]);

  // Calls rows come pre-shaped and already filtered/paginated by the server —
  // no client-side re-mapping or wbahRowPasses filtering (that would only filter
  // the current page and break the server total count).
  const wbahCallsRows = wbahCallsData;

  // Standard CRM People filters — options derived from the workspace's own rows.
  const crmStatusOptions = useMemo(
    () =>
      Array.from(new Set(crmPeople.map((p) => String(p.status ?? "").trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [crmPeople],
  );
  const crmDateCut = useMemo(() => wbahDateCutoff(crmDateFilter), [crmDateFilter]);
  const crmFiltered = useMemo(
    () =>
      crmPeople.filter((p) => {
        if (crmSearch.trim()) {
          const q = crmSearch.toLowerCase();
          if (
            !(p.name ?? "").toLowerCase().includes(q) &&
            !String(p.phone ?? "")
              .toLowerCase()
              .includes(q) &&
            !(p.email ?? "").toLowerCase().includes(q)
          )
            return false;
        }
        if (crmStatusFilter !== "all" && String(p.status ?? "").trim() !== crmStatusFilter)
          return false;
        if (crmDateCut > 0) {
          const ts = p.created_at ? Date.parse(p.created_at) : 0;
          if (!ts || ts < crmDateCut) return false;
        }
        return true;
      }),
    [crmPeople, crmSearch, crmStatusFilter, crmDateCut],
  );
  const crmHasFilters =
    crmSearch.trim() !== "" || crmStatusFilter !== "all" || crmDateFilter !== "all";

  const recordsPag = useTablePagination(records);
  const wbahCatPag = useTablePagination(wbahCatFiltered);
  const crmPag = useTablePagination(crmPeople);

  // Server-driven pagination object with the same shape the table + TablePagBar
  // expect. Changing page/pageSize triggers a refetch via the effect below.
  const wbahCallsPag = {
    page: wbahCallsPage,
    pageSize: wbahCallsPageSize as PageSize,
    totalPages: Math.max(1, Math.ceil(wbahCallsTotal / wbahCallsPageSize)),
    total: wbahCallsTotal,
    sliced: wbahCallsRows,
    setPage: (p: number) => handleFetchWbahCallsPage(p),
    changePageSize: (s: number) => handleFetchWbahCallsPage(1, { pageSize: s }),
  };

  const wbahActiveCatTotal = wbahCategories.find((c) => c.name === wbahPeopleSubTab)?.count ?? 0;

  const wbahCatServerPag = {
    page: wbahCatPage,
    pageSize: wbahCatPageSize as PageSize,
    total: wbahActiveCatTotal,
    totalPages: Math.max(1, Math.ceil(Math.max(wbahActiveCatTotal, 1) / wbahCatPageSize)),
    sliced: wbahCatFiltered,
    setPage: (p: number) => handleFetchWbahCategory(wbahPeopleSubTab, p),
    changePageSize: (s: number) => {
      setWbahCatPageSize(s);
      handleFetchWbahCategory(wbahPeopleSubTab, 1, s);
    },
  };

  const wbahPeopleTotal = useMemo(
    () => wbahCategories.reduce((a, c) => a + c.count, 0),
    [wbahCategories],
  );
  const wbahAnyPeopleData =
    wbahCallsData.length > 0 ||
    wbahCallsTotal > 0 ||
    Object.values(wbahCatData).some((a) => a.length > 0);
  const wbahActiveCatCount = wbahCategories.find((c) => c.name === wbahPeopleSubTab)?.count ?? 0;

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(records.map((r) => r.id)));
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length < 2)
          throw new Error("CSV must have a header row and at least one data row");
        const headers = parseCsvLine(lines[0]).map((h) => h.trim());
        const rows: Record<string, string>[] = [];
        for (let i = 1; i < lines.length; i++) {
          const vals = parseCsvLine(lines[i]);
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => {
            row[h] = (vals[idx] ?? "").trim();
          });
          rows.push(row);
        }
        setCsvHeaders(headers);
        setCsvRows(rows);
        setShowCsvMapping(true);
      } catch (err) {
        toast.error("Could not parse CSV", { description: (err as Error).message });
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  }

  function normalisePhone(raw: string): string {
    let s = raw.replace(/[\s.\-()]/g, "");
    if (s.startsWith("00")) s = "+" + s.slice(2);
    return s;
  }

  async function handleImportMapped(
    mapping: Record<string, string>,
    rows: Record<string, string>[],
  ) {
    setImporting(true);
    try {
      const mapped = rows.map((r) => {
        const out: Record<string, string | null> = {};
        const meta: Record<string, string> = {};
        for (const [csvCol, sysField] of Object.entries(mapping)) {
          if (!sysField) continue;
          if (sysField === "notes") {
            if (r[csvCol]) meta["notes"] = r[csvCol];
          } else if (sysField === "__custom__" || sysField.startsWith("__custom__:")) {
            // __custom__:key — use the encoded key; bare __custom__ falls back to column name
            const key = sysField.startsWith("__custom__:")
              ? sysField.slice(11)
              : toMetaKey(csvCol) || csvCol;
            if (r[csvCol]) meta[key] = r[csvCol];
          } else if (sysField === "mobile_number") {
            out[sysField] = r[csvCol] ? normalisePhone(r[csvCol]) : null;
          } else {
            out[sysField] = r[csvCol] || null;
          }
        }
        return {
          name: (out.name as string) || "",
          mobile_number: (out.mobile_number as string) || "",
          first_name: (out.first_name as string | null) ?? null,
          last_name: (out.last_name as string | null) ?? null,
          email: (out.email as string | null) ?? null,
          title: (out.title as string | null) ?? null,
          client_name: (out.client_name as string | null) ?? null,
          unique_id: (out.unique_id as string | null) ?? null,
          property_type: (out.property_type as string | null) ?? null,
          bedrooms: (out.bedrooms as string | null) ?? null,
          address_line1: (out.address_line1 as string | null) ?? null,
          address_line2: (out.address_line2 as string | null) ?? null,
          city: (out.city as string | null) ?? null,
          state: (out.state as string | null) ?? null,
          postal_code: (out.postal_code as string | null) ?? null,
          lead_external_id: (out.lead_external_id as string | null) ?? null,
          ...(Object.keys(meta).length > 0 ? { meta } : {}),
        };
      });

      const valid = mapped.filter((r) => r.name && r.mobile_number);
      if (valid.length === 0)
        throw new Error(
          "No rows have both name and mobile_number mapped — check your column mapping.",
        );

      const result = await importFn({
        data: {
          rows: valid,
          agentId: csvImportAgentId || null,
        },
      });
      const agentName = csvImportAgentId
        ? agents.find((a) => a.id === csvImportAgentId)?.name
        : null;
      const skipped = result.skipped ?? 0;
      const skipNote =
        skipped > 0 ? ` (${skipped} duplicate${skipped !== 1 ? "s" : ""} skipped)` : "";
      toast.success(
        agentName
          ? `Imported ${result.inserted} records and assigned to ${agentName}${skipNote}`
          : `Imported ${result.inserted} records${skipNote}`,
      );
      qc.invalidateQueries({ queryKey: ["data-records"] });
      qc.invalidateQueries({ queryKey: ["data-record-schema"] });
      setShowCsvMapping(false);
      setShowCsvImport(false);
      setCsvImportAgentId("");
    } catch (err) {
      toast.error("Import failed", { description: (err as Error).message });
    } finally {
      setImporting(false);
    }
  }

  async function handleBulkAssign(agentId: string | null) {
    if (selected.size === 0) return;
    try {
      const result = await assignFn({
        data: { recordIds: Array.from(selected), agentId },
      });
      toast.success(`Assigned ${result.updated} records`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["data-records"] });
    } catch (err) {
      toast.error("Assignment failed", { description: (err as Error).message });
    }
  }

  async function handleReset(recordId: string) {
    try {
      await resetFn({ data: { recordIds: [recordId] } });
      toast.success("Record reset — ready to call again");
      qc.invalidateQueries({ queryKey: ["data-records"] });
    } catch (err) {
      toast.error("Reset failed", { description: (err as Error).message });
    }
  }

  async function handleAddToLead(recordId: string) {
    try {
      const result = await addToLeadFn({ data: { recordId } });
      setAddedLeadIds((prev) => new Set(prev).add(recordId));
      if (result.alreadyLead) {
        toast.message("Already a lead", {
          description: "This phone number is already in Leads.",
        });
      } else {
        toast.success("Added to Leads");
      }
    } catch (err) {
      toast.error("Could not add to Leads", { description: (err as Error).message });
    }
  }

  const { data: dialerDefaultsData } = useQuery({
    queryKey: ["dialer-quick-call-defaults"],
    queryFn: () => dialerDefaultsFn(),
    throwOnError: false,
  });
  const dialerDefaultRouteNumbers =
    dialerDefaultsData?.routeNumbers && dialerDefaultsData.routeNumbers.length === 2
      ? (dialerDefaultsData.routeNumbers as [string, string])
      : null;

  async function handleAutoDial(routeNumbers: string[]) {
    try {
      const result = await createAutoDialFn({
        data: {
          recordIds: Array.from(selected),
          routeNumbers,
        },
      });
      toast.success(`Dialling ${result.targetCount} record(s)…`, {
        description:
          result.skipped > 0
            ? `${result.skipped} record(s) had no dialable phone number and were skipped.`
            : "Watch progress in Auto Dialer.",
      });
      setSelected(new Set());
      navigate({ to: "/auto-dialer", search: { session: result.sessionId } });
    } catch (err) {
      toast.error("Couldn't start the auto dialer", { description: (err as Error).message });
    }
  }

  async function handleStartCalling(agentId: string | null, fromNumber: string | null) {
    try {
      const result = await startCallFn({
        data: {
          recordIds: Array.from(selected),
          agentId: agentId ?? undefined,
          fromNumber: fromNumber || null,
        },
      });
      if (result.failed > 0 && result.placed === 0 && result.queued === 0) {
        const firstError = result.errors?.[0]?.message ?? "Unknown error";
        toast.error(`Failed to place ${result.failed} call${result.failed !== 1 ? "s" : ""}`, {
          description: firstError,
        });
      } else {
        toast.success(
          `Placed: ${result.placed}, queued: ${result.queued}${result.failed ? `, failed: ${result.failed}` : ""}`,
          result.failed && result.errors?.[0]
            ? { description: result.errors[0].message }
            : undefined,
        );
      }
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["data-records"] });
    } catch (err) {
      toast.error("Calling failed", { description: (err as Error).message });
    }
  }

  async function handleSchedule(scheduledAt: string | null, agentId: string | null) {
    try {
      const result = await scheduleFn({
        data: {
          recordIds: Array.from(selected),
          scheduledAt,
          agentId: agentId ?? undefined,
        },
      });
      toast.success(`Scheduled ${result.updated} records`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["data-records"] });
    } catch (err) {
      toast.error("Scheduling failed", { description: (err as Error).message });
    }
  }

  async function handleDisqualify() {
    if (selected.size === 0) return;
    try {
      const result = await setStatusFn({
        data: { recordIds: Array.from(selected), status: "disqualified" },
      });
      toast.success(
        `Marked ${result.updated} record${result.updated !== 1 ? "s" : ""} as disqualified`,
      );
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["data-records"] });
    } catch (err) {
      toast.error("Failed to disqualify", { description: (err as Error).message });
    }
  }

  async function handleDeleteRecords(recordIds: string[]) {
    if (recordIds.length === 0) return;
    if (
      !confirm(
        `Delete ${recordIds.length} record${recordIds.length !== 1 ? "s" : ""}? This removes ${
          recordIds.length !== 1 ? "them" : "it"
        } from this list — support can restore ${recordIds.length !== 1 ? "them" : "it"} if needed.`,
      )
    ) {
      return;
    }
    try {
      const result = await deleteRecordsFn({ data: { recordIds } });
      toast.success(`Deleted ${result.deleted} record${result.deleted !== 1 ? "s" : ""}`);
      setSelected((prev) => {
        const next = new Set(prev);
        recordIds.forEach((id) => next.delete(id));
        return next;
      });
      qc.invalidateQueries({ queryKey: ["data-records"] });
    } catch (err) {
      toast.error("Delete failed", { description: (err as Error).message });
    }
  }

  async function handleFetchCrmPeople() {
    setCrmPeopleLoading(true);
    setCrmPeopleError(null);
    try {
      const people = await fetchCrmPeopleFn({ data: {} });
      setCrmPeople(people as CrmPersonRow[]);
      setCrmPeopleSelected(new Set());
      if ((people as CrmPersonRow[]).length === 0) {
        toast.info("No inbound leads found in your CRM");
      } else {
        toast.success(
          `Found ${(people as CrmPersonRow[]).length} inbound lead${(people as CrmPersonRow[]).length !== 1 ? "s" : ""}`,
        );
      }
    } catch (err) {
      const msg = (err as Error).message;
      setCrmPeopleError(msg);
      toast.error("Failed to pull from CRM", { description: msg });
    } finally {
      setCrmPeopleLoading(false);
    }
  }

  async function handleFetchQualifiedLeads() {
    setQualifiedLoading(true);
    setQualifiedError(null);
    try {
      const leads = await fetchQualifiedLeadsFn({ data: {} });
      setQualifiedLeads(leads as QualifiedLeadRow[]);
    } catch (err) {
      setQualifiedError((err as Error).message);
    } finally {
      setQualifiedLoading(false);
    }
  }

  useEffect(() => {
    if (dataTab === "people") {
      handleFetchQualifiedLeads();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTab]);

  function openWbahLeadDetail(r: WbahPeopleRow) {
    const callId = String(r.wbahCallId ?? r._rawCall?.id ?? "");
    setWbahLeadDetail({
      name: r.name || "Lead",
      call: wbahCallDetailFromRow(r),
      crm: r._rawCrm ?? null,
      postCall: null,
      loadingCall: !!callId,
      row: { name: r.name, contact: r.contact, email: r.email },
    });

    if (!callId) return;

    void (async () => {
      try {
        const d = (await getWbahCallDetailFn({ data: { id: callId } })) as Record<string, unknown>;
        const postCall = (d.postCall as Record<string, unknown> | null) ?? null;
        setWbahLeadDetail((prev) => {
          if (!prev) return prev;
          const merged: WbahPeopleRow = {
            ...r,
            wbahCallId: callId,
            appointmentDate: firstText(d.appointment_date, r.appointmentDate),
            appointmentTime: firstText(d.appointment_time, r.appointmentTime),
            bookingStatus: firstText(d.booking_status, r.bookingStatus),
            calendlyBookingUrl: firstText(d.calendly_booking_url, r.calendlyBookingUrl),
            callSummary: firstText(d.callSummary, r.callSummary),
            call_summary: firstText(d.callSummary, r.call_summary),
            sentimentAnalysis: firstText(d.sentiment, r.sentimentAnalysis),
            sentiment: firstText(d.sentiment, r.sentiment),
            callStatus: firstText(d.callStatus, r.callStatus),
            transcript: firstText(d.transcript, r.transcript),
            recordingUrl: firstText(d.recordingUrl, r.recordingUrl),
            email: firstText(postCall?.email, postCall?.emailAddress, r.email),
          };
          return {
            ...prev,
            loadingCall: false,
            postCall,
            row: {
              name: r.name,
              contact: r.contact,
              email: merged.email ?? r.email,
            },
            call: {
              ...wbahCallDetailFromRow(merged),
              transcript: d.transcript ?? prev.call?.transcript ?? null,
            },
          };
        });
      } catch {
        setWbahLeadDetail((prev) => (prev ? { ...prev, loadingCall: false } : prev));
      }
    })();
  }

  // Fetch the list of lead-filter categories (drives the People sub-tabs) and
  // default the active tab to the largest category on first load.
  async function handleFetchWbahCategoryList() {
    setWbahCatLoadingList(true);
    setWbahCatListError(null);
    // Show the 4 Dynamics tabs immediately — refresh badge counts from server.
    setWbahCategories(WBAH_PEOPLE_TABS);
    setWbahPeopleSubTab((prev) => prev || WBAH_PEOPLE_TABS[0]?.name || "");
    try {
      const [res, callbackSummary] = await Promise.all([
        listWbahPeopleCategoriesFn(),
        getWbahCallbackSummaryFn().catch(() => null),
      ]);
      const cats = res?.categories ?? [];
      const pendingCallbacks = (callbackSummary as CallbackSummary | null)?.pending;
      if (cats.length > 0 || typeof pendingCallbacks === "number") {
        const byName = new Map(cats.map((c) => [c.name, c.count]));
        setWbahCategories(
          WBAH_PEOPLE_TABS.map((tab) => ({
            name: tab.name,
            count:
              tab.name === WBAH_CALLBACK_TAB && typeof pendingCallbacks === "number"
                ? Math.max(0, pendingCallbacks)
                : Math.max(0, byName.get(tab.name) ?? tab.count),
          })),
        );
      }
    } catch (err) {
      setWbahCatListError((err as Error).message || "Failed to load lead categories");
    } finally {
      setWbahCatLoadingList(false);
    }
  }

  const handleCallbackSummaryChange = (summary: CallbackSummary) => {
    setWbahCategories((prev) => {
      const base = prev.length > 0 ? prev : WBAH_PEOPLE_TABS;
      return base.map((c) =>
        c.name === WBAH_CALLBACK_TAB ? { ...c, count: Math.max(0, summary.pending) } : c,
      );
    });
  };

  async function handleFetchWbahCategory(
    cat: string,
    page = 1,
    pageSize = wbahCatPageSize,
    search = wbahPeopleSearch,
  ) {
    if (!cat || cat === "calls" || cat === WBAH_CALLBACK_TAB) return;
    setWbahCatLoadingMap((m) => ({ ...m, [cat]: true }));
    setWbahCatErrorMap((m) => ({ ...m, [cat]: null }));
    try {
      const res = await listWbahCategorizedLeadsFn({
        data: {
          category: cat,
          page,
          limit: pageSize,
          search: search.trim() || undefined,
        },
      });
      const rows = res?.rows ?? [];
      const total = res?.total;
      setWbahCatData((m) => ({ ...m, [cat]: (rows as WbahCategorySourceRow[]).map(mapWbahCatRow) }));
      setWbahCatPage(page);
      if (typeof total === "number") {
        setWbahCategories((prev) => {
          const base = prev.length > 0 ? prev : WBAH_PEOPLE_TABS;
          return base.map((c) => (c.name === cat ? { ...c, count: total } : c));
        });
      }
    } catch (err) {
      setWbahCatErrorMap((m) => ({ ...m, [cat]: (err as Error).message }));
    } finally {
      setWbahCatLoadingMap((m) => ({ ...m, [cat]: false }));
    }
  }

  const wbahCallsDateIso = useMemo(() => {
    const cut = wbahDateCutoff(wbahDateFilter);
    return cut > 0 ? new Date(cut).toISOString() : undefined;
  }, [wbahDateFilter]);

  // Fetch ONE server-paginated page of WBAH calls (lightweight rows only —
  // no transcripts). The full list is never loaded into the browser.
  async function handleFetchWbahCallsPage(
    page: number,
    opts?: { refresh?: boolean; pageSize?: number },
  ) {
    const pageSize = opts?.pageSize ?? wbahCallsPageSize;
    setWbahCallsLoading(true);
    setWbahCallsError(null);
    try {
      const res = await listWbahCallsPagedFn({
        data: {
          page,
          pageSize,
          search: wbahPeopleSearch.trim() || undefined,
          dateFrom: wbahCallsDateIso,
          status: wbahStatusFilter !== "all" ? wbahStatusFilter : undefined,
          sentiment: wbahSentimentFilter !== "all" ? wbahSentimentFilter : undefined,
          agentName: wbahAgentFilter !== "all" ? wbahAgentFilter : undefined,
          refresh: opts?.refresh ?? false,
        },
      });
      const r = res;
      setWbahCallsData((r?.rows ?? []) as WbahPeopleRow[]);
      setWbahCallsTotal(r?.total ?? 0);
      if (typeof r?.total === "number") setWbahCallsCount(r.total);
      setWbahCallsPage(page);
      if (opts?.pageSize) setWbahCallsPageSize(opts.pageSize);
    } catch (err) {
      setWbahCallsError((err as Error).message);
    } finally {
      setWbahCallsLoading(false);
    }
  }

  // Poll call detail until WeeBespoke analysis lands (call_analyzed fields).
  useEffect(() => {
    const callId = wbahCallDetailView?.callId;
    if (!callId || !wbahCallDetailView) return;

    const fields = extractWbahCallBookingFields(wbahCallDetailView.callRow ?? {});
    if (!isWbahCallAnalysisPending(fields)) return;

    let attempts = 0;
    const maxAttempts = 24;
    setWbahCallDetailView((prev) => (prev ? { ...prev, polling: true } : prev));

    const timer = window.setInterval(async () => {
      attempts += 1;
      try {
        const d = (await getWbahCallDetailFn({ data: { id: callId } })) as Record<string, unknown>;
        const merged: Record<string, unknown> = {
          sentimentAnalysis: d.sentiment,
          appointment_date: d.appointment_date,
          appointment_time: d.appointment_time,
          booking_status: d.booking_status,
          call_status: d.callStatus,
          call_summary: d.callSummary,
        };
        const done =
          isWbahCallAnalysisComplete(extractWbahCallBookingFields(merged)) ||
          attempts >= maxAttempts;

        setWbahCallDetailView((prev) => {
          if (!prev) return prev;
          const nextRow: Record<string, unknown> = {
            ...(prev.callRow ?? {}),
            ...d,
            sentimentAnalysis: d.sentiment ?? prev.callRow?.sentimentAnalysis,
            call_status: d.callStatus ?? prev.callRow?.call_status,
          };
          return {
            ...prev,
            callRow: nextRow,
            summary:
              prev.summary ??
              (typeof d.callSummary === "string" ? d.callSummary.trim() || null : null),
            transcript:
              (typeof d.transcript === "string" && d.transcript) || prev.transcript || null,
            loading: false,
            polling: !done,
          };
        });

        if (done) window.clearInterval(timer);
      } catch {
        if (attempts >= maxAttempts) window.clearInterval(timer);
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [wbahCallDetailView?.callId, getWbahCallDetailFn]);

  // Call detail — summary from list payload; transcript + booking on demand.
  async function openWbahCallDetail(r: WbahPeopleRow) {
    const name = r.name || "Record";
    const callId = String(r.wbahCallId ?? r.id ?? "");
    const inlineSummary =
      (r.callSummary && String(r.callSummary).trim()) ||
      (r.call_summary && String(r.call_summary).trim()) ||
      null;

    setWbahCallDetailView({
      name,
      summary: inlineSummary,
      transcript: r.transcript ?? null,
      loading: !(r.transcript && String(r.transcript).trim()) && (!!callId || !!r.hasTranscript),
      callId: callId || undefined,
      callRow: { ...r, ...wbahCallDetailFromRow(r) },
      polling: false,
    });

    if (!callId || (r.transcript && String(r.transcript).trim())) return;

    try {
      const d = (await getWbahCallDetailFn({ data: { id: callId } })) as Record<string, unknown>;
      const postCall = (d.postCall as Record<string, unknown> | null) ?? null;
      setWbahCallDetailView((prev) =>
        prev
          ? {
              ...prev,
              summary:
                inlineSummary ??
                (typeof d.callSummary === "string" ? d.callSummary.trim() || null : null),
              transcript:
                (typeof d.transcript === "string" && d.transcript) || "No transcript available.",
              loading: false,
              callRow: {
                ...(prev.callRow ?? {}),
                ...d,
                sentimentAnalysis: d.sentiment,
                call_status: d.callStatus,
              },
              polling: isWbahCallAnalysisPending(
                extractWbahCallBookingFields({
                  ...(prev.callRow ?? {}),
                  ...d,
                  ...(postCall ?? {}),
                  sentimentAnalysis: d.sentiment,
                }),
              ),
            }
          : null,
      );
    } catch {
      setWbahCallDetailView((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              transcript: r.transcript ?? "Failed to load call details.",
            }
          : null,
      );
    }
  }

  async function handleFetchWbahCallsCount() {
    try {
      const res = await listWbahCallsCountFn();
      setWbahCallsCount(res?.count ?? 0);
    } catch {
      /* non-fatal — Calls badge just stays hidden until the tab is opened */
    }
  }

  // Load the People category list when the tab is opened (not on initial mount
  // while the user is still on Records — that fires before auth/workspace context
  // is ready and never re-runs when the user navigates to People).
  useEffect(() => {
    if (!isWbah || dataTab !== "people") return;

    setWbahSelected(new Set());

    if (wbahCallsData.length === 0 && wbahCallsCount === 0) {
      handleFetchWbahCallsCount();
    }
    if (wbahCategories.length === 0 && !wbahCatLoadingList) {
      setWbahCategories(WBAH_PEOPLE_TABS);
      setWbahPeopleSubTab((prev) => prev || WBAH_PEOPLE_TABS[0]?.name || "");
    }
    let countsTimer: ReturnType<typeof setTimeout> | undefined;
    if (!wbahCatCountsInFlightRef.current) {
      wbahCatCountsInFlightRef.current = true;
      // Defer badge counts so the active tab's rows load first.
      countsTimer = setTimeout(() => {
        handleFetchWbahCategoryList().finally(() => {
          wbahCatCountsInFlightRef.current = false;
        });
      }, 150);
    }

    return () => {
      if (countsTimer) clearTimeout(countsTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTab, isWbah]);

  // Load / refresh the active category sub-tab (server-side search + pagination).
  useEffect(() => {
    if (
      !isWbah ||
      dataTab !== "people" ||
      !wbahPeopleSubTab ||
      wbahPeopleSubTab === "calls" ||
      wbahPeopleSubTab === WBAH_CALLBACK_TAB
    )
      return;
    setWbahSelected(new Set());
    const t = setTimeout(() => {
      setWbahCatPage(1);
      handleFetchWbahCategory(wbahPeopleSubTab, 1);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dataTab,
    isWbah,
    wbahPeopleSubTab,
    wbahPeopleSearch,
    wbahSentimentFilter,
    wbahDateFilter,
    wbahAgentFilter,
  ]);

  // Calls tab: server-side paginated. Refetch page 1 (debounced) when the tab is
  // opened or when search/status/sentiment/date filters change. A live refresh
  // from WeeBespoke (throttled server-side) runs only on the initial open.
  useEffect(() => {
    if (!isWbah || dataTab !== "people" || wbahPeopleSubTab !== "calls") return;
    const firstOpen = wbahCallsData.length === 0 && wbahCallsTotal === 0;
    const t = setTimeout(
      () => {
        handleFetchWbahCallsPage(1, { refresh: firstOpen });
      },
      firstOpen ? 0 : 300,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dataTab,
    isWbah,
    wbahPeopleSubTab,
    wbahPeopleSearch,
    wbahStatusFilter,
    wbahSentimentFilter,
    wbahDateFilter,
    wbahAgentFilter,
  ]);

  async function handleImportCrmPeople(then?: "call") {
    const toImport = crmPeople.filter((p) => crmPeopleSelected.has(p.external_id));
    if (toImport.length === 0) return;
    setCrmImporting(true);
    try {
      const rows = toImport.map((p) => ({
        name: p.name || p.phone,
        mobile_number: p.phone,
        email: p.email || null,
        first_name: null,
        last_name: null,
        lead_external_id: p.external_id || null,
        meta: { source: p.source, crm_status: p.status },
      }));
      const valid = rows.filter((r) => r.mobile_number);
      if (valid.length === 0) throw new Error("No valid phone numbers to import");
      const result = await importFn({
        data: { rows: valid, agentId: crmImportAgentId || null },
      });
      const skipNote = result.skipped > 0 ? ` (${result.skipped} already existed)` : "";
      toast.success(
        `Imported ${result.inserted} lead${result.inserted !== 1 ? "s" : ""}${skipNote}`,
      );
      setCrmPeopleSelected(new Set());
      qc.invalidateQueries({ queryKey: ["data-records"] });
      qc.invalidateQueries({ queryKey: ["data-record-schema"] });
      if (then === "call") {
        const ids = result.ids ?? [];
        if (ids.length > 0) {
          setSelected(new Set(ids));
          setCrmCallDialogOpen(true);
        } else {
          toast.info("No records available to call — check the Records tab.");
        }
      }
    } catch (err) {
      toast.error("Import failed", { description: (err as Error).message });
    } finally {
      setCrmImporting(false);
    }
  }

  async function handleCrmStartCalls({
    agentId,
    fromNumber,
  }: {
    agentId: string;
    fromNumber: string | null;
  }) {
    await handleStartCalling(agentId, fromNumber);
    setCrmCallDialogOpen(false);
  }

  async function handleCrmScheduleCalls({
    agentId,
    fromNumber,
    scheduledAtIso,
  }: {
    agentId: string;
    fromNumber: string | null;
    scheduledAtIso: string;
  }) {
    await handleSchedule(scheduledAtIso, agentId);
    setCrmCallDialogOpen(false);
  }

  async function handleSaveSchedule(data: {
    enabled: boolean;
    days: number[];
    startHour: number;
    endHour: number;
    timezone: string;
    maxDailyAttempts: number;
  }) {
    try {
      await setScheduleFn({ data });
      toast.success("Call schedule updated");
      qc.invalidateQueries({ queryKey: ["call-schedule"] });
    } catch (err) {
      toast.error("Failed to save schedule", { description: (err as Error).message });
    }
  }

  return (
    <DashboardPage>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold tracking-tight">Data Records</h1>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {isWbah
              ? "Manage calling data, people, and campaigns"
              : "Pull inbound leads from your CRM and manage people"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isWbah && (
            <Button variant="outline" size="sm" onClick={() => setShowManualEntry(true)}>
              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              Add Record
            </Button>
          )}
          {/* CSV import is not WBAH-specific: importDataRecords is workspace-scoped
              and does its own batch + existing-number dedup, and the Records tab it
              fills has no WBAH-only rendering. It was only ever hidden because the
              whole button group was gated. Shown on the Records tab, which is where
              the imported rows land. */}
          {dataTab === "records" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!showCsvImport && agentFilter !== "all") {
                  setCsvImportAgentId(agentFilter);
                }
                setShowCsvImport(!showCsvImport);
              }}
            >
              <Database className="mr-1.5 h-3.5 w-3.5" />
              Import CSV
            </Button>
          )}
          {isWbah && (
            <Button variant="outline" size="sm" onClick={() => setCallScheduleOpen(true)}>
              <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
              Call Schedule
            </Button>
          )}
        </div>
      </div>

      {/* Tabs — Campaigns stays WBAH-only (call scheduling); People and Records
          are generic. Records was hidden outside WBAH, which left CSV-imported
          rows with nowhere to show. People stays first here because that is the
          default tab for a non-WBAH workspace. */}
      <div className="flex gap-1 overflow-x-auto border-b border-border dark:border-white/[0.06]">
        {(isWbah
          ? (["records", "people", "campaigns"] as const)
          : (["people", "records"] as const)
        ).map((t) => (
          <button
            key={t}
            onClick={() => setDataTab(t)}
            className={`px-2.5 py-1 text-[11px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              dataTab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "records" ? (
              <span className="flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5" /> Records
              </span>
            ) : t === "people" ? (
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> People
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Campaigns
              </span>
            )}
          </button>
        ))}
      </div>

      {dataTab === "campaigns" && <WbahCallSchedulingSection />}

      {dataTab === "records" && showCsvImport && (
        <Card className="mb-6">
          <CardContent className="pt-6 space-y-4">
            <div>
              <p className="mb-1 text-sm font-medium">Upload a CSV file</p>
              <p className="text-xs text-muted-foreground">
                Select a CSV file and you'll be guided to map its columns to system fields before
                importing.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Agent that will call through this data</Label>
              <p className="text-[11px] text-muted-foreground">
                Choose which agent will dial these records. The agent's Lead Gen script can then
                personalise each call using columns from this CSV.
              </p>
              <Select
                value={csvImportAgentId || "__none__"}
                onValueChange={(v) => setCsvImportAgentId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="h-8 max-w-sm text-xs">
                  <SelectValue placeholder="Select calling agent…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No agent — assign later</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleCsvFile}
                disabled={importing}
                className="max-w-sm"
              />
              {importing && <span className="text-sm text-muted-foreground">Importing…</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {dataTab === "records" && (
        <>
          {/* KPI strip — matches Leads page */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <KpiCard
              label="Total"
              value={stats.total}
              icon={Database}
              iconBg="bg-blue-500/15"
              iconColor="text-blue-400"
            />
            <KpiCard
              label="Need to Call"
              value={stats.needToCall}
              icon={PhoneOutgoing}
              iconBg="bg-amber-500/15"
              iconColor="text-amber-400"
            />
            <KpiCard
              label="Queued"
              value={stats.queued}
              icon={CalendarClock}
              iconBg="bg-violet-500/15"
              iconColor="text-violet-400"
            />
            <KpiCard
              label="Completed"
              value={stats.completed}
              icon={UserCheck}
              iconBg="bg-emerald-500/15"
              iconColor="text-emerald-400"
            />
          </div>

          {/* Table card — matches Leads page container */}
          <div className="min-w-0 overflow-hidden rounded-xl border border-border dark:border-white/[0.06] bg-card/60">
            {/* Toolbar row */}
            <div className="flex flex-col gap-1.5 border-b border-border dark:border-white/[0.06] px-2.5 py-1.5 sm:px-3 lg:flex-row lg:items-center lg:justify-between">
              <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Data Records
                {selected.size > 0 && (
                  <span className="ml-2 normal-case text-xs font-normal text-blue-400 tracking-normal">
                    {selected.size} selected
                  </span>
                )}
              </p>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {selected.size > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={() => setSelected(new Set())}
                    >
                      Clear
                    </Button>
                    <Select onValueChange={(v) => handleBulkAssign(v === "none" ? null : v)}>
                      <SelectTrigger className="h-7 w-[140px] text-xs">
                        <SelectValue placeholder="Assign agent…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassign</SelectItem>
                        {agents.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setScheduleOpen(true)}
                    >
                      <CalendarClock className="mr-1 h-3.5 w-3.5" />
                      Schedule
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setStartCallingOpen(true)}
                    >
                      <PhoneOutgoing className="mr-1 h-3.5 w-3.5" />
                      Start Calling
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setAutoDialOpen(true)}
                      title="Dials each record and connects answered calls to your people (one call per person at a time) — not the AI agent"
                    >
                      <PhoneForwarded className="mr-1 h-3.5 w-3.5" />
                      Auto Dial
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs text-rose-400 border-rose-400/30 hover:bg-rose-500/10"
                      onClick={handleDisqualify}
                    >
                      <X className="mr-1 h-3.5 w-3.5" />
                      Disqualify
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs text-rose-400 border-rose-400/30 hover:bg-rose-500/10"
                      onClick={() => handleDeleteRecords(Array.from(selected))}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </>
                )}
                {/* Filters */}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search name, phone…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-6 min-w-0 flex-1 basis-28 max-w-[180px] pl-7 text-[11px] sm:flex-none sm:w-36"
                  />
                </div>
                <Select value={callStatus} onValueChange={setCallStatus}>
                  <SelectTrigger className="h-7 w-[130px] text-xs">
                    <SelectValue placeholder="Call status" />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={agentFilter} onValueChange={setAgentFilter}>
                  <SelectTrigger className="h-7 w-[150px] text-xs">
                    <SelectValue placeholder="Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All agents</SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                        <span className="ml-1.5 text-[10px] text-muted-foreground">
                          ·{" "}
                          {agentTypeLabel(
                            (a.settings as { dashboardAgentType?: string } | null)?.dashboardAgentType,
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <Checkbox
                    checked={unassignedOnly}
                    onCheckedChange={(v) => {
                      setUnassignedOnly(v === true);
                      if (v) setAgentFilter("all");
                    }}
                  />
                  <span className="text-xs text-muted-foreground">Unassigned</span>
                </label>
              </div>
            </div>

            {/* Table body */}
            {recordsQ.isLoading ? (
              <LoadingProgress label="Loading records" estimatedMs={8000} />
            ) : records.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16">
                <Database className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No data records</p>
                <p className="text-xs text-muted-foreground">
                  Import a CSV to get started or adjust your filters.
                </p>
              </div>
            ) : (
              <>
                <DynamicDataTable
                  records={recordsPag.sliced}
                  agents={agents}
                  selected={selected}
                  allSelected={allSelected}
                  toggleAll={toggleAll}
                  toggleOne={toggleOne}
                  onReset={handleReset}
                  onDelete={(id: string) => handleDeleteRecords([id])}
                  onAddToLead={handleAddToLead}
                  addedLeadIds={addedLeadIds}
                  canGenerate={canUseAssistant}
                  onGenerate={(r) =>
                    setAssistantTarget({
                      id: r.id,
                      source: "record",
                      name: r.name ?? null,
                      company: r.client_name ?? null,
                    })
                  }
                />
                <TablePagBar {...recordsPag} />
              </>
            )}
          </div>
        </>
      )}

      {dataTab === "people" && isWbah && (
        <>
          {/* ── Call detail modal (summary + transcript) ───────────────── */}
          {wbahCallDetailView && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="w-full max-w-2xl rounded-xl border border-border dark:border-white/[0.08] bg-card flex flex-col max-h-[80vh]">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-border dark:border-white/[0.06]">
                  <p className="text-sm font-semibold">{wbahCallDetailView.name} — Call details</p>
                  <button
                    onClick={() => setWbahCallDetailView(null)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="overflow-y-auto px-5 py-4 space-y-4 flex-1">
                  <WbahCallBookingSection
                    callRow={wbahCallDetailView.callRow ?? null}
                    polling={wbahCallDetailView.polling}
                  />
                  {wbahCallDetailView.summary ? (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Call summary
                      </p>
                      <div className="rounded-lg border border-border dark:border-white/[0.06] bg-muted/20 dark:bg-white/[0.02] px-3 py-2.5">
                        <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                          {wbahCallDetailView.summary}
                        </p>
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Transcript
                    </p>
                    <div className="rounded-lg border border-border dark:border-white/[0.06] bg-muted/20 dark:bg-white/[0.02] px-3 py-2.5">
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                        {wbahCallDetailView.loading
                          ? "Loading transcript…"
                          : wbahCallDetailView.transcript || "No transcript available."}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <WbahLeadDetailModal detail={wbahLeadDetail} onClose={() => setWbahLeadDetail(null)} />

          {/* ── WBAH People KPI strip ───────────────────────────────────── */}
          {wbahPeopleTotal > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <KpiCard
                label="CRM Contacts"
                value={wbahPeopleTotal}
                icon={Users}
                iconBg="bg-blue-500/15"
                iconColor="text-blue-400"
              />
              <KpiCard
                label="Lead Categories"
                value={wbahCategories.length}
                icon={UserCheck}
                iconBg="bg-rose-500/15"
                iconColor="text-rose-400"
              />
            </div>
          )}

          {/* ── WBAH People toolbar ─────────────────────────────────────── */}
          <div className="min-w-0 overflow-hidden rounded-xl border border-border dark:border-white/[0.06] bg-card/60">
            {/* ── Lead-filter category sub-tabs (Dynamics CRM categories) ─ */}
            <div className="flex items-center gap-0 overflow-x-auto border-b border-border dark:border-white/[0.06] px-3 sm:px-4">
              {[
                ...(wbahCategories.length > 0 ? wbahCategories : WBAH_PEOPLE_TABS).map((c) => ({
                  id: c.name,
                  label: c.name,
                  count: Math.max(0, c.count),
                })),
                { id: "calls", label: "Calls", count: wbahCallsTotal || wbahCallsCount },
              ].map((tab) => {
                const isActive = wbahPeopleSubTab === tab.id;
                const isCatTab = tab.id !== "calls";
                const style = isCatTab ? wbahCatStyle(tab.id) : null;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setWbahPeopleSubTab(tab.id)}
                    className={`relative flex items-center gap-1.5 px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                      isActive
                        ? style
                          ? style.active
                          : "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {isCatTab && <AlertCircle className={`h-3 w-3 ${style?.icon ?? ""}`} />}
                    {tab.label}
                    {tab.id === "Test Lead" && <WbahTestLeadBadge className="ml-0.5" />}
                    {tab.count > 0 && (
                      <span
                        className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          style ? style.badge : "bg-muted/60 text-muted-foreground"
                        }`}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
              {wbahCatLoadingList && wbahCategories.length === 0 && (
                <span className="px-2 py-1 text-xs text-muted-foreground flex items-center gap-1.5">
                  <RefreshCw className="h-3 w-3 animate-spin" /> Loading categories…
                </span>
              )}
              {!wbahCatLoadingList && wbahCategories.length === 0 && wbahCatListError && (
                <button
                  onClick={() => handleFetchWbahCategoryList()}
                  className="px-2 py-1 text-xs text-destructive hover:text-destructive/80 flex items-center gap-1.5"
                  title={wbahCatListError}
                >
                  <AlertCircle className="h-3 w-3" /> Couldn't load categories — Retry
                </button>
              )}
            </div>

            {wbahPeopleSubTab === NEW_LEAD_STATUS && (
              <div className="border-b border-border dark:border-white/[0.06] px-2.5 py-1.5 sm:px-3">
                <WbahNewLeadSyncToggle
                  active={dataTab === "people" && wbahPeopleSubTab === NEW_LEAD_STATUS}
                  onStateChange={(s) => setWbahNewLeadSyncOn(s.enabled)}
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5 border-b border-border dark:border-white/[0.06] px-2.5 py-1.5 sm:px-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {wbahPeopleSubTab === "calls" ? "Calls" : wbahPeopleSubTab || "Leads"}
                  {wbahSelected.size > 0 && (
                    <span className="ml-2 normal-case text-xs font-normal text-blue-400 tracking-normal">
                      {wbahSelected.size} selected
                    </span>
                  )}
                </p>
                {/* Search — Callback tab has its own search in WbahCallbacksPanel */}
                {wbahAnyPeopleData && wbahPeopleSubTab !== WBAH_CALLBACK_TAB && (
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                    <input
                      value={wbahPeopleSearch}
                      onChange={(e) => setWbahPeopleSearch(e.target.value)}
                      placeholder="Search name, phone…"
                      className="h-6 min-w-0 w-full max-w-[160px] rounded-md border border-border dark:border-white/[0.08] bg-muted/40 pl-6 pr-2 text-[11px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 sm:w-36"
                    />
                    {wbahPeopleSearch && (
                      <button
                        onClick={() => setWbahPeopleSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
                {/* Filters — apply across People sub-tabs except Callback dashboard */}
                {isWbah && dataTab === "people" && wbahPeopleSubTab !== WBAH_CALLBACK_TAB && (
                  <>
                    <Select value={wbahStatusFilter} onValueChange={setWbahStatusFilter}>
                      <SelectTrigger className="h-7 w-[140px] text-xs">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="need_to_call">Need To Call</SelectItem>
                        <SelectItem value="not_connected">Not Connected</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="disqualified">Disqualified</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={wbahSentimentFilter} onValueChange={setWbahSentimentFilter}>
                      <SelectTrigger className="h-7 w-[130px] text-xs">
                        <SelectValue placeholder="Sentiment" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All sentiment</SelectItem>
                        <SelectItem value="positive">Positive</SelectItem>
                        <SelectItem value="neutral">Neutral</SelectItem>
                        <SelectItem value="negative">Negative</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={wbahDateFilter} onValueChange={setWbahDateFilter}>
                      <SelectTrigger className="h-7 w-[130px] text-xs">
                        <SelectValue placeholder="Date" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All time</SelectItem>
                        <SelectItem value="today">Today</SelectItem>
                        <SelectItem value="7d">Last 7 days</SelectItem>
                        <SelectItem value="30d">Last 30 days</SelectItem>
                        <SelectItem value="45d">Last 45 days</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={wbahAgentFilter} onValueChange={setWbahAgentFilter}>
                      <SelectTrigger className="h-7 w-[150px] text-xs">
                        <SelectValue placeholder="Agent" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All agents</SelectItem>
                        {wbahAgentOptions.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {(wbahStatusFilter !== "all" ||
                      wbahSentimentFilter !== "all" ||
                      wbahDateFilter !== "all" ||
                      wbahAgentFilter !== "all") && (
                      <button
                        onClick={() => {
                          setWbahStatusFilter("all");
                          setWbahSentimentFilter("all");
                          setWbahDateFilter("all");
                          setWbahAgentFilter("all");
                        }}
                        className="text-[11px] text-muted-foreground hover:text-foreground underline whitespace-nowrap"
                      >
                        Clear filters
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {wbahSelected.size > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => setWbahSelected(new Set())}
                  >
                    Clear
                  </Button>
                )}

                {/* Refresh / Load button — varies per sub-tab */}
                {wbahPeopleSubTab &&
                  wbahPeopleSubTab !== "calls" &&
                  wbahPeopleSubTab !== WBAH_CALLBACK_TAB &&
                  (() => {
                    const cat = wbahPeopleSubTab;
                    const loading = !!wbahCatLoadingMap[cat];
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleFetchWbahCategory(cat)}
                        disabled={loading}
                      >
                        <RefreshCw
                          className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                        />
                        Refresh
                      </Button>
                    );
                  })()}
                {wbahPeopleSubTab === "calls" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleFetchWbahCallsPage(1, { refresh: true })}
                    disabled={wbahCallsLoading}
                  >
                    <RefreshCw
                      className={`mr-1.5 h-3.5 w-3.5 ${wbahCallsLoading ? "animate-spin" : ""}`}
                    />
                    Refresh
                  </Button>
                )}
              </div>
            </div>

            {/* ── Table body ─────────────────────────────────────────────── */}
            {wbahPeopleSubTab === WBAH_CALLBACK_TAB ? (
              <WbahCallbacksPanel onSummaryChange={handleCallbackSummaryChange} />
            ) : (
              (() => {
                const isLeads = false;
                const isCalls = wbahPeopleSubTab === "calls";
                const isCat = !isCalls && !!wbahPeopleSubTab;
                const isNewTab = wbahPeopleSubTab === NEW_LEAD_STATUS;
                const isDisqualifiedTab = wbahPeopleSubTab === "Disqualified";

                const loading = isCalls ? wbahCallsLoading : !!wbahCatLoadingMap[wbahPeopleSubTab];
                const error = isCalls
                  ? wbahCallsError
                  : (wbahCatErrorMap[wbahPeopleSubTab] ?? null);
                const knownTotal = isCalls ? wbahCallsTotal : isCat ? wbahActiveCatCount : 0;
                const rowCount = isCalls ? wbahCallsData.length : wbahActiveCatRows.length;
                const empty = rowCount === 0 && !(knownTotal > 0 && loading);
                const showLoading = loading || (rowCount === 0 && knownTotal > 0 && !error);
                const onLoad = isCalls
                  ? () => handleFetchWbahCallsPage(1, { refresh: true })
                  : () => handleFetchWbahCategory(wbahPeopleSubTab);
                const loadLabel = isCalls ? "Load Calls" : `Load ${wbahPeopleSubTab || "data"}`;
                const rows = isCalls ? wbahCallsRows : wbahCatFiltered;
                const pag = isCalls ? wbahCallsPag : isCat ? wbahCatServerPag : wbahCatPag;
                const loadingNoun = isCalls ? "calls" : `${wbahPeopleSubTab || "records"} records`;

                if (showLoading)
                  return (
                    <LoadingProgress
                      label={`Loading ${loadingNoun}`}
                      estimatedMs={9000}
                      className="py-20"
                    />
                  );
                if (error) {
                  const testLeadDisabled =
                    wbahPeopleSubTab === TEST_LEAD_STATUS && isTestLeadSyncDisabledError(error);
                  if (testLeadDisabled) {
                    return (
                      <div className="flex flex-col items-center gap-2 py-16 px-6 text-center text-sm">
                        <AlertCircle className="h-8 w-8 text-amber-400/80" />
                        <p className="font-medium text-foreground">Test Lead sync is not enabled</p>
                        <p className="max-w-md text-xs text-muted-foreground">
                          Set{" "}
                          <code className="rounded bg-muted px-1">
                            ENABLE_TEST_LEAD_CATEGORY_SYNC=true
                          </code>{" "}
                          on UAT, then run <strong>Sync from Dynamics</strong> in Campaigns.
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-col items-center gap-2 py-16 text-sm">
                      <AlertCircle className="h-8 w-8 text-destructive/60" />
                      <p className="font-medium text-destructive">Could not load data</p>
                      <p className="max-w-sm text-center text-xs text-muted-foreground">{error}</p>
                      <Button variant="outline" size="sm" className="mt-2" onClick={onLoad}>
                        Try again
                      </Button>
                    </div>
                  );
                }
                if (empty) {
                  if (wbahPeopleSubTab === TEST_LEAD_STATUS) {
                    return (
                      <div className="flex flex-col items-center gap-2 py-16 px-6 text-center">
                        <Users className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm font-medium">No test leads in CRM yet</p>
                        <p className="max-w-md text-xs text-muted-foreground">
                          Run <strong>Data → Campaigns → Sync from Dynamics</strong> after UAT has{" "}
                          <code className="rounded bg-muted px-1">
                            ENABLE_TEST_LEAD_CATEGORY_SYNC=true
                          </code>
                          . Preview should show <strong>test_lead</strong> with dynamicsFetched &gt;
                          0.
                        </p>
                        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                          <Button variant="outline" size="sm" onClick={onLoad}>
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh Test Lead
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setDataTab("campaigns")}
                          >
                            Open Campaigns sync
                          </Button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-col items-center gap-2 py-16">
                      <Users className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm font-medium">No data loaded yet</p>
                      <p className="text-xs text-muted-foreground">
                        Click <strong>{loadLabel}</strong> to fetch records.
                      </p>
                      <Button variant="outline" size="sm" className="mt-2" onClick={onLoad}>
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {loadLabel}
                      </Button>
                    </div>
                  );
                }

                return (
                  <div className="min-w-0 overflow-x-auto">
                    {isNewTab && (
                      <div
                        className={cn(
                          "mx-3 mt-3 rounded-lg border px-3 py-2 text-[11px]",
                          wbahCatStyle(NEW_LEAD_STATUS).banner,
                        )}
                      >
                        {wbahNewLeadSyncOn === false ? (
                          <>
                            Auto-dial is <strong>off</strong> — existing New rows stay visible; no
                            new imports or dials until you turn it on.
                          </>
                        ) : (
                          <>
                            Inbound <strong>New</strong> leads auto-dial via cron (WBAH New Leads
                            Agent, +441616968308). After a call: <strong>Logged</strong> if booked
                            (positive + appointment), <strong>Disqualified</strong> if negative
                            sentiment, <strong>Tried To Contact</strong> if positive without
                            booking, or no status change for neutral/no-answer.
                          </>
                        )}
                      </div>
                    )}
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-border dark:border-white/[0.06] bg-card/30">
                          {isLeads && (
                            <th className={cn("w-8 px-2 py-1", stickyHead, "left-0")}>
                              <Checkbox
                                checked={
                                  rows.length > 0 && rows.every((r) => wbahSelected.has(r.id))
                                }
                                onCheckedChange={(v) => {
                                  if (v)
                                    setWbahSelected(
                                      (prev) => new Set([...prev, ...rows.map((r) => r.id)]),
                                    );
                                  else
                                    setWbahSelected((prev) => {
                                      const n = new Set(prev);
                                      rows.forEach((r) => n.delete(r.id));
                                      return n;
                                    });
                                }}
                              />
                            </th>
                          )}
                          {(
                            [
                              "SR NO",
                              "NAME",
                              ...(isNewTab ? ["CALL ON"] : []),
                              "CONTACT",
                              ...(isCat ? ["LOADED"] : []),
                              ...(isNewTab ? ["LEAD STATUS"] : ["TYPE"]),
                              "LAST CALLED AT",
                              "CALL STATUS",
                              ...(isDisqualifiedTab ? ["DQ REASON", "DISQUALIFIED AT"] : []),
                              "DURATION",
                              "RECORDING",
                              "TRANSCRIPT",
                              "SENTIMENT",
                              "APPT DATE",
                              "APPT TIME",
                              "BOOKING STATUS",
                              "CALENDLY",
                              "END REASON",
                              "DISCONNECTION",
                            ] as string[]
                          ).map((col) => (
                            <th
                              key={col}
                              className={cn(
                                "px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap",
                                col === "SR NO" &&
                                  cn(stickyHead, isLeads ? "left-8 w-9" : "left-0 w-9"),
                                col === "NAME" &&
                                  cn(stickyHead, isLeads ? "left-[4.25rem] w-24" : "left-9 w-24"),
                                col === "CONTACT" &&
                                  cn(
                                    stickyHead,
                                    isLeads
                                      ? "left-[10.25rem] w-28 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.45)]"
                                      : "left-[8.25rem] w-28 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.45)]",
                                  ),
                              )}
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pag.sliced.map((r, rowIdx: number) => {
                          const statusBadge = wbahCallStatusBadge(r.callStatus);
                          const sentBadge = wbahSentimentBadge(resolveWbahDisplaySentiment(r));
                          const isSelected = wbahSelected.has(r.id);
                          const rowSrNo = (pag.page - 1) * Number(pag.pageSize) + rowIdx + 1;
                          return (
                            <tr
                              key={r.id}
                              className={`group h-8 border-b border-border dark:border-white/[0.04] align-middle hover:bg-muted/30 dark:hover:bg-white/[0.02] transition-colors ${isSelected ? "bg-blue-500/5" : ""}`}
                            >
                              {isLeads && (
                                <td className={cn("px-2 py-0.5", stickyCell, "left-0 w-8")}>
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => {
                                      const n = new Set(wbahSelected);
                                      if (n.has(r.id)) n.delete(r.id);
                                      else n.add(r.id);
                                      setWbahSelected(n);
                                    }}
                                  />
                                </td>
                              )}
                              <td
                                className={cn(
                                  "px-2 py-0.5 text-[10px] text-muted-foreground",
                                  stickyCell,
                                  isLeads ? "left-8 w-9" : "left-0 w-9",
                                )}
                              >
                                {rowSrNo}
                              </td>
                              <td
                                className={cn(
                                  "max-w-[6rem] truncate px-2 py-0.5 font-medium",
                                  stickyCell,
                                  isLeads ? "left-[4.25rem] w-24" : "left-9 w-24",
                                )}
                              >
                                <div className="flex items-center gap-1 min-w-0">
                                  <button
                                    type="button"
                                    onClick={() => openWbahLeadDetail(r)}
                                    className="truncate text-left hover:text-primary transition-colors"
                                    title="View lead details"
                                  >
                                    {r.name || "—"}
                                  </button>
                                  {r.isTestLead && <WbahTestLeadBadge />}
                                  <button
                                    type="button"
                                    onClick={() => openWbahLeadDetail(r)}
                                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 dark:hover:bg-white/[0.06] transition-colors"
                                    title="View lead details"
                                  >
                                    <Eye className="h-3 w-3" />
                                  </button>
                                </div>
                              </td>
                              {isNewTab && (
                                <td className="px-2 py-0.5 whitespace-nowrap">
                                  {String(r.syncCategorySlug ?? "").toLowerCase() ===
                                  NEW_LEAD_SYNC_SUB_SLUGS.delayed ? (
                                    <button
                                      type="button"
                                      disabled={callingDelayedLeadId === r.id}
                                      onClick={async () => {
                                        if (!r.contact) {
                                          toast.error("No phone number for this lead");
                                          return;
                                        }
                                        setCallingDelayedLeadId(r.id);
                                        try {
                                          const res = await callWbahDelayedLeadFn({
                                            data: {
                                              phone: r.contact,
                                              name: r.name ?? undefined,
                                              externalLeadId: r.id ?? undefined,
                                            },
                                          });
                                          if (res.placed) {
                                            toast.success(`Calling ${r.name || r.contact}…`);
                                          } else {
                                            const msgs: Record<string, string> = {
                                              daily_limit_reached:
                                                "Daily call limit reached for this number (3/day)",
                                              agent_not_configured:
                                                "New Leads Agent is not configured",
                                              agent_not_fully_configured:
                                                "New Leads Agent has no phone number set",
                                              agent_not_found: "New Leads Agent not found",
                                            };
                                            toast.error(
                                              msgs[res.reason ?? ""] ??
                                                `Could not place call: ${res.reason}`,
                                            );
                                          }
                                        } catch (e) {
                                          toast.error(e instanceof Error ? e.message : "Failed to place call");
                                        } finally {
                                          setCallingDelayedLeadId(null);
                                        }
                                      }}
                                      className="inline-flex items-center gap-1 rounded border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                      title="Place a call now via New Leads Agent"
                                    >
                                      <PhoneOutgoing className="h-2.5 w-2.5 shrink-0" />
                                      {callingDelayedLeadId === r.id ? "Calling…" : "Call now"}
                                    </button>
                                  ) : (
                                    <WbahNewLeadSubBadge slug={r.syncCategorySlug} />
                                  )}
                                </td>
                              )}
                              <td
                                className={cn(
                                  "max-w-[7rem] truncate px-2 py-0.5 font-mono text-[10px] text-muted-foreground",
                                  stickyCell,
                                  isLeads
                                    ? "left-[10.25rem] w-28 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.35)]"
                                    : "left-[8.25rem] w-28 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.35)]",
                                )}
                              >
                                {r.contact ? (
                                  <a
                                    href={`tel:${r.contact}`}
                                    className="flex items-center gap-1 hover:text-foreground transition-colors truncate"
                                  >
                                    <Phone className="h-3 w-3 shrink-0" />
                                    {r.contact}
                                  </a>
                                ) : (
                                  "—"
                                )}
                              </td>
                              {isCat && (
                                <td className="px-2 py-0.5 text-[10px] text-muted-foreground whitespace-nowrap">
                                  {r.loadedAt ? fmtDate(r.loadedAt, true) : "—"}
                                </td>
                              )}
                              <td className="px-2 py-0.5 text-[10px] text-muted-foreground whitespace-nowrap capitalize">
                                {isNewTab
                                  ? r.leadStatus || "—"
                                  : (r.callType || "—").replace(/_/g, " ")}
                              </td>
                              <td className="px-2 py-0.5 text-[10px] text-muted-foreground whitespace-nowrap">
                                {fmtTs(r.startTimestamp, true)}
                              </td>
                              <td className="px-2 py-0.5 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-border dark:ring-white/[0.06] ${statusBadge.cls}`}
                                >
                                  {statusBadge.label}
                                </span>
                              </td>
                              {isDisqualifiedTab && (
                                <>
                                  <td
                                    className="px-2 py-0.5 text-[10px] text-muted-foreground max-w-[140px] truncate"
                                    title={r.dqReasonFull ?? r.dqReason ?? undefined}
                                  >
                                    {r.dqReason && r.dqReason !== "—"
                                      ? truncateDqReason(r.dqReasonFull ?? r.dqReason, 40)
                                      : "—"}
                                  </td>
                                  <td className="px-2 py-0.5 text-[10px] text-muted-foreground whitespace-nowrap">
                                    {r.disqualifiedAt ? fmtDate(r.disqualifiedAt, true) : "—"}
                                  </td>
                                </>
                              )}
                              <td className="px-2 py-0.5 text-muted-foreground text-[11px] whitespace-nowrap">
                                {fmtMs(r.durationMs)}
                              </td>
                              <td className="px-2 py-0.5">
                                {r.recordingUrl ? (
                                  <a
                                    href={r.recordingUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors"
                                  >
                                    <Play className="h-3 w-3" /> Play
                                  </a>
                                ) : (
                                  <span className="text-muted-foreground/40 text-[11px]">—</span>
                                )}
                              </td>
                              <td className="px-2 py-0.5">
                                {r.transcript ||
                                r.hasTranscript ||
                                r.callSummary ||
                                (isCalls && String(r.id ?? "").startsWith("call_")) ? (
                                  <button
                                    onClick={() => openWbahCallDetail(r)}
                                    className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                  >
                                    <FileText className="h-3 w-3" /> View
                                  </button>
                                ) : (
                                  <span className="text-muted-foreground/40 text-[11px]">—</span>
                                )}
                              </td>
                              <td
                                className={`px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${sentBadge.cls}`}
                              >
                                {sentBadge.label}
                              </td>
                              <td className="px-2 py-0.5 text-muted-foreground text-[11px] whitespace-nowrap">
                                {wbahAppointmentDateCell(r)}
                              </td>
                              <td className="px-2 py-0.5 text-muted-foreground text-[11px] whitespace-nowrap">
                                {wbahAppointmentTimeCell(r)}
                              </td>
                              <td className="px-2 py-0.5">
                                {(() => {
                                  const statusText = wbahBookingStatusCell(r);
                                  if (statusText === "—") {
                                    return (
                                      <span className="text-muted-foreground/40 text-[11px]">
                                        —
                                      </span>
                                    );
                                  }
                                  return (
                                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border dark:ring-white/[0.06] capitalize">
                                      {statusText}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
                                <WbahCallCalendlyLink row={r} />
                              </td>
                              <td className="px-2 py-0.5 text-muted-foreground text-[11px] whitespace-nowrap capitalize max-w-[120px] truncate">
                                {r.endReason ? r.endReason.replace(/_/g, " ") : "—"}
                              </td>
                              <td className="px-2 py-0.5 text-muted-foreground text-[11px] whitespace-nowrap capitalize max-w-[140px] truncate">
                                {r.disconnectionReason
                                  ? r.disconnectionReason.replace(/_/g, " ")
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {rows.length > 0 && <TablePagBar {...pag} />}
                    {rows.length === 0 && (
                      <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
                        <Search className="h-6 w-6" />
                        <p>No records match your search</p>
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        </>
      )}

      {dataTab === "people" && isWbah && (
        <div className="rounded-xl border border-border dark:border-white/[0.06] bg-card/60 px-3 py-2 text-xs text-muted-foreground">
          Custom People Views are not enabled for this workspace yet.
        </div>
      )}

      {dataTab === "people" && !isWbah && <CustomViewsSection />}

      {dataTab === "people" && !isWbah && (
        <div className="min-w-0 overflow-hidden rounded-xl border border-border dark:border-white/[0.06] bg-card/60">
          {/* People toolbar */}
          <div className="flex flex-col gap-1.5 border-b border-border dark:border-white/[0.06] px-2.5 py-1.5 sm:px-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Inbound Leads from CRM
                {crmPeople.length > 0 && (
                  <span className="ml-2 normal-case text-xs font-normal tracking-normal text-muted-foreground">
                    {crmHasFilters
                      ? `${crmFiltered.length} of ${crmPeople.length}`
                      : `${crmPeople.length} lead${crmPeople.length !== 1 ? "s" : ""}`}
                  </span>
                )}
                {crmPeopleSelected.size > 0 && (
                  <span className="ml-2 normal-case text-xs font-normal text-blue-400 tracking-normal">
                    {crmPeopleSelected.size} selected
                  </span>
                )}
              </p>
              {crmPeople.length > 0 && (
                <>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                    <input
                      value={crmSearch}
                      onChange={(e) => setCrmSearch(e.target.value)}
                      placeholder="Search name, phone…"
                      className="h-6 min-w-0 w-full max-w-[160px] rounded-md border border-border dark:border-white/[0.08] bg-muted/40 pl-6 pr-2 text-[11px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 sm:w-36"
                    />
                    {crmSearch && (
                      <button
                        onClick={() => setCrmSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {crmStatusOptions.length > 0 && (
                    <Select value={crmStatusFilter} onValueChange={setCrmStatusFilter}>
                      <SelectTrigger className="h-7 w-[140px] text-xs">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        {crmStatusOptions.map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">
                            {s.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Select value={crmDateFilter} onValueChange={setCrmDateFilter}>
                    <SelectTrigger className="h-7 w-[130px] text-xs">
                      <SelectValue placeholder="Date" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All time</SelectItem>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="7d">Last 7 days</SelectItem>
                      <SelectItem value="30d">Last 30 days</SelectItem>
                    </SelectContent>
                  </Select>
                  {crmHasFilters && (
                    <button
                      onClick={() => {
                        setCrmSearch("");
                        setCrmStatusFilter("all");
                        setCrmDateFilter("all");
                      }}
                      className="text-[11px] text-muted-foreground hover:text-foreground underline whitespace-nowrap"
                    >
                      Clear filters
                    </button>
                  )}
                </>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {crmPeopleSelected.size > 0 && (
                <>
                  <Select
                    value={crmImportAgentId || "__none__"}
                    onValueChange={(v) => setCrmImportAgentId(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className="h-7 w-[150px] text-xs">
                      <SelectValue placeholder="Assign agent…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No agent</SelectItem>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => handleImportCrmPeople()}
                    disabled={crmImporting}
                  >
                    {crmImporting ? (
                      <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="mr-1 h-3.5 w-3.5" />
                    )}
                    Import Selected
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleImportCrmPeople("call")}
                    disabled={crmImporting}
                  >
                    <PhoneOutgoing className="mr-1 h-3.5 w-3.5" />
                    Import &amp; Call
                  </Button>
                </>
              )}
              {crmFiltered.length > 0 && crmPeopleSelected.size === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() =>
                    setCrmPeopleSelected(new Set(crmFiltered.map((p) => p.external_id)))
                  }
                >
                  Select All
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleFetchCrmPeople}
                disabled={crmPeopleLoading}
              >
                <RefreshCw
                  className={`mr-1.5 h-3.5 w-3.5 ${crmPeopleLoading ? "animate-spin" : ""}`}
                />
                {crmPeople.length > 0 ? "Refresh" : "Pull from CRM"}
              </Button>
            </div>
          </div>

          {/* People table body */}
          {crmPeopleLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" /> Fetching inbound leads from CRM…
            </div>
          ) : crmPeopleError ? (
            <div className="flex flex-col items-center gap-2 py-16 text-sm">
              <AlertCircle className="h-8 w-8 text-destructive/60" />
              <p className="font-medium text-destructive">Could not connect to CRM</p>
              <p className="max-w-sm text-center text-xs text-muted-foreground">{crmPeopleError}</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={handleFetchCrmPeople}>
                Try again
              </Button>
            </div>
          ) : crmPeople.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16">
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No leads loaded yet</p>
              <p className="text-xs text-muted-foreground">
                Click <strong>Pull from CRM</strong> to fetch inbound leads from your connected CRM.
              </p>
              <Button variant="outline" size="sm" className="mt-2" onClick={handleFetchCrmPeople}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Pull from CRM
              </Button>
            </div>
          ) : crmFiltered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16">
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No leads match your filters</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setCrmSearch("");
                  setCrmStatusFilter("all");
                  setCrmDateFilter("all");
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border dark:border-white/[0.06] bg-card/30">
                    <th className="w-8 px-2 py-1">
                      <Checkbox
                        checked={
                          crmPeople.length > 0 && crmPeopleSelected.size === crmPeople.length
                        }
                        onCheckedChange={(v) => {
                          if (v)
                            setCrmPeopleSelected(new Set(crmFiltered.map((p) => p.external_id)));
                          else setCrmPeopleSelected(new Set());
                        }}
                      />
                    </th>
                    <th className="px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Name
                    </th>
                    <th className="px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Phone
                    </th>
                    <th className="px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Email
                    </th>
                    <th className="px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Source
                    </th>
                    <th className="px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      CRM Status
                    </th>
                    <th className="px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Received
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {crmPag.sliced.map((p) => (
                    <tr
                      key={p.external_id}
                      className={`group h-9 border-b border-border dark:border-white/4 align-middle hover:bg-muted/30 dark:hover:bg-white/[0.02] transition-colors ${crmPeopleSelected.has(p.external_id) ? "bg-blue-500/5" : ""}`}
                    >
                      <td className="px-2 py-0.5">
                        <Checkbox
                          checked={crmPeopleSelected.has(p.external_id)}
                          onCheckedChange={() => {
                            const next = new Set(crmPeopleSelected);
                            if (next.has(p.external_id)) next.delete(p.external_id);
                            else next.add(p.external_id);
                            setCrmPeopleSelected(next);
                          }}
                        />
                      </td>
                      <td className="px-2.5 py-1 text-xs font-medium whitespace-nowrap">
                        {p.name || "—"}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1 text-muted-foreground text-[11px] font-mono">
                        {p.phone || "—"}
                      </td>
                      <td className="px-2.5 py-1 text-muted-foreground text-[11px]">
                        {p.email || "—"}
                      </td>
                      <td className="px-2.5 py-1 text-muted-foreground text-[11px]">
                        {p.source || "—"}
                      </td>
                      <td className="px-2.5 py-1">
                        {p.status ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground ring-1 ring-border dark:ring-white/[0.06]">
                            {p.status.replace(/_/g, " ")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-0.5 text-muted-foreground text-[11px]">
                        {p.created_at ? fmtDate(p.created_at) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagBar {...crmPag} />
            </div>
          )}
        </div>
      )}

      <LeadAiAssistantPanel
        target={assistantTarget}
        onOpenChange={(o) => !o && setAssistantTarget(null)}
      />

      <ManualEntryDialog
        open={showManualEntry}
        onOpenChange={setShowManualEntry}
        agents={agents}
        defaultAgentId={agentFilter !== "all" ? agentFilter : ""}
        onSave={async (row, agentId) => {
          try {
            await importFn({ data: { rows: [row], agentId: agentId || null } });
            toast.success("Record added");
            qc.invalidateQueries({ queryKey: ["data-records"] });
            qc.invalidateQueries({ queryKey: ["data-record-schema"] });
          } catch (err) {
            toast.error("Failed to add record", { description: (err as Error).message });
            throw err;
          }
        }}
      />

      <CsvMappingDialog
        open={showCsvMapping}
        onOpenChange={setShowCsvMapping}
        headers={csvHeaders}
        rows={csvRows}
        importing={importing}
        onImport={handleImportMapped}
      />

      <StartCallingDialog
        open={startCallingOpen}
        onOpenChange={setStartCallingOpen}
        recordCount={selected.size}
        agents={agents}
        defaultAgentId={agentFilter !== "all" ? agentFilter : ""}
        onStart={handleStartCalling}
      />

      <AutoDialSetupDialog
        open={autoDialOpen}
        onOpenChange={setAutoDialOpen}
        recordCount={selected.size}
        defaultRouteNumbers={dialerDefaultRouteNumbers}
        onStart={handleAutoDial}
      />

      <ScheduleCallsDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        recordCount={selected.size}
        agents={agents}
        onSchedule={handleSchedule}
      />

      <StartCallsDialog
        open={crmCallDialogOpen}
        onOpenChange={setCrmCallDialogOpen}
        count={selected.size}
        entityLabel="contact"
        title="Call Imported Contacts"
        agents={crmCallAgents}
        defaultAgentId={crmImportAgentId}
        noAgentsMessage="No calling agents found. Build and go-live with an agent in the Builder first."
        onStart={handleCrmStartCalls}
        onSchedule={handleCrmScheduleCalls}
      />

      <CallScheduleDialog
        open={callScheduleOpen}
        onOpenChange={setCallScheduleOpen}
        scheduleData={scheduleQ.data ?? null}
        onSave={handleSaveSchedule}
      />
    </DashboardPage>
  );
}
