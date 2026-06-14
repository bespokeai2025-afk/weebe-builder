// ── Universal Provider Framework — barrel export ──────────────────────────────

export type { ProviderCategory, ProviderStatus, ProviderMeta, ProviderAdapter, TrackUsageParams } from "./types";
export { registerProvider, getProvider, listProviders, listAllProviders, getDefaultProvider, getFallbackProvider, buildScopedView } from "./registry";
export type { RegistryEntry } from "./registry";

// Category exports
export * from "./llm/index";
export * from "./voice/index";
export * from "./telephony/index";
export * from "./whatsapp/index";
export * from "./email/index";
export * from "./crm/index";
export * from "./calendar/index";
export * from "./knowledge/index";
export * from "./video/index";
export * from "./image/index";
export * from "./analytics/index";
export * from "./advertising/index";

// Usage tracking
export { trackProviderUsage, getProviderUsage, getProviderSettings, upsertProviderSetting } from "./usage.server";
