export interface LLMGenerateParams {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMGenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  generateText(params: LLMGenerateParams): Promise<LLMGenerateResult>;
  generateJson<T = unknown>(params: LLMGenerateParams): Promise<T>;
  healthCheck?(): Promise<boolean>;
}
