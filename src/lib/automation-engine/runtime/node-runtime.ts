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
    last = await executeCatching(def.execute, ctx);
    if (last.status !== "error" || !last.error?.retryable || attempt >= maxAttempts) {
      return last;
    }
    const backoff = args.node.retry?.backoffMs ?? 0;
    if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
  }

  return last!;
}

/**
 * Run an executor and turn a thrown error into a node error.
 *
 * Executors are meant to return `{ status: "error" }`, but several WBAH steps throw (a Dynamics
 * PATCH 400, WeeBespoke "fetch failed"). A throw used to escape `runExecution` entirely: the
 * failing step was never recorded, the remaining steps never ran, and the execution row stayed
 * "running" for ever — 1,219 such rows by October 2026. As a node error it is recorded, the
 * node's error policy applies, and the execution is finalised as failed.
 */
async function executeCatching(
  execute: (ctx: NodeContext) => Promise<NodeResult>,
  ctx: NodeContext,
): Promise<NodeResult> {
  try {
    return await execute(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Not retried in place: workflows default to 3 immediate attempts, and these steps write to
    // outside systems. A temporary failure is retried by the caller's queue, with backoff.
    return { status: "error", error: { message, code: "NODE_THREW", retryable: false } };
  }
}

/**
 * An error worth trying again later: the request never got an answer, or the other side said
 * "not now" (429, 5xx). A 4xx validation error is not — the same request fails the same way.
 */
export function isTransientError(message: string): boolean {
  return (
    /fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|timed? ?out|aborted/i.test(
      message,
    ) || /\((429|5\d\d)\)|\b(429|50[0-4])\b/.test(message)
  );
}

export function buildNodeInput(
  json: Record<string, unknown>,
  trigger: Record<string, unknown>,
): NodeInput {
  return { json, trigger };
}
