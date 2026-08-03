/**
 * Run automation workflow and persist execution + node steps (incremental).
 */
import type { ExecuteWorkflowOptions, WorkflowExecutionResult } from "../executor/execution.types";
import { runExecution } from "../runtime/execution-runner";
import { executionSummary } from "../executor/workflow-executor";
import {
  createExecutionRun,
  createStepWriterHooks,
  finalizeExecutionRun,
} from "../persistence/step-writer.server";
import type { AutomationExecutionSource } from "../persistence/execution-persistence.server";
import type { ExecutionMode } from "../runtime/execution-modes";

export async function executeWorkflowWithPersistence(
  rawWorkflow: unknown,
  args: {
    workspaceId: string;
    source: AutomationExecutionSource;
    workflowId?: string | null;
    wbahJobId?: string | null;
    dryRun?: boolean;
    mode?: ExecutionMode;
    async?: boolean;
  } & ExecuteWorkflowOptions,
): Promise<WorkflowExecutionResult & { persisted: boolean; persistenceError?: string; queued?: boolean }> {
  const {
    workspaceId,
    source,
    workflowId,
    wbahJobId,
    dryRun,
    mode: modeArg,
    async: runAsync,
    ...opts
  } = args;

  const mode = modeArg ?? (dryRun ? "test" : source === "queue" ? "production" : "manual");
  const executionId = opts.executionId ?? crypto.randomUUID();

  if (runAsync && mode === "production") {
    try {
      const { enqueueExecution } = await import("../queue/execution-queue.server");
      const doc = rawWorkflow as Record<string, unknown>;
      await enqueueExecution({
        workspaceId,
        workflow: doc,
        trigger: opts.trigger,
        mode,
        executionId,
        workflowId,
        workflowName: String(doc.name ?? "Workflow"),
      });
      return {
        executionId,
        workflowId: workflowId ?? "queued",
        workflowName: String(doc.name ?? "Workflow"),
        status: "queued",
        startedAt: new Date().toISOString(),
        nodeOutputs: {},
        log: [],
        persisted: true,
        queued: true,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        executionId,
        workflowId: "unknown",
        workflowName: "Workflow",
        status: "failed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        nodeOutputs: {},
        log: [],
        lastError: msg,
        persisted: false,
        persistenceError: msg,
      };
    }
  }

  const parsed = typeof rawWorkflow === "object" && rawWorkflow && "name" in (rawWorkflow as object)
    ? (rawWorkflow as { name?: string })
    : { name: "Workflow" };

  try {
    await createExecutionRun({
      workspaceId,
      executionId,
      workflowId,
      workflowName: String(parsed.name ?? "Workflow"),
      mode,
      trigger: opts.trigger,
      wbahJobId,
    });
  } catch {
    /* row may exist on resume */
  }

  const hooks = createStepWriterHooks({ workspaceId, executionId });

  const result = await runExecution({
    workflow: rawWorkflow,
    ...opts,
    executionId,
    workspaceId,
    mode,
    onStep: hooks.onStep,
    onWaiting: hooks.onWaiting,
  });

  try {
    const summary = executionSummary(result);
    await finalizeExecutionRun({
      workspaceId,
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
    });
    return { ...result, persisted: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...result, persisted: false, persistenceError: msg };
  }
}
