import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef } from "react";
import { Database, PhoneOutgoing, CalendarClock, UserCheck, Search, X, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { toast } from "sonner";
import {
  listDataRecords,
  importDataRecords,
  assignAgentToRecords,
  scheduleCallsForRecords,
  startCallingRecords,
} from "@/lib/dashboard/data-records.functions";
import { getCallSchedule, setCallSchedule } from "@/lib/dashboard/call-schedule.functions";
import { listLiveAgents } from "@/lib/agents/agents.functions";

export const Route = createFileRoute("/_authenticated/data")({
  head: () => ({ meta: [{ title: "Data Records — Webespoke AI" }] }),
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
  };
  return map[status ?? ""] ?? "bg-muted text-muted-foreground";
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
}: {
  records: any[];
  agents: any[];
  selected: Set<string>;
  allSelected: boolean;
  toggleAll: (v: boolean | "indeterminate") => void;
  toggleOne: (id: string) => void;
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
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="w-10 px-3 py-2">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
            </th>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Phone</th>
            {extraCols.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-2">{c.label}</th>
            ))}
            {metaKeys.map((k) => (
              <th key={`meta_${k}`} className="whitespace-nowrap px-3 py-2">
                {k}
                <span className="ml-1 text-[9px] normal-case tracking-normal text-amber-500">custom</span>
              </th>
            ))}
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Agent</th>
            <th className="px-3 py-2">Updated</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r: any) => (
            <tr key={r.id} className="border-b border-border/40 align-top">
              <td className="px-3 py-2">
                <Checkbox
                  checked={selected.has(r.id)}
                  onCheckedChange={() => toggleOne(r.id)}
                />
              </td>
              <td className="px-3 py-2 font-medium">{r.name}</td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{r.mobile_number}</td>
              {extraCols.map((c) => (
                <td key={c.key} className="px-3 py-2 text-muted-foreground">
                  {r[c.key] ?? "—"}
                </td>
              ))}
              {metaKeys.map((k) => (
                <td key={`meta_${k}`} className="px-3 py-2 text-muted-foreground">
                  {r.meta?.[k] ?? "—"}
                </td>
              ))}
              <td className="px-3 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${statusBadgeClass(r.call_status)}`}
                >
                  {(r.call_status ?? "").replace(/_/g, " ") || "—"}
                </span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {r.assigned_agent_id
                  ? (agents.find((a: any) => a.id === r.assigned_agent_id)?.name ?? "—")
                  : "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmtDate(r.updated_at)}</td>
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
  const getScheduleFn = useServerFn(getCallSchedule);
  const setScheduleFn = useServerFn(setCallSchedule);
  const listAgentsFn = useServerFn(listLiveAgents);
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
  });

  const agentsQ = useQuery({
    queryKey: ["my-agents-mini"],
    queryFn: () => listAgentsFn(),
  });

  const scheduleQ = useQuery({
    queryKey: ["call-schedule"],
    queryFn: () => getScheduleFn(),
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
          if (sysField === "__custom__" || sysField === "notes") {
            if (r[csvCol]) meta[sysField === "notes" ? "notes" : csvCol] = r[csvCol];
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
      toast.success(
        agentName
          ? `Imported ${result.inserted} records and assigned to ${agentName}`
          : `Imported ${result.inserted} records`,
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

  async function handleStartCalling(agentId: string | null, fromNumber: string | null) {
    try {
      const result = await startCallFn({
        data: {
          recordIds: Array.from(selected),
          agentId: agentId ?? undefined,
          fromNumber: fromNumber || null,
        },
      });
      toast.success(`Placed: ${result.placed}, queued: ${result.queued}, failed: ${result.failed}`);
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

  async function handleSaveSchedule(data: {
    enabled: boolean;
    days: number[];
    startHour: number;
    endHour: number;
    timezone: string;
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
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Data Records</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage calling data, import records, and control outbound campaigns
          </p>
        </div>
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
      </div>

      {showCsvImport && (
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

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(
          [
            { label: "Total", value: stats.total, icon: Database },
            { label: "Need to call", value: stats.needToCall, icon: PhoneOutgoing },
            { label: "Queued", value: stats.queued, icon: CalendarClock },
            { label: "Completed", value: stats.completed, icon: UserCheck },
          ] as const
        ).map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mb-6">
        <CardContent className="pb-4 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, phone, email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8"
              />
            </div>
            <div className="w-[160px]">
              <Select value={callStatus} onValueChange={setCallStatus}>
                <SelectTrigger className="h-9">
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
            </div>
            <div className="w-[160px]">
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All agents</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 pb-0.5">
              <Checkbox
                checked={unassignedOnly}
                onCheckedChange={(v) => {
                  setUnassignedOnly(v === true);
                  if (v) setAgentFilter("all");
                }}
              />
              <span className="text-sm text-muted-foreground">Unassigned only</span>
            </label>
          </div>
        </CardContent>
      </Card>

      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-2 px-1">
          <span className="mr-2 text-sm text-muted-foreground">{selected.size} selected</span>
          <Select onValueChange={(v) => handleBulkAssign(v === "none" ? null : v)}>
            <SelectTrigger className="h-8 w-[160px]">
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
          <Button variant="outline" size="sm" className="h-8" onClick={() => setScheduleOpen(true)}>
            <CalendarClock className="mr-1 h-3.5 w-3.5" />
            Schedule
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-8"
            onClick={() => setStartCallingOpen(true)}
          >
            <PhoneOutgoing className="mr-1 h-3.5 w-3.5" />
            Start Calling
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {recordsQ.isLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              Loading records…
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16">
              <Database className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No data records</p>
              <p className="text-xs text-muted-foreground">
                Import a CSV to get started or adjust your filters.
              </p>
            </div>
          ) : (
            <DynamicDataTable
              records={records}
              agents={agents}
              selected={selected}
              allSelected={allSelected}
              toggleAll={toggleAll}
              toggleOne={toggleOne}
            />
          )}
        </CardContent>
      </Card>

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
  const [previewSearch, setPreviewSearch] = useState("");

  useEffect(() => {
    if (open && headers.length > 0) {
      setMapping(autoDetectMapping(headers));
      setPreviewSearch("");
    }
  }, [open, headers]);

  const mappedFields = useMemo(
    () => new Set(Object.values(mapping).filter((v) => v && v !== "__custom__")),
    [mapping],
  );

  const hasName = Object.values(mapping).includes("name");
  const hasMobile = Object.values(mapping).includes("mobile_number");
  const canImport = hasName && hasMobile;

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

  const mappedPreviewCols = useMemo(() => headers, [headers]);

  function setField(csvCol: string, rawValue: string) {
    const sysField = rawValue === "__skip__" ? "" : rawValue;
    setMapping((prev) => {
      const next = { ...prev };
      // Custom fields are not exclusive — multiple CSV columns can all be custom
      if (sysField && sysField !== "__custom__") {
        for (const k of Object.keys(next)) {
          if (next[k] === sysField && k !== csvCol) next[k] = "";
        }
      }
      next[csvCol] = sysField;
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Map CSV Columns</DialogTitle>
          <DialogDescription>
            {rows.length} rows detected · Match each CSV column to a system field, then preview and
            import.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 divide-x divide-border overflow-hidden">
            {/* Left: column mapping */}
            <div className="flex w-[340px] shrink-0 flex-col overflow-hidden">
              <div className="border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Column Mapping
              </div>
              <div className="flex-1 overflow-y-auto">
                {headers.map((h) => {
                  const selected = mapping[h] ?? "";
                  const fieldMeta = SYSTEM_FIELDS.find((f) => f.value === selected);
                  return (
                    <div
                      key={h}
                      className="flex items-center gap-3 border-b border-border/40 px-4 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium" title={h}>
                          {h}
                        </p>
                        {selected && (
                          <p className="text-[10px] text-muted-foreground">
                            → {fieldMeta?.label ?? selected}
                            {fieldMeta?.required && (
                              <span className="ml-1 text-primary">*</span>
                            )}
                          </p>
                        )}
                      </div>
                      <Select value={selected || "__skip__"} onValueChange={(v) => setField(h, v)}>
                        <SelectTrigger className="h-7 w-[140px] text-xs">
                          <SelectValue placeholder="Skip" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__skip__">Skip</SelectItem>
                          {SYSTEM_FIELDS.map((f) => (
                            <SelectItem
                              key={f.value}
                              value={f.value}
                              disabled={mappedFields.has(f.value) && mapping[h] !== f.value}
                            >
                              {f.label}
                              {f.required ? " *" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                        {mappedPreviewCols.map((h) => {
                          const sysField = mapping[h];
                          const isCustom = sysField === "__custom__";
                          const isMapped = Boolean(sysField);
                          const f = SYSTEM_FIELDS.find((x) => x.value === sysField);
                          return (
                            <th
                              key={h}
                              className="whitespace-nowrap px-3 py-2 font-semibold"
                            >
                              <div className="text-[11px] text-foreground/80">{h}</div>
                              <div className="text-[10px] font-normal">
                                {isCustom ? (
                                  <span className="text-amber-500">custom field</span>
                                ) : isMapped ? (
                                  <span className="text-primary">
                                    → {f?.label ?? sysField}
                                    {f?.required && " *"}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/50">not mapped</span>
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
                          {mappedPreviewCols.map((h) => (
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
                {rows.length} row{rows.length !== 1 ? "s" : ""} ready to import
              </span>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button
            onClick={() => onImport(mapping, rows)}
            disabled={!canImport || importing}
          >
            {importing ? "Importing…" : `Import ${rows.length} row${rows.length !== 1 ? "s" : ""}`}
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
  onStart,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recordCount: number;
  agents: Array<{ id: string; name: string }>;
  onStart: (agentId: string | null, fromNumber: string | null) => Promise<void>;
}) {
  const [agentId, setAgentId] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setAgentId("");
      setFromNumber("");
      setLoading(false);
    }
  }, [open]);

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
            <Select value={agentId} onValueChange={setAgentId}>
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
  }) => Promise<void>;
}) {
  const existing = scheduleData?.schedule as
    | { enabled?: boolean; days?: number[]; startHour?: number; endHour?: number }
    | null
    | undefined;

  const [enabled, setEnabled] = useState(true);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(17);
  const [timezone, setTimezone] = useState("UTC");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setEnabled(existing?.enabled ?? true);
      setDays(existing?.days ?? [1, 2, 3, 4, 5]);
      setStartHour(existing?.startHour ?? 9);
      setEndHour(existing?.endHour ?? 17);
      setTimezone(scheduleData?.timezone ?? "UTC");
      setLoading(false);
    }
  }, [open]);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function handleSave() {
    setLoading(true);
    try {
      await onSave({ enabled, days, startHour, endHour, timezone });
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
