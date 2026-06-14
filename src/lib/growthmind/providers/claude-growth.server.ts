export type GrowthGenerateParams = {
  system:    string;
  user:      string;
  model:     string;
  maxTokens: number;
  apiKey:    string;
};

export type GrowthGenerateResult = {
  text:         string;
  inputTokens:  number;
  outputTokens: number;
};

export async function claudeGenerate(params: GrowthGenerateParams): Promise<GrowthGenerateResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
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

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Claude (${params.model}): ${err.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  const text  = (json.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");

  return {
    text,
    inputTokens:  json.usage?.input_tokens  ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };
}
