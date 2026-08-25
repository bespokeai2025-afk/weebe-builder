/**
 * Text LLM access for the cascade voice engine.
 *
 * The cascade uses a plain chat-completions model rather than a realtime
 * speech-to-speech model, so agents configured with a realtime model id must be
 * mapped onto their text equivalent.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMsg {
  role: ChatRole;
  content: string;
}

/** Map an agent's configured (possibly realtime) model onto a text model. */
export function resolveTextModel(modelId: string): string {
  const MAP: Record<string, string> = {
    "gpt-realtime": "gpt-4.1",
    "gpt-4o-realtime-preview": "gpt-4.1",
    "gpt-4o-mini-realtime-preview": "gpt-4.1-mini",
    "gpt-4.1": "gpt-4.1",
    "gpt-4.1-fast": "gpt-4.1",
    "gpt-4.1-mini": "gpt-4.1-mini",
    "gpt-4o": "gpt-4o",
    "gpt-4o-mini": "gpt-4o-mini",
  };
  return MAP[modelId] ?? "gpt-4.1";
}

export interface GptStreamOptions {
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  /** Abort mid-generation, e.g. when the caller barges in. */
  signal?: AbortSignal;
  /** Constrain output to a JSON object, for extraction and analysis passes. */
  responseFormat?: "json_object";
}

/**
 * Stream assistant content deltas as the model produces them.
 *
 * Yielding tokens (rather than returning the finished string) is what lets TTS
 * start speaking before the model has finished writing.
 */
export async function* gptStream(
  messages: ChatMsg[],
  options: GptStreamOptions,
): AsyncGenerator<string> {
  const textModel = resolveTextModel(options.model);
  const body: Record<string, unknown> = {
    model: textModel,
    messages,
    stream: true,
  };
  if (typeof options.temperature === "number") body.temperature = options.temperature;
  if (typeof options.maxTokens === "number") body.max_tokens = options.maxTokens;
  if (options.responseFormat) body.response_format = { type: options.responseFormat };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status));
    throw new Error(`GPT ${res.status}: ${text}`);
  }

  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let lineBuf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuf += dec.decode(value, { stream: true });
    // SSE frames are newline-delimited; the last piece may be a partial line.
    const lines = lineBuf.split("\n");
    lineBuf = lines.pop() ?? "";
    for (const line of lines) {
      const payload = line.replace(/^data:\s*/, "").trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        /* skip malformed SSE line */
      }
    }
  }
}

/** Collect a full completion. Used for classification and analysis passes. */
export async function gptComplete(messages: ChatMsg[], options: GptStreamOptions): Promise<string> {
  let out = "";
  for await (const delta of gptStream(messages, options)) out += delta;
  return out.trim();
}
