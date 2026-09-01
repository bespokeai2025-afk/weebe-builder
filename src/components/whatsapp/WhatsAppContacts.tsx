import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Download, Upload, Search, Users, RefreshCw, Loader2, FolderOpen, FileSpreadsheet, ChevronDown, CheckCircle2, MessageCircle, Circle, Ban, Copy, X, Phone, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BuzzchatEmptyState } from "@/components/whatsapp/buzzchat-ui";
import {
  listWAContacts,
  createWAContact,
  updateWAContact,
  deleteWAContact,
  deleteAllWAContacts,
  importWAContactsCsv,
  exportBuzzchatContactsCsv,
  backfillWhatsappContactedStatus,
} from "@/lib/dashboard/whatsapp.functions";
import {
  autoDetectCsvColumnMapping,
  mapCsvRowsToLeads,
  parseCsvText,
  readCsvFileHead,
  getContactField,
  getContactFieldsMap,
  getContactPhones,
  getContactPropertySummary,
  getContactRequirementLabel,
  groupContactDetailFields,
  type CsvColumnMapping,
} from "@/lib/whatsapp/csv-leads.shared";
import { listContactDocsByPhone } from "@/lib/dashboard/documents.functions";
import { ContactDocumentsPanel } from "@/components/contacts/ContactDocumentsPanel";
import { getWatiConnection, syncWatiContacts } from "@/lib/whatsapp/wati.functions";
import { toast } from "sonner";

const STATUSES = ["new", "contacted", "qualified", "closed", "lost"];
const SOURCES  = ["manual", "import", "webhook", "campaign", "referral", "wati"];
type MessagedFilter = "all" | "messaged" | "not_messaged" | "replied" | "dnc";

type WaContactRow = {
  id: string;
  name?: string | null;
  phone: string;
  tags?: string[];
  source?: string | null;
  lead_status?: string | null;
  notes?: string | null;
  created_at?: string;
  do_not_contact?: boolean;
  import_meta?: Record<string, unknown> | null;
  wa_stats?: {
    outbound_count: number;
    inbound_count: number;
    total_count: number;
    last_outbound_at: string | null;
    last_inbound_at: string | null;
    last_message_at: string | null;
    messaged: boolean;
    last_outbound_status?: string | null;
    last_campaign_name?: string | null;
    delivered_count?: number;
    read_count?: number;
    failed_count?: number;
  };
};

function outboundStatusBadgeClass(status: string | null | undefined): string {
  const s = String(status ?? "").toLowerCase();
  if (s.includes("read")) return "text-blue-400 border-blue-500/30";
  if (s.includes("deliver")) return "text-emerald-400 border-emerald-500/30";
  if (s.includes("fail")) return "text-destructive border-destructive/30";
  return "text-muted-foreground border-border";
}

function contactSearchHaystack(c: any): string {
  const parts = [
    c.name,
    c.phone,
    c.notes,
    ...(c.tags ?? []),
    c.source,
    c.lead_status,
    ...Object.values(getContactFieldsMap(c)),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function emptyForm() {
  return { name: "", phone: "", tags: "", source: "", lead_status: "", notes: "" };
}

function copyText(value: string, label = "Copied") {
  void navigator.clipboard.writeText(value).then(() => toast.success(label));
}

function ContactPersonPane({
  contact,
  onClose,
  onEdit,
  onDocs,
}: {
  contact: WaContactRow | null;
  onClose: () => void;
  onEdit: () => void;
  onDocs: () => void;
}) {
  if (!contact) {
    return (
      <aside className="hidden h-full min-h-0 w-full flex-col border-l border-white/[0.06] bg-muted/20 lg:flex">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <User className="h-9 w-9 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">Select a contact</p>
          <p className="text-xs text-muted-foreground">
            Owner, property, and requirement details open here.
          </p>
        </div>
      </aside>
    );
  }

  const grouped = groupContactDetailFields(contact);
  const req = getContactRequirementLabel(contact);
  const stats = contact.wa_stats;
  const phones = getContactPhones(contact);
  const waDigits = (contact.phone ?? "").replace(/\D/g, "");

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-white/[0.06] bg-muted/20">
      <div className="flex items-start gap-3 border-b border-white/[0.06] bg-card/80 px-4 py-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
          {(contact.name ?? contact.phone).slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold leading-tight">
                {contact.name || "Unnamed"}
              </p>
              <button
                type="button"
                className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => copyText(contact.phone, "Number copied")}
              >
                <Phone className="h-3 w-3" />
                {contact.phone}
                <Copy className="h-3 w-3 opacity-50" />
              </button>
              {phones.slice(1).map((p) => (
                <button
                  key={`${p.label}-${p.phone}`}
                  type="button"
                  className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => copyText(p.phone, "Number copied")}
                >
                  {p.label}: {p.phone}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={onClose}
              aria-label="Close contact"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {contact.do_not_contact ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
                <Ban className="h-2.5 w-2.5" /> DNC
              </span>
            ) : null}
            {contact.lead_status ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                {contact.lead_status}
              </span>
            ) : null}
            {req ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {req}
              </span>
            ) : null}
            {contact.source ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {contact.source}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {stats ? (
          <section>
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-white/[0.06] bg-card/80 p-3 text-xs">
              <span className="text-muted-foreground">Sent</span>
              <span>{stats.messaged ? `${stats.outbound_count} messages` : "Not yet"}</span>
              <span className="text-muted-foreground">Replies</span>
              <span>{stats.inbound_count || "—"}</span>
              <span className="text-muted-foreground">Last status</span>
              <span>{stats.last_outbound_status ?? "—"}</span>
              <span className="text-muted-foreground">Last campaign</span>
              <span className="truncate">{stats.last_campaign_name ?? "—"}</span>
              <span className="text-muted-foreground">Last sent</span>
              <span>
                {stats.last_outbound_at
                  ? new Date(stats.last_outbound_at).toLocaleString()
                  : "—"}
              </span>
              <span className="text-muted-foreground">Last reply</span>
              <span>
                {stats.last_inbound_at
                  ? new Date(stats.last_inbound_at).toLocaleString()
                  : "—"}
              </span>
            </div>
          </section>
        ) : null}

        {grouped.map((group) => (
          <section key={group.title}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </p>
            <dl className="grid grid-cols-[minmax(0,38%)_1fr] gap-x-3 gap-y-1.5 rounded-lg border border-white/[0.06] bg-card/80 p-3 text-xs">
              {group.fields.map(({ label, value }) => (
                <div key={`${label}-${value}`} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="wrap-break-word font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        {grouped.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No extra fields stored. Re-import the CSV to capture property columns.
          </p>
        )}

        {(contact.tags ?? []).length > 0 && (
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tags
            </p>
            <div className="flex flex-wrap gap-1">
              {(contact.tags ?? []).map((t) => (
                <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}

        {contact.notes ? (
          <p className="text-xs text-muted-foreground">{contact.notes}</p>
        ) : null}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-white/[0.06] bg-card/80 p-3">
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Edit
        </Button>
        <Button size="sm" variant="outline" onClick={onDocs}>
          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
          Documents
        </Button>
        {waDigits ? (
          <Button size="sm" variant="outline" className="col-span-2" asChild>
            <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer">
              <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
              Open WhatsApp
            </a>
          </Button>
        ) : null}
      </div>
    </aside>
  );
}

/** Resolves the data_records contact by WA phone, then shows the documents panel */
function WADocsDialog({
  contact,
  onClose,
}: {
  contact: { name?: string | null; phone: string } | null;
  onClose: () => void;
}) {
  const docsByPhoneFn = useServerFn(listContactDocsByPhone);
  const docsQ = useQuery({
    queryKey: ["wa-docs-phone", contact?.phone],
    queryFn: () => docsByPhoneFn({ data: { phone: contact!.phone } }),
    enabled: !!contact?.phone,
    staleTime: 0,
    throwOnError: false,
  });
  const info = docsQ.data as { docs: any[]; contactId: string | null; uploadToken: string | null } | undefined;

  return (
    <Dialog open={!!contact} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-blue-400" />
            Documents — {contact?.name ?? contact?.phone}
          </DialogTitle>
        </DialogHeader>
        {docsQ.isLoading ? (
          <div className="flex items-center gap-2 py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : info?.contactId ? (
          <ContactDocumentsPanel
            contactId={info.contactId}
            contactName={contact?.name}
            uploadToken={info.uploadToken}
          />
        ) : (
          <p className="text-sm text-muted-foreground py-4">
            No CRM contact found for {contact?.phone}. Import this number as a contact first to enable documents.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WhatsAppContacts() {
  const qc = useQueryClient();
  const listFn        = useServerFn(listWAContacts);
  const createFn      = useServerFn(createWAContact);
  const updateFn      = useServerFn(updateWAContact);
  const deleteFn      = useServerFn(deleteWAContact);
  const deleteAllFn   = useServerFn(deleteAllWAContacts);
  const importCsvFn   = useServerFn(importWAContactsCsv);
  const exportBuzzchatFn = useServerFn(exportBuzzchatContactsCsv);
  const backfillFn    = useServerFn(backfillWhatsappContactedStatus);
  const csvInputRef   = useRef<HTMLInputElement>(null);
  const watiConnFn    = useServerFn(getWatiConnection);
  const watiSyncFn    = useServerFn(syncWatiContacts);

  const { data: contactsPayload, isLoading } = useQuery({
    queryKey: ["wa-contacts"],
    queryFn: () => listFn(),
    throwOnError: false,
  });
  const contacts = (contactsPayload?.contacts ?? []) as WaContactRow[];
  const summary = contactsPayload?.summary ?? {
    total: contacts.length,
    messaged: 0,
    replied: 0,
    not_messaged: contacts.length,
    dnc: 0,
  };

  const { data: watiConn } = useQuery({
    queryKey: ["wati-connection"],
    queryFn: () => watiConnFn(),
    throwOnError: false,
  });
  const watiConnected = !!watiConn && watiConn.status === "connected";

  const syncFromWati = useMutation({
    mutationFn: () => watiSyncFn(),
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["wa-contacts"] });
      toast.success(`Synced ${d.count} contacts from WATI`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [search, setSearch]     = useState("");
  const [messagedFilter, setMessagedFilter] = useState<MessagedFilter>("all");
  const [open, setOpen]         = useState(false);
  const [editRow, setEditRow]   = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [form, setForm]         = useState(emptyForm());
  const [docsContact, setDocsContact] = useState<any>(null);
  const [detailContact, setDetailContact] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [csvParsing, setCsvParsing] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportLimit, setCsvImportLimit] = useState(20);
  const [csvBuyersOnly, setCsvBuyersOnly] = useState(true);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvMapping, setCsvMapping] = useState<CsvColumnMapping | null>(null);
  const [csvNeedsMapping, setCsvNeedsMapping] = useState(false);

  const filtered = contacts.filter((c) => {
    if (!contactSearchHaystack(c).includes(search.toLowerCase())) return false;
    const stats = c.wa_stats;
    if (messagedFilter === "messaged") return !!stats?.messaged;
    if (messagedFilter === "not_messaged") return !stats?.messaged;
    if (messagedFilter === "replied") return (stats?.inbound_count ?? 0) > 0;
    if (messagedFilter === "dnc") return !!c.do_not_contact;
    return true;
  });

  function openCreate() {
    setEditRow(null);
    setForm(emptyForm());
    setOpen(true);
  }
  function openEdit(c: any) {
    setEditRow(c);
    setForm({
      name: c.name ?? "", phone: c.phone ?? "",
      tags: (c.tags ?? []).join(", "),
      source: c.source ?? "", lead_status: c.lead_status ?? "", notes: c.notes ?? "",
    });
    setOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name || undefined,
        phone: form.phone,
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        source: form.source || undefined,
        lead_status: form.lead_status || undefined,
        notes: form.notes || undefined,
      };
      if (editRow) {
        await updateFn({ data: { id: editRow.id, ...payload } });
      } else {
        await createFn({ data: payload });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-contacts"] });
      setOpen(false);
      toast.success(editRow ? "Contact updated" : "Contact created");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: () => deleteFn({ data: { id: deleteId! } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-contacts"] });
      if (detailContact?.id === deleteId) setDetailContact(null);
      setDeleteId(null);
      toast.success("Contact deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const clearAll = useMutation({
    mutationFn: () => deleteAllFn(),
    onSuccess: (res: { deleted?: number }) => {
      qc.invalidateQueries({ queryKey: ["wa-contacts"] });
      setClearAllOpen(false);
      toast.success(`Removed ${res.deleted ?? 0} contact(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function exportBuzzchat(filter: "all" | "messaged" | "not_messaged" | "replied" | "dnc") {
    try {
      const result = await exportBuzzchatFn({ data: { filter } });
      const blob = new Blob([result.csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `buzzchat-contacts-${filter}.csv`;
      a.click();
      toast.success(`Exported ${result.count} contact(s)`);
    } catch (err) {
      toast.error("Export failed", { description: (err as Error).message });
    }
  }

  const backfillContacted = useMutation({
    mutationFn: () => backfillFn(),
    onSuccess: (res: { updated?: number }) => {
      qc.invalidateQueries({ queryKey: ["wa-contacts"] });
      toast.success(`Backfilled ${res.updated ?? 0} contacted status(es)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function exportCsv() {
    const header =
      "name,phone,mobile_1,mobile_2,phone_1,phone_2,master_project,building,property_type,unit,location,date,amount,beds,size,tags,source,lead_status";
    const rows = contacts.map((c) => {
      const phones = getContactPhones(c);
      const byLabel = Object.fromEntries(phones.map((p) => [p.label, p.phone]));
      const values = [
        c.name,
        c.phone,
        byLabel["Mobile 1"] ?? "",
        byLabel["Mobile 2"] ?? "",
        byLabel["Phone 1"] ?? "",
        byLabel["Phone 2"] ?? "",
        getContactField(c, "Master Project", "Project"),
        getContactField(c, "Building", "BuildingName 2", "Building 1"),
        getContactField(c, "Property Type", "Sub Type"),
        getContactField(c, "UnitNumber", "property_number"),
        getContactField(c, "Master Location"),
        getContactField(c, "Date"),
        getContactField(c, "Transaction Amount"),
        getContactField(c, "beds"),
        getContactField(c, "Size"),
        (c.tags ?? []).join("|"),
        c.source,
        c.lead_status,
      ];
      return values
        .map((v) => `"${(v ?? "").replace(/"/g, '""')}"`)
        .join(",");
    });
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "whatsapp-contacts.csv";
    a.click();
  }

  async function runContactsCsvImport(
    rows: Record<string, string>[],
    mapping: CsvColumnMapping,
  ) {
    const leads = mapCsvRowsToLeads(rows, mapping, {
      maxLeads: Math.max(1, Math.min(csvImportLimit, 5000)),
      buyersOnly: csvBuyersOnly,
    });
    if (leads.length === 0) {
      toast.error("No valid phone numbers found", {
        description: "Use Mobile column · enable Buyers only for JVC property files",
      });
      return;
    }
    setCsvImporting(true);
    try {
      const result = await importCsvFn({ data: { rows: leads } });
      qc.invalidateQueries({ queryKey: ["wa-contacts"] });
      qc.invalidateQueries({ queryKey: ["campaign-leads"] });
      toast.success(`Imported ${result.total} contact(s)`, {
        description: `${result.inserted} new · ${result.updated} updated`,
      });
      setImportOpen(false);
      resetCsvImportState();
    } catch (err) {
      toast.error("Import failed", { description: (err as Error).message });
    } finally {
      setCsvImporting(false);
    }
  }

  function resetCsvImportState() {
    setCsvFileName(null);
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvMapping(null);
    setCsvNeedsMapping(false);
    if (csvInputRef.current) csvInputRef.current.value = "";
  }

  async function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvParsing(true);
    const limit = Math.max(1, Math.min(csvImportLimit, 5000));
    try {
      const scanRows = Math.max(limit * 100, 2000);
      const { text, truncated } = await readCsvFileHead(file, scanRows);
      const { headers, rows } = parseCsvText(text);
      const mapping = autoDetectCsvColumnMapping(headers);
      setCsvHeaders(headers);
      setCsvRows(rows);
      setCsvMapping(
        mapping ?? {
          phone: headers.find((h) => h.toLowerCase().includes("mobile")) ?? headers[0] ?? "",
        },
      );
      setCsvNeedsMapping(!mapping);
      setCsvFileName(file.name);
      if (truncated) {
        toast.message(`Large file — scanned first ${scanRows.toLocaleString()} rows`);
      }
      if (mapping) {
        await runContactsCsvImport(rows, mapping);
      }
    } catch (err) {
      toast.error("Could not parse CSV", { description: (err as Error).message });
      resetCsvImportState();
    } finally {
      setCsvParsing(false);
    }
    if (csvInputRef.current) csvInputRef.current.value = "";
  }

  async function applyCsvMapping() {
    if (!csvMapping?.phone || csvRows.length === 0) return;
    await runContactsCsvImport(csvRows, csvMapping);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, phone, building, project…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-8 text-sm"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Export
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => exportBuzzchat("all")}>All contacts</DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportBuzzchat("messaged")}>Messaged</DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportBuzzchat("not_messaged")}>Not sent</DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportBuzzchat("replied")}>Replied</DropdownMenuItem>
            <DropdownMenuItem onClick={exportCsv}>Property CSV</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {watiConnected && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            disabled={syncFromWati.isPending}
            onClick={() => syncFromWati.mutate()}
          >
            {syncFromWati.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            From WATI
          </Button>
        )}
        {contacts.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 text-destructive hover:text-destructive"
            onClick={() => setClearAllOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => {
            resetCsvImportState();
            setImportOpen(true);
          }}
        >
          <Upload className="h-3.5 w-3.5" /> Import CSV
        </Button>
        <Button size="sm" className="h-9 gap-1.5" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-white/[0.06] bg-card/60 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <div className={cn("flex min-h-0 flex-col", detailContact && "hidden lg:flex")}>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 overflow-x-auto border-b border-border bg-muted/20 px-3 py-2">
            <div className="inline-flex h-8 items-center rounded-lg bg-muted p-1 text-muted-foreground">
              {(
                [
                  ["all", "All", summary.total],
                  ["not_messaged", "Not sent", summary.not_messaged],
                  ["messaged", "Sent", summary.messaged],
                  ["replied", "Replied", summary.replied],
                  ["dnc", "DNC", summary.dnc ?? 0],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMessagedFilter(id)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    messagedFilter === id
                      ? "bg-background text-foreground shadow"
                      : "hover:text-foreground",
                  )}
                >
                  {label}
                  <span className="tabular-nums opacity-70">{count}</span>
                </button>
              ))}
            </div>
            {filtered.length > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">
                {filtered.length} shown
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <BuzzchatEmptyState
              icon={Users}
              title={search || messagedFilter !== "all" ? "Nothing matches" : "No contacts yet"}
              description={
                search || messagedFilter !== "all"
                  ? "Try a different search or show All contacts."
                  : "Import a CSV or add a contact before you send a campaign."
              }
              action={
                search || messagedFilter !== "all" ? undefined : (
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="h-3.5 w-3.5" />
                    Add contact
                  </Button>
                )
              }
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 border-b border-white/[0.06] bg-muted/50">
                  <tr>
                    {["Owner", "Property", "Requirement", "WhatsApp", "Status", "Last contact", ""].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {filtered.map((c) => {
                    const stats = c.wa_stats;
                    const phones = getContactPhones(c);
                    const property = getContactPropertySummary(c);
                    const requirement = getContactRequirementLabel(c);
                    const lastAt = stats?.last_inbound_at || stats?.last_outbound_at;
                    const selected = detailContact?.id === c.id;
                    return (
                      <tr
                        key={c.id}
                        className={cn(
                          "cursor-pointer transition-colors hover:bg-muted/30",
                          selected && "bg-primary/5",
                        )}
                        onClick={() => setDetailContact(c)}
                      >
                    <td className="px-4 py-3">
                      <p className="font-medium leading-tight">{c.name || "—"}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {phones[0]?.phone ?? c.phone}
                      </p>
                      {phones.length > 1 && (
                        <p className="text-[10px] text-muted-foreground">+{phones.length - 1} more</p>
                      )}
                    </td>
                    <td className="max-w-[240px] px-4 py-3 text-xs leading-snug text-muted-foreground">
                      {property || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {requirement || "—"}
                      {(c.tags ?? []).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(c.tags ?? []).slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="secondary" className="px-1.5 py-0 text-[10px]">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {stats?.messaged ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                        ) : (
                          <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                        )}
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {stats?.outbound_count ?? 0} sent
                        </span>
                        {(stats?.inbound_count ?? 0) > 0 && (
                          <Badge variant="outline" className="border-emerald-500/30 px-1.5 text-[10px] text-emerald-500">
                            {stats?.inbound_count} replied
                          </Badge>
                        )}
                      </div>
                      {stats?.last_outbound_status && (
                        <p className={`mt-0.5 text-[10px] ${outboundStatusBadgeClass(stats.last_outbound_status)}`}>
                          {stats.last_outbound_status}
                          {stats.last_campaign_name ? ` · ${stats.last_campaign_name}` : ""}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {c.do_not_contact && (
                          <Badge variant="destructive" className="gap-0.5 text-[10px]">
                            <Ban className="h-2.5 w-2.5" /> DNC
                          </Badge>
                        )}
                        {c.lead_status ? (
                          <Badge variant="outline" className="text-[10px] capitalize">{c.lead_status}</Badge>
                        ) : !c.do_not_contact ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {lastAt ? <RelativeTime date={lastAt} /> : "—"}
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Documents" onClick={() => setDocsContact(c)}>
                          <FolderOpen className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(c.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
            </div>
          )}
        </div>

        <div className={cn("h-full min-h-0", detailContact ? "flex" : "hidden lg:flex")}>
          <ContactPersonPane
            contact={
              (detailContact
                ? contacts.find((c) => c.id === detailContact.id) ?? detailContact
                : null)
            }
            onClose={() => setDetailContact(null)}
            onEdit={() => {
              if (detailContact) openEdit(detailContact);
            }}
            onDocs={() => {
              if (detailContact) setDocsContact(detailContact);
            }}
          />
        </div>
      </div>

      {/* Create/Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editRow ? "Edit Contact" : "New Contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Phone *</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+447700000000" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tags (comma-separated)</Label>
              <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="lead, vip, uk" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Source</Label>
                <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={form.lead_status} onValueChange={(v) => setForm({ ...form, lead_status: v })}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Any notes…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!form.phone || save.isPending}>
              {save.isPending ? "Saving…" : editRow ? "Save Changes" : "Create Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Documents dialog — looks up data_records by phone */}
      <WADocsDialog contact={docsContact} onClose={() => setDocsContact(null)} />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove all contacts?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes all {contacts.length} Buzzchat contacts in this
              workspace. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearAll.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                clearAll.mutate();
              }}
              disabled={clearAll.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {clearAll.isPending ? "Removing…" : "Remove all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={importOpen}
        onOpenChange={(o) => {
          setImportOpen(o);
          if (!o) resetCsvImportState();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import contacts from CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">
              Same columns as campaign CSV: <strong>Owner Name</strong> → name,{" "}
              <strong>Mobile 1 / 2, Phone 1 / 2</strong> → WhatsApp numbers, plus Project, Building,
              Requirement (Sell / Rent / Both), Asking Price, Rental Price, and Tags. Turn off Buyers
              only for JVC owner registry files. Re-import to refresh numbers and property fields.
            </p>
            <div>
              <Label className="text-xs">Max contacts</Label>
              <Input
                type="number"
                min={1}
                max={5000}
                value={csvImportLimit}
                onChange={(e) =>
                  setCsvImportLimit(Math.max(1, parseInt(e.target.value, 10) || 20))
                }
                className="mt-1 h-8 text-xs"
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={csvBuyersOnly}
                onCheckedChange={(v) => setCsvBuyersOnly(v === true)}
              />
              Buyers only (recommended for JVC transaction files)
            </label>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleCsvFile}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full gap-1.5"
              disabled={csvParsing || csvImporting}
              onClick={() => csvInputRef.current?.click()}
            >
              {csvParsing || csvImporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-3.5 w-3.5" />
              )}
              {csvParsing
                ? "Parsing…"
                : csvImporting
                  ? "Importing…"
                  : csvFileName
                    ? csvFileName
                    : "Choose CSV file"}
            </Button>
            {csvNeedsMapping && csvMapping && csvRows.length > 0 && (
              <div className="space-y-2 rounded border border-border/40 p-2">
                <Label className="text-xs">Phone column</Label>
                <Select
                  value={csvMapping.phone}
                  onValueChange={(v) => setCsvMapping({ ...csvMapping, phone: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Mobile" />
                  </SelectTrigger>
                  <SelectContent>
                    {csvHeaders.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="w-full h-8 text-xs"
                  disabled={csvImporting || !csvMapping.phone}
                  onClick={applyCsvMapping}
                >
                  Import up to {csvImportLimit} contacts
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
