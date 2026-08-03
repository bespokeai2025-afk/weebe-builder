/**
 * Partial execution helpers — start from node, follow branch only.
 */
import type { ConnectionEdge, RuntimeWorkflow } from "../types/workflow.schema";
import { getOutgoingEdges } from "../parser/build-adjacency";
import type { QueueItem } from "./execution-context";

export function buildInitialQueue(args: {
  workflow: RuntimeWorkflow;
  trigger: Record<string, unknown>;
  startNodeId?: string;
  startInput?: Record<string, unknown>;
}): QueueItem[] {
  if (args.startNodeId) {
    const node = args.workflow.nodes.get(args.startNodeId);
    if (!node) {
      throw new Error(`Start node "${args.startNodeId}" not found`);
    }
    return [
      {
        nodeId: args.startNodeId,
        json: args.startInput ?? { ...args.trigger },
      },
    ];
  }
  return args.workflow.entryNodeIds.map((nodeId) => ({
    nodeId,
    json: { ...args.trigger },
  }));
}

export function resolveNextEdges(args: {
  workflow: RuntimeWorkflow;
  nodeId: string;
  nodeType: string;
  branch?: string;
  branchOnly?: { nodeId: string; port: string };
  itemBranchPort?: string;
}): ConnectionEdge[] {
  const { workflow, nodeId, nodeType, branch, branchOnly, itemBranchPort } = args;

  if (branchOnly && branchOnly.nodeId === nodeId) {
    return getOutgoingEdges(workflow.connections, nodeId, branchOnly.port);
  }

  if (itemBranchPort) {
    return getOutgoingEdges(workflow.connections, nodeId, itemBranchPort);
  }

  if (nodeType === "core.condition") {
    const port = branch ?? "true";
    let edges = getOutgoingEdges(workflow.connections, nodeId, port);
    if (edges.length === 0 && port === "true") {
      edges = getOutgoingEdges(workflow.connections, nodeId, "main");
    }
    return edges;
  }

  const port = branch ?? "main";
  let edges = getOutgoingEdges(workflow.connections, nodeId, port);
  if (edges.length === 0 && port !== "main") {
    edges = getOutgoingEdges(workflow.connections, nodeId, "main");
  }
  return edges;
}

/** Collect all node ids reachable from start following a single branch port. */
export function collectBranchSubgraph(
  workflow: RuntimeWorkflow,
  startNodeId: string,
  port: string,
): Set<string> {
  const visited = new Set<string>();
  const stack = [startNodeId];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = workflow.nodes.get(id);
    if (!node) continue;
    const edges =
      id === startNodeId
        ? getOutgoingEdges(workflow.connections, id, port)
        : resolveNextEdges({
            workflow,
            nodeId: id,
            nodeType: node.type,
          });
    for (const e of edges) {
      if (!visited.has(e.toNode)) stack.push(e.toNode);
    }
  }
  return visited;
}
