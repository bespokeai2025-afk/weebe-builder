import type { LLMProvider, LLMGenerateParams, LLMGenerateResult } from "./interface";
import { OpenAILLMAdapter } from "./adapters/openai.adapter";
import { GeminiLLMAdapter } from "./adapters/gemini.adapter";
import { ClaudeLLMAdapter } from "./adapters/claude.adapter";
import { OpenRouterLLMAdapter } from "./adapters/openrouter.adapter";
import { withProviderTracking } from "@/lib/providers/instrumentation";

export type LLMProviderName = "openai" | "gemini" | "claude" | "openrouter" | "grok" | "mistral" | "llama";

export interface LLMConfig {
  provider: LLMProviderName;
  apiKey: string;
  model?: string;
}

export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case "openai":
      return new OpenAILLMAdapter(config.apiKey);
    case "gemini":
      return new GeminiLLMAdapter(config.apiKey);
    case "claude":
      return new ClaudeLLMAdapter(config.apiKey);
    case "openrouter":
      return new OpenRouterLLMAdapter(config.apiKey);
    case "grok":
    case "mistral":
    case "llama":
      throw new Error(`LLM provider "${config.provider}" is defined but not yet implemented. Create an adapter in src/lib/providers/llm/adapters/${config.provider}.adapter.ts.`);
    default:
      throw new Error(`Unknown LLM provider: ${String(config.provider)}`);
  }
}

/**
 * Returns an LLMProvider instrumented with usage tracking via withProviderTracking.
 * LLM cost is result-dependent (token count), so generateText tracks cost post-call.
 */
export function createInstrumentedLLMProvider(
  config: LLMConfig & { workspaceId: string },
): LLMProvider {
  const inner = createLLMProvider(config);
  const { workspaceId, provider: providerName } = config;

  return {
    name: inner.name,
    async generateText(params: LLMGenerateParams): Promise<LLMGenerateResult> {
      return withProviderTracking(
        {
          workspaceId,
          category: "llm",
          providerName,
          costExtractor: (r: LLMGenerateResult) => r.costUsd ?? 0,
        },
        () => inner.generateText(params),
      );
    },
    async generateJson<T = unknown>(params: LLMGenerateParams): Promise<T> {
      return withProviderTracking(
        { workspaceId, category: "llm", providerName },
        () => inner.generateJson<T>(params),
      );
    },
  };
}
