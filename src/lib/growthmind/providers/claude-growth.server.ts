import { recordAiUsage, type AiUsageMeta } from "@/lib/ai/usage-ledger.server";

export type GrowthGenerateParams = {
  system:    string;
  user:      string;
  model:     string;
  maxTokens: number;
  apiKey:    string;
  usage?:    AiUsageMeta;
};

export type GrowthGenerateResult = {
  text:         string;
  inputTokens:  number;
  outputTokens: number;
};

export async function claudeGenerate(params: GrowthGenerateParams): Promise<GrowthGenerateResult> {
  const usage: AiUsageMeta = params.usage ?? { department: "platform", feature: "unattributed" };
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-api-key":       params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      params.model,
        max_tokens: params.maxTokens,
        system:     params.system,
        messages:   [{ role: "user", content: params.user }],
      }),
    });
  } catch (e: any) {
    await recordAiUsage({
      ...usage, provider: "claude", requestedModel: params.model,
      endpoint: "/v1/messages",
      latencyMs: Date.now() - startedAt, status: "failed",
      errorMessage: `network: ${e?.message ?? "fetch failed"}`,
    });
    throw e;
  }

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    await recordAiUsage({
      ...usage, provider: "claude", requestedModel: params.model,
      endpoint: "/v1/messages",
      requestId: res.headers.get("request-id"),
      latencyMs: Date.now() - startedAt, status: "failed",
      errorMessage: err.slice(0, 500),
    });
    throw new Error(`Claude (${params.model}): ${err.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  const text  = (json.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const result = {
    text,
    inputTokens:  json.usage?.input_tokens  ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };

  await recordAiUsage({
    ...usage, provider: "claude",
    requestedModel: params.model,
    returnedModel:  json.model ?? params.model,
    endpoint:       "/v1/messages",
    requestId:      res.headers.get("request-id"),
    inputTokens:       result.inputTokens,
    cachedInputTokens: json.usage?.cache_read_input_tokens ?? 0,
    outputTokens:      result.outputTokens,
    latencyMs: Date.now() - startedAt,
    status: usage.fallbackFrom ? "fallback" : "success",
    fallbackUsed: Boolean(usage.fallbackFrom),
    fallbackFrom: usage.fallbackFrom ?? null,
  });

  return result;
}
