import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Download, Upload, Search, Users, RefreshCw, Loader2, FolderOpen } from "lucide-react";
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { listWAContacts, createWAContact, updateWAContact, deleteWAContact } from "@/lib/dashboard/whatsapp.functions";
import { listContactDocsByPhone } from "@/lib/dashboard/documents.functions";
import { ContactDocumentsPanel } from "@/components/contacts/ContactDocumentsPanel";
import { getWatiConnection, syncWatiContacts } from "@/lib/whatsapp/wati.functions";
import { toast } from "sonner";

const STATUSES = ["new", "contacted", "qualified", "closed", "lost"];
const SOURCES  = ["manual", "import", "webhook", "campaign", "referral", "wati"];

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
  const [form, setForm]         = useState(emptyForm());
  const [docsContact, setDocsContact] = useState<any>(null);

  const filtered = (contacts as any[]).filter((c) =>
    (c.name ?? c.phone).toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search),
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

  function exportCsv() {
    const header = "name,phone,tags,source,lead_status,notes";
    const rows = (contacts as any[]).map((c) =>
      [c.name, c.phone, (c.tags ?? []).join("|"), c.source, c.lead_status, c.notes]
        .map((v) => `"${(v ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "whatsapp-contacts.csv";
    a.click();
  }

  async function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split("\n").slice(1).filter(Boolean);
    let created = 0;
    for (const line of lines) {
      const cols = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
      const [name, phone] = cols;
      if (!phone) continue;
      try {
        await createFn({ data: { name: name || undefined, phone } });
        created++;
      } catch {}
    }
    qc.invalidateQueries({ queryKey: ["wa-contacts"] });
    toast.success(`Imported ${created} contacts`);
    e.target.value = "";
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
          <label>
            <input type="file" accept=".csv" className="hidden" onChange={importCsv} />
            <Button variant="outline" size="sm" className="gap-1.5 cursor-pointer" asChild>
              <span><Upload className="h-3.5 w-3.5" /> Import CSV</span>
            </Button>
          </label>
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
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                {["Name", "Phone", "Tags", "Source", "Status", "Created", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((c: any) => (
                <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-medium">{c.name ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">{c.phone}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(c.tags ?? []).map((tag: string) => (
                        <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.source ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {c.lead_status ? (
                      <Badge variant="outline" className="text-[10px]">{c.lead_status}</Badge>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-muted-foreground">
                    <RelativeTime date={c.created_at} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1 justify-end">
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
              ))}
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
    </div>
  );
}
