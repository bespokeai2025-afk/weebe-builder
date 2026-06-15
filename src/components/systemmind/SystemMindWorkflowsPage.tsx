import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  GitBranch, RefreshCw, Loader2, Sparkles, Wrench, Trash2,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronUp,
  Bot, Webhook, BookOpen, Users, ArrowRight, Copy,
  BarChart2, Zap, ArrowLeftRight, TrendingUp,
  Phone, FileText, MessageCircle, CalendarClock,
  Wand2, X, MinusCircle,
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
  getWorkflowIntelligence,
  cloneWorkflowToDraft,
  compareWorkflows,
  generateFromExample,
  getWorkflowSuccessRates,
  previewAndApplyWorkflowFix,
} from "@/lib/systemmind/systemmind-workflow.functions";
import type { RepairIssue, WorkflowFixDiff } from "@/lib/systemmind/systemmind-workflow.server";

const AUTO_FIXABLE_TYPES = new Set(["disconnected_node", "broken_edge_handle"]);
function issueCanAutoFix(issue: RepairIssue): boolean {
  return (
    (issue.riskLevel === "low" || issue.riskLevel === "medium") &&
    AUTO_FIXABLE_TYPES.has(issue.type)
  );
}

const TABS = [
  "Library",
  "Score & Health",
  "Generate",
  "Compare",
  "Patterns",
  "Inspect & Repair",
] as const;
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

function workflowNeedsRepair(row: any): boolean {
  const nc = Number(row.node_count ?? 0);
  const ec = Number(row.edge_count ?? 0);
  return nc === 0 || (nc > 1 && ec === 0);
}

// ── Score badge ────────────────────────────────────────────────────────────────
function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 80 ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/[0.08]"
    : score >= 60 ? "text-sky-400 border-sky-500/30 bg-sky-500/[0.08]"
    : score >= 40 ? "text-amber-400 border-amber-500/30 bg-amber-500/[0.08]"
    : "text-red-400 border-red-500/30 bg-red-500/[0.08]";
  return (
    <span className={cn("text-[10px] font-bold border rounded px-1.5 py-0.5", cls)}>
      {score}
    </span>
  );
}

function HealthBadge({ label, badgeClass }: { label: string; badgeClass: string }) {
  return (
    <span className={cn("text-[10px] rounded px-1.5 py-0.5 font-medium", badgeClass)}>
      {label}
    </span>
  );
}

function ComplexityBadge({ label, color }: { label: string; color: string }) {
  return <span className={cn("text-[10px]", color)}>{label}</span>;
}

function SuccessRateBadge({ sr }: { sr: { total: number; successful: number; rate: number } | null }) {
  if (!sr || sr.total === 0) return <span className="text-[10px] text-muted-foreground/40">No data</span>;
  const cls =
    sr.rate >= 80 ? "text-emerald-400"
    : sr.rate >= 60 ? "text-sky-400"
    : sr.rate >= 40 ? "text-amber-400"
    : "text-red-400";
  return (
    <span className={cn("text-[10px] font-medium", cls)} title={`${sr.successful}/${sr.total} calls succeeded`}>
      {sr.rate}%
    </span>
  );
}

// ── Library tab ────────────────────────────────────────────────────────────────
function LibraryTab({ initialHealth = "all" }: { initialHealth?: string }) {
  const [catFilter, setCatFilter] = useState("all");
  const [healthFilter, setHealthFilter] = useState<"all" | "healthy" | "needs-repair">(
    initialHealth === "healthy" || initialHealth === "needs-repair"
      ? (initialHealth as any)
      : "all",
  );
  const [scanning, setScanning]   = useState(false);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const qc = useQueryClient();

  const listFn   = useServerFn(getWorkflowLibrary);
  const scanFn   = useServerFn(scanAgentWorkflows);
  const intellFn = useServerFn(getWorkflowIntelligence);
  const cloneFn  = useServerFn(cloneWorkflowToDraft);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sm-wl", catFilter],
    queryFn: () => listFn({ data: { category: catFilter !== "all" ? catFilter : undefined } }),
  });

  const { data: intellData } = useQuery({
    queryKey: ["sm-intel"],
    queryFn: () => intellFn({ data: {} }),
    enabled: !isLoading,
  });

  const intellMap: Record<string, any> = {};
  ((intellData as any[]) ?? []).forEach((r: any) => { intellMap[r.agent_id] = r; });

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
      const parts = [`${res.scanned} agent${res.scanned !== 1 ? "s" : ""}`];
      if (res.live > 0) parts.push(`${res.live} live`);
      parts.push(`${res.stored} stored`);
      if (res.templates > 0) parts.push(`${res.templates} template${res.templates !== 1 ? "s" : ""}`);
      if (res.campaigns > 0) parts.push(`${res.campaigns} campaign${res.campaigns !== 1 ? "s" : ""}`);
      toast.success(`Scanned all sources — ${parts.join(" · ")}`);
      refetch();
      qc.invalidateQueries({ queryKey: ["sm-intel"] });
    } catch (e: any) { toast.error(e?.message ?? "Scan failed"); }
    finally { setScanning(false); }
  }

  async function handleClone(row: any) {
    setCloningId(row.agent_id);
    try {
      const res: any = await cloneFn({ data: { agentId: row.agent_id, newTitle: `Clone of ${row.workflow_name}` } });
      toast.success(`Cloned as draft: "${res.title}"`);
      qc.invalidateQueries({ queryKey: ["sm-drafts"] });
    } catch (e: any) { toast.error(e?.message ?? "Clone failed"); }
    finally { setCloningId(null); }
  }

  const HEALTH_FILTERS = [
    { value: "all" as const,          label: `All (${allRows.length})` },
    { value: "healthy" as const,      label: `Healthy (${allRows.filter((r) => !workflowNeedsRepair(r)).length})` },
    { value: "needs-repair" as const, label: `Need repair (${allRows.filter(workflowNeedsRepair).length})` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={handleScan} disabled={scanning} className="text-xs gap-1.5">
          {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Scan All Sources
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
        {rows.map((row) => {
          const intel = intellMap[row.agent_id];
          const score: number = intel?.score ?? 0;
          const health = intel?.health ?? { label: "—", badgeClass: "bg-white/[0.04] text-muted-foreground" };
          const complexity = intel?.complexity ?? { label: "—", color: "text-muted-foreground" };
          return (
            <div key={row.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <div className="flex items-start gap-3">
                <Bot className="h-4 w-4 text-sky-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold">{row.workflow_name}</span>
                    {row.deployment_mode === "live" && (
                      <span className="text-[10px] border border-emerald-500/40 bg-emerald-500/10 rounded px-1.5 py-0.5 text-emerald-400 font-medium">
                        Live
                      </span>
                    )}
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
                    {intel && <ScoreBadge score={score} />}
                    {intel && <HealthBadge label={health.label} badgeClass={health.badgeClass} />}
                    {intel && <ComplexityBadge label={complexity.label} color={complexity.color} />}
                    {intel?.successRate && intel.successRate.total > 0 && (
                      <span className="text-[10px] text-muted-foreground/60" title="Call success rate">
                        <SuccessRateBadge sr={intel.successRate} /> success
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-sky-300 shrink-0"
                  disabled={cloningId === row.agent_id}
                  onClick={() => handleClone(row)}
                >
                  {cloningId === row.agent_id
                    ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    : <Copy className="h-2.5 w-2.5" />}
                  Clone
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Score & Health tab ─────────────────────────────────────────────────────────
function ScoreHealthTab() {
  const intellFn = useServerFn(getWorkflowIntelligence);
  const scanFn   = useServerFn(scanAgentWorkflows);
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sm-intel"],
    queryFn: () => intellFn({ data: {} }),
  });

  const rows: any[] = (data as any[]) ?? [];

  async function handleScan() {
    setScanning(true);
    try {
      const res: any = await scanFn({ data: {} });
      const parts = [`${res.scanned} agent${res.scanned !== 1 ? "s" : ""}`];
      if (res.live > 0) parts.push(`${res.live} live`);
      parts.push(`${res.stored} stored`);
      if (res.templates > 0) parts.push(`${res.templates} template${res.templates !== 1 ? "s" : ""}`);
      if (res.campaigns > 0) parts.push(`${res.campaigns} campaign${res.campaigns !== 1 ? "s" : ""}`);
      toast.success(`Scanned all sources — ${parts.join(" · ")}`);
      refetch();
      qc.invalidateQueries({ queryKey: ["sm-wl"] });
    } catch (e: any) { toast.error(e?.message ?? "Scan failed"); }
    finally { setScanning(false); }
  }

  const healthy   = rows.filter((r) => r.score >= 80).length;
  const good      = rows.filter((r) => r.score >= 60 && r.score < 80).length;
  const attention = rows.filter((r) => r.score >= 40 && r.score < 60).length;
  const critical  = rows.filter((r) => r.score < 40).length;
  const avg       = rows.length ? Math.round(rows.reduce((a, r) => a + r.score, 0) / rows.length) : 0;

  // Success rate aggregates
  const rowsWithCalls = rows.filter((r) => r.successRate && r.successRate.total > 0);
  const avgSuccessRate = rowsWithCalls.length
    ? Math.round(rowsWithCalls.reduce((a, r) => a + r.successRate.rate, 0) / rowsWithCalls.length)
    : null;

  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const top5   = sorted.slice(0, 5);
  const bot5   = sorted.slice(-5).reverse();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleScan} disabled={scanning} className="text-xs gap-1.5">
          {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh Scores
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{rows.length} workflows analysed</span>
      </div>

      {isLoading && <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

      {!isLoading && rows.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-14 text-center">
          <BarChart2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No workflows to score yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Scan agents on the Library tab first</p>
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "Avg Score",      value: avg,                                          unit: "/100", cls: "text-sky-400" },
              { label: "Avg Success",    value: avgSuccessRate !== null ? avgSuccessRate : "—", unit: avgSuccessRate !== null ? "%" : "", cls: avgSuccessRate !== null && avgSuccessRate >= 80 ? "text-emerald-400" : avgSuccessRate !== null && avgSuccessRate >= 60 ? "text-sky-400" : "text-amber-400" },
              { label: "Healthy",        value: healthy,                                       unit: "",    cls: "text-emerald-400" },
              { label: "Good",           value: good,                                          unit: "",    cls: "text-sky-400" },
              { label: "Needs Attn",     value: attention,                                     unit: "",    cls: "text-amber-400" },
              { label: "Critical",       value: critical,                                      unit: "",    cls: "text-red-400" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
                <p className={cn("text-xl font-bold", s.cls)}>{s.value}<span className="text-xs font-normal text-muted-foreground">{s.unit}</span></p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Health distribution bar */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-xs font-semibold mb-3">Health Distribution</p>
            <div className="flex h-3 rounded-full overflow-hidden gap-px">
              {healthy   > 0 && <div className="bg-emerald-500/70 transition-all" style={{ flex: healthy   }} title={`Healthy: ${healthy}`} />}
              {good      > 0 && <div className="bg-sky-500/70 transition-all"     style={{ flex: good      }} title={`Good: ${good}`} />}
              {attention > 0 && <div className="bg-amber-500/70 transition-all"   style={{ flex: attention }} title={`Needs attention: ${attention}`} />}
              {critical  > 0 && <div className="bg-red-500/70 transition-all"     style={{ flex: critical  }} title={`Critical: ${critical}`} />}
              {rows.length === 0 && <div className="bg-white/10 flex-1" />}
            </div>
            <div className="flex gap-4 mt-2 flex-wrap">
              {[
                { label: "Healthy ≥ 80",      cls: "bg-emerald-500/70", count: healthy   },
                { label: "Good 60–79",         cls: "bg-sky-500/70",     count: good      },
                { label: "Needs attn 40–59",   cls: "bg-amber-500/70",   count: attention },
                { label: "Critical < 40",      cls: "bg-red-500/70",     count: critical  },
              ].map((l) => (
                <span key={l.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className={cn("inline-block h-2 w-2 rounded-sm", l.cls)} />
                  {l.label} ({l.count})
                </span>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {/* Top 5 */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> Top Workflows
              </p>
              {top5.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <ScoreBadge score={r.score} />
                  <span className="text-xs text-muted-foreground truncate flex-1">{r.workflow_name}</span>
                  <ComplexityBadge label={r.complexity.label} color={r.complexity.color} />
                </div>
              ))}
            </div>

            {/* Bottom 5 */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Needs Attention
              </p>
              {bot5.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <ScoreBadge score={r.score} />
                  <span className="text-xs text-muted-foreground truncate flex-1">{r.workflow_name}</span>
                  <HealthBadge label={r.health.label} badgeClass={r.health.badgeClass} />
                </div>
              ))}
            </div>
          </div>

          {/* Full table */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="grid grid-cols-[1fr_60px_80px_70px_60px_80px] gap-2 px-4 py-2 border-b border-white/[0.05] text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">
              <span>Workflow</span>
              <span className="text-right">Score</span>
              <span>Health</span>
              <span>Complexity</span>
              <span className="text-right">Nodes</span>
              <span className="text-right" title="Completion rate: calls with status 'completed' / total calls">Success Rate</span>
            </div>
            {sorted.map((r) => (
              <div key={r.id} className="grid grid-cols-[1fr_60px_80px_70px_60px_80px] gap-2 px-4 py-2.5 border-b border-white/[0.03] last:border-0 items-center">
                <div className="min-w-0">
                  <p className="text-xs truncate">{r.workflow_name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{r.category}</p>
                </div>
                <div className="flex justify-end"><ScoreBadge score={r.score} /></div>
                <HealthBadge label={r.health.label} badgeClass={r.health.badgeClass} />
                <ComplexityBadge label={r.complexity.label} color={r.complexity.color} />
                <span className="text-[10px] text-muted-foreground text-right">{r.node_count}</span>
                <div className="flex justify-end"><SuccessRateBadge sr={r.successRate ?? null} /></div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Generate tab ───────────────────────────────────────────────────────────────
const EXAMPLE_ICONS: Record<string, React.ComponentType<any>> = {
  receptionist:     Phone,
  qualification:    Zap,
  legal_intake:     FileText,
  whatsapp_flow:    MessageCircle,
  followup_campaign: CalendarClock,
};

const EXAMPLES = [
  {
    key: "receptionist",
    title: "Receptionist",
    subtitle: "Call handler & router",
    description: "Greets callers, collects intent, routes to department or books an appointment.",
    tags: ["routing", "booking", "FAQ"],
    complexity: "Moderate",
    estimatedNodes: "6–9",
  },
  {
    key: "qualification",
    title: "Qualification Agent",
    subtitle: "Lead scoring & routing",
    description: "Qualifies leads with structured questions, scores them, routes high-value prospects.",
    tags: ["lead-scoring", "sales", "booking"],
    complexity: "Moderate",
    estimatedNodes: "7–10",
  },
  {
    key: "legal_intake",
    title: "Legal Intake",
    subtitle: "Case intake & consultation",
    description: "Collects case details, checks conflicts, schedules consultations via Cal.com.",
    tags: ["legal", "intake", "booking"],
    complexity: "Complex",
    estimatedNodes: "8–12",
  },
  {
    key: "whatsapp_flow",
    title: "WhatsApp Flow",
    subtitle: "Conversational WA automation",
    description: "Handles WA messages, responds from KB, escalates to human when needed.",
    tags: ["whatsapp", "messaging", "KB"],
    complexity: "Moderate",
    estimatedNodes: "6–8",
  },
  {
    key: "followup_campaign",
    title: "Follow-Up Campaign",
    subtitle: "Multi-touch nurture sequence",
    description: "Personalised outreach, handles objections, books demos, respects opt-outs.",
    tags: ["follow-up", "nurture", "campaign"],
    complexity: "Complex",
    estimatedNodes: "8–11",
  },
];

function GenerateTab({
  prefill,
  onClearPrefill,
}: {
  prefill?: { description: string; category: string } | null;
  onClearPrefill?: () => void;
}) {
  const qc = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [customDesc, setCustomDesc]   = useState("");
  const [category, setCategory]       = useState("Receptionist");
  const [description, setDescription] = useState("");
  const [mode, setMode]               = useState<"examples" | "custom">("examples");
  const [creating, setCreating]       = useState(false);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [lastDraft, setLastDraft]     = useState<any>(null);

  // Apply prefill when it arrives (from "Generate from Pattern")
  useEffect(() => {
    if (prefill) {
      setMode("custom");
      setDescription(prefill.description);
      setCategory(prefill.category);
      onClearPrefill?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const fromExFn  = useServerFn(generateFromExample);
  const createFn  = useServerFn(createWorkflowDraft);
  const listFn    = useServerFn(getWorkflowDrafts);
  const deleteFn  = useServerFn(deleteWorkflowDraft);

  const { data: drafts, isLoading, refetch } = useQuery({
    queryKey: ["sm-drafts"],
    queryFn: () => listFn({ data: {} }),
  });
  const draftList: any[] = (drafts as any[]) ?? [];

  async function handleGenerateExample() {
    if (!selectedKey) { toast.error("Select an example first"); return; }
    setCreating(true);
    try {
      const res: any = await fromExFn({ data: { exampleKey: selectedKey, customDesc } });
      setLastDraft(res.draft);
      setOpenDraftId(res.draftId);
      toast.success(`Draft created: "${res.draft?.title ?? "Workflow"}"`);
      refetch();
      qc.invalidateQueries({ queryKey: ["sm-drafts"] });
    } catch (e: any) { toast.error(e?.message ?? "Generate failed"); }
    finally { setCreating(false); }
  }

  async function handleCustomCreate() {
    if (!description.trim()) { toast.error("Enter a description"); return; }
    setCreating(true);
    try {
      const res: any = await createFn({ data: { description, category } });
      setLastDraft(res.draft);
      setOpenDraftId(res.draftId);
      toast.success("Draft workflow created");
      refetch();
      qc.invalidateQueries({ queryKey: ["sm-drafts"] });
    } catch (e: any) { toast.error(e?.message ?? "Draft creation failed"); }
    finally { setCreating(false); }
  }

  async function handleDelete(id: string) {
    try {
      await deleteFn({ data: { id } });
      toast.success("Draft deleted");
      refetch();
    } catch (e: any) { toast.error(e?.message ?? "Delete failed"); }
  }

  return (
    <div className="space-y-5">
      {/* Mode switcher */}
      <div className="flex gap-1.5">
        {(["examples", "custom"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors",
              mode === m
                ? "bg-sky-500/20 border-sky-500/40 text-sky-300"
                : "bg-white/[0.02] border-white/[0.08] text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "examples" ? "Example Templates" : "Custom Generate"}
          </button>
        ))}
      </div>

      {mode === "examples" && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Pick a template. SystemMind uses Architecture KB, Workflow KB, and Repair KB to build it.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {EXAMPLES.map((ex) => {
              const Icon = EXAMPLE_ICONS[ex.key] ?? Bot;
              return (
                <button
                  key={ex.key}
                  onClick={() => setSelectedKey(ex.key === selectedKey ? null : ex.key)}
                  className={cn(
                    "rounded-xl border p-4 text-left space-y-2 transition-all",
                    selectedKey === ex.key
                      ? "border-sky-500/50 bg-sky-500/[0.08]"
                      : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className={cn("rounded-lg p-1.5", selectedKey === ex.key ? "bg-sky-500/20" : "bg-white/[0.05]")}>
                      <Icon className={cn("h-4 w-4", selectedKey === ex.key ? "text-sky-400" : "text-muted-foreground")} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold">{ex.title}</p>
                      <p className="text-[10px] text-muted-foreground">{ex.subtitle}</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{ex.description}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-muted-foreground/60">{ex.complexity} · ~{ex.estimatedNodes} nodes</span>
                    <div className="flex gap-1">
                      {ex.tags.slice(0, 2).map((t) => (
                        <span key={t} className="text-[9px] border border-white/[0.08] rounded px-1 py-0.5 text-muted-foreground">{t}</span>
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedKey && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
              <p className="text-xs font-semibold">Additional requirements (optional)</p>
              <Textarea
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
                placeholder="Add any specific requirements, e.g. 'Use WhatsApp instead of voice, integrate with HubSpot'"
                className="text-xs min-h-[60px] resize-none"
              />
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">Grounded in Architecture KB + Workflow KB + Repair KB</p>
                <Button
                  size="sm"
                  onClick={handleGenerateExample}
                  disabled={creating}
                  className="text-xs gap-1.5"
                >
                  {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Generate Draft
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "custom" && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
          <p className="text-xs font-semibold">Custom Workflow Description</p>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the workflow you want to create… e.g. 'A real estate intake agent that qualifies leads, books viewings via Cal.com, and sends a confirmation WhatsApp'"
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
            <Button
              size="sm"
              onClick={handleCustomCreate}
              disabled={creating || !description.trim()}
              className="text-xs gap-1.5 shrink-0"
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Generate Draft
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Drafts are never deployed automatically. Review the structure in the Builder before using it.
          </p>
        </div>
      )}

      {/* Drafts list */}
      {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

      {!isLoading && draftList.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-10 text-center">
          <Sparkles className="h-7 w-7 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No drafts yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Pick a template above to generate your first draft</p>
        </div>
      )}

      <div className="space-y-3">
        {draftList.map((d) => {
          const isOpen = openDraftId === d.id;
          const draftData = isOpen && lastDraft ? lastDraft : d;
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
                  {(draftData.tools ?? []).length > 0 && (
                    <section>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Tools</p>
                      {(draftData.tools as any[]).map((t: any, i: number) => (
                        <div key={i} className="text-xs text-muted-foreground">• <strong>{t.name}</strong>: {t.description}</div>
                      ))}
                    </section>
                  )}
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

// ── Compare tab ────────────────────────────────────────────────────────────────
function CompareTab() {
  const [agentIdA, setAgentIdA] = useState("");
  const [agentIdB, setAgentIdB] = useState("");
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<any>(null);

  const agentListFn = useServerFn(getSystemMindAgentList);
  const compareFn   = useServerFn(compareWorkflows);

  const { data: agents } = useQuery({
    queryKey: ["sm-agent-list"],
    queryFn: () => agentListFn({ data: {} }),
  });
  const agentList: any[] = (agents as any[]) ?? [];

  async function handleCompare() {
    if (!agentIdA || !agentIdB) { toast.error("Select two workflows to compare"); return; }
    if (agentIdA === agentIdB) { toast.error("Select two different workflows"); return; }
    setComparing(true);
    setResult(null);
    try {
      const res = await compareFn({ data: { agentIdA, agentIdB } });
      setResult(res);
    } catch (e: any) { toast.error(e?.message ?? "Comparison failed"); }
    finally { setComparing(false); }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Select two agents from your scanned workflow library to compare them side by side using AI analysis.
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Workflow A</p>
          <Select value={agentIdA} onValueChange={setAgentIdA}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select workflow A…" />
            </SelectTrigger>
            <SelectContent>
              {agentList.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} {a.agent_type ? `(${a.agent_type.replace(/_/g, " ")})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Workflow B</p>
          <Select value={agentIdB} onValueChange={setAgentIdB}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select workflow B…" />
            </SelectTrigger>
            <SelectContent>
              {agentList.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} {a.agent_type ? `(${a.agent_type.replace(/_/g, " ")})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        size="sm"
        onClick={handleCompare}
        disabled={!agentIdA || !agentIdB || comparing}
        className="text-xs gap-1.5"
      >
        {comparing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowLeftRight className="h-3 w-3" />}
        Compare Workflows
      </Button>

      {comparing && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-14 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-sky-400 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Running AI comparison…</p>
        </div>
      )}

      {!comparing && !result && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-14 text-center">
          <ArrowLeftRight className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Select two workflows and click Compare</p>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Scores header */}
          <div className="grid grid-cols-2 gap-3">
            {([
              { name: result.agentAName, score: result.scoreA, cx: result.complexityA, winner: result.winnerKey === "A" },
              { name: result.agentBName, score: result.scoreB, cx: result.complexityB, winner: result.winnerKey === "B" },
            ] as any[]).map((w, i) => (
              <div key={i} className={cn(
                "rounded-xl border p-4 space-y-1",
                w.winner ? "border-sky-500/40 bg-sky-500/[0.06]" : "border-white/[0.07] bg-white/[0.02]",
              )}>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold truncate flex-1">{w.name}</p>
                  {w.winner && result.winnerKey !== "tie" && (
                    <span className="text-[10px] bg-sky-500/20 text-sky-300 rounded px-1.5 py-0.5 shrink-0">Winner</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <ScoreBadge score={w.score} />
                  <span className="text-[10px] text-muted-foreground">{w.cx}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Similarities */}
          {result.similarities?.length > 0 && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Similarities</p>
              {result.similarities.map((s: string, i: number) => (
                <p key={i} className="text-xs text-muted-foreground">• {s}</p>
              ))}
            </div>
          )}

          {/* Differences */}
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { label: `${result.agentAName} unique strengths`, items: result.differencesA, color: "text-sky-400", border: "border-sky-500/20" },
              { label: `${result.agentBName} unique strengths`, items: result.differencesB, color: "text-violet-400", border: "border-violet-500/20" },
            ].map((col) => (
              <div key={col.label} className={cn("rounded-xl border bg-white/[0.02] p-4 space-y-2", col.border)}>
                <p className={cn("text-xs font-semibold", col.color)}>{col.label}</p>
                {(col.items as string[]).length === 0
                  ? <p className="text-xs text-muted-foreground">None identified</p>
                  : (col.items as string[]).map((s, i) => (
                      <p key={i} className="text-xs text-muted-foreground">• {s}</p>
                    ))
                }
              </div>
            ))}
          </div>

          {/* Recommendation */}
          {result.recommendation && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 space-y-1">
              <p className="text-xs font-semibold text-emerald-400">Recommendation</p>
              <p className="text-xs text-muted-foreground">{result.recommendation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Patterns tab ──────────────────────────────────────────────────────────────
function PatternsTab({ onGenerateFromPattern }: { onGenerateFromPattern: (description: string, category: string) => void }) {
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
    } catch (e: any) { toast.error(e?.message ?? "Pattern extraction failed"); }
    finally { setExtracting(false); }
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
          <p className="text-xs text-muted-foreground/60 mt-1">Scan agents first, then extract patterns to find reusable structures</p>
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
            <div className="pt-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px] gap-1 text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 -ml-2"
                onClick={() => onGenerateFromPattern(
                  `${p.pattern_name}: ${p.description ?? p.pattern_name}. Node sequence: ${(p.node_sequence ?? []).join(" → ")}. Tools: ${(p.common_tools ?? []).join(", ") || "none"}.`,
                  p.category,
                )}
              >
                <Sparkles className="h-2.5 w-2.5" />
                Create from this pattern
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Diff preview panel ────────────────────────────────────────────────────────
function DiffPanel({
  diff,
  onConfirm,
  onCancel,
  confirming,
}: {
  diff: WorkflowFixDiff;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
}) {
  const hasChanges =
    diff.removedNodes.length > 0 ||
    diff.removedEdges.length > 0 ||
    diff.addedNodes.length > 0 ||
    diff.addedEdges.length > 0;

  return (
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/[0.05] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-sky-300 flex items-center gap-1.5">
          <Wand2 className="h-3.5 w-3.5" /> Auto-fix preview
        </p>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!hasChanges && (
        <p className="text-xs text-muted-foreground">No changes would be made — the issue may have already been resolved.</p>
      )}

      {diff.removedNodes.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide font-semibold">Nodes to remove</p>
          {diff.removedNodes.map((n) => (
            <div key={n.id} className="flex items-center gap-2 rounded-md bg-red-500/[0.08] border border-red-500/20 px-2.5 py-1.5">
              <MinusCircle className="h-3 w-3 text-red-400 shrink-0" />
              <span className="text-xs text-red-300 font-mono">{n.label ?? n.id}</span>
              {n.type && <span className="text-[10px] text-muted-foreground ml-auto">{n.type}</span>}
            </div>
          ))}
        </div>
      )}

      {diff.removedEdges.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide font-semibold">Edges to remove</p>
          {diff.removedEdges.map((e) => (
            <div key={e.id} className="flex items-center gap-2 rounded-md bg-red-500/[0.08] border border-red-500/20 px-2.5 py-1.5">
              <MinusCircle className="h-3 w-3 text-red-400 shrink-0" />
              <span className="text-xs text-red-300 font-mono truncate">
                {e.source} <ArrowRight className="h-2.5 w-2.5 inline" /> {e.target}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60">
        This change writes directly to the agent's flow data. Re-run Inspect after applying to confirm the issue is resolved.
      </p>

      <div className="flex gap-2">
        <Button
          size="sm"
          className="text-xs gap-1.5 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30"
          onClick={onConfirm}
          disabled={confirming || !hasChanges}
        >
          {confirming ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          Confirm fix
        </Button>
        <Button size="sm" variant="ghost" className="text-xs" onClick={onCancel} disabled={confirming}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Inspect & Repair tab ──────────────────────────────────────────────────────
function RepairTab() {
  const [agentId, setAgentId]       = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [result, setResult]         = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [diffState, setDiffState]   = useState<{
    issueIdx: number;
    issue: RepairIssue;
    diff: WorkflowFixDiff;
  } | null>(null);
  const [previewingIdx, setPreviewingIdx] = useState<number | null>(null);
  const [confirmingIdx, setConfirmingIdx] = useState<number | null>(null);

  const agentListFn  = useServerFn(getSystemMindAgentList);
  const inspectFn    = useServerFn(inspectWorkflowRepair);
  const submitFn     = useServerFn(submitRepairPlanToHiveMind);
  const fixFn        = useServerFn(previewAndApplyWorkflowFix);

  const { data: agents } = useQuery({
    queryKey: ["sm-agent-list"],
    queryFn: () => agentListFn({ data: {} }),
  });
  const agentList: any[] = (agents as any[]) ?? [];

  async function handleInspect() {
    if (!agentId) { toast.error("Select an agent"); return; }
    setInspecting(true);
    setResult(null);
    setDiffState(null);
    try {
      const res: any = await inspectFn({ data: { agentId } });
      setResult(res);
    } catch (e: any) { toast.error(e?.message ?? "Inspection failed"); }
    finally { setInspecting(false); }
  }

  async function handleSubmitToHiveMind() {
    if (!result) return;
    setSubmitting(true);
    try {
      await submitFn({ data: { agentName: result.agentName, summary: result.summary, issueCount: result.issues?.length ?? 0 } });
      toast.success("Repair plan submitted to HiveMind event log");
    } catch (e: any) { toast.error(e?.message ?? "Submit failed"); }
    finally { setSubmitting(false); }
  }

  async function handlePreviewFix(issue: RepairIssue, issueIdx: number) {
    setPreviewingIdx(issueIdx);
    setDiffState(null);
    try {
      const res: any = await fixFn({ data: { agentId, issue, dryRun: true } });
      setDiffState({ issueIdx, issue, diff: res.diff });
    } catch (e: any) { toast.error(e?.message ?? "Preview failed"); }
    finally { setPreviewingIdx(null); }
  }

  async function handleConfirmFix() {
    if (!diffState) return;
    setConfirmingIdx(diffState.issueIdx);
    try {
      await fixFn({ data: { agentId, issue: diffState.issue, dryRun: false } });
      toast.success("Fix applied — re-running inspection…");
      setDiffState(null);
      setResult(null);
      setInspecting(true);
      try {
        const res: any = await inspectFn({ data: { agentId } });
        setResult(res);
      } catch { /* graceful */ }
      finally { setInspecting(false); }
    } catch (e: any) { toast.error(e?.message ?? "Apply failed"); }
    finally { setConfirmingIdx(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Select value={agentId} onValueChange={(v) => { setAgentId(v); setResult(null); setDiffState(null); }}>
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
              <Button size="sm" variant="outline" className="text-xs gap-1.5 mt-1" onClick={handleSubmitToHiveMind} disabled={submitting}>
                {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />}
                Submit to HiveMind
              </Button>
            )}
          </div>

          {(result.issues as RepairIssue[]).length > 0 && (
            <div className="space-y-2">
              {(result.issues as RepairIssue[]).map((issue, i) => (
                <div key={i} className="space-y-2">
                  <div className={cn("rounded-xl border px-4 py-3 space-y-1", RISK_COLORS[issue.riskLevel] ?? RISK_COLORS.medium)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-xs font-semibold flex-1 min-w-0">{issue.problem}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] opacity-70">{issue.confidence}% confidence</span>
                        {issueCanAutoFix(issue) ? (
                          <button
                            onClick={() => handlePreviewFix(issue, i)}
                            disabled={previewingIdx === i || confirmingIdx === i}
                            className={cn(
                              "flex items-center gap-1 text-[10px] font-semibold rounded px-1.5 py-0.5 border transition-colors",
                              "bg-sky-500/20 border-sky-500/30 text-sky-300 hover:bg-sky-500/30",
                              "disabled:opacity-50 disabled:cursor-not-allowed",
                            )}
                          >
                            {previewingIdx === i
                              ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              : <Wand2 className="h-2.5 w-2.5" />}
                            Auto-fix
                          </button>
                        ) : (
                          <span className="text-[10px] opacity-50 italic">Manual fix required</span>
                        )}
                      </div>
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

                  {diffState?.issueIdx === i && (
                    <DiffPanel
                      diff={diffState.diff}
                      onConfirm={handleConfirmFix}
                      onCancel={() => setDiffState(null)}
                      confirming={confirmingIdx === i}
                    />
                  )}
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
          <p className="text-xs text-muted-foreground/60 mt-1">Runs 7 structural checks + AI repair analysis · low/medium issues can be auto-fixed</p>
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
  const [generatePrefill, setGeneratePrefill] = useState<{ description: string; category: string } | null>(null);

  function handleGenerateFromPattern(description: string, category: string) {
    setGeneratePrefill({ description, category });
    setActiveTab("Generate");
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Workflow Intelligence</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Score, analyse, clone, and generate workflows across all agents, templates, and campaigns. Grounded in Architecture KB, Workflow KB, and Repair KB.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] gap-4 overflow-x-auto no-scrollbar">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "pb-2 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
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
      {activeTab === "Score & Health"   && <ScoreHealthTab />}
      {activeTab === "Generate"         && (
        <GenerateTab
          prefill={generatePrefill}
          onClearPrefill={() => setGeneratePrefill(null)}
        />
      )}
      {activeTab === "Compare"          && <CompareTab />}
      {activeTab === "Patterns"         && <PatternsTab onGenerateFromPattern={handleGenerateFromPattern} />}
      {activeTab === "Inspect & Repair" && <RepairTab />}
    </div>
  );
}
