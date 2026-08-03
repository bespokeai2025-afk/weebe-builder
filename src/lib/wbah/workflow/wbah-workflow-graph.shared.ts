/**
 * WBAH post-call workflow graph — React Flow ↔ n8n catalog ↔ config ↔ execution order.
 */
import {
  WBAH_N8N_NODE_CATALOG,
  defaultWbahN8nGraph,
  emptyWbahN8nGraph,
  getN8nNodeBranch,
  getN8nNodeKind,
  mergeN8nGraphWithCatalog,
  type WbahN8nNodeKind,
  type WbahN8nWorkflowGraph,
} from "./wbah-n8n-node-catalog.shared";
import {
  automationTypeToCanvasKind,
  enrichCanvasNodeConfig,
} from "./wbah-node-display.shared";
import { defaultN8nParamsForKind } from "./wbah-n8n-node-presets.shared";
import { withDefaultCodeIfMissing } from "./wbah-n8n-code-snippets.shared";
import {
  WBAH_POST_CALL_STEP_CATALOG,
  WBAH_POST_CALL_STEP_TYPES,
  type WbahPostCallStepType,
  type WbahPostCallWorkflowConfig,
  type WbahWorkflowStepConfig,
} from "./wbah-workflow-steps.shared";

export type WbahFlowNodePosition = { x: number; y: number };

export type WbahFlowGraphMeta = {
  nodes: Array<{ id: string; position: WbahFlowNodePosition }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>;
};

const CATALOG_BY_ID = Object.fromEntries(WBAH_N8N_NODE_CATALOG.map((c) => [c.id, c]));
const EXECUTOR_BY_NODE = Object.fromEntries(
  WBAH_N8N_NODE_CATALOG.filter((n) => n.executorStepId).map((n) => [n.id, n.executorStepId!]),
);

export function resolveN8nGraph(cfg: WbahPostCallWorkflowConfig): WbahN8nWorkflowGraph {
  return mergeN8nGraphWithCatalog(cfg.n8n_graph);
}

export function n8nGraphToReactFlow(
  cfg: WbahPostCallWorkflowConfig,
  graph?: WbahN8nWorkflowGraph | null,
) {
  const g = graph ?? resolveN8nGraph(cfg);
  const stepEnabled = (stepId: string) =>
    cfg.steps.find((s) => s.id === stepId)?.enabled !== false;

  const nodes = g.nodes.map((n) => {
    const cat = CATALOG_BY_ID[n.id];
    const automationType = String((n.config as Record<string, unknown>)?.automationType ?? "");
    const kind =
      cat?.kind ??
      (automationType ? automationTypeToCanvasKind(automationType) : getN8nNodeKind(n.id));
    const executorStepId = cat?.executorStepId ?? EXECUTOR_BY_NODE[n.id];
    const branch = cat?.branch ?? getN8nNodeBranch(n.id);
    const stepActive = executorStepId ? stepEnabled(executorStepId) : true;
    const nodeEnabled = n.enabled !== false && stepActive;
    const label = n.label ?? cat?.label ?? n.id;
    const enrichedConfig = enrichCanvasNodeConfig(
      automationType || cat?.kind || kind,
      label,
      { ...(cat?.config ?? {}), ...(n.config ?? {}) },
      n.id,
      kind,
    );

    return {
      id: n.id,
      type: kind === "trigger" ? "wbahTrigger" : "wbahN8nNode",
      position: n.position,
      deletable: n.id !== "webhook",
      data: {
        label,
        kind,
        branch,
        n8nRef: cat?.n8nRef,
        nodeId: n.id,
        executorStepId,
        enabled: nodeEnabled,
        config: enrichedConfig,
      },
    };
  });

  const edges = g.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    type: "smoothstep" as const,
    animated: true,
    style: {
      stroke: e.sourceHandle === "error" || e.sourceHandle === "false" ? "#f87171" : "#a78bfa",
    },
    label: e.sourceHandle && e.sourceHandle !== "main" ? e.sourceHandle : undefined,
    labelStyle: { fill: "#9ca3af", fontSize: 9 },
  }));

  return { nodes, edges, graph: g };
}

export function reactFlowToN8nGraph(
  cfg: WbahPostCallWorkflowConfig,
  nodes: Array<{ id: string; position: { x: number; y: number }; data?: Record<string, unknown> }>,
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null }>,
): WbahPostCallWorkflowConfig {
  const existing = cfg.n8n_graph?.nodes?.length
    ? cfg.n8n_graph
    : emptyWbahN8nGraph();
  const existingById = Object.fromEntries(existing.nodes.map((n) => [n.id, n]));

  const n8n_graph: WbahN8nWorkflowGraph = {
    nodes: nodes.map((n) => {
      const prev = existingById[n.id];
      const data = (n.data ?? {}) as Record<string, unknown>;
      return {
        id: n.id,
        label: String(data.label ?? prev?.label ?? n.id),
        enabled: data.enabled !== false,
        config: (data.config as WbahN8nWorkflowGraph["nodes"][0]["config"]) ?? prev?.config,
        position: n.position,
      };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    })),
  };

  return { ...cfg, n8n_graph };
}

/** Legacy linear graph (7 coarse steps) — kept for backward compat. */
export function wbahConfigToGraph(cfg: WbahPostCallWorkflowConfig, meta?: WbahFlowGraphMeta | null) {
  return n8nGraphToReactFlow(cfg, meta ? { nodes: meta.nodes.map((n) => ({ ...n, enabled: true, config: {} })), edges: meta.edges ?? [] } : undefined);
}

export function graphMetaFromFlow(flow: Record<string, unknown> | null | undefined): WbahFlowGraphMeta | null {
  if (!flow) return null;
  const n8n = (flow as any).n8n_graph as WbahN8nWorkflowGraph | undefined;
  if (n8n?.nodes?.length) {
    return {
      nodes: n8n.nodes.map((n) => ({ id: n.id, position: n.position })),
      edges: n8n.edges ?? [],
    };
  }
  const nodes = (flow as any).graph_nodes as WbahFlowGraphMeta["nodes"] | undefined;
  const edges = (flow as any).graph_edges as WbahFlowGraphMeta["edges"] | undefined;
  if (!nodes?.length) return null;
  return { nodes, edges: edges ?? [] };
}

export function applyGraphToConfig(
  cfg: WbahPostCallWorkflowConfig,
  args: {
    edges: WbahFlowGraphMeta["edges"];
    nodePositions: WbahFlowGraphMeta["nodes"];
    enabledIds: Set<string>;
  },
): WbahPostCallWorkflowConfig {
  const nextBySource = Object.fromEntries(args.edges.map((e) => [e.source, e.target]));
  const steps: WbahWorkflowStepConfig[] = cfg.steps.map((s) => ({
    ...s,
    enabled: args.enabledIds.has(s.id),
    next: nextBySource[s.id] && nextBySource[s.id] !== "step-stop" ? nextBySource[s.id] : undefined,
  }));
  return { ...cfg, steps };
}

export function wbahConfigToFlowDefinition(cfg: WbahPostCallWorkflowConfig, meta?: WbahFlowGraphMeta | null) {
  let n8n_graph = cfg.n8n_graph;
  if (!n8n_graph?.nodes?.length && meta?.nodes?.length) {
    const existingById = Object.fromEntries((cfg.n8n_graph?.nodes ?? []).map((n) => [n.id, n]));
    n8n_graph = {
      nodes: meta.nodes.map((n) => ({
        id: n.id,
        label: existingById[n.id]?.label ?? n.id,
        enabled: existingById[n.id]?.enabled !== false,
        config: existingById[n.id]?.config ?? {},
        position: n.position,
      })),
      edges: meta.edges ?? [],
    };
  }
  if (!n8n_graph?.nodes?.length) {
    n8n_graph = emptyWbahN8nGraph();
  }
  const enabled = cfg.steps.filter((s) => s.enabled);
  const flowSteps: Array<Record<string, unknown>> = enabled.map((s) => ({
    id: s.id,
    type: s.type,
    title: s.title ?? s.type,
    enabled: true,
    next: s.next,
  }));
  return {
    steps: flowSteps,
    graph_nodes: meta?.nodes ?? n8n_graph.nodes.map((n) => ({ id: n.id, position: n.position })),
    graph_edges: meta?.edges ?? n8n_graph.edges,
    n8n_graph,
    name: cfg.name,
    purpose: cfg.purpose,
    wbah_post_call: cfg,
  };
}

const CATALOG_STEP_BY_ID = Object.fromEntries(WBAH_POST_CALL_STEP_CATALOG.map((c) => [c.id, c]));
const CATALOG_STEP_BY_TYPE = Object.fromEntries(WBAH_POST_CALL_STEP_CATALOG.map((c) => [c.type, c]));

export function stepAppliesToEvent(stepId: string, event: string): boolean {
  const cat = CATALOG_STEP_BY_ID[stepId];
  if (!cat) return stepId === "live_transcript" || true;
  return cat.events.includes("any") || cat.events.includes(event as "call_analyzed");
}

export function getExecutionOrder(
  cfg: WbahPostCallWorkflowConfig,
  event: string,
): WbahWorkflowStepConfig[] {
  const enabledById = Object.fromEntries(
    cfg.steps.filter((s) => s.enabled).map((s) => [s.id, s]),
  );
  const first = cfg.steps.find((s) => s.enabled);
  let cursor: string | undefined = first?.id;
  const seen = new Set<string>();
  const order: WbahWorkflowStepConfig[] = [];

  while (cursor && !seen.has(cursor) && cursor !== "step-stop") {
    seen.add(cursor);
    const step = enabledById[cursor];
    if (step && stepAppliesToEvent(step.id, event)) {
      order.push(step);
    }
    cursor = step?.next;
  }

  if (order.length === 0) {
    return cfg.steps.filter((s) => s.enabled && stepAppliesToEvent(s.id, event));
  }
  return order;
}

export function isStepEnabledInOrder(
  cfg: WbahPostCallWorkflowConfig,
  stepId: string,
  event?: string,
): boolean {
  const row = cfg.steps.find((s) => s.id === stepId || s.type === stepId);
  if (!row?.enabled) return false;
  if (event && !stepAppliesToEvent(row.id, event)) return false;
  return true;
}

export function addStepToConfig(
  cfg: WbahPostCallWorkflowConfig,
  catalogId: string,
): WbahPostCallWorkflowConfig {
  const cat = CATALOG_STEP_BY_ID[catalogId] ?? CATALOG_STEP_BY_TYPE[catalogId as WbahPostCallStepType];
  if (!cat) return cfg;
  if (cfg.steps.some((s) => s.id === cat.id)) {
    return {
      ...cfg,
      steps: cfg.steps.map((s) => (s.id === cat.id ? { ...s, enabled: true } : s)),
    };
  }
  const steps = [
    ...cfg.steps,
    { id: cat.id, type: cat.type, title: cat.title, enabled: true, next: undefined },
  ];
  if (steps.length > 1) {
    const prev = steps[steps.length - 2]!;
    prev.next = cat.id;
  }
  return { ...cfg, steps };
}

export function addN8nNodeToGraph(
  cfg: WbahPostCallWorkflowConfig,
  kind: WbahN8nNodeKind,
  position: { x: number; y: number },
): WbahPostCallWorkflowConfig {
  const graph = cfg.n8n_graph?.nodes?.length
    ? { nodes: [...cfg.n8n_graph.nodes], edges: [...(cfg.n8n_graph.edges ?? [])] }
    : emptyWbahN8nGraph();
  const id = `custom-${kind}-${Date.now().toString(36)}`;
  graph.nodes.push({
    id,
    label: `New ${kind}`,
    enabled: true,
    config: withDefaultCodeIfMissing(id, kind, { ...defaultN8nParamsForKind(kind) }),
    position,
  });
  return { ...cfg, n8n_graph: graph };
}

export function updateN8nNodeInGraph(
  cfg: WbahPostCallWorkflowConfig,
  nodeId: string,
  patch: Partial<{ label: string; enabled: boolean; config: Record<string, unknown> }>,
): WbahPostCallWorkflowConfig {
  const graph = cfg.n8n_graph?.nodes?.length
    ? { nodes: [...cfg.n8n_graph.nodes], edges: [...(cfg.n8n_graph.edges ?? [])] }
    : emptyWbahN8nGraph();
  graph.nodes = graph.nodes.map((n) =>
    n.id === nodeId
      ? {
          ...n,
          ...(patch.label != null ? { label: patch.label } : {}),
          ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
          ...(patch.config ? { config: { ...n.config, ...patch.config } } : {}),
        }
      : n,
  );
  return { ...cfg, n8n_graph: graph };
}

export function removeN8nNodeFromGraph(
  cfg: WbahPostCallWorkflowConfig,
  nodeId: string,
): WbahPostCallWorkflowConfig {
  if (nodeId === "webhook") return cfg;
  const graph = cfg.n8n_graph?.nodes?.length
    ? { nodes: [...cfg.n8n_graph.nodes], edges: [...(cfg.n8n_graph.edges ?? [])] }
    : emptyWbahN8nGraph();
  graph.nodes = graph.nodes.filter((n) => n.id !== nodeId);
  graph.edges = graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
  return { ...cfg, n8n_graph: graph };
}

export function removeEdgeFromN8nGraph(
  cfg: WbahPostCallWorkflowConfig,
  edgeId: string,
): WbahPostCallWorkflowConfig {
  const graph = cfg.n8n_graph?.nodes?.length
    ? { nodes: [...cfg.n8n_graph.nodes], edges: [...(cfg.n8n_graph.edges ?? [])] }
    : emptyWbahN8nGraph();
  return {
    ...cfg,
    n8n_graph: {
      ...graph,
      edges: graph.edges.filter((e) => e.id !== edgeId),
    },
  };
}

/** Merge copilot step patches onto the current pipeline (catalog ids preserved). */
export function mergeCopilotPipelineSteps(
  current: WbahPostCallWorkflowConfig,
  incoming?: WbahWorkflowStepConfig[] | null,
): WbahPostCallWorkflowConfig {
  if (!incoming?.length) return current;

  const byId = new Map(incoming.map((s) => [s.id, s]));
  const byType = new Map(incoming.map((s) => [s.type, s]));
  const catalogIds = new Set(WBAH_POST_CALL_STEP_CATALOG.map((c) => c.id));

  const baseSteps =
    current.steps.length > 0
      ? current.steps
      : WBAH_POST_CALL_STEP_CATALOG.map((c) => ({
          id: c.id,
          type: c.type,
          title: c.title,
          enabled: false,
          next: undefined as string | undefined,
        }));

  const merged = baseSteps.map((s) => {
    const patch = byId.get(s.id) ?? byType.get(s.type);
    if (!patch) return s;
    const cat = CATALOG_STEP_BY_ID[s.id] ?? CATALOG_STEP_BY_TYPE[s.type];
    return {
      id: cat?.id ?? s.id,
      type: cat?.type ?? s.type,
      title: patch.title ?? s.title ?? cat?.title,
      enabled: patch.enabled,
      next: patch.next ?? s.next,
    };
  });

  for (const patch of incoming) {
    if (catalogIds.has(patch.id) || merged.some((s) => s.id === patch.id)) continue;
    const cat = CATALOG_STEP_BY_TYPE[patch.type as WbahPostCallStepType];
    if (!cat) continue;
    merged.push({
      id: cat.id,
      type: cat.type,
      title: patch.title ?? cat.title,
      enabled: patch.enabled,
      next: patch.next,
    });
  }

  for (let i = 0; i < merged.length - 1; i++) {
    if (!merged[i]!.next) merged[i]!.next = merged[i + 1]!.id;
  }

  return { ...current, steps: merged };
}

export type CopilotCustomNode = {
  id?: string;
  kind: WbahN8nNodeKind;
  label: string;
  branch?: string;
  config?: Record<string, unknown>;
  position?: { x: number; y: number };
  connect_from?: string;
  connect_to?: string;
};

/** Add custom code/http/filter nodes from copilot onto the canvas graph. */
export function applyCopilotCustomNodes(
  cfg: WbahPostCallWorkflowConfig,
  nodes: CopilotCustomNode[] | undefined,
  removeIds?: string[] | undefined,
): WbahPostCallWorkflowConfig {
  let graph = cfg.n8n_graph?.nodes?.length
    ? { nodes: [...cfg.n8n_graph.nodes], edges: [...(cfg.n8n_graph.edges ?? [])] }
    : emptyWbahN8nGraph();

  if (removeIds?.length) {
    const drop = new Set(removeIds.filter((id) => id !== "webhook"));
    graph.nodes = graph.nodes.filter((n) => !drop.has(n.id));
    graph.edges = graph.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target));
  }

  for (const cn of nodes ?? []) {
    const id = cn.id ?? `custom-${cn.kind}-${Date.now().toString(36)}`;
    if (graph.nodes.some((n) => n.id === id)) continue;
    const position = cn.position ?? { x: 320, y: 80 + graph.nodes.length * 48 };
    graph.nodes.push({
      id,
      label: cn.label,
      enabled: true,
      config: cn.config ?? {},
      position,
    });
    if (cn.connect_from) {
      const edgeId = `e-${cn.connect_from}-${id}`;
      if (!graph.edges.some((e) => e.id === edgeId)) {
        graph.edges.push({ id: edgeId, source: cn.connect_from, target: id });
      }
    }
    if (cn.connect_to) {
      const edgeId = `e-${id}-${cn.connect_to}`;
      if (!graph.edges.some((e) => e.id === edgeId)) {
        graph.edges.push({ id: edgeId, source: id, target: cn.connect_to });
      }
    }
  }

  return { ...cfg, n8n_graph: graph };
}

/** When executor steps are enabled but the graph is blank, keep webhook-only — never inject production template. */
export function ensureGraphForPipeline(cfg: WbahPostCallWorkflowConfig): WbahPostCallWorkflowConfig {
  const graph = cfg.n8n_graph ?? emptyWbahN8nGraph();
  if (graph.nodes.length === 0) {
    return { ...cfg, n8n_graph: emptyWbahN8nGraph() };
  }
  return cfg;
}

export { WBAH_POST_CALL_STEP_CATALOG, WBAH_POST_CALL_STEP_TYPES, defaultWbahN8nGraph };
