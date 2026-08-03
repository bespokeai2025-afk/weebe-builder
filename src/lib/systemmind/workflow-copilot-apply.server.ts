/**
 * Apply workflow copilot output → canvas graph + automation document.
 */
import type { WorkflowDocument } from "@/lib/automation-engine/types/workflow.schema";
import { parseWorkflowDocument } from "@/lib/automation-engine/parser/parse-workflow";
import { ensureAutomationEngineBootstrapped } from "@/lib/automation-engine/bootstrap";
import type { WbahN8nNodeKind, WbahN8nWorkflowGraph } from "@/lib/wbah/workflow/wbah-n8n-node-catalog.shared";
import { emptyWbahN8nGraph } from "@/lib/wbah/workflow/wbah-n8n-node-catalog.shared";
import type { WbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import { enrichCanvasNodeConfig } from "@/lib/wbah/workflow/wbah-node-display.shared";
import type { WorkflowCopilotResponse } from "@/lib/systemmind/workflow-copilot.shared";
import { normalizeTriggerType } from "@/lib/systemmind/workflow-copilot.shared";

function layoutPosition(index: number, base?: { x: number; y: number }): { x: number; y: number } {
  if (base) return base;
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 120 + col * 220, y: 80 + row * 100 };
}

export function automationDocumentFromCopilot(
  current: WorkflowDocument | null,
  patch: NonNullable<WorkflowCopilotResponse["workflow"]>,
  removeIds?: string[],
): WorkflowDocument {
  const existingNodes = new Map(
    (current?.nodes ?? []).map((n) => [n.id, n]),
  );

  if (removeIds?.length) {
    for (const id of removeIds) existingNodes.delete(id);
  }

  for (const node of patch.nodes ?? []) {
    existingNodes.set(node.id, {
      id: node.id,
      type: node.type,
      name: node.name ?? node.id,
      config: node.config ?? {},
      position: node.position,
      disabled: false,
    });
  }

  const nodes = [...existingNodes.values()];
  if (nodes.length === 0) {
    nodes.push({
      id: "webhook-1",
      type: "core.webhook",
      name: "Webhook",
      config: { path: "/hooks/workflow", method: "POST" },
      position: { x: 80, y: 200 },
      disabled: false,
    });
  }

  const hasEnd = nodes.some(
    (n) => n.type === "core.end" || n.type === "stop_workflow" || n.type.endsWith(".end"),
  );
  let endId: string | null = null;
  if (!hasEnd) {
    endId = "end-1";
    const last = nodes[nodes.length - 1]!;
    nodes.push({
      id: endId,
      type: "core.end",
      name: "End",
      config: {},
      position: layoutPosition(nodes.length, {
        x: (last.position?.x ?? 80) + 220,
        y: last.position?.y ?? 200,
      }),
      disabled: false,
    });
  }

  const edgeKey = (c: { from: { node: string; port: string }; to: { node: string; port: string } }) =>
    `${c.from.node}:${c.from.port}->${c.to.node}:${c.to.port}`;

  const connectionMap = new Map<string, WorkflowDocument["connections"][number]>();
  for (const c of current?.connections ?? []) {
    connectionMap.set(edgeKey(c), c);
  }
  for (const c of patch.connections ?? []) {
    connectionMap.set(edgeKey(c), c);
  }

  if (removeIds?.length) {
    for (const key of [...connectionMap.keys()]) {
      const c = connectionMap.get(key)!;
      if (removeIds.includes(c.from.node) || removeIds.includes(c.to.node)) {
        connectionMap.delete(key);
      }
    }
  }

  if (endId) {
    const outgoing = new Set([...connectionMap.values()].map((c) => c.from.node));
    for (const n of nodes) {
      if (n.id === endId || n.type === "core.end") continue;
      if (!outgoing.has(n.id)) {
        connectionMap.set(`${n.id}:main->${endId}:main`, {
          from: { node: n.id, port: "main" },
          to: { node: endId, port: "main" },
        });
      }
    }
  }

  return {
    id: current?.id,
    version: (current?.version ?? 0) + 1,
    name: patch.name?.slice(0, 200) ?? current?.name ?? "Untitled workflow",
    settings: current?.settings ?? { errorPolicy: "stop", maxRetries: 3 },
    nodes,
    connections: [...connectionMap.values()],
    variables: current?.variables ?? { defaults: {} },
    meta: {
      ...(current?.meta ?? {}),
      workflow_kind: "general",
      trigger_type: normalizeTriggerType(
        patch.trigger_type ?? current?.meta?.trigger_type,
        "manual",
      ),
      purpose: patch.purpose ?? current?.meta?.purpose,
    },
  };
}

export function n8nGraphFromAutomationDocument(doc: WorkflowDocument): WbahN8nWorkflowGraph {
  const nodes = doc.nodes.map((n, i) => {
    const name = n.name ?? n.id;
    const enriched = enrichCanvasNodeConfig(n.type, name, (n.config ?? {}) as Record<string, unknown>);
    return {
      id: n.id,
      label: name,
      enabled: !n.disabled,
      config: enriched,
      position: n.position ?? layoutPosition(i),
    };
  });

  const edges = doc.connections.map((c, i) => ({
    id: `e-${c.from.node}-${c.from.port ?? "main"}-${c.to.node}-${i}`,
    source: c.from.node,
    target: c.to.node,
    ...(c.from.port && c.from.port !== "main" ? { sourceHandle: c.from.port } : {}),
  }));

  if (nodes.length === 0) return emptyWbahN8nGraph();

  return { nodes, edges };
}

export function mergeCopilotOntoPipeline(
  current: WbahPostCallWorkflowConfig,
  response: WorkflowCopilotResponse,
): WbahPostCallWorkflowConfig {
  if (response.mode !== "build" || !response.workflow) {
    return current;
  }

  ensureAutomationEngineBootstrapped();
  const currentDoc = (current.automation ?? null) as WorkflowDocument | null;
  const document = automationDocumentFromCopilot(
    currentDoc,
    response.workflow,
    response.remove_node_ids,
  );

  const parsed = parseWorkflowDocument(document);
  const n8n_graph = n8nGraphFromAutomationDocument(document);

  return {
    ...current,
    name: document.name,
    purpose: String(document.meta?.purpose ?? current.purpose ?? ""),
    workflow_kind: "general",
    steps: [],
    retell_agents: current.retell_agents ?? [],
    n8n_graph,
    automation: document as unknown as Record<string, unknown>,
    automation_validation: {
      valid: parsed.ok,
      errors: parsed.ok ? [] : parsed.errors,
      validated_at: new Date().toISOString(),
    },
    copilot_requirements: {
      env_vars: response.required_env_vars ?? current.copilot_requirements?.env_vars,
      links: response.required_links ?? current.copilot_requirements?.links,
      credentials: response.required_credentials ?? current.copilot_requirements?.credentials,
    },
  };
}

/** Map canvas kind back to automation type when user adds nodes manually. */
export function canvasKindToAutomationType(kind: WbahN8nNodeKind): string {
  switch (kind) {
    case "trigger":
      return "core.webhook";
    case "http":
      return "core.http.request";
    case "code":
      return "core.function";
    case "if":
      return "core.condition";
    case "wait":
      return "core.wait";
    case "merge":
      return "core.merge";
    case "stop":
      return "core.end";
    default:
      return "core.function";
  }
}
