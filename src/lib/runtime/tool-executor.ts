/**
 * Core Runtime — Tool Executor
 *
 * Two responsibilities:
 *
 *   1. buildOpenAIToolDefinitions(tools)
 *      Converts the validated RetellTool[] from an AgentRuntimeDefinition into
 *      the OpenAI Realtime session `tools` array.  Passed verbatim to
 *      session.update so OpenAI registers the functions before any response.
 *
 *   2. executeToolCall(name, args, tools)
 *      Called by the browser when OpenAI fires response.function_call_arguments.done.
 *      Routes the call through the tool registry and returns a string result that
 *      the caller sends back as conversation.item.create { type:"function_call_output" }.
 *
 * RULES:
 *   - This file has no knowledge of Retell.
 *   - This file has no side effects on import.
 *   - Tool definitions are read from the Core Runtime definition only — never
 *     assembled inline from React state.
 */

import type { RetellTool } from "./schema";

// ─── OpenAI tool shape ────────────────────────────────────────────────────────

export interface OpenAIToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Convert a validated RetellTool[] from the AgentRuntimeDefinition into the
 * OpenAI Realtime session tools format.
 *
 * - Tools without a `name` are skipped (OpenAI requires a non-empty name).
 * - The `parameters` field is forwarded as-is when present; absent fields are
 *   defaulted to an empty object schema so OpenAI accepts the registration.
 * - Unknown/custom fields from the passthrough RetellTool schema are dropped —
 *   OpenAI rejects unknown_parameter fields in the session update.
 */
export function buildOpenAIToolDefinitions(tools: RetellTool[]): OpenAIToolDefinition[] {
  const result: OpenAIToolDefinition[] = [];
  for (const tool of tools) {
    const raw = tool as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) continue;

    const description = typeof raw.description === "string" ? raw.description : "";

    // Forward the parameters schema when present.  Retell and OpenAI use the
    // same JSON Schema subset (object + properties + required) so this is safe.
    const parameters = (raw.parameters as OpenAIToolDefinition["parameters"] | undefined) ?? {
      type: "object",
      properties: {},
      required: [],
    };

    result.push({ type: "function", name, description, parameters });
  }
  return result;
}

// ─── Tool execution ────────────────────────────────────────────────────────────

export interface ToolCallResult {
  /** JSON-serialised string to send as conversation.item.create output. */
  output: string;
  /** Present when the tool call failed or was unrecognised. */
  error?: string;
}

/**
 * Execute a single tool call dispatched by OpenAI Realtime.
 *
 * @param toolName   The function name from response.function_call_arguments.done
 * @param toolArgs   Parsed argument object from the `arguments` JSON string
 * @param tools      The validated RetellTool[] from the agent's runtime definition
 *
 * Always resolves — never rejects.  Errors are returned as a result so the
 * conversation.item.create call can still be sent and the session can continue.
 */
export async function executeToolCall(
  toolName: string,
  toolArgs: unknown,
  tools: RetellTool[],
): Promise<ToolCallResult> {
  const raw = tools as Array<Record<string, unknown>>;
  const tool = raw.find((t) => t.name === toolName);

  if (!tool) {
    console.warn(`[runtime/tool-executor] Unknown tool: "${toolName}"`);
    return {
      output: JSON.stringify({ error: `Tool "${toolName}" is not registered in this agent.` }),
      error: "not_found",
    };
  }

  console.log(`[runtime/tool-executor] Executing tool="${toolName}"`, toolArgs);

  // ── Built-in tool handlers ──────────────────────────────────────────────────
  // These match Retell's well-known tool_type values and provide deterministic
  // results without a network call.
  const toolType = typeof tool.tool_type === "string" ? tool.tool_type : "";

  switch (toolType) {
    case "end_call":
      return { output: JSON.stringify({ ended: true, message: "Call ended by agent." }) };

    case "transfer_call": {
      const dest = (toolArgs as Record<string, unknown>)?.destination ?? "operator";
      return { output: JSON.stringify({ transferred: true, destination: dest }) };
    }

    default:
      break;
  }

  // ── Custom / webhook tools ──────────────────────────────────────────────────
  // For tools backed by a webhook URL, the Retell tool shape includes a
  // `speak_during_execution` and `api_url` field.  Invoke if present.
  const apiUrl = typeof tool.api_url === "string" ? tool.api_url.trim() : "";
  if (apiUrl) {
    try {
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: toolName, args: toolArgs }),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        return {
          output: JSON.stringify({ error: `Tool "${toolName}" webhook returned ${resp.status}: ${errText}` }),
          error: "webhook_error",
        };
      }
      const resultText = await resp.text();
      return { output: resultText };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[runtime/tool-executor] Webhook error for "${toolName}":`, message);
      return {
        output: JSON.stringify({ error: `Tool "${toolName}" webhook failed: ${message}` }),
        error: "webhook_error",
      };
    }
  }

  // ── No executor available — return stub ────────────────────────────────────
  // Tool is registered in the definition but has no built-in handler and no
  // webhook URL.  Return a neutral acknowledgement so the conversation can
  // continue rather than hanging waiting for a result.
  return {
    output: JSON.stringify({
      result: "acknowledged",
      tool: toolName,
      note: "Tool registered but not yet wired to an executor.",
    }),
  };
}
