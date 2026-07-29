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

export async function geminiGenerate(params: GrowthGenerateParams): Promise<GrowthGenerateResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${params.apiKey}`;
  const usage: AiUsageMeta = params.usage ?? { department: "platform", feature: "unattributed" };
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: params.system }] },
        contents: [{ role: "user", parts: [{ text: params.user }] }],
        generationConfig: {
          maxOutputTokens: params.maxTokens,
          temperature:     0.75,
        },
      }),
    });
  } catch (e: any) {
    await recordAiUsage({
      ...usage, provider: "gemini", requestedModel: params.model,
      endpoint: ":generateContent",
      latencyMs: Date.now() - startedAt, status: "failed",
      errorMessage: `network: ${e?.message ?? "fetch failed"}`,
    });
    throw e;
  }

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    await recordAiUsage({
      ...usage, provider: "gemini", requestedModel: params.model,
      endpoint: ":generateContent",
      latencyMs: Date.now() - startedAt, status: "failed",
      errorMessage: err.slice(0, 500),
    });
    throw new Error(`Gemini (${params.model}): ${err.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const result = {
    text,
    inputTokens:  json.usageMetadata?.promptTokenCount     ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
  };

  await recordAiUsage({
    ...usage, provider: "gemini",
    requestedModel: params.model,
    returnedModel:  json.modelVersion ?? params.model,
    endpoint:       ":generateContent",
    requestId:      json.responseId ?? null,
    inputTokens:       result.inputTokens,
    cachedInputTokens: json.usageMetadata?.cachedContentTokenCount ?? 0,
    outputTokens:      result.outputTokens,
    reasoningTokens:   json.usageMetadata?.thoughtsTokenCount ?? 0,
    latencyMs: Date.now() - startedAt,
    status: usage.fallbackFrom ? "fallback" : "success",
    fallbackUsed: Boolean(usage.fallbackFrom),
    fallbackFrom: usage.fallbackFrom ?? null,
  });

  return result;
}
