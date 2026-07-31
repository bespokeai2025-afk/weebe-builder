import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Download, Upload, Search, Users, RefreshCw, Loader2, FolderOpen, FileSpreadsheet, Eye } from "lucide-react";
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
  listWAContacts,
  createWAContact,
  updateWAContact,
  deleteWAContact,
  deleteAllWAContacts,
  importWAContactsCsv,
} from "@/lib/dashboard/whatsapp.functions";
import {
  autoDetectCsvColumnMapping,
  mapCsvRowsToLeads,
  parseCsvText,
  sliceCsvTextForParse,
  getContactField,
  getContactFieldsMap,
  getContactPhones,
  getContactDetailFields,
  type CsvColumnMapping,
} from "@/lib/whatsapp/csv-leads.shared";
import { listContactDocsByPhone } from "@/lib/dashboard/documents.functions";
import { ContactDocumentsPanel } from "@/components/contacts/ContactDocumentsPanel";
import { getWatiConnection, syncWatiContacts } from "@/lib/whatsapp/wati.functions";
import { toast } from "sonner";

const STATUSES = ["new", "contacted", "qualified", "closed", "lost"];
const SOURCES  = ["manual", "import", "webhook", "campaign", "referral", "wati"];

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
  const csvInputRef   = useRef<HTMLInputElement>(null);
  const watiConnFn    = useServerFn(getWatiConnection);
  const watiSyncFn    = useServerFn(syncWatiContacts);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["wa-contacts"],
    queryFn: () => listFn(),
    throwOnError: false,
  });

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

  const filtered = (contacts as any[]).filter((c) =>
    contactSearchHaystack(c).includes(search.toLowerCase()),
  );

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

  function exportCsv() {
    const header =
      "name,phone,mobile_1,mobile_2,phone_1,phone_2,master_project,building,property_type,unit,location,date,amount,beds,size,tags,source,lead_status";
    const rows = (contacts as any[]).map((c) => {
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
      const rawText = await file.text();
      const scanRows = Math.max(limit * 100, 2000);
      const text = sliceCsvTextForParse(rawText, scanRows);
      const { headers, rows, truncated } = parseCsvText(text);
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
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search contacts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {watiConnected && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-purple-500/30 text-purple-400 hover:text-purple-300"
              disabled={syncFromWati.isPending}
              onClick={() => syncFromWati.mutate()}
            >
              {syncFromWati.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              Import from WATI
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
          {(contacts as any[]).length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => setClearAllOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear all
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              resetCsvImportState();
              setImportOpen(true);
            }}
          >
            <Upload className="h-3.5 w-3.5" /> Import CSV
          </Button>
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add Contact
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Users className="h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">No contacts yet</p>
          <p className="text-xs">Add contacts manually or import a CSV file.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[1400px]">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                {[
                  "Name",
                  "Phones",
                  "Master Project",
                  "Building",
                  "Property",
                  "Unit",
                  "Location",
                  "Date",
                  "Amount",
                  "Beds",
                  "Size",
                  "Tags",
                  "Source",
                  "Status",
                  "Created",
                  "",
                ].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((c: any) => {
                const phones = getContactPhones(c);
                const project = getContactField(c, "Master Project", "Project");
                const building = getContactField(c, "Building", "BuildingName 2", "Building 1");
                const property = getContactField(c, "Property Type", "Sub Type", "Usage");
                const unit = getContactField(c, "UnitNumber", "property_number");
                const location = getContactField(c, "Master Location");
                const date = getContactField(c, "Date");
                const amount = getContactField(c, "Transaction Amount");
                const beds = getContactField(c, "beds");
                const size = getContactField(c, "Size");
                const extraCount = getContactDetailFields(c).length;

                return (
                <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2.5 font-medium max-w-[140px] truncate">{c.name ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2.5 text-muted-foreground max-w-[130px]">
                    <div className="flex flex-col gap-0.5">
                      {phones.length > 0 ? phones.map(({ label, phone }) => (
                        <div key={`${label}-${phone}`} className="text-[11px] font-mono leading-tight" title={`${label}: ${phone}`}>
                          <span className="text-muted-foreground/70">{label}: </span>{phone}
                        </div>
                      )) : (
                        <span className="text-xs font-mono">{c.phone ?? "—"}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs max-w-[120px] truncate" title={project ?? undefined}>{project ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs max-w-[140px] truncate" title={building ?? undefined}>{building ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs max-w-[100px] truncate" title={property ?? undefined}>{property ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs max-w-[80px] truncate" title={unit ?? undefined}>{unit ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs max-w-[120px] truncate" title={location ?? undefined}>{location ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{date ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{amount ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{beds ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{size ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(c.tags ?? []).map((tag: string) => (
                        <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{c.source ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    {c.lead_status ? (
                      <Badge variant="outline" className="text-[10px]">{c.lead_status}</Badge>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
                    <RelativeTime date={c.created_at} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title={`View all ${extraCount} fields`} onClick={() => setDetailContact(c)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
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

      <Dialog open={!!detailContact} onOpenChange={(o) => !o && setDetailContact(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              {detailContact?.name ?? detailContact?.phone ?? "Contact details"}
            </DialogTitle>
          </DialogHeader>
          {detailContact && (
            <div className="grid grid-cols-[minmax(0,34%)_1fr] gap-x-4 gap-y-1.5 text-sm py-1 border rounded-md p-3 bg-muted/20">
              {getContactDetailFields(detailContact).map(({ label, value }) => (
                <div key={`${label}-${value}`} className="contents">
                  <div className="text-xs font-medium text-muted-foreground py-1">{label}</div>
                  <div className="text-xs py-1 wrap-break-word">{value}</div>
                </div>
              ))}
              {getContactDetailFields(detailContact).length === 0 && (
                <p className="col-span-2 text-xs text-muted-foreground py-2">
                  No extra fields stored. Re-import your CSV to capture all property columns.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailContact(null)}>Close</Button>
            {detailContact && (
              <Button onClick={() => { openEdit(detailContact); setDetailContact(null); }}>
                Edit contact
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              This permanently deletes all {(contacts as any[]).length} Buzzchat contacts in this
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
              Supports property files (JVC): maps <strong>Owner Name</strong> → name, saves{" "}
              <strong>Mobile 1, Mobile 2, Phone 1, Phone 2</strong> and all other columns.
              Turn off Buyers only for JVC owner registry files. Re-import to refresh phone numbers.
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
