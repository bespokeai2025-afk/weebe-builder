import type { LLMProvider, LLMGenerateParams, LLMGenerateResult } from "../interface";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/**
 * OpenRouter multi-model gateway adapter.
 * Docs: https://openrouter.ai/docs
 */
export class OpenRouterLLMAdapter implements LLMProvider {
  readonly name = "openrouter";

  private readonly model: string;

  constructor(private readonly apiKey: string, model?: string) {
    this.model = model ?? "openai/gpt-4.1";
  }

  async generateText(params: LLMGenerateParams): Promise<LLMGenerateResult> {
    if (!this.apiKey) throw new Error("OpenRouter API key not configured");

    const messages = [
      { role: "system", content: params.system },
      { role: "user",   content: params.user   },
    ];

    const resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://webee.ai",
        "X-Title": "Webee",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: params.maxTokens ?? 2048,
        temperature: params.temperature ?? 0.7,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenRouter error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";
    const inputTokens  = data.usage?.prompt_tokens     ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    const costUsd = Number(data.usage?.cost ?? 0);

    return { text, inputTokens, outputTokens, costUsd, model: this.model };
  }

  async generateJson<T = unknown>(params: LLMGenerateParams): Promise<T> {
    const result = await this.generateText({
      ...params,
      system: params.system + "\n\nRespond ONLY with valid JSON. No explanation, no markdown, just the JSON object.",
    });
    return JSON.parse(result.text) as T;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const resp = await fetch(`${OPENROUTER_BASE}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
