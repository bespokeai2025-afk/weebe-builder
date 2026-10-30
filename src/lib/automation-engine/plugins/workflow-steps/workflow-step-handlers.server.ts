/**
 * Workflow Builder steps — what each step of a workspace workflow does.
 *
 * Moved from the old workflow engine (lib/workflow-engine/workflow-executor.server.ts) unchanged in
 * behaviour; the automation engine now runs them (register-workflow-step-nodes.ts), so these runs
 * get the same persisted steps, error handling and retention as every other automation.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dispatchCrmPostCall } from "@/lib/crm/crm-dispatch.server";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp/wati-campaign.server";
import { emitCampaignNotification } from "@/lib/notifications/notification-engine.shared";

/** One step as saved by the Workflow Builder (`workspace_workflows.flow_definition.steps`). */
export interface FlowStep {
  id: string;
  type: string;
  next?: string;
  conditions?: FlowCondition[];
  status?: string;
  title?: string;
  delay_hours?: number;
  delay_minutes?: number;
  template?: string;
  agent_assignment?: string;
}

export interface FlowCondition {
  field: string;
  op: "equals" | "not_equals" | "greater_than" | "less_than" | "contains";
  value: string | number | boolean;
  next: string;
}

export interface StepRunContext {
  workspaceId: string;
  /** The automation execution id (was the workflow_runs id). */
  runId: string;
  leadId?: string;
  /** Accumulated outputs of earlier steps plus the trigger data. */
  state: Record<string, unknown>;
}

/** What a step reports; `skipped` steps are recorded and the workflow carries on. */
export type StepOutcome = { skipped?: string } & Record<string, unknown>;

const sb = supabaseAdmin as any;

export async function runFlowStep(step: FlowStep, ctx: StepRunContext): Promise<StepOutcome> {
  switch (step.type) {
    case "trigger":
    case "stop_workflow":
    case "branch":
      return { note: step.type };

    case "update_lead_status": {
      if (!ctx.leadId) return { skipped: "No lead_id in context" };
      const { error } = await sb
        .from("leads")
        .update({ status: step.status, updated_at: new Date().toISOString() })
        .eq("id", ctx.leadId)
        .eq("workspace_id", ctx.workspaceId);
      if (error) throw new Error(error.message);
      return { lead_id: ctx.leadId, new_status: step.status, lead_status: step.status };
    }

    case "push_to_crm": {
      if (!ctx.leadId) return { skipped: "No lead_id in context" };
      const { data: lead } = await sb
        .from("leads")
        .select("full_name, phone, email, status")
        .eq("id", ctx.leadId)
        .maybeSingle();
      if (!lead) return { skipped: "Lead not found" };
      await dispatchCrmPostCall(
        ctx.workspaceId,
        { name: lead.full_name, phone: lead.phone, email: lead.email ?? undefined },
        {
          phone: lead.phone,
          contactName: lead.full_name,
          summary: `Outcome: ${String(ctx.state.call_outcome ?? "workflow_push")} — workflow run ${ctx.runId}`,
          // No provider call behind a workflow push; the run id keeps the activity unique.
          callId: `workflow:${ctx.runId}`,
        },
      );
      return { crm_synced: true, lead_id: ctx.leadId };
    }

    case "create_callback": {
      if (!ctx.leadId) return { skipped: "No lead_id in context" };
      const delayMs = (step.delay_hours ?? 0) * 3600_000 + (step.delay_minutes ?? 0) * 60_000;
      const dueAt = new Date(Date.now() + delayMs).toISOString();
      await sb
        .from("entity_notes")
        .insert({
          workspace_id: ctx.workspaceId,
          entity_type: "lead",
          entity_id: ctx.leadId,
          note_type: "callback",
          body: `Callback scheduled by workflow run ${ctx.runId}`,
          metadata: { due_at: dueAt, workflow_run_id: ctx.runId },
          created_at: new Date().toISOString(),
        })
        .then(
          () => {},
          () => {},
        ); // table may not exist in all deployments
      return { callback_due_at: dueAt, lead_id: ctx.leadId };
    }

    case "create_task": {
      const { isProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
      if (!(await isProposalAllowed(sb, ctx.workspaceId))) return { skipped: "hivemind_observe_mode" };
      // JUSTIFIED-EXCEPTION (Task #500): a user-authored workflow step, not autonomous Mind output,
      // so no intelligence packet.
      const { error } = await sb.from("hivemind_tasks").insert({
        workspace_id: ctx.workspaceId,
        title: step.title ?? "Workflow task",
        description: `Created by workflow run ${ctx.runId}`,
        status: "open",
        priority: "medium",
        trigger_type: "workflow",
        entity_type: ctx.leadId ? "lead" : null,
        entity_id: ctx.leadId ?? null,
        created_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      return { task_created: true };
    }

    case "send_whatsapp": {
      if (!ctx.leadId) return { skipped: "No lead_id in context" };
      const { data: lead } = await sb.from("leads").select("phone, full_name").eq("id", ctx.leadId).maybeSingle();
      if (!lead?.phone) return { skipped: "No phone number" };
      // Queues an outbound row for the WhatsApp Centre to pick up.
      const templateName = step.template ?? "workflow_notification";
      const { error: waErr } = await sb.from("whatsapp_messages").insert({
        workspace_id: ctx.workspaceId,
        contact_phone: normalizeWhatsAppPhone(lead.phone),
        contact_name: lead.full_name ?? null,
        lead_id: ctx.leadId,
        direction: "outbound",
        provider: "wati",
        status: "queued",
        body: `[Template: ${templateName}]`,
        sent_at: new Date().toISOString(),
      });
      if (waErr) return { skipped: `WhatsApp queue failed: ${waErr.message}` };
      return { whatsapp_queued: true, phone: lead.phone };
    }

    case "send_email":
      return { note: "email_queued_via_hexmail", simulated: true };

    case "notify_user": {
      const { isProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
      if (!(await isProposalAllowed(sb, ctx.workspaceId))) return { skipped: "hivemind_observe_mode" };
      // JUSTIFIED-EXCEPTION (Task #500): notification from a user-authored workflow step.
      await sb
        .from("hivemind_tasks")
        .insert({
          workspace_id: ctx.workspaceId,
          title: step.title ?? `Workflow notification: ${ctx.runId.slice(0, 8)}`,
          description: `Workflow notification from run ${ctx.runId}`,
          status: "open",
          priority: "high",
          trigger_type: "workflow",
          created_at: new Date().toISOString(),
        })
        .then(
          () => {},
          () => {},
        );
      return { notification_sent: true };
    }

    case "assign_agent":
      if (!ctx.leadId) return { skipped: "No lead_id in context" };
      return { agent_assigned: step.agent_assignment, assigned_agent: step.agent_assignment };

    case "call_lead": {
      if (!ctx.leadId) return { skipped: "No lead_id in context" };
      // Marks the lead for the outbound queue; real calls go through the campaign executor.
      await sb
        .from("leads")
        .update({ status: "pending_call", updated_at: new Date().toISOString() })
        .eq("id", ctx.leadId)
        .eq("workspace_id", ctx.workspaceId)
        .then(
          () => {},
          () => {},
        );
      return { call_queued: true, lead_id: ctx.leadId, mode: "outbound_queue" };
    }

    default:
      return { skipped: `Unknown step type: ${step.type}` };
  }
}

/**
 * Index of the first matching condition. None match → the last one, as the old engine did, so a
 * branch always continues somewhere.
 */
export function pickBranchCondition(conditions: FlowCondition[], state: Record<string, unknown>): number {
  for (let i = 0; i < conditions.length; i++) {
    const cond = conditions[i]!;
    const actual = state[cond.field];
    let match = false;
    switch (cond.op) {
      case "equals":
        match = actual == cond.value;
        break;
      case "not_equals":
        match = actual != cond.value;
        break;
      case "greater_than":
        match = Number(actual) > Number(cond.value);
        break;
      case "less_than":
        match = Number(actual) < Number(cond.value);
        break;
      case "contains":
        match = String(actual ?? "").includes(String(cond.value));
        break;
    }
    if (match) return i;
  }
  return conditions.length - 1;
}

/** Best-effort workflow_error notification. Never throws. */
export async function notifyWorkflowError(opts: {
  workspaceId: string;
  workflowName?: string | null;
  runId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await emitCampaignNotification(supabaseAdmin as any, {
    workspaceId: opts.workspaceId,
    eventKey: "workflow_error",
    summary: `Workflow ${opts.workflowName ? `"${opts.workflowName}" ` : ""}run failed${opts.runId ? ` (run ${opts.runId.slice(0, 8)})` : ""}.`,
    failureReason: opts.errorMessage?.slice(0, 400) ?? null,
    recommendedAction: "Open the workflow's run history to review the failed step, then re-run or fix the workflow.",
  });
}
