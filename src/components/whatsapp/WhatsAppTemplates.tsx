import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Pencil,
  FileText,
  Variable,
  RefreshCw,
  Loader2,
  ExternalLink,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listWATemplates,
  createWATemplate,
  updateWATemplate,
  deleteWATemplate,
} from "@/lib/dashboard/whatsapp.functions";
import { getWatiConnection, listWatiTemplates, syncWatiTemplates, createWatiTemplate } from "@/lib/whatsapp/wati.functions";
import { extractWatiTemplateParamSlots } from "@/lib/whatsapp/wati-template-params.shared";
import {
  defaultParamSample,
  extractTemplateVariablesFromBody,
  normalizeWatiElementName,
} from "@/lib/whatsapp/wati-template-create.shared";
import {
  resolveWatiTemplateStatusKey,
  watiTemplateCanSend,
  watiTemplateStatusBadgeClass,
  watiTemplateStatusLabel,
  type WatiTemplateStatusKey,
} from "@/lib/whatsapp/wati-template-status.shared";
import { toast } from "sonner";

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"];
const WATI_LANGUAGES = [
  { value: "en", label: "English (en)" },
  { value: "en_GB", label: "English UK (en_GB)" },
  { value: "en_US", label: "English US (en_US)" },
];
const WATI_CREATE_URL = "https://app.wati.io";

type StatusFilter = "all" | WatiTemplateStatusKey;

type WatiTemplateRow = {
  id: string;
  name: string;
  status?: string | null;
  status_code?: number | null;
  category?: string | null;
  language?: string | null;
  body_preview?: string | null;
  rejection_reason?: string | null;
  quality?: string | null;
  components?: unknown;
  synced_at?: string | null;
  last_status_at?: string | null;
};

function emptyForm() {
  return { name: "", body: "", variables: "", category: "MARKETING" };
}

function emptyWatiForm() {
  return {
    elementName: "",
    body: "Hi {{name}}, thanks for reaching out! We'll be in touch shortly.",
    category: "UTILITY" as "MARKETING" | "UTILITY" | "AUTHENTICATION",
    language: "en",
    footer: "",
    paramSamples: { name: "Customer" } as Record<string, string>,
  };
}

function extractVars(body: string): string[] {
  const matches = body.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, "")))];
}

function StatusIcon({ statusKey }: { statusKey: WatiTemplateStatusKey }) {
  if (statusKey === "approved") return <CheckCircle2 className="h-3 w-3" />;
  if (statusKey === "pending") return <Clock className="h-3 w-3" />;
  if (statusKey === "rejected") return <XCircle className="h-3 w-3" />;
  return <AlertCircle className="h-3 w-3" />;
}

export function WhatsAppTemplates() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWATemplates);
  const createFn = useServerFn(createWATemplate);
  const updateFn = useServerFn(updateWATemplate);
  const deleteFn = useServerFn(deleteWATemplate);
  const watiConnFn = useServerFn(getWatiConnection);
  const watiListFn = useServerFn(listWatiTemplates);
  const watiSyncFn = useServerFn(syncWatiTemplates);
  const watiCreateFn = useServerFn(createWatiTemplate);

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

  const { data: watiTemplates = [], isLoading: watiLoading } = useQuery({
    queryKey: ["wati-templates"],
    queryFn: () => watiListFn(),
    enabled: watiConnected,
    throwOnError: false,
  });

  const syncWati = useMutation({
    mutationFn: () => watiSyncFn(),
    onSuccess: (d: { count?: number }) => {
      qc.invalidateQueries({ queryKey: ["wati-templates"] });
      toast.success(`Refreshed ${d.count ?? 0} templates from WATI`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createWati = useMutation({
    mutationFn: () =>
      watiCreateFn({
        data: {
          elementName: watiForm.elementName,
          body: watiForm.body,
          category: watiForm.category,
          language: watiForm.language,
          footer: watiForm.footer || undefined,
          paramSamples: watiForm.paramSamples,
        },
      }),
    onSuccess: (res: { message?: string }) => {
      qc.invalidateQueries({ queryKey: ["wati-templates"] });
      setWatiCreateOpen(false);
      setWatiForm(emptyWatiForm());
      toast.success(res.message ?? "Template submitted to WATI");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [watiCreateOpen, setWatiCreateOpen] = useState(false);
  const [watiForm, setWatiForm] = useState(emptyWatiForm());
  const [open, setOpen] = useState(false);
  const [editRow, setEditRow] = useState<{ id: string } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());

  const detectedVars = extractVars(form.body);
  const watiBodyVars = extractTemplateVariablesFromBody(watiForm.body);
  const watiNamePreview = normalizeWatiElementName(watiForm.elementName);

  const watiRows = watiTemplates as WatiTemplateRow[];

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: watiRows.length };
    for (const t of watiRows) {
      const key = resolveWatiTemplateStatusKey(t);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [watiRows]);

  const filteredWati = useMemo(() => {
    if (statusFilter === "all") return watiRows;
    return watiRows.filter((t) => resolveWatiTemplateStatusKey(t) === statusFilter);
  }, [watiRows, statusFilter]);

  function openCreate() {
    setEditRow(null);
    setForm(emptyForm());
    setOpen(true);
  }

  function openEdit(t: { name?: string; body?: string; variables?: string[]; category?: string; id: string }) {
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
      const vars =
        detectedVars.length > 0
          ? detectedVars
          : form.variables
            ? form.variables.split(",").map((v) => v.trim()).filter(Boolean)
            : [];
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
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: () => deleteFn({ data: { id: deleteId! } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-templates"] });
      setDeleteId(null);
      toast.success("Template deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function insertVar(varName: string) {
    setForm((f) => ({ ...f, body: f.body + `{{${varName}}}` }));
  }

  function insertWatiVar(varName: string) {
    setWatiForm((f) => {
      const body = f.body + `{{${varName}}}`;
      const vars = extractTemplateVariablesFromBody(body);
      const paramSamples = { ...f.paramSamples };
      for (const v of vars) {
        if (!paramSamples[v]) paramSamples[v] = defaultParamSample(v);
      }
      return { ...f, body, paramSamples };
    });
  }

  function updateWatiBody(body: string) {
    const vars = extractTemplateVariablesFromBody(body);
    setWatiForm((f) => {
      const paramSamples = { ...f.paramSamples };
      for (const v of vars) {
        if (!paramSamples[v]) paramSamples[v] = defaultParamSample(v);
      }
      for (const key of Object.keys(paramSamples)) {
        if (!vars.includes(key)) delete paramSamples[key];
      }
      return { ...f, body, paramSamples };
    });
  }

  const filterTabs: Array<{ id: StatusFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "approved", label: "Approved" },
    { id: "pending", label: "Pending" },
    { id: "rejected", label: "Rejected" },
    { id: "draft", label: "Draft" },
  ];

  return (
    <div className="space-y-6">
      {watiConnected ? (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-purple-500/15 text-purple-500 text-[10px] font-bold">
                  W
                </span>
                <h3 className="text-sm font-semibold">WATI Templates</h3>
              </div>
              <p className="text-xs text-muted-foreground max-w-xl">
                Create templates here — Webee submits to WATI for Meta approval and tracks status below.
                Use <strong>Approved</strong> templates in campaigns.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="gap-1.5" onClick={() => setWatiCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                New template
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-purple-500/30 text-purple-400 hover:text-purple-300"
                disabled={syncWati.isPending}
                onClick={() => syncWati.mutate()}
              >
                {syncWati.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Refresh from WATI
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" asChild>
                <a href={WATI_CREATE_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Create in WATI
                </a>
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {filterTabs.map((tab) => {
              const count = statusCounts[tab.id] ?? 0;
              if (tab.id !== "all" && count === 0) return null;
              return (
                <Button
                  key={tab.id}
                  type="button"
                  size="sm"
                  variant={statusFilter === tab.id ? "default" : "outline"}
                  className="h-7 text-xs gap-1"
                  onClick={() => setStatusFilter(tab.id)}
                >
                  {tab.label}
                  <span className="tabular-nums opacity-70">({count})</span>
                </Button>
              );
            })}
          </div>

          {watiLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Loading WATI templates…</div>
          ) : filteredWati.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground rounded-lg border border-dashed border-purple-500/20">
              <FileText className="h-10 w-10 opacity-30" />
              <p className="text-sm font-medium">No templates in this view</p>
              <p className="text-xs text-center max-w-sm">
                Create a template with New template, or open WATI for advanced options (buttons, media).
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredWati.map((t) => {
                const statusKey = resolveWatiTemplateStatusKey(t);
                const paramSlots = extractWatiTemplateParamSlots(t);
                const body = t.body_preview ?? "";
                return (
                  <div
                    key={t.id}
                    className="rounded-lg border border-purple-500/20 bg-card p-4 flex flex-col gap-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{t.name}</p>
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          {t.category && (
                            <Badge variant="secondary" className="text-[10px]">
                              {t.category}
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 gap-0.5 ${watiTemplateStatusBadgeClass(statusKey)}`}
                          >
                            <StatusIcon statusKey={statusKey} />
                            {watiTemplateStatusLabel(statusKey)}
                          </Badge>
                          {watiTemplateCanSend(statusKey) && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/30 text-green-600">
                              Campaign ready
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {body && (
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap">
                        {body}
                      </p>
                    )}

                    {paramSlots.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {paramSlots.map((v) => (
                          <Badge key={v} variant="outline" className="text-[10px] gap-0.5">
                            <Variable className="h-2.5 w-2.5" />
                            {`{{${v}}}`}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {t.rejection_reason && statusKey === "rejected" && (
                      <p className="text-[11px] text-red-600 dark:text-red-400 rounded-md bg-red-500/5 border border-red-500/20 px-2 py-1.5">
                        {t.rejection_reason}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground mt-auto">
                      {t.language && <span>Lang: {t.language}</span>}
                      {t.quality && <span>Quality: {t.quality}</span>}
                      <span>
                        Synced <RelativeTime date={t.synced_at ?? t.last_status_at} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">
            Templates refresh automatically from WATI (every ~2 min). Status updates via webhooks too.
            After creating here, check Pending — Meta review usually takes 30 min to 24 hours.
          </p>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Connect WATI in Settings to sync Meta-approved templates and track approval status here.
        </p>
      )}

      {!watiConnected && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Local templates for Twilio — use{" "}
              <code className="text-xs bg-muted px-1 rounded">{"{{name}}"}</code> for variables.
            </p>
            <Button size="sm" onClick={openCreate} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> New Template
            </Button>
          </div>

          {isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (templates as unknown[]).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <FileText className="h-10 w-10 opacity-30" />
              <p className="text-sm font-medium">No templates yet</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(templates as Array<{
                id: string;
                name: string;
                body: string;
                category: string;
                variables: string[];
                created_at: string;
              }>).map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{t.name}</p>
                      <Badge variant="outline" className="text-[10px] mt-1 border-blue-500/30 text-blue-400">
                        Twilio
                      </Badge>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteId(t.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{t.body}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={watiCreateOpen} onOpenChange={setWatiCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create WATI template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-[11px] text-muted-foreground">
              Submits to WATI via API for Meta review. Status updates here automatically (sync or webhook).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label className="text-xs">Template name *</Label>
                <Input
                  value={watiForm.elementName}
                  onChange={(e) => setWatiForm({ ...watiForm, elementName: e.target.value })}
                  placeholder="thanks_for_reaching_out"
                />
                {watiForm.elementName && (
                  <p className="text-[10px] text-muted-foreground">
                    WATI name: <code>{watiNamePreview || "—"}</code>
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Category *</Label>
                <Select
                  value={watiForm.category}
                  onValueChange={(v: "MARKETING" | "UTILITY" | "AUTHENTICATION") =>
                    setWatiForm({ ...watiForm, category: v })
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Language</Label>
                <Select
                  value={watiForm.language}
                  onValueChange={(v) => setWatiForm({ ...watiForm, language: v })}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WATI_LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Message body *</Label>
                <div className="flex gap-1">
                  {["name", "phone", "date"].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => insertWatiVar(v)}
                      className="text-[10px] bg-muted px-1.5 py-0.5 rounded hover:bg-muted/70"
                    >
                      +{`{{${v}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <Textarea
                value={watiForm.body}
                onChange={(e) => updateWatiBody(e.target.value)}
                rows={4}
                placeholder="Hi {{name}}, thanks for reaching out!"
              />
              <p className="text-[10px] text-muted-foreground">
                Use <code>{`{{variable}}`}</code> — sample values below are required by Meta for approval.
              </p>
            </div>
            {watiBodyVars.length > 0 && (
              <div className="space-y-2 rounded-md border border-border/60 p-3">
                <Label className="text-xs">Sample values for Meta review</Label>
                {watiBodyVars.map((v) => (
                  <div key={v} className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground w-16">{`{{${v}}}`}</span>
                    <Input
                      className="h-8 text-xs flex-1"
                      value={watiForm.paramSamples[v] ?? ""}
                      onChange={(e) =>
                        setWatiForm({
                          ...watiForm,
                          paramSamples: { ...watiForm.paramSamples, [v]: e.target.value },
                        })
                      }
                      placeholder={defaultParamSample(v)}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Footer (optional)</Label>
              <Input
                value={watiForm.footer}
                onChange={(e) => setWatiForm({ ...watiForm, footer: e.target.value })}
                placeholder="Avenue Elite Properties"
                maxLength={60}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setWatiCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createWati.mutate()}
              disabled={
                !watiForm.elementName ||
                !watiForm.body ||
                !watiNamePreview ||
                createWati.isPending ||
                watiBodyVars.some((v) => !(watiForm.paramSamples[v] ?? "").trim())
              }
            >
              {createWati.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  Submitting…
                </>
              ) : (
                "Submit to WATI"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!watiConnected && (
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
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
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
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={!form.name || !form.body || save.isPending}>
              {save.isPending ? "Saving…" : editRow ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {!watiConnected && (
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              Campaigns using this template will no longer reference it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => del.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      )}
    </div>
  );
}
