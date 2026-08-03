/**
 * Workflow execution result types (Phase 2 — in-memory; Phase 5 persists).
 */
import type { ExecutionStatus, WaitState } from "../types/execution.schema";

export interface NodeExecutionRecord {
  nodeId: string;
  nodeType: string;
  nodeName: string;
  status: "success" | "error" | "skipped" | "waiting";
  startedAt: string;
  finishedAt?: string;
  branch?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  logs?: string[];
  durationMs?: number;
  error?: string;
}

export interface WorkflowExecutionResult {
  executionId: string;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  nodeOutputs: Record<string, Array<{ json?: Record<string, unknown> }>>;
  log: NodeExecutionRecord[];
  waitingOn?: WaitState;
  lastError?: string;
  /** Final merged output from last executed node(s). */
  output?: Record<string, unknown>;
}

export interface ExecuteWorkflowOptions {
  workspaceId?: string;
  executionId?: string;
  trigger?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  globalVariables?: Record<string, unknown>;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  /** Stop after N nodes (dry-run / simulate). */
  maxNodes?: number;
  /** If true, run in test mode (dry-run HTTP). */
  dryRun?: boolean;
  /** Execute from selected node. */
  startNodeId?: string;
  startInput?: Record<string, unknown>;
  /** Follow only one branch port from startNodeId. */
  branchOnly?: { nodeId: string; port: string };
  timeoutMs?: number;
  onEvent?: import("../runtime/execution-events").ExecutionEventHandler;
}
