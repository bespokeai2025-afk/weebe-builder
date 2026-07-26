/**
 * Unified Mind execution engine (Workstream 1).
 *
 * Approving an executable task no longer only flips a status: it revalidates
 * (membership, page-level permission, package entitlement, autonomy mode,
 * required inputs), creates a mind_task_executions record, and dispatches the
 * assigned Mind's adapter. Consequential changes surface as linked
 * hivemind_actions in the existing approval centre; approving that action
 * resumes the execution, verifies the result and attaches evidence.
 *
 * All state changes go through the shared state machine
 * (execution-state.shared.ts) with CAS-style guarded updates.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type ExecutionStatus,
  assertTransition,
  executableKindMeta,
} from "@/lib/hivemind/execution-state.shared";

// ── Guarded transition helper (CAS on current status) ────────────────────────
export async function transitionExecution(
  sb: any,
  workspaceId: string,
  executionId: string,
  from: ExecutionStatus,
  to: ExecutionStatus,
  patch: Record<string, any> = {},
): Promise<Record<string, any>> {
  assertTransition(from, to);
  const { data, error } = await sb.from("mind_task_executions")
    .update({ ...patch, status: to, updated_at: new Date().toISOString() })
    .eq("id", executionId)
    .eq("workspace_id", workspaceId)
    .eq("status", from)
    .select("*");
  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) throw new Error(`Execution ${executionId} is no longer in state "${from}"`);
  return row;
}

async function setTaskExecutionState(
  sb: any,
  workspaceId: string,
  taskId: string,
  patch: Record<string, any>,
): Promise<void> {
  const { error } = await sb.from("hivemind_tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", taskId).eq("workspace_id", workspaceId);
  if (error) throw error;
}

async function setWorkOrderState(
  sb: any,
  workspaceId: string,
  workOrderId: string | null,
  patch: Record<string, any>,
): Promise<void> {
  if (!workOrderId) return;
  await sb.from("work_orders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", workOrderId).eq("workspace_id", workspaceId);
}

// ── Adapter dispatch ──────────────────────────────────────────────────────────
async function dispatchAdapter(opts: {
  sb: any; workspaceId: string; userId: string;
  execution: any; task: any;
}): Promise<void> {
  const { sb, workspaceId, userId, execution, task } = opts;
  const kind = String(task.action_kind ?? "");

  if (kind !== "growthmind.gads_campaign_analysis") {
    throw new Error(`No execution adapter registered for kind "${kind}"`);
  }

  const { runGadsAnalysisExecution } = await import(
    "@/lib/hivemind/mind-adapters/growthmind-gads-analysis.server"
  );
  const outcome = await runGadsAnalysisExecution({
    sb, workspaceId, userId,
    executionId: execution.id,
    taskId: task.id,
    workOrderId: task.work_order_id ?? null,
    inputSpec: (task.input_spec as Record<string, any>) ?? {},
  });

  const nowIso = new Date().toISOString();
  const basePatch: Record<string, any> = {
    steps: outcome.steps,
    artifacts: outcome.artifacts,
  };

  if (outcome.status === "awaiting_action_approval") {
    await transitionExecution(sb, workspaceId, execution.id, "executing", "awaiting_action_approval", {
      ...basePatch, linked_action_id: outcome.linkedActionId,
    });
    await setTaskExecutionState(sb, workspaceId, task.id, {
      execution_status: "awaiting_action_approval",
    });
    await setWorkOrderState(sb, workspaceId, task.work_order_id, { status: "awaiting_approval" });
    return;
  }
  if (outcome.status === "completed") {
    await transitionExecution(sb, workspaceId, execution.id, "executing", "verifying", basePatch);
    await transitionExecution(sb, workspaceId, execution.id, "verifying", "completed", {
      result: outcome.result, evidence: outcome.evidence, finished_at: nowIso,
    });
    await setTaskExecutionState(sb, workspaceId, task.id, {
      execution_status: "completed", status: "completed",
      result_summary: summarizeResult(outcome.result),
      completion_evidence: outcome.evidence, completed_at: nowIso,
    });
    await setWorkOrderState(sb, workspaceId, task.work_order_id, {
      status: "completed", result_summary: summarizeResult(outcome.result),
      evidence: outcome.evidence, completed_at: nowIso,
    });
    return;
  }
  if (outcome.status === "blocked") {
    await transitionExecution(sb, workspaceId, execution.id, "executing", "blocked", {
      ...basePatch, blocked_reason: outcome.blockedReason,
    });
    await setTaskExecutionState(sb, workspaceId, task.id, {
      execution_status: "blocked",
    });
    await setWorkOrderState(sb, workspaceId, task.work_order_id, { status: "blocked" });
    return;
  }
  // failed
  await transitionExecution(sb, workspaceId, execution.id, "executing", "failed", {
    ...basePatch, error_message: outcome.errorMessage, finished_at: nowIso,
  });
  await setTaskExecutionState(sb, workspaceId, task.id, { execution_status: "failed" });
  await setWorkOrderState(sb, workspaceId, task.work_order_id, { status: "failed" });
  throw new Error(outcome.errorMessage ?? "Execution failed");
}

function summarizeResult(result: Record<string, any> | null): string {
  if (!result) return "Execution completed.";
  if (typeof result.summary === "string") return result.summary;
  if (typeof result.recommendations_generated === "number") {
    return `Google Ads analysis completed — ${result.recommendations_generated} recommendation(s) generated, ` +
      `${result.change_requests_created ?? 0} change request(s) drafted.`;
  }
  return "Execution completed.";
}

// ── approveAndRunTask ─────────────────────────────────────────────────────────
export const approveAndRunTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ taskId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId!;
    const userId = (context as any).userId as string;

    // 1. Load task (RLS enforces membership).
    const { data: task, error: te } = await sb.from("hivemind_tasks")
      .select("*").eq("id", data.taskId).eq("workspace_id", workspaceId).single();
    if (te) throw te;
    if (task.task_category !== "executable") {
      throw new Error("This task is not executable — it has no execution specification.");
    }
    // Universal quality gate: an executable task may only run when its
    // intelligence packet reached an approvable readiness state. (Legacy rows
    // with no packet/readiness predate the gate and are allowed.)
    const { assertTaskApprovable } = await import("@/lib/minds/intelligence-packet.server");
    assertTaskApprovable(task);
    const meta = executableKindMeta(task.action_kind);
    if (!meta) throw new Error(`Unknown executable kind: ${task.action_kind}`);

    // 2. Permission + entitlement (role ∩ package ∩ override; fail closed).
    const { requirePageAccess } = await import("@/lib/permissions/permissions.server");
    await requirePageAccess(workspaceId, userId, "growthmind" as any, "approve" as any);

    // 3. Autonomy mode gate (explicit human approval path).
    const { getHiveMindModeConfig, assertExecutionAllowed } =
      await import("@/lib/hivemind/mode-gate.server");
    const cfg = await getHiveMindModeConfig(sb, workspaceId);
    assertExecutionAllowed(cfg, task.action_kind, { explicitApproval: true });

    // 4. Required input fields.
    const spec = (task.input_spec as Record<string, any>) ?? {};
    for (const f of meta.requiredInputFields) {
      if (spec[f] == null || spec[f] === "") {
        throw new Error(`Task is missing required input "${f}" — complete it before approving.`);
      }
    }

    // 5. CAS-claim the task: only one execution may be started.
    const nowIso = new Date().toISOString();
    const { data: claimed, error: ce } = await sb.from("hivemind_tasks")
      .update({
        execution_status: "queued", status: "in_progress", updated_at: nowIso,
      })
      .eq("id", task.id).eq("workspace_id", workspaceId)
      // Claimable only from non-running states (blocked/failed = retry).
      .in("execution_status", ["awaiting_approval", "draft", "blocked", "failed"])
      .select("id");
    if (ce) throw ce;
    let claimedRows = claimed ?? [];
    if (!claimedRows.length) {
      // Orphan reclaim: a crash between claim and execution insert can leave
      // the task "queued" with no execution row. Such a task is safely
      // re-claimable (there is no worker attached to it).
      const { data: orphan, error: oe } = await sb.from("hivemind_tasks")
        .update({ execution_status: "queued", status: "in_progress", updated_at: nowIso })
        .eq("id", task.id).eq("workspace_id", workspaceId)
        .eq("execution_status", "queued")
        .is("active_execution_id", null)
        .select("id");
      if (oe) throw oe;
      claimedRows = orphan ?? [];
    }
    if (!claimedRows.length) {
      throw new Error("Task already has an active execution or was claimed by another request.");
    }

    // 6. Create the execution record.
    const { initialGadsAnalysisSteps } = await import(
      "@/lib/hivemind/mind-adapters/growthmind-gads-analysis.server"
    );
    const { data: execution, error: ee } = await sb.from("mind_task_executions").insert({
      workspace_id: workspaceId,
      task_id: task.id,
      work_order_id: task.work_order_id ?? null,
      assigned_mind: task.assigned_mind ?? meta.mind,
      action_kind: task.action_kind,
      status: "queued",
      trigger_source: "user_approval",
      triggered_by_user: userId,
      input_spec: spec,
      steps: initialGadsAnalysisSteps(),
    }).select("*").single();
    if (ee) {
      // Roll the claim back so the task is retryable.
      await sb.from("hivemind_tasks").update({
        execution_status: task.execution_status ?? "awaiting_approval",
        status: task.status, updated_at: new Date().toISOString(),
      }).eq("id", task.id).eq("workspace_id", workspaceId);
      throw ee;
    }
    await setTaskExecutionState(sb, workspaceId, task.id, { active_execution_id: execution.id });
    await setWorkOrderState(sb, workspaceId, task.work_order_id, { status: "in_progress" });

    // 7. Worker starts → Executing (never before).
    const running = await transitionExecution(sb, workspaceId, execution.id, "queued", "executing", {
      started_at: new Date().toISOString(),
    });
    await setTaskExecutionState(sb, workspaceId, task.id, { execution_status: "executing" });

    // 8. Dispatch the Mind adapter (real work happens here).
    try {
      await dispatchAdapter({ sb, workspaceId, userId, execution: running, task });
    } catch (err: any) {
      // dispatchAdapter records failed state itself before throwing; make sure
      // an unexpected pre-adapter throw doesn't leave the row stuck.
      const { data: cur } = await sb.from("mind_task_executions")
        .select("status").eq("id", execution.id).eq("workspace_id", workspaceId).single();
      if (cur && !["failed", "blocked", "completed", "partially_completed", "awaiting_action_approval"].includes(cur.status)) {
        await sb.from("mind_task_executions").update({
          status: "failed", error_message: err?.message ?? String(err),
          finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("id", execution.id).eq("workspace_id", workspaceId);
        await setTaskExecutionState(sb, workspaceId, task.id, { execution_status: "failed" });
      }
      throw err;
    }

    const { data: finalExec } = await sb.from("mind_task_executions")
      .select("*").eq("id", execution.id).eq("workspace_id", workspaceId).single();
    return { ok: true as const, execution: finalExec };
  });

// ── Resume after linked action approval ──────────────────────────────────────
/**
 * Called from approveHiveMindActionCore after an action with execution_id
 * executed successfully. Verifies the internal change actually persisted,
 * attaches evidence, and closes out execution + task + work order honestly:
 * partially_completed, because the external Google Ads write stage remains
 * awaiting integration (GrowthMind is advisory-only).
 */
export async function resumeExecutionForAction(
  sb: any,
  workspaceId: string,
  action: { id: string; execution_id?: string | null; task_id?: string | null; work_order_id?: string | null },
  actionResult: Record<string, any>,
): Promise<void> {
  const executionId = action.execution_id;
  if (!executionId) return;

  const { data: execution } = await sb.from("mind_task_executions")
    .select("*").eq("id", executionId).eq("workspace_id", workspaceId).maybeSingle();
  if (!execution) return;
  if (execution.status !== "awaiting_action_approval") return;

  await transitionExecution(sb, workspaceId, executionId, "awaiting_action_approval", "verifying");

  // Verify: re-read the change requests the action claims to have created.
  const claimedIds: string[] = Array.isArray(actionResult?.change_request_ids)
    ? actionResult.change_request_ids.map(String) : [];
  let verifiedCount = 0;
  if (claimedIds.length) {
    const { data: rows } = await sb.from("growthmind_gads_change_requests")
      .select("id").eq("workspace_id", workspaceId).in("id", claimedIds);
    verifiedCount = (rows ?? []).length;
  }
  const verified = verifiedCount === claimedIds.length && claimedIds.length > 0;

  const nowIso = new Date().toISOString();
  const evidence = {
    action_id: action.id,
    change_request_ids: claimedIds,
    change_requests_verified: verifiedCount,
    verified,
    external_write: "blocked_awaiting_integration",
    external_write_note:
      "No live Google Ads changes were made. Change requests are drafted and verified internally; applying them to Google Ads requires the (intentionally absent) external write integration.",
    verified_at: nowIso,
  };

  if (!verified) {
    await transitionExecution(sb, workspaceId, executionId, "verifying", "failed", {
      error_message: `Verification failed: only ${verifiedCount}/${claimedIds.length} change requests found after execution.`,
      evidence, finished_at: nowIso,
    });
    if (action.task_id) {
      await setTaskExecutionState(sb, workspaceId, action.task_id, { execution_status: "failed" });
    }
    await setWorkOrderState(sb, workspaceId, action.work_order_id ?? execution.work_order_id, { status: "failed" });
    return;
  }

  const result = {
    summary: `Analysis complete. ${verifiedCount} Google Ads change request(s) drafted and verified. External application to Google Ads is awaiting integration.`,
    change_requests_created: verifiedCount,
    change_request_ids: claimedIds,
  };
  await transitionExecution(sb, workspaceId, executionId, "verifying", "partially_completed", {
    result, evidence, finished_at: nowIso,
  });
  const taskId = action.task_id ?? execution.task_id;
  if (taskId) {
    await setTaskExecutionState(sb, workspaceId, taskId, {
      execution_status: "partially_completed",
      status: "completed",
      result_summary: result.summary,
      completion_evidence: evidence,
      completed_at: nowIso,
    });
  }
  await setWorkOrderState(sb, workspaceId, action.work_order_id ?? execution.work_order_id, {
    status: "partially_completed", result_summary: result.summary,
    evidence, completed_at: nowIso,
  });
}

// ── Read: execution detail for a task ────────────────────────────────────────
export const getTaskExecutionDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ taskId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId!;
    const { data: executions, error } = await sb.from("mind_task_executions")
      .select("*").eq("workspace_id", workspaceId).eq("task_id", data.taskId)
      .order("created_at", { ascending: false }).limit(5);
    if (error) throw error;
    const latest = (executions ?? [])[0] ?? null;
    let linkedAction: any = null;
    if (latest?.linked_action_id) {
      const { data: act } = await sb.from("hivemind_actions")
        .select("id, title, status, action_type, created_at, executed_at, error_message")
        .eq("id", latest.linked_action_id).eq("workspace_id", workspaceId).maybeSingle();
      linkedAction = act ?? null;
    }
    return { executions: executions ?? [], latest, linkedAction } as any;
  });
