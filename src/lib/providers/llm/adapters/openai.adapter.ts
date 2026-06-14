import type { LLMProvider, LLMGenerateParams, LLMGenerateResult } from "../interface";
import { openaiGenerate } from "@/lib/growthmind/providers/openai-growth.server";

export class OpenAILLMAdapter implements LLMProvider {
  readonly name = "openai";

  constructor(private readonly apiKey: string) {}

  async generateText(params: LLMGenerateParams): Promise<LLMGenerateResult> {
    const result = await openaiGenerate({
      system: params.system,
      user: params.user,
      model: "gpt-4.1",
      maxTokens: params.maxTokens ?? 2048,
      apiKey: this.apiKey,
    });
    const costUsd = (result.inputTokens / 1_000_000) * 2.0 + (result.outputTokens / 1_000_000) * 8.0;
    return { ...result, costUsd, model: "gpt-4.1" };
  }

  async generateJson<T = unknown>(params: LLMGenerateParams): Promise<T> {
    const result = await this.generateText({
      ...params,
      system: params.system + "\n\nRespond ONLY with valid JSON. No explanation, no markdown, just the JSON object.",
    });
    return JSON.parse(result.text) as T;
  }

  async healthCheck(): Promise<boolean> {
    const key = this.apiKey || process.env.OPENAI_API_KEY || "";
    if (!key) return false;
    try {
      const resp = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
