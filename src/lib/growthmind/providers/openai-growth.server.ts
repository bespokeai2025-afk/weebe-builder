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

export async function openaiGenerate(params: GrowthGenerateParams): Promise<GrowthGenerateResult> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI (${params.model}): ${err.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  return {
    text:         json.choices?.[0]?.message?.content ?? "",
    inputTokens:  json.usage?.prompt_tokens     ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  };
}
