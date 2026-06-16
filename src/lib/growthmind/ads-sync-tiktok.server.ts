// ── TikTok Ads sync adapter ───────────────────────────────────────────────────
// SERVER ONLY. Called from growthmind.ads-sync-tick.ts.
// TikTok Marketing API v1.3 — https://business-api.tiktok.com/open_api/v1.3

const TIKTOK_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";

interface TikTokAdsCampaign {
  platform:    "tiktok";
  name:        string;
  externalId:  string;
  status:      string;
  spend:       number;
  impressions: number;
  clicks:      number;
  conversions: number;
  revenue:     number;
  roas:        number | null;
  dateStart:   string | null;
  dateEnd:     string | null;
}

type TikTokReportRow = {
  dimensions: { campaign_id: string };
  metrics: {
    spend:                 string | number;
    impressions:           string | number;
    clicks:                string | number;
    conversions:           string | number;
    total_purchase_value?: string | number;
  };
};

export async function syncTikTokAdsCampaigns(
  accessToken:  string,
  advertiserId: string,
): Promise<TikTokAdsCampaign[]> {
  const authHeaders = {
    "Access-Token":  accessToken,
    "Content-Type":  "application/json",
  };

  // ── 1. Fetch campaign list ──────────────────────────────────────────────────
  const campParams = new URLSearchParams({
    advertiser_id: advertiserId,
    page_size:     "100",
    fields:        JSON.stringify(["campaign_id", "campaign_name", "status"]),
  });

  const campRes = await fetch(
    `${TIKTOK_API_BASE}/campaign/get/?${campParams}`,
    { headers: authHeaders },
  );
  if (!campRes.ok) {
    throw new Error(`TikTok campaigns API responded ${campRes.status} ${campRes.statusText}`);
  }
  const campData = await campRes.json();
  if (campData?.code !== 0) {
    throw new Error(`TikTok API error ${campData?.code}: ${campData?.message ?? "unknown"}`);
  }

  const campaigns: Array<{ campaign_id: string; campaign_name: string; status: string }> =
    campData?.data?.list ?? [];

  if (campaigns.length === 0) return [];

  // ── 2. Fetch 30-day performance report ─────────────────────────────────────
  const now       = new Date();
  const endDate   = now.toISOString().slice(0, 10);
  const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const reportParams = new URLSearchParams({
    advertiser_id: advertiserId,
    report_type:   "BASIC",
    data_level:    "AUCTION_CAMPAIGN",
    dimensions:    JSON.stringify(["campaign_id"]),
    metrics:       JSON.stringify([
      "spend", "impressions", "clicks", "conversions", "total_purchase_value",
    ]),
    start_date: startDate,
    end_date:   endDate,
    page_size:  "100",
  });

  const reportRes = await fetch(
    `${TIKTOK_API_BASE}/report/integrated/get/?${reportParams}`,
    { headers: authHeaders },
  );
  if (!reportRes.ok) {
    throw new Error(`TikTok report API responded ${reportRes.status} ${reportRes.statusText}`);
  }
  const reportData = await reportRes.json();

  const reportRows: TikTokReportRow[] = reportData?.data?.list ?? [];

  // Build stats map keyed by campaign_id
  const statsMap = new Map<string, {
    spend: number; impressions: number; clicks: number;
    conversions: number; revenue: number;
  }>();

  for (const row of reportRows) {
    const cid = row.dimensions.campaign_id;
    const m   = row.metrics;
    statsMap.set(cid, {
      spend:       Number(m.spend                 ?? 0),
      impressions: Number(m.impressions           ?? 0),
      clicks:      Number(m.clicks               ?? 0),
      conversions: Number(m.conversions           ?? 0),
      revenue:     Number(m.total_purchase_value  ?? 0),
    });
  }

  // ── 3. Merge and return ─────────────────────────────────────────────────────
  return campaigns.map((c) => {
    const stats = statsMap.get(c.campaign_id) ?? {
      spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0,
    };
    const roas = stats.spend > 0 && stats.revenue > 0
      ? +(stats.revenue / stats.spend).toFixed(3)
      : null;

    return {
      platform:    "tiktok" as const,
      name:        c.campaign_name,
      externalId:  c.campaign_id,
      status:      c.status?.toLowerCase() ?? "unknown",
      spend:       stats.spend,
      impressions: stats.impressions,
      clicks:      stats.clicks,
      conversions: stats.conversions,
      revenue:     stats.revenue,
      roas,
      dateStart:   startDate,
      dateEnd:     endDate,
    };
  });
}
