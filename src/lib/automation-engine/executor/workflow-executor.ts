/**
 * Workflow executor — backward-compatible wrapper over ExecutionRunner.
 */
import type { ExecuteWorkflowOptions, WorkflowExecutionResult } from "./execution.types";
import {
  runExecution,
  simulateExecution,
} from "../runtime/execution-runner";

export type { ExecuteWorkflowOptions, WorkflowExecutionResult, NodeExecutionRecord } from "./execution.types";

export async function executeWorkflow(
  rawWorkflow: unknown,
  opts: ExecuteWorkflowOptions = {},
): Promise<WorkflowExecutionResult> {
  return runExecution({
    workflow: rawWorkflow,
    mode: opts.dryRun ? "test" : "manual",
    ...opts,
  });
}

export async function simulateWorkflow(
  rawWorkflow: unknown,
  opts: ExecuteWorkflowOptions = {},
): Promise<WorkflowExecutionResult> {
  return simulateExecution(rawWorkflow, opts);
}

export function executionSummary(result: WorkflowExecutionResult): {
  nodesExecuted: number;
  nodesSucceeded: number;
  nodesFailed: number;
  nodesWaiting: number;
  durationMs: number;
} {
  const end = result.completedAt ? new Date(result.completedAt).getTime() : Date.now();
  const start = new Date(result.startedAt).getTime();
  return {
    nodesExecuted: result.log.length,
    nodesSucceeded: result.log.filter((l) => l.status === "success").length,
    nodesFailed: result.log.filter((l) => l.status === "error").length,
    nodesWaiting: result.log.filter((l) => l.status === "waiting").length,
    durationMs: Math.max(0, end - start),
  };
}
