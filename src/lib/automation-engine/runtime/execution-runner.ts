/**
 * Main execution runner — node-by-node with modes, partial runs, events, timeout.
 */
import { parseWorkflowDocument } from "../parser/parse-workflow";
import { ensureAutomationEngineBootstrapped } from "../bootstrap";
import { buildNodeInput, runNode } from "./node-runtime";
import { ExecutionContext } from "./execution-context";
import { resolveExecutionModeFlags, type ExecutionMode } from "./execution-modes";
import { emitExecutionEvent } from "./execution-events";
import { buildInitialQueue, resolveNextEdges } from "./subgraph";
import {
  flushMergeOutputs,
  isMergeNode,
  mergeInputsReady,
  recordMergeInput,
} from "./merge-runtime";
import type { WorkflowExecutionResult, NodeExecutionRecord } from "../executor/execution.types";
import type { ExecutionSnapshot, WaitState } from "../types/execution.schema";
import type { ExecutionEventHandler } from "./execution-events";

export type RunExecutionRequest = {
  workflow: unknown;
  mode?: ExecutionMode;
  executionId?: string;
  workspaceId?: string;
  trigger?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  globalVariables?: Record<string, unknown>;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  /** Execute from selected node (canvas "Execute step"). */
  startNodeId?: string;
  startInput?: Record<string, unknown>;
  /** After startNodeId, only follow this branch port. */
  branchOnly?: { nodeId: string; port: string };
  /** Resume from saved snapshot. */
  resumeSnapshot?: ExecutionSnapshot;
  /** Resume payload merged into waiting node input (webhook resume). */
  resumePayload?: Record<string, unknown>;
  maxNodes?: number;
  timeoutMs?: number;
  dryRun?: boolean;
  onEvent?: ExecutionEventHandler;
  /** Incremental step persistence callback. */
  onStep?: (args: {
    ctx: ExecutionContext;
    entry: NodeExecutionRecord;
    input?: Record<string, unknown>;
    logs?: string[];
    durationMs?: number;
  }) => Promise<void>;
  onWaiting?: (args: { ctx: ExecutionContext; snapshot: ExecutionSnapshot }) => Promise<void>;
};

function isTerminalNode(type: string): boolean {
  return type === "core.end" || type.endsWith(".end");
}

async function routeFromNode(
  ctx: ExecutionContext,
  workflow: import("../types/workflow.schema").RuntimeWorkflow,
  fromNodeId: string,
  nodeType: string,
  outJson: Record<string, unknown>,
  branch: string | undefined,
  req: RunExecutionRequest,
  itemBranchPort?: string,
): Promise<void> {
  const edges = resolveNextEdges({
    workflow,
    nodeId: fromNodeId,
    nodeType,
    branch,
    branchOnly: req.branchOnly,
    itemBranchPort,
  });

  for (const edge of edges) {
    await enqueueTarget(ctx, workflow, edge.toNode, outJson, fromNodeId, req, itemBranchPort);
  }
}

async function flushMergeNode(
  ctx: ExecutionContext,
  workflow: import("../types/workflow.schema").RuntimeWorkflow,
  mergeNodeId: string,
  req: RunExecutionRequest,
): Promise<void> {
  const node = workflow.nodes.get(mergeNodeId);
  if (!node) return;

  const combined = flushMergeOutputs(workflow, mergeNodeId, ctx.mergeBuffer);
  ctx.mergeBuffer.delete(mergeNodeId);
  ctx.executed.add(mergeNodeId);

  const nodeStartedIso = new Date().toISOString();
  for (const outJson of combined) {
    ctx.nodeOutputs[mergeNodeId] = [{ json: outJson }];
    ctx.lastOutput = outJson;

    const entry: NodeExecutionRecord = {
      nodeId: node.id,
      nodeType: node.type,
      nodeName: node.name,
      status: "success",
      startedAt: nodeStartedIso,
      finishedAt: new Date().toISOString(),
      output: outJson,
    };
    ctx.pushLog(entry);
    ctx.nodesRun++;
    await req.onStep?.({ ctx, entry, input: outJson, durationMs: 0 });

    await routeFromNode(ctx, workflow, mergeNodeId, node.type, outJson, undefined, req);
  }
}

async function enqueueTarget(
  ctx: ExecutionContext,
  workflow: import("../types/workflow.schema").RuntimeWorkflow,
  targetNodeId: string,
  json: Record<string, unknown>,
  fromNodeId: string,
  req: RunExecutionRequest,
  itemBranchPort?: string,
): Promise<void> {
  if (isMergeNode(workflow, targetNodeId)) {
    recordMergeInput(ctx.mergeBuffer, targetNodeId, fromNodeId, json);
    if (mergeInputsReady(workflow, targetNodeId, ctx.mergeBuffer)) {
      await flushMergeNode(ctx, workflow, targetNodeId, req);
    }
    return;
  }

  ctx.queue.push({
    nodeId: targetNodeId,
    json: { ...json },
    branchPort:
      req.branchOnly?.nodeId === fromNodeId
        ? req.branchOnly.port
        : itemBranchPort,
  });
}

function failedResult(
  executionId: string,
  message: string,
  startedAt: string,
): WorkflowExecutionResult {
  return {
    executionId,
    workflowId: "unknown",
    workflowName: "Invalid workflow",
    status: "failed",
    startedAt,
    completedAt: new Date().toISOString(),
    nodeOutputs: {},
    log: [],
    lastError: message,
  };
}

function toWorkflowResult(ctx: ExecutionContext): WorkflowExecutionResult {
  return {
    executionId: ctx.executionId,
    workflowId: ctx.workflow.id,
    workflowName: ctx.workflow.name,
    status: ctx.status,
    startedAt: ctx.startedAt,
    completedAt: ctx.completedAt,
    nodeOutputs: ctx.nodeOutputs,
    log: ctx.log,
    waitingOn: ctx.waitingOn,
    lastError: ctx.lastError,
    output: ctx.lastOutput,
  };
}

export async function runExecution(req: RunExecutionRequest): Promise<WorkflowExecutionResult> {
  ensureAutomationEngineBootstrapped();

  const mode = req.mode ?? (req.dryRun ? "test" : "manual");
  const flags = resolveExecutionModeFlags(mode);
  const startedAt = new Date().toISOString();
  const executionId = req.executionId ?? req.resumeSnapshot?.executionId ?? crypto.randomUUID();

  const emit = (partial: Parameters<typeof emitExecutionEvent>[0]) => {
    const event = { ...partial, executionId, timestamp: partial.timestamp ?? new Date().toISOString() };
    emitExecutionEvent(event);
    req.onEvent?.(event as any);
  };

  const parsed = parseWorkflowDocument(req.workflow);
  if (!parsed.ok) {
    return failedResult(executionId, parsed.errors.join("; "), startedAt);
  }

  const workflow = parsed.workflow;
  let ctx: ExecutionContext;

  if (req.resumeSnapshot) {
    const snap = req.resumeSnapshot;
    const queue: import("./execution-context").QueueItem[] = snap.currentNodeIds.map((nodeId) => ({
      nodeId,
      json: req.resumePayload ?? (snap.nodeOutputs[nodeId]?.[0] as { json?: Record<string, unknown> })?.json ?? {},
    }));
    ctx = new ExecutionContext({
      executionId,
      workflow,
      mode,
      trigger: req.trigger ?? {},
      variables: snap.variables,
      globalVariables: snap.globalVariables,
      env: req.env,
      secrets: req.secrets,
      initialQueue: queue,
      restoredOutputs: snap.nodeOutputs as Record<string, Array<{ json?: Record<string, unknown> }>>,
      restoredExecuted: Object.keys(snap.nodeOutputs),
      sequenceOffset: 0,
    });
    ctx.status = "running";
    ctx.waitingOn = undefined;
  } else {
    ctx = new ExecutionContext({
      executionId,
      workflow,
      mode,
      trigger: req.trigger ?? {},
      variables: req.variables,
      globalVariables: req.globalVariables,
      env: req.env,
      secrets: req.secrets,
      initialQueue: buildInitialQueue({
        workflow,
        trigger: req.trigger ?? {},
        startNodeId: req.startNodeId,
        startInput: req.startInput,
      }),
    });
  }

  const deadline =
    req.timeoutMs ?? workflow.settings.timeoutMs
      ? Date.now() + (req.timeoutMs ?? workflow.settings.timeoutMs ?? 0)
      : null;

  emit({
    type: "execution.started",
    executionId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    mode,
  });

  while (ctx.queue.length > 0) {
    if (deadline && Date.now() > deadline) {
      ctx.markFailed("Workflow timeout exceeded");
      emit({ type: "execution.failed", executionId, error: ctx.lastError });
      break;
    }

    if (req.maxNodes != null && ctx.nodesRun >= req.maxNodes) {
      ctx.markCompleted("completed");
      break;
    }

    const item = ctx.queue.shift()!;
    const node = workflow.nodes.get(item.nodeId);
    if (!node) continue;

    if (node.disabled) {
      const edges = resolveNextEdges({
        workflow,
        nodeId: item.nodeId,
        nodeType: node.type,
        branchOnly: req.branchOnly,
        itemBranchPort: item.branchPort,
      });
      for (const edge of edges) {
        ctx.queue.push({ nodeId: edge.toNode, json: item.json, branchPort: item.branchPort });
      }
      const skipped: NodeExecutionRecord = {
        nodeId: node.id,
        nodeType: node.type,
        nodeName: node.name,
        status: "skipped",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
      ctx.pushLog(skipped);
      emit({ type: "node.skipped", executionId, nodeId: node.id, nodeName: node.name });
      await req.onStep?.({ ctx, entry: skipped, input: item.json, durationMs: 0 });
      continue;
    }

    if (ctx.executed.has(item.nodeId) && node.type !== "core.merge") {
      continue;
    }

    const nodeStarted = Date.now();
    const nodeStartedIso = new Date(nodeStarted).toISOString();
    const inputJson = item.json;
    const nodeLogs: string[] = [];

    emit({
      type: "node.started",
      executionId,
      nodeId: node.id,
      nodeType: node.type,
      nodeName: node.name,
    });

    const execNode =
      flags.dryRunHttp || flags.skipSideEffects
        ? { ...node, config: { ...node.config, _dryRun: true } }
        : node;

    const result = await runNode({
      workflow,
      executionId,
      node: execNode,
      input: buildNodeInput(inputJson, ctx.trigger),
      nodeOutputs: ctx.nodeOutputs,
      trigger: ctx.trigger,
      env: ctx.env,
      secrets: ctx.secrets,
    });

    ctx.nodesRun++;
    ctx.executed.add(item.nodeId);
    const durationMs = Date.now() - nodeStarted;
    const finishedAt = new Date().toISOString();

    if (result.status === "waiting") {
      const entry: NodeExecutionRecord = {
        nodeId: node.id,
        nodeType: node.type,
        nodeName: node.name,
        status: "waiting",
        startedAt: nodeStartedIso,
        finishedAt,
        output: result.output?.json,
      };
      ctx.pushLog(entry);
      if (result.output?.json) {
        ctx.nodeOutputs[node.id] = [{ json: result.output.json }];
        ctx.lastOutput = result.output.json;
      }
      const wait: WaitState = result.resume!;
      ctx.markWaiting(wait);
      emit({ type: "node.finished", executionId, nodeId: node.id, status: "waiting", durationMs });
      emit({ type: "execution.waiting", executionId, waitingOn: wait });
      await req.onStep?.({ ctx, entry, input: inputJson, logs: nodeLogs, durationMs });
      if (req.workspaceId && req.onWaiting) {
        await req.onWaiting({ ctx, snapshot: ctx.toSnapshot(req.workspaceId) });
      }
      break;
    }

    if (result.status === "error") {
      const errMsg = result.error?.message ?? "Node failed";
      const entry: NodeExecutionRecord = {
        nodeId: node.id,
        nodeType: node.type,
        nodeName: node.name,
        status: "error",
        startedAt: nodeStartedIso,
        finishedAt,
        error: errMsg,
      };
      ctx.pushLog(entry);
      ctx.lastError = errMsg;
      emit({ type: "node.finished", executionId, nodeId: node.id, status: "error", error: errMsg, durationMs });
      await req.onStep?.({ ctx, entry, input: inputJson, logs: nodeLogs, durationMs });

      const policy = node.onError ?? workflow.settings.errorPolicy ?? "stop";
      if (policy === "continue") continue;
      ctx.markFailed(errMsg);
      emit({ type: "execution.failed", executionId, error: errMsg });
      break;
    }

    const outJson = result.output?.json ?? inputJson;
    ctx.nodeOutputs[node.id] = [{ json: outJson }];
    ctx.lastOutput = outJson;

    const entry: NodeExecutionRecord = {
      nodeId: node.id,
      nodeType: node.type,
      nodeName: node.name,
      status: "success",
      startedAt: nodeStartedIso,
      finishedAt,
      branch: result.branch,
      output: outJson,
    };
    ctx.pushLog(entry);
    emit({
      type: "node.finished",
      executionId,
      nodeId: node.id,
      status: "success",
      branch: result.branch,
      durationMs,
    });
    await req.onStep?.({ ctx, entry, input: inputJson, logs: nodeLogs, durationMs });

    if (isTerminalNode(node.type)) continue;

    const edges = resolveNextEdges({
      workflow,
      nodeId: item.nodeId,
      nodeType: node.type,
      branch: result.branch,
      branchOnly: req.branchOnly,
      itemBranchPort: item.branchPort,
    });

    for (const edge of edges) {
      await enqueueTarget(ctx, workflow, edge.toNode, outJson, item.nodeId, req, item.branchPort);
    }
  }

  if (ctx.status === "running") {
    ctx.markCompleted(ctx.lastError ? "failed" : "completed");
  }

  if (ctx.status === "completed") {
    emit({ type: "execution.completed", executionId, status: "completed" });
  } else if (ctx.status === "failed") {
    emit({ type: "execution.failed", executionId, error: ctx.lastError });
  }

  return toWorkflowResult(ctx);
}

/** Backward-compatible alias. */
export async function executeWorkflowDocument(
  rawWorkflow: unknown,
  opts: Omit<RunExecutionRequest, "workflow"> = {},
): Promise<WorkflowExecutionResult> {
  return runExecution({ workflow: rawWorkflow, ...opts });
}

export async function simulateExecution(
  rawWorkflow: unknown,
  opts: Omit<RunExecutionRequest, "workflow" | "mode"> = {},
): Promise<WorkflowExecutionResult> {
  return runExecution({
    workflow: rawWorkflow,
    mode: "test",
    maxNodes: opts.maxNodes ?? 50,
    ...opts,
  });
}
