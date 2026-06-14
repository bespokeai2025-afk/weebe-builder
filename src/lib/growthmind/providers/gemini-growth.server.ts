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

export async function geminiGenerate(params: GrowthGenerateParams): Promise<GrowthGenerateResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${params.apiKey}`;

  const res = await fetch(url, {
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

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini (${params.model}): ${err.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  return {
    text,
    inputTokens:  json.usageMetadata?.promptTokenCount     ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
  };
}
