/**
 * Automation engine — execution persistence (Phase 3).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { maskRecord } from "@/lib/systemmind/call-runtime/executions.server";
import type { WorkflowExecutionResult } from "../executor/execution.types";
import type { ExecutionStatus } from "../types/execution.schema";

const sb = supabaseAdmin as any;

export type AutomationExecutionSource = "manual" | "dry_run" | "webhook" | "queue";

export type AutomationExecutionRow = {
  id: string;
  workspaceId: string;
  workflowId: string | null;
  wbahJobId: string | null;
  workflowName: string;
  source: AutomationExecutionSource;
  status: ExecutionStatus;
  summary: Record<string, unknown>;
  lastError: string | null;
  startedAt: string;
  completedAt: string | null;
  nodeCount: number;
  nodesSucceeded: number;
  nodesFailed: number;
};

export type AutomationExecutionStepRow = {
  id: string;
  sequenceNum: number;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  status: string;
  branch: string | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  outputMasked: Record<string, unknown>;
};

function mapExecutionRow(row: Record<string, unknown>): AutomationExecutionRow {
  const summary = (row.summary ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    workflowId: row.workflow_id ? String(row.workflow_id) : null,
    wbahJobId: row.wbah_job_id ? String(row.wbah_job_id) : null,
    workflowName: String(row.workflow_name ?? ""),
    source: String(row.source ?? "manual") as AutomationExecutionSource,
    status: String(row.status ?? "running") as ExecutionStatus,
    summary,
    lastError: row.last_error ? String(row.last_error) : null,
    startedAt: String(row.started_at ?? row.created_at ?? ""),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    nodeCount: Number(summary.nodeCount ?? 0),
    nodesSucceeded: Number(summary.nodesSucceeded ?? 0),
    nodesFailed: Number(summary.nodesFailed ?? 0),
  };
}

function mapStepRow(row: Record<string, unknown>): AutomationExecutionStepRow {
  return {
    id: String(row.id),
    sequenceNum: Number(row.sequence_num ?? 0),
    nodeId: String(row.node_id ?? ""),
    nodeType: String(row.node_type ?? ""),
    nodeName: String(row.node_name ?? ""),
    status: String(row.status ?? ""),
    branch: row.branch ? String(row.branch) : null,
    startedAt: String(row.started_at ?? ""),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    error: row.error ? String(row.error) : null,
    outputMasked: (row.output_masked ?? {}) as Record<string, unknown>,
  };
}

export async function persistWorkflowExecution(args: {
  workspaceId: string;
  result: WorkflowExecutionResult;
  source: AutomationExecutionSource;
  workflowId?: string | null;
  wbahJobId?: string | null;
  trigger?: Record<string, unknown>;
}): Promise<string> {
  const summary = {
    nodeCount: args.result.log.length,
    nodesSucceeded: args.result.log.filter((l) => l.status === "success").length,
    nodesFailed: args.result.log.filter((l) => l.status === "error").length,
    nodesWaiting: args.result.log.filter((l) => l.status === "waiting").length,
    entryNodes: args.result.log.slice(0, 1).map((l) => l.nodeId),
    waitingOn: args.result.waitingOn ?? null,
  };

  const { data: execRow, error: execErr } = await sb
    .from("automation_workflow_executions")
    .insert({
      id: args.result.executionId,
      workspace_id: args.workspaceId,
      workflow_id: args.workflowId ?? null,
      wbah_job_id: args.wbahJobId ?? null,
      workflow_name: args.result.workflowName,
      source: args.source,
      status: args.result.status,
      trigger_masked: maskRecord(args.trigger ?? {}),
      summary,
      last_error: args.result.lastError ?? null,
      started_at: args.result.startedAt,
      completed_at: args.result.completedAt ?? null,
    })
    .select("id")
    .single();

  if (execErr) {
    console.warn("[automation-engine] persist execution failed:", execErr.message);
    throw new Error(execErr.message);
  }

  const executionId = String(execRow.id);

  if (args.result.log.length > 0) {
    const steps = args.result.log.map((entry, idx) => ({
      execution_id: executionId,
      workspace_id: args.workspaceId,
      sequence_num: idx,
      node_id: entry.nodeId,
      node_type: entry.nodeType,
      node_name: entry.nodeName,
      status: entry.status,
      branch: entry.branch ?? null,
      started_at: entry.startedAt,
      completed_at: entry.finishedAt ?? null,
      output_masked: maskRecord(entry.output ?? {}),
      error: entry.error ?? null,
    }));

    const { error: stepsErr } = await sb.from("automation_execution_steps").insert(steps);
    if (stepsErr) {
      console.warn("[automation-engine] persist steps failed:", stepsErr.message);
    }
  }

  if (args.wbahJobId) {
    await sb
      .from("wbah_post_call_jobs")
      .update({ automation_execution_id: executionId })
      .eq("id", args.wbahJobId)
      .eq("workspace_id", args.workspaceId);
  }

  return executionId;
}

export async function listAutomationExecutions(
  workspaceId: string,
  opts?: { limit?: number; source?: AutomationExecutionSource; wbahJobId?: string },
): Promise<AutomationExecutionRow[]> {
  let q = sb
    .from("automation_workflow_executions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false })
    .limit(opts?.limit ?? 50);

  if (opts?.source) q = q.eq("source", opts.source);
  if (opts?.wbahJobId) q = q.eq("wbah_job_id", opts.wbahJobId);

  const { data, error } = await q;
  if (error) {
    console.warn("[automation-engine] list executions failed:", error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map(mapExecutionRow);
}

export async function getAutomationExecutionWithSteps(
  workspaceId: string,
  executionId: string,
): Promise<{ execution: AutomationExecutionRow; steps: AutomationExecutionStepRow[] } | null> {
  const { data: exec, error } = await sb
    .from("automation_workflow_executions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", executionId)
    .maybeSingle();

  if (error || !exec) return null;

  const { data: steps } = await sb
    .from("automation_execution_steps")
    .select("*")
    .eq("execution_id", executionId)
    .eq("workspace_id", workspaceId)
    .order("sequence_num", { ascending: true });

  return {
    execution: mapExecutionRow(exec as Record<string, unknown>),
    steps: ((steps ?? []) as Record<string, unknown>[]).map(mapStepRow),
  };
}

export async function getAutomationStepsForWbahJob(
  workspaceId: string,
  jobId: string,
): Promise<AutomationExecutionStepRow[]> {
  const { data: job } = await sb
    .from("wbah_post_call_jobs")
    .select("automation_execution_id")
    .eq("workspace_id", workspaceId)
    .eq("id", jobId)
    .maybeSingle();

  const executionId = job?.automation_execution_id as string | undefined;
  if (!executionId) return [];

  const detail = await getAutomationExecutionWithSteps(workspaceId, executionId);
  return detail?.steps ?? [];
}
