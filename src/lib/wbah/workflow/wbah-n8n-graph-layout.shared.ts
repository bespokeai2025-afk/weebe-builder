/**
 * Auto-layout and reset for WBAH n8n canvas graph.
 */
import {
  WBAH_N8N_NODE_CATALOG,
  defaultWbahN8nGraph,
  getN8nNodeBranch,
  type WbahN8nWorkflowGraph,
} from "./wbah-n8n-node-catalog.shared";

const CATALOG_BY_ID = Object.fromEntries(WBAH_N8N_NODE_CATALOG.map((n) => [n.id, n]));

/** Branch rows — top to bottom on canvas. */
const BRANCH_ROW: Record<string, number> = {
  dashboard_analyzed: 0,
  calendly_invitee: 1,
  dynamics_allens: 2,
  dynamics_agentic: 3,
  lifecycle_raw: 4,
  webee_live: 5,
  reporting: 6,
  entry: 7,
  custom: 8,
};

const COL_W = 200;
const ROW_H = 150;
const ORIGIN_X = 80;
const ORIGIN_Y = 60;

function computeDepths(graph: WbahN8nWorkflowGraph): Record<string, number> {
  const depths: Record<string, number> = { webhook: 0 };
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 100) {
    changed = false;
    for (const e of graph.edges) {
      const parent = depths[e.source];
      if (parent === undefined) continue;
      const next = parent + 1;
      if ((depths[e.target] ?? -1) < next) {
        depths[e.target] = next;
        changed = true;
      }
    }
  }
  return depths;
}

/** Spread nodes that share branch+depth vertically. */
function layoutPositions(graph: WbahN8nWorkflowGraph): Record<string, { x: number; y: number }> {
  const depths = computeDepths(graph);
  const slotCount = new Map<string, number>();
  const positions: Record<string, { x: number; y: number }> = {};

  for (const n of graph.nodes) {
    const branch = CATALOG_BY_ID[n.id]?.branch ?? getN8nNodeBranch(n.id);
    const row = BRANCH_ROW[branch] ?? 8;
    const depth = depths[n.id] ?? 0;
    const slotKey = `${branch}:${depth}`;
    const slot = slotCount.get(slotKey) ?? 0;
    slotCount.set(slotKey, slot + 1);

    positions[n.id] = {
      x: ORIGIN_X + depth * COL_W,
      y: ORIGIN_Y + row * ROW_H + slot * 72,
    };
  }

  // Keep webhook left-center anchor
  positions.webhook = { x: 40, y: ORIGIN_Y + 3 * ROW_H };

  return positions;
}

export function autoLayoutN8nGraph(graph: WbahN8nWorkflowGraph): WbahN8nWorkflowGraph {
  const positions = layoutPositions(graph);
  return {
    ...graph,
    nodes: graph.nodes.map((n) => ({
      ...n,
      position: positions[n.id] ?? n.position,
    })),
  };
}

export function resetN8nGraphLayout(): WbahN8nWorkflowGraph {
  return defaultWbahN8nGraph();
}

export function focusBranchLayout(
  graph: WbahN8nWorkflowGraph,
  branch: string,
): WbahN8nWorkflowGraph {
  const filtered = graph.nodes.filter((n) => {
    const b = CATALOG_BY_ID[n.id]?.branch ?? getN8nNodeBranch(n.id);
    return b === branch || n.id === "webhook";
  });
  const ids = new Set(filtered.map((n) => n.id));
  const sub: WbahN8nWorkflowGraph = {
    nodes: filtered,
    edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
  const positions = layoutPositions(sub);
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      positions[n.id] ? { ...n, position: positions[n.id]! } : n,
    ),
  };
}
