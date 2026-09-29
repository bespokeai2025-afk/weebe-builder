/**
 * Text LLM access for the cascade voice engine.
 *
 * WEBEE Native graph + speech + routing use the provider selected in the builder
 * (OpenAI or Cerebras). Cerebras 402/429 falls back to OpenAI when a key exists.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMsg {
  role: ChatRole;
  content: string;
}

export const CEREBRAS_CHAT_URL = "https://api.cerebras.ai/v1/chat/completions";
export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
export const CEREBRAS_GPT_OSS_120B = "gpt-oss-120b";

export type VoiceLlmProvider = "cerebras" | "openai";

export interface VoiceLlmAuth {
  provider: VoiceLlmProvider;
  apiKey: string;
  url: string;
}

/** Use the requested provider when its key exists; otherwise the other one. */
export function resolveVoiceLlmAuth(
  overrideKey?: string,
  preferred?: VoiceLlmProvider | null,
): VoiceLlmAuth {
  const want: VoiceLlmProvider = preferred === "cerebras" || preferred === "openai" ? preferred : "openai";
  const cerebras = String(process.env.CEREBRAS_API_KEY ?? "").trim();
  const openaiEnv = String(process.env.OPENAI_API_KEY ?? "").trim();
  const override = String(overrideKey ?? "").trim();
  const openai = openaiEnv || (override && override !== cerebras ? override : "");
  if (want === "cerebras" && cerebras) {
    return { provider: "cerebras", apiKey: cerebras, url: CEREBRAS_CHAT_URL };
  }
  if (openai) {
    return { provider: "openai", apiKey: openai, url: OPENAI_CHAT_URL };
  }
  if (cerebras) {
    return { provider: "cerebras", apiKey: cerebras, url: CEREBRAS_CHAT_URL };
  }
  return { provider: "openai", apiKey: "", url: OPENAI_CHAT_URL };
}

export function resolveVoiceLlmApiKey(
  overrideKey?: string,
  preferred?: VoiceLlmProvider | null,
): string {
  return resolveVoiceLlmAuth(overrideKey, preferred).apiKey;
}

const OPENAI_TEXT_MAP: Record<string, string> = {
  "gpt-realtime": "gpt-4.1",
  "gpt-4o-realtime-preview": "gpt-4o",
  "gpt-4o-mini-realtime-preview": "gpt-4o-mini",
  "gpt-4.1": "gpt-4.1",
  "gpt-4.1-fast": "gpt-4.1",
  "gpt-4.1-mini": "gpt-4.1-mini",
  "gpt-4.1-nano": "gpt-4.1-nano",
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
};

/** True when an agent still stores an OpenAI chat/realtime id. */
export function isLegacyOpenAiVoiceModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) return true;
  return (
    id.startsWith("gpt-4") ||
    id.startsWith("gpt-realtime") ||
    id.startsWith("gpt-3.5") ||
    id.includes("realtime")
  );
}

/**
 * Map an agent's configured model onto the provider that will actually run it.
 * OpenAI ids on Cerebras fall back to gpt-oss-120b; Cerebras ids stay as selected.
 */
export function resolveTextModel(modelId: string, provider?: VoiceLlmProvider): string {
  const auth = provider ?? resolveVoiceLlmAuth().provider;
  const raw = String(modelId ?? "").trim();
  const cerebrasNative =
    raw.startsWith("gpt-oss-") ||
    raw.startsWith("llama") ||
    raw.startsWith("qwen") ||
    raw.startsWith("zai-");
  if (auth === "cerebras") {
    if (cerebrasNative) return raw;
    return CEREBRAS_GPT_OSS_120B;
  }
  if (cerebrasNative) return "gpt-4o-mini";
  return OPENAI_TEXT_MAP[raw] ?? raw;
}

/**
 * Shared, call-scoped flag: once Cerebras has failed with a quota/rate-limit error once on a
 * call, every subsequent request on that same call skips straight to OpenAI instead of trying
 * Cerebras and waiting for it to fail again first. Without this, a single call could pay for a
 * failed Cerebras attempt on *every* LLM call it makes — classify and generate each retry
 * independently — turning one provider incident into a chain of doubled round-trips for the rest
 * of the call. One `{ down: false }` object should be created per call and passed to every
 * `gptStream`/`gptComplete` call that call makes; it is never meant to be shared across calls,
 * since it doesn't expire and a real Cerebras recovery mid-outage would otherwise never be
 * retried until the next call starts fresh.
 */
export interface CerebrasBreaker {
  down: boolean;
}

export interface GptStreamOptions {
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  /** Abort mid-generation, e.g. when the caller barges in. */
  signal?: AbortSignal;
  /** Hard cap so a hung completion cannot freeze the call. */
  timeoutMs?: number;
  /** Builder-selected provider. When omitted, OpenAI is preferred. */
  provider?: VoiceLlmProvider;
  /** Constrain output to a JSON object, for extraction and analysis passes. */
  responseFormat?: "json_object";
  /** See `CerebrasBreaker` — pass the same object for every call within one voice call. */
  breaker?: CerebrasBreaker;
}

/**
 * Stream assistant content deltas as the model produces them.
 *
 * Yielding tokens (rather than returning the finished string) is what lets TTS
 * start speaking before the model has finished writing. Reasoning tokens from
 * gpt-oss-120b are dropped so they never reach TTS.
 */
export async function* gptStream(
  messages: ChatMsg[],
  options: GptStreamOptions,
): AsyncGenerator<string> {
  let auth = resolveVoiceLlmAuth(options.apiKey, options.provider);
  if (!auth.apiKey) {
    throw new Error("Voice LLM key missing — set OPENAI_API_KEY or CEREBRAS_API_KEY");
  }

  // Already know Cerebras is down for this call — don't pay for a second failed attempt.
  if (auth.provider === "cerebras" && options.breaker?.down) {
    const fallback = resolveVoiceLlmAuth(options.apiKey, "openai");
    if (fallback.apiKey) auth = fallback;
  }

  try {
    yield* streamChat(messages, options, auth);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isCerebrasQuotaError(auth.provider, message)) throw err;
    const fallback = resolveVoiceLlmAuth(options.apiKey, "openai");
    if (!fallback.apiKey || fallback.provider === auth.provider) throw err;
    console.warn(`[voice-llm] Cerebras unavailable (${message.slice(0, 120)}) — falling back to OpenAI`);
    if (options.breaker) options.breaker.down = true;
    yield* streamChat(messages, { ...options, provider: "openai" }, fallback);
  }
}

function buildChatBody(
  messages: ChatMsg[],
  options: GptStreamOptions,
  auth: VoiceLlmAuth,
  stream: boolean,
): Record<string, unknown> {
  const textModel = resolveTextModel(options.model, auth.provider);
  const body: Record<string, unknown> = { model: textModel, messages, stream };
  if (typeof options.temperature === "number") body.temperature = options.temperature;
  if (typeof options.maxTokens === "number") body.max_tokens = options.maxTokens;
  if (options.responseFormat) body.response_format = { type: options.responseFormat };
  // gpt-oss-120b thinks before it speaks; low effort keeps voice TTFT usable.
  if (auth.provider === "cerebras" && textModel.startsWith("gpt-oss-")) {
    body.reasoning_effort = "low";
  }
  return body;
}

function buildRequestSignal(options: GptStreamOptions): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 25_000);
  return options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
}

async function* streamChat(
  messages: ChatMsg[],
  options: GptStreamOptions,
  auth: VoiceLlmAuth,
): AsyncGenerator<string> {
  const body = buildChatBody(messages, options, auth, true);
  const res = await fetch(auth.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: buildRequestSignal(options),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status));
    throw new Error(`Voice LLM ${auth.provider} ${res.status}: ${text}`);
  }

  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let lineBuf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuf += dec.decode(value, { stream: true });
    const lines = lineBuf.split("\n");
    lineBuf = lines.pop() ?? "";
    for (const line of lines) {
      const payload = line.replace(/^data:\s*/, "").trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string | null; reasoning?: string | null };
          }>;
        };
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        /* skip malformed SSE line */
      }
    }
  }
}

/** True for a Cerebras response that signals it's out of quota / rate-limited. */
function isCerebrasQuotaError(provider: VoiceLlmProvider, message: string): boolean {
  return provider === "cerebras" && (/\b402\b/.test(message) || /payment_required|quota|429/.test(message));
}

async function completeOnce(
  messages: ChatMsg[],
  options: GptStreamOptions,
  auth: VoiceLlmAuth,
): Promise<string> {
  const body = buildChatBody(messages, options, auth, false);
  const res = await fetch(auth.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: buildRequestSignal(options),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status));
    throw new Error(`Voice LLM ${auth.provider} ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

/**
 * Collect a full completion — classification, extraction, and post-call analysis, none of which
 * ever read the response incrementally (each one awaits the full text before doing anything with
 * it). This used to be built on the streaming (`gptStream`) path for no benefit: `response_format:
 * json_object` forces the server to finish composing the whole JSON body before it's valid to send
 * at all, so token-by-token delivery buys nothing there — it only adds SSE framing and several
 * small reads on top of the same round trip. Measured on real classify calls: ~1.6s median through
 * the streaming path for a ~128-token JSON reply, far more than a plain request/response should
 * cost. `generate`/`generateStream` (the actual spoken response) stay on the streaming path in
 * `graph/llm.ts`, since TTS genuinely needs to start on the first token there.
 */
export async function gptComplete(
  messages: ChatMsg[],
  options: GptStreamOptions,
): Promise<string> {
  let auth = resolveVoiceLlmAuth(options.apiKey, options.provider);
  if (!auth.apiKey) {
    throw new Error("Voice LLM key missing — set OPENAI_API_KEY or CEREBRAS_API_KEY");
  }
  if (auth.provider === "cerebras" && options.breaker?.down) {
    const fallback = resolveVoiceLlmAuth(options.apiKey, "openai");
    if (fallback.apiKey) auth = fallback;
  }

  try {
    return await completeOnce(messages, options, auth);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isCerebrasQuotaError(auth.provider, message)) throw err;
    const fallback = resolveVoiceLlmAuth(options.apiKey, "openai");
    if (!fallback.apiKey || fallback.provider === auth.provider) throw err;
    console.warn(`[voice-llm] Cerebras unavailable (${message.slice(0, 120)}) — falling back to OpenAI`);
    if (options.breaker) options.breaker.down = true;
    return await completeOnce(messages, { ...options, provider: "openai" }, fallback);
  }
}
