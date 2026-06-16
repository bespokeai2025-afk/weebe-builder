// ── LinkedIn Ads sync adapter ─────────────────────────────────────────────────
// LinkedIn Marketing API v202401
// https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/

const LI_API_BASE = "https://api.linkedin.com/rest";
const LI_VERSION  = "202401";

interface LinkedInAdsCampaign {
  platform:    "linkedin";
  externalId:  string;
  name:        string;
  status:      "active" | "paused";
  spend:       number;
  impressions: number;
  clicks:      number;
  conversions: number;
  roas:        number | null;
  dateStart:   string;
  dateEnd:     string;
}

function last30Days(): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - 30);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { since: fmt(since), until: fmt(until) };
}

export async function syncLinkedInAdsCampaigns(
  accessToken: string,
  accountId:   string,
): Promise<LinkedInAdsCampaign[]> {
  const { since, until } = last30Days();
  const sponsoredAccountUrn = `urn:li:sponsoredAccount:${accountId}`;

  const campUrl =
    `${LI_API_BASE}/adCampaigns?q=search` +
    `&search.account.values[0]=${encodeURIComponent(sponsoredAccountUrn)}` +
    `&fields=id,name,status&count=100`;

  const campRes = await fetch(campUrl, {
    headers: {
      Authorization:                `Bearer ${accessToken}`,
      "LinkedIn-Version":           LI_VERSION,
      "X-Restli-Protocol-Version":  "2.0.0",
    },
  });
  if (!campRes.ok) {
    const err = await campRes.text();
    throw new Error(`LinkedIn Ads API ${campRes.status}: ${err.slice(0, 200)}`);
  }

  const campData = await campRes.json() as any;
  const campaigns: any[] = campData?.elements ?? [];

  const since_dt = new Date(since);
  const until_dt = new Date(until);
  const dateRangeParams =
    `dateRange.start.year=${since_dt.getFullYear()}&dateRange.start.month=${since_dt.getMonth() + 1}&dateRange.start.day=${since_dt.getDate()}` +
    `&dateRange.end.year=${until_dt.getFullYear()}&dateRange.end.month=${until_dt.getMonth() + 1}&dateRange.end.day=${until_dt.getDate()}`;

  const results: LinkedInAdsCampaign[] = [];

  for (const c of campaigns.slice(0, 50)) {
    const campId = String(c.id);
    let spend = 0, impressions = 0, clicks = 0, conversions = 0;

    try {
      const analyticsUrl =
        `${LI_API_BASE}/adAnalytics?q=analytics&pivot=CAMPAIGN` +
        `&${dateRangeParams}` +
        `&campaigns[0]=urn:li:sponsoredCampaign:${campId}` +
        `&fields=costInLocalCurrency,impressions,clicks,externalWebsiteConversions`;

      const aRes = await fetch(analyticsUrl, {
        headers: {
          Authorization:      `Bearer ${accessToken}`,
          "LinkedIn-Version": LI_VERSION,
        },
      });
      if (aRes.ok) {
        const aData = await aRes.json() as any;
        for (const e of (aData?.elements ?? [])) {
          spend       += Number(e.costInLocalCurrency ?? 0);
          impressions += Number(e.impressions ?? 0);
          clicks      += Number(e.clicks ?? 0);
          conversions += Number(e.externalWebsiteConversions ?? 0);
        }
      }
    } catch { /* skip analytics if individual campaign fails */ }

    results.push({
      platform:   "linkedin" as const,
      externalId: campId,
      name:       c.name ?? campId,
      status:     String(c.status ?? "ACTIVE").toUpperCase() === "ACTIVE" ? "active" : "paused",
      spend,
      impressions,
      clicks,
      conversions,
      roas:       null,
      dateStart:  since,
      dateEnd:    until,
    });
  }

  return results;
}
