import type { AnalyticsProvider, AnalyticsReport } from "./interface";
import { GoogleAnalyticsAdapter } from "./adapters/google-analytics.adapter";
import { withProviderTracking } from "@/lib/providers/instrumentation";

export type AnalyticsProviderName = "google_analytics" | "mixpanel" | "segment" | "posthog";

export type AnalyticsConfig =
  | { provider: "google_analytics"; propertyId: string; accessToken: string }
  | { provider: "mixpanel"; projectToken: string; apiSecret: string }
  | { provider: "segment"; writeKey: string }
  | { provider: "posthog"; projectApiKey: string; host?: string };

/**
 * Create an AnalyticsProvider. When `workspaceId` is included in `config`,
 * every method call is automatically tracked in provider_usage.
 */
export function createAnalyticsProvider(
  config: AnalyticsConfig & { workspaceId?: string },
): AnalyticsProvider {
  let inner: AnalyticsProvider;
  switch (config.provider) {
    case "google_analytics":
      inner = new GoogleAnalyticsAdapter({ propertyId: config.propertyId, accessToken: config.accessToken });
      break;
    case "mixpanel":
    case "segment":
    case "posthog":
      throw new Error(`Analytics provider "${config.provider}" not yet implemented.`);
    default:
      throw new Error(`Unknown analytics provider: ${String((config as any).provider)}`);
  }

  if (!config.workspaceId) return inner;

  const { workspaceId, provider: providerName } = config;
  const track = <T>(fn: () => Promise<T>) =>
    withProviderTracking({ workspaceId, category: "analytics", providerName }, fn);

  return {
    name: inner.name,
    getReport: (params: { from: string; to: string; metrics: string[] }): Promise<AnalyticsReport> =>
      track(() => inner.getReport(params)),
    ...(inner.getRealtimeUsers
      ? { getRealtimeUsers: () => track(() => inner.getRealtimeUsers!()) }
      : {}),
  };
}

/** @deprecated Use createAnalyticsProvider({ ..., workspaceId }) instead. */
export const createInstrumentedAnalyticsProvider = (
  config: AnalyticsConfig & { workspaceId: string },
): AnalyticsProvider => createAnalyticsProvider(config);
