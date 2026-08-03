/**
 * Resume paused workflow executions from snapshots.
 */
import type { ExecutionSnapshot } from "../types/execution.schema";
import type { WorkflowExecutionResult } from "../executor/execution.types";
import { runExecution, type RunExecutionRequest } from "./execution-runner";
import { loadExecutionSnapshot, saveExecutionSnapshot } from "../persistence/execution-snapshot.server";

export async function resumeExecution(args: {
  workspaceId: string;
  executionId: string;
  workflow: unknown;
  resumePayload?: Record<string, unknown>;
  mode?: RunExecutionRequest["mode"];
  onEvent?: RunExecutionRequest["onEvent"];
}): Promise<WorkflowExecutionResult> {
  const snapshot = await loadExecutionSnapshot(args.workspaceId, args.executionId);
  if (!snapshot) {
    throw new Error(`Execution snapshot not found: ${args.executionId}`);
  }
  if (snapshot.status !== "waiting") {
    throw new Error(`Execution ${args.executionId} is not waiting (status: ${snapshot.status})`);
  }

  return runExecution({
    workflow: args.workflow,
    mode: args.mode ?? "production",
    executionId: args.executionId,
    workspaceId: args.workspaceId,
    resumeSnapshot: snapshot,
    resumePayload: args.resumePayload,
    onEvent: args.onEvent,
    onWaiting: async ({ ctx, snapshot: snap }) => {
      await saveExecutionSnapshot(args.workspaceId, snap);
    },
  });
}

export async function resumeExecutionByWebhookToken(args: {
  token: string;
  payload: Record<string, unknown>;
}): Promise<{ executionId: string; result: WorkflowExecutionResult } | null> {
  const { findExecutionByWaitToken } = await import("../persistence/execution-snapshot.server");
  const { loadWorkflowDocumentForExecution } = await import("../queue/execution-queue.server");
  const match = await findExecutionByWaitToken(args.token);
  if (!match) return null;

  const workflow = await loadWorkflowDocumentForExecution(match.executionId);
  if (!workflow) return null;

  const result = await resumeExecution({
    workspaceId: match.workspaceId,
    executionId: match.executionId,
    workflow,
    resumePayload: args.payload,
    mode: "production",
  });

  return { executionId: match.executionId, result };
}

export function isDelayDue(waitingOn: ExecutionSnapshot["waitingOn"]): boolean {
  if (!waitingOn || waitingOn.type !== "delay") return false;
  if (!waitingOn.until) return true;
  return new Date(waitingOn.until).getTime() <= Date.now();
}
