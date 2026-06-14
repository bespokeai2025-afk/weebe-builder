import type { AdProvider, AdCampaignStats } from "../interface";

const GRAPH_BASE = "https://graph.facebook.com/v19.0";

/**
 * Meta Marketing API v19 adapter.
 * Requires: accessToken (user/system), adAccountId.
 * Docs: https://developers.facebook.com/docs/marketing-api
 */
export class MetaAdsAdapter implements AdProvider {
  readonly name = "meta_ads";

  constructor(private readonly config: { accessToken: string; adAccountId: string }) {}

  private get adAccount(): string {
    const id = this.config.adAccountId;
    return id.startsWith("act_") ? id : `act_${id}`;
  }

  async getCampaigns(_accountId: string): Promise<AdCampaignStats[]> {
    const { accessToken } = this.config;
    if (!accessToken || !this.config.adAccountId) {
      throw new Error("Meta Ads requires an access token and ad account ID");
    }

    const fields = "id,name,status,impressions,clicks,spend,ctr,cpc,actions";
    const resp = await fetch(
      `${GRAPH_BASE}/${this.adAccount}/campaigns?fields=${fields}&access_token=${accessToken}&limit=50`,
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Meta Ads getCampaigns error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return (data.data ?? []).map((c: any) => {
      const conversions = (c.actions ?? [])
        .filter((a: any) => a.action_type === "offsite_conversion")
        .reduce((s: number, a: any) => s + Number(a.value ?? 0), 0);
      return {
        campaignId: String(c.id),
        name: c.name ?? "",
        status: c.status ?? "UNKNOWN",
        impressions: Number(c.impressions ?? 0),
        clicks: Number(c.clicks ?? 0),
        conversions,
        spend: Number(c.spend ?? 0),
        ctr: Number(c.ctr ?? 0),
        cpc: Number(c.cpc ?? 0),
      };
    });
  }

  async getSpendSummary(_accountId: string, from: string, to: string): Promise<{ totalSpend: number; campaigns: number }> {
    const { accessToken } = this.config;
    if (!accessToken || !this.config.adAccountId) {
      throw new Error("Meta Ads requires an access token and ad account ID");
    }

    const resp = await fetch(
      `${GRAPH_BASE}/${this.adAccount}/insights?fields=spend,campaign_id&time_range={"since":"${from}","until":"${to}"}&level=campaign&access_token=${accessToken}&limit=100`,
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Meta Ads spend summary error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    const rows: any[] = data.data ?? [];
    const campaignIds = new Set(rows.map((r: any) => r.campaign_id));
    const totalSpend = rows.reduce((s, r) => s + Number(r.spend ?? 0), 0);

    return { totalSpend, campaigns: campaignIds.size };
  }

  async healthCheck(): Promise<boolean> {
    const { accessToken } = this.config;
    if (!accessToken || !this.config.adAccountId) return false;
    try {
      const resp = await fetch(
        `${GRAPH_BASE}/me?fields=id,name&access_token=${accessToken}`,
      );
      return resp.ok;
    } catch {
      return false;
    }
  }
}
