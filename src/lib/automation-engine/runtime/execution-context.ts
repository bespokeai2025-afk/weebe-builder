/**
 * Mutable execution state — queue, outputs, variables, timing.
 */
import type { MergeInputBuffer } from "./merge-runtime";
import { createMergeBuffer } from "./merge-runtime";
import type { RuntimeWorkflow } from "../types/workflow.schema";
import type { ExecutionStatus, WaitState } from "../types/execution.schema";
import type { NodeExecutionRecord } from "../executor/execution.types";
import type { ExecutionMode } from "./execution-modes";

export type QueueItem = {
  nodeId: string;
  json: Record<string, unknown>;
  /** When set, only follow edges on this port from this node. */
  branchPort?: string;
};

export class ExecutionContext {
  readonly executionId: string;
  readonly workflow: RuntimeWorkflow;
  readonly mode: ExecutionMode;
  readonly startedAt: string;
  readonly trigger: Record<string, unknown>;
  readonly variables: Record<string, unknown>;
  readonly globalVariables: Record<string, unknown>;
  readonly env: Record<string, string>;
  readonly secrets: Record<string, string>;

  status: ExecutionStatus = "running";
  queue: QueueItem[] = [];
  nodeOutputs: Record<string, Array<{ json?: Record<string, unknown> }>> = {};
  executed = new Set<string>();
  log: NodeExecutionRecord[] = [];
  waitingOn?: WaitState;
  lastError?: string;
  lastOutput?: Record<string, unknown>;
  nodesRun = 0;
  sequenceNum = 0;
  completedAt?: string;
  /** Pending inputs for core.merge nodes (n8n multi-input wait). */
  mergeBuffer: MergeInputBuffer = createMergeBuffer();

  constructor(args: {
    executionId: string;
    workflow: RuntimeWorkflow;
    mode: ExecutionMode;
    trigger?: Record<string, unknown>;
    variables?: Record<string, unknown>;
    globalVariables?: Record<string, unknown>;
    env?: Record<string, string>;
    secrets?: Record<string, string>;
    initialQueue?: QueueItem[];
    restoredOutputs?: Record<string, Array<{ json?: Record<string, unknown> }>>;
    restoredExecuted?: string[];
    restoredLog?: NodeExecutionRecord[];
    sequenceOffset?: number;
  }) {
    this.executionId = args.executionId;
    this.workflow = args.workflow;
    this.mode = args.mode;
    this.startedAt = new Date().toISOString();
    this.trigger = args.trigger ?? {};
    this.variables = args.variables ?? { ...args.workflow.variables };
    this.globalVariables = args.globalVariables ?? {};
    this.env = args.env ?? {};
    this.secrets = args.secrets ?? {};
    this.queue = args.initialQueue ?? [];
    if (args.restoredOutputs) this.nodeOutputs = args.restoredOutputs;
    if (args.restoredExecuted) this.executed = new Set(args.restoredExecuted);
    if (args.restoredLog) this.log = args.restoredLog;
    if (args.sequenceOffset) this.sequenceNum = args.sequenceOffset;
  }

  pushLog(entry: NodeExecutionRecord): void {
    this.log.push(entry);
    this.sequenceNum += 1;
  }

  markCompleted(status: ExecutionStatus = "completed"): void {
    this.status = status;
    this.completedAt = new Date().toISOString();
  }

  markWaiting(wait: WaitState): void {
    this.status = "waiting";
    this.waitingOn = wait;
  }

  markFailed(error: string): void {
    this.status = "failed";
    this.lastError = error;
    this.completedAt = new Date().toISOString();
  }

  toSnapshot(workspaceId: string): import("../types/execution.schema").ExecutionSnapshot {
    return {
      executionId: this.executionId,
      workflowId: this.workflow.id,
      workflowVersion: this.workflow.version,
      workspaceId,
      status: this.status,
      currentNodeIds: this.queue.map((q) => q.nodeId),
      nodeOutputs: this.nodeOutputs as Record<string, unknown[]>,
      variables: this.variables,
      globalVariables: this.globalVariables,
      waitingOn: this.waitingOn,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      completedAt: this.completedAt,
      lastError: this.lastError,
    };
  }
}
