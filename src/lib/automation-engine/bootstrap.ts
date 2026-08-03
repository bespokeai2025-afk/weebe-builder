/**
 * Bootstrap automation engine — register core + plugin nodes once.
 */
import { registerCoreNodes } from "./registry/register-core-nodes";
import { registerWbahNodes } from "./plugins/wbah/register-wbah-nodes";
import { getNodeRegistrySnapshot } from "./registry/node-registry";

let bootstrapped = false;

export function bootstrapAutomationEngine(): { nodeTypes: string[]; count: number } {
  if (!bootstrapped) {
    registerCoreNodes();
    registerWbahNodes();
    bootstrapped = true;
  }
  const snap = getNodeRegistrySnapshot();
  return { nodeTypes: snap.types, count: snap.count };
}

/** Idempotent — safe to call from server handlers and tests. */
export function ensureAutomationEngineBootstrapped(): void {
  bootstrapAutomationEngine();
}
