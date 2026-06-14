import type { AdProvider, AdCampaignStats } from "./interface";
import { GoogleAdsAdapter } from "./adapters/google-ads.adapter";
import { MetaAdsAdapter } from "./adapters/meta-ads.adapter";
import { withProviderTracking } from "@/lib/providers/instrumentation";

export type AdProviderName = "google_ads" | "meta_ads" | "linkedin_ads" | "tiktok_ads";

export type AdConfig =
  | { provider: "google_ads"; developerToken: string; accessToken: string; customerId: string }
  | { provider: "meta_ads"; accessToken: string; adAccountId: string }
  | { provider: "linkedin_ads"; accessToken: string; accountId: string }
  | { provider: "tiktok_ads"; accessToken: string; advertiserId: string };

/**
 * Create an AdProvider. When `workspaceId` is included in `config`,
 * every method call is automatically tracked in provider_usage.
 */
export function createAdProvider(
  config: AdConfig & { workspaceId?: string },
): AdProvider {
  let inner: AdProvider;
  switch (config.provider) {
    case "google_ads":
      inner = new GoogleAdsAdapter({ developerToken: config.developerToken, accessToken: config.accessToken, customerId: config.customerId });
      break;
    case "meta_ads":
      inner = new MetaAdsAdapter({ accessToken: config.accessToken, adAccountId: config.adAccountId });
      break;
    case "linkedin_ads":
    case "tiktok_ads":
      throw new Error(`Ad provider "${config.provider}" not yet implemented.`);
    default:
      throw new Error(`Unknown advertising provider: ${String((config as any).provider)}`);
  }

  if (!config.workspaceId) return inner;

  const { workspaceId, provider: providerName } = config;
  const track = <T>(fn: () => Promise<T>) =>
    withProviderTracking({ workspaceId, category: "advertising", providerName, unitsConsumed: 1, unitType: "sync" }, fn);

  return {
    name: inner.name,
    getCampaigns: (accountId: string): Promise<AdCampaignStats[]> =>
      track(() => inner.getCampaigns(accountId)),
    getSpendSummary: (accountId: string, from: string, to: string) =>
      track(() => inner.getSpendSummary(accountId, from, to)),
  };
}

/** @deprecated Use createAdProvider({ ..., workspaceId }) instead. */
export const createInstrumentedAdProvider = (
  config: AdConfig & { workspaceId: string },
): AdProvider => createAdProvider(config);
