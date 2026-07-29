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

export async function openaiGenerate(params: GrowthGenerateParams): Promise<GrowthGenerateResult> {
  // Every request is ledgered — callers that don't pass attribution still get
  // an "unattributed" platform row so usage totals stay honest.
  const usage: AiUsageMeta = params.usage ?? { department: "platform", feature: "unattributed" };
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` },
      body: JSON.stringify({
        model:       params.model,
        messages:    [
          { role: "system", content: params.system },
          { role: "user",   content: params.user   },
        ],
        max_tokens:  params.maxTokens,
        temperature: 0.75,
      }),
    });
  } catch (e: any) {
    await recordAiUsage({
      ...usage, provider: "openai", requestedModel: params.model,
      endpoint: "/v1/chat/completions",
      latencyMs: Date.now() - startedAt, status: "failed",
      errorMessage: `network: ${e?.message ?? "fetch failed"}`,
    });
    throw e;
  }

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    await recordAiUsage({
      ...usage, provider: "openai", requestedModel: params.model,
      endpoint: "/v1/chat/completions",
      requestId: res.headers.get("x-request-id"),
      latencyMs: Date.now() - startedAt, status: "failed",
      errorMessage: err.slice(0, 500),
    });
    throw new Error(`OpenAI (${params.model}): ${err.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  const result = {
    text:         json.choices?.[0]?.message?.content ?? "",
    inputTokens:  json.usage?.prompt_tokens     ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  };

  await recordAiUsage({
    ...usage, provider: "openai",
    requestedModel: params.model,
    returnedModel:  json.model ?? params.model,
    endpoint:       "/v1/chat/completions",
    requestId:      res.headers.get("x-request-id"),
    inputTokens:       result.inputTokens,
    cachedInputTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens:      result.outputTokens,
    latencyMs: Date.now() - startedAt,
    status: usage.fallbackFrom ? "fallback" : "success",
    fallbackUsed: Boolean(usage.fallbackFrom),
    fallbackFrom: usage.fallbackFrom ?? null,
  });

  return result;
}
