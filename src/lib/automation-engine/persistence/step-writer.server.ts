/**
 * Incremental step persistence — write node I/O during execution (live UI + debugging).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { maskRecord } from "@/lib/systemmind/call-runtime/executions.server";
import type { NodeExecutionRecord } from "../executor/execution.types";
import type { ExecutionMode } from "../runtime/execution-modes";
import { resolveExecutionModeFlags } from "../runtime/execution-modes";

const sb = supabaseAdmin as any;

export async function createExecutionRun(args: {
  workspaceId: string;
  executionId: string;
  workflowId?: string | null;
  workflowName: string;
  mode: ExecutionMode;
  trigger?: Record<string, unknown>;
  wbahJobId?: string | null;
}): Promise<void> {
  const flags = resolveExecutionModeFlags(args.mode);
  const { error } = await sb.from("automation_workflow_executions").insert({
    id: args.executionId,
    workspace_id: args.workspaceId,
    workflow_id: args.workflowId ?? null,
    wbah_job_id: args.wbahJobId ?? null,
    workflow_name: args.workflowName,
    source: flags.source,
    mode: args.mode,
    status: "running",
    trigger_masked: maskRecord(args.trigger ?? {}),
    summary: { nodeCount: 0, nodesSucceeded: 0, nodesFailed: 0 },
    started_at: new Date().toISOString(),
  });
  if (error && !error.message.includes("duplicate")) {
    throw new Error(error.message);
  }
}

export async function appendExecutionStep(args: {
  workspaceId: string;
  executionId: string;
  sequenceNum: number;
  entry: NodeExecutionRecord;
  input?: Record<string, unknown>;
  logs?: string[];
  durationMs?: number;
}): Promise<void> {
  const { error } = await sb.from("automation_execution_steps").insert({
    execution_id: args.executionId,
    workspace_id: args.workspaceId,
    sequence_num: args.sequenceNum,
    node_id: args.entry.nodeId,
    node_type: args.entry.nodeType,
    node_name: args.entry.nodeName,
    status: args.entry.status,
    branch: args.entry.branch ?? null,
    started_at: args.entry.startedAt,
    completed_at: args.entry.finishedAt ?? null,
    input_masked: maskRecord(args.input ?? {}),
    output_masked: maskRecord(args.entry.output ?? {}),
    logs: args.logs ?? [],
    duration_ms: args.durationMs ?? null,
    error: args.entry.error ?? null,
  });
  if (error) {
    console.warn("[step-writer] append step failed:", error.message);
  }
}

export async function finalizeExecutionRun(args: {
  workspaceId: string;
  executionId: string;
  status: string;
  summary: Record<string, unknown>;
  lastError?: string | null;
  snapshot?: Record<string, unknown> | null;
}): Promise<void> {
  const { error } = await sb
    .from("automation_workflow_executions")
    .update({
      status: args.status,
      summary: args.summary,
      last_error: args.lastError ?? null,
      snapshot: args.snapshot ?? null,
      completed_at: args.status === "waiting" ? null : new Date().toISOString(),
    })
    .eq("id", args.executionId)
    .eq("workspace_id", args.workspaceId);
  if (error) console.warn("[step-writer] finalize failed:", error.message);
}

export function createStepWriterHooks(args: {
  workspaceId: string;
  executionId: string;
}) {
  return {
    onStep: async (stepArgs: {
      ctx: { sequenceNum: number };
      entry: NodeExecutionRecord;
      input?: Record<string, unknown>;
      logs?: string[];
      durationMs?: number;
    }) => {
      await appendExecutionStep({
        workspaceId: args.workspaceId,
        executionId: args.executionId,
        sequenceNum: stepArgs.ctx.sequenceNum,
        entry: stepArgs.entry,
        input: stepArgs.input,
        logs: stepArgs.logs,
        durationMs: stepArgs.durationMs,
      });
    },
    onWaiting: async (waitArgs: {
      snapshot: import("../types/execution.schema").ExecutionSnapshot;
    }) => {
      const { saveExecutionSnapshot } = await import("./execution-snapshot.server");
      await saveExecutionSnapshot(args.workspaceId, waitArgs.snapshot);
    },
  };
}
