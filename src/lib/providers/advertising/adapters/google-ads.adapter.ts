import type { AdProvider, AdCampaignStats } from "../interface";

/**
 * Google Ads API v17 adapter.
 * Requires: developerToken, accessToken (OAuth), customerId.
 * Docs: https://developers.google.com/google-ads/api/docs/start
 */
export class GoogleAdsAdapter implements AdProvider {
  readonly name = "google_ads";

  constructor(private readonly config: { developerToken: string; accessToken: string; customerId: string }) {}

  private get cid(): string {
    return this.config.customerId.replace(/-/g, "");
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      "developer-token": this.config.developerToken,
      "Content-Type": "application/json",
    };
  }

  async getCampaigns(_accountId: string): Promise<AdCampaignStats[]> {
    const { developerToken, accessToken } = this.config;
    if (!developerToken || !accessToken) {
      throw new Error("Google Ads requires a developer token and OAuth access token");
    }

    const resp = await fetch(
      `https://googleads.googleapis.com/v17/customers/${this.cid}/googleAds:search`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          query: [
            "SELECT campaign.id, campaign.name, campaign.status,",
            "metrics.impressions, metrics.clicks, metrics.conversions,",
            "metrics.cost_micros, metrics.ctr, metrics.average_cpc",
            "FROM campaign",
            "WHERE campaign.status != 'REMOVED'",
            "LIMIT 50",
          ].join(" "),
        }),
      },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Google Ads API error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return (data.results ?? []).map((r: any) => ({
      campaignId: String(r.campaign?.id ?? ""),
      name: r.campaign?.name ?? "",
      status: r.campaign?.status ?? "UNKNOWN",
      impressions: Number(r.metrics?.impressions ?? 0),
      clicks: Number(r.metrics?.clicks ?? 0),
      conversions: Number(r.metrics?.conversions ?? 0),
      spend: Number(r.metrics?.costMicros ?? 0) / 1_000_000,
      ctr: Number(r.metrics?.ctr ?? 0),
      cpc: Number(r.metrics?.averageCpc ?? 0) / 1_000_000,
    }));
  }

  async getSpendSummary(_accountId: string, from: string, to: string): Promise<{ totalSpend: number; campaigns: number }> {
    const { developerToken, accessToken } = this.config;
    if (!developerToken || !accessToken) {
      throw new Error("Google Ads requires a developer token and OAuth access token");
    }

    const dateFrom = from.replace(/-/g, "");
    const dateTo   = to.replace(/-/g, "");

    const resp = await fetch(
      `https://googleads.googleapis.com/v17/customers/${this.cid}/googleAds:search`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          query: `SELECT metrics.cost_micros, campaign.id FROM campaign WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}' AND campaign.status != 'REMOVED'`,
        }),
      },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Google Ads spend summary error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    const results: any[] = data.results ?? [];
    const campaignIds = new Set(results.map((r: any) => r.campaign?.id));
    const totalSpend = results.reduce((s, r) => s + Number(r.metrics?.costMicros ?? 0) / 1_000_000, 0);

    return { totalSpend, campaigns: campaignIds.size };
  }

  async healthCheck(): Promise<boolean> {
    const { developerToken, accessToken } = this.config;
    if (!developerToken || !accessToken || !this.config.customerId) return false;
    try {
      const resp = await fetch(
        `https://googleads.googleapis.com/v17/customers/${this.cid}`,
        { headers: this.headers },
      );
      return resp.ok;
    } catch {
      return false;
    }
  }
}
