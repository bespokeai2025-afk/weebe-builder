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

import { executeToolCall, findRegisteredTool } from "../../runtime/tool-executor";
import { createBooking, getAvailableSlots } from "../../calendar/calcom.server";
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
      if (invocation.toolType === "mcp" && invocation.url) return callMcp(invocation);
      if (invocation.url) return callHttp(invocation);

      const registered = findRegisteredTool(
        tools as Array<Record<string, unknown>>,
        invocation.toolName,
        invocation.toolId,
      );
      const registeredUrl =
        typeof registered?.url === "string"
          ? registered.url.trim()
          : typeof registered?.api_url === "string"
            ? String(registered.api_url).trim()
            : "";
      // Custom / webhook tools keep their URL. Never reroute them to Cal.com
      // just because the name says "available slots".
      if (registeredUrl) {
        return callHttp({ ...invocation, url: registeredUrl });
      }
      const cal = registered ? await tryNativeCalcom(registered, invocation.args) : null;
      if (cal) return cal;

      const result = await executeToolCall(
        invocation.toolName,
        invocation.args,
        tools,
        invocation.toolId,
      );
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
  const match = findRegisteredTool(raw, invocation.toolName, invocation.toolId);
  return typeof match?.tool_type === "string" ? match.tool_type : invocation.toolType;
}

/**
 * POST a node's webhook.
 *
 * Variables are sent alongside the extracted arguments so external endpoints can
 * see call context (caller name, campaign fields) without every flow author
 * having to declare them as parameters.
 */
async function callHttp(invocation: ToolInvocation): Promise<ToolOutcome> {
  const timeoutMs = invocation.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const method = (invocation.method ?? "POST").toUpperCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(invocation.headers ?? {}),
  };

  try {
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (method !== "GET" && method !== "HEAD") {
      const fromArgs =
        invocation.args && Object.keys(invocation.args).length > 0 ? invocation.args : null;
      const body =
        invocation.body && invocation.body.trim()
          ? invocation.body
          : JSON.stringify({
              tool: invocation.toolName,
              args: invocation.args,
              variables: invocation.variables,
              ...(fromArgs ?? {}),
            });
      init.body = body;
    }
    const res = await fetch(invocation.url!, init);
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        output: JSON.stringify({ error: `http ${res.status}`, body: text.slice(0, 500) }),
      };
    }
    return { ok: true, output: text || JSON.stringify({ ok: true }), variables: pickVariables(text) };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      output: JSON.stringify({
        error: aborted ? `request timed out after ${timeoutMs}ms` : errMessage(err),
      }),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** JSON-RPC `tools/call` against an MCP HTTP endpoint. */
async function callMcp(invocation: ToolInvocation): Promise<ToolOutcome> {
  const timeoutMs = invocation.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tool = invocation.mcpTool || invocation.toolName;
  try {
    const res = await fetch(invocation.url!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(invocation.headers ?? {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: invocation.args ?? {} },
      }),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        output: JSON.stringify({ error: `mcp ${res.status}`, body: text.slice(0, 500) }),
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: true, output: text };
    }
    const rec = parsed as Record<string, unknown>;
    if (rec.error) {
      return { ok: false, output: JSON.stringify(rec.error) };
    }
    const result = rec.result ?? parsed;
    const out = typeof result === "string" ? result : JSON.stringify(result);
    return { ok: true, output: out, variables: pickVariables(out) };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      output: JSON.stringify({
        error: aborted ? `mcp timed out after ${timeoutMs}ms` : errMessage(err),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Retell-native Cal.com tools carry `cal_api_key` / `event_type_id` instead of a
 * webhook URL. Execute them the same way Retell does so booking nodes work on
 * WEBEE native without a custom HTTP node.
 */
async function tryNativeCalcom(
  tool: Record<string, unknown>,
  args: unknown,
): Promise<ToolOutcome | null> {
  const type = String(tool.type ?? tool.tool_type ?? "").trim();
  const apiKey = String(tool.cal_api_key ?? "").trim();
  const eventTypeId = Number(tool.event_type_id ?? 0);
  if (!apiKey || !eventTypeId) return null;

  const isAvailability = type === "check_availability_cal";
  const isBook = type === "book_appointment_cal";
  if (!isAvailability && !isBook) return null;

  const record = isRecord(args) ? args : {};
  const timezone =
    String(record.timezone ?? tool.timezone ?? "Europe/London").trim() || "Europe/London";

  try {
    if (isAvailability) {
      const start = String(record.start_date ?? record.start ?? "").trim() || isoDateOffset(0);
      const end = String(record.end_date ?? record.end ?? "").trim() || isoDateOffset(7);
      const slots = await getAvailableSlots(apiKey, {
        eventTypeId,
        startTime: start.includes("T") ? start : `${start}T00:00:00`,
        endTime: end.includes("T") ? end : `${end}T23:59:59`,
        timeZone: timezone,
      });
      const times = slots.slice(0, 8).map((s) => s.time);
      const summary =
        times.length > 0
          ? `Available times: ${times.join(", ")}`
          : "No slots in that window.";
      return {
        ok: true,
        output: JSON.stringify({ summary, slots: times, timezone }),
      };
    }

    const start = String(record.start ?? record.start_time ?? "").trim();
    const attendeeName = String(record.name ?? record.attendee_name ?? "").trim();
    const email = String(record.email ?? "").trim();
    if (!start || !attendeeName || !email) {
      return {
        ok: false,
        output: JSON.stringify({
          error: "book_appointment requires start, name, and email",
        }),
      };
    }
    const booked = await createBooking(apiKey, {
      eventTypeId,
      start,
      name: attendeeName,
      email,
      phone: String(record.phone ?? "").trim() || undefined,
      timeZone: timezone,
      notes: String(record.notes ?? "").trim() || undefined,
    });
    return {
      ok: true,
      output: JSON.stringify({
        confirmation_message: `Booked for ${booked.startTime}.`,
        booking_id: booked.uid,
        meeting_url: booked.meetingUrl ?? null,
      }),
      variables: booked.uid ? { booking_id: booked.uid } : undefined,
    };
  } catch (err) {
    return { ok: false, output: JSON.stringify({ error: errMessage(err) }) };
  }
}

function isoDateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
