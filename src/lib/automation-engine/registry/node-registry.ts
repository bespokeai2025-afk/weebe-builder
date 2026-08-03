/**
 * Node registry — plugins register types here; engine never imports node impls directly.
 */
import type { NodeDefinition, NodeRegistrySnapshot } from "../types/node.types";

const registry = new Map<string, NodeDefinition>();

export function registerNode(definition: NodeDefinition): void {
  if (registry.has(definition.type)) {
    throw new Error(`Node type already registered: ${definition.type}`);
  }
  registry.set(definition.type, definition);
}

export function registerNodes(definitions: NodeDefinition[]): void {
  for (const def of definitions) registerNode(def);
}

/** Replace registration (used by tests or hot reload). */
export function overrideNode(definition: NodeDefinition): void {
  registry.set(definition.type, definition);
}

export function getNodeDefinition(type: string): NodeDefinition | undefined {
  return registry.get(type);
}

export function hasNodeType(type: string): boolean {
  return registry.has(type);
}

export function listRegisteredNodeTypes(): string[] {
  return [...registry.keys()].sort();
}

export function getNodeRegistrySnapshot(): NodeRegistrySnapshot {
  const types = listRegisteredNodeTypes();
  return { types, count: types.length };
}

export function validateNodeConfig(type: string, config: Record<string, unknown>): string | null {
  const def = registry.get(type);
  if (!def) return `Unknown node type "${type}"`;
  try {
    def.validate?.(config);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function clearNodeRegistry(): void {
  registry.clear();
}
