/**
 * Automation engine — expression types (runtime resolver in Phase 3).
 */

/** Raw expression string, e.g. "={{ Start.json.phone }}". */
export type ExpressionString = string;

export interface ExpressionContext {
  /** Node outputs: nodeId → array of run outputs. */
  nodeOutputs: Record<string, Array<{ json?: Record<string, unknown> }>>;
  /** Lowercase node label/name → node id (n8n $('Node Name') lookup). */
  nodeIdByLabel?: Record<string, string>;
  /** Workflow-scoped variables. */
  variables: Record<string, unknown>;
  /** Run-scoped globals. */
  globalVariables: Record<string, unknown>;
  /** Environment (non-secret). */
  env: Record<string, unknown>;
  /** Current execution metadata. */
  execution: {
    id: string;
    workflowId: string;
  };
}

export interface ResolvedExpression {
  raw: string;
  resolved: unknown;
  isExpression: boolean;
}
