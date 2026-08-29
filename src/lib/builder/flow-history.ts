import type {
  BuilderSettings,
  BuilderVariable,
  FlowNode,
  FlowVersionSnapshot,
  PublishedSnapshot,
} from "./types";
import type { Edge } from "@xyflow/react";

const HISTORY_CAP = 15;

export function graphFingerprint(
  nodes: FlowNode[],
  edges: Edge[],
  variables: BuilderVariable[],
): string {
  return JSON.stringify({
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, data: n.data, position: n.position })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle })),
    variables,
  });
}

export function nextVersionNumber(history: FlowVersionSnapshot[] | undefined): number {
  const max = (history ?? []).reduce((m, v) => Math.max(m, v.version), 0);
  return max + 1;
}

export function appendFlowVersion(
  settings: BuilderSettings,
  snapshot: Omit<FlowVersionSnapshot, "version" | "createdAt"> & { version?: number },
): FlowVersionSnapshot[] {
  const version = snapshot.version ?? nextVersionNumber(settings.flowHistory);
  const entry: FlowVersionSnapshot = {
    version,
    label: snapshot.label,
    createdAt: new Date().toISOString(),
    flowData: snapshot.flowData,
    variables: snapshot.variables,
  };
  const prev = settings.flowHistory ?? [];
  const last = prev[prev.length - 1];
  if (
    last &&
    graphFingerprint(last.flowData.nodes, last.flowData.edges, last.variables) ===
      graphFingerprint(entry.flowData.nodes, entry.flowData.edges, entry.variables)
  ) {
    return prev;
  }
  return [...prev, entry].slice(-HISTORY_CAP);
}

export function makePublishedSnapshot(
  version: number,
  nodes: FlowNode[],
  edges: Edge[],
  variables: BuilderVariable[],
): PublishedSnapshot {
  return {
    version,
    publishedAt: new Date().toISOString(),
    flowData: structuredClone({ nodes, edges }),
    variables: structuredClone(variables),
  };
}
