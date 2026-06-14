export interface VoiceSessionParams {
  agentRowId: string;
  compiledPrompt: string;
  voiceId?: string;
  additionalConfig?: Record<string, unknown>;
}

export interface VoiceSessionResult {
  clientSecret?: string;
  wsUrl?: string;
  sessionId?: string;
}

export interface VoiceProvider {
  readonly name: string;
  createSession(params: VoiceSessionParams): Promise<VoiceSessionResult>;
  endSession?(sessionId: string): Promise<void>;
  readonly status: "available" | "coming_soon";
  healthCheck?(): Promise<boolean>;
}
