/**
 * Locate workflow entry nodes (triggers / start).
 */
import type { RuntimeNode } from "../types/workflow.schema";

const ENTRY_NODE_TYPES = new Set([
  "core.start",
  "core.webhook",
  "trigger",
  // Legacy / adapter aliases
  "n8n-nodes-base.webhook",
  "n8n-nodes-base.manualTrigger",
]);

export function isEntryNodeType(type: string): boolean {
  return ENTRY_NODE_TYPES.has(type) || type.endsWith(".start") || type.endsWith(".webhook");
}

export function findEntryNodes(nodes: Map<string, RuntimeNode>): string[] {
  const entries: string[] = [];
  for (const [id, node] of nodes) {
    if (node.disabled) continue;
    if (isEntryNodeType(node.type)) entries.push(id);
  }
  return entries;
}

export function findEndNodes(nodes: Map<string, RuntimeNode>): string[] {
  const ends: string[] = [];
  for (const [id, node] of nodes) {
    if (node.disabled) continue;
    if (node.type === "core.end" || node.type === "stop_workflow" || node.type.endsWith(".end")) {
      ends.push(id);
    }
  }
  return ends;
}
