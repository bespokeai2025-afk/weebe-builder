/**
 * Convert WBAH post-call pipeline (SystemMind n8n canvas) → canonical automation JSON.
 */
import type { WbahN8nWorkflowGraph } from "@/lib/wbah/workflow/wbah-n8n-node-catalog.shared";
import { WBAH_N8N_NODE_CATALOG } from "@/lib/wbah/workflow/wbah-n8n-node-catalog.shared";
import {
  WBAH_CODE_HINT_TO_NODE_TYPE,
  WBAH_EXECUTOR_STEP_TO_NODE_TYPE,
} from "../plugins/wbah/register-wbah-nodes";
import type { WbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import type { WorkflowConnection, WorkflowDocument, WorkflowNode } from "../types/workflow.schema";

const KIND_TO_TYPE: Record<string, string> = {
  trigger: "core.webhook",
  filter: "core.condition",
  if: "core.condition",
  merge: "core.merge",
  code: "core.function",
  http: "core.http.request",
  wait: "core.wait",
  stop: "core.end",
};

const CATALOG_KIND = Object.fromEntries(WBAH_N8N_NODE_CATALOG.map((n) => [n.id, n.kind]));

function mapNodeType(nodeId: string, cat?: (typeof WBAH_N8N_NODE_CATALOG)[number]): string {
  const kind = cat?.kind ?? (nodeId.startsWith("custom-") ? nodeId.split("-")[1] : undefined);
  if (kind === "filter" || kind === "if" || kind === "merge") {
    return KIND_TO_TYPE[kind]!;
  }
  if (cat?.executorStepId && WBAH_EXECUTOR_STEP_TO_NODE_TYPE[cat.executorStepId]) {
    return WBAH_EXECUTOR_STEP_TO_NODE_TYPE[cat.executorStepId]!;
  }
  const codeHint = cat?.config?.codeHint;
  if (codeHint && WBAH_CODE_HINT_TO_NODE_TYPE[codeHint]) {
    return WBAH_CODE_HINT_TO_NODE_TYPE[codeHint]!;
  }
  if (kind && KIND_TO_TYPE[kind]) return KIND_TO_TYPE[kind];
  if (nodeId === "webhook") return "core.webhook";
  if (nodeId.startsWith("custom-")) {
    const customKind = nodeId.split("-")[1];
    if (customKind && KIND_TO_TYPE[customKind]) return KIND_TO_TYPE[customKind];
  }
  return "core.function";
}

function graphToConnections(graph: WbahN8nWorkflowGraph): WorkflowConnection[] {
  return graph.edges.map((e) => {
    const port =
      e.sourceHandle && e.sourceHandle !== "main" ? e.sourceHandle : "main";
    return {
      from: { node: e.source, port },
      to: { node: e.target, port: "main" },
    };
  });
}

function graphToNodes(graph: WbahN8nWorkflowGraph): WorkflowNode[] {
  return graph.nodes.map((n) => {
    const cat = WBAH_N8N_NODE_CATALOG.find((c) => c.id === n.id);
    const kind = cat?.kind ?? (n.id.startsWith("custom-") ? n.id.split("-")[1] : "code");
    return {
      id: n.id,
      type: mapNodeType(n.id, cat),
      name: n.label ?? cat?.label ?? n.id,
      position: n.position,
      disabled: n.enabled === false,
      config: {
        ...(cat?.config ?? {}),
        ...(n.config ?? {}),
        wbahKind: kind,
        executorStepId: cat?.executorStepId,
        n8nRef: cat?.n8nRef,
      },
    };
  });
}

/** Ensure End node exists and leaf nodes connect to it. */
function ensureEndNode(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
): { nodes: WorkflowNode[]; connections: WorkflowConnection[] } {
  const hasEnd = nodes.some((n) => n.type === "core.end");
  const outgoingSources = new Set(connections.map((c) => c.from.node));
  const nodeIds = new Set(nodes.map((n) => n.id));

  let endId = "End";
  if (!hasEnd) {
    while (nodeIds.has(endId)) endId = `End_${Math.random().toString(36).slice(2, 6)}`;
    nodes.push({
      id: endId,
      type: "core.end",
      name: "End",
      config: {},
      position: { x: 900, y: 400 },
    });
    nodeIds.add(endId);
  } else {
    endId = nodes.find((n) => n.type === "core.end")!.id;
  }

  for (const n of nodes) {
    if (n.type === "core.end" || n.disabled) continue;
    if (!outgoingSources.has(n.id)) {
      connections.push({
        from: { node: n.id, port: "main" },
        to: { node: endId, port: "main" },
      });
      outgoingSources.add(n.id);
    }
  }

  return { nodes, connections };
}

export function wbahGraphToAutomationDocument(input: {
  name: string;
  graph: WbahN8nWorkflowGraph;
  workflowId?: string;
  retellAgents?: string[];
  meta?: Record<string, unknown>;
}): WorkflowDocument {
  let nodes = graphToNodes(input.graph);
  let connections = graphToConnections(input.graph);

  if (!nodes.some((n) => n.id === "webhook" || n.type === "core.webhook" || n.type === "core.start")) {
    nodes.unshift({
      id: "webhook",
      type: "core.webhook",
      name: "Retell Webhook",
      config: { trigger: "webhook", path: "/api/public/voice-webhook" },
      position: { x: 40, y: 280 },
    });
  }

  ({ nodes, connections } = ensureEndNode(nodes, connections));

  return {
    id: input.workflowId,
    version: 1,
    name: input.name,
    settings: {
      errorPolicy: "stop",
      maxRetries: 3,
    },
    nodes,
    connections,
    variables: {
      defaults: {
        retell_agents: input.retellAgents ?? [],
      },
    },
    meta: {
      source: "wbah_post_call",
      ...input.meta,
    },
  };
}

export function wbahPipelineToAutomationDocument(
  pipeline: WbahPostCallWorkflowConfig,
  opts?: { workflowId?: string },
): WorkflowDocument {
  const graph = pipeline.n8n_graph ?? { nodes: [], edges: [] };
  return wbahGraphToAutomationDocument({
    name: pipeline.name,
    graph,
    workflowId: opts?.workflowId,
    retellAgents: pipeline.retell_agents,
    meta: {
      executor: pipeline.executor,
      enabledSteps: pipeline.steps.filter((s) => s.enabled).map((s) => s.id),
    },
  });
}
