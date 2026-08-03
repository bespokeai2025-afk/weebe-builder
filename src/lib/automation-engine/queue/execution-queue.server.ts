/**
 * Execution queue — long-running / production workflow runs.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { maskRecord } from "@/lib/systemmind/call-runtime/executions.server";
import type { ExecutionMode } from "../runtime/execution-modes";
import { runExecution } from "../runtime/execution-runner";
import {
  createExecutionRun,
  createStepWriterHooks,
  finalizeExecutionRun,
} from "../persistence/step-writer.server";
import { executionSummary } from "../executor/workflow-executor";

const sb = supabaseAdmin as any;

export type QueueRow = {
  id: string;
  workspaceId: string;
  executionId: string | null;
  workflowDocument: Record<string, unknown>;
  trigger: Record<string, unknown>;
  mode: ExecutionMode;
  status: string;
  attemptCount: number;
  maxAttempts: number;
};

function mapQueueRow(row: Record<string, unknown>): QueueRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    executionId: row.execution_id ? String(row.execution_id) : null,
    workflowDocument: (row.workflow_document ?? {}) as Record<string, unknown>,
    trigger: (row.trigger_masked ?? {}) as Record<string, unknown>,
    mode: String(row.mode ?? "production") as ExecutionMode,
    status: String(row.status ?? "pending"),
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 3),
  };
}

export async function enqueueExecution(args: {
  workspaceId: string;
  workflow: Record<string, unknown>;
  trigger?: Record<string, unknown>;
  mode?: ExecutionMode;
  executionId?: string;
  workflowId?: string | null;
  workflowName?: string;
  priority?: number;
}): Promise<{ queueId: string; executionId: string }> {
  const executionId = args.executionId ?? crypto.randomUUID();
  const mode = args.mode ?? "production";

  await createExecutionRun({
    workspaceId: args.workspaceId,
    executionId,
    workflowId: args.workflowId,
    workflowName: args.workflowName ?? String(args.workflow.name ?? "Workflow"),
    mode,
    trigger: args.trigger,
  });

  const { data, error } = await sb
    .from("automation_execution_queue")
    .insert({
      workspace_id: args.workspaceId,
      execution_id: executionId,
      workflow_id: args.workflowId ?? null,
      workflow_document: args.workflow,
      trigger_masked: maskRecord(args.trigger ?? {}),
      mode,
      status: "pending",
      priority: args.priority ?? 0,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return { queueId: String(data.id), executionId };
}

export async function claimNextQueueItem(): Promise<QueueRow | null> {
  const { data, error } = await sb
    .from("automation_execution_queue")
    .select("*")
    .eq("status", "pending")
    .lte("next_run_at", new Date().toISOString())
    .order("priority", { ascending: false })
    .order("next_run_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = mapQueueRow(data as Record<string, unknown>);

  const { error: updErr } = await sb
    .from("automation_execution_queue")
    .update({
      status: "processing",
      attempt_count: row.attemptCount + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "pending");

  if (updErr) return null;
  return { ...row, attemptCount: row.attemptCount + 1, status: "processing" };
}

export async function processQueueItem(item: QueueRow): Promise<void> {
  const executionId = item.executionId ?? crypto.randomUUID();
  const hooks = createStepWriterHooks({
    workspaceId: item.workspaceId,
    executionId,
  });

  try {
    const result = await runExecution({
      workflow: item.workflowDocument,
      mode: item.mode,
      executionId,
      workspaceId: item.workspaceId,
      trigger: item.trigger,
      onStep: hooks.onStep,
      onWaiting: hooks.onWaiting,
    });

    const summary = executionSummary(result);
    await finalizeExecutionRun({
      workspaceId: item.workspaceId,
      executionId,
      status: result.status,
      summary: {
        nodeCount: summary.nodesExecuted,
        nodesSucceeded: summary.nodesSucceeded,
        nodesFailed: summary.nodesFailed,
        nodesWaiting: summary.nodesWaiting,
        durationMs: summary.durationMs,
        waitingOn: result.waitingOn ?? null,
      },
      lastError: result.lastError,
      snapshot: result.status === "waiting" ? undefined : null,
    });

    await sb
      .from("automation_execution_queue")
      .update({
        status: result.status === "waiting" ? "completed" : result.status === "failed" ? "failed" : "completed",
        updated_at: new Date().toISOString(),
        last_error: result.lastError ?? null,
      })
      .eq("id", item.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const retry = item.attemptCount < item.maxAttempts;
    await sb
      .from("automation_execution_queue")
      .update({
        status: retry ? "pending" : "failed",
        last_error: msg,
        next_run_at: retry
          ? new Date(Date.now() + Math.min(60_000 * item.attemptCount, 300_000)).toISOString()
          : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    await finalizeExecutionRun({
      workspaceId: item.workspaceId,
      executionId,
      status: "failed",
      summary: { nodeCount: 0 },
      lastError: msg,
    });
  }
}

export async function drainExecutionQueue(maxItems = 5): Promise<number> {
  let processed = 0;
  for (let i = 0; i < maxItems; i++) {
    const item = await claimNextQueueItem();
    if (!item) break;
    await processQueueItem(item);
    processed += 1;
  }
  return processed;
}

export async function loadWorkflowDocumentForExecution(
  executionId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await sb
    .from("automation_execution_queue")
    .select("workflow_document")
    .eq("execution_id", executionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.workflow_document) return null;
  return data.workflow_document as Record<string, unknown>;
}
