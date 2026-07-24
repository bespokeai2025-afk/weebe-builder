import type { AdProvider, AdCampaignStats } from "../interface";
import { GADS_BASE } from "../../../growthmind/gads-live-core.server";

/**
 * Google Ads API adapter (version from shared GADS_BASE config).
 * Auth priority: refreshToken + clientId + clientSecret → exchanged for accessToken.
 * Fallback: static accessToken (short-lived, manual entry).
 * Requires: developerToken, customerId, plus one of the above auth paths.
 */
export class GoogleAdsAdapter implements AdProvider {
  readonly name = "google_ads";

  constructor(private readonly config: {
    developerToken:  string;
    customerId:      string;
    accessToken?:    string;
    refreshToken?:   string;
    clientId?:       string;
    clientSecret?:   string;
    managerId?:      string;
  }) {}

  private get cid(): string {
    return this.config.customerId.replace(/-/g, "");
  }

  /** Exchange refresh token for a fresh access token. */
  private async getAccessTokenFromRefresh(): Promise<string> {
    const { refreshToken, clientId, clientSecret } = this.config;
    if (!refreshToken || !clientId || !clientSecret) {
      throw new Error("Google Ads: refreshToken, clientId, and clientSecret are all required for OAuth refresh flow");
    }
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
        client_id:     clientId,
        client_secret: clientSecret,
      }),
    });
    const json = await res.json() as any;
    if (json.error) throw new Error(`Google OAuth: ${json.error_description ?? json.error}`);
    return json.access_token as string;
  }

  /** Resolve a valid access token — refreshes automatically when refresh creds are present. */
  private async resolveToken(): Promise<string> {
    const { refreshToken, clientId, clientSecret, accessToken } = this.config;
    if (refreshToken && clientId && clientSecret) {
      return this.getAccessTokenFromRefresh();
    }
    if (accessToken) return accessToken;
    throw new Error("Google Ads: provide either (refreshToken + clientId + clientSecret) or a static accessToken");
  }

  private baseHeaders(token: string): Record<string, string> {
    const { developerToken, managerId, customerId } = this.config;
    const headers: Record<string, string> = {
      Authorization:    `Bearer ${token}`,
      "developer-token": developerToken,
      "Content-Type":   "application/json",
    };
    // When accessing via a manager (MCC) account, set login-customer-id to the manager ID
    const loginId = managerId ? managerId.replace(/-/g, "") : this.cid;
    headers["login-customer-id"] = loginId;
    return headers;
  }

  async getCampaigns(_accountId: string): Promise<AdCampaignStats[]> {
    const { developerToken } = this.config;
    if (!developerToken) throw new Error("Google Ads requires a developer token");

    const token = await this.resolveToken();

    const resp = await fetch(
      `${GADS_BASE}/customers/${this.cid}/googleAds:search`,
      {
        method: "POST",
        headers: this.baseHeaders(token),
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
      campaignId:  String(r.campaign?.id ?? ""),
      name:        r.campaign?.name ?? "",
      status:      r.campaign?.status ?? "UNKNOWN",
      impressions: Number(r.metrics?.impressions ?? 0),
      clicks:      Number(r.metrics?.clicks ?? 0),
      conversions: Number(r.metrics?.conversions ?? 0),
      spend:       Number(r.metrics?.costMicros ?? 0) / 1_000_000,
      ctr:         Number(r.metrics?.ctr ?? 0),
      cpc:         Number(r.metrics?.averageCpc ?? 0) / 1_000_000,
    }));
  }

  async getSpendSummary(_accountId: string, from: string, to: string): Promise<{ totalSpend: number; campaigns: number }> {
    const { developerToken } = this.config;
    if (!developerToken) throw new Error("Google Ads requires a developer token");

    const token    = await this.resolveToken();
    const dateFrom = from.replace(/-/g, "");
    const dateTo   = to.replace(/-/g, "");

    const resp = await fetch(
      `${GADS_BASE}/customers/${this.cid}/googleAds:search`,
      {
        method: "POST",
        headers: this.baseHeaders(token),
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
    const totalSpend  = results.reduce((s, r) => s + Number(r.metrics?.costMicros ?? 0) / 1_000_000, 0);

    return { totalSpend, campaigns: campaignIds.size };
  }

  async healthCheck(): Promise<boolean> {
    const { developerToken } = this.config;
    if (!developerToken) return false;
    try {
      const token = await this.resolveToken();
      // listAccessibleCustomers doesn't require a valid customer ID —
      // it's the canonical credentials liveness check.
      const resp = await fetch(
        `${GADS_BASE}/customers:listAccessibleCustomers`,
        { method: "GET", headers: this.baseHeaders(token) },
      );
      return resp.ok;
    } catch {
      return false;
    }
  }
}
