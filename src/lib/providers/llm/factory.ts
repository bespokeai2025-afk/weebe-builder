import type { LLMProvider, LLMGenerateParams, LLMGenerateResult } from "./interface";
import { OpenAILLMAdapter } from "./adapters/openai.adapter";
import { GeminiLLMAdapter } from "./adapters/gemini.adapter";
import { ClaudeLLMAdapter } from "./adapters/claude.adapter";
import { OpenRouterLLMAdapter } from "./adapters/openrouter.adapter";
import { trackProviderUsage } from "@/lib/providers/usage.server";

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
 * Returns an LLMProvider instrumented with usage tracking.
 * On every generateText / generateJson call it records request count,
 * cost (when available), duration, and errors to provider_usage.
 */
export function createInstrumentedLLMProvider(
  config: LLMConfig & { workspaceId: string },
): LLMProvider {
  const inner = createLLMProvider(config);
  const { workspaceId, provider: providerName } = config;

  async function track(durationMs: number, costUsd: number, isError: boolean) {
    await trackProviderUsage({ workspaceId, category: "llm", providerName, durationMs, costUsd, isError }).catch(() => {});
  }

  return {
    name: inner.name,
    async generateText(params: LLMGenerateParams): Promise<LLMGenerateResult> {
      const t0 = Date.now();
      try {
        const result = await inner.generateText(params);
        await track(Date.now() - t0, result.costUsd ?? 0, false);
        return result;
      } catch (err) {
        await track(Date.now() - t0, 0, true);
        throw err;
      }
    },
    async generateJson<T = unknown>(params: LLMGenerateParams): Promise<T> {
      const t0 = Date.now();
      try {
        const result = await inner.generateJson<T>(params);
        await track(Date.now() - t0, 0, false);
        return result;
      } catch (err) {
        await track(Date.now() - t0, 0, true);
        throw err;
      }
    },
  };
}
