// ── Meta Ads Sync Adapter ──────────────────────────────────────────────────────
// SERVER ONLY. Pulls campaign performance from the Meta Graph API and returns
// normalised AdCampaignMetrics[]. Reads credentials from workspace_settings
// (meta_ads_access_token + meta_ads_account_id).

const META_API_BASE = "https://graph.facebook.com/v19.0";

export interface AdCampaignMetrics {
  externalId:  string;
  name:        string;
  platform:    "meta" | "google";
  status:      string;
  spend:       number;
  impressions: number;
  clicks:      number;
  conversions: number;
  revenue:     number;
  roas:        number | null;
  cpl:         number | null;
  dateStart:   string;
  dateEnd:     string;
}

interface MetaInsightCampaign {
  campaign_id:   string;
  campaign_name: string;
  date_start:    string;
  date_stop:     string;
  spend:         string;
  impressions:   string;
  clicks:        string;
  actions?:      Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
}

function sumActions(
  actions: Array<{ action_type: string; value: string }> | undefined,
  types: string[],
): number {
  if (!actions) return 0;
  return actions
    .filter(a => types.includes(a.action_type))
    .reduce((sum, a) => sum + parseFloat(a.value || "0"), 0);
}

export async function syncMetaAdsCampaigns(
  accessToken: string,
  adAccountId: string,
): Promise<AdCampaignMetrics[]> {
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const fields = [
    "campaign_id", "campaign_name", "date_start", "date_stop",
    "spend", "impressions", "clicks", "actions", "action_values",
  ].join(",");

  const url = new URL(`${META_API_BASE}/${accountId}/insights`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("level",        "campaign");
  url.searchParams.set("date_preset",  "last_30_days");
  url.searchParams.set("fields",       fields);
  url.searchParams.set("limit",        "200");

  const results: AdCampaignMetrics[] = [];
  let nextUrl: string | null = url.toString();

  while (nextUrl) {
    const res  = await fetch(nextUrl);
    const json = await res.json() as any;

    if (json.error) {
      throw new Error(`Meta Ads API: ${json.error.message} (code ${json.error.code})`);
    }

    const rows: MetaInsightCampaign[] = json.data ?? [];

    for (const row of rows) {
      const spend       = parseFloat(row.spend       || "0");
      const impressions = parseInt(row.impressions   || "0", 10);
      const clicks      = parseInt(row.clicks        || "0", 10);

      const CONVERSION_TYPES = [
        "lead", "purchase", "complete_registration", "submit_application",
        "contact", "schedule", "start_trial", "subscribe",
      ];
      const conversions = Math.round(sumActions(row.actions, CONVERSION_TYPES));
      const revenue     = sumActions(row.action_values, ["purchase", "omni_purchase"]);

      const roas = spend > 0 && revenue > 0 ? +(revenue / spend).toFixed(3) : null;
      const cpl  = conversions > 0          ? +(spend / conversions).toFixed(2) : null;

      results.push({
        externalId:  row.campaign_id,
        name:        row.campaign_name,
        platform:    "meta",
        status:      "active",
        spend,
        impressions,
        clicks,
        conversions,
        revenue,
        roas,
        cpl,
        dateStart: row.date_start,
        dateEnd:   row.date_stop,
      });
    }

    nextUrl = json.paging?.next ?? null;
  }

  return results;
}
