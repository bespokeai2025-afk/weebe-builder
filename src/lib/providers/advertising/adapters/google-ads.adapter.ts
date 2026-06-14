import type { AdProvider, AdCampaignStats } from "../interface";

// TODO: implement — connect to Google Ads API
// Docs: https://developers.google.com/google-ads/api/docs/start
export class GoogleAdsAdapter implements AdProvider {
  readonly name = "google_ads";

  constructor(private readonly _config: { developerToken: string; accessToken: string; customerId: string }) {}

  async getCampaigns(_accountId: string): Promise<AdCampaignStats[]> {
    throw new Error("Google Ads provider not yet implemented.");
  }

  async getSpendSummary(_accountId: string, _from: string, _to: string): Promise<{ totalSpend: number; campaigns: number }> {
    throw new Error("Google Ads provider not yet implemented.");
  }
}
