/**
 * Conversation graph VM — load a flow from a stored agent.
 *
 * Agents persist the builder graph (`flow_data`) plus `settings`, not the
 * Retell-shaped flow. Rather than teach the VM a second schema, we run the same
 * exporter that produces the JSON Retell receives, so a native call and a Retell
 * call interpret byte-identical graphs. That equivalence is what makes shadow
 * testing meaningful.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { exportAgentJson } from "../../builder/export-conversation-flow";
import type { ConversationFlow, VariableValue } from "./types";

export interface LoadedFlow {
  flow: ConversationFlow;
  /** Seed variables declared on the agent, so `{{…}}` resolves from turn one. */
  variables: Record<string, VariableValue>;
  /** Non-fatal problems, surfaced rather than swallowed. */
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Build a runnable conversation flow from an agent's stored builder graph.
 *
 * The exporter validates as it goes and throws on things Retell would reject
 * (a dynamic transfer with no variable, a malformed extension). Since a caller
 * may already be connected when this runs, an export failure falls back to the
 * round-tripped `rawConversationFlow` when the agent was imported, and otherwise
 * surfaces an empty flow for the caller to handle.
 */
export function loadFlowFromAgent(
  flowData: unknown,
  settings: unknown,
  dynamicVariables: Record<string, VariableValue> = {},
): LoadedFlow {
  const warnings: string[] = [];
  const data = isRecord(flowData) ? flowData : {};
  const cfg = isRecord(settings) ? settings : {};

  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const declared = Array.isArray(data.variables)
    ? data.variables
    : Array.isArray(cfg.variables)
      ? cfg.variables
      : [];

  let flow: ConversationFlow = {};
  try {
    // The exporter's parameter types come from the builder's React-Flow store;
    // stored rows carry the same shape without the class instances.
    const agent = exportAgentJson(
      nodes as never,
      edges as never,
      cfg as never,
      declared as never,
    ) as Record<string, unknown>;
    if (isRecord(agent.conversationFlow)) flow = agent.conversationFlow as ConversationFlow;
  } catch (err) {
    warnings.push(
      `flow export failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    const raw = cfg.rawConversationFlow;
    if (isRecord(raw) && Array.isArray(raw.nodes) && raw.nodes.length > 0) {
      warnings.push("using the imported rawConversationFlow instead");
      flow = raw as ConversationFlow;
    }
  }

  if (!Array.isArray(flow.nodes) || flow.nodes.length === 0) {
    warnings.push("agent has no conversation-flow nodes to execute");
  }

  return {
    flow,
    variables: { ...seedVariables(declared), ...dynamicVariables },
    warnings,
  };
}

/**
 * Seed variables from a stored agent without compiling its flow.
 *
 * Used when the caller brings its own flow (a builder test call) but still wants
 * the agent's declared defaults. Running the exporter for this would be wasted
 * work, and worse, would report export warnings about a graph nobody is running.
 */
export function seedVariablesFromAgent(
  flowData: unknown,
  settings: unknown,
): Record<string, VariableValue> {
  const data = isRecord(flowData) ? flowData : {};
  const cfg = isRecord(settings) ? settings : {};
  const declared = Array.isArray(data.variables)
    ? data.variables
    : Array.isArray(cfg.variables)
      ? cfg.variables
      : [];
  return seedVariables(declared);
}

/**
 * Pre-populate declared variables that carry a default.
 *
 * Only defaults are seeded; a variable the agent expects to collect must stay
 * absent so `{{…}}` interpolation and extraction can tell "not yet known" from
 * "known to be empty".
 */
function seedVariables(declared: unknown[]): Record<string, VariableValue> {
  const out: Record<string, VariableValue> = {};
  for (const item of declared) {
    if (!isRecord(item)) continue;
    const name = String(item.name ?? "").trim();
    if (!name) continue;
    const value = item.defaultValue ?? item.default_value;
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[name] = value;
    }
  }
  return out;
}
