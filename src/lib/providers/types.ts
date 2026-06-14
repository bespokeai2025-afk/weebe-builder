export type ProviderCategory =
  | "llm"
  | "voice"
  | "telephony"
  | "whatsapp"
  | "email"
  | "crm"
  | "calendar"
  | "knowledge"
  | "video"
  | "image"
  | "analytics"
  | "advertising";

export type ProviderStatus = "connected" | "disconnected" | "error" | "coming_soon";

export interface ProviderMeta {
  name: string;
  label: string;
  category: ProviderCategory;
  description: string;
  logoUrl?: string;
  docsUrl?: string;
  status: ProviderStatus;
  isDefault?: boolean;
  isFallback?: boolean;
  priority?: number;
}

export interface ProviderAdapter<TConfig = Record<string, unknown>, TClient = unknown> {
  readonly meta: ProviderMeta;
  initialize(config: TConfig): Promise<TClient>;
  healthCheck?(): Promise<boolean>;
}

export interface ProviderUsageResult {
  requests: number;
  errors: number;
  totalCostUsd: number;
  totalDurationMs: number;
  lastUsedAt?: string;
}

export interface TrackUsageParams {
  workspaceId: string;
  category: ProviderCategory;
  providerName: string;
  durationMs?: number;
  costUsd?: number;
  isError?: boolean;
}
