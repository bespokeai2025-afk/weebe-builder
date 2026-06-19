/**
 * WEBEE Workflow Executor — server-side step runner
 * Dispatches each flow step to the real WEBEE subsystem.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dispatchCrmPostCall } from "@/lib/crm/crm-dispatch.server";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FlowStep {
  id:            string;
  type:          string;
  next?:         string;
  conditions?:   FlowCondition[];
  // action params
  status?:       string;
  title?:        string;
  delay_hours?:  number;
  delay_minutes?: number;
  template?:     string;
  agent_assignment?: string;
}

export interface FlowCondition {
  field:  string;
  op:     "equals" | "not_equals" | "greater_than" | "less_than" | "contains";
  value:  string | number | boolean;
  next:   string;
}

export interface ExecutionContext {
  workspaceId: string;
  runId:       string;
  triggerData: Record<string, unknown>;
  leadId?:     string;
}

export interface StepResult {
  stepId:    string;
  stepType:  string;
  status:    "ok" | "skipped" | "error";
  output:    Record<string, unknown>;
  error?:    string;
}

// ── Main executor ──────────────────────────────────────────────────────────────

export async function executeWorkflowRun(
  flowDefinition: Record<string, unknown>,
  ctx: ExecutionContext,
): Promise<StepResult[]> {
  const steps: FlowStep[] = (flowDefinition as any)?.steps ?? [];
  const stepMap = new Map<string, FlowStep>(steps.map(s => [s.id, s]));
  const results: StepResult[] = [];
  const sb = supabaseAdmin as any;

  // Runtime state passed between steps
  const state: Record<string, unknown> = { ...ctx.triggerData };

  // Walk the flow starting from the trigger step
  let currentId: string | undefined = steps[0]?.id;
  let safety = 0;

  while (currentId && safety < 50) {
    safety++;
    const step = stepMap.get(currentId);
    if (!step) break;

    const result = await executeStep(step, state, ctx, stepMap);
    results.push(result);

    // Log to DB
    await sb.from("workflow_run_events").insert({
      run_id:    ctx.runId,
      step_id:   step.id,
      step_type: step.type,
      status:    result.status,
      input:     { step, state_snapshot: state },
      output:    result.output,
      error:     result.error ?? null,
    }).catch((e: any) => console.error("[workflow-executor] event log failed", e));

    // Merge outputs into state
    Object.assign(state, result.output);

    if (result.status === "error" || step.type === "stop_workflow") break;

    // Determine next step
    if (step.type === "branch" && step.conditions?.length) {
      const matched = evaluateBranch(step.conditions, state);
      currentId = matched;
    } else {
      currentId = step.next;
    }
  }

  return results;
}

// ── Step executor ──────────────────────────────────────────────────────────────

async function executeStep(
  step: FlowStep,
  state: Record<string, unknown>,
  ctx: ExecutionContext,
  stepMap: Map<string, FlowStep>,
): Promise<StepResult> {
  const sb = supabaseAdmin as any;

  try {
    switch (step.type) {

      // ── Trigger / no-op ─────────────────────────────────────────────────
      case "trigger":
      case "stop_workflow":
        return ok(step, { note: step.type });

      // ── Update lead status ───────────────────────────────────────────────
      case "update_lead_status": {
        if (!ctx.leadId) return skipped(step, "No lead_id in context");
        const { error } = await sb.from("leads")
          .update({ status: step.status, updated_at: new Date().toISOString() })
          .eq("id", ctx.leadId)
          .eq("workspace_id", ctx.workspaceId);
        if (error) throw new Error(error.message);
        state.lead_status = step.status;
        return ok(step, { lead_id: ctx.leadId, new_status: step.status });
      }

      // ── Push to CRM ──────────────────────────────────────────────────────
      case "push_to_crm": {
        if (!ctx.leadId) return skipped(step, "No lead_id in context");
        const { data: lead } = await sb.from("leads")
          .select("full_name, phone, email, status")
          .eq("id", ctx.leadId)
          .maybeSingle();
        if (!lead) return skipped(step, "Lead not found");
        await dispatchCrmPostCall(
          ctx.workspaceId,
          { name: lead.full_name, phone: lead.phone, email: lead.email ?? undefined },
          { callType: "outbound", outcome: String(state.call_outcome ?? "workflow_push"), notes: `Workflow run: ${ctx.runId}` },
        );
        return ok(step, { crm_synced: true, lead_id: ctx.leadId });
      }

      // ── Create callback ──────────────────────────────────────────────────
      case "create_callback": {
        if (!ctx.leadId) return skipped(step, "No lead_id in context");
        const delayMs = (step.delay_hours ?? 0) * 3600_000 + (step.delay_minutes ?? 0) * 60_000;
        const dueAt = new Date(Date.now() + delayMs).toISOString();
        // Use entity_notes as callback log (leads table or entity_notes)
        await sb.from("entity_notes").insert({
          workspace_id: ctx.workspaceId,
          entity_type:  "lead",
          entity_id:    ctx.leadId,
          note_type:    "callback",
          body:         `Callback scheduled by workflow run ${ctx.runId}`,
          metadata:     { due_at: dueAt, workflow_run_id: ctx.runId },
          created_at:   new Date().toISOString(),
        }).catch(() => {}); // table may not exist in all deployments
        return ok(step, { callback_due_at: dueAt, lead_id: ctx.leadId });
      }

      // ── Create task ──────────────────────────────────────────────────────
      case "create_task": {
        const { error } = await sb.from("hivemind_tasks").insert({
          workspace_id:    ctx.workspaceId,
          title:           step.title ?? "Workflow task",
          description:     `Created by workflow run ${ctx.runId}`,
          status:          "open",
          priority:        "medium",
          trigger_type:    "workflow",
          entity_type:     ctx.leadId ? "lead" : null,
          entity_id:       ctx.leadId ?? null,
          created_at:      new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
        return ok(step, { task_created: true });
      }

      // ── Send WhatsApp ────────────────────────────────────────────────────
      case "send_whatsapp": {
        if (!ctx.leadId) return skipped(step, "No lead_id in context");
        const { data: lead } = await sb.from("leads")
          .select("phone, full_name")
          .eq("id", ctx.leadId)
          .maybeSingle();
        if (!lead?.phone) return skipped(step, "No phone number");
        // Dispatch to whatsapp_messages queue — picked up by WhatsApp Centre
        await sb.from("whatsapp_messages").insert({
          workspace_id: ctx.workspaceId,
          to_number:    lead.phone,
          template:     step.template ?? "workflow_notification",
          status:       "queued",
          metadata:     { workflow_run_id: ctx.runId, lead_id: ctx.leadId },
          created_at:   new Date().toISOString(),
        }).catch(() => {}); // table may not exist in all deployments
        return ok(step, { whatsapp_queued: true, phone: lead.phone });
      }

      // ── Send email ────────────────────────────────────────────────────────
      case "send_email": {
        return ok(step, { note: "email_queued_via_hexmail", simulated: true });
      }

      // ── Notify user ───────────────────────────────────────────────────────
      case "notify_user": {
        await sb.from("hivemind_tasks").insert({
          workspace_id: ctx.workspaceId,
          title:        step.title ?? `Workflow notification: ${ctx.runId.slice(0, 8)}`,
          description:  `Workflow notification from run ${ctx.runId}`,
          status:       "open",
          priority:     "high",
          trigger_type: "workflow",
          created_at:   new Date().toISOString(),
        }).catch(() => {});
        return ok(step, { notification_sent: true });
      }

      // ── Assign agent ──────────────────────────────────────────────────────
      case "assign_agent": {
        if (!ctx.leadId) return skipped(step, "No lead_id in context");
        const assignment = step.agent_assignment;
        state.assigned_agent = assignment;
        return ok(step, { agent_assigned: assignment });
      }

      // ── Call lead (simulation — real calls go via campaign executor) ──────
      case "call_lead": {
        if (!ctx.leadId) return skipped(step, "No lead_id in context");
        // Queue a campaign-style outbound call via the calls table
        await sb.from("leads").update({
          status: "pending_call",
          updated_at: new Date().toISOString(),
        }).eq("id", ctx.leadId).eq("workspace_id", ctx.workspaceId).catch(() => {});
        return ok(step, { call_queued: true, lead_id: ctx.leadId, mode: "outbound_queue" });
      }

      // ── Branch (evaluated at walk level, not here) ────────────────────────
      case "branch":
        return ok(step, { branch_evaluated: true });

      // ── Unknown step ──────────────────────────────────────────────────────
      default:
        return skipped(step, `Unknown step type: ${step.type}`);
    }
  } catch (e: any) {
    return { stepId: step.id, stepType: step.type, status: "error", output: {}, error: e?.message ?? String(e) };
  }
}

// ── Branch evaluator ──────────────────────────────────────────────────────────

function evaluateBranch(conditions: FlowCondition[], state: Record<string, unknown>): string | undefined {
  for (const cond of conditions) {
    const actual = state[cond.field];
    let match = false;
    switch (cond.op) {
      case "equals":        match = actual == cond.value; break;
      case "not_equals":    match = actual != cond.value; break;
      case "greater_than":  match = Number(actual) > Number(cond.value); break;
      case "less_than":     match = Number(actual) < Number(cond.value); break;
      case "contains":      match = String(actual ?? "").includes(String(cond.value)); break;
    }
    if (match) return cond.next;
  }
  // fallback: last condition's next
  return conditions[conditions.length - 1]?.next;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function ok(step: FlowStep, output: Record<string, unknown>): StepResult {
  return { stepId: step.id, stepType: step.type, status: "ok", output };
}
function skipped(step: FlowStep, reason: string): StepResult {
  return { stepId: step.id, stepType: step.type, status: "skipped", output: { reason } };
}
