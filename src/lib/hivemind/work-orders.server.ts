/**
 * Work orders — the parent objective linking recommendation → tasks →
 * executions → actions → evidence (Workstream 1).
 *
 * The first supported flow creates a work order with a single executable
 * GrowthMind task (Google Ads campaign analysis). Creation is a proposal:
 * nothing executes until a user approves & runs the task.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const createGadsAnalysisWorkOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      title:     z.string().min(1).max(300).default("Google Ads campaign optimisation"),
      objective: z.string().max(2000).optional(),
      days:      z.number().int().min(7).max(90).default(30),
    }).parse(input ?? {})
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId!;
    const userId = (context as any).userId as string;

    // Proposals are blocked in Observe mode (same rule as actions/tasks).
    const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
    await assertProposalAllowed(sb, workspaceId);

    const { data: wo, error: we } = await sb.from("work_orders").insert({
      workspace_id: workspaceId,
      title: data.title,
      objective: data.objective ?? "Analyse Google Ads performance and draft prioritised optimisation change requests.",
      status: "open",
      source: "manual",
      created_by_user_id: userId,
      assigned_minds: ["growthmind"],
    }).select("*").single();
    if (we) throw we;

    const { data: task, error: te } = await sb.from("hivemind_tasks").insert({
      workspace_id: workspaceId,
      title: `Run Google Ads campaign analysis (last ${data.days} days)`,
      description:
        "Executable task: refreshes Google Ads data, runs the GrowthMind analysis engine, compiles a report and proposes change-request drafts for approval. No live ad changes are made.",
      status: "suggested",
      priority: "high",
      source: "work_order",
      trigger_type: "gads_analysis",
      task_category: "executable",
      assigned_mind: "growthmind",
      action_kind: "growthmind.gads_campaign_analysis",
      execution_status: "awaiting_approval",
      input_spec: { days: data.days },
      work_order_id: wo.id,
    }).select("*").single();
    if (te) {
      await sb.from("work_orders").delete().eq("id", wo.id).eq("workspace_id", workspaceId);
      throw te;
    }

    return { workOrder: wo, task } as any;
  });

export const getWorkOrderDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId!;
    const [{ data: wo, error: we }, { data: tasks }, { data: executions }, { data: actions }] =
      await Promise.all([
        sb.from("work_orders").select("*").eq("id", data.id).eq("workspace_id", workspaceId).single(),
        sb.from("hivemind_tasks").select("*").eq("work_order_id", data.id).eq("workspace_id", workspaceId).order("created_at"),
        sb.from("mind_task_executions").select("*").eq("work_order_id", data.id).eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
        sb.from("hivemind_actions").select("id, title, status, action_type, created_at, executed_at, task_id, execution_id").eq("work_order_id", data.id).eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
      ]);
    if (we) throw we;
    return {
      workOrder: wo,
      tasks: tasks ?? [],
      executions: executions ?? [],
      actions: actions ?? [],
    } as any;
  });
