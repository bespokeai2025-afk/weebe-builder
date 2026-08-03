/**
 * Parse and validate workflow JSON → runtime graph.
 */
import {
  WorkflowDocumentSchema,
  type ParseWorkflowOutcome,
  type RuntimeNode,
  type RuntimeWorkflow,
  type WorkflowDocument,
} from "../types/workflow.schema";
import { formatZodWorkflowErrors, WorkflowParseError } from "../errors/workflow-parse-error";
import { buildAdjacency, getOutgoingEdges } from "./build-adjacency";
import { findEndNodes, findEntryNodes } from "./find-entry-nodes";
import { getNodeDefinition, hasNodeType, validateNodeConfig } from "../registry/node-registry";
import { ensureAutomationEngineBootstrapped } from "../bootstrap";

function ensureRegistry(): void {
  ensureAutomationEngineBootstrapped();
}

function validateGraphStructure(workflow: RuntimeWorkflow): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(workflow.nodes.keys());

  for (const conn of workflow.connections.outgoing.values()) {
    for (const edge of conn) {
      if (!nodeIds.has(edge.fromNode)) {
        errors.push(`Connection references unknown source node "${edge.fromNode}"`);
      }
      if (!nodeIds.has(edge.toNode)) {
        errors.push(`Connection references unknown target node "${edge.toNode}"`);
      }
    }
  }

  if (workflow.entryNodeIds.length === 0) {
    errors.push("Workflow has no entry node (core.start or core.webhook)");
  }

  const endIds = findEndNodes(workflow.nodes);
  if (endIds.length === 0) {
    errors.push("Workflow has no end node (core.end) — add at least one End node");
  }

  const visited = new Set<string>();
  const stack = [...workflow.entryNodeIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const port of ["main", "true", "false", "loop", "done"]) {
      for (const edge of getOutgoingEdges(workflow.connections, id, port)) {
        stack.push(edge.toNode);
      }
    }
  }

  for (const [id, node] of workflow.nodes) {
    if (node.disabled) continue;
    if (!visited.has(id) && !workflow.entryNodeIds.includes(id)) {
      errors.push(`Node "${id}" (${node.name}) is unreachable from entry nodes`);
    }
  }

  return errors;
}

function documentToRuntime(doc: WorkflowDocument): RuntimeWorkflow {
  const nodes = new Map<string, RuntimeNode>();
  for (const n of doc.nodes) {
    nodes.set(n.id, {
      id: n.id,
      type: n.type,
      name: n.name ?? n.id,
      config: n.config ?? {},
      position: n.position,
      retry: n.retry,
      onError: n.onError,
      timeoutMs: n.timeoutMs,
      disabled: n.disabled ?? false,
    });
  }

  const connections = buildAdjacency(doc.connections);
  const runtime: RuntimeWorkflow = {
    id: doc.id ?? crypto.randomUUID(),
    version: doc.version,
    name: doc.name,
    settings: doc.settings,
    nodes,
    connections,
    entryNodeIds: [],
    variables: doc.variables?.defaults ?? {},
    meta: doc.meta,
  };

  runtime.entryNodeIds = findEntryNodes(nodes);
  return runtime;
}

export function parseWorkflowDocument(raw: unknown): ParseWorkflowOutcome {
  ensureRegistry();

  const parsed = WorkflowDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: formatZodWorkflowErrors(parsed.error.issues),
    };
  }

  const doc = parsed.data;
  const errors: string[] = [];

  const seenIds = new Set<string>();
  for (const node of doc.nodes) {
    if (seenIds.has(node.id)) {
      errors.push(`Duplicate node id "${node.id}"`);
    }
    seenIds.add(node.id);

    if (!hasNodeType(node.type)) {
      errors.push(`Node "${node.id}": unknown type "${node.type}" (not registered)`);
      continue;
    }

    const configErr = validateNodeConfig(node.type, node.config ?? {});
    if (configErr) errors.push(`Node "${node.id}": ${configErr}`);

    const nodeDef = getNodeDefinition(node.type);
    if (nodeDef?.validate) {
      try {
        nodeDef.validate(node.config ?? {});
      } catch (e) {
        errors.push(`Node "${node.id}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  const workflow = documentToRuntime(doc);
  errors.push(...validateGraphStructure(workflow));

  if (errors.length) return { ok: false, errors };

  return { ok: true, workflow, document: doc };
}

/** Throws WorkflowParseError on failure. */
export function parseWorkflowOrThrow(raw: unknown): RuntimeWorkflow {
  const result = parseWorkflowDocument(raw);
  if (!result.ok) throw new WorkflowParseError(result.errors);
  return result.workflow;
}

export function validateWorkflowDocument(raw: unknown): { valid: boolean; errors: string[] } {
  const result = parseWorkflowDocument(raw);
  if (result.ok) return { valid: true, errors: [] };
  return { valid: false, errors: result.errors };
}
