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
  /** Seeded at call time from CRM/dialer or explicit runtimeDefault — not analysis examples. */
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
 * Builder `defaultValue` / Retell `examples` are post-call analysis hints, not a
 * live lead. Only an explicit `runtimeDefault` (or call-time dynamic values)
 * belongs in the VM store.
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

/** Builder variable rows → runtime map. Analysis examples are not runtime values. */
export function variablesArrayToMap(
  declared: Array<{ name?: string; runtimeDefault?: string; defaultValue?: string; examples?: string[] }>,
): Record<string, VariableValue> {
  return seedVariables(declared);
}

/**
 * Merge call-time values over any explicit runtime defaults.
 * Analysis `defaultValue` / `examples` are not applied.
 */
export function mergeRuntimeVariables(
  declared: unknown[],
  dynamic: Record<string, VariableValue> = {},
): Record<string, VariableValue> {
  return { ...seedVariables(declared), ...dynamic };
}

/**
 * Pre-populate variables that carry an explicit call-time default.
 *
 * Builder `defaultValue` is a post-call analysis example (Retell import copies
 * `examples[0]` into it). Speaking that as a live lead skips collect nodes and
 * dumps sample PII. Only `runtimeDefault` is seeded; everything else stays
 * absent until the CRM/dialer or the caller provides it.
 */
function seedVariables(declared: unknown[]): Record<string, VariableValue> {
  const out: Record<string, VariableValue> = {};
  for (const item of declared) {
    if (!isRecord(item)) continue;
    const name = String(item.name ?? "").trim();
    if (!name) continue;
    const value = item.runtimeDefault ?? item.runtime_default;
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[name] = value;
    }
  }
  return out;
}
