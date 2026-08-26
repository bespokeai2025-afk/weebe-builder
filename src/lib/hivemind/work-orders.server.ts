/**
 * Work orders — the parent objective linking recommendation → tasks →
 * executions → actions → evidence (Workstream 1).
 *
 * The first supported flow creates a work order with a single executable
 * GrowthMind task (Google Ads campaign analysis). Creation is a proposal:
 * nothing executes until a user approves & runs the task.
 *
 * `createGadsAnalysisWorkOrderCore` is the plain (non-server-fn) core so the
 * HiveMind chat tool registry can create the SAME records from a normal
 * conversation instruction — one code path, one record chain.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface GadsWorkOrderOptions {
  title?: string;
  objective?: string;
  /** Exact marketing objective that originated this delegated work order. */
  objectiveId?: string | null;
  days?: number;
  /** Optional campaign focus resolved from live synced data. */
  focusCampaignId?: string | null;
  focusCampaignName?: string | null;
  source?: string;
  sourceConversationId?: string | null;
}

export async function createGadsAnalysisWorkOrderCore(
  sb: any,
  workspaceId: string,
  userId: string | null,
  opts: GadsWorkOrderOptions = {},
): Promise<{ workOrder: any; task: any }> {
  // Proposals are blocked in Observe mode (same rule as actions/tasks).
  const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
  await assertProposalAllowed(sb, workspaceId);

  const days = Math.min(90, Math.max(7, Math.round(opts.days ?? 30)));
  const focusName = opts.focusCampaignName?.trim() || null;
  const focusId = opts.focusCampaignId?.trim() || null;

  // Universal intelligence packet — the full evidence-backed proposal that
  // makes this task approvable (Ready for Analysis Approval).
  const { buildIntelligencePacket, prepareMindTaskInsert, evidenceItem } =
    await import("@/lib/minds/intelligence-packet.server");
  const packet = buildIntelligencePacket({
    mind: "growthmind",
    objective: opts.objective?.trim() ||
      (focusName
        ? `Analyse Google Ads performance with focus on the "${focusName}" campaign and draft prioritised optimisation change requests.`
        : "Analyse Google Ads performance and draft prioritised optimisation change requests."),
    intentSource: opts.source === "hivemind_tool" ? "chat_tool:create_gads_analysis_work_order" : "manual:gads_work_order",
    targets: [{
      domain: "marketing",
      entity_type: focusId || focusName ? "gads_campaign" : "gads_account",
      entity_id: focusId,
      entity_name: focusName ?? "Google Ads account",
      resolved: true,
      resolution_note: focusName ? "Resolved against live synced campaign data." : null,
    }],
    evidence: [evidenceItem(
      "growthmind_gads_campaigns",
      `Synced Google Ads data available for the last ${days} days${focusName ? `; focus campaign "${focusName}" resolved against live synced campaigns` : ""}.`,
      { lookback_days: days, focus_campaign_id: focusId, focus_campaign_name: focusName },
    )],
    diagnosis:
      "Campaign performance has not been analysed recently; the GrowthMind analysis engine will refresh data, evaluate performance and identify optimisation opportunities.",
    planSteps: [
      { title: "Refresh Google Ads data", action_kind: "growthmind.gads_campaign_analysis" },
      { title: "Run performance analysis across campaigns, ad groups, keywords and budgets" },
      { title: "Compile analysis report" },
      { title: "Draft prioritised change requests for separate approval" },
    ],
    proposedChanges: [{
      target: focusName ? `Google Ads campaign "${focusName}"` : "Google Ads account",
      change: "Draft internal change requests only — no live Google Ads changes are made.",
      reversible: true,
    }],
    deliverables: ["Analysis report", "Prioritised change-request drafts (approval required)"],
    successCriteria: ["Analysis completes with a report", "Change requests are drafted and verified internally"],
    limitations: ["GrowthMind is advisory-only: applying changes to Google Ads requires separate approval and the external write integration."],
    cost: { known: false, note: "Internal analysis — no ad spend is changed by this task." },
    approvalScope: {
      kind: "analysis",
      summary: `Approve & run a read-only Google Ads analysis (last ${days} days${focusName ? `, focused on "${focusName}"` : ""}). Drafts change requests; makes no live changes.`,
      sensitive: false,
    },
    monitoring: { metrics: ["recommendations_generated", "change_requests_created"], reassess_after_days: 14 },
  });

  const { data: wo, error: we } = await sb.from("work_orders").insert({
    workspace_id: workspaceId,
    title: opts.title?.trim() ||
      (focusName ? `Improve "${focusName}" campaign` : "Google Ads campaign optimisation"),
    objective: opts.objective?.trim() ||
      (focusName
        ? `Analyse Google Ads performance with focus on the "${focusName}" campaign and draft prioritised optimisation change requests.`
        : "Analyse Google Ads performance and draft prioritised optimisation change requests."),
    status: "open",
    source: opts.source ?? "manual",
    source_conversation_id: opts.sourceConversationId ?? null,
    created_by_user_id: userId,
    assigned_minds: ["growthmind"],
    metadata: focusId || focusName
      ? { focus_campaign_id: focusId, focus_campaign_name: focusName }
      : null,
    intelligence_packet: packet,
    readiness_state: "ready_for_analysis_approval",
    packet_version: packet.version,
  }).select("*").single();
  if (we) throw we;

  const taskRow = prepareMindTaskInsert({
    workspace_id: workspaceId,
    title: focusName
      ? `Run Google Ads analysis focused on "${focusName}" (last ${days} days)`
      : `Run Google Ads campaign analysis (last ${days} days)`,
    description:
      "Executable task: refreshes Google Ads data, runs the GrowthMind analysis engine, compiles a report and proposes change-request drafts for approval. No live ad changes are made." +
      (focusName ? ` Change requests are prioritised for the "${focusName}" campaign.` : ""),
    status: "suggested",
    priority: "high",
    source: "work_order",
    trigger_type: "gads_analysis",
    task_category: "executable",
    assigned_mind: "growthmind",
    action_kind: "growthmind.gads_campaign_analysis",
    execution_status: "awaiting_approval",
    input_spec: {
      days,
      ...(opts.objectiveId ? { objective_id: opts.objectiveId } : {}),
      ...(focusId || focusName
        ? { focus_campaign: { campaign_id: focusId, campaign_name: focusName } }
        : {}),
    },
    work_order_id: wo.id,
  }, packet);

  const { data: task, error: te } = await sb.from("hivemind_tasks")
    .insert(taskRow).select("*").single();
  if (te) {
    await sb.from("work_orders").delete().eq("id", wo.id).eq("workspace_id", workspaceId);
    throw te;
  }

  return { workOrder: wo, task };
}

export const createGadsAnalysisWorkOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
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
    return await createGadsAnalysisWorkOrderCore(sb, workspaceId, userId, data) as any;
  });

export const getWorkOrderDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId!;
    const userId = (context as any).userId;

    const { requirePageAccessEntitled } = await import("@/lib/packages/entitlements.server");
    await requirePageAccessEntitled(workspaceId, userId, "hivemind", "view");

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
