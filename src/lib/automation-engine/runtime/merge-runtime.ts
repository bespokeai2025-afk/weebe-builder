/**
 * n8n-style merge — wait for all incoming branches, then combine outputs.
 */
import type { RuntimeWorkflow } from "../types/workflow.schema";
import { getIncomingEdges } from "../parser/build-adjacency";

export type MergeInputBuffer = Map<string, Map<string, Record<string, unknown>>>;

export function createMergeBuffer(): MergeInputBuffer {
  return new Map();
}

export function isMergeNode(workflow: RuntimeWorkflow, nodeId: string): boolean {
  return workflow.nodes.get(nodeId)?.type === "core.merge";
}

export function requiredMergeInputCount(workflow: RuntimeWorkflow, mergeNodeId: string): number {
  return getIncomingEdges(workflow.connections, mergeNodeId, "main").length;
}

export function recordMergeInput(
  buffer: MergeInputBuffer,
  mergeNodeId: string,
  fromNodeId: string,
  json: Record<string, unknown>,
): void {
  if (!buffer.has(mergeNodeId)) buffer.set(mergeNodeId, new Map());
  buffer.get(mergeNodeId)!.set(fromNodeId, json);
}

export function mergeInputsReady(
  workflow: RuntimeWorkflow,
  mergeNodeId: string,
  buffer: MergeInputBuffer,
): boolean {
  const incoming = getIncomingEdges(workflow.connections, mergeNodeId, "main");
  if (!incoming.length) return false;
  const received = buffer.get(mergeNodeId);
  if (!received) return false;
  return incoming.every((edge) => received.has(edge.fromNode));
}

function cartesianMerge(arrays: Record<string, unknown>[][]): Record<string, unknown>[] {
  return arrays.reduce<Record<string, unknown>[]>(
    (acc, curr) => {
      if (!acc.length) return curr.map((j) => ({ ...j }));
      const out: Record<string, unknown>[] = [];
      for (const a of acc) {
        for (const b of curr) out.push({ ...a, ...b });
      }
      return out;
    },
    [],
  );
}

function zipMerge(arrays: Record<string, unknown>[][]): Record<string, unknown>[] {
  const maxLen = Math.max(...arrays.map((a) => a.length), 0);
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < maxLen; i++) {
    let merged: Record<string, unknown> = {};
    for (const arr of arrays) {
      if (arr[i]) merged = { ...merged, ...arr[i] };
    }
    if (Object.keys(merged).length) out.push(merged);
  }
  return out;
}

/** Combine buffered inputs per n8n merge mode. */
export function combineMergeOutputs(
  config: Record<string, unknown>,
  inputGroups: Record<string, unknown>[][],
): Record<string, unknown>[] {
  if (!inputGroups.length) return [{}];
  const mode = String(config.mergeMode ?? "Combine").toLowerCase();
  const combineBy = String(config.combineBy ?? "all").toLowerCase();

  if (mode === "append") {
    return inputGroups.flat().map((json) => ({ ...json }));
  }

  if (combineBy === "position" || combineBy === "combinebyposition") {
    const zipped = zipMerge(inputGroups);
    return zipped.length ? zipped : [{}];
  }

  const merged = cartesianMerge(inputGroups);
  return merged.length ? merged : [{}];
}

/** Build input groups ordered by incoming edge declaration. */
export function gatherMergeInputGroups(
  workflow: RuntimeWorkflow,
  mergeNodeId: string,
  buffer: MergeInputBuffer,
): Record<string, unknown>[][] {
  const incoming = getIncomingEdges(workflow.connections, mergeNodeId, "main");
  const received = buffer.get(mergeNodeId)!;
  return incoming.map((edge) => {
    const json = received.get(edge.fromNode) ?? {};
    return [{ ...json }];
  });
}

export function flushMergeOutputs(
  workflow: RuntimeWorkflow,
  mergeNodeId: string,
  buffer: MergeInputBuffer,
): Record<string, unknown>[] {
  const node = workflow.nodes.get(mergeNodeId);
  const groups = gatherMergeInputGroups(workflow, mergeNodeId, buffer);
  return combineMergeOutputs(node?.config ?? {}, groups);
}
