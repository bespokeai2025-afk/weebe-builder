/**
 * Conversation graph VM — tool dispatch.
 *
 * Bridges the VM's `executeTool` hook onto the existing runtime tool executor so
 * native calls invoke the same booking/CRM endpoints Retell agents already use.
 * Node-level webhooks (how `http_request` nodes are exported) are handled here
 * directly, because their URL lives on the node rather than in the flow's tool
 * list.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { executeToolCall } from "../../runtime/tool-executor";
import type { RetellTool } from "../../runtime/schema";
import type { ToolInvocation, ToolOutcome, VariableValue, VmHooks } from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface VmHooksOptions {
  /** The flow's `tools` array, used to resolve `tool_type: "local"` nodes. */
  tools?: Array<Record<string, unknown>>;
  sendSms?(message: string, variables: Record<string, VariableValue>): Promise<boolean>;
  log?(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Build the host hooks for a call.
 *
 * `runCode` is intentionally absent: evaluating flow-authored JavaScript inside
 * the gateway process would be a remote code execution sink, so `code` nodes
 * no-op until a sandboxed evaluator exists.
 */
export function createVmHooks(options: VmHooksOptions = {}): VmHooks {
  const tools = (options.tools ?? []) as RetellTool[];

  return {
    log: options.log,
    sendSms: options.sendSms,

    async executeTool(invocation: ToolInvocation): Promise<ToolOutcome> {
      if (invocation.url) return callWebhook(invocation);

      const result = await executeToolCall(invocation.toolName, invocation.args, tools);
      // Retell's `end_call` tool hangs up rather than continuing the graph.
      const endCall = resolveToolType(tools, invocation) === "end_call";
      return { ok: !result.error, output: result.output, ...(endCall ? { endCall: true } : {}) };
    },
  };
}

function resolveToolType(
  tools: RetellTool[],
  invocation: ToolInvocation,
): string {
  if (invocation.toolType && invocation.toolType !== "local") return invocation.toolType;
  const raw = tools as Array<Record<string, unknown>>;
  const match = raw.find(
    (t) => t.name === invocation.toolName || t.tool_id === invocation.toolId,
  );
  return typeof match?.tool_type === "string" ? match.tool_type : invocation.toolType;
}

/**
 * POST a node's webhook.
 *
 * Variables are sent alongside the extracted arguments so external endpoints can
 * see call context (caller name, campaign fields) without every flow author
 * having to declare them as parameters.
 */
async function callWebhook(invocation: ToolInvocation): Promise<ToolOutcome> {
  const timeoutMs = invocation.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  // A hung endpoint would otherwise leave the caller in silence indefinitely.
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(invocation.url!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: invocation.toolName,
        args: invocation.args,
        variables: invocation.variables,
      }),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        output: JSON.stringify({ error: `webhook returned ${res.status}`, body: text.slice(0, 500) }),
      };
    }
    return { ok: true, output: text || JSON.stringify({ ok: true }), variables: pickVariables(text) };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      output: JSON.stringify({
        error: aborted ? `webhook timed out after ${timeoutMs}ms` : errMessage(err),
      }),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Promote scalar fields of a JSON webhook response into call variables, so a
 * later node can say `{{booking_reference}}` without extra configuration.
 */
function pickVariables(body: string): Record<string, VariableValue> | undefined {
  if (!body.trim().startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;

  const out: Record<string, VariableValue> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null) continue;
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") {
      out[key] = value as VariableValue;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
