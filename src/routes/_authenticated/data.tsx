import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef } from "react";
import { Database, PhoneOutgoing, CalendarClock, UserCheck, Search, X, UserPlus, RotateCcw, BarChart3, Users, RefreshCw, Download, AlertCircle, Phone, Play, FileText, ExternalLink } from "lucide-react";
import { WbahCallSchedulingSection } from "@/components/dashboard/WbahCallSchedulingSection";
import { KpiCard } from "@/components/dashboard/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useTablePagination, TablePagBar } from "@/components/ui/table-pagination";
import { toast } from "sonner";
import {
  listDataRecords,
  importDataRecords,
  assignAgentToRecords,
  scheduleCallsForRecords,
  startCallingRecords,
  resetDataRecord,
  fetchCrmPeople,
  fetchQualifiedLeads,
  setRecordCallStatus,
  type CrmPersonRow,
  type QualifiedLeadRow,
} from "@/lib/dashboard/data-records.functions";
import { getCallSchedule, setCallSchedule } from "@/lib/dashboard/call-schedule.functions";
import { listLiveAgents } from "@/lib/agents/agents.functions";
import {
  listWbahAllCallData,
  triggerWbahCategorySync,
  listWbahCategorizedLeads,
  getWbahCategorySyncLog,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/data")({
  head: () => ({ meta: [{ title: "Data Records — Webee" }] }),
  component: DataPage,
});

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CALL_STATUSES = [
  { value: "all", label: "All statuses" },
  { value: "needs_to_call", label: "Needs to call" },
  { value: "queued", label: "Queued" },
  { value: "calling", label: "Calling" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "do_not_call", label: "Do not call" },
  { value: "disqualified", label: "Disqualified" },
] as const;

const SYSTEM_FIELDS: Array<{ value: string; label: string; required?: boolean; custom?: boolean }> = [
  { value: "name", label: "Name", required: true },
  { value: "mobile_number", label: "Mobile Number", required: true },
  { value: "first_name", label: "First Name" },
  { value: "last_name", label: "Last Name" },
  { value: "email", label: "Email" },
  { value: "title", label: "Title" },
  { value: "client_name", label: "Client Name" },
  { value: "unique_id", label: "Unique ID" },
  { value: "lead_external_id", label: "Lead External ID" },
  { value: "property_type", label: "Property Type" },
  { value: "bedrooms", label: "Bedrooms" },
  { value: "address_line1", label: "Address Line 1" },
  { value: "address_line2", label: "Address Line 2" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
  { value: "postal_code", label: "Postal Code" },
  { value: "notes", label: "Notes" },
  { value: "__custom__", label: "Custom field (stored in meta)", custom: true },
];

function normaliseKey(s: string) {
  return s.toLowerCase().replace(/[\s_\-().]/g, "");
}

/** Convert a CSV column header to a snake_case meta key */
function toMetaKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-().\/]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

const FIELD_ALIASES: Record<string, string> = {
  name: "name",
  fullname: "name",
  mobilenumber: "mobile_number",
  phone: "mobile_number",
  phonenumber: "mobile_number",
  mobile: "mobile_number",
  cellphone: "mobile_number",
  cell: "mobile_number",
  contactnumber: "mobile_number",
  firstname: "first_name",
  givenname: "first_name",
  lastname: "last_name",
  surname: "last_name",
  familyname: "last_name",
  email: "email",
  emailaddress: "email",
  title: "title",
  jobtitle: "title",
  clientname: "client_name",
  company: "client_name",
  organisation: "client_name",
  organization: "client_name",
  uniqueid: "unique_id",
  externalid: "unique_id",
  ref: "unique_id",
  propertytype: "property_type",
  type: "property_type",
  bedrooms: "bedrooms",
  beds: "bedrooms",
  addressline1: "address_line1",
  address1: "address_line1",
  streetaddress: "address_line1",
  address: "address_line1",
  addressline2: "address_line2",
  address2: "address_line2",
  city: "city",
  town: "city",
  suburb: "city",
  state: "state",
  county: "state",
  region: "state",
  postalcode: "postal_code",
  postcode: "postal_code",
  zip: "postal_code",
  zipcode: "postal_code",
  leadexternalid: "lead_external_id",
  leadid: "lead_external_id",
  notes: "notes",
  note: "notes",
  comments: "notes",
  description: "notes",
  remarks: "notes",
};

function autoDetectMapping(headers: string[]): Record<string, string> {
  const used = new Set<string>();
  const mapping: Record<string, string> = {};
  for (const h of headers) {
    const norm = normaliseKey(h);
    const sysField = FIELD_ALIASES[norm] ?? "";
    if (sysField && !used.has(sysField)) {
      mapping[h] = sysField;
      used.add(sysField);
    } else {
      mapping[h] = "";
    }
  }
  return mapping;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function fmtDate(iso?: string | null) {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusBadgeClass(status?: string | null) {
  const map: Record<string, string> = {
    needs_to_call: "bg-muted text-muted-foreground",
    queued: "bg-primary/15 text-primary",
    calling: "bg-amber-500/15 text-amber-400",
    completed: "bg-emerald-500/15 text-emerald-400",
    failed: "bg-destructive/15 text-destructive",
    do_not_call: "bg-muted/60 text-muted-foreground line-through",
    disqualified: "bg-rose-500/15 text-rose-400 line-through",
  };
  return map[status ?? ""] ?? "bg-muted text-muted-foreground";
}

function fmtTs(ts: number | null | undefined): string {
  if (!ts) return "N/A";
  const d = new Date(ts);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return `${time} · ${date}`;
}

function fmtMs(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "N/A";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function wbahCallStatusBadge(status: string | null | undefined): { label: string; cls: string } {
  const s = (status ?? "").toLowerCase();
  if (s === "need_to_call" || s === "need to call") return { label: "Need To Call", cls: "bg-amber-500/15 text-amber-400" };
  if (s === "not_connected" || s === "no_answer" || s === "not connected") return { label: "Not Connected", cls: "bg-orange-500/15 text-orange-400" };
  if (s === "call_analyzed" || s === "completed" || s === "ended") return { label: "Completed", cls: "bg-emerald-500/15 text-emerald-400" };
  if (s === "disqualified" || s === "rejected" || s === "not_interested") return { label: "Disqualified", cls: "bg-rose-500/15 text-rose-400" };
  if (!s) return { label: "N/A", cls: "bg-muted text-muted-foreground" };
  const label = s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return { label, cls: "bg-muted text-muted-foreground" };
}

function wbahSentimentBadge(sentiment: string | null | undefined): { label: string; cls: string } {
  const s = (sentiment ?? "").toLowerCase();
  if (s.includes("positive")) return { label: "Positive", cls: "text-emerald-400" };
  if (s.includes("neutral"))  return { label: "Neutral",  cls: "text-amber-400" };
  if (s.includes("negative")) return { label: "Negative", cls: "text-rose-400" };
  return { label: sentiment ? sentiment : "N/A", cls: "text-muted-foreground" };
}

const WBAH_DISQUALIFIED_STATUSES = new Set([
  "disqualified", "disqualified_sweep", "disqualifed", "disqualifed_sweep",
  "rejected", "not_interested", "not interested",
]);

function isWbahDisqualified(r: any): boolean {
  const s = (r.callStatus ?? "").toLowerCase().trim();
  return WBAH_DISQUALIFIED_STATUSES.has(s) || s.includes("disqualif");
}

const OPTIONAL_COLS: { key: string; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "title", label: "Title" },
  { key: "client_name", label: "Client" },
  { key: "unique_id", label: "Unique ID" },
  { key: "lead_external_id", label: "Lead ID" },
  { key: "property_type", label: "Property Type" },
  { key: "bedrooms", label: "Bedrooms" },
  { key: "address_line1", label: "Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postal_code", label: "Postcode" },
];

function DynamicDataTable({
  records,
  agents,
  selected,
  allSelected,
  toggleAll,
  toggleOne,
  onReset,
}: {
  records: any[];
  agents: any[];
  selected: Set<string>;
  allSelected: boolean;
  toggleAll: (v: boolean | "indeterminate") => void;
  toggleOne: (id: string) => void;
  onReset: (id: string) => void;
}) {
  const extraCols = useMemo(
    () => OPTIONAL_COLS.filter((c) => records.some((r) => r[c.key])),
    [records],
  );

  const metaKeys = useMemo(() => {
    const keys = new Set<string>();
    records.forEach((r) => {
      if (r.meta && typeof r.meta === "object") {
        Object.keys(r.meta).forEach((k) => keys.add(k));
      }
    });
    return Array.from(keys).sort();
  }, [records]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/[0.06] bg-card/30">
            <th className="w-8 px-3 py-2">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
            </th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Name</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Phone</th>
            {extraCols.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{c.label}</th>
            ))}
            {metaKeys.map((k) => (
              <th key={`meta_${k}`} className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {k}
                <span className="ml-1 font-normal normal-case tracking-normal text-amber-500/70">meta</span>
              </th>
            ))}
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Status</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Agent</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Updated</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r: any) => (
            <tr key={r.id} className={`group h-9 border-b border-white/[0.04] align-middle hover:bg-white/[0.02] transition-colors ${selected.has(r.id) ? "bg-blue-500/5" : ""}`}>
              <td className="px-3 py-1.5">
                <Checkbox
                  checked={selected.has(r.id)}
                  onCheckedChange={() => toggleOne(r.id)}
                />
              </td>
              <td className="px-3 py-1.5 text-xs font-medium whitespace-nowrap">{r.name}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground text-[11px] font-mono">{r.mobile_number}</td>
              {extraCols.map((c) => (
                <td key={c.key} className="px-3 py-1.5 text-muted-foreground text-[11px]">
                  {r[c.key] ?? "—"}
                </td>
              ))}
              {metaKeys.map((k) => (
                <td key={`meta_${k}`} className="px-3 py-1.5 text-muted-foreground text-[11px]">
                  {r.meta?.[k] ?? "—"}
                </td>
              ))}
              <td className="px-3 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ring-1 ${statusBadgeClass(r.call_status)}`}>
                    {(r.call_status ?? "").replace(/_/g, " ") || "—"}
                  </span>
                  <button
                    title="Reset — mark as needs to call again"
                    onClick={() => onReset(r.id)}
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </div>
              </td>
              <td className="px-3 py-1.5 text-muted-foreground text-[11px]">
                {r.assigned_agent_id
                  ? (agents.find((a: any) => a.id === r.assigned_agent_id)?.name ?? "—")
                  : "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground text-[11px]">{fmtDate(r.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataPage() {
  const [search, setSearch] = useState("");
  const [callStatus, setCallStatus] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [startCallingOpen, setStartCallingOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [callScheduleOpen, setCallScheduleOpen] = useState(false);
  const [isWbah, setIsWbah] = useState(false);
  const [dataTab, setDataTab] = useState<"records" | "campaigns" | "people">("records");

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
        const wbah = ws?.slug === "webuyanyhouse";
        setIsWbah(wbah);
        if (!wbah) setDataTab("people");
      } catch {}
    })();
    return () => { active = false; };
  }, []);

  const [crmPeople, setCrmPeople] = useState<CrmPersonRow[]>([]);
  const [crmPeopleLoading, setCrmPeopleLoading] = useState(false);
  const [crmPeopleError, setCrmPeopleError] = useState<string | null>(null);
  const [crmPeopleSelected, setCrmPeopleSelected] = useState<Set<string>>(new Set());
  const [crmImporting, setCrmImporting] = useState(false);
  const [crmImportAgentId, setCrmImportAgentId] = useState<string>("");

  const [qualifiedLeads, setQualifiedLeads] = useState<QualifiedLeadRow[]>([]);
  const [qualifiedLoading, setQualifiedLoading] = useState(false);
  const [qualifiedError, setQualifiedError] = useState<string | null>(null);

  const [wbahCallData, setWbahCallData]               = useState<any[]>([]);
  const [wbahCallDataLoading, setWbahCallDataLoading] = useState(false);
  const [wbahCallDataError, setWbahCallDataError]     = useState<string | null>(null);
  const [wbahPeopleSubTab, setWbahPeopleSubTab]       = useState<string>("all");
  const [wbahPeopleSearch, setWbahPeopleSearch]       = useState("");
  const [wbahSelected, setWbahSelected]               = useState<Set<string>>(new Set());
  const [wbahQualAgentId, setWbahQualAgentId]         = useState<string>("");
  const [wbahTranscript, setWbahTranscript]           = useState<{ name: string; text: string } | null>(null);
  const [wbahImporting, setWbahImporting]             = useState(false);

  type WbahCatRow = { id: string; external_lead_id: string; external_status_code: string | null; external_status_label: string | null; webee_category: string; full_name: string; phone: string | null; email: string | null; address: string | null; city: string | null; postcode: string | null; property_type: string | null; meta: Record<string, unknown>; last_synced_at: string };
  type WbahSyncLog = { id: string; synced_at: string; imported: number; updated: number; skipped: number; failed: number; total_records: number; duration_ms: number; error_message: string | null } | null;

  const [catRows, setCatRows]           = useState<Record<string, WbahCatRow[]>>({ disqualified: [], tried_to_contact: [], rebooking: [] });
  const [catTotal, setCatTotal]         = useState<Record<string, number>>({ disqualified: 0, tried_to_contact: 0, rebooking: 0 });
  const [catPage, setCatPage]           = useState<Record<string, number>>({ disqualified: 1, tried_to_contact: 1, rebooking: 1 });
  const [catSearch, setCatSearch]       = useState<Record<string, string>>({ disqualified: "", tried_to_contact: "", rebooking: "" });
  const [catLoading, setCatLoading]     = useState<Record<string, boolean>>({ disqualified: false, tried_to_contact: false, rebooking: false });
  const [catError, setCatError]         = useState<Record<string, string | null>>({ disqualified: null, tried_to_contact: null, rebooking: null });
  const [catSyncing, setCatSyncing]     = useState<Record<string, boolean>>({ disqualified: false, tried_to_contact: false, rebooking: false });
  const [catSyncLog, setCatSyncLog]     = useState<Record<string, WbahSyncLog>>({ disqualified: null, tried_to_contact: null, rebooking: null });
  const [syncLogLoaded, setSyncLogLoaded] = useState(false);

  const CAT_PAGE_SIZE = 100;

  const [showManualEntry, setShowManualEntry] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [showCsvMapping, setShowCsvMapping] = useState(false);
  const [csvImportAgentId, setCsvImportAgentId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const listFn = useServerFn(listDataRecords);
  const importFn = useServerFn(importDataRecords);
  const assignFn = useServerFn(assignAgentToRecords);
  const scheduleFn = useServerFn(scheduleCallsForRecords);
  const startCallFn = useServerFn(startCallingRecords);
  const resetFn = useServerFn(resetDataRecord);
  const getScheduleFn = useServerFn(getCallSchedule);
  const setScheduleFn = useServerFn(setCallSchedule);
  const listAgentsFn = useServerFn(listLiveAgents);
  const fetchCrmPeopleFn = useServerFn(fetchCrmPeople);
  const fetchQualifiedLeadsFn = useServerFn(fetchQualifiedLeads);
  const setStatusFn = useServerFn(setRecordCallStatus);
  const listWbahAllCallDataFn = useServerFn(listWbahAllCallData);
  const triggerCatSyncFn = useServerFn(triggerWbahCategorySync);
  const listCatLeadsFn = useServerFn(listWbahCategorizedLeads);
  const getCatSyncLogFn = useServerFn(getWbahCategorySyncLog);
  const qc = useQueryClient();

  const filters = useMemo(() => {
    const f: Record<string, unknown> = { limit: 500 };
    if (search.trim()) f.search = search.trim();
    if (callStatus !== "all") f.callStatus = callStatus;
    if (unassignedOnly) f.unassignedOnly = true;
    else if (agentFilter !== "all") f.assignedAgentId = agentFilter;
    return f;
  }, [search, callStatus, agentFilter, unassignedOnly]);

  const recordsQ = useQuery({
    queryKey: ["data-records", filters],
    queryFn: () => listFn({ data: filters }),
    throwOnError: false,
  });

  const agentsQ = useQuery({
    queryKey: ["my-agents-mini"],
    queryFn: () => listAgentsFn(),
    throwOnError: false,
  });

  const scheduleQ = useQuery({
    queryKey: ["call-schedule"],
    queryFn: () => getScheduleFn(),
    throwOnError: false,
  });

  const agents = (agentsQ.data ?? []) as Array<{
    id: string;
    retell_agent_id: string | null;
    name: string;
    settings?: Record<string, unknown> | null;
  }>;
  const records = (recordsQ.data ?? []) as any[];

  const stats = useMemo(() => {
    const total = records.length;
    const needToCall = records.filter((r) => r.call_status === "needs_to_call").length;
    const queued = records.filter((r) => r.call_status === "queued").length;
    const completed = records.filter((r) => r.call_status === "completed").length;
    return { total, needToCall, queued, completed };
  }, [records]);

  const allSelected = records.length > 0 && selected.size === records.length;

  const wbahFiltered = useMemo(() => {
    return wbahCallData.filter(r => {
      if (wbahPeopleSearch) {
        const q = wbahPeopleSearch.toLowerCase();
        if (!(r.name ?? "").toLowerCase().includes(q) && !(r.contact ?? "").includes(q)) return false;
      }
      return true;
    });
  }, [wbahCallData, wbahPeopleSearch]);

  const recordsPag = useTablePagination(records);
  const wbahPag    = useTablePagination(wbahFiltered);
  const crmPag     = useTablePagination(crmPeople);

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
      const skipped = (result as any).skipped ?? 0;
      const skipNote = skipped > 0 ? ` (${skipped} duplicate${skipped !== 1 ? "s" : ""} skipped)` : "";
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
      toast.success(`Marked ${result.updated} record${result.updated !== 1 ? "s" : ""} as disqualified`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["data-records"] });
    } catch (err) {
      toast.error("Failed to disqualify", { description: (err as Error).message });
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
        toast.success(`Found ${(people as CrmPersonRow[]).length} inbound lead${(people as CrmPersonRow[]).length !== 1 ? "s" : ""}`);
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

  async function handleFetchWbahCallData() {
    setWbahCallDataLoading(true);
    setWbahCallDataError(null);
    try {
      const rows = await listWbahAllCallDataFn();
      setWbahCallData(rows as any[]);
      setWbahSelected(new Set());
    } catch (err) {
      setWbahCallDataError((err as Error).message);
    } finally {
      setWbahCallDataLoading(false);
    }
  }

  useEffect(() => {
    if (dataTab === "people" && isWbah && wbahCallData.length === 0 && !wbahCallDataLoading) {
      handleFetchWbahCallData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTab, isWbah]);

  useEffect(() => {
    setWbahSelected(new Set());
    setWbahQualAgentId("");
    if (wbahPeopleSubTab === "disqualified_sweep") {
      const qualAgent = agents.find(a =>
        a.name.toLowerCase().includes("wbah") && a.name.toLowerCase().includes("qualification")
      );
      if (qualAgent) setWbahQualAgentId(qualAgent.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wbahPeopleSubTab, agents]);

  // ── Category tab auto-load ────────────────────────────────────────────────
  const CAT_TABS: string[] = ["disqualified", "tried_to_contact", "rebooking"];

  useEffect(() => {
    if (!isWbah) return;
    if (!CAT_TABS.includes(wbahPeopleSubTab)) return;
    const cat = wbahPeopleSubTab as "disqualified" | "tried_to_contact" | "rebooking";
    if (catLoading[cat]) return;
    loadCatLeads(cat, 1, catSearch[cat]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wbahPeopleSubTab, isWbah]);

  useEffect(() => {
    if (!isWbah || syncLogLoaded) return;
    if (dataTab !== "people") return;
    setSyncLogLoaded(true);
    getCatSyncLogFn().then(logs => {
      setCatSyncLog(logs as any);
    }).catch(() => {/* silent */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataTab, isWbah, syncLogLoaded]);

  async function loadCatLeads(
    cat: "disqualified" | "tried_to_contact" | "rebooking",
    page: number,
    search: string,
  ) {
    setCatLoading(prev => ({ ...prev, [cat]: true }));
    setCatError(prev => ({ ...prev, [cat]: null }));
    try {
      const res = await listCatLeadsFn({ data: { category: cat, page, limit: CAT_PAGE_SIZE, search: search.trim() || undefined } });
      setCatRows(prev => ({ ...prev, [cat]: res.rows as any[] }));
      setCatTotal(prev => ({ ...prev, [cat]: res.total }));
      setCatPage(prev => ({ ...prev, [cat]: page }));
    } catch (err) {
      setCatError(prev => ({ ...prev, [cat]: (err as Error).message }));
    } finally {
      setCatLoading(prev => ({ ...prev, [cat]: false }));
    }
  }

  async function handleCatSync(cat: "disqualified" | "tried_to_contact" | "rebooking" | "all") {
    const cats: ("disqualified" | "tried_to_contact" | "rebooking")[] = cat === "all"
      ? ["disqualified", "tried_to_contact", "rebooking"]
      : [cat];
    const key = cat;
    setCatSyncing(prev => {
      const n = { ...prev };
      cats.forEach(c => { n[c] = true; });
      return n;
    });
    try {
      const res = await triggerCatSyncFn({ data: { category: cat } });
      const resAny = res as any;
      const total = cats.reduce((s, c) => s + ((resAny[c]?.imported ?? 0) + (resAny[c]?.updated ?? 0)), 0);
      toast.success(`Category sync complete — ${total} leads imported/updated`);
      // Reload the current category and refresh sync log
      for (const c of cats) {
        await loadCatLeads(c, 1, catSearch[c]);
      }
      setSyncLogLoaded(false);
    } catch (err) {
      toast.error(`Sync failed`, { description: (err as Error).message });
    } finally {
      setCatSyncing(prev => {
        const n = { ...prev };
        cats.forEach(c => { n[c] = false; });
        return n;
      });
      void key;
    }
  }

  async function handleImportWbahSelected() {
    const toImport = wbahCallData.filter(r => wbahSelected.has(r.id));
    if (!toImport.length) return;
    setWbahImporting(true);
    try {
      const rows = toImport.map(r => ({
        name:          r.name || "Unknown",
        mobile_number: r.contact || "",
        email:         r.email  || "",
        notes:         ["Disqualified Sweep", r.callStatus, r.disconnectionReason].filter(Boolean).join(" | "),
      }));
      const result = await importFn({ data: { rows, agentId: wbahQualAgentId || null } });
      const inserted = (result as any)?.inserted ?? toImport.length;
      toast.success(`Imported ${inserted} record${inserted !== 1 ? "s" : ""} to calling list`);
      setWbahSelected(new Set());
      qc.invalidateQueries({ queryKey: ["data-records"] });
    } catch (err) {
      toast.error("Import failed", { description: (err as Error).message });
    } finally {
      setWbahImporting(false);
    }
  }

  async function handleImportCrmPeople() {
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
      toast.success(`Imported ${result.inserted} lead${result.inserted !== 1 ? "s" : ""}${skipNote}`);
      setCrmPeopleSelected(new Set());
      qc.invalidateQueries({ queryKey: ["data-records"] });
      qc.invalidateQueries({ queryKey: ["data-record-schema"] });
    } catch (err) {
      toast.error("Import failed", { description: (err as Error).message });
    } finally {
      setCrmImporting(false);
    }
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
    <div className="mx-auto w-full max-w-7xl px-6 py-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Data Records</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isWbah
              ? "Manage calling data, import records, and control outbound campaigns"
              : "Pull inbound leads from your CRM and manage people"}
          </p>
        </div>
        {isWbah && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowManualEntry(true)}
            >
              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              Add Record
            </Button>
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
            <Button variant="outline" size="sm" onClick={() => setCallScheduleOpen(true)}>
              <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
              Call Schedule
            </Button>
          </div>
        )}
      </div>

      {/* Tabs — Records + Campaigns only for WBAH; People for all */}
      <div className="flex gap-1 mb-4 border-b border-white/[0.06]">
        {(isWbah
          ? (["records", "people", "campaigns"] as const)
          : (["people"] as const)
        ).map((t) => (
          <button
            key={t}
            onClick={() => setDataTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
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

      {dataTab === "campaigns" && (
        <WbahCallSchedulingSection />
      )}

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
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total" value={isWbah ? 0 : stats.total} icon={Database} iconBg="bg-blue-500/15" iconColor="text-blue-400" />
        <KpiCard label="Need to Call" value={isWbah ? 0 : stats.needToCall} icon={PhoneOutgoing} iconBg="bg-amber-500/15" iconColor="text-amber-400" />
        <KpiCard label="Queued" value={isWbah ? 0 : stats.queued} icon={CalendarClock} iconBg="bg-violet-500/15" iconColor="text-violet-400" />
        <KpiCard label="Completed" value={isWbah ? 0 : stats.completed} icon={UserCheck} iconBg="bg-emerald-500/15" iconColor="text-emerald-400" />
      </div>

      {/* Table card — matches Leads page container */}
      <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
        {/* Toolbar row */}
        <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-2.5 border-b border-white/[0.06]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Data Records
            {selected.size > 0 && (
              <span className="ml-2 normal-case text-xs font-normal text-blue-400 tracking-normal">{selected.size} selected</span>
            )}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {selected.size > 0 && (
              <>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <Select onValueChange={(v) => handleBulkAssign(v === "none" ? null : v)}>
                  <SelectTrigger className="h-7 w-[140px] text-xs">
                    <SelectValue placeholder="Assign agent…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassign</SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setScheduleOpen(true)}>
                  <CalendarClock className="mr-1 h-3.5 w-3.5" />
                  Schedule
                </Button>
                <Button variant="default" size="sm" className="h-7 text-xs" onClick={() => setStartCallingOpen(true)}>
                  <PhoneOutgoing className="mr-1 h-3.5 w-3.5" />
                  Start Calling
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
              </>
            )}
            {/* Filters */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 w-44 pl-7 text-xs"
              />
            </div>
            <Select value={callStatus} onValueChange={setCallStatus}>
              <SelectTrigger className="h-7 w-[130px] text-xs">
                <SelectValue placeholder="Call status" />
              </SelectTrigger>
              <SelectContent>
                {CALL_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="h-7 w-[120px] text-xs">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
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
        {recordsQ.isLoading && !isWbah ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            Loading records…
          </div>
        ) : records.length === 0 || isWbah ? (
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
            />
            <TablePagBar {...recordsPag} />
          </>
        )}
      </div>
      </>
      )}

      {dataTab === "people" && isWbah && (
        <>
          {/* ── Transcript modal ────────────────────────────────────────── */}
          {wbahTranscript && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="w-full max-w-2xl rounded-xl border border-white/[0.08] bg-card flex flex-col max-h-[80vh]">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
                  <p className="text-sm font-semibold">{wbahTranscript.name} — Transcript</p>
                  <button
                    onClick={() => setWbahTranscript(null)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="overflow-y-auto px-5 py-4 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed flex-1">
                  {wbahTranscript.text || "No transcript available."}
                </div>
              </div>
            </div>
          )}

          {/* ── WBAH People KPI strip ───────────────────────────────────── */}
          {wbahCallData.length > 0 && (() => {
            const wbahTotal      = wbahCallData.length;
            const wbahNeedCall   = wbahCallData.filter(r => {
              const s = (r.callStatus ?? "").toLowerCase();
              return s === "need_to_call" || s === "need to call" || s === "not_connected" || s === "no_answer" || s === "not connected";
            }).length;
            const wbahAppts      = wbahCallData.filter(r => !!r.appointmentDate).length;
            const wbahDisqualCnt = wbahCallData.filter(isWbahDisqualified).length;
            return (
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiCard label="Total Leads"    value={wbahTotal}      icon={Users}        iconBg="bg-blue-500/15"    iconColor="text-blue-400" />
                <KpiCard label="Need to Call"   value={wbahNeedCall}   icon={PhoneOutgoing} iconBg="bg-amber-500/15"  iconColor="text-amber-400" />
                <KpiCard label="Appointments"   value={wbahAppts}      icon={CalendarClock} iconBg="bg-violet-500/15" iconColor="text-violet-400" />
                <KpiCard label="Disqualified"   value={wbahDisqualCnt} icon={UserCheck}    iconBg="bg-rose-500/15"   iconColor="text-rose-400" />
              </div>
            );
          })()}

          {/* ── WBAH People toolbar ─────────────────────────────────────── */}
          <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">

            {/* ── CRM section sub-tabs ────────────────────────────────────── */}
            <div className="flex items-center gap-0 border-b border-white/[0.06] px-4 overflow-x-auto">
              {([
                { id: "all",                label: "All Records" },
                { id: "disqualified_sweep", label: "Disqualified Sweep" },
                { id: "disqualified",       label: "Disqualified" },
                { id: "tried_to_contact",   label: "Tried To Contact" },
                { id: "rebooking",          label: "Rebooking" },
              ] as { id: string; label: string }[]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setWbahPeopleSubTab(tab.id)}
                  className={`relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                    wbahPeopleSubTab === tab.id
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.id === "disqualified_sweep" && <AlertCircle className="h-3 w-3" />}
                  {tab.label}
                  {tab.id !== "all" && (() => {
                    let count = 0;
                    if (tab.id === "disqualified_sweep" && wbahCallData.length > 0) count = wbahCallData.filter(isWbahDisqualified).length;
                    else if (tab.id === "disqualified" || tab.id === "tried_to_contact" || tab.id === "rebooking") count = catTotal[tab.id] ?? 0;
                    return count > 0 ? (
                      <span className="ml-1 rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">{count}</span>
                    ) : null;
                  })()}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-2.5 border-b border-white/[0.06]">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {wbahPeopleSubTab === "disqualified_sweep" ? "Disqualified Sweep"
                    : wbahPeopleSubTab === "disqualified" ? "Disqualified"
                    : wbahPeopleSubTab === "tried_to_contact" ? "Tried To Contact"
                    : wbahPeopleSubTab === "rebooking" ? "Rebooking"
                    : "All Records"}
                  {(wbahPeopleSubTab === "all" || wbahPeopleSubTab === "disqualified_sweep") && wbahCallData.length > 0 && (
                    <span className="ml-2 normal-case text-xs font-normal tracking-normal text-muted-foreground">
                      {wbahCallData.length} total
                    </span>
                  )}
                  {(wbahPeopleSubTab === "disqualified" || wbahPeopleSubTab === "tried_to_contact" || wbahPeopleSubTab === "rebooking") && catTotal[wbahPeopleSubTab] > 0 && (
                    <span className="ml-2 normal-case text-xs font-normal tracking-normal text-muted-foreground">
                      {catTotal[wbahPeopleSubTab]} total
                    </span>
                  )}
                  {wbahSelected.size > 0 && (
                    <span className="ml-2 normal-case text-xs font-normal text-blue-400 tracking-normal">
                      {wbahSelected.size} selected
                    </span>
                  )}
                </p>
                {/* Search */}
                {wbahCallData.length > 0 && (
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                    <input
                      value={wbahPeopleSearch}
                      onChange={e => setWbahPeopleSearch(e.target.value)}
                      placeholder="Search name, phone…"
                      className="h-7 rounded-md border border-white/[0.08] bg-muted/40 pl-6 pr-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 w-44"
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
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Assign Qualification Agent — only when rows are selected */}
                {wbahSelected.size > 0 && (
                  <>
                    {wbahPeopleSubTab === "disqualified_sweep" ? (
                      /* In sweep mode the agent is locked to the WBAH qual agent */
                      <div className="flex items-center gap-1.5 rounded-md border border-rose-500/20 bg-rose-500/5 px-2.5 py-1 text-[11px] text-rose-300">
                        <UserCheck className="h-3 w-3" />
                        {agents.find(a => a.id === wbahQualAgentId)?.name ?? "WBAH Client qualification agent"}
                      </div>
                    ) : (
                      <Select
                        value={wbahQualAgentId || "__none__"}
                        onValueChange={(v) => setWbahQualAgentId(v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger className="h-7 w-[170px] text-xs">
                          <SelectValue placeholder="Assign qual. agent…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No agent</SelectItem>
                          {agents.map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleImportWbahSelected}
                      disabled={wbahImporting}
                    >
                      {wbahImporting ? (
                        <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="mr-1 h-3.5 w-3.5" />
                      )}
                      Assign Qualification Agent
                    </Button>
                  </>
                )}

                {/* Select All */}
                {wbahCallData.length > 0 && wbahSelected.size === 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      const visible = wbahCallData.filter(r => {
                        if (wbahPeopleSearch) {
                          const q = wbahPeopleSearch.toLowerCase();
                          return (r.name ?? "").toLowerCase().includes(q) || (r.contact ?? "").includes(q);
                        }
                        return true;
                      });
                      setWbahSelected(new Set(visible.map((r: any) => r.id)));
                    }}
                  >
                    Select All
                  </Button>
                )}
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

                {/* Refresh button — only for All / Sweep tabs */}
                {(wbahPeopleSubTab === "all" || wbahPeopleSubTab === "disqualified_sweep") && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleFetchWbahCallData}
                    disabled={wbahCallDataLoading}
                  >
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${wbahCallDataLoading ? "animate-spin" : ""}`} />
                    {wbahCallData.length > 0 ? "Refresh" : "Load Data"}
                  </Button>
                )}

                {/* Sync button — only for category tabs */}
                {(wbahPeopleSubTab === "disqualified" || wbahPeopleSubTab === "tried_to_contact" || wbahPeopleSubTab === "rebooking") && (() => {
                  const cat = wbahPeopleSubTab as "disqualified" | "tried_to_contact" | "rebooking";
                  const syncing = catSyncing[cat];
                  const log = catSyncLog[cat];
                  return (
                    <div className="flex items-center gap-2">
                      {log && (
                        <span className="text-[10px] text-muted-foreground/70">
                          Last synced {new Date(log.synced_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          {log.total_records > 0 && ` · ${log.total_records} total`}
                        </span>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleCatSync(cat)}
                        disabled={syncing}
                      >
                        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                        {syncing ? "Syncing…" : "Sync Now"}
                      </Button>
                    </div>
                  );
                })()}

                {/* Search for category tabs */}
                {(wbahPeopleSubTab === "disqualified" || wbahPeopleSubTab === "tried_to_contact" || wbahPeopleSubTab === "rebooking") && (() => {
                  const cat = wbahPeopleSubTab as "disqualified" | "tried_to_contact" | "rebooking";
                  return (
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                      <input
                        value={catSearch[cat]}
                        onChange={e => {
                          const s = e.target.value;
                          setCatSearch(prev => ({ ...prev, [cat]: s }));
                          if (!s) loadCatLeads(cat, 1, "");
                        }}
                        onKeyDown={e => { if (e.key === "Enter") loadCatLeads(cat, 1, catSearch[cat]); }}
                        placeholder="Search name, phone…"
                        className="h-7 rounded-md border border-white/[0.08] bg-muted/40 pl-6 pr-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 w-44"
                      />
                      {catSearch[cat] && (
                        <button
                          onClick={() => { setCatSearch(prev => ({ ...prev, [cat]: "" })); loadCatLeads(cat, 1, ""); }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* ── Table body ─────────────────────────────────────────────── */}
            {/* ── Category DB tabs ────────────────────────────────────────── */}
            {(wbahPeopleSubTab === "disqualified" || wbahPeopleSubTab === "tried_to_contact" || wbahPeopleSubTab === "rebooking") ? (() => {
              const cat = wbahPeopleSubTab as "disqualified" | "tried_to_contact" | "rebooking";
              const rows = catRows[cat];
              const loading = catLoading[cat];
              const error = catError[cat];
              const total = catTotal[cat];
              const page = catPage[cat];
              const pageSize = CAT_PAGE_SIZE;
              const totalPages = Math.max(1, Math.ceil(total / pageSize));

              if (loading) return (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-sm text-muted-foreground">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  <span>Loading {wbahPeopleSubTab === "tried_to_contact" ? "Tried To Contact" : wbahPeopleSubTab === "rebooking" ? "Rebooking" : "Disqualified"} leads…</span>
                </div>
              );
              if (error) return (
                <div className="flex flex-col items-center gap-2 py-16 text-sm">
                  <AlertCircle className="h-8 w-8 text-destructive/60" />
                  <p className="font-medium text-destructive">Could not load leads</p>
                  <p className="max-w-sm text-center text-xs text-muted-foreground">{error}</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => loadCatLeads(cat, 1, "")}>Try again</Button>
                </div>
              );
              if (rows.length === 0) return (
                <div className="flex flex-col items-center gap-3 py-16">
                  <Users className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">No {wbahPeopleSubTab === "tried_to_contact" ? "Tried To Contact" : wbahPeopleSubTab === "rebooking" ? "Rebooking" : "Disqualified"} leads synced yet</p>
                  <p className="text-xs text-muted-foreground max-w-sm text-center">Click <strong>Sync Now</strong> to pull leads from WeeBespoke, or wait for the automatic sync (every 30 min).</p>
                  <Button variant="outline" size="sm" className="mt-1" onClick={() => handleCatSync(cat)} disabled={catSyncing[cat]}>
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${catSyncing[cat] ? "animate-spin" : ""}`} /> Sync Now
                  </Button>
                </div>
              );
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.06] bg-card/30">
                        {(["#","NAME","PHONE","EMAIL","ADDRESS","CITY","POSTCODE","PROPERTY TYPE","STATUS","LAST SYNCED"] as const).map(col => (
                          <th key={col} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, idx) => (
                        <tr key={r.id} className="border-b border-white/[0.04] align-middle hover:bg-white/[0.02] transition-colors">
                          <td className="px-3 py-2 text-muted-foreground text-[11px]">{(page - 1) * pageSize + idx + 1}</td>
                          <td className="px-3 py-2 font-medium whitespace-nowrap max-w-[140px] truncate">{r.full_name || "—"}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground text-[11px] whitespace-nowrap">
                            {r.phone ? <a href={`tel:${r.phone}`} className="flex items-center gap-1 hover:text-foreground transition-colors"><Phone className="h-3 w-3" />{r.phone}</a> : "—"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground text-[11px] max-w-[160px] truncate">{r.email || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground text-[11px] max-w-[160px] truncate">{r.address || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground text-[11px] whitespace-nowrap">{r.city || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground text-[11px] whitespace-nowrap">{r.postcode || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground text-[11px] whitespace-nowrap capitalize">{r.property_type?.replace(/_/g," ") || "—"}</td>
                          <td className="px-3 py-2">
                            {r.external_status_label ? (
                              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-white/[0.06]">
                                {r.external_status_label}
                              </span>
                            ) : <span className="text-muted-foreground/40 text-[11px]">—</span>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground text-[11px] whitespace-nowrap">
                            {new Date(r.last_synced_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
                      <span className="text-[11px] text-muted-foreground">Page {page} of {totalPages} · {total} leads</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page <= 1} onClick={() => loadCatLeads(cat, page - 1, catSearch[cat])}>Prev</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page >= totalPages} onClick={() => loadCatLeads(cat, page + 1, catSearch[cat])}>Next</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })() : wbahCallDataLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-20 text-sm text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin" />
                <span>Fetching call data from WeeBespoke… this may take a moment</span>
              </div>
            ) : wbahCallDataError ? (
              <div className="flex flex-col items-center gap-2 py-16 text-sm">
                <AlertCircle className="h-8 w-8 text-destructive/60" />
                <p className="font-medium text-destructive">Could not load call data</p>
                <p className="max-w-sm text-center text-xs text-muted-foreground">{wbahCallDataError}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={handleFetchWbahCallData}>
                  Try again
                </Button>
              </div>
            ) : wbahCallData.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16">
                <Users className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No call data loaded yet</p>
                <p className="text-xs text-muted-foreground">Click <strong>Load Data</strong> to fetch all call records.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={handleFetchWbahCallData}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Load Data
                </Button>
              </div>
            ) : (() => {
              const isSweepTab = wbahPeopleSubTab === "disqualified_sweep";

              return (
                <div className="overflow-x-auto">
                  {isSweepTab && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-rose-500/5 border-b border-rose-500/10 text-[11px] text-rose-400">
                      <AlertCircle className="h-3 w-3" />
                      Disqualified Sweep — review all {wbahFiltered.length} record{wbahFiltered.length !== 1 ? "s" : ""} and assign the qualification agent to disqualify leads
                    </div>
                  )}
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.06] bg-card/30">
                        <th className="w-8 px-3 py-2">
                          <Checkbox
                            checked={wbahFiltered.length > 0 && wbahFiltered.every(r => wbahSelected.has(r.id))}
                            onCheckedChange={(v) => {
                              if (v) setWbahSelected(prev => new Set([...prev, ...wbahFiltered.map((r: any) => r.id)]));
                              else setWbahSelected(prev => { const n = new Set(prev); wbahFiltered.forEach((r: any) => n.delete(r.id)); return n; });
                            }}
                          />
                        </th>
                        {(["SR NO","NAME","CONTACT","TYPE","LAST CALLED AT","CALL STATUS","DURATION","RECORDING","TRANSCRIPT","SENTIMENT","APPT DATE","APPT TIME","BOOKING STATUS","CALENDLY","END REASON","DISCONNECTION"] as const).map(col => (
                          <th key={col} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {wbahPag.sliced.map((r: any) => {
                        const statusBadge   = wbahCallStatusBadge(r.callStatus);
                        const sentBadge     = wbahSentimentBadge(r.sentimentAnalysis);
                        const isSelected    = wbahSelected.has(r.id);
                        return (
                          <tr
                            key={r.id}
                            className={`group border-b border-white/[0.04] align-middle hover:bg-white/[0.02] transition-colors ${isSelected ? "bg-blue-500/5" : ""}`}
                          >
                            <td className="px-3 py-2">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => {
                                  const n = new Set(wbahSelected);
                                  if (n.has(r.id)) n.delete(r.id); else n.add(r.id);
                                  setWbahSelected(n);
                                }}
                              />
                            </td>
                            {/* SR NO */}
                            <td className="px-3 py-2 text-muted-foreground text-[11px]">{r.srNo}</td>
                            {/* NAME */}
                            <td className="px-3 py-2 font-medium whitespace-nowrap max-w-[140px] truncate">{r.name || "—"}</td>
                            {/* CONTACT */}
                            <td className="px-3 py-2 font-mono text-muted-foreground text-[11px] whitespace-nowrap">
                              {r.contact ? (
                                <a href={`tel:${r.contact}`} className="flex items-center gap-1 hover:text-foreground transition-colors">
                                  <Phone className="h-3 w-3" />{r.contact}
                                </a>
                              ) : "—"}
                            </td>
                            {/* TYPE */}
                            <td className="px-3 py-2 text-muted-foreground text-[11px] whitespace-nowrap capitalize">{(r.callType || "—").replace(/_/g, " ")}</td>
                            {/* LAST CALLED AT */}
                            <td className="px-3 py-2 text-muted-foreground text-[11px] whitespace-nowrap">{fmtTs(r.startTimestamp)}</td>
                            {/* CALL STATUS */}
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-white/[0.06] ${statusBadge.cls}`}>
                                {statusBadge.label}
                              </span>
                            </td>
                            {/* DURATION */}
                            <td className="px-3 py-2 text-muted-foreground text-[11px] whitespace-nowrap">{fmtMs(r.durationMs)}</td>
                            {/* RECORDING */}
                            <td className="px-3 py-2">
                              {r.recordingUrl ? (
                                <a
                                  href={r.recordingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors"
                                >
                                  <Play className="h-3 w-3" /> Play
                                </a>
                              ) : <span className="text-muted-foreground/40 text-[11px]">—</span>}
                            </td>
                            {/* TRANSCRIPT */}
                            <td className="px-3 py-2">
                              {r.transcript ? (
                                <button
                                  onClick={() => setWbahTranscript({ name: r.name || "Record", text: r.transcript })}
                                  className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                >
                                  <FileText className="h-3 w-3" /> View
                                </button>
                              ) : <span className="text-muted-foreground/40 text-[11px]">—</span>}
                            </td>
                            {/* SENTIMENT */}
                            <td className={`px-3 py-2 text-[11px] font-medium whitespace-nowrap ${sentBadge.cls}`}>{sentBadge.label}</td>
                            {/* APPT DATE */}
                            <td className="px-3 py-2 text-muted-foreground text-[11px] whitespace-nowrap">{r.appointmentDate || "—"}</td>
                            {/* APPT TIME */}
                            <td className="px-3 py-2 text-muted-foreground text-[11px] whitespace-nowrap">{r.appointmentTime || "—"}</td>
                            {/* BOOKING STATUS */}
                            <td className="px-3 py-2">
                              {r.bookingStatus ? (
                                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-white/[0.06] capitalize">
                                  {r.bookingStatus.replace(/_/g, " ")}
                                </span>
                              ) : <span className="text-muted-foreground/40 text-[11px]">—</span>}
                            </td>
                            {/* CALENDLY */}
                            <td className="px-3 py-2">
                              {r.calendlyBookingUrl ? (
                                <a
                                  href={r.calendlyBookingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                                >
                                  <ExternalLink className="h-3 w-3" /> Link
                                </a>
                              ) : <span className="text-muted-foreground/40 text-[11px]">—</span>}
                            </td>
                            {/* END REASON */}
                            <td className="px-3 py-2 text-muted-foreground text-[11px] whitespace-nowrap capitalize max-w-[120px] truncate">
                              {r.endReason ? r.endReason.replace(/_/g, " ") : "—"}
                            </td>
                            {/* DISCONNECTION */}
                            <td className="px-3 py-2 text-muted-foreground text-[11px] whitespace-nowrap capitalize max-w-[140px] truncate">
                              {r.disconnectionReason ? r.disconnectionReason.replace(/_/g, " ") : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {wbahFiltered.length > 0 && <TablePagBar {...wbahPag} />}
                  {wbahFiltered.length === 0 && (
                    <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
                      <Search className="h-6 w-6" />
                      <p>No records match your filters</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </>
      )}

      {dataTab === "people" && !isWbah && (
        <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
          {/* People toolbar */}
          <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-2.5 border-b border-white/[0.06]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Inbound Leads from CRM
              {crmPeople.length > 0 && (
                <span className="ml-2 normal-case text-xs font-normal tracking-normal text-muted-foreground">
                  {crmPeople.length} lead{crmPeople.length !== 1 ? "s" : ""}
                </span>
              )}
              {crmPeopleSelected.size > 0 && (
                <span className="ml-2 normal-case text-xs font-normal text-blue-400 tracking-normal">
                  {crmPeopleSelected.size} selected
                </span>
              )}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
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
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleImportCrmPeople}
                    disabled={crmImporting}
                  >
                    {crmImporting ? (
                      <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="mr-1 h-3.5 w-3.5" />
                    )}
                    Import Selected
                  </Button>
                </>
              )}
              {crmPeople.length > 0 && crmPeopleSelected.size === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setCrmPeopleSelected(new Set(crmPeople.map((p) => p.external_id)))}
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
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${crmPeopleLoading ? "animate-spin" : ""}`} />
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
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-card/30">
                    <th className="w-8 px-3 py-2">
                      <Checkbox
                        checked={crmPeople.length > 0 && crmPeopleSelected.size === crmPeople.length}
                        onCheckedChange={(v) => {
                          if (v) setCrmPeopleSelected(new Set(crmPeople.map((p) => p.external_id)));
                          else setCrmPeopleSelected(new Set());
                        }}
                      />
                    </th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Name</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Phone</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Email</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Source</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">CRM Status</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {crmPag.sliced.map((p) => (
                    <tr
                      key={p.external_id}
                      className={`group h-9 border-b border-white/[0.04] align-middle hover:bg-white/[0.02] transition-colors ${crmPeopleSelected.has(p.external_id) ? "bg-blue-500/5" : ""}`}
                    >
                      <td className="px-3 py-1.5">
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
                      <td className="px-3 py-1.5 text-xs font-medium whitespace-nowrap">{p.name || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground text-[11px] font-mono">{p.phone || "—"}</td>
                      <td className="px-3 py-1.5 text-muted-foreground text-[11px]">{p.email || "—"}</td>
                      <td className="px-3 py-1.5 text-muted-foreground text-[11px]">{p.source || "—"}</td>
                      <td className="px-3 py-1.5">
                        {p.status ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground ring-1 ring-white/[0.06]">
                            {p.status.replace(/_/g, " ")}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground text-[11px]">
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

      <ScheduleCallsDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        recordCount={selected.size}
        agents={agents}
        onSchedule={handleSchedule}
      />

      <CallScheduleDialog
        open={callScheduleOpen}
        onOpenChange={setCallScheduleOpen}
        scheduleData={scheduleQ.data ?? null}
        onSave={handleSaveSchedule}
      />
    </div>
  );
}

function CsvMappingDialog({
  open,
  onOpenChange,
  headers,
  rows,
  importing,
  onImport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  headers: string[];
  rows: Record<string, string>[];
  importing: boolean;
  onImport: (mapping: Record<string, string>, rows: Record<string, string>[]) => Promise<void>;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [customKeys, setCustomKeys] = useState<Record<string, string>>({});
  const [autoCustom, setAutoCustom] = useState(false);
  const [previewSearch, setPreviewSearch] = useState("");

  useEffect(() => {
    if (open && headers.length > 0) {
      const detected = autoDetectMapping(headers);
      setMapping(detected);
      // Pre-populate custom key names for unrecognised columns
      const keys: Record<string, string> = {};
      for (const h of headers) {
        keys[h] = toMetaKey(h) || h;
      }
      setCustomKeys(keys);
      setPreviewSearch("");
      setAutoCustom(false);
    }
  }, [open, headers]);

  const mappedFields = useMemo(
    () =>
      new Set(
        Object.values(mapping).filter(
          (v) => v && v !== "__custom__" && !v.startsWith("__custom__:"),
        ),
      ),
    [mapping],
  );

  const hasName = Object.values(mapping).includes("name");
  const hasMobile = Object.values(mapping).includes("mobile_number");
  const canImport = hasName && hasMobile;

  const customCount = useMemo(() => {
    let n = 0;
    for (const [h, v] of Object.entries(mapping)) {
      if (v === "__custom__" || v.startsWith("__custom__:")) n++;
    }
    if (autoCustom) {
      for (const h of headers) {
        if (!mapping[h]) n++;
      }
    }
    return n;
  }, [mapping, autoCustom, headers]);

  const previewRows = useMemo(() => {
    const q = previewSearch.trim().toLowerCase();
    if (!q) return rows.slice(0, 50);
    return rows
      .filter((row) => {
        for (const [csvCol, sysField] of Object.entries(mapping)) {
          if (!sysField) continue;
          const val = (row[csvCol] ?? "").toLowerCase();
          if (val.includes(q)) return true;
        }
        return false;
      })
      .slice(0, 50);
  }, [rows, mapping, previewSearch]);

  function setField(csvCol: string, rawValue: string) {
    const sysField = rawValue === "__skip__" ? "" : rawValue;
    setMapping((prev) => {
      const next = { ...prev };
      if (sysField && sysField !== "__custom__" && !sysField.startsWith("__custom__:")) {
        for (const k of Object.keys(next)) {
          if (next[k] === sysField && k !== csvCol) next[k] = "";
        }
      }
      next[csvCol] = sysField;
      return next;
    });
  }

  function setCustomKey(csvCol: string, key: string) {
    setCustomKeys((prev) => ({ ...prev, [csvCol]: key }));
  }

  /** Build the final mapping with encoded custom keys before calling onImport */
  async function handleImport() {
    const finalMapping: Record<string, string> = {};
    for (const h of headers) {
      const v = mapping[h] ?? "";
      if (v === "__custom__") {
        const key = customKeys[h] || toMetaKey(h) || h;
        finalMapping[h] = `__custom__:${key}`;
      } else if (!v && autoCustom) {
        const key = customKeys[h] || toMetaKey(h) || h;
        finalMapping[h] = `__custom__:${key}`;
      } else {
        finalMapping[h] = v;
      }
    }
    await onImport(finalMapping, rows);
  }

  function isCustomField(sysField: string) {
    return sysField === "__custom__" || sysField.startsWith("__custom__:");
  }

  function getEffectiveMapping(h: string): string {
    const v = mapping[h] ?? "";
    if (!v && autoCustom) return "__custom__";
    return v;
  }

  function getFieldLabel(sysField: string): string | null {
    if (!sysField) return null;
    if (isCustomField(sysField)) return null;
    return SYSTEM_FIELDS.find((f) => f.value === sysField)?.label ?? sysField;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Map CSV Columns</DialogTitle>
          <DialogDescription>
            {rows.length} rows · {headers.length} columns detected — map each column to a system
            field or save as a custom field in lead meta.
          </DialogDescription>
        </DialogHeader>

        {/* Auto-custom toggle bar */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-4 py-2">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={autoCustom}
              onCheckedChange={(v) => setAutoCustom(v === true)}
            />
            <span className="text-xs text-muted-foreground">
              Auto-save all unmapped columns as custom fields
            </span>
          </label>
          {customCount > 0 && (
            <span className="ml-auto rounded bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-500">
              {customCount} custom field{customCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 divide-x divide-border overflow-hidden">
            {/* Left: column mapping */}
            <div className="flex w-[380px] shrink-0 flex-col overflow-hidden">
              <div className="border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Column Mapping
              </div>
              <div className="flex-1 overflow-y-auto">
                {headers.map((h) => {
                  const effective = getEffectiveMapping(h);
                  const isCustom = isCustomField(effective);
                  const fieldLabel = getFieldLabel(effective);
                  const isAutoCustom = !mapping[h] && autoCustom;
                  const customKeyVal = customKeys[h] || toMetaKey(h) || h;

                  return (
                    <div
                      key={h}
                      className={`border-b border-border/40 px-4 py-2.5 ${isCustom ? "bg-amber-500/[0.03]" : ""}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium" title={h}>
                            {h}
                          </p>
                          {effective && !isCustom && fieldLabel && (
                            <p className="text-[10px] text-muted-foreground">
                              → {fieldLabel}
                              {SYSTEM_FIELDS.find((f) => f.value === effective)?.required && (
                                <span className="ml-1 text-primary">*</span>
                              )}
                            </p>
                          )}
                          {isCustom && (
                            <p className="text-[10px] text-amber-500">
                              meta.{customKeyVal}
                              {isAutoCustom && " (auto)"}
                            </p>
                          )}
                        </div>
                        <Select
                          value={effective || "__skip__"}
                          onValueChange={(v) => setField(h, v === "__skip__" ? "" : v)}
                        >
                          <SelectTrigger className="h-7 w-[140px] text-xs">
                            <SelectValue placeholder="Skip" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__skip__">
                              {isAutoCustom ? "Override (skip)" : "Skip"}
                            </SelectItem>
                            {SYSTEM_FIELDS.map((f) => (
                              <SelectItem
                                key={f.value}
                                value={f.value}
                                disabled={
                                  mappedFields.has(f.value) && mapping[h] !== f.value
                                }
                              >
                                {f.label}
                                {f.required ? " *" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {/* Editable meta key when mapped as custom */}
                      {isCustom && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            meta key:
                          </span>
                          <Input
                            value={customKeyVal}
                            onChange={(e) =>
                              setCustomKey(
                                h,
                                e.target.value
                                  .toLowerCase()
                                  .replace(/\s+/g, "_")
                                  .replace(/[^a-z0-9_]/g, ""),
                              )
                            }
                            className="h-5 px-1.5 py-0 text-[11px] font-mono flex-1"
                            placeholder="field_name"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: preview */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Preview
                </span>
                <div className="relative ml-auto w-[200px]">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search rows…"
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    className="h-7 pl-7 text-xs"
                  />
                  {previewSearch && (
                    <button
                      onClick={() => setPreviewSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {previewSearch
                    ? `${previewRows.length} match${previewRows.length !== 1 ? "es" : ""}`
                    : `${Math.min(rows.length, 50)} of ${rows.length}`}
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                {previewRows.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                    No rows match your search.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-left">
                        {headers.map((h) => {
                          const effective = getEffectiveMapping(h);
                          const isCustom = isCustomField(effective);
                          const isMapped = Boolean(effective);
                          const f = SYSTEM_FIELDS.find((x) => x.value === effective);
                          const customKeyVal = customKeys[h] || toMetaKey(h) || h;
                          return (
                            <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
                              <div className="text-[11px] text-foreground/80">{h}</div>
                              <div className="text-[10px] font-normal">
                                {isCustom ? (
                                  <span className="text-amber-500">
                                    meta.{customKeyVal}
                                  </span>
                                ) : isMapped ? (
                                  <span className="text-primary">
                                    → {f?.label ?? effective}
                                    {f?.required && " *"}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/50">skip</span>
                                )}
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="border-b border-border/40">
                          {headers.map((h) => (
                            <td key={h} className="whitespace-nowrap px-3 py-1.5" title={row[h]}>
                              {row[h] || <span className="text-muted-foreground/50">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border px-6 py-3">
          <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            {!hasName && (
              <Badge variant="destructive" className="text-[10px]">
                Name * required
              </Badge>
            )}
            {!hasMobile && (
              <Badge variant="destructive" className="text-[10px]">
                Mobile Number * required
              </Badge>
            )}
            {canImport && (
              <span className="text-emerald-500">
                {rows.length} row{rows.length !== 1 ? "s" : ""} ready
                {customCount > 0 ? ` · ${customCount} custom field${customCount !== 1 ? "s" : ""}` : ""}
              </span>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!canImport || importing}>
            {importing
              ? "Importing…"
              : `Import ${rows.length} row${rows.length !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StartCallingDialog({
  open,
  onOpenChange,
  recordCount,
  agents,
  defaultAgentId = "",
  onStart,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recordCount: number;
  agents: Array<{ id: string; name: string; settings?: Record<string, unknown> | null }>;
  defaultAgentId?: string;
  onStart: (agentId: string | null, fromNumber: string | null) => Promise<void>;
}) {
  const [agentId, setAgentId] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [loading, setLoading] = useState(false);

  function phoneForAgent(id: string) {
    const ag = agents.find((a) => a.id === id);
    return (ag?.settings?.phoneNumber as string | undefined) ?? "";
  }

  useEffect(() => {
    if (open) {
      const id = defaultAgentId;
      setAgentId(id);
      setFromNumber(id ? phoneForAgent(id) : "");
      setLoading(false);
    }
  }, [open, defaultAgentId]);

  function handleAgentChange(id: string) {
    setAgentId(id);
    const phone = phoneForAgent(id);
    if (phone) setFromNumber(phone);
  }

  async function handleStart() {
    setLoading(true);
    try {
      await onStart(agentId || null, fromNumber || null);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start Calling</DialogTitle>
          <DialogDescription>
            Initiate outbound calls for {recordCount} selected record
            {recordCount !== 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="start-agent">Agent</Label>
            <Select value={agentId} onValueChange={handleAgentChange}>
              <SelectTrigger id="start-agent">
                <SelectValue placeholder="Select agent (optional)" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="start-from">From number</Label>
            <Input
              id="start-from"
              placeholder="+1234567890"
              value={fromNumber}
              onChange={(e) => setFromNumber(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={loading}>
            {loading ? "Starting…" : `Start ${recordCount} call${recordCount !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleCallsDialog({
  open,
  onOpenChange,
  recordCount,
  agents,
  onSchedule,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recordCount: number;
  agents: Array<{ id: string; name: string }>;
  onSchedule: (scheduledAt: string | null, agentId: string | null) => Promise<void>;
}) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [agentId, setAgentId] = useState("");
  const [clearSchedule, setClearSchedule] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setScheduledAt("");
      setAgentId("");
      setClearSchedule(false);
      setLoading(false);
    }
  }, [open]);

  async function handleSchedule() {
    setLoading(true);
    try {
      const iso = clearSchedule ? null : scheduledAt ? new Date(scheduledAt).toISOString() : null;
      await onSchedule(iso, agentId || null);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule Calls</DialogTitle>
          <DialogDescription>
            Set a scheduled call time for {recordCount} record
            {recordCount !== 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="clear-schedule"
              checked={clearSchedule}
              onCheckedChange={(v) => setClearSchedule(v === true)}
            />
            <Label htmlFor="clear-schedule" className="cursor-pointer">
              Clear existing schedule
            </Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="schedule-datetime">Call time</Label>
            <Input
              id="schedule-datetime"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              disabled={clearSchedule}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="schedule-agent">Agent (optional)</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger id="schedule-agent">
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSchedule} disabled={loading}>
            {loading ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CallScheduleDialog({
  open,
  onOpenChange,
  scheduleData,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scheduleData: { schedule: unknown; timezone: string } | null;
  onSave: (data: {
    enabled: boolean;
    days: number[];
    startHour: number;
    endHour: number;
    timezone: string;
    maxDailyAttempts: number;
  }) => Promise<void>;
}) {
  const existing = scheduleData?.schedule as
    | { enabled?: boolean; days?: number[]; startHour?: number; endHour?: number; maxDailyAttempts?: number }
    | null
    | undefined;

  const [enabled, setEnabled] = useState(true);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(17);
  const [timezone, setTimezone] = useState("UTC");
  const [maxDailyAttempts, setMaxDailyAttempts] = useState(3);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setEnabled(existing?.enabled ?? true);
      setDays(existing?.days ?? [1, 2, 3, 4, 5]);
      setStartHour(existing?.startHour ?? 9);
      setEndHour(existing?.endHour ?? 17);
      setTimezone(scheduleData?.timezone ?? "UTC");
      setMaxDailyAttempts(existing?.maxDailyAttempts ?? 3);
      setLoading(false);
    }
  }, [open]);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function handleSave() {
    setLoading(true);
    try {
      await onSave({ enabled, days, startHour, endHour, timezone, maxDailyAttempts });
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Call Schedule</DialogTitle>
          <DialogDescription>Control when outbound calls are allowed to run.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <Label htmlFor="schedule-enabled">Enabled</Label>
            <Switch id="schedule-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="space-y-2">
            <Label className="mb-1 block">Days of week</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_NAMES.map((name, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`h-9 w-9 cursor-pointer rounded-md border text-xs font-medium transition-colors ${
                    days.includes(i)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-transparent text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="start-hour">Start hour</Label>
              <Select value={String(startHour)} onValueChange={(v) => setStartHour(Number(v))}>
                <SelectTrigger id="start-hour">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {String(i).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="end-hour">End hour</Label>
              <Select value={String(endHour)} onValueChange={(v) => setEndHour(Number(v))}>
                <SelectTrigger id="end-hour">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 25 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {String(i).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="schedule-tz">Timezone</Label>
            <Input
              id="schedule-tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="UTC"
            />
          </div>

          <div className="space-y-1.5 border-t border-border pt-4">
            <Label htmlFor="max-daily-attempts">Max call attempts per record per day</Label>
            <div className="flex items-center gap-2">
              <Input
                id="max-daily-attempts"
                type="number"
                min={1}
                max={6}
                value={maxDailyAttempts}
                onChange={(e) =>
                  setMaxDailyAttempts(Math.max(1, Math.min(6, Number(e.target.value) || 1)))
                }
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">attempts / day</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Records that reach this limit are skipped for the rest of the day and retried the next.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving…" : "Save Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MANUAL_FIELDS: Array<{
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
  type?: string;
}> = [
  { key: "name", label: "Full Name", placeholder: "Jane Smith", required: true },
  { key: "mobile_number", label: "Mobile Number", placeholder: "+1 555 000 0000", required: true, type: "tel" },
  { key: "first_name", label: "First Name", placeholder: "Jane" },
  { key: "last_name", label: "Last Name", placeholder: "Smith" },
  { key: "email", label: "Email", placeholder: "jane@example.com", type: "email" },
  { key: "title", label: "Job Title", placeholder: "Sales Manager" },
  { key: "client_name", label: "Company", placeholder: "Acme Corp" },
  { key: "unique_id", label: "Unique ID", placeholder: "CRM-001" },
  { key: "property_type", label: "Property Type", placeholder: "Apartment" },
  { key: "bedrooms", label: "Bedrooms", placeholder: "3" },
  { key: "address_line1", label: "Address Line 1", placeholder: "123 Main St" },
  { key: "address_line2", label: "Address Line 2", placeholder: "Suite 4" },
  { key: "city", label: "City", placeholder: "New York" },
  { key: "state", label: "State / Region", placeholder: "NY" },
  { key: "postal_code", label: "Postal Code", placeholder: "10001" },
  { key: "lead_external_id", label: "Lead External ID", placeholder: "EXT-001" },
];

function ManualEntryDialog({
  open,
  onOpenChange,
  agents,
  defaultAgentId,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agents: Array<{ id: string; name: string; settings?: Record<string, unknown> | null }>;
  defaultAgentId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSave: (row: Record<string, any>, agentId: string) => Promise<void>;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [agentId, setAgentId] = useState("");
  const [extraRows, setExtraRows] = useState<Array<{ key: string; label: string; value: string }>>([]);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [loading, setLoading] = useState(false);

  function getAgentMeta(id: string) {
    const ag = agents.find((a) => a.id === id);
    const mappings = ((ag?.settings?.leadGen as any)?.variableMappings ?? {}) as Record<string, string>;
    return {
      fixedCols: [...new Set(Object.values(mappings).filter((v) => !v.startsWith("meta.")))],
      metaRows: Object.entries(mappings)
        .filter(([, v]) => v.startsWith("meta."))
        .map(([placeholder, colRef]) => ({
          key: colRef.slice(5),
          label: placeholder,
          value: "",
        })),
    };
  }

  useEffect(() => {
    if (open) {
      setFields({});
      setNewKey("");
      setNewVal("");
      setLoading(false);
      const id = defaultAgentId;
      setAgentId(id);
      setExtraRows(id ? getAgentMeta(id).metaRows : []);
    }
  }, [open, defaultAgentId]);

  useEffect(() => {
    if (!open) return;
    setExtraRows(agentId ? getAgentMeta(agentId).metaRows : []);
  }, [agentId]);

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function addCustomRow() {
    const k = newKey.trim();
    const v = newVal.trim();
    if (!k) return;
    setExtraRows((prev) => [...prev, { key: k, label: k, value: v }]);
    setNewKey("");
    setNewVal("");
  }

  function removeCustomRow(i: number) {
    setExtraRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function normalisePhone(raw: string): string {
    let s = raw.replace(/[\s.\-()]/g, "");
    if (s.startsWith("00")) s = "+" + s.slice(2);
    return s;
  }

  const canSave = (fields.name ?? "").trim().length > 0 && (fields.mobile_number ?? "").trim().length > 0;

  async function handleSave() {
    setLoading(true);
    try {
      const meta: Record<string, string> = {};
      for (const r of extraRows) {
        if (r.key && r.value) meta[r.key] = r.value;
      }
      const row = {
        name: fields.name?.trim() || "",
        mobile_number: normalisePhone(fields.mobile_number?.trim() || ""),
        first_name: fields.first_name?.trim() || null,
        last_name: fields.last_name?.trim() || null,
        email: fields.email?.trim() || null,
        title: fields.title?.trim() || null,
        client_name: fields.client_name?.trim() || null,
        unique_id: fields.unique_id?.trim() || null,
        property_type: fields.property_type?.trim() || null,
        bedrooms: fields.bedrooms?.trim() || null,
        address_line1: fields.address_line1?.trim() || null,
        address_line2: fields.address_line2?.trim() || null,
        city: fields.city?.trim() || null,
        state: fields.state?.trim() || null,
        postal_code: fields.postal_code?.trim() || null,
        lead_external_id: fields.lead_external_id?.trim() || null,
        ...(Object.keys(meta).length > 0 ? { meta } : {}),
      };
      await onSave(row, agentId);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Add Record Manually</DialogTitle>
          <DialogDescription>
            Enter contact details directly — no CSV required. Name and mobile number are required.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {/* Agent variable hints banner */}
          {(() => {
            if (!agentId) return null;
            const { fixedCols } = getAgentMeta(agentId);
            if (fixedCols.length === 0) return null;
            return (
              <div className="rounded-md border border-violet-200 bg-violet-50 p-2.5 dark:border-violet-800 dark:bg-violet-950/30">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                  Fields this agent uses
                </p>
                <div className="flex flex-wrap gap-1">
                  {fixedCols.map((col) => (
                    <span
                      key={col}
                      className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900 dark:text-violet-300"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Required fields */}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Required
            </p>
            {MANUAL_FIELDS.filter((f) => f.required).map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`mf-${f.key}`} className="text-xs">
                  {f.label} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id={`mf-${f.key}`}
                  type={f.type ?? "text"}
                  placeholder={f.placeholder}
                  value={fields[f.key] ?? ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            ))}
          </div>

          {/* Optional fields */}
          <div className="space-y-3 pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Optional
            </p>
            <div className="grid grid-cols-2 gap-3">
              {MANUAL_FIELDS.filter((f) => !f.required).map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`mf-${f.key}`} className="text-xs">
                    {f.label}
                  </Label>
                  <Input
                    id={`mf-${f.key}`}
                    type={f.type ?? "text"}
                    placeholder={f.placeholder}
                    value={fields[f.key] ?? ""}
                    onChange={(e) => setField(f.key, e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Custom fields */}
          <div className="space-y-2 pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Custom Fields
              <span className="ml-1 font-normal normal-case tracking-normal text-amber-500">stored in meta</span>
            </p>
            {extraRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="min-w-[120px] truncate text-xs font-medium">{row.label}</span>
                <span className="flex-1 truncate text-xs text-muted-foreground">{row.value}</span>
                <button
                  type="button"
                  onClick={() => removeCustomRow(i)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Field name</Label>
                <Input
                  placeholder="e.g. suburb"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="h-7 text-xs"
                  onKeyDown={(e) => e.key === "Enter" && addCustomRow()}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Value</Label>
                <Input
                  placeholder="e.g. Bondi"
                  value={newVal}
                  onChange={(e) => setNewVal(e.target.value)}
                  className="h-7 text-xs"
                  onKeyDown={(e) => e.key === "Enter" && addCustomRow()}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={addCustomRow}
                disabled={!newKey.trim()}
              >
                Add
              </Button>
            </div>
          </div>

          {/* Agent assignment */}
          <div className="space-y-1.5 pt-2 border-t border-border">
            <Label className="text-xs">Agent that will call this record</Label>
            <Select
              value={agentId || "__none__"}
              onValueChange={(v) => setAgentId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="No agent — assign later" />
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
        </div>

        <DialogFooter className="border-t border-border px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || loading}>
            {loading ? "Saving…" : "Add Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
