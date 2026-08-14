/**
 * Conversation graph VM — flow compiler.
 *
 * Turns the untyped `conversationFlow` JSON (whether freshly exported by the
 * builder or round-tripped from a Retell import) into an indexed, validated
 * graph. Everything here is defensive: a flow that reaches this point is already
 * deployed, and a caller may already be connected, so malformed pieces are
 * dropped with a warning rather than thrown away wholesale.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import type {
  ConversationFlow,
  FlowEdge,
  FlowNode,
  FlowNodeType,
  VariableValue,
} from "./types";

const KNOWN_TYPES = new Set<FlowNodeType>([
  "conversation",
  "function",
  "branch",
  "extract_dynamic_variables",
  "press_digit",
  "sms",
  "code",
  "transfer_call",
  "agent_swap",
  "end",
]);

export interface CompiledFlow {
  flow: ConversationFlow;
  nodes: Map<string, FlowNode>;
  startNodeId: string | null;
  /** Who speaks first on the start node. */
  startSpeaker: "agent" | "user";
  globalPrompt: string;
  /** Nodes reachable from anywhere via a natural-language condition. */
  globalNodes: Array<{ node: FlowNode; condition: string; returnToPrevious: boolean }>;
  model: string | null;
  tools: Array<Record<string, unknown>>;
  /** Non-fatal problems found while compiling, surfaced for diagnostics. */
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Normalise one edge, or null when it carries no usable condition/target. */
function compileEdge(raw: unknown, fallbackId: string): FlowEdge | null {
  if (!isRecord(raw)) return null;
  const cond = isRecord(raw.transition_condition) ? raw.transition_condition : {};
  const prompt = str(cond.prompt).trim();
  const destination = str(raw.destination_node_id).trim();
  const id = str(raw.id).trim() || fallbackId;
  // An edge with neither a destination nor a condition can never fire and is not
  // worth keeping; a destination alone is fine (unconditional continue).
  if (!destination && !prompt) return null;
  return {
    id,
    ...(destination ? { destination_node_id: destination } : {}),
    transition_condition: { type: "prompt", prompt },
  };
}

function compileEdges(raw: unknown, nodeId: string): FlowEdge[] {
  if (!Array.isArray(raw)) return [];
  const out: FlowEdge[] = [];
  const seen = new Set<string>();
  raw.forEach((e, i) => {
    const edge = compileEdge(e, `edge-${nodeId}-${i}`);
    if (!edge || seen.has(edge.id)) return;
    seen.add(edge.id);
    out.push(edge);
  });
  return out;
}

/**
 * Compile a raw conversation flow.
 *
 * Node `type` is trusted only when recognised; unknown types are dropped so the
 * VM never has to guess how to execute them.
 */
export function compileFlow(raw: unknown): CompiledFlow {
  const warnings: string[] = [];
  const flow = (isRecord(raw) ? raw : {}) as ConversationFlow;
  const rawNodes = Array.isArray(flow.nodes) ? flow.nodes : [];

  const nodes = new Map<string, FlowNode>();
  for (const candidate of rawNodes) {
    if (!isRecord(candidate)) continue;
    const id = str(candidate.id).trim();
    const type = str(candidate.type).trim() as FlowNodeType;
    if (!id) {
      warnings.push("dropped a node with no id");
      continue;
    }
    if (!KNOWN_TYPES.has(type)) {
      warnings.push(`dropped node "${id}" with unsupported type "${type || "(none)"}"`);
      continue;
    }
    if (nodes.has(id)) {
      warnings.push(`dropped duplicate node id "${id}"`);
      continue;
    }

    const node = { ...candidate, id, type } as FlowNode;
    node.edges = compileEdges(candidate.edges, id);

    // Type-specific single edges. Retell keeps these out of `edges` so they are
    // not offered to the router as ordinary choices.
    const single = (key: string) => compileEdge(candidate[key], `${key}-${id}`);
    if (type === "branch" || type === "function") {
      const elseEdge = single("else_edge");
      if (elseEdge) (node as { else_edge?: FlowEdge }).else_edge = elseEdge;
    }
    if (type === "sms") {
      const success = single("success_edge");
      const failed = single("failed_edge");
      if (success) (node as { success_edge?: FlowEdge }).success_edge = success;
      if (failed) (node as { failed_edge?: FlowEdge }).failed_edge = failed;
    }
    if (type === "transfer_call" || type === "agent_swap") {
      const edge = single("edge");
      if (edge) (node as { edge?: FlowEdge }).edge = edge;
    }

    nodes.set(id, node);
  }

  // Drop edges pointing at nodes that did not survive compilation, so routing
  // never selects a destination that cannot be executed.
  const pruneDangling = (edge: FlowEdge | undefined, owner: string): FlowEdge | undefined => {
    if (!edge) return undefined;
    if (edge.destination_node_id && !nodes.has(edge.destination_node_id)) {
      warnings.push(
        `node "${owner}" edge "${edge.id}" points at missing node "${edge.destination_node_id}"`,
      );
      return { ...edge, destination_node_id: undefined };
    }
    return edge;
  };
  for (const node of nodes.values()) {
    node.edges = (node.edges ?? [])
      .map((e) => pruneDangling(e, node.id))
      .filter((e): e is FlowEdge => Boolean(e));
    for (const key of ["else_edge", "success_edge", "failed_edge", "edge"] as const) {
      const holder = node as Record<string, unknown>;
      if (holder[key]) holder[key] = pruneDangling(holder[key] as FlowEdge, node.id);
    }
  }

  const declaredStart = str(flow.start_node_id).trim();
  let startNodeId: string | null = null;
  if (declaredStart && nodes.has(declaredStart)) {
    startNodeId = declaredStart;
  } else {
    if (declaredStart) {
      warnings.push(`start_node_id "${declaredStart}" is not a valid node; falling back`);
    }
    const first =
      [...nodes.values()].find((n) => n.type === "conversation") ?? [...nodes.values()][0];
    startNodeId = first?.id ?? null;
  }
  if (!startNodeId) warnings.push("flow has no executable nodes");

  const globalNodes: CompiledFlow["globalNodes"] = [];
  for (const node of nodes.values()) {
    const setting = isRecord(node.global_node_setting) ? node.global_node_setting : undefined;
    const condition = str(setting?.condition).trim();
    // `is_global` without a condition gives the router nothing to match on, so
    // such nodes stay reachable only through ordinary edges.
    if (!condition) continue;
    if (node.id === startNodeId) {
      warnings.push(`start node "${node.id}" cannot also be a global node; ignoring`);
      continue;
    }
    globalNodes.push({
      node,
      condition,
      returnToPrevious: setting?.return_to_previous === true,
    });
  }

  const startNode = startNodeId ? nodes.get(startNodeId) : undefined;
  const nodeStartSpeaker = (startNode as { start_speaker?: string } | undefined)?.start_speaker;
  const startSpeaker =
    nodeStartSpeaker === "user" || nodeStartSpeaker === "agent"
      ? nodeStartSpeaker
      : flow.start_speaker === "user"
        ? "user"
        : "agent";

  return {
    flow,
    nodes,
    startNodeId,
    startSpeaker,
    globalPrompt: str(flow.global_prompt).trim(),
    globalNodes,
    model: str(flow.model_choice?.model).trim() || null,
    tools: Array.isArray(flow.tools) ? (flow.tools as Array<Record<string, unknown>>) : [],
    warnings,
  };
}

/** Per-node model override, falling back to the flow-level model. */
export function nodeModel(node: FlowNode, compiled: CompiledFlow, fallback?: string): string | undefined {
  const override = str(node.model_choice?.model).trim();
  return override || compiled.model || fallback || undefined;
}

/**
 * Substitute `{{variable}}` references in flow-authored text.
 *
 * Unresolved references are left verbatim: speaking "{{first_name}}" is a visible
 * bug an operator can fix, whereas silently blanking it produces a sentence that
 * reads fine but has lost its meaning.
 */
export function interpolate(text: string, variables: Record<string, VariableValue>): string {
  if (!text || !text.includes("{{")) return text;
  return text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, name: string) => {
    const value = variables[name];
    if (value === undefined || value === null || value === "") return match;
    return String(value);
  });
}
