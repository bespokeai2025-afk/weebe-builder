import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, FileText, Variable, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  listWATemplates, createWATemplate, updateWATemplate, deleteWATemplate,
} from "@/lib/dashboard/whatsapp.functions";
import { getWatiConnection, listWatiTemplates, syncWatiTemplates } from "@/lib/whatsapp/wati.functions";
import { toast } from "sonner";

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"];

function emptyForm() {
  return { name: "", body: "", variables: "", category: "MARKETING" };
}

function extractVars(body: string): string[] {
  const matches = body.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, "")))];
}

export function WhatsAppTemplates() {
  const qc = useQueryClient();
  const listFn        = useServerFn(listWATemplates);
  const createFn      = useServerFn(createWATemplate);
  const updateFn      = useServerFn(updateWATemplate);
  const deleteFn      = useServerFn(deleteWATemplate);
  const watiConnFn    = useServerFn(getWatiConnection);
  const watiListFn    = useServerFn(listWatiTemplates);
  const watiSyncFn    = useServerFn(syncWatiTemplates);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["wa-templates"],
    queryFn: () => listFn(),
    throwOnError: false,
  });

  const { data: watiConn } = useQuery({
    queryKey: ["wati-connection"],
    queryFn: () => watiConnFn(),
    throwOnError: false,
  });
  const watiConnected = !!watiConn && watiConn.status === "connected";

  const { data: watiTemplates = [] } = useQuery({
    queryKey: ["wati-templates"],
    queryFn: () => watiListFn(),
    enabled: watiConnected,
    throwOnError: false,
  });

  const syncWati = useMutation({
    mutationFn: () => watiSyncFn(),
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["wati-templates"] });
      toast.success(`Synced ${d.count} WATI templates`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [open, setOpen]         = useState(false);
  const [editRow, setEditRow]   = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm]         = useState(emptyForm());

  const detectedVars = extractVars(form.body);

  function openCreate() {
    setEditRow(null);
    setForm(emptyForm());
    setOpen(true);
  }
  function openEdit(t: any) {
    setEditRow(t);
    setForm({
      name: t.name ?? "",
      body: t.body ?? "",
      variables: (t.variables ?? []).join(", "),
      category: t.category ?? "MARKETING",
    });
    setOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const vars = detectedVars.length > 0 ? detectedVars : (form.variables ? form.variables.split(",").map((v) => v.trim()).filter(Boolean) : []);
      const payload = {
        name: form.name,
        body: form.body,
        variables: vars,
        category: form.category,
      };
      if (editRow) {
        await updateFn({ data: { id: editRow.id, ...payload } });
      } else {
        await createFn({ data: payload });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-templates"] });
      setOpen(false);
      toast.success(editRow ? "Template updated" : "Template created");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: () => deleteFn({ data: { id: deleteId! } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-templates"] });
      setDeleteId(null);
      toast.success("Template deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  function insertVar(varName: string) {
    setForm((f) => ({ ...f, body: f.body + `{{${varName}}}` }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Create reusable message templates with dynamic variables like <code className="text-xs bg-muted px-1 rounded">{"{{name}}"}</code>.
        </p>
        <div className="flex items-center gap-2">
          {watiConnected && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-purple-500/30 text-purple-400 hover:text-purple-300"
              disabled={syncWati.isPending}
              onClick={() => syncWati.mutate()}
            >
              {syncWati.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              Import from WATI
            </Button>
          )}
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New Template
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (templates as any[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <FileText className="h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">No templates yet</p>
          <p className="text-xs">Create templates to use in campaigns and quick replies.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(templates as any[]).map((t: any) => (
            <div
              key={t.id}
              className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{t.name}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <Badge variant="secondary" className="text-[10px]">{t.category}</Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-400">Twilio</Badge>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(t.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{t.body}</p>
              {(t.variables ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {t.variables.map((v: string) => (
                    <Badge key={v} variant="outline" className="text-[10px] gap-0.5">
                      <Variable className="h-2.5 w-2.5" />{v}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-auto">
                Created <RelativeTime date={t.created_at} />
              </p>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editRow ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Template Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. welcome_message"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Message Body *</Label>
                <div className="flex gap-1">
                  {["name", "phone", "date"].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => insertVar(v)}
                      className="text-[10px] bg-muted px-1.5 py-0.5 rounded hover:bg-muted/70 transition-colors"
                    >
                      +{`{{${v}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <Textarea
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                rows={5}
                placeholder={"Hi {{name}}, thanks for reaching out! We'll be in touch shortly."}
              />
              <p className="text-[10px] text-muted-foreground">
                Use <code>{"{{variable}}"}</code> for dynamic fields.
              </p>
            </div>
            {detectedVars.length > 0 && (
              <div className="rounded-md bg-muted/50 px-3 py-2">
                <p className="text-[10px] text-muted-foreground mb-1">Detected variables:</p>
                <div className="flex flex-wrap gap-1">
                  {detectedVars.map((v) => (
                    <Badge key={v} variant="outline" className="text-[10px]">{v}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!form.name || !form.body || save.isPending}>
              {save.isPending ? "Saving…" : editRow ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>Campaigns using this template will no longer reference it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── WATI Templates (only shown when WATI is connected) ─────────────── */}
      {watiConnected && (watiTemplates as any[]).length > 0 && (
        <div className="space-y-3 pt-4 border-t border-border/40">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-purple-500/15 text-purple-500 text-[10px] font-bold">W</span>
            <span className="text-sm font-medium">WATI Templates</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400">
              {(watiTemplates as any[]).length}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(watiTemplates as any[]).map((t: any) => (
              <div
                key={t.id}
                className="rounded-lg border border-purple-500/20 bg-card p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{t.name}</p>
                    <div className="flex items-center gap-1 mt-1">
                      {t.category && <Badge variant="secondary" className="text-[10px]">{t.category}</Badge>}
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400">WATI</Badge>
                      {t.status && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{t.status}</Badge>}
                    </div>
                  </div>
                </div>
                {t.language && (
                  <p className="text-[10px] text-muted-foreground">Language: {t.language}</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-auto">
                  Synced <RelativeTime date={t.synced_at} />
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
