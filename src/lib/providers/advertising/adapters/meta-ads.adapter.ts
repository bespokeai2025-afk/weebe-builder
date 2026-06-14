import type { AdProvider, AdCampaignStats } from "../interface";

// TODO: implement — connect to Meta Marketing API
// Docs: https://developers.facebook.com/docs/marketing-api
export class MetaAdsAdapter implements AdProvider {
  readonly name = "meta_ads";

  constructor(private readonly _config: { accessToken: string; adAccountId: string }) {}

  async getCampaigns(_accountId: string): Promise<AdCampaignStats[]> {
    throw new Error("Meta Ads provider not yet implemented.");
  }

  async getSpendSummary(_accountId: string, _from: string, _to: string): Promise<{ totalSpend: number; campaigns: number }> {
    throw new Error("Meta Ads provider not yet implemented.");
  }
}
