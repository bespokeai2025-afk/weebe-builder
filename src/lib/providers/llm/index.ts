export type { LLMProvider, LLMGenerateParams, LLMGenerateResult } from "./interface";
export { createLLMProvider, type LLMConfig, type LLMProviderName } from "./factory";
export { OpenAILLMAdapter } from "./adapters/openai.adapter";
export { GeminiLLMAdapter } from "./adapters/gemini.adapter";
export { ClaudeLLMAdapter } from "./adapters/claude.adapter";

// Re-export existing GrowthMind model router — existing call sites unchanged
export { routeGenerate, type RouteGenerateParams, type RouteGenerateResult } from "@/lib/growthmind/model-router.server";
