// ── OpenAI Responses API client with explicit fallback chain ─────────────────
// Used for GPT-5.6 family calls (reasoning-effort control + full usage
// breakdown incl. cached + reasoning tokens). Fallbacks follow ONLY the
// approved explicit chain (gpt-5.6-terra → gpt-5.5 → gpt-5.4), are recorded
// in the ai_usage_ledger, and NEVER fall back to gpt-4o.
//
// Supports plain text, function tools (chat-completions-shaped schemas are
// converted automatically) and streamed output (`onToken`). Every attempt —
// success, failure or fallback — is recorded in the ledger, including the
// routing decision when provided.

import { resolveOpenAiFallbackChain } from "./model-registry.server";
import { recordAiUsage, type AiUsageRecord } from "./usage-ledger.server";
import type { ReasoningEffort } from "./model-registry.shared";

export type ResponsesToolCall = { id: string; name: string; arguments: string };

export type ResponsesCallParams = {
  apiKey: string;
  model: string;
  input: Array<Record<string, unknown>> | string;
  instructions?: string;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort | null;
  temperature?: number;
  /** Chat-completions style tool schemas ({type:"function",function:{...}}) or Responses-native. */
  tools?: any[];
  /** Ledger context — every call is recorded, including failures. */
  usage: Omit<AiUsageRecord, "provider" | "requestedModel" | "returnedModel" | "endpoint" | "requestId" | "status" | "fallbackUsed" | "fallbackFrom" | "errorMessage" | "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningTokens" | "latencyMs" | "estimatedCostUsd">;
  /** Routing decision metadata recorded in the ledger (admin-visible). */
  routing?: Record<string, unknown> | null;
  /** When false (default true), no fallback — single model only. */
  allowFallback?: boolean;
  /** Stream output text token-by-token. Tool calls still return complete. */
  onToken?: (text: string) => void;
  signal?: AbortSignal;
};

export type ResponsesCallResult = {
  text: string;
  toolCalls: ResponsesToolCall[];
  model: string;              // model actually used (after any fallback)
  requestedModel: string;     // first model attempted
  responseId: string | null;
  requestIdHeader: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  latencyMs: number;
  usedFallback: boolean;
  fallbackFrom: string | null;
};

// ── Message / tool conversion helpers ─────────────────────────────────────────

/**
 * Convert chat-completions style messages (system/user/assistant/tool with
 * tool_calls) into Responses API input items. System messages should be
 * passed via `instructions` — the first system message is extracted by the
 * caller; any remaining are mapped to "developer" role items.
 */
export function toResponsesInput(messages: any[]): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "tool") {
      items.push({ type: "function_call_output", call_id: m.tool_call_id, output: String(m.content ?? "") });
      continue;
    }
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      if (m.content) items.push({ role: "assistant", content: String(m.content) });
      for (const tc of m.tool_calls) {
        items.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function?.name ?? tc.name ?? "",
          arguments: tc.function?.arguments ?? tc.arguments ?? "{}",
        });
      }
      continue;
    }
    const role = m.role === "system" ? "developer" : m.role;
    items.push({ role, content: String(m.content ?? "") });
  }
  return items;
}

/** Convert chat-completions tool schemas to Responses-native function tools. */
export function toResponsesTools(tools: any[]): any[] {
  return (tools ?? []).map((t) => {
    if (t?.type === "function" && t.function) {
      return {
        type: "function",
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      };
    }
    return t;
  });
}

function extractText(json: any): string {
  if (typeof json.output_text === "string" && json.output_text) return json.output_text;
  const parts: string[] = [];
  for (const item of json.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("");
}

function extractToolCalls(json: any): ResponsesToolCall[] {
  const out: ResponsesToolCall[] = [];
  for (const item of json.output ?? []) {
    if (item.type === "function_call") {
      out.push({
        id: String(item.call_id ?? item.id ?? ""),
        name: String(item.name ?? ""),
        arguments: String(item.arguments ?? "{}"),
      });
    }
  }
  return out;
}

function buildBody(params: ResponsesCallParams, model: string): any {
  const body: any = {
    model,
    input: params.input,
    ...(params.instructions ? { instructions: params.instructions } : {}),
    ...(params.maxOutputTokens ? { max_output_tokens: params.maxOutputTokens } : {}),
  };
  // GPT-5.x reasoning models reject `temperature` — only send it for others.
  if (params.temperature !== undefined && !/^gpt-5/.test(model)) {
    body.temperature = params.temperature;
  }
  if (params.reasoningEffort && params.reasoningEffort !== "none") {
    body.reasoning = { effort: params.reasoningEffort };
  }
  if (params.tools?.length) {
    body.tools = toResponsesTools(params.tools);
    body.tool_choice = "auto";
  }
  return body;
}

// ── Single attempts ───────────────────────────────────────────────────────────

async function callOnce(params: ResponsesCallParams, model: string): Promise<ResponsesCallResult> {
  const started = Date.now();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` },
    body: JSON.stringify(buildBody(params, model)),
    signal: params.signal,
  });
  const requestIdHeader = res.headers.get("x-request-id");

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    const e: any = new Error(`OpenAI Responses (${model}) ${res.status}: ${err.slice(0, 300)}`);
    e.requestIdHeader = requestIdHeader;
    e.status = res.status;
    throw e;
  }

  const json = (await res.json()) as any;
  const usage = json.usage ?? {};
  return {
    text: extractText(json),
    toolCalls: extractToolCalls(json),
    model: String(json.model ?? model),
    requestedModel: model,
    responseId: json.id ?? null,
    requestIdHeader,
    inputTokens: usage.input_tokens ?? 0,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    latencyMs: Date.now() - started,
    usedFallback: false,
    fallbackFrom: null,
  };
}

/** Streamed attempt — forwards output_text deltas; collects tool calls + usage. */
async function streamOnce(
  params: ResponsesCallParams,
  model: string,
  markStarted: () => void,
): Promise<ResponsesCallResult> {
  const started = Date.now();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` },
    body: JSON.stringify({ ...buildBody(params, model), stream: true }),
    signal: params.signal,
  });
  const requestIdHeader = res.headers.get("x-request-id");
  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => res.statusText);
    const e: any = new Error(`OpenAI Responses (${model}) ${res.status}: ${err.slice(0, 300)}`);
    e.requestIdHeader = requestIdHeader;
    e.status = res.status;
    throw e;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let finalJson: any = null;
  let failedEvent: any = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") {
          text += ev.delta;
          markStarted();
          params.onToken?.(ev.delta);
        } else if (ev.type === "response.completed") {
          finalJson = ev.response;
        } else if (ev.type === "response.failed" || ev.type === "error") {
          failedEvent = ev;
        }
      } catch { /* partial frame */ }
    }
  }

  if (!finalJson) {
    const msg = failedEvent?.response?.error?.message ?? failedEvent?.message ?? "stream ended without completion";
    const e: any = new Error(`OpenAI Responses (${model}) stream failed: ${String(msg).slice(0, 300)}`);
    e.requestIdHeader = requestIdHeader;
    throw e;
  }

  const usage = finalJson.usage ?? {};
  return {
    text: text || extractText(finalJson),
    toolCalls: extractToolCalls(finalJson),
    model: String(finalJson.model ?? model),
    requestedModel: model,
    responseId: finalJson.id ?? null,
    requestIdHeader,
    inputTokens: usage.input_tokens ?? 0,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    latencyMs: Date.now() - started,
    usedFallback: false,
    fallbackFrom: null,
  };
}

/**
 * Call the Responses API with the explicit approved fallback chain.
 * Every attempt — success or failure — is recorded in the ai_usage_ledger.
 * When streaming, fallback only happens if no tokens were emitted yet.
 */
export async function openaiResponsesCall(params: ResponsesCallParams): Promise<ResponsesCallResult> {
  const chain = params.allowFallback === false
    ? [params.model]
    : resolveOpenAiFallbackChain(params.model);

  let lastErr: any = null;
  let tokensEmitted = false;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    try {
      const r = params.onToken
        ? await streamOnce(params, model, () => { tokensEmitted = true; })
        : await callOnce(params, model);
      const usedFallback = i > 0;
      const result: ResponsesCallResult = {
        ...r,
        usedFallback,
        fallbackFrom: usedFallback ? params.model : null,
      };
      await recordAiUsage({
        ...params.usage,
        provider: "openai",
        requestedModel: params.model,
        returnedModel: result.model,
        endpoint: "/v1/responses",
        requestId: result.responseId ?? result.requestIdHeader,
        inputTokens: result.inputTokens,
        cachedInputTokens: result.cachedInputTokens,
        outputTokens: result.outputTokens,
        reasoningTokens: result.reasoningTokens,
        latencyMs: result.latencyMs,
        status: usedFallback ? "fallback" : "success",
        fallbackUsed: usedFallback,
        fallbackFrom: result.fallbackFrom,
        routing: params.routing ?? null,
      });
      return result;
    } catch (e: any) {
      lastErr = e;
      await recordAiUsage({
        ...params.usage,
        provider: "openai",
        requestedModel: params.model,
        returnedModel: model === params.model ? null : model,
        endpoint: "/v1/responses",
        requestId: e?.requestIdHeader ?? null,
        status: "failed",
        fallbackUsed: i > 0,
        fallbackFrom: i > 0 ? params.model : null,
        errorMessage: e?.message,
        routing: params.routing ?? null,
      });
      // Abort = caller cancelled; do not walk the chain.
      if (e?.name === "AbortError") throw e;
      // Mid-stream failure after tokens reached the client: cannot restart.
      if (tokensEmitted) throw e;
    }
  }
  throw lastErr ?? new Error("OpenAI Responses call failed with no attempts");
}
