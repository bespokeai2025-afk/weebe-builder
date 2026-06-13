import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Brain, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  Loader2, ChevronRight, Zap, BarChart3, Users, Phone,
  CalendarCheck, Megaphone, Settings2, Bot, TrendingUp,
  FileText, ShieldCheck, Circle, CheckCheck, ListTodo, Activity,
  DollarSign, ClipboardList, Info, Lightbulb, Target,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getHiveMindPlatformData, saveHiveMindTasks } from "@/lib/hivemind/hivemind.functions";
import type { HiveMindTask } from "@/lib/hivemind/hivemind.functions";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/hivemind")({
  head: () => ({ meta: [{ title: "HiveMind — Webee" }] }),
  component: HiveMindPage,
});

// ── Types ─────────────────────────────────────────────────────────────────────
type Priority = "critical" | "high" | "medium" | "low";
type Rec = {
  id: string;
  category: string;
  priority: Priority;
  problem: string;
  impact: string;
  fix: string;
  action?: { label: string; href: string };
};

type ActivationMode = "observe" | "recommend" | "semi" | "full";

const MODE_LABELS: Record<ActivationMode, string> = {
  observe: "Observe Only",
  recommend: "Recommend Only",
  semi: "Semi-Autonomous",
  full: "Fully Autonomous",
};

// ── Recommendation engine ─────────────────────────────────────────────────────
function generateRecommendations(data: any): Rec[] {
  if (!data) return [];
  const recs: Rec[] = [];
  const { agents, agentScores, calls, leads, bookings, campaigns, systemHealth, settings } = data;

  // --- Config / Setup ---
  if (!systemHealth.calcom) {
    recs.push({
      id: "no-calcom", category: "Configuration", priority: "high",
      problem: "Cal.com not connected",
      impact: "Agents cannot auto-book appointments — all bookings must be done manually.",
      fix: "Add your Cal.com API key in Settings → Calendar.",
      action: { label: "Configure Cal.com", href: "/settings/calendar" },
    });
  }
  if (!systemHealth.retell && agents.length > 0) {
    recs.push({
      id: "no-retell-key", category: "Configuration", priority: "critical",
      problem: "No Retell workspace API key configured",
      impact: "Voice agents cannot be deployed or make calls.",
      fix: "Add your Retell workspace key in Settings → Integrations.",
      action: { label: "Go to Integrations", href: "/settings/integrations" },
    });
  }
  if (!systemHealth.elevenlabs && !systemHealth.openai && agents.length > 0) {
    recs.push({
      id: "no-ai-key", category: "Configuration", priority: "medium",
      problem: "No ElevenLabs or OpenAI API key configured",
      impact: "HyperStream / VoxStream agents will not function.",
      fix: "Add at least one AI provider key in Settings → Integrations.",
      action: { label: "Add API Key", href: "/settings/integrations" },
    });
  }

  // --- Agents ---
  for (const score of agentScores ?? []) {
    if (!score.deployed) {
      recs.push({
        id: `agent-not-deployed-${score.id}`, category: "Agent Health", priority: "high",
        problem: `Agent "${score.name}" has not been deployed`,
        impact: "This agent cannot receive or make calls.",
        fix: "Open the Builder, select this agent, and click Deploy.",
        action: { label: "Open Builder", href: "/builder" },
      });
    } else if (!score.hasPhone && score.callCount === 0) {
      recs.push({
        id: `agent-no-phone-${score.id}`, category: "Agent Health", priority: "medium",
        problem: `Agent "${score.name}" has no phone number assigned`,
        impact: "Inbound calls cannot reach this agent.",
        fix: "Assign a phone number in Phone Numbers → Assign Agent.",
        action: { label: "Phone Numbers", href: "/phone-numbers" },
      });
    }
    if (score.deployed && score.callCount > 10 && score.successRate < 30) {
      recs.push({
        id: `agent-low-success-${score.id}`, category: "Agent Health", priority: "high",
        problem: `Agent "${score.name}" has a low success rate (${score.successRate}%)`,
        impact: "Most calls are not achieving their goal, wasting budget.",
        fix: "Review the agent's conversation flow in the Builder and improve the prompt quality.",
        action: { label: "Open Builder", href: "/builder" },
      });
    }
  }
  if (agents.length === 0) {
    recs.push({
      id: "no-agents", category: "Setup", priority: "critical",
      problem: "No agents have been created",
      impact: "The platform has no AI voice agents to handle calls.",
      fix: "Create your first agent in Agents → New Agent.",
      action: { label: "Create Agent", href: "/agents/new" },
    });
  }

  // --- Leads ---
  if (leads.stale > 10) {
    recs.push({
      id: "stale-leads", category: "Pipeline", priority: "medium",
      problem: `${leads.stale} leads have not been updated in 14+ days`,
      impact: "Stale leads indicate pipeline blockage and lost revenue opportunities.",
      fix: "Review and move or call these leads in the Pipeline or Leads section.",
      action: { label: "View Pipeline", href: "/pipeline" },
    });
  }
  if (leads.needCall > 50 && calls.total < 5) {
    recs.push({
      id: "uncontacted-leads", category: "Pipeline", priority: "high",
      problem: `${leads.needCall} leads are waiting for a call but no outbound campaign is running`,
      impact: "Every day without contact reduces conversion probability.",
      fix: "Start a call campaign from the Data page to reach these leads.",
      action: { label: "Start Campaign", href: "/data" },
    });
  }
  if (leads.total === 0) {
    recs.push({
      id: "no-leads", category: "Setup", priority: "medium",
      problem: "No leads have been imported",
      impact: "Agents have nobody to call.",
      fix: "Import leads via the Data page (CSV upload or manual entry).",
      action: { label: "Import Leads", href: "/data" },
    });
  }

  // --- Campaigns ---
  if (campaigns.total === 0 && leads.total > 0) {
    recs.push({
      id: "no-campaigns", category: "Campaigns", priority: "medium",
      problem: "No follow-up campaigns have been created",
      impact: "Leads with no follow-up lose interest — a campaign keeps them warm.",
      fix: "Create a call campaign in Campaigns.",
      action: { label: "Create Campaign", href: "/campaigns" },
    });
  }

  // --- Bookings ---
  if (calls.total > 20 && bookings.total === 0) {
    recs.push({
      id: "calls-no-bookings", category: "Conversion", priority: "high",
      problem: "Calls are happening but no appointments are being booked",
      impact: "Calls are not converting — revenue is being left on the table.",
      fix: "Ensure the agent has a calendar booking tool configured and Cal.com is connected.",
      action: { label: "Check Calendar Settings", href: "/settings/calendar" },
    });
  }

  return recs.sort((a, b) => {
    const order: Priority[] = ["critical", "high", "medium", "low"];
    return order.indexOf(a.priority) - order.indexOf(b.priority);
  });
}

// ── Priority badge ─────────────────────────────────────────────────────────────
function PriorityBadge({ p }: { p: Priority }) {
  const style = {
    critical: "bg-red-500/15 text-red-400 ring-red-500/30",
    high:     "bg-orange-500/15 text-orange-400 ring-orange-500/30",
    medium:   "bg-amber-500/15 text-amber-400 ring-amber-500/30",
    low:      "bg-slate-500/15 text-slate-400 ring-slate-500/30",
  }[p];
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 capitalize", style)}>
      {p}
    </span>
  );
}

function HealthDot({ ok, partial }: { ok: boolean; partial?: boolean }) {
  if (partial) return <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0 inline-block" />;
  return ok
    ? <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0 inline-block" />
    : <span className="h-2 w-2 rounded-full bg-red-400 shrink-0 inline-block" />;
}

// ── Score ring ─────────────────────────────────────────────────────────────────
function ScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";
  return (
    <div className={cn("text-3xl font-bold tabular-nums", color)}>{score}</div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function HiveMindPage() {
  const fn = useServerFn(getHiveMindPlatformData);
  const saveFn = useServerFn(saveHiveMindTasks);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["hivemind-data"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
  const data = q.data;

  const [tab, setTab] = useState<"overview" | "recommendations" | "tasks" | "system" | "agents" | "cost" | "reports">("overview");
  const [mode, setMode] = useState<ActivationMode>("recommend");
  const [modeOpen, setModeOpen] = useState(false);

  const [tasks, setTasks] = useState<HiveMindTask[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("hivemind-tasks");
      if (saved) setTasks(JSON.parse(saved));
    } catch {}
  }, []);

  const recommendations = useMemo(() => generateRecommendations(data), [data]);

  const criticalCount = recommendations.filter((r) => r.priority === "critical").length;
  const highCount     = recommendations.filter((r) => r.priority === "high").length;

  const platformScore = useMemo(() => {
    if (!data) return 0;
    const { systemHealth, agentScores, calls, leads, bookings } = data;
    let score = 0;
    if (systemHealth.agents) score += 15;
    if (systemHealth.retell || systemHealth.elevenlabs) score += 10;
    if (systemHealth.calcom) score += 10;
    if (agentScores?.some((a: any) => a.deployed)) score += 15;
    if (calls.total > 0) score += 10;
    if (calls.successRate > 50) score += 10;
    if (leads.total > 0) score += 5;
    if (bookings.total > 0) score += 10;
    if (criticalCount === 0) score += 10;
    if (highCount === 0) score += 5;
    return Math.min(score, 100);
  }, [data, criticalCount, highCount]);

  function persistTasks(next: HiveMindTask[]) {
    setTasks(next);
    localStorage.setItem("hivemind-tasks", JSON.stringify(next));
    saveFn({ data: { tasks: next } }).catch(() => {});
  }

  function addTask(title: string, category: string) {
    const task: HiveMindTask = {
      id: `task-${Date.now()}`,
      title, category,
      status: "suggested",
      createdAt: new Date().toISOString(),
    };
    persistTasks([...tasks, task]);
  }

  function moveTask(id: string, status: HiveMindTask["status"]) {
    persistTasks(tasks.map((t) => t.id === id ? { ...t, status, completedAt: status === "completed" ? new Date().toISOString() : t.completedAt } : t));
  }

  function deleteTask(id: string) {
    persistTasks(tasks.filter((t) => t.id !== id));
  }

  function createTaskFromRec(rec: Rec) {
    addTask(rec.problem, rec.category);
    toast.success("Task created", { description: rec.problem });
  }

  const TABS = [
    { id: "overview",       label: "Overview",        icon: BarChart3 },
    { id: "recommendations",label: "Recommendations", icon: Lightbulb, badge: recommendations.length },
    { id: "tasks",          label: "Tasks",           icon: ListTodo,  badge: tasks.filter((t) => t.status !== "completed").length || undefined },
    { id: "system",         label: "System Health",   icon: Activity },
    { id: "agents",         label: "Agent Health",    icon: Bot },
    { id: "cost",           label: "Cost Health",     icon: DollarSign },
    { id: "reports",        label: "Reports",         icon: ClipboardList },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-5">

      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5 mb-0.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 ring-1 ring-violet-500/30">
              <Brain className="h-4 w-4 text-violet-400" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">HiveMind</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI Operations Director · Platform monitoring, recommendations & health scoring
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setModeOpen((p) => !p)}
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Zap className="h-3.5 w-3.5 text-violet-400" />
              {MODE_LABELS[mode]}
              <ChevronRight className={cn("h-3 w-3 transition-transform", modeOpen && "rotate-90")} />
            </button>
            {modeOpen && (
              <div className="absolute right-0 top-9 z-20 w-44 rounded-xl border border-white/[0.08] bg-card shadow-xl overflow-hidden">
                {(Object.entries(MODE_LABELS) as [ActivationMode, string][]).map(([k, v]) => (
                  <button key={k} className={cn(
                    "w-full px-3 py-2 text-left text-xs hover:bg-white/[0.04] transition-colors",
                    k === mode && "text-violet-400 font-medium",
                  )} onClick={() => { setMode(k); setModeOpen(false); }}>
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => { q.refetch(); qc.invalidateQueries({ queryKey: ["hivemind-data"] }); }}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", q.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Critical alert banner */}
      {criticalCount > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">
            <span className="font-semibold">{criticalCount} critical issue{criticalCount > 1 ? "s" : ""}</span>
            {" "}— platform is impaired. Review recommendations immediately.
          </p>
          <button className="ml-auto text-xs text-red-400 hover:text-red-300 underline shrink-0" onClick={() => setTab("recommendations")}>
            View issues
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div className="mb-5 flex overflow-x-auto gap-1 border-b border-white/[0.06] pb-0">
        {TABS.map(({ id, label, icon: Icon, badge }: any) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px",
              tab === id
                ? "border-violet-400 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {badge != null && badge > 0 && (
              <span className="rounded-full bg-violet-500/20 px-1.5 py-0 text-[10px] font-semibold text-violet-300 tabular-nums">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
          <span className="text-sm">Scanning platform…</span>
        </div>
      ) : (
        <>
          {/* ── Overview ── */}
          {tab === "overview" && (
            <div className="space-y-5">
              {/* Score + summary */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4 flex flex-col gap-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Platform Score</p>
                  <ScoreRing score={platformScore} />
                  <p className="text-[11px] text-muted-foreground">{platformScore >= 70 ? "Healthy" : platformScore >= 40 ? "Needs attention" : "Critical issues"}</p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4 flex flex-col gap-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Open Issues</p>
                  <div className="text-3xl font-bold tabular-nums text-foreground">{recommendations.length}</div>
                  <p className="text-[11px] text-muted-foreground">{criticalCount} critical · {highCount} high</p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4 flex flex-col gap-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Calls (30d)</p>
                  <div className="text-3xl font-bold tabular-nums text-foreground">{data?.calls.total ?? 0}</div>
                  <p className="text-[11px] text-muted-foreground">{data?.calls.successRate ?? 0}% success rate</p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4 flex flex-col gap-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Active Tasks</p>
                  <div className="text-3xl font-bold tabular-nums text-foreground">{tasks.filter((t) => t.status !== "completed").length}</div>
                  <p className="text-[11px] text-muted-foreground">{tasks.filter((t) => t.status === "completed").length} completed</p>
                </div>
              </div>

              {/* Quick system health */}
              <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/[0.06]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">System Health Matrix</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-y divide-white/[0.04]">
                  {[
                    { label: "Voice Agents", ok: data?.systemHealth.agents, icon: Bot },
                    { label: "Retell Deployed", ok: data?.systemHealth.retell, icon: Phone },
                    { label: "Cal.com", ok: data?.systemHealth.calcom, icon: CalendarCheck },
                    { label: "Telephony", ok: data?.systemHealth.twilio, icon: Phone },
                    { label: "WhatsApp", ok: data?.systemHealth.whatsapp, icon: Settings2 },
                    { label: "ElevenLabs", ok: data?.systemHealth.elevenlabs, icon: Brain },
                    { label: "OpenAI", ok: data?.systemHealth.openai, icon: Brain },
                    { label: "Campaigns", ok: data?.systemHealth.campaigns, icon: Megaphone },
                  ].map(({ label, ok, icon: Icon }) => (
                    <div key={label} className="flex items-center gap-2.5 px-4 py-3">
                      <HealthDot ok={!!ok} />
                      <div>
                        <p className="text-xs font-medium">{label}</p>
                        <p className={cn("text-[10px]", ok ? "text-emerald-400" : "text-red-400/80")}>{ok ? "Connected" : "Not set up"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top recommendations */}
              {recommendations.length > 0 && (
                <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Priority Recommendations</p>
                    <button className="text-[11px] text-violet-400 hover:text-violet-300" onClick={() => setTab("recommendations")}>
                      View all →
                    </button>
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    {recommendations.slice(0, 3).map((r) => (
                      <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                        <PriorityBadge p={r.priority} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{r.problem}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.fix}</p>
                        </div>
                        {r.action && (
                          <Button asChild size="sm" variant="ghost" className="h-7 text-xs shrink-0">
                            <Link to={r.action.href}>{r.action.label}</Link>
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Metric chips */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Total Leads", value: data?.leads.total ?? 0, icon: Users, color: "text-blue-400" },
                  { label: "Need Call", value: data?.leads.needCall ?? 0, icon: Phone, color: "text-amber-400" },
                  { label: "Bookings", value: data?.bookings.total ?? 0, icon: CalendarCheck, color: "text-emerald-400" },
                  { label: "Avg Call Duration", value: data?.calls.avgDuration ? `${data.calls.avgDuration}s` : "—", icon: TrendingUp, color: "text-violet-400" },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="rounded-xl border border-white/[0.06] bg-card/40 px-4 py-3 flex items-center gap-3">
                    <Icon className={cn("h-5 w-5 shrink-0", color)} />
                    <div>
                      <p className="text-lg font-bold tabular-nums">{value}</p>
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Recommendations ── */}
          {tab === "recommendations" && (
            <div className="space-y-3">
              {recommendations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-400/60" />
                  <p className="text-base font-semibold">All clear!</p>
                  <p className="text-sm text-muted-foreground">No issues detected. HiveMind is monitoring your platform.</p>
                </div>
              ) : (
                recommendations.map((r) => (
                  <div key={r.id} className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
                    <div className="flex items-start gap-3 flex-wrap">
                      <PriorityBadge p={r.priority} />
                      <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-white/[0.08]">{r.category}</span>
                    </div>
                    <p className="mt-2.5 text-sm font-semibold">{r.problem}</p>
                    <div className="mt-2 space-y-1.5">
                      <div className="flex gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground"><span className="text-foreground/80 font-medium">Impact:</span> {r.impact}</p>
                      </div>
                      <div className="flex gap-1.5">
                        <Lightbulb className="h-3.5 w-3.5 text-violet-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground"><span className="text-foreground/80 font-medium">Fix:</span> {r.fix}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      {r.action && (
                        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                          <Link to={r.action.href}>{r.action.label} →</Link>
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => createTaskFromRec(r)}>
                        <ListTodo className="mr-1.5 h-3 w-3" />
                        Create task
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Tasks ── */}
          {tab === "tasks" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => {
                  const title = window.prompt("Task title:");
                  if (title?.trim()) addTask(title.trim(), "Manual");
                }}>
                  + Add Task
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {(["suggested", "approved", "completed"] as const).map((status) => {
                  const icons = { suggested: Circle, approved: CheckCircle2, completed: CheckCheck };
                  const colors = { suggested: "text-amber-400", approved: "text-blue-400", completed: "text-emerald-400" };
                  const Icon = icons[status];
                  const col = tasks.filter((t) => t.status === status);
                  return (
                    <div key={status} className="rounded-xl border border-white/[0.06] bg-card/40 overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
                        <Icon className={cn("h-3.5 w-3.5", colors[status])} />
                        <span className="text-xs font-semibold capitalize">{status}</span>
                        <span className="ml-auto rounded-full bg-white/[0.05] px-1.5 text-[10px] text-muted-foreground">{col.length}</span>
                      </div>
                      <div className="p-2 space-y-1.5 min-h-[80px]">
                        {col.length === 0 && (
                          <p className="text-[11px] text-muted-foreground/50 text-center py-4">No tasks</p>
                        )}
                        {col.map((task) => (
                          <div key={task.id} className="rounded-lg border border-white/[0.05] bg-card/60 px-3 py-2">
                            <div className="flex items-start justify-between gap-1.5">
                              <div className="min-w-0">
                                <p className={cn("text-xs font-medium leading-snug", task.status === "completed" && "line-through text-muted-foreground")}>{task.title}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">{task.category}</p>
                              </div>
                              <button onClick={() => deleteTask(task.id)} className="text-muted-foreground/40 hover:text-red-400 transition-colors shrink-0">
                                <XCircle className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="mt-2 flex gap-1">
                              {status === "suggested" && (
                                <button onClick={() => moveTask(task.id, "approved")} className="rounded px-2 py-0.5 text-[10px] bg-blue-500/10 text-blue-400 hover:bg-blue-500/20">Approve</button>
                              )}
                              {status === "approved" && (
                                <button onClick={() => moveTask(task.id, "completed")} className="rounded px-2 py-0.5 text-[10px] bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20">Complete</button>
                              )}
                              {status !== "suggested" && (
                                <button onClick={() => moveTask(task.id, "suggested")} className="rounded px-2 py-0.5 text-[10px] bg-white/[0.05] text-muted-foreground hover:bg-white/[0.08]">Reopen</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── System Health ── */}
          {tab === "system" && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { key: "retell",      label: "Retell",       desc: "Voice agent deployment platform", icon: Bot,          href: "/my-agents" },
                { key: "calcom",      label: "Cal.com",      desc: "Appointment booking integration",  icon: CalendarCheck, href: "/settings/calendar" },
                { key: "twilio",      label: "Telephony",    desc: "Twilio phone routing layer",       icon: Phone,         href: "/telephony-settings" },
                { key: "whatsapp",    label: "WhatsApp",     desc: "WhatsApp messaging channel",       icon: Settings2,     href: "/whatsapp" },
                { key: "elevenlabs",  label: "ElevenLabs",   desc: "Custom voice provider",            icon: Brain,         href: "/settings/integrations" },
                { key: "openai",      label: "OpenAI",       desc: "GPT-4o inference (VoxStream)",     icon: Brain,         href: "/settings/integrations" },
                { key: "agents",      label: "Voice Agents", desc: "Agents created in workspace",      icon: Bot,           href: "/my-agents" },
                { key: "campaigns",   label: "Campaigns",    desc: "Call campaign activity",           icon: Megaphone,     href: "/campaigns" },
              ].map(({ key, label, desc, icon: Icon, href }) => {
                const ok = !!(data?.systemHealth as any)?.[key];
                return (
                  <div key={key} className={cn(
                    "rounded-xl border p-4 flex items-start gap-3",
                    ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/15 bg-red-500/5",
                  )}>
                    <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", ok ? "bg-emerald-500/15" : "bg-red-500/10")}>
                      <Icon className={cn("h-4 w-4", ok ? "text-emerald-400" : "text-red-400")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-sm font-semibold">{label}</p>
                        {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 text-red-400" />}
                      </div>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                      <p className={cn("text-[11px] font-medium mt-1", ok ? "text-emerald-400" : "text-red-400")}>{ok ? "Connected & active" : "Not configured"}</p>
                    </div>
                    {!ok && (
                      <Button asChild size="sm" variant="ghost" className="h-7 text-xs shrink-0">
                        <Link to={href}>Setup →</Link>
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Agent Health ── */}
          {tab === "agents" && (
            <div className="space-y-3">
              {(!data?.agentScores || data.agentScores.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                  <Bot className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-base font-semibold">No agents found</p>
                  <Button asChild size="sm" variant="outline"><Link to="/agents/new">Create your first agent</Link></Button>
                </div>
              ) : (
                data.agentScores.map((agent: any) => {
                  const color = agent.score >= 70 ? "text-emerald-400" : agent.score >= 40 ? "text-amber-400" : "text-red-400";
                  const borderColor = agent.score >= 70 ? "border-emerald-500/20" : agent.score >= 40 ? "border-amber-500/20" : "border-red-500/20";
                  return (
                    <div key={agent.id} className={cn("rounded-xl border bg-card/60 p-4 flex items-start gap-4", borderColor)}>
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <div className={cn("text-2xl font-bold tabular-nums", color)}>{agent.score}</div>
                        <p className="text-[10px] text-muted-foreground">Score</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="text-sm font-semibold">{agent.name}</p>
                          {agent.deployed
                            ? <span className="rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20 px-2 py-0.5 text-[10px]">Deployed</span>
                            : <span className="rounded-full bg-red-500/10 text-red-400 ring-1 ring-red-500/20 px-2 py-0.5 text-[10px]">Not deployed</span>
                          }
                          {agent.hasPhone
                            ? <span className="rounded-full bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20 px-2 py-0.5 text-[10px]">Has phone</span>
                            : <span className="rounded-full bg-slate-500/10 text-slate-400 ring-1 ring-slate-500/20 px-2 py-0.5 text-[10px]">No phone</span>
                          }
                        </div>
                        <div className="grid grid-cols-3 gap-3 mt-2">
                          <div>
                            <p className="text-[10px] text-muted-foreground">Calls (30d)</p>
                            <p className="text-sm font-semibold">{agent.callCount}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">Success rate</p>
                            <p className={cn("text-sm font-semibold", agent.successRate >= 50 ? "text-emerald-400" : "text-red-400")}>{agent.successRate}%</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">Mode</p>
                            <p className="text-sm font-semibold capitalize">{agent.deploymentMode}</p>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {agent.breakdown.map((b: string) => (
                            <span key={b} className="text-[10px] text-muted-foreground bg-white/[0.04] rounded px-1.5 py-0.5">{b}</span>
                          ))}
                        </div>
                      </div>
                      <Button asChild size="sm" variant="ghost" className="h-7 text-xs shrink-0">
                        <Link to="/builder">Edit</Link>
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ── Cost Health ── */}
          {tab === "cost" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex gap-3">
                <Info className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">Cost intelligence will display real cost breakdowns once cost tracking is fully enabled. Data shown is estimated from call volume.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { label: "Calls this month", value: data?.calls.total ?? 0, unit: "calls", icon: Phone, color: "text-blue-400" },
                  { label: "Avg call duration", value: data?.calls.avgDuration ? `${data.calls.avgDuration}s` : "—", unit: "", icon: TrendingUp, color: "text-violet-400" },
                  { label: "Est. Retell cost", value: data?.calls.total ? `~$${((data.calls.total * (data.calls.avgDuration ?? 60)) / 60 * 0.05).toFixed(2)}` : "$0.00", unit: "", icon: DollarSign, color: "text-emerald-400" },
                ].map(({ label, value, unit, icon: Icon, color }) => (
                  <div key={label} className="rounded-xl border border-white/[0.06] bg-card/60 p-4 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
                      <Icon className={cn("h-5 w-5", color)} />
                    </div>
                    <div>
                      <p className="text-xl font-bold">{value}<span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span></p>
                      <p className="text-[11px] text-muted-foreground">{label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Reports ── */}
          {tab === "reports" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/[0.06] bg-card/60 p-6 max-w-2xl">
                <div className="flex items-center gap-2.5 mb-3">
                  <Target className="h-5 w-5 text-violet-400" />
                  <h3 className="text-base font-semibold">Generate HiveMind Report</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Produce a full platform summary covering agents, calls, pipeline, campaigns and recommended actions.
                </p>
                <Button
                  className="gap-2"
                  onClick={() => {
                    if (!data) return;
                    const { agents, agentScores, calls, leads, bookings, campaigns, systemHealth } = data;
                    const recs = recommendations;
                    const lines = [
                      "# HiveMind Platform Report",
                      `Generated: ${new Date().toLocaleString()}`,
                      "",
                      "## Platform Summary",
                      `- Platform Score: ${platformScore}/100`,
                      `- Active Issues: ${recs.length} (${criticalCount} critical, ${highCount} high)`,
                      `- Total Agents: ${agents.length}`,
                      `- Deployed Agents: ${agentScores?.filter((a: any) => a.deployed).length ?? 0}`,
                      "",
                      "## Call Performance (Last 30 Days)",
                      `- Total Calls: ${calls.total}`,
                      `- Success Rate: ${calls.successRate}%`,
                      `- Avg Duration: ${calls.avgDuration}s`,
                      "",
                      "## Pipeline",
                      `- Total Leads: ${leads.total}`,
                      `- Need Call: ${leads.needCall}`,
                      `- Stale (14d+): ${leads.stale}`,
                      `- Sales Done: ${leads.sales}`,
                      "",
                      "## Bookings",
                      `- Total: ${bookings.total}`,
                      `- Agent-Booked: ${bookings.agentBooked}`,
                      `- Last 7 Days: ${bookings.recent}`,
                      "",
                      "## System Health",
                      ...Object.entries(systemHealth).map(([k, v]) => `- ${k}: ${v ? "✅" : "❌"}`),
                      "",
                      "## Recommendations",
                      ...recs.map((r, i) => `${i + 1}. [${r.priority.toUpperCase()}] ${r.problem}\n   Fix: ${r.fix}`),
                    ];
                    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = `hivemind-report-${new Date().toISOString().slice(0, 10)}.txt`;
                    a.click(); URL.revokeObjectURL(url);
                    toast.success("Report downloaded");
                  }}
                >
                  <FileText className="h-4 w-4" />
                  Download HiveMind Report
                </Button>
              </div>

              {/* Quick text summary */}
              {data && (
                <div className="rounded-xl border border-white/[0.06] bg-card/60 p-5 max-w-2xl">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-3">Executive Summary</p>
                  <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">
                    <p>Your platform has <span className="text-foreground font-medium">{data.agents.length} agent{data.agents.length !== 1 ? "s" : ""}</span> configured, with {data.agentScores?.filter((a: any) => a.deployed).length ?? 0} deployed.</p>
                    <p>In the last 30 days, <span className="text-foreground font-medium">{data.calls.total} calls</span> were made with a {data.calls.successRate}% success rate.</p>
                    <p>The pipeline contains <span className="text-foreground font-medium">{data.leads.total} leads</span> — {data.leads.needCall} waiting to be called and {data.leads.stale} stale for 14+ days.</p>
                    <p>HiveMind has identified <span className="text-foreground font-medium">{recommendations.length} issues</span> requiring attention{criticalCount > 0 ? `, including ${criticalCount} critical` : ""}.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
