import type { LLMProvider, LLMGenerateParams, LLMGenerateResult } from "../interface";
import { geminiGenerate } from "@/lib/growthmind/providers/gemini-growth.server";

export class GeminiLLMAdapter implements LLMProvider {
  readonly name = "gemini";

  constructor(private readonly apiKey: string) {}

  async generateText(params: LLMGenerateParams): Promise<LLMGenerateResult> {
    const result = await geminiGenerate({
      system: params.system,
      user: params.user,
      model: "gemini-2.5-flash",
      maxTokens: params.maxTokens ?? 2048,
      apiKey: this.apiKey,
    });
    const costUsd = (result.inputTokens / 1_000_000) * 0.075 + (result.outputTokens / 1_000_000) * 0.30;
    return { ...result, costUsd, model: "gemini-2.5-flash" };
  }

  async generateJson<T = unknown>(params: LLMGenerateParams): Promise<T> {
    const result = await this.generateText({
      ...params,
      system: params.system + "\n\nRespond ONLY with valid JSON. No explanation, no markdown, just the JSON object.",
    });
    return JSON.parse(result.text) as T;
  }
}
