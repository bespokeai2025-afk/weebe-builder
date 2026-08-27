/**
 * Marketing objective chat tools — SERVER ONLY.
 *
 * Lets HiveMind chat convert plain commands into measurable objectives and
 * report the seven-section status (OBJECTIVE / CURRENT PERFORMANCE /
 * DIAGNOSIS / ACTIONS TAKEN / ACTIONS AWAITING APPROVAL / RESULTS / NEXT
 * ACTIONS). All writes stay proposal-only: creating an objective creates a
 * DB record plus (optionally) a delegated GrowthMind work order that itself
 * requires approval — no live platform change ever happens from these tools.
 */
import { z } from "zod";
import { registerMindTool, type MindToolContext, type MindToolRunResult } from "@/lib/minds/tool-registry.server";

type Sb = any;

async function getAdmin(): Promise<Sb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const METRIC_ENUM = z.enum([
  "qualified_opportunities", "booked_demos", "lead_volume", "revenue",
  "wasted_spend", "cost_per_conversion", "conversion_rate",
]);

registerMindTool({
  name: "hivemind.create_marketing_objective",
  mind: "hivemind",
  title: "Create marketing objective",
  description:
    "Convert a plain marketing command (e.g. 'Improve my Google Ads', 'Reduce wasted spend', 'Get me more demo bookings') into a measurable objective with a real data baseline, target direction and optional constraints (like 'maintain CPA'). Google Ads objectives are delegated to GrowthMind as an analysis work order (approval required). Never makes live platform changes.",
  access: "write",
  surface: "registry",
  sensitive: false,
  idempotent: false,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "marketing_automation",
  capabilityState: "available",
  requiredIntegrations: [],
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({
    command: z.string().min(5).describe("The user's plain-language marketing command"),
    title: z.string().optional(),
    metric: METRIC_ENUM.describe("The measurable metric this objective targets"),
    target_direction: z.enum(["increase", "decrease"]).optional(),
    target_pct: z.number().min(1).max(500).optional(),
    deadline: z.string().optional().describe("ISO date, optional"),
    constraints: z.array(z.object({
      metric: METRIC_ENUM,
      rule: z.enum(["maintain", "max", "min"]),
      value: z.number().optional(),
      label: z.string().optional(),
    })).max(5).optional().describe("e.g. maintain cost_per_conversion while increasing volume"),
    delegate: z.boolean().optional().describe("Delegate to GrowthMind now (default true for Google Ads metrics)"),
  }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const sbAdmin = await getAdmin();
    const { createMarketingObjectiveCore } = await import("@/lib/hivemind/marketing-objectives.server");
    const { objective, delegated } = await createMarketingObjectiveCore(sbAdmin, ctx.workspaceId, ctx.userId ?? null, {
      commandText: input.command,
      title: input.title,
      metric: input.metric,
      targetDirection: input.target_direction,
      targetPct: input.target_pct,
      deadline: input.deadline,
      constraints: input.constraints,
      delegate: input.delegate,
    });
    return {
      result: {
        objective_id: objective.id,
        title: objective.title,
        baseline: objective.baseline,
        target: objective.target,
        delegation: delegated,
        note: "Objective recorded with a real-data baseline. Use get_marketing_objective_status for the full OBJECTIVE → NEXT ACTIONS breakdown.",
      },
      affectedRecordType: "marketing_objective",
      affectedRecordId: String(objective.id),
    };
  },
});

registerMindTool({
  name: "hivemind.update_marketing_objective",
  mind: "hivemind",
  title: "Update marketing objective",
  description:
    "Pause, resume, complete or otherwise close a marketing objective, or adjust its target percentage or deadline. Identify it by exact name or id. Only workspace owners and admins can make these changes.",
  access: "write",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "marketing_automation",
  capabilityState: "available",
  requiredIntegrations: [],
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({
    objective_id: z.string().uuid().optional(),
    objective_name: z.string().min(1).max(200).optional().describe("Exact objective name; use id when names are ambiguous"),
    action: z.enum(["pause", "resume", "complete", "mark_not_achieved", "abandon"]).optional(),
    target_pct: z.number().min(1).max(500).nullable().optional().describe("New target percentage; null clears it"),
    deadline: z.string().date().nullable().optional().describe("New ISO calendar date (YYYY-MM-DD); null clears it"),
  }).refine((v) => Boolean(v.objective_id || v.objective_name), {
    message: "Provide objective_id or objective_name",
  }).refine((v) => v.action !== undefined || v.target_pct !== undefined || v.deadline !== undefined, {
    message: "Provide an action, target_pct, or deadline",
  }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const statusByAction = {
      pause: "paused",
      resume: "active",
      complete: "achieved",
      mark_not_achieved: "not_achieved",
      abandon: "abandoned",
    } as const;
    const sbAdmin = await getAdmin();
    const { updateMarketingObjectiveCore } = await import("@/lib/hivemind/marketing-objectives.server");
    const objective = await updateMarketingObjectiveCore(sbAdmin, ctx.workspaceId, ctx.userId ?? null, {
      objectiveId: input.objective_id,
      objectiveName: input.objective_name,
      status: input.action ? statusByAction[input.action as keyof typeof statusByAction] : undefined,
      targetPct: input.target_pct,
      deadline: input.deadline,
    });
    return {
      result: {
        objective_id: objective.id,
        title: objective.title,
        status: objective.status,
        target: objective.target,
        note: "Objective updated. Marketing Operator and objective status views now reflect this change.",
      },
      affectedRecordType: "marketing_objective",
      affectedRecordId: String(objective.id),
    };
  },
});

registerMindTool({
  name: "hivemind.get_marketing_objective_status",
  mind: "hivemind",
  title: "Get marketing objective status",
  description:
    "Return the structured status of a marketing objective: OBJECTIVE, CURRENT PERFORMANCE (real metric vs baseline), DIAGNOSIS, ACTIONS TAKEN (with measured outcomes), ACTIONS AWAITING APPROVAL, RESULTS and NEXT ACTIONS. Present these seven sections to the user — never generic advice.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "marketing_automation",
  capabilityState: "available",
  requiredIntegrations: [],
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({
    objective_id: z.string().uuid().optional().describe("Omit to use the most recent active objective"),
  }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const sbAdmin = await getAdmin();
    let objectiveId = input.objective_id as string | undefined;
    if (!objectiveId) {
      const { data } = await sbAdmin.from("marketing_objectives")
        .select("id").eq("workspace_id", ctx.workspaceId).eq("status", "active")
        .order("created_at", { ascending: false }).limit(1);
      objectiveId = (data?.[0] as any)?.id;
      if (!objectiveId) throw new Error("No active marketing objectives in this workspace. Create one first with create_marketing_objective.");
    }
    const { buildObjectiveStatusCore } = await import("@/lib/hivemind/marketing-objectives.server");
    const view = await buildObjectiveStatusCore(sbAdmin, ctx.workspaceId, objectiveId);
    return {
      result: {
        OBJECTIVE: view.objective,
        CURRENT_PERFORMANCE: view.currentPerformance,
        DIAGNOSIS: view.diagnosis,
        ACTIONS_TAKEN: view.actionsTaken,
        ACTIONS_AWAITING_APPROVAL: view.actionsAwaitingApproval,
        RESULTS: view.results,
        NEXT_ACTIONS: view.nextActions,
      },
      affectedRecordType: "marketing_objective",
      affectedRecordId: String(objectiveId),
    };
  },
});

registerMindTool({
  name: "hivemind.list_marketing_objectives",
  mind: "hivemind",
  title: "List marketing objectives",
  description: "List this workspace's marketing objectives with metric, baseline, target and status, plus current open operator findings.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "marketing_automation",
  capabilityState: "available",
  requiredIntegrations: [],
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({ include_closed: z.boolean().optional() }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    const sbAdmin = await getAdmin();
    let q = sbAdmin.from("marketing_objectives")
      .select("id,title,metric,status,baseline,target,priority,created_at,last_reviewed_at")
      .eq("workspace_id", ctx.workspaceId).order("created_at", { ascending: false }).limit(25);
    if (!input.include_closed) q = q.in("status", ["active", "paused"]);
    const [{ data: objectives }, { data: findings }] = await Promise.all([
      q,
      sbAdmin.from("marketing_operator_findings")
        .select("finding_kind,severity,title,created_at")
        .eq("workspace_id", ctx.workspaceId).eq("status", "open")
        .order("created_at", { ascending: false }).limit(15),
    ]);
    return {
      result: { objectives: objectives ?? [], open_findings: findings ?? [] },
      affectedRecordType: "marketing_objective",
      affectedRecordId: ctx.workspaceId,
    };
  },
});
