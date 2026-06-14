import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Rocket, Plus, Loader2, RefreshCw, Trash2, CheckCircle2,
  X, Save, ChevronDown, ChevronRight, Sparkles, BarChart3,
  CalendarDays, Target, TrendingUp, AlertTriangle, Clock,
  FileText, Globe, Megaphone, LayoutList, Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { HiveMindReportBanner } from "./HiveMindReportBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getGrowthPlans, saveGrowthPlan, deleteGrowthPlan, generateGrowthPlan,
  getMarketingTasks, saveMarketingTask, completeMarketingTask, deleteMarketingTask,
  getMarketingReadiness,
  PLAN_LABELS, TASK_TYPES,
  type GrowthPlan, type MarketingTask, type PlanType,
} from "@/lib/growthmind/growthmind.growth-scheduler";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_COLORS = {
  low:    "bg-zinc-500/20 text-zinc-400 ring-zinc-500/20",
  medium: "bg-blue-500/20 text-blue-400 ring-blue-500/20",
  high:   "bg-amber-500/20 text-amber-400 ring-amber-500/20",
  urgent: "bg-red-500/20 text-red-400 ring-red-500/20",
};

const STATUS_ICON = {
  pending:     <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
  in_progress: <RefreshCw className="h-3.5 w-3.5 text-blue-400" />,
  completed:   <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  cancelled:   <X className="h-3.5 w-3.5 text-zinc-500" />,
};

const TASK_CATEGORY_MAP: Record<string, string> = {
  "Publish Blog":         "Content",
  "Write Newsletter":     "Content",
  "Create Case Study":    "Content",
  "Create Podcast":       "Content",
  "Post Social Content":  "Content",
  "Record Video":         "Content",
  "Create Lead Magnet":   "Content",
  "Design Infographic":   "Content",
  "Review Keywords":      "SEO",
  "Update Website":       "Website",
  "Build Funnel":         "Website",
  "Create Landing Page":  "Website",
  "Set Up Google Ad":     "Ads",
  "Set Up Meta Ad":       "Ads",
  "Write Email Sequence": "Campaign",
  "Launch Campaign":      "Campaign",
  "Build Referral System":"Referral",
  "PR Outreach":          "Referral",
  "Review Analytics":     "Review",
  "General":              "General",
};

const OUTPUT_TABS = [
  { id: "all",      label: "All Tasks",  icon: LayoutList },
  { id: "Content",  label: "Content",    icon: FileText },
  { id: "SEO",      label: "SEO",        icon: Globe },
  { id: "Ads",      label: "Ads",        icon: Megaphone },
  { id: "Website",  label: "Website",    icon: Globe },
  { id: "Campaign", label: "Campaigns",  icon: Target },
  { id: "Referral", label: "Referrals",  icon: TrendingUp },
  { id: "Review",   label: "Reviews",    icon: Star },
];

function fmtDate(s: string | null) {
  if (!s) return "";
  return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function isOverdue(t: MarketingTask) {
  return t.status === "pending" && t.dueDate && new Date(t.dueDate) < new Date();
}

// ── Score ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
          <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-white/[0.06]" />
          <circle
            cx="36" cy="36" r={r} fill="none" strokeWidth="5"
            stroke={color} strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round" className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-base font-bold" style={{ color }}>{score}</span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground text-center leading-tight max-w-[72px]">{label}</p>
    </div>
  );
}

// ── Plan card ─────────────────────────────────────────────────────────────────

function PlanCard({
  plan, isSelected, onSelect, onDelete, onGenerate, generating,
}: {
  plan: GrowthPlan;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onGenerate: () => void;
  generating: boolean;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "rounded-xl border p-4 cursor-pointer transition-all",
        isSelected
          ? "border-emerald-500/40 bg-emerald-500/[0.06]"
          : "border-white/[0.06] bg-card/40 hover:bg-card/70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Rocket className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <p className="text-sm font-semibold truncate">{plan.name}</p>
          </div>
          <p className="text-xs text-muted-foreground">{PLAN_LABELS[plan.planType]}</p>
          {plan.generatedSummary && (
            <p className="text-xs text-muted-foreground/70 mt-1.5 line-clamp-2">{plan.generatedSummary}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={cn(
            "text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1",
            plan.status === "active"    ? "bg-emerald-500/20 text-emerald-400 ring-emerald-500/20"
            : plan.status === "draft"   ? "bg-zinc-500/20 text-zinc-400 ring-zinc-500/20"
            : "bg-amber-500/20 text-amber-400 ring-amber-500/20",
          )}>
            {plan.status}
          </span>
          {!plan.generatedAt && (
            <button
              onClick={e => { e.stopPropagation(); onGenerate(); }}
              disabled={generating}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
            >
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Generate
            </button>
          )}
          {plan.generatedAt && (
            <span className="text-[10px] text-emerald-400/60">
              ✓ Generated
            </span>
          )}
          <button onClick={e => { e.stopPropagation(); onDelete(); }} className="text-muted-foreground hover:text-red-400 ml-1">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {plan.industry && (
        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground/60">
          {plan.industry && <span>Industry: {plan.industry}</span>}
          {plan.targetLeadsPerMonth > 0 && <span>Target: {plan.targetLeadsPerMonth} leads/mo</span>}
        </div>
      )}
    </div>
  );
}

// ── Task row ──────────────────────────────────────────────────────────────────

function TaskRow({
  task, onComplete, onDelete,
}: {
  task: MarketingTask;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const overdue = isOverdue(task);
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg border px-3 py-2.5 group transition-colors",
      task.status === "completed"
        ? "border-white/[0.04] bg-card/20 opacity-60"
        : overdue
          ? "border-red-500/20 bg-red-500/[0.03] hover:bg-red-500/[0.06]"
          : "border-white/[0.06] bg-card/40 hover:bg-card/70",
    )}>
      <button onClick={onComplete} disabled={task.status === "completed"}
        className="shrink-0 text-muted-foreground hover:text-emerald-400 disabled:cursor-default transition-colors">
        {STATUS_ICON[task.status] ?? STATUS_ICON.pending}
      </button>
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-medium truncate", task.status === "completed" && "line-through")}>{task.title}</p>
        <p className="text-[11px] text-muted-foreground">
          {task.taskType}
          {task.dueDate && <span className={cn("ml-1.5", overdue && "text-red-400")}>· Due {fmtDate(task.dueDate)}</span>}
        </p>
      </div>
      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1 shrink-0", PRIORITY_COLORS[task.priority])}>
        {task.priority}
      </span>
      {overdue && <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
      <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── New plan form ─────────────────────────────────────────────────────────────

const EMPTY_PLAN_FORM = {
  name:                "",
  planType:            "90_day" as PlanType,
  businessType:        "",
  industry:            "",
  targetAudience:      "",
  offer:               "",
  monthlyBudget:       "",
  targetMarkets:       "",
  keywordsRaw:         "",
  growthGoals:         "",
  targetLeadsPerMonth: "",
};

function NewPlanModal({ onClose, onSave, saving }: { onClose: () => void; onSave: (f: typeof EMPTY_PLAN_FORM) => void; saving: boolean }) {
  const [form, setForm] = useState(EMPTY_PLAN_FORM);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl border border-white/[0.08] bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Rocket className="h-4 w-4 text-emerald-400" />
            New Growth Plan
          </p>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Plan Name *</Label>
              <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Q3 2026 Growth Plan…" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Plan Type</Label>
              <select value={form.planType} onChange={e => set("planType", e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none">
                {Object.entries(PLAN_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Business Type</Label>
              <Input value={form.businessType} onChange={e => set("businessType", e.target.value)} placeholder="e.g. SaaS, Agency, Clinic…" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Industry</Label>
              <Input value={form.industry} onChange={e => set("industry", e.target.value)} placeholder="e.g. Healthcare, Fintech…" />
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Target Audience</Label>
            <Input value={form.targetAudience} onChange={e => set("targetAudience", e.target.value)} placeholder="e.g. SME owners in the UK aged 35–55…" />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Your Offer</Label>
            <Input value={form.offer} onChange={e => set("offer", e.target.value)} placeholder="e.g. AI-powered voice agents for sales teams…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Monthly Marketing Budget (£)</Label>
              <Input type="number" value={form.monthlyBudget} onChange={e => set("monthlyBudget", e.target.value)} placeholder="e.g. 2000" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Target Leads / Month</Label>
              <Input type="number" value={form.targetLeadsPerMonth} onChange={e => set("targetLeadsPerMonth", e.target.value)} placeholder="e.g. 50" />
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Target Markets</Label>
            <Input value={form.targetMarkets} onChange={e => set("targetMarkets", e.target.value)} placeholder="e.g. UK, USA, Australia…" />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Keywords (comma separated)</Label>
            <Input value={form.keywordsRaw} onChange={e => set("keywordsRaw", e.target.value)} placeholder="e.g. lead generation, AI sales, CRM…" />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Growth Goals</Label>
            <Textarea value={form.growthGoals} onChange={e => set("growthGoals", e.target.value)} rows={3} placeholder="What does success look like in this period?" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-white/[0.06]">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(form)} disabled={!form.name.trim() || saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Create Plan
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── New task form ─────────────────────────────────────────────────────────────

function QuickAddTask({ onAdd, adding }: { onAdd: (title: string, type: string, priority: string, dueDate: string) => void; adding: boolean }) {
  const [title,    setTitle]    = useState("");
  const [type,     setType]     = useState("General");
  const [priority, setPriority] = useState("medium");
  const [dueDate,  setDueDate]  = useState("");

  function handleAdd() {
    if (!title.trim()) return;
    onAdd(title.trim(), type, priority, dueDate);
    setTitle(""); setDueDate("");
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/40 p-3">
      <p className="text-xs font-semibold text-muted-foreground/60 mb-2 uppercase tracking-[0.08em]">Add Task</p>
      <div className="flex gap-2 flex-wrap">
        <Input className="flex-1 min-w-[160px]" placeholder="Task title…" value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAdd()} />
        <select value={type} onChange={e => setType(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-2 text-xs focus:outline-none">
          {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-2 text-xs focus:outline-none">
          {["low","medium","high","urgent"].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <Input type="date" className="w-36" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        <Button size="sm" onClick={handleAdd} disabled={!title.trim() || adding}>
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GrowthMindGrowthScheduler() {
  const qc = useQueryClient();
  const saveGrowthPlanFn  = useServerFn(saveGrowthPlan);
  const deleteGrowthPlanFn = useServerFn(deleteGrowthPlan);
  const generateFn        = useServerFn(generateGrowthPlan);
  const saveTaskFn        = useServerFn(saveMarketingTask);
  const completeFn        = useServerFn(completeMarketingTask);
  const deleteTaskFn      = useServerFn(deleteMarketingTask);

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [activeTab,      setActiveTab]       = useState("all");
  const [showNewPlan,    setShowNewPlan]     = useState(false);
  const [savingPlan,     setSavingPlan]      = useState(false);
  const [generatingId,   setGeneratingId]   = useState<string | null>(null);
  const [addingTask,     setAddingTask]      = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function flash(m: string, isErr = false) {
    setMsg(m);
    setTimeout(() => setMsg(null), isErr ? 4000 : 2500);
  }

  const { data: planData, isLoading: loadingPlans } = useQuery({
    queryKey: ["growthmind-growth-plans"],
    queryFn:  () => getGrowthPlans(),
    staleTime: 60_000,
  });
  const plans = planData?.plans ?? [];

  const { data: taskData, isLoading: loadingTasks } = useQuery({
    queryKey: ["growthmind-marketing-tasks", selectedPlanId],
    queryFn:  () => getMarketingTasks({ planId: selectedPlanId ?? undefined }),
    staleTime: 30_000,
  });
  const allTasks = taskData?.tasks ?? [];

  const { data: readiness } = useQuery({
    queryKey: ["growthmind-marketing-readiness"],
    queryFn:  () => getMarketingReadiness(),
    staleTime: 60_000,
  });

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    if (activeTab === "all") return allTasks;
    return allTasks.filter(t => (TASK_CATEGORY_MAP[t.taskType] ?? "General") === activeTab);
  }, [allTasks, activeTab]);

  const selectedPlan = plans.find(p => p.id === selectedPlanId) ?? null;

  async function handleCreatePlan(form: typeof EMPTY_PLAN_FORM) {
    setSavingPlan(true);
    try {
      const res = await saveGrowthPlanFn({
        name:                form.name.trim(),
        planType:            form.planType,
        businessType:        form.businessType,
        industry:            form.industry,
        targetAudience:      form.targetAudience,
        offer:               form.offer,
        monthlyBudget:       form.monthlyBudget ? parseFloat(form.monthlyBudget) : null,
        targetMarkets:       form.targetMarkets,
        keywords:            form.keywordsRaw ? form.keywordsRaw.split(",").map(k => k.trim()).filter(Boolean) : [],
        growthGoals:         form.growthGoals,
        targetLeadsPerMonth: form.targetLeadsPerMonth ? parseInt(form.targetLeadsPerMonth, 10) : 0,
      });
      qc.invalidateQueries({ queryKey: ["growthmind-growth-plans"] });
      setSelectedPlanId(res.id);
      setShowNewPlan(false);
      flash("Plan created! Click 'Generate' to populate your calendar and tasks.");
    } catch (err: any) {
      flash("Error: " + err.message, true);
    }
    finally { setSavingPlan(false); }
  }

  async function handleGeneratePlan(plan: GrowthPlan) {
    setGeneratingId(plan.id);
    try {
      const res = await generateFn({
        planId:              plan.id,
        planType:            plan.planType,
        businessType:        plan.businessType,
        industry:            plan.industry,
        targetAudience:      plan.targetAudience,
        offer:               plan.offer,
        monthlyBudget:       plan.monthlyBudget,
        keywords:            plan.keywords,
        growthGoals:         plan.growthGoals,
        targetLeadsPerMonth: plan.targetLeadsPerMonth,
      });
      qc.invalidateQueries({ queryKey: ["growthmind-growth-plans"] });
      qc.invalidateQueries({ queryKey: ["growthmind-marketing-tasks"] });
      qc.invalidateQueries({ queryKey: ["growthmind-calendar"] });
      qc.invalidateQueries({ queryKey: ["growthmind-marketing-readiness"] });
      flash(`✓ Generated ${res.calendarCount} content items + ${res.taskCount} tasks!`);
    } catch (err: any) {
      flash("Error: " + err.message, true);
    }
    finally { setGeneratingId(null); }
  }

  async function handleDeletePlan(id: string) {
    await deleteGrowthPlanFn({ id });
    if (selectedPlanId === id) setSelectedPlanId(null);
    qc.invalidateQueries({ queryKey: ["growthmind-growth-plans"] });
  }

  async function handleAddTask(title: string, type: string, priority: string, dueDate: string) {
    setAddingTask(true);
    try {
      await saveTaskFn({
        title,
        taskType:  type,
        priority:  priority as "low" | "medium" | "high" | "urgent",
        dueDate:   dueDate || null,
      });
      qc.invalidateQueries({ queryKey: ["growthmind-marketing-tasks"] });
      qc.invalidateQueries({ queryKey: ["growthmind-marketing-readiness"] });
    } catch {}
    finally { setAddingTask(false); }
  }

  async function handleComplete(id: string) {
    await completeFn({ id });
    qc.invalidateQueries({ queryKey: ["growthmind-marketing-tasks"] });
    qc.invalidateQueries({ queryKey: ["growthmind-marketing-readiness"] });
  }

  async function handleDeleteTask(id: string) {
    await deleteTaskFn({ id });
    qc.invalidateQueries({ queryKey: ["growthmind-marketing-tasks"] });
    qc.invalidateQueries({ queryKey: ["growthmind-marketing-readiness"] });
  }

  const pendingCount   = allTasks.filter(t => t.status === "pending").length;
  const completedCount = allTasks.filter(t => t.status === "completed").length;
  const overdueCount   = allTasks.filter(t => isOverdue(t)).length;

  const briefing = readiness
    ? `Marketing Readiness Score: ${readiness.overallScore}/100. Content coverage ${readiness.contentScore}%, ${readiness.stats?.activeCampaigns ?? 0} active campaigns, ${readiness.stats?.pendingTasks ?? 0} pending tasks${readiness.stats?.overdueTasks > 0 ? `, ${readiness.stats.overdueTasks} overdue` : ""}.`
    : null;

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-5xl">

        {/* Header */}
        <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Rocket className="h-5 w-5 text-emerald-400" />
              Growth Scheduler
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">Generate 30/60/90-day and annual marketing plans with AI</p>
          </div>
          <div className="flex items-center gap-2">
            {msg && <span className={cn("text-xs font-medium", msg.startsWith("Error") ? "text-red-400" : "text-emerald-400")}>{msg}</span>}
            <Button variant="outline" size="sm" onClick={() => { qc.invalidateQueries({ queryKey: ["growthmind-growth-plans"] }); qc.invalidateQueries({ queryKey: ["growthmind-marketing-tasks"] }); }}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", (loadingPlans || loadingTasks) && "animate-spin")} />Refresh
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5" onClick={() => setShowNewPlan(true)}>
              <Plus className="h-3.5 w-3.5" />New Plan
            </Button>
          </div>
        </div>

        <HiveMindReportBanner domain="Growth Scheduler" briefing={briefing} />

        {/* Marketing Readiness */}
        {readiness && (
          <div className="mb-6 rounded-xl border border-white/[0.06] bg-card/40 p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-emerald-400" />
                Marketing Readiness
              </p>
              <span className={cn(
                "text-sm font-bold px-2.5 py-1 rounded-full",
                readiness.overallScore >= 70 ? "text-emerald-400 bg-emerald-500/15"
                : readiness.overallScore >= 45 ? "text-amber-400 bg-amber-500/15"
                : "text-red-400 bg-red-500/15",
              )}>
                {readiness.overallScore}/100
              </span>
            </div>
            <div className="flex items-center justify-around">
              <ScoreRing score={readiness.contentScore}  label="Content Coverage"  color="#10b981" />
              <ScoreRing score={readiness.campaignScore} label="Campaign Coverage" color="#0ea5e9" />
              <ScoreRing score={readiness.seoScore}      label="SEO Coverage"      color="#f59e0b" />
              <ScoreRing score={(readiness as any).taskScore ?? 50} label="Task Completion" color="#8b5cf6" />
            </div>
            {readiness.stats && (
              <div className="mt-4 grid grid-cols-4 gap-3 border-t border-white/[0.06] pt-3">
                {[
                  { label: "Total Content",  value: readiness.stats.totalEntries, color: "text-foreground" },
                  { label: "Published",      value: readiness.stats.published,    color: "text-emerald-400" },
                  { label: "Pending Tasks",  value: readiness.stats.pendingTasks, color: "text-amber-400" },
                  { label: "Overdue",        value: readiness.stats.overdueTasks, color: "text-red-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="text-center">
                    <p className={cn("text-xl font-bold", color)}>{value}</p>
                    <p className="text-[11px] text-muted-foreground/60">{label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Plans column */}
          <div className="lg:col-span-1 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">Growth Plans</p>
              <span className="text-xs text-muted-foreground">{plans.length} plan{plans.length !== 1 ? "s" : ""}</span>
            </div>

            {loadingPlans ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : plans.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/[0.1] p-6 text-center">
                <Rocket className="h-8 w-8 text-emerald-400/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground mb-3">No growth plans yet.</p>
                <Button size="sm" variant="outline" onClick={() => setShowNewPlan(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />Create Plan
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {/* All tasks option */}
                <button
                  onClick={() => setSelectedPlanId(null)}
                  className={cn(
                    "w-full text-left rounded-xl border px-4 py-2.5 text-sm font-medium transition-all",
                    selectedPlanId === null
                      ? "border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-300"
                      : "border-white/[0.06] bg-card/40 text-muted-foreground hover:bg-card/70",
                  )}
                >
                  <LayoutList className="h-3.5 w-3.5 inline mr-2" />
                  All Tasks ({allTasks.length})
                </button>
                {plans.map(plan => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    isSelected={selectedPlanId === plan.id}
                    onSelect={() => setSelectedPlanId(plan.id)}
                    onDelete={() => handleDeletePlan(plan.id)}
                    onGenerate={() => handleGeneratePlan(plan)}
                    generating={generatingId === plan.id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Tasks column */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
                {selectedPlan ? selectedPlan.name : "All Marketing Tasks"}
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="text-emerald-400 font-semibold">{completedCount}</span> done
                <span>·</span>
                <span className="font-semibold">{pendingCount}</span> pending
                {overdueCount > 0 && <><span>·</span><span className="text-red-400 font-semibold">{overdueCount}</span> overdue</>}
              </div>
            </div>

            {/* Output tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {OUTPUT_TABS.map(tab => {
                const count = tab.id === "all"
                  ? allTasks.length
                  : allTasks.filter(t => (TASK_CATEGORY_MAP[t.taskType] ?? "General") === tab.id).length;
                if (tab.id !== "all" && count === 0) return null;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors",
                      activeTab === tab.id
                        ? "bg-emerald-600 text-white"
                        : "bg-card/40 text-muted-foreground hover:text-foreground border border-white/[0.06]",
                    )}
                  >
                    <tab.icon className="h-3 w-3" />
                    {tab.label}
                    {count > 0 && <span className={cn("text-[10px] px-1 rounded", activeTab === tab.id ? "bg-white/20" : "bg-white/[0.08]")}>{count}</span>}
                  </button>
                );
              })}
            </div>

            {/* Quick add */}
            <QuickAddTask onAdd={handleAddTask} adding={addingTask} />

            {/* Tasks list */}
            {loadingTasks ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                <span className="text-sm">Loading tasks…</span>
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/[0.1] p-8 text-center">
                <CalendarDays className="h-8 w-8 text-emerald-400/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground mb-2">No tasks in this category.</p>
                {!selectedPlan?.generatedAt && plans.length > 0 && (
                  <p className="text-xs text-muted-foreground/60">Select a plan and click Generate to auto-create tasks.</p>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredTasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onComplete={() => handleComplete(task.id)}
                    onDelete={() => handleDeleteTask(task.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modals */}
        {showNewPlan && (
          <NewPlanModal
            onClose={() => setShowNewPlan(false)}
            onSave={handleCreatePlan}
            saving={savingPlan}
          />
        )}

      </div>
    </GrowthMindShell>
  );
}
