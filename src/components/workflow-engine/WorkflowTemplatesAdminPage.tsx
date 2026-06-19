import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Search, Tag, Zap, ChevronDown, ChevronUp, Pencil, Trash2,
  Globe, Archive, FileText, CheckCircle2, Loader2, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  listWorkflowTemplates,
  listWorkflowTemplateCategories,
  saveWorkflowTemplate,
  deleteWorkflowTemplate,
  type WorkflowTemplate,
} from "@/lib/workflow-engine/workflow-engine.functions";

const TRIGGER_TYPES = [
  { value: "manual",                   label: "Manual" },
  { value: "scheduled",                label: "Scheduled" },
  { value: "lead_added",               label: "Lead Added" },
  { value: "lead_status_changed",      label: "Lead Status Changed" },
  { value: "callback_due",             label: "Callback Due" },
  { value: "campaign_started",         label: "Campaign Started" },
  { value: "webhook_received",         label: "Webhook Received" },
  { value: "inbound_call",             label: "Inbound Call" },
  { value: "outbound_call_completed",  label: "Outbound Call Completed" },
];

const STATUS_COLORS: Record<string, string> = {
  published: "border-emerald-500/30 text-emerald-400 bg-emerald-500/5",
  draft:     "border-amber-500/30 text-amber-400 bg-amber-500/5",
  archived:  "border-muted-foreground/30 text-muted-foreground",
};

function TemplateBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("text-[10px]", STATUS_COLORS[status] ?? "")}>
      {status === "published" && <Globe className="h-2.5 w-2.5 mr-1" />}
      {status === "archived" && <Archive className="h-2.5 w-2.5 mr-1" />}
      {status === "draft" && <FileText className="h-2.5 w-2.5 mr-1" />}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

type EditForm = {
  id?:             string;
  category_id:     string;
  name:            string;
  description:     string;
  tags:            string;
  trigger_type:    string;
  flow_definition: string;
  status:          "draft" | "published" | "archived";
};

const BLANK_FORM: EditForm = {
  category_id:     "",
  name:            "",
  description:     "",
  tags:            "",
  trigger_type:    "manual",
  flow_definition: JSON.stringify({ steps: [{ id: "trigger", type: "trigger" }, { id: "end", type: "stop_workflow" }] }, null, 2),
  status:          "draft",
};

export function WorkflowTemplatesAdminPage() {
  const qc = useQueryClient();
  const listFn    = useServerFn(listWorkflowTemplates);
  const catsFn    = useServerFn(listWorkflowTemplateCategories);
  const saveFn    = useServerFn(saveWorkflowTemplate);
  const deleteFn  = useServerFn(deleteWorkflowTemplate);

  const templatesQ  = useQuery({ queryKey: ["admin-workflow-templates"],  queryFn: () => listFn(),  throwOnError: false });
  const categoriesQ = useQuery({ queryKey: ["workflow-template-cats"],    queryFn: () => catsFn(),  throwOnError: false });

  const [search,    setSearch]    = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [editOpen,  setEditOpen]  = useState(false);
  const [form,      setForm]      = useState<EditForm>(BLANK_FORM);
  const [formError, setFormError] = useState("");

  const saveMut = useMutation({
    mutationFn: async () => {
      setFormError("");
      let flowDef: Record<string, unknown> = {};
      try { flowDef = JSON.parse(form.flow_definition); } catch { setFormError("Flow definition is not valid JSON"); throw new Error("invalid json"); }
      await saveFn({ data: {
        id:              form.id,
        category_id:     form.category_id || null,
        name:            form.name.trim(),
        description:     form.description.trim() || null,
        tags:            form.tags.split(",").map(t => t.trim()).filter(Boolean),
        trigger_type:    form.trigger_type,
        flow_definition: flowDef,
        status:          form.status,
      }});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-workflow-templates"] });
      setEditOpen(false);
      toast.success(form.id ? "Template updated" : "Template created");
    },
    onError: (e: any) => {
      if (!formError) setFormError(e?.message ?? "Save failed");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-workflow-templates"] });
      toast.success("Template deleted");
    },
    onError: (e: any) => toast.error("Delete failed", { description: e?.message }),
  });

  const templates: WorkflowTemplate[] = templatesQ.data ?? [];
  const categories: any[] = categoriesQ.data ?? [];

  const filtered = templates.filter(t => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchCat = catFilter === "all" || t.category_id === catFilter;
    return matchSearch && matchCat;
  });

  function openCreate() {
    setForm(BLANK_FORM);
    setFormError("");
    setEditOpen(true);
  }

  function openEdit(t: WorkflowTemplate) {
    setForm({
      id:              t.id,
      category_id:     t.category_id ?? "",
      name:            t.name,
      description:     t.description ?? "",
      tags:            t.tags.join(", "),
      trigger_type:    t.trigger_type,
      flow_definition: JSON.stringify(t.flow_definition, null, 2),
      status:          t.status,
    });
    setFormError("");
    setEditOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workflow Templates</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Platform-level reusable workflow templates deployed to client workspaces.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> New Template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 w-56" placeholder="Search templates…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-44">
            <Tag className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {templatesQ.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
        </div>
      )}

      {!templatesQ.isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No templates found</p>
          <p className="text-sm mt-1">Create your first workflow template to get started.</p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map(t => (
          <Card key={t.id} className="overflow-hidden">
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => setExpanded(expanded === t.id ? null : t.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{t.name}</span>
                  <TemplateBadge status={t.status} />
                  {t.category && (
                    <Badge variant="secondary" className="text-[10px]">{t.category.name}</Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {TRIGGER_TYPES.find(x => x.value === t.trigger_type)?.label ?? t.trigger_type}
                  </Badge>
                </div>
                {t.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.description}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); openEdit(t); }}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={e => { e.stopPropagation(); if (confirm(`Delete template "${t.name}"?`)) deleteMut.mutate(t.id); }}
                  disabled={deleteMut.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                {expanded === t.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </div>
            {expanded === t.id && (
              <div className="border-t bg-muted/20 px-4 py-3 space-y-3">
                {t.tags.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {t.tags.map(tag => <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>)}
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Flow Definition</p>
                  <pre className="text-xs bg-background border rounded-md p-3 overflow-x-auto max-h-64">
                    {JSON.stringify(t.flow_definition, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Edit / Create Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Template" : "New Workflow Template"}</DialogTitle>
            <DialogDescription>Platform-level template — available to all client workspaces.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. New Lead → Instant Call" />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category_id || "none"} onValueChange={v => setForm(f => ({ ...f, category_id: v === "none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No category</SelectItem>
                    {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="What does this workflow do?" />
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Trigger Type *</Label>
                <Select value={form.trigger_type} onValueChange={v => setForm(f => ({ ...f, trigger_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRIGGER_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tags (comma-separated)</Label>
                <Input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="lead, call, crm" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Flow Definition (JSON)</Label>
              <Textarea
                value={form.flow_definition}
                onChange={e => setForm(f => ({ ...f, flow_definition: e.target.value }))}
                rows={10}
                className="font-mono text-xs"
              />
              {formError && <p className="text-xs text-destructive">{formError}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name.trim()}>
              {saveMut.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving…</> : <><CheckCircle2 className="h-4 w-4 mr-1" />{form.id ? "Save Changes" : "Create Template"}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
