/**
 * Automation engine — canonical workflow JSON schema.
 */
import { z } from "zod";

export const WorkflowSettingsSchema = z.object({
  errorPolicy: z.enum(["stop", "continue"]).default("stop"),
  timeoutMs: z.number().int().positive().max(3_600_000).optional(),
  maxRetries: z.number().int().min(0).max(20).default(3),
  concurrency: z.number().int().min(1).max(500).optional(),
  timezone: z.string().max(64).optional(),
});

export type WorkflowSettings = z.infer<typeof WorkflowSettingsSchema>;

export const NodeRetrySchema = z.object({
  maxAttempts: z.number().int().min(1).max(20).default(3),
  backoffMs: z.number().int().min(0).max(600_000).optional(),
});

export const NodeErrorPolicySchema = z.enum(["stop", "continue", "retry"]);

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.string().min(1).max(120),
  name: z.string().max(200).optional(),
  position: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  config: z.record(z.unknown()).default({}),
  retry: NodeRetrySchema.optional(),
  onError: NodeErrorPolicySchema.optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).optional(),
  disabled: z.boolean().optional(),
});

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const ConnectionEndpointSchema = z.object({
  node: z.string().min(1).max(120),
  port: z.string().min(1).max(60).default("main"),
});

export const WorkflowConnectionSchema = z.object({
  from: ConnectionEndpointSchema,
  to: ConnectionEndpointSchema,
});

export type WorkflowConnection = z.infer<typeof WorkflowConnectionSchema>;

export const WorkflowDocumentSchema = z.object({
  id: z.string().uuid().optional(),
  version: z.number().int().positive().default(1),
  name: z.string().min(1).max(200),
  settings: WorkflowSettingsSchema.default({}),
  nodes: z.array(WorkflowNodeSchema).min(1).max(500),
  connections: z.array(WorkflowConnectionSchema).max(2000).default([]),
  variables: z
    .object({
      defaults: z.record(z.unknown()).default({}),
    })
    .default({ defaults: {} }),
  meta: z.record(z.unknown()).optional(),
});

export type WorkflowDocument = z.infer<typeof WorkflowDocumentSchema>;

/** Parsed runtime graph — produced by parseWorkflow(). */
export interface RuntimeNode {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
  retry?: z.infer<typeof NodeRetrySchema>;
  onError?: z.infer<typeof NodeErrorPolicySchema>;
  timeoutMs?: number;
  disabled: boolean;
}

export interface ConnectionEdge {
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
}

export interface ConnectionIndex {
  /** Outgoing edges keyed by `${nodeId}:${port}`. */
  outgoing: Map<string, ConnectionEdge[]>;
  /** Incoming edges keyed by `${nodeId}:${port}`. */
  incoming: Map<string, ConnectionEdge[]>;
}

export interface RuntimeWorkflow {
  id: string;
  version: number;
  name: string;
  settings: WorkflowSettings;
  nodes: Map<string, RuntimeNode>;
  connections: ConnectionIndex;
  entryNodeIds: string[];
  variables: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface ParseWorkflowResult {
  ok: true;
  workflow: RuntimeWorkflow;
  document: WorkflowDocument;
}

export interface ParseWorkflowError {
  ok: false;
  errors: string[];
}

export type ParseWorkflowOutcome = ParseWorkflowResult | ParseWorkflowError;
