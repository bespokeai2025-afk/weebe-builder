// ── Google Ads Sync Adapter ────────────────────────────────────────────────────
// SERVER ONLY. Pulls campaign performance via the Google Ads REST API (v17).
// Reads credentials from provider_settings (developerToken, customerId, accessToken).
// Returns normalised AdCampaignMetrics[].

import type { AdCampaignMetrics } from "./ads-sync-meta.server";

const GADS_API_BASE = "https://googleads.googleapis.com/v17";

interface GoogleAdsRow {
  campaign?: {
    id?:     string;
    name?:   string;
    status?: string;
  };
  metrics?: {
    costMicros?:    string;
    impressions?:   string;
    clicks?:        string;
    conversions?:   number;
    conversionsValue?: number;
  };
  segments?: {
    date?: string;
  };
}

function microsToAmount(micros: string | undefined): number {
  if (!micros) return 0;
  return parseFloat(micros) / 1_000_000;
}

async function getAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
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

export async function syncGoogleAdsCampaigns(credentials: {
  developerToken: string;
  customerId:     string;
  accessToken?:   string;
  refreshToken?:  string;
  clientId?:      string;
  clientSecret?:  string;
}): Promise<AdCampaignMetrics[]> {
  let token = credentials.accessToken ?? "";

  if (!token && credentials.refreshToken && credentials.clientId && credentials.clientSecret) {
    token = await getAccessToken(
      credentials.refreshToken,
      credentials.clientId,
      credentials.clientSecret,
    );
  }

  if (!token) throw new Error("Google Ads: no access token available");

  const customerId = credentials.customerId.replace(/-/g, "");

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      segments.date
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 500
  `.trim();

  const res = await fetch(`${GADS_API_BASE}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: {
      "Authorization":      `Bearer ${token}`,
      "developer-token":    credentials.developerToken,
      "Content-Type":       "application/json",
      "login-customer-id":  customerId,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Ads API ${res.status}: ${errText.slice(0, 300)}`);
  }

  // searchStream may return newline-delimited JSON objects OR a JSON array.
  // Try line-by-line (NDJSON) first; fall back to parsing full body as array.
  const text = await res.text();
  const rows: GoogleAdsRow[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "[" || trimmed === "]") continue;
    try {
      const parsed = JSON.parse(trimmed.replace(/,$/, "")) as any;
      if (parsed.results) rows.push(...(parsed.results as GoogleAdsRow[]));
      // Some API versions wrap results in response.results (non-stream endpoint)
      else if (parsed.response?.results) rows.push(...(parsed.response.results as GoogleAdsRow[]));
    } catch {}
  }

  // Fallback: if nothing extracted, try treating the whole response as a single JSON
  if (rows.length === 0) {
    try {
      const parsed = JSON.parse(text) as any;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.results) rows.push(...(item.results as GoogleAdsRow[]));
        }
      } else if (parsed?.results) {
        rows.push(...(parsed.results as GoogleAdsRow[]));
      }
    } catch {}
  }

  // Aggregate by campaign (rows may have one date per row)
  const byId = new Map<string, AdCampaignMetrics>();

  for (const row of rows) {
    const id   = row.campaign?.id ?? "unknown";
    const name = row.campaign?.name ?? id;

    const spend       = microsToAmount(row.metrics?.costMicros);
    const impressions = parseInt(row.metrics?.impressions ?? "0", 10);
    const clicks      = parseInt(row.metrics?.clicks ?? "0", 10);
    const conversions = row.metrics?.conversions ?? 0;
    const revenue     = row.metrics?.conversionsValue ?? 0;
    const date        = row.segments?.date ?? "";

    const existing = byId.get(id);
    if (existing) {
      existing.spend       += spend;
      existing.impressions += impressions;
      existing.clicks      += clicks;
      existing.conversions += conversions;
      existing.revenue     += revenue;
      if (date && date < existing.dateStart) existing.dateStart = date;
      if (date && date > existing.dateEnd)   existing.dateEnd   = date;
    } else {
      byId.set(id, {
        externalId:  id,
        name,
        platform:    "google",
        status:      (row.campaign?.status ?? "ENABLED").toLowerCase(),
        spend,
        impressions,
        clicks,
        conversions,
        revenue,
        roas:      null,
        cpl:       null,
        dateStart: date,
        dateEnd:   date,
      });
    }
  }

  return Array.from(byId.values()).map(c => ({
    ...c,
    roas: c.spend > 0 && c.revenue > 0 ? +(c.revenue / c.spend).toFixed(3) : null,
    cpl:  c.conversions > 0            ? +(c.spend / c.conversions).toFixed(2) : null,
  }));
}
