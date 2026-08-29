import type { Edge } from "@xyflow/react";
import type { FlowNode } from "./types";

export interface GraphSlice {
  nodes: FlowNode[];
  edges: Edge[];
}

const PASTE_OFFSET = 48;

/**
 * Clone a selection with fresh ids. Transition targets and edges that stay
 * inside the selection are remapped; edges that leave the selection are dropped.
 * Clones are never marked as the flow start node.
 */
export function cloneGraphSlice(
  slice: GraphSlice,
  nextId: (prefix: string) => string,
  offset: { x: number; y: number } = { x: PASTE_OFFSET, y: PASTE_OFFSET },
): GraphSlice {
  const idMap = new Map<string, string>();
  for (const node of slice.nodes) {
    const prefix = node.data?.kind ?? node.type ?? "node";
    idMap.set(node.id, nextId(String(prefix)));
  }

  const nodes: FlowNode[] = slice.nodes.map((node) => {
    const id = idMap.get(node.id)!;
    const transitions = (node.data.transitions ?? []).map((t) => ({
      ...t,
      id: nextId("tr"),
      target: t.target && idMap.has(t.target) ? idMap.get(t.target)! : null,
    }));
    return {
      ...node,
      id,
      selected: true,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      data: {
        ...node.data,
        isStart: false,
        transitions,
      },
    };
  });

  const selected = new Set(slice.nodes.map((n) => n.id));
  const edges: Edge[] = slice.edges
    .filter((e) => selected.has(e.source) && selected.has(e.target))
    .map((e) => {
      const sourceHandle = remapHandle(e.sourceHandle, slice.nodes, idMap, nodes);
      return {
        ...e,
        id: nextId("edge"),
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
        sourceHandle,
        selected: true,
      };
    });

  return { nodes, edges };
}

function remapHandle(
  sourceHandle: string | null | undefined,
  originals: FlowNode[],
  idMap: Map<string, string>,
  clones: FlowNode[],
): string | undefined {
  if (!sourceHandle) return sourceHandle ?? undefined;
  const original = originals.find((n) => (n.data.transitions ?? []).some((t) => t.id === sourceHandle));
  if (!original) return sourceHandle;
  const idx = (original.data.transitions ?? []).findIndex((t) => t.id === sourceHandle);
  const clone = clones.find((n) => n.id === idMap.get(original.id));
  const next = clone?.data.transitions?.[idx];
  return next?.id ?? sourceHandle;
}

export function selectedGraphSlice(nodes: FlowNode[], edges: Edge[]): GraphSlice {
  const selectedNodes = nodes.filter((n) => n.selected);
  const ids = new Set(selectedNodes.map((n) => n.id));
  const selectedEdges = edges.filter(
    (e) => e.selected || (ids.has(e.source) && ids.has(e.target)),
  );
  return { nodes: selectedNodes, edges: selectedEdges };
}

export function isEditableHotkeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}
