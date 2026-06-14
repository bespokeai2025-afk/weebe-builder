export interface AdCampaignStats {
  campaignId: string;
  name: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  ctr: number;
  cpc: number;
  roas?: number;
  status: string;
}

export interface AdProvider {
  readonly name: string;
  getCampaigns(accountId: string): Promise<AdCampaignStats[]>;
  getSpendSummary(accountId: string, from: string, to: string): Promise<{ totalSpend: number; campaigns: number }>;
}
