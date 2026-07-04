import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Boxes, Loader2, Search, Sparkles, ShieldCheck, ShieldAlert, Upload, Download,
  Copy, Trash2, CheckCircle2, Send, XCircle, Archive, Info, Layers, PlugZap,
  GitBranch, KeyRound, AlertTriangle, ArrowRight, Wand2, FileInput, Pencil,
  History, Network, Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  listTemplatesFn, getTemplateDetailFn, createTemplateFromWorkflowFn,
  updateTemplateFn, cloneTemplateFn, exportTemplateFn, importTemplateFn,
  submitTemplateFn, approveTemplateFn, rejectTemplateFn, archiveTemplateFn,
  deleteTemplateFn, listWorkflowsForTemplatesFn, classifyWorkflowFn,
  classifyAllWorkflowsFn, setWorkflowClassificationFn,
} from "@/lib/systemmind/systemmind-templates.functions";

// ── Constants ────────────────────────────────────────────────────────────────

const TEMPLATE_TYPES = [
  "reusable_template", "customer_specific", "experimental", "legacy", "archive",
] as const;

const WORKFLOW_CATEGORIES = [
  "Receptionist", "Lead Generation", "Client Qualification", "Appointment Booking",
  "CRM Synchronisation", "Transcript Processing", "Follow-Up Campaign",
  "WhatsApp Automation", "Notification", "Call Transfer", "Knowledge Base",
  "Reporting", "Data Sync", "General",
];

const STATUSES = ["draft", "pending_approval", "approved", "archived"] as const;

const TYPE_LABEL: Record<string, string> = {
  reusable_template: "Reusable",
  customer_specific: "Customer-specific",
  experimental: "Experimental",
  legacy: "Legacy",
  archive: "Archive",
};

// ── Small presentational helpers ─────────────────────────────────────────────

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("text-[10px] border border-white/[0.08] rounded px-1.5 py-0.5 text-muted-foreground", className)}>
      {children}
    </span>
  );
}

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-[11px] font-semibold flex items-center gap-1.5 mb-2">
        <Icon className="h-3.5 w-3.5 text-sky-400" /> {title}
      </p>
      {children}
    </div>
  );
}

function ProviderRow({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] text-muted-foreground/60 w-20 shrink-0">{label}</span>
      <div className="flex gap-1 flex-wrap">
        {items.map((t) => <Chip key={t} className="text-sky-400/80 border-sky-500/20">{t}</Chip>)}
      </div>
    </div>
  );
}

function StatusPill({ status, trusted }: { status: string; trusted?: boolean }) {
  const map: Record<string, string> = {
    draft: "border-white/[0.1] text-muted-foreground",
    pending_approval: "border-amber-500/30 bg-amber-500/[0.08] text-amber-400",
    approved: "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400",
    archived: "border-white/[0.08] text-muted-foreground/50",
  };
  return (
    <span className={cn("text-[10px] rounded-full px-2 py-0.5 border inline-flex items-center gap-1", map[status] ?? map.draft)}>
      {trusted && <ShieldCheck className="h-2.5 w-2.5" />}
      {status.replace(/_/g, " ")}
    </span>
  );
}

function RiskBadge({ risk }: { risk?: string | null }) {
  if (!risk) return null;
  const cls = risk === "high" ? "text-red-400 border-red-500/30 bg-red-500/[0.08]"
    : risk === "medium" ? "text-amber-400 border-amber-500/30 bg-amber-500/[0.08]"
    : "text-emerald-400 border-emerald-500/30 bg-emerald-500/[0.08]";
  return <span className={cn("text-[10px] font-semibold border rounded px-1.5 py-0.5", cls)}>{risk} risk</span>;
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "template"}.webee-template.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Template detail panel ─────────────────────────────────────────────────────

function TemplateDetail({ id, onChanged, onDeleted }: { id: string; onChanged: () => void; onDeleted: () => void }) {
  const detailFn = useServerFn(getTemplateDetailFn);
  const exportFn = useServerFn(exportTemplateFn);
  const cloneFn = useServerFn(cloneTemplateFn);
  const submitFn = useServerFn(submitTemplateFn);
  const approveFn = useServerFn(approveTemplateFn);
  const rejectFn = useServerFn(rejectTemplateFn);
  const archiveFn = useServerFn(archiveTemplateFn);
  const deleteFn = useServerFn(deleteTemplateFn);
  const updateFn = useServerFn(updateTemplateFn);
  const qc = useQueryClient();

  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState<any>({});

  const { data, isLoading } = useQuery({
    queryKey: ["sm-tpl-detail", id],
    queryFn: () => detailFn({ data: { id } }),
    throwOnError: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sm-tpl-detail", id] });
    onChanged();
  };

  const act = (fn: (a: { data: { id: string } }) => Promise<any>, msg: string) =>
    useMutation({
      mutationFn: () => fn({ data: { id } }),
      onSuccess: () => { toast.success(msg); invalidate(); },
      onError: (e: any) => toast.error(e?.message ?? "Action failed"),
    });

  const submitMut = act(submitFn, "Submitted for approval");
  const approveMut = act(approveFn, "Approved — now trusted");
  const rejectMut = act(rejectFn, "Reverted to draft");
  const archiveMut = act(archiveFn, "Archived");

  const deleteMut = useMutation({
    mutationFn: () => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Template deleted"); onDeleted(); },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const cloneMut = useMutation({
    mutationFn: () => cloneFn({ data: { id, newName: cloneName || undefined } }),
    onSuccess: () => { toast.success("Template cloned"); setCloneOpen(false); setCloneName(""); onChanged(); },
    onError: (e: any) => toast.error(e?.message ?? "Clone failed"),
  });

  const editMut = useMutation({
    mutationFn: (patch: any) => updateFn({ data: { id, patch } }),
    onSuccess: () => { toast.success("Template updated"); setEditOpen(false); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  async function handleExport() {
    try {
      const payload = await exportFn({ data: { id } });
      downloadJson((payload as any)?.name ?? "template", payload);
      toast.success("Exported");
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!data || !(data as any).template) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Template not found.</div>;
  }

  const t: any = (data as any).template;
  const versions: any[] = (data as any).versions ?? [];
  const vars: any[] = Array.isArray(t.deployment_variables) ? t.deployment_variables : [];
  const structure = t.structure ?? {};
  const order: string[] = structure.order ?? [];
  const nodes: any[] = structure.nodes ?? [];

  const openEdit = () => {
    setEdit({
      name: t.name ?? "",
      category: t.category ?? "General",
      template_type: t.template_type ?? "reusable_template",
      description: t.description ?? "",
      business_purpose: t.business_purpose ?? "",
      risk_rating: t.risk_rating ?? "medium",
      readiness: t.readiness ?? "needs_review",
      tags: (t.tags ?? []).join(", "),
    });
    setEditOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-sky-500/25 shrink-0">
          <Boxes className="h-4 w-4 text-sky-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">{t.name}</h3>
            <StatusPill status={t.status} trusted={t.is_trusted} />
            <RiskBadge risk={t.risk_rating} />
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <Chip className="text-sky-400/80 border-sky-500/20">{t.category ?? "General"}</Chip>
            <Chip>{TYPE_LABEL[t.template_type] ?? t.template_type}</Chip>
            {t.confidence != null && <span className="text-[10px] text-muted-foreground">confidence {t.confidence}%</span>}
            {t.readiness && <span className="text-[10px] text-muted-foreground/70">· {t.readiness.replace(/_/g, " ")}</span>}
            <span className="text-[10px] text-muted-foreground/50">· v{t.current_version}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5">
        {(t.status === "draft" || t.status === "archived") && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] gap-1" disabled={submitMut.isPending} onClick={() => submitMut.mutate()}>
            <Send className="h-3 w-3" /> Submit for approval
          </Button>
        )}
        {t.status !== "approved" && (
          <Button size="sm" className="h-7 px-2 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-500" disabled={approveMut.isPending} onClick={() => approveMut.mutate()}>
            {approveMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Approve
          </Button>
        )}
        {t.status === "pending_approval" && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] gap-1" disabled={rejectMut.isPending} onClick={() => rejectMut.mutate()}>
            <XCircle className="h-3 w-3" /> Reject
          </Button>
        )}
        {t.status === "approved" && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] gap-1" disabled={rejectMut.isPending} onClick={() => rejectMut.mutate()}>
            <XCircle className="h-3 w-3" /> Revoke approval
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] gap-1" onClick={openEdit}>
          <Pencil className="h-3 w-3" /> Edit
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] gap-1" onClick={() => { setCloneName(`Copy of ${t.name}`); setCloneOpen(true); }}>
          <Copy className="h-3 w-3" /> Clone
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] gap-1" onClick={handleExport}>
          <Download className="h-3 w-3" /> Export
        </Button>
        {t.status !== "archived" && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] gap-1" disabled={archiveMut.isPending} onClick={() => archiveMut.mutate()}>
            <Archive className="h-3 w-3" /> Archive
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] gap-1 text-red-400 hover:text-red-300" disabled={deleteMut.isPending}
          onClick={() => { if (confirm("Delete this template permanently?")) deleteMut.mutate(); }}>
          <Trash2 className="h-3 w-3" /> Delete
        </Button>
      </div>

      {/* Summaries */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Section icon={Info} title="Business purpose & summary">
          {t.business_purpose && <p className="text-[11px] text-muted-foreground mb-1.5"><span className="text-muted-foreground/80">Purpose:</span> {t.business_purpose}</p>}
          <p className="text-[11px] text-muted-foreground leading-relaxed">{t.business_summary || t.description || "—"}</p>
        </Section>
        <Section icon={Layers} title="Technical summary">
          <p className="text-[11px] text-muted-foreground leading-relaxed">{t.technical_summary || "—"}</p>
        </Section>
      </div>

      {/* Providers */}
      <Section icon={PlugZap} title="Supported providers">
        <div className="space-y-1.5">
          <ProviderRow label="Agent" items={t.supported_agent_providers ?? []} />
          <ProviderRow label="CRM" items={t.supported_crm_providers ?? []} />
          <ProviderRow label="Calendar" items={t.supported_calendar_providers ?? []} />
          <ProviderRow label="Telephony" items={t.supported_telephony_providers ?? []} />
          <ProviderRow label="Messaging" items={t.supported_messaging_providers ?? []} />
          {!(t.supported_agent_providers?.length || t.supported_crm_providers?.length || t.supported_calendar_providers?.length || t.supported_telephony_providers?.length || t.supported_messaging_providers?.length) && (
            <p className="text-[11px] text-muted-foreground/50">None detected</p>
          )}
        </div>
      </Section>

      {/* Requirements */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Section icon={PlugZap} title="Required APIs">
          <div className="flex gap-1 flex-wrap">
            {(t.required_apis ?? []).length ? (t.required_apis as string[]).map((a) => <Chip key={a}>{a}</Chip>) : <span className="text-[11px] text-muted-foreground/50">—</span>}
          </div>
        </Section>
        <Section icon={KeyRound} title="Required credentials">
          <div className="flex gap-1 flex-wrap">
            {(t.required_credentials ?? []).length ? (t.required_credentials as string[]).map((a) => <Chip key={a}>{a}</Chip>) : <span className="text-[11px] text-muted-foreground/50">—</span>}
          </div>
        </Section>
      </div>

      {/* Deployment variables */}
      <Section icon={KeyRound} title={`Deployment variables (${vars.length})`}>
        {vars.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/50">No tenant-specific parameters detected.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[10.5px]">
              <thead>
                <tr className="text-muted-foreground/60 text-left border-b border-white/[0.06]">
                  <th className="font-medium py-1 pr-2">Variable</th>
                  <th className="font-medium py-1 pr-2">Category</th>
                  <th className="font-medium py-1 pr-2">Example</th>
                  <th className="font-medium py-1 pr-2">Req</th>
                  <th className="font-medium py-1">Source</th>
                </tr>
              </thead>
              <tbody>
                {vars.map((v, i) => (
                  <tr key={`${v.key}-${i}`} className="border-b border-white/[0.03] align-top">
                    <td className="py-1 pr-2">
                      <div className="text-foreground">{v.name}</div>
                      <code className="text-[9px] text-muted-foreground/60">{v.key}</code>
                    </td>
                    <td className="py-1 pr-2">
                      <Chip className={cn((v.category === "secret" || v.category === "credential") && "text-red-400 border-red-500/25")}>{v.category}</Chip>
                    </td>
                    <td className="py-1 pr-2 font-mono text-muted-foreground/80">{v.example || <span className="text-muted-foreground/30">—</span>}</td>
                    <td className="py-1 pr-2">{v.required ? <span className="text-amber-400">yes</span> : <span className="text-muted-foreground/40">no</span>}</td>
                    <td className="py-1 text-muted-foreground/60">{v.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[9px] text-muted-foreground/40 mt-1.5 flex items-center gap-1">
              <ShieldAlert className="h-2.5 w-2.5" /> Secret values are masked — raw secrets are never stored on templates.
            </p>
          </div>
        )}
      </Section>

      {/* Dependencies + limitations */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Section icon={GitBranch} title="Dependencies">
          {(t.dependencies ?? []).length ? (
            <ul className="space-y-1">{(t.dependencies as string[]).map((d, i) => <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5"><span className="text-sky-400/60">•</span>{d}</li>)}</ul>
          ) : <p className="text-[11px] text-muted-foreground/50">—</p>}
        </Section>
        <Section icon={AlertTriangle} title="Known limitations">
          {(t.known_limitations ?? []).length ? (
            <ul className="space-y-1">{(t.known_limitations as string[]).map((d, i) => <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5"><span className="text-amber-400/60">•</span>{d}</li>)}</ul>
          ) : <p className="text-[11px] text-muted-foreground/50">—</p>}
        </Section>
      </div>

      {/* Linked sources */}
      <Section icon={Network} title="Linked sources">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <div>n8n workflows: {(t.linked_n8n_workflow_ids ?? []).length || 0}</div>
          <div>Builder templates: {(t.linked_builder_template_ids ?? []).length || 0}</div>
          <div>Retell agents: {(t.linked_retell_agent_ids ?? []).length || 0}</div>
        </div>
      </Section>

      {/* Structure visual */}
      <Section icon={ArrowRight} title={`Workflow structure (${nodes.length} nodes)`}>
        {order.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {order.map((n, i) => (
              <span key={`${n}-${i}`} className="flex items-center gap-1">
                <span className="text-[10px] rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-muted-foreground">{n}</span>
                {i < order.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/40" />}
              </span>
            ))}
          </div>
        ) : nodes.length > 0 ? (
          <div className="flex gap-1 flex-wrap">{nodes.map((n: any, i: number) => <Chip key={i}>{n.name}</Chip>)}</div>
        ) : <p className="text-[11px] text-muted-foreground/50">No structure captured.</p>}
      </Section>

      {/* Version history */}
      <Section icon={History} title={`Version history (${versions.length})`}>
        {versions.length === 0 ? <p className="text-[11px] text-muted-foreground/50">—</p> : (
          <ul className="space-y-1">
            {versions.map((v) => (
              <li key={v.id} className="text-[11px] text-muted-foreground flex items-center gap-2">
                <span className="font-mono text-sky-400/70">v{v.version}</span>
                <StatusPill status={v.status ?? "draft"} />
                <span className="text-muted-foreground/70">{v.change_note}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/40">{v.created_at ? new Date(v.created_at).toLocaleString() : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Clone dialog */}
      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Clone template</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">New name</Label>
            <Input value={cloneName} onChange={(e) => setCloneName(e.target.value)} className="h-8 text-xs" />
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setCloneOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={cloneMut.isPending} onClick={() => cloneMut.mutate()}>
              {cloneMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Clone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit template</DialogTitle>
            <DialogDescription className="text-[11px]">Editing an approved template returns it to draft for re-approval.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div className="space-y-1"><Label className="text-xs">Name</Label>
              <Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="h-8 text-xs" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-xs">Category</Label>
                <Select value={edit.category} onValueChange={(v) => setEdit({ ...edit, category: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{WORKFLOW_CATEGORIES.map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Type</Label>
                <Select value={edit.template_type} onValueChange={(v) => setEdit({ ...edit, template_type: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{TEMPLATE_TYPES.map((c) => <SelectItem key={c} value={c} className="text-xs">{TYPE_LABEL[c]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-xs">Risk rating</Label>
                <Select value={edit.risk_rating} onValueChange={(v) => setEdit({ ...edit, risk_rating: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{["low", "medium", "high"].map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Readiness</Label>
                <Select value={edit.readiness} onValueChange={(v) => setEdit({ ...edit, readiness: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{["not_ready", "needs_review", "ready"].map((c) => <SelectItem key={c} value={c} className="text-xs">{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Business purpose</Label>
              <Input value={edit.business_purpose ?? ""} onChange={(e) => setEdit({ ...edit, business_purpose: e.target.value })} className="h-8 text-xs" /></div>
            <div className="space-y-1"><Label className="text-xs">Description</Label>
              <Textarea value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className="text-xs min-h-[60px]" /></div>
            <div className="space-y-1"><Label className="text-xs">Tags (comma-separated)</Label>
              <Input value={edit.tags ?? ""} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} className="h-8 text-xs" /></div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={editMut.isPending} onClick={() => {
              const patch: any = { ...edit };
              patch.tags = String(edit.tags ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
              editMut.mutate(patch);
            }}>
              {editMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Templates tab ─────────────────────────────────────────────────────────────

function TemplatesTab() {
  const listFn = useServerFn(listTemplatesFn);
  const importFn = useServerFn(importTemplateFn);
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [templateType, setTemplateType] = useState<string>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const filters = useMemo(() => ({
    category: category === "all" ? undefined : category,
    status: status === "all" ? undefined : status,
    templateType: templateType === "all" ? undefined : templateType,
  }), [category, status, templateType]);

  const { data, isLoading } = useQuery({
    queryKey: ["sm-tpl-list", filters],
    queryFn: () => listFn({ data: filters }),
    throwOnError: false,
  });

  const templates: any[] = (data as any) ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => t.name?.toLowerCase().includes(q) || (t.tags ?? []).some((x: string) => x.toLowerCase().includes(q)));
  }, [templates, search]);

  const invalidateList = () => qc.invalidateQueries({ queryKey: ["sm-tpl-list"] });

  const importMut = useMutation({
    mutationFn: () => {
      let parsed: any;
      try { parsed = JSON.parse(importText); } catch { throw new Error("Invalid JSON"); }
      return importFn({ data: { payload: parsed } });
    },
    onSuccess: (t: any) => {
      toast.success("Template imported as draft");
      setImportOpen(false); setImportText("");
      invalidateList();
      if (t?.id) setSelectedId(t.id);
    },
    onError: (e: any) => toast.error(e?.message ?? "Import failed"),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates…" className="h-8 text-xs pl-8" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-8 text-xs w-[150px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All categories</SelectItem>
            {WORKFLOW_CATEGORIES.map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s} className="text-xs">{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={templateType} onValueChange={setTemplateType}>
          <SelectTrigger className="h-8 text-xs w-[150px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All types</SelectItem>
            {TEMPLATE_TYPES.map((s) => <SelectItem key={s} value={s} className="text-xs">{TYPE_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setImportOpen(true)}>
          <Upload className="h-3 w-3" /> Import
        </Button>
      </div>

      {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

      {!isLoading && templates.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-16 text-center">
          <Boxes className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No templates yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Create one from a discovered workflow in the “Workflows” tab, or import a template.</p>
        </div>
      )}

      {!isLoading && templates.length > 0 && (
        <div className="grid lg:grid-cols-[340px_1fr] gap-5 items-start">
          <div className="space-y-2">
            <p className="text-[10px] text-muted-foreground px-1">{filtered.length} of {templates.length}</p>
            <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
              {filtered.map((t) => (
                <button key={t.id} onClick={() => setSelectedId(t.id)}
                  className={cn("w-full text-left rounded-lg border px-3 py-2.5 transition-colors",
                    selectedId === t.id ? "border-sky-500/40 bg-sky-500/[0.08]" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]")}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate flex-1">{t.name}</span>
                    <StatusPill status={t.status} trusted={t.is_trusted} />
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Chip className="text-sky-400/80 border-sky-500/20">{t.category ?? "General"}</Chip>
                    <span className="text-[10px] text-muted-foreground/60">{TYPE_LABEL[t.template_type] ?? t.template_type}</span>
                    {t.risk_rating && <span className="text-[10px] text-muted-foreground/40">· {t.risk_rating} risk</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-4 min-h-[60vh]">
            {selectedId
              ? <TemplateDetail id={selectedId} onChanged={invalidateList} onDeleted={() => { setSelectedId(null); invalidateList(); }} />
              : (
                <div className="flex flex-col items-center justify-center h-full py-20 text-center">
                  <Boxes className="h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">Select a template</p>
                  <p className="text-xs text-muted-foreground/50 mt-1">Its full detail, parameters and versions appear here.</p>
                </div>
              )}
          </div>
        </div>
      )}

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import template</DialogTitle>
            <DialogDescription className="text-[11px]">Paste an exported WEBEE template JSON. It is imported as an untrusted draft; linked sources are dropped.</DialogDescription>
          </DialogHeader>
          <Textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{ "name": "...", ... }' className="text-xs font-mono min-h-[220px]" />
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={importMut.isPending || !importText.trim()} onClick={() => importMut.mutate()}>
              {importMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><FileInput className="h-3 w-3 mr-1" /> Import</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Workflows (classification) tab ────────────────────────────────────────────

function WorkflowRow({ w, onChanged }: { w: any; onChanged: () => void }) {
  const classifyFn = useServerFn(classifyWorkflowFn);
  const setClassFn = useServerFn(setWorkflowClassificationFn);
  const createFn = useServerFn(createTemplateFromWorkflowFn);

  const [type, setType] = useState<string>(w.template_type ?? "");
  const [category, setCategory] = useState<string>(w.workflow_category ?? "");

  const classifyMut = useMutation({
    mutationFn: () => classifyFn({ data: { id: w.id } }),
    onSuccess: (c: any) => { setType(c.type); setCategory(c.category); toast.success("Classified"); onChanged(); },
    onError: (e: any) => toast.error(e?.message ?? "Classify failed"),
  });

  const saveMut = useMutation({
    mutationFn: () => setClassFn({ data: { id: w.id, type: type as any, category: category || "General" } }),
    onSuccess: () => { toast.success("Classification saved"); onChanged(); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const createMut = useMutation({
    mutationFn: () => createFn({ data: { workflowId: w.id } }),
    onSuccess: () => { toast.success("Template created (draft)"); onChanged(); },
    onError: (e: any) => toast.error(e?.message ?? "Create failed"),
  });

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium flex-1 truncate">{w.name}</span>
        {w.active && <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" title="active" />}
        {w.template_type ? <Chip className="border-sky-500/25 text-sky-400/80">{TYPE_LABEL[w.template_type] ?? w.template_type}</Chip> : <Chip className="border-amber-500/25 text-amber-400/80">unclassified</Chip>}
        {w.workflow_category && <Chip>{w.workflow_category}</Chip>}
        <span className="text-[10px] text-muted-foreground/50">{w.node_count} nodes</span>
      </div>
      {w.classification?.reasoning && (
        <p className="text-[10px] text-muted-foreground/60 mt-1">{w.classification.reasoning}</p>
      )}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-7 text-[10px] w-[140px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>{TEMPLATE_TYPES.map((c) => <SelectItem key={c} value={c} className="text-xs">{TYPE_LABEL[c]}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-7 text-[10px] w-[150px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>{WORKFLOW_CATEGORIES.map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] gap-1" disabled={!type || saveMut.isPending} onClick={() => saveMut.mutate()}>
          {saveMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] gap-1" disabled={classifyMut.isPending} onClick={() => classifyMut.mutate()}>
          {classifyMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} AI classify
        </Button>
        <Button size="sm" className="h-7 px-2 text-[10px] gap-1 ml-auto" disabled={createMut.isPending} onClick={() => createMut.mutate()}>
          {createMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} Create template
        </Button>
      </div>
    </div>
  );
}

function WorkflowsTab() {
  const listFn = useServerFn(listWorkflowsForTemplatesFn);
  const classifyAllFn = useServerFn(classifyAllWorkflowsFn);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [onlyUnclassified, setOnlyUnclassified] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["sm-tpl-workflows"],
    queryFn: () => listFn(),
    throwOnError: false,
  });

  const workflows: any[] = (data as any) ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workflows.filter((w) => {
      if (onlyUnclassified && w.template_type) return false;
      if (!q) return true;
      return w.name?.toLowerCase().includes(q) || (w.folder ?? "").toLowerCase().includes(q) || (w.integrations ?? []).some((x: string) => x.toLowerCase().includes(q));
    });
  }, [workflows, search, onlyUnclassified]);

  const onChanged = () => {
    qc.invalidateQueries({ queryKey: ["sm-tpl-workflows"] });
    qc.invalidateQueries({ queryKey: ["sm-tpl-list"] });
  };

  const classifyAllMut = useMutation({
    mutationFn: () => classifyAllFn({ data: { force: false } }),
    onSuccess: (r: any) => { toast.success(`Classified ${r.classified} of ${r.total} workflows`); onChanged(); },
    onError: (e: any) => toast.error(e?.message ?? "Batch classify failed"),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search workflows…" className="h-8 text-xs pl-8" />
        </div>
        <Button size="sm" variant={onlyUnclassified ? "default" : "outline"} className="h-8 text-xs gap-1.5" onClick={() => setOnlyUnclassified((v) => !v)}>
          <Tag className="h-3 w-3" /> Unclassified only
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={classifyAllMut.isPending} onClick={() => classifyAllMut.mutate()}>
          {classifyAllMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Classify all
        </Button>
      </div>

      {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

      {!isLoading && workflows.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-16 text-center">
          <Network className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No discovered workflows</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Discover workflows in Workflow Intelligence first, then classify and templatise them here.</p>
        </div>
      )}

      {!isLoading && workflows.length > 0 && (
        <>
          <p className="text-[10px] text-muted-foreground px-1">{filtered.length} of {workflows.length}</p>
          <div className="space-y-2 max-h-[74vh] overflow-y-auto pr-1">
            {filtered.map((w) => <WorkflowRow key={w.id} w={w} onChanged={onChanged} />)}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SystemMindTemplateLibraryPage() {
  return (
    <div className="p-5 space-y-5 max-w-7xl">
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Boxes className="h-5 w-5 text-sky-400" /> Workflow Template Library
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Curated, reusable deployment templates built from discovered workflows — classified, parameterised, versioned, and approved. Nothing here deploys automatically.
        </p>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates" className="text-xs gap-1.5"><Boxes className="h-3.5 w-3.5" /> Templates</TabsTrigger>
          <TabsTrigger value="workflows" className="text-xs gap-1.5"><Network className="h-3.5 w-3.5" /> Workflows &amp; classification</TabsTrigger>
        </TabsList>
        <TabsContent value="templates" className="mt-4"><TemplatesTab /></TabsContent>
        <TabsContent value="workflows" className="mt-4"><WorkflowsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
