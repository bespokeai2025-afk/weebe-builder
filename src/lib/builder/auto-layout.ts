import type { Edge } from "@xyflow/react";
import type { FlowNode } from "./store";

const COL_GAP = 320; // horizontal distance between depth columns
const ROW_GAP = 160; // vertical distance between rows
const ORIGIN_X = 120;
const ORIGIN_Y = 120;

/**
 * Retell-style "main spine" left-to-right layout.
 *
 * - Every node sits in its own depth column (depth = longest forward path from a root).
 * - The first child of a node inherits its parent's row, forming a long horizontal
 *   conversation spine.
 * - Additional sibling branches drop down to the next free row, so side paths sit
 *   below the main spine instead of pushing the whole flow vertically.
 * - Loop-back/cyclic edges are ignored for positioning so layout always terminates.
 * - Note nodes are left untouched.
 */
export function autoLayoutNodes(nodes: FlowNode[], edges: Edge[]): FlowNode[] {
  if (nodes.length === 0) return nodes;

  const noteIds = new Set(nodes.filter((n) => n.data?.kind === "note").map((n) => n.id));
  const flowNodes = nodes.filter((n) => !noteIds.has(n.id));
  if (flowNodes.length === 0) return nodes;
  const flowEdges = edges.filter((e) => !noteIds.has(e.source) && !noteIds.has(e.target));

  const nodeIds = new Set(flowNodes.map((n) => n.id));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  const edgesBySource = new Map<string, Edge[]>();
  for (const n of flowNodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, 0);
    edgesBySource.set(n.id, []);
  }
  for (const e of flowEdges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    edgesBySource.get(e.source)!.push(e);
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }

  // Children ordered by the node's transition list (response paths the user sees).
  for (const n of flowNodes) {
    const used = new Set<string>();
    const sourceEdges = edgesBySource.get(n.id) ?? [];
    const ordered: string[] = [];
    for (const t of n.data.transitions ?? []) {
      const target = sourceEdges.find((e) => e.sourceHandle === t.id)?.target ?? t.target;
      if (!target || !nodeIds.has(target) || used.has(target)) continue;
      ordered.push(target);
      used.add(target);
    }
    for (const e of sourceEdges) {
      if (used.has(e.target)) continue;
      ordered.push(e.target);
      used.add(e.target);
    }
    outgoing.set(n.id, ordered);
  }

  // Roots: explicit start nodes, then no-incoming nodes, fallback to first.
  const explicitStarts = flowNodes.filter((n) => n.data?.isStart).map((n) => n.id);
  const explicitSet = new Set(explicitStarts);
  const noIncoming = flowNodes
    .filter((n) => (incoming.get(n.id) ?? 0) === 0 && !explicitSet.has(n.id))
    .map((n) => n.id);
  const roots = [...explicitStarts, ...noIncoming];
  if (roots.length === 0) roots.push(flowNodes[0].id);

  // Depth = longest forward path from any root (so merges sit to the right
  // of all their predecessors).
  const depthById = new Map<string, number>();
  const assignDepth = (id: string, depth: number, path: Set<string>) => {
    const current = depthById.get(id);
    if (current !== undefined && current >= depth) return;
    depthById.set(id, depth);
    path.add(id);
    for (const child of outgoing.get(id) ?? []) {
      if (path.has(child)) continue;
      assignDepth(child, depth + 1, path);
    }
    path.delete(id);
  };
  for (const root of roots) assignDepth(root, 0, new Set());
  for (const n of flowNodes) {
    if (!depthById.has(n.id)) assignDepth(n.id, 0, new Set());
  }

  const placed = new Set<string>();
  const rowById = new Map<string, number>();
  // Occupied (col,row) cells so a branch never lands on an existing node.
  const occupied = new Set<string>();
  const key = (c: number, r: number) => `${c}:${r}`;
  let nextFreeRow = 0;

  const claim = (id: string, row: number) => {
    const col = depthById.get(id) ?? 0;
    rowById.set(id, row);
    occupied.add(key(col, row));
    placed.add(id);
    if (row >= nextFreeRow) nextFreeRow = row + 1;
  };

  const place = (id: string, preferredRow: number) => {
    if (placed.has(id)) return;
    const col = depthById.get(id) ?? 0;
    // Try the preferred row (parent's row) first; if taken, fall back to a fresh row.
    let row = preferredRow;
    if (occupied.has(key(col, row))) row = nextFreeRow;
    claim(id, row);

    const children = (outgoing.get(id) ?? []).filter((c) => {
      const cd = depthById.get(c);
      const pd = depthById.get(id);
      return cd !== undefined && pd !== undefined && cd > pd && !placed.has(c);
    });

    children.forEach((child, idx) => {
      // First child inherits this node's row → builds the main spine.
      // Extra branches drop to a new row below everything placed so far.
      const target = idx === 0 ? row : nextFreeRow;
      place(child, target);
    });
  };

  for (const root of roots) {
    if (placed.has(root)) continue;
    place(root, nextFreeRow);
  }
  for (const n of flowNodes) {
    if (placed.has(n.id)) continue;
    place(n.id, nextFreeRow);
  }

  return nodes.map((n) => {
    if (noteIds.has(n.id)) return n;
    const col = depthById.get(n.id);
    const row = rowById.get(n.id);
    if (col === undefined || row === undefined) return n;
    const x = ORIGIN_X + col * COL_GAP;
    const y = ORIGIN_Y + row * ROW_GAP;
    if (n.position.x === x && n.position.y === y) return n;
    return { ...n, position: { x, y } };
  });
}
