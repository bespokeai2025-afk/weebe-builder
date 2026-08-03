/**
 * Automation engine — node contracts (engine ↔ plugins).
 */

export type NodeCategory = "trigger" | "action" | "logic" | "flow";

export type NodeErrorPolicy = "stop" | "continue" | "retry";

export type NodePortName = "main" | "true" | "false" | string;

export interface NodeRetryConfig {
  maxAttempts: number;
  backoffMs?: number;
}

export interface PortDefinition {
  name: NodePortName;
  type?: "main" | "branch";
  required?: boolean;
}

export interface PropertySchema {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "expression";
  required?: boolean;
  description?: string;
}

/** Runtime input to a node — merged upstream outputs. */
export interface NodeInput {
  /** Primary JSON payload (n8n-style item). */
  json: Record<string, unknown>;
  /** Named inputs for merge nodes. */
  inputs?: Record<string, unknown>;
  /** Trigger / webhook payload at run start. */
  trigger?: Record<string, unknown>;
}

/** Result returned by every node implementation. */
export interface NodeResult {
  status: "success" | "error" | "waiting";
  output?: {
    json: Record<string, unknown>;
    binary?: Record<string, unknown>;
  };
  error?: {
    message: string;
    code?: string;
    retryable?: boolean;
  };
  /** Logic nodes set branch port name. */
  branch?: NodePortName;
  /** Wait nodes persist resume metadata. */
  resume?: {
    type: "delay" | "webhook" | "event";
    token: string;
    until?: string;
    metadata?: Record<string, unknown>;
  };
}

/** Full context passed to node.execute — populated by Node Runtime (Phase 4). */
export interface NodeContext {
  workflowId: string;
  executionId: string;
  nodeId: string;
  nodeType: string;
  config: Record<string, unknown>;
  input: NodeInput;
  variables: Record<string, unknown>;
  globalVariables: Record<string, unknown>;
  nodeOutputs: Record<string, unknown[]>;
  /** Lowercase label → node id for $('Node Name') expressions. */
  nodeIdByLabel?: Record<string, string>;
  env: Record<string, string>;
  /** Resolved secrets — never log. */
  secrets: Record<string, string>;
}

export interface NodeDefinition {
  type: string;
  version: number;
  displayName: string;
  category: NodeCategory;
  description?: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  properties?: PropertySchema[];
  validate?: (config: Record<string, unknown>) => void;
  execute: (ctx: NodeContext) => Promise<NodeResult>;
}

export interface NodeRegistrySnapshot {
  types: string[];
  count: number;
}
