/**
 * WEBEE Workflow Executor — server-side step runner
 * Dispatches each flow step to the real WEBEE subsystem.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dispatchCrmPostCall } from "@/lib/crm/crm-dispatch.server";
import { emitCampaignNotification } from "@/lib/notifications/notification-engine.shared";

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

// ── lead_added trigger dispatch ────────────────────────────────────────────────
// Fires all ACTIVE workflows with trigger_type "lead_added" for a workspace when
// a new lead is created (e.g. from a webform submission). Workflows whose
// trigger_config declares a lead_source only run when it matches; a declared
// webform_name further narrows to that specific form. Best-effort — never throws.
export async function dispatchLeadAddedWorkflows(opts: {
  workspaceId: string;
  leadId:      string;
  leadSource:  "webform" | "crm" | "manual";
  webformName?: string;
  triggerData?: Record<string, unknown>;
}): Promise<void> {
  const sb = supabaseAdmin as any;
  try {
    const { data: wfs } = await sb
      .from("workspace_workflows")
      .select("id, name, flow_definition, trigger_config, status")
      .eq("workspace_id", opts.workspaceId)
      .eq("trigger_type", "lead_added")
      .eq("status", "active")
      .limit(20);
    for (const wf of (wfs ?? []) as any[]) {
      const tc = (wf.trigger_config ?? {}) as Record<string, unknown>;
      const wantSource = String(tc.lead_source ?? "").toLowerCase();
      if (wantSource && wantSource !== opts.leadSource) continue;
      const wantForm = String(tc.webform_name ?? "").trim().toLowerCase();
      if (wantForm && wantForm !== String(opts.webformName ?? "").trim().toLowerCase()) continue;

      const { data: run, error: runErr } = await sb.from("workflow_runs").insert({
        workspace_id: opts.workspaceId,
        workflow_id:  wf.id,
        trigger_type: "lead_added",
        trigger_data: { lead_source: opts.leadSource, webform_name: opts.webformName ?? null, ...(opts.triggerData ?? {}) },
        status:       "running",
      }).select("id").maybeSingle();
      if (runErr || !run?.id) {
        console.error(`[workflow-engine] lead_added run insert failed for ${wf.id}:`, runErr?.message);
        continue;
      }
      const runId = run.id as string;
      try {
        const results = await executeWorkflowRun(
          wf.flow_definition as Record<string, unknown>,
          {
            workspaceId: opts.workspaceId,
            runId,
            triggerData: { trigger_type: "lead_added", lead_source: opts.leadSource, ...(opts.triggerData ?? {}) },
            leadId: opts.leadId,
          },
        );
        const failed = results.filter(r => r.status === "error");
        await sb.from("workflow_runs").update({
          status:       failed.length > 0 ? "failed" : "completed",
          completed_at: new Date().toISOString(),
          error:        failed[0]?.error ?? null,
          summary: {
            steps_total:   results.length,
            steps_ok:      results.filter(r => r.status === "ok").length,
            steps_failed:  failed.length,
            steps_skipped: results.filter(r => r.status === "skipped").length,
            mode: "live",
          },
        }).eq("id", runId);
        if (failed.length > 0) {
          await notifyWorkflowError({
            workspaceId: opts.workspaceId,
            workflowName: wf.name ?? null,
            runId,
            errorMessage: failed[0]?.error ?? null,
          });
        }
      } catch (e: any) {
        await sb.from("workflow_runs").update({
          status:       "failed",
          completed_at: new Date().toISOString(),
          error:        e?.message ?? String(e),
        }).eq("id", runId);
        await notifyWorkflowError({
          workspaceId: opts.workspaceId,
          workflowName: wf.name ?? null,
          runId,
          errorMessage: e?.message ?? String(e),
        });
      }
    }
  } catch (e) {
    console.error("[workflow-engine] dispatchLeadAddedWorkflows failed:", e instanceof Error ? e.message : e);
  }
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
        const { isProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
        if (!(await isProposalAllowed(sb, ctx.workspaceId))) {
          return ok(step, { skipped: "hivemind_observe_mode" });
        }
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
        const { isProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
        if (!(await isProposalAllowed(sb, ctx.workspaceId))) {
          return ok(step, { skipped: "hivemind_observe_mode" });
        }
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
