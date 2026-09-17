import type { Edge } from "@xyflow/react";
import type { FlowNode } from "./store";

/** Clear space between a column's widest card and the next column. */
const COL_GUTTER = 140;
/** Clear space between a row's tallest card and the next row. */
const ROW_GUTTER = 90;
const ORIGIN_X = 160;
const ORIGIN_Y = 160;

/**
 * Card sizes to assume before React Flow has measured a node.
 *
 * Only used on the first layout of a freshly loaded flow; once a node has
 * rendered, `node.measured` is authoritative. The defaults are deliberately
 * generous — over-estimating costs a little empty canvas, under-estimating
 * puts one card on top of another.
 */
const FALLBACK_NODE_SIZE: Record<string, { width: number; height: number }> = {
  ending: { width: 224, height: 110 },
  note: { width: 224, height: 110 },
};
const DEFAULT_NODE_SIZE = { width: 480, height: 340 };

export function builderNodeSize(node: {
  data?: { kind?: string };
  measured?: { width?: number | null; height?: number | null };
  width?: number | null;
  height?: number | null;
}): { width: number; height: number } {
  const fallback = FALLBACK_NODE_SIZE[node.data?.kind ?? ""] ?? DEFAULT_NODE_SIZE;
  const w = node.measured?.width ?? node.width;
  const h = node.measured?.height ?? node.height;
  return {
    width: typeof w === "number" && w > 0 ? w : fallback.width,
    height: typeof h === "number" && h > 0 ? h : fallback.height,
  };
}

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

  // Grid cells are sized to their largest occupant rather than to one fixed
  // step. A fixed ROW_GAP was the reason cards overlapped at all: node height
  // is driven by content — transitions, prompt text, extracted variables — so
  // any card taller than the step landed on top of the row beneath it.
  const colWidth = new Map<number, number>();
  const rowHeight = new Map<number, number>();
  for (const n of flowNodes) {
    const col = depthById.get(n.id);
    const row = rowById.get(n.id);
    if (col === undefined || row === undefined) continue;
    const { width, height } = builderNodeSize(n);
    colWidth.set(col, Math.max(colWidth.get(col) ?? 0, width));
    rowHeight.set(row, Math.max(rowHeight.get(row) ?? 0, height));
  }

  const offsets = (sizes: Map<number, number>, origin: number, gutter: number) => {
    const out = new Map<number, number>();
    let cursor = origin;
    for (const index of [...sizes.keys()].sort((a, b) => a - b)) {
      out.set(index, cursor);
      cursor += sizes.get(index)! + gutter;
    }
    return out;
  };
  const colX = offsets(colWidth, ORIGIN_X, COL_GUTTER);
  const rowY = offsets(rowHeight, ORIGIN_Y, ROW_GUTTER);

  return nodes.map((n) => {
    if (noteIds.has(n.id)) return n;
    const col = depthById.get(n.id);
    const row = rowById.get(n.id);
    if (col === undefined || row === undefined) return n;
    const x = colX.get(col);
    const y = rowY.get(row);
    if (x === undefined || y === undefined) return n;
    if (n.position.x === x && n.position.y === y) return n;
    return { ...n, position: { x, y } };
  });
}

/**
 * Push specific nodes out from underneath the others until nothing overlaps.
 *
 * Deliberately not a re-layout. Only the ids in `moveIds` may move — usually
 * the one node just added or just dropped — and every other card is treated as
 * a fixed anchor, so a deliberate arrangement survives. A full autoLayoutNodes
 * pass stays available as the explicit "tidy everything" action.
 *
 * Notes are skipped: they are annotations and are often placed over the flow on
 * purpose.
 */
export function resolveNodeOverlaps(
  nodes: FlowNode[],
  opts: { moveIds: string[]; gutter?: number },
): FlowNode[] {
  const movable = new Set(opts.moveIds);
  if (movable.size === 0 || nodes.length < 2) return nodes;
  const gutter = opts.gutter ?? 40;

  type Box = { id: string; x: number; y: number; w: number; h: number };
  const boxOf = (n: FlowNode): Box => {
    const { width, height } = builderNodeSize(n);
    return { id: n.id, x: n.position.x, y: n.position.y, w: width, h: height };
  };

  const isNote = (n: FlowNode) => n.data?.kind === "note";
  const anchors: Box[] = nodes
    .filter((n) => !isNote(n) && !movable.has(n.id))
    .map(boxOf);

  const hits = (a: Box, b: Box) =>
    a.x < b.x + b.w + gutter &&
    a.x + a.w + gutter > b.x &&
    a.y < b.y + b.h + gutter &&
    a.y + a.h + gutter > b.y;

  const moved = new Map<string, { x: number; y: number }>();

  for (const node of nodes) {
    if (isNote(node) || !movable.has(node.id)) continue;
    const box = boxOf(node);

    // Slide straight down past whatever it is sitting on. Vertical-only keeps
    // the node in the column the user dropped it in, which reads as a nudge
    // rather than the canvas rearranging itself.
    let guard = 0;
    for (;;) {
      const clash = anchors.find((a) => hits(box, a));
      if (!clash || guard++ > nodes.length + 8) break;
      box.y = clash.y + clash.h + gutter;
    }

    if (box.y !== node.position.y || box.x !== node.position.x) {
      moved.set(node.id, { x: box.x, y: box.y });
    }
    // Settled nodes become anchors so two new nodes never stack on each other.
    anchors.push(box);
  }

  if (moved.size === 0) return nodes;
  return nodes.map((n) => {
    const pos = moved.get(n.id);
    return pos ? { ...n, position: pos } : n;
  });
}
