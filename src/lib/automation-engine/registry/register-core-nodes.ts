/**
 * Core built-in node definitions with Phase 2 executors.
 */
import type { NodeDefinition } from "../types/node.types";
import { CORE_NODE_EXECUTORS } from "../executors/core-nodes";
import { registerNodes } from "./node-registry";

function def(partial: Omit<NodeDefinition, "execute" | "version">): NodeDefinition {
  const execute = CORE_NODE_EXECUTORS[partial.type];
  if (!execute) {
    throw new Error(`Missing executor for ${partial.type}`);
  }
  return {
    version: 1,
    execute,
    ...partial,
  };
}

export const CORE_NODE_DEFINITIONS: NodeDefinition[] = [
  def({
    type: "core.start",
    displayName: "Start",
    category: "trigger",
    description: "Workflow entry — receives trigger payload.",
    inputs: [],
    outputs: [{ name: "main", type: "main" }],
    properties: [{ name: "trigger", type: "string", description: "manual | webhook | event" }],
  }),
  def({
    type: "core.end",
    displayName: "End",
    category: "flow",
    description: "Terminates the workflow branch.",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [],
  }),
  def({
    type: "core.webhook",
    displayName: "Webhook",
    category: "trigger",
    description: "HTTP webhook trigger or resume endpoint.",
    inputs: [],
    outputs: [{ name: "main", type: "main" }],
    properties: [
      { name: "path", type: "string" },
      { name: "method", type: "string" },
    ],
  }),
  def({
    type: "core.http.request",
    displayName: "HTTP Request",
    category: "action",
    description: "HTTP call with expression-based URL, headers, and body.",
    inputs: [{ name: "main", type: "main" }],
    outputs: [{ name: "main", type: "main" }],
    properties: [
      { name: "method", type: "string", required: true },
      { name: "url", type: "expression", required: true },
      { name: "headers", type: "json" },
      { name: "body", type: "expression" },
    ],
  }),
  def({
    type: "core.function",
    displayName: "Function",
    category: "action",
    description: "Run inline JavaScript (sandboxed in Phase 4).",
    inputs: [{ name: "main", type: "main" }],
    outputs: [{ name: "main", type: "main" }],
    properties: [{ name: "code", type: "string", required: true }],
  }),
  def({
    type: "core.condition",
    displayName: "Condition",
    category: "logic",
    description: "If/else branch on expression.",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [
      { name: "true", type: "branch" },
      { name: "false", type: "branch" },
    ],
    properties: [{ name: "expression", type: "expression", required: true }],
  }),
  def({
    type: "core.switch",
    displayName: "Switch",
    category: "logic",
    description: "Multi-branch routing.",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [{ name: "main", type: "branch" }],
    properties: [{ name: "rules", type: "json", required: true }],
  }),
  def({
    type: "core.merge",
    displayName: "Merge",
    category: "logic",
    description: "Wait for multiple inputs before continuing.",
    inputs: [{ name: "main", type: "main" }],
    outputs: [{ name: "main", type: "main" }],
    properties: [{ name: "mode", type: "string" }],
  }),
  def({
    type: "core.delay",
    displayName: "Delay",
    category: "flow",
    description: "Pause for a fixed duration (async queue).",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [{ name: "main", type: "main" }],
    properties: [{ name: "durationMs", type: "number", required: true }],
  }),
  def({
    type: "core.wait",
    displayName: "Wait",
    category: "flow",
    description: "Pause until delay, webhook, or external event.",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [{ name: "main", type: "main" }],
    properties: [
      { name: "mode", type: "string", required: true },
      { name: "durationMs", type: "number" },
      { name: "token", type: "expression" },
      { name: "timeoutMs", type: "number" },
    ],
  }),
  def({
    type: "core.loop",
    displayName: "Loop",
    category: "logic",
    description: "Iterate over items or condition.",
    inputs: [{ name: "main", type: "main", required: true }],
    outputs: [
      { name: "loop", type: "branch" },
      { name: "done", type: "branch" },
    ],
    properties: [{ name: "items", type: "expression" }],
  }),
];

let coreRegistered = false;

export function registerCoreNodes(): void {
  if (coreRegistered) return;
  registerNodes(CORE_NODE_DEFINITIONS);
  coreRegistered = true;
}
