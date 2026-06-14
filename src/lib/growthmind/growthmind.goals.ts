import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ───────────────────────────────────────────────────────────────────────

export type GoalMetric =
  | "leads"
  | "bookings"
  | "sales"
  | "call_success_rate"
  | "calls_made";

export const GOAL_METRICS: { key: GoalMetric; label: string; unit: string; description: string }[] = [
  { key: "leads",            label: "New Leads",         unit: "leads",    description: "Total leads added to your CRM" },
  { key: "bookings",         label: "Appointments",       unit: "bookings", description: "Leads with a scheduled appointment" },
  { key: "sales",            label: "Sales Closed",       unit: "sales",    description: "Leads marked as sale done" },
  { key: "call_success_rate", label: "Call Success Rate", unit: "%",        description: "% of calls marked as successful" },
  { key: "calls_made",       label: "Calls Made",         unit: "calls",    description: "Total outbound/inbound calls placed" },
];

export type Goal = {
  id:        string;
  metric:    GoalMetric;
  label:     string;
  target:    number;
  deadline:  string;
  createdAt: string;
};

export type GoalWithProgress = Goal & {
  current:     number;
  pct:         number;
  timeElapsed: number;
  atRisk:      boolean;
  achieved:    boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────────────────

function metricLabel(metric: GoalMetric): string {
  return GOAL_METRICS.find(m => m.key === metric)?.label ?? metric;
}

// ── Server fn: list goals ───────────────────────────────────────────────────────

export const getGoals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_goals")
      .select("id, metric, label, target, deadline, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) {
      if (error.code === "42P01") return { goals: [] };
      throw new Error(error.message);
    }

    const goals: Goal[] = (data ?? []).map((r: any) => ({
      id:        r.id,
      metric:    r.metric as GoalMetric,
      label:     r.label || metricLabel(r.metric as GoalMetric),
      target:    Number(r.target),
      deadline:  r.deadline,
      createdAt: r.created_at,
    }));

    return { goals };
  });

// ── Server fn: get goals with live progress ──────────────────────────────────

export const getGoalsWithProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: goalsData, error: goalsErr } = await sb
      .from("growthmind_goals")
      .select("id, metric, label, target, deadline, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (goalsErr) {
      if (goalsErr.code === "42P01") return { goals: [], tableExists: false };
      throw new Error(goalsErr.message);
    }

    const goals: Goal[] = (goalsData ?? []).map((r: any) => ({
      id:        r.id,
      metric:    r.metric as GoalMetric,
      label:     r.label || metricLabel(r.metric as GoalMetric),
      target:    Number(r.target),
      deadline:  r.deadline,
      createdAt: r.created_at,
    }));

    if (goals.length === 0) return { goals: [], tableExists: true };

    // --- Fetch live metric values in one pass ---

    const now       = new Date();
    const monthAgo  = new Date(now);
    monthAgo.setDate(now.getDate() - 30);

    const [leadsRes, callsRes] = await Promise.all([
      sb.from("leads")
        .select("id, status, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", monthAgo.toISOString())
        .limit(5000),

      sb.from("calls")
        .select("id, call_status, call_successful, started_at")
        .eq("workspace_id", workspaceId)
        .gte("started_at", monthAgo.toISOString())
        .limit(5000),
    ]);

    const leads: any[] = leadsRes.data ?? [];
    const calls: any[] = callsRes.data ?? [];

    const bookings = leads.filter(
      (l: any) => l.status === "appointment_scheduled" || l.status === "sale_done"
    ).length;
    const sales         = leads.filter((l: any) => l.status === "sale_done").length;
    const successCalls  = calls.filter((c: any) => c.call_successful === true).length;
    const callSuccessRate = calls.length > 0
      ? Math.round((successCalls / calls.length) * 100)
      : 0;

    const metricValues: Record<GoalMetric, number> = {
      leads:            leads.length,
      bookings:         bookings,
      sales:            sales,
      call_success_rate: callSuccessRate,
      calls_made:       calls.length,
    };

    const goalsWithProgress: GoalWithProgress[] = goals.map(goal => {
      const current     = metricValues[goal.metric] ?? 0;
      const target      = goal.target;
      const pct         = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

      const start       = new Date(goal.createdAt);
      const deadline    = new Date(goal.deadline);
      const totalMs     = deadline.getTime() - start.getTime();
      const elapsedMs   = now.getTime() - start.getTime();
      const timeElapsed = totalMs > 0
        ? Math.min(1, Math.max(0, elapsedMs / totalMs))
        : 1;

      const achieved    = pct >= 100;
      const atRisk      = !achieved && pct < 70 && timeElapsed > 0.5;

      return { ...goal, current, pct, timeElapsed, atRisk, achieved };
    });

    return { goals: goalsWithProgress, tableExists: true };
  });

// ── Server fn: create goal ──────────────────────────────────────────────────────

export const createGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      metric:   z.enum(["leads", "bookings", "sales", "call_success_rate", "calls_made"]),
      label:    z.string().min(1).max(120),
      target:   z.number().positive(),
      deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb.from("growthmind_goals").insert({
      workspace_id: workspaceId,
      metric:       data.metric,
      label:        data.label,
      target:       data.target,
      deadline:     data.deadline,
    });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Server fn: delete goal ──────────────────────────────────────────────────────

export const deleteGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_goals")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── AI commentary (rule-based) ──────────────────────────────────────────────────

export function goalCommentary(goal: GoalWithProgress): string {
  const { metric, label, target, current, pct, timeElapsed, achieved, atRisk } = goal;
  const metricInfo = GOAL_METRICS.find(m => m.key === metric);
  const unit       = metricInfo?.unit ?? "";
  const needed     = Math.max(0, target - current);
  const daysLeft   = Math.round((new Date(goal.deadline).getTime() - Date.now()) / 86_400_000);
  const timePct    = Math.round(timeElapsed * 100);

  if (achieved) {
    return `Goal achieved! You hit ${current} ${unit} against a target of ${target} ${unit}. Great work — consider raising the bar for next period.`;
  }

  if (atRisk) {
    if (metric === "call_success_rate") {
      return `Call success rate is ${current}% — ${pct}% of the ${target}% target with ${100 - timePct}% of the deadline remaining. Focus on call scripts and objection handling to lift conversion.`;
    }
    return `At risk: ${current} ${unit} logged so far (${pct}% of target) with only ${daysLeft} day${daysLeft === 1 ? "" : "s"} left. You need ${needed} more ${unit} to hit the goal — consider increasing outreach volume.`;
  }

  if (pct >= 70) {
    if (metric === "call_success_rate") {
      return `On track at ${current}% success rate. Keep call quality high and you'll hit ${target}% by the deadline.`;
    }
    return `On track — ${current} ${unit} with ${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining. Keep pace and this goal is well within reach.`;
  }

  if (daysLeft <= 0) {
    return `Deadline reached. Final result: ${current} ${unit} (${pct}% of ${target} target). Review what held this back before setting the next goal.`;
  }

  return `${pct}% complete with ${timePct}% of the time used. ${needed} more ${unit} needed in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`;
}
