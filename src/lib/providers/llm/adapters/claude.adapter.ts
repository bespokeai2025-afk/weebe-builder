import type { LLMProvider, LLMGenerateParams, LLMGenerateResult } from "../interface";
import { claudeGenerate } from "@/lib/growthmind/providers/claude-growth.server";

export class ClaudeLLMAdapter implements LLMProvider {
  readonly name = "claude";

  constructor(private readonly apiKey: string) {}

  async generateText(params: LLMGenerateParams): Promise<LLMGenerateResult> {
    const result = await claudeGenerate({
      system: params.system,
      user: params.user,
      model: "claude-sonnet-4-5",
      maxTokens: params.maxTokens ?? 2048,
      apiKey: this.apiKey,
    });
    const costUsd = (result.inputTokens / 1_000_000) * 3.0 + (result.outputTokens / 1_000_000) * 15.0;
    return { ...result, costUsd, model: "claude-sonnet-4-5" };
  }

  async generateJson<T = unknown>(params: LLMGenerateParams): Promise<T> {
    const result = await this.generateText({
      ...params,
      system: params.system + "\n\nRespond ONLY with valid JSON. No explanation, no markdown, just the JSON object.",
    });
    return JSON.parse(result.text) as T;
  }

  async healthCheck(): Promise<boolean> {
    const key = this.apiKey || process.env.ANTHROPIC_API_KEY || "";
    if (!key) return false;
    try {
      const resp = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
