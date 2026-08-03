/**
 * Node runtime — builds context and invokes registered node executors.
 */
import type { RuntimeNode, RuntimeWorkflow } from "../types/workflow.schema";
import type { NodeContext, NodeInput, NodeResult } from "../types/node.types";
import { getNodeDefinition } from "../registry/node-registry";
import { ensureAutomationEngineBootstrapped } from "../bootstrap";
import { buildNodeIdByLabelMap } from "../expressions/resolve-expression";

export interface RunNodeArgs {
  workflow: RuntimeWorkflow;
  executionId: string;
  node: RuntimeNode;
  input: NodeInput;
  nodeOutputs: Record<string, unknown[]>;
  trigger: Record<string, unknown>;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
}

export async function runNode(args: RunNodeArgs): Promise<NodeResult> {
  ensureAutomationEngineBootstrapped();
  const def = getNodeDefinition(args.node.type);
  if (!def) {
    return {
      status: "error",
      error: {
        message: `Unknown node type "${args.node.type}"`,
        code: "UNKNOWN_NODE",
        retryable: false,
      },
    };
  }

  const nodeIdByLabel = buildNodeIdByLabelMap(args.workflow.nodes.values());

  const ctx: NodeContext = {
    workflowId: args.workflow.id,
    executionId: args.executionId,
    nodeId: args.node.id,
    nodeType: args.node.type,
    config: args.node.config ?? {},
    input: args.input,
    variables: args.workflow.variables ?? {},
    globalVariables: {},
    nodeOutputs: args.nodeOutputs,
    nodeIdByLabel,
    env: args.env ?? {},
    secrets: args.secrets ?? {},
  };

  const maxAttempts = args.node.retry?.maxAttempts ?? args.workflow.settings.maxRetries ?? 1;
  let last: NodeResult | null = null;

  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
    last = await def.execute(ctx);
    if (last.status !== "error" || !last.error?.retryable || attempt >= maxAttempts) {
      return last;
    }
    const backoff = args.node.retry?.backoffMs ?? 0;
    if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
  }

  return last!;
}

export function buildNodeInput(
  json: Record<string, unknown>,
  trigger: Record<string, unknown>,
): NodeInput {
  return { json, trigger };
}
