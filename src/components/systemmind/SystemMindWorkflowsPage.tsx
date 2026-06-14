import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  GitBranch, RefreshCw, Loader2, Sparkles, Wrench, Trash2,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Search,
  Bot, Webhook, BookOpen, Users, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  scanAgentWorkflows,
  getWorkflowLibrary,
  extractWorkflowPatterns,
  getWorkflowPatterns,
  createWorkflowDraft,
  getWorkflowDrafts,
  deleteWorkflowDraft,
  inspectWorkflowRepair,
  getSystemMindAgentList,
  submitRepairPlanToHiveMind,
} from "@/lib/systemmind/systemmind-workflow.functions";
import type { RepairIssue } from "@/lib/systemmind/systemmind-workflow.server";

const TABS = ["Library", "Patterns", "Create Draft", "Inspect & Repair"] as const;
type Tab = (typeof TABS)[number];

const CATEGORIES = [
  "Lead Generation", "Receptionist", "Client Qualification",
  "Legal Intake", "Real Estate Qualification", "Appointment Booking",
  "Document Collection", "WhatsApp Automation", "Follow-Up Campaign",
  "CRM Sync", "Call Transfer", "Knowledge Base Agent", "General",
];

const RISK_COLORS: Record<string, string> = {
  critical: "text-red-400 border-red-500/30 bg-red-500/[0.08]",
  high:     "text-orange-400 border-orange-500/30 bg-orange-500/[0.08]",
  medium:   "text-amber-400 border-amber-500/30 bg-amber-500/[0.08]",
  low:      "text-emerald-400 border-emerald-500/30 bg-emerald-500/[0.08]",
};

// Helper: mirrors the same heuristic used in computeSystemMindData
function workflowNeedsRepair(row: any): boolean {
  const nc = Number(row.node_count ?? 0);
  const ec = Number(row.edge_count ?? 0);
  return nc === 0 || (nc > 1 && ec === 0);
}

type HealthFilter = "all" | "healthy" | "needs-repair";

// ── Library tab ───────────────────────────────────────────────────────────────
function LibraryTab({ initialHealth = "all" }: { initialHealth?: string }) {
  const [catFilter, setCatFilter] = useState("all");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>(
    (initialHealth === "healthy" || initialHealth === "needs-repair") ? initialHealth as HealthFilter : "all",
  );
  const [scanning, setScanning]   = useState(false);
  const listFn = useServerFn(getWorkflowLibrary);
  const scanFn = useServerFn(scanAgentWorkflows);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sm-wl", catFilter],
    queryFn: () => listFn({ data: { category: catFilter !== "all" ? catFilter : undefined } }),
  });
  const allRows: any[] = (data as any[]) ?? [];
  const rows = healthFilter === "healthy"
    ? allRows.filter((r) => !workflowNeedsRepair(r))
    : healthFilter === "needs-repair"
    ? allRows.filter(workflowNeedsRepair)
    : allRows;

  async function handleScan() {
    setScanning(true);
    try {
      const res: any = await scanFn({ data: {} });
      toast.success(`Scanned ${res.scanned} agent${res.scanned !== 1 ? "s" : ""}, stored ${res.stored}`);
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  const HEALTH_FILTERS: { value: HealthFilter; label: string }[] = [
    { value: "all",          label: `All (${allRows.length})` },
    { value: "healthy",      label: `Healthy (${allRows.filter((r) => !workflowNeedsRepair(r)).length})` },
    { value: "needs-repair", label: `Need repair (${allRows.filter(workflowNeedsRepair).length})` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={handleScan} disabled={scanning} className="text-xs gap-1.5">
          {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Scan Agents
        </Button>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="h-8 text-xs w-48">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{rows.length} workflow{rows.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Health filter pills */}
      {allRows.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {HEALTH_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setHealthFilter(f.value)}
              className={cn(
                "rounded-full px-3 py-0.5 text-[11px] font-medium border transition-colors",
                healthFilter === f.value
                  ? f.value === "needs-repair"
                    ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                    : f.value === "healthy"
                    ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                    : "bg-sky-500/20 border-sky-500/40 text-sky-300"
                  : "bg-white/[0.02] border-white/[0.08] text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {isLoading && <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

      {!isLoading && rows.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-14 text-center">
          <GitBranch className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No workflows scanned yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Click "Scan Agents" to extract your workflow library</p>
        </div>
      )}

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <div className="flex items-start gap-3">
              <Bot className="h-4 w-4 text-sky-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold">{row.workflow_name}</span>
                  {row.category && (
                    <span className="text-[10px] border border-white/[0.08] rounded px-1.5 py-0.5 text-muted-foreground">
                      {row.category}
                    </span>
                  )}
                  {row.provider && (
                    <span className="text-[10px] border border-sky-500/20 rounded px-1.5 py-0.5 text-sky-400">
                      {row.provider}
                    </span>
                  )}
                </div>
                <div className="flex gap-3 mt-1 flex-wrap">
                  <span className="text-[10px] text-muted-foreground">{row.node_count} nodes · {row.edge_count} edges</span>
                  {row.has_webhook   && <span className="text-[10px] text-violet-400">webhook</span>}
                  {row.has_booking   && <span className="text-[10px] text-emerald-400">booking</span>}
                  {row.has_transfer  && <span className="text-[10px] text-amber-400">transfer</span>}
                  {row.has_knowledge_base && <span className="text-[10px] text-sky-400">KB</span>}
                </div>
                {(row.node_types ?? []).length > 0 && (
                  <div className="mt-1 flex gap-1 flex-wrap">
                    {(row.node_types as string[]).slice(0, 5).map((t) => (
                      <code key={t} className="text-[9px] bg-white/[0.04] border border-white/[0.05] rounded px-1 py-0.5 text-muted-foreground">{t}</code>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Patterns tab ──────────────────────────────────────────────────────────────
function PatternsTab() {
  const [extracting, setExtracting] = useState(false);
  const listFn    = useServerFn(getWorkflowPatterns);
  const extractFn = useServerFn(extractWorkflowPatterns);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sm-wp"],
    queryFn: () => listFn({ data: {} }),
  });
  const patterns: any[] = (data as any[]) ?? [];

  async function handleExtract() {
    setExtracting(true);
    try {
      const res: any = await extractFn({ data: {} });
      toast.success(`Extracted ${res.extracted} pattern${res.extracted !== 1 ? "s" : ""}`);
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Pattern extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleExtract} disabled={extracting} className="text-xs gap-1.5">
          {extracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Extract Patterns (AI)
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{patterns.length} pattern{patterns.length !== 1 ? "s" : ""}</span>
      </div>

      {isLoading && <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

      {!isLoading && patterns.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-14 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No patterns yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Scan agents first, then extract patterns</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {patterns.map((p) => (
          <div key={p.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold">{p.pattern_name}</p>
                <p className="text-[10px] text-muted-foreground">{p.category}</p>
              </div>
              <span className="text-[10px] border border-white/[0.08] rounded px-1.5 py-0.5 text-muted-foreground shrink-0">
                {Math.round((p.confidence_score ?? 0) * 100)}% confidence
              </span>
            </div>
            {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
            {(p.node_sequence ?? []).length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {(p.node_sequence as string[]).map((n, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <code className="text-[9px] bg-white/[0.04] border border-white/[0.05] rounded px-1 py-0.5 text-sky-300">{n}</code>
                    {i < (p.node_sequence as string[]).length - 1 && <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40" />}
                  </span>
                ))}
              </div>
            )}
            {(p.common_tools ?? []).length > 0 && (
              <p className="text-[10px] text-muted-foreground">Tools: {(p.common_tools as string[]).join(", ")}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Create Draft tab ──────────────────────────────────────────────────────────
function CreateDraftTab() {
  const qc = useQueryClient();
  const [description, setDescription] = useState("");
  const [category, setCategory]       = useState("Receptionist");
  const [creating, setCreating]       = useState(false);
  const [lastDraft, setLastDraft]     = useState<any>(null);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);

  const createFn  = useServerFn(createWorkflowDraft);
  const listFn    = useServerFn(getWorkflowDrafts);
  const deleteFn  = useServerFn(deleteWorkflowDraft);

  const { data: drafts, isLoading, refetch } = useQuery({
    queryKey: ["sm-drafts"],
    queryFn: () => listFn({ data: {} }),
  });
  const draftList: any[] = (drafts as any[]) ?? [];

  async function handleCreate() {
    if (!description.trim()) { toast.error("Enter a description"); return; }
    setCreating(true);
    try {
      const res: any = await createFn({ data: { description, category } });
      setLastDraft(res.draft);
      setOpenDraftId(res.draftId);
      toast.success("Draft workflow created");
      refetch();
      qc.invalidateQueries({ queryKey: ["sm-drafts"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Draft creation failed");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteFn({ data: { id } });
      toast.success("Draft deleted");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
        <p className="text-xs font-semibold">Generate Workflow Draft</p>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the workflow you want to create… e.g. 'A real estate intake agent that qualifies leads, books property viewings via Cal.com, and sends a confirmation WhatsApp'"
          className="text-xs min-h-[80px] resize-none"
        />
        <div className="flex gap-2">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={handleCreate} disabled={creating || !description.trim()} className="text-xs gap-1.5 shrink-0">
            {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Generate Draft
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Drafts are never deployed automatically. Review the structure in the Builder before using it.
        </p>
      </div>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

      {!isLoading && draftList.length === 0 && !lastDraft && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-10 text-center">
          <Sparkles className="h-7 w-7 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No drafts yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Fill in the form above to generate your first draft</p>
        </div>
      )}

      <div className="space-y-3">
        {draftList.map((d) => {
          const isOpen = openDraftId === d.id;
          const draftData = isOpen && lastDraft && openDraftId === d.id ? lastDraft : d;
          return (
            <div key={d.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <GitBranch className="h-4 w-4 text-sky-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{d.title}</p>
                  <p className="text-[10px] text-muted-foreground">{d.category} · {(d.nodes ?? []).length} nodes · draft</p>
                </div>
                <button onClick={() => setOpenDraftId(isOpen ? null : d.id)} className="text-muted-foreground hover:text-foreground">
                  {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-red-400" onClick={() => handleDelete(d.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              {isOpen && (
                <div className="border-t border-white/[0.06] px-4 py-3 space-y-3">
                  {/* Nodes */}
                  {(draftData.nodes ?? []).length > 0 && (
                    <section>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Nodes ({(draftData.nodes as any[]).length})</p>
                      <div className="space-y-1">
                        {(draftData.nodes as any[]).map((n: any, i: number) => (
                          <div key={i} className="flex items-center gap-2">
                            <code className="text-[9px] bg-white/[0.04] border border-white/[0.05] rounded px-1 py-0.5 text-sky-300 shrink-0">{n.type ?? n.id}</code>
                            <span className="text-xs text-muted-foreground truncate">{n.name ?? n.description ?? n.instruction ?? ""}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Variables */}
                  {(draftData.variables ?? []).length > 0 && (
                    <section>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Variables</p>
                      <div className="flex flex-wrap gap-1">
                        {(draftData.variables as any[]).map((v: any, i: number) => (
                          <span key={i} className="text-[10px] border border-white/[0.08] rounded px-1.5 py-0.5 text-muted-foreground">
                            {"{{"}{v.name}{"}}"} <span className="opacity-50">{v.type}</span>
                          </span>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Tools */}
                  {(draftData.tools ?? []).length > 0 && (
                    <section>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Tools</p>
                      {(draftData.tools as any[]).map((t: any, i: number) => (
                        <div key={i} className="text-xs text-muted-foreground">• <strong>{t.name}</strong>: {t.description}</div>
                      ))}
                    </section>
                  )}

                  {/* Suggestions */}
                  {(draftData.kb_suggestions ?? []).length > 0 && (
                    <section className="rounded-lg bg-sky-500/[0.05] border border-sky-500/10 px-3 py-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <BookOpen className="h-3 w-3 text-sky-400" />
                        <p className="text-[10px] font-semibold text-sky-400">KB Suggestions</p>
                      </div>
                      {(draftData.kb_suggestions as string[]).map((s, i) => (
                        <p key={i} className="text-xs text-muted-foreground">• {s}</p>
                      ))}
                    </section>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Inspect & Repair tab ──────────────────────────────────────────────────────
function RepairTab() {
  const [agentId, setAgentId]     = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [result, setResult]       = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  const agentListFn = useServerFn(getSystemMindAgentList);
  const inspectFn   = useServerFn(inspectWorkflowRepair);
  const submitFn    = useServerFn(submitRepairPlanToHiveMind);

  const { data: agents } = useQuery({
    queryKey: ["sm-agent-list"],
    queryFn: () => agentListFn({ data: {} }),
  });
  const agentList: any[] = (agents as any[]) ?? [];

  async function handleInspect() {
    if (!agentId) { toast.error("Select an agent"); return; }
    setInspecting(true);
    setResult(null);
    try {
      const res: any = await inspectFn({ data: { agentId } });
      setResult(res);
    } catch (e: any) {
      toast.error(e?.message ?? "Inspection failed");
    } finally {
      setInspecting(false);
    }
  }

  async function handleSubmitToHiveMind() {
    if (!result) return;
    setSubmitting(true);
    try {
      await submitFn({
        data: {
          agentName: result.agentName,
          summary: result.summary,
          issueCount: result.issues?.length ?? 0,
        },
      });
      toast.success("Repair plan submitted to HiveMind event log");
    } catch (e: any) {
      toast.error(e?.message ?? "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Picker */}
      <div className="flex gap-2">
        <Select value={agentId} onValueChange={setAgentId}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue placeholder="Select an agent to inspect…" />
          </SelectTrigger>
          <SelectContent>
            {agentList.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name} {a.agent_type ? `(${a.agent_type.replace(/_/g, " ")})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={handleInspect} disabled={!agentId || inspecting} className="text-xs gap-1.5 shrink-0">
          {inspecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
          Inspect
        </Button>
      </div>

      {inspecting && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-14 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-sky-400 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Running structural analysis…</p>
        </div>
      )}

      {result && !inspecting && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">"{result.agentName}" — Repair Report</p>
              <div className="flex items-center gap-1.5">
                {result.issues?.length === 0 ? (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> Clean
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> {result.issues.length} issue{result.issues.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{result.summary}</p>
            {result.requiresApproval && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1.5 mt-1"
                onClick={handleSubmitToHiveMind}
                disabled={submitting}
              >
                {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />}
                Submit to HiveMind
              </Button>
            )}
          </div>

          {/* Issues */}
          {(result.issues as RepairIssue[]).length > 0 && (
            <div className="space-y-2">
              {(result.issues as RepairIssue[]).map((issue, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-xl border px-4 py-3 space-y-1",
                    RISK_COLORS[issue.riskLevel] ?? RISK_COLORS.medium,
                  )}
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-xs font-semibold">{issue.problem}</span>
                    <span className="ml-auto text-[10px] opacity-70">{issue.confidence}% confidence</span>
                  </div>
                  <p className="text-xs opacity-75 ml-5">{issue.impact}</p>
                  <div className="ml-5 space-y-0.5">
                    <p className="text-[10px] opacity-60 uppercase tracking-wide font-semibold">Fix</p>
                    <p className="text-xs opacity-75">{issue.suggestedFix}</p>
                  </div>
                  <div className="ml-5 space-y-0.5">
                    <p className="text-[10px] opacity-60 uppercase tracking-wide font-semibold">Rollback</p>
                    <p className="text-xs opacity-75">{issue.rollbackPlan}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(result.issues as RepairIssue[]).length === 0 && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 text-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-400 mx-auto mb-1.5" />
              <p className="text-sm font-medium text-emerald-400">All structural checks passed</p>
              <p className="text-xs text-muted-foreground mt-0.5">No disconnected nodes, broken handles, or missing config detected.</p>
            </div>
          )}
        </div>
      )}

      {!result && !inspecting && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-14 text-center">
          <Wrench className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Select an agent and click Inspect</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Runs 7 structural checks + AI repair analysis</p>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function SystemMindWorkflowsPage() {
  const search = useSearch({ from: "/_authenticated/systemmind/workflows" });
  const initialTab = (TABS as readonly string[]).includes(search.tab) ? search.tab as Tab : "Library";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Workflow Library</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Scan, analyse, and generate AI agent workflows. Inspect for issues before deployment.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] gap-4">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "pb-2 text-xs font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab
                ? "border-sky-400 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Library"          && <LibraryTab initialHealth={search.health} />}
      {activeTab === "Patterns"         && <PatternsTab />}
      {activeTab === "Create Draft"     && <CreateDraftTab />}
      {activeTab === "Inspect & Repair" && <RepairTab />}
    </div>
  );
}
