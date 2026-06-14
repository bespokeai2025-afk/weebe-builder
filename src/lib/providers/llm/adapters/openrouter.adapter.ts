import type { LLMProvider, LLMGenerateParams, LLMGenerateResult } from "../interface";

// TODO: implement — connect to OpenRouter API (https://openrouter.ai)
export class OpenRouterLLMAdapter implements LLMProvider {
  readonly name = "openrouter";

  constructor(private readonly _apiKey: string) {}

  async generateText(_params: LLMGenerateParams): Promise<LLMGenerateResult> {
    throw new Error("OpenRouter provider not yet implemented. Set up an account at https://openrouter.ai and implement this adapter.");
  }

  async generateJson<T = unknown>(_params: LLMGenerateParams): Promise<T> {
    throw new Error("OpenRouter provider not yet implemented.");
  }
}
