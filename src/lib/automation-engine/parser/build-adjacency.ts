/**
 * Build adjacency indexes from workflow connections.
 */
import type { ConnectionEdge, ConnectionIndex, WorkflowConnection } from "../types/workflow.schema";

function edgeKey(nodeId: string, port: string): string {
  return `${nodeId}:${port}`;
}

export function buildAdjacency(connections: WorkflowConnection[]): ConnectionIndex {
  const outgoing = new Map<string, ConnectionEdge[]>();
  const incoming = new Map<string, ConnectionEdge[]>();

  for (const conn of connections) {
    const edge: ConnectionEdge = {
      fromNode: conn.from.node,
      fromPort: conn.from.port ?? "main",
      toNode: conn.to.node,
      toPort: conn.to.port ?? "main",
    };

    const outKey = edgeKey(edge.fromNode, edge.fromPort);
    const inKey = edgeKey(edge.toNode, edge.toPort);

    if (!outgoing.has(outKey)) outgoing.set(outKey, []);
    outgoing.get(outKey)!.push(edge);

    if (!incoming.has(inKey)) incoming.set(inKey, []);
    incoming.get(inKey)!.push(edge);
  }

  return { outgoing, incoming };
}

export function getOutgoingEdges(
  index: ConnectionIndex,
  nodeId: string,
  port = "main",
): ConnectionEdge[] {
  return index.outgoing.get(edgeKey(nodeId, port)) ?? [];
}

export function getIncomingEdges(
  index: ConnectionIndex,
  nodeId: string,
  port = "main",
): ConnectionEdge[] {
  return index.incoming.get(edgeKey(nodeId, port)) ?? [];
}
