// ── OpenAI Responses API client with explicit fallback chain ─────────────────
// Used for GPT-5.6 family calls (reasoning-effort control + full usage
// breakdown incl. cached + reasoning tokens). Fallbacks follow ONLY the
// approved explicit chain (gpt-5.6-terra → gpt-5.5 → gpt-5.4), are recorded
// in the ai_usage_ledger, and NEVER fall back to gpt-4o.

import { resolveOpenAiFallbackChain } from "./model-registry.server";
import { recordAiUsage, type AiUsageRecord } from "./usage-ledger.server";
import type { ReasoningEffort } from "./model-registry.shared";

export type ResponsesCallParams = {
  apiKey: string;
  model: string;
  input: Array<{ role: string; content: string }> | string;
  instructions?: string;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort | null;
  temperature?: number;
  /** Ledger context — every call is recorded, including failures. */
  usage: Omit<AiUsageRecord, "provider" | "requestedModel" | "returnedModel" | "endpoint" | "requestId" | "status" | "fallbackUsed" | "fallbackFrom" | "errorMessage" | "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningTokens" | "latencyMs" | "estimatedCostUsd">;
  /** When false (default true), no fallback — single model only. */
  allowFallback?: boolean;
  signal?: AbortSignal;
};

export type ResponsesCallResult = {
  text: string;
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

async function callOnce(params: ResponsesCallParams, model: string): Promise<ResponsesCallResult> {
  const started = Date.now();
  const body: any = {
    model,
    input: params.input,
    ...(params.instructions ? { instructions: params.instructions } : {}),
    ...(params.maxOutputTokens ? { max_output_tokens: params.maxOutputTokens } : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
  };
  if (params.reasoningEffort && params.reasoningEffort !== "none") {
    body.reasoning = { effort: params.reasoningEffort };
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` },
    body: JSON.stringify(body),
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

/**
 * Call the Responses API with the explicit approved fallback chain.
 * Every attempt — success or failure — is recorded in the ai_usage_ledger.
 */
export async function openaiResponsesCall(params: ResponsesCallParams): Promise<ResponsesCallResult> {
  const chain = params.allowFallback === false
    ? [params.model]
    : resolveOpenAiFallbackChain(params.model);

  let lastErr: any = null;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    try {
      const r = await callOnce(params, model);
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
      });
      // Abort = caller cancelled; do not walk the chain.
      if (e?.name === "AbortError") throw e;
    }
  }
  throw lastErr ?? new Error("OpenAI Responses call failed with no attempts");
}
