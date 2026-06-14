import type { AnalyticsProvider, AnalyticsReport, AnalyticsMetric } from "../interface";

/**
 * Google Analytics 4 Data API adapter.
 * Uses OAuth access token; property ID from config.
 * Docs: https://developers.google.com/analytics/devguides/reporting/data/v1
 */
export class GoogleAnalyticsAdapter implements AnalyticsProvider {
  readonly name = "google_analytics";

  constructor(private readonly config: { propertyId: string; accessToken: string }) {}

  async getReport(params: { from: string; to: string; metrics: string[] }): Promise<AnalyticsReport> {
    const { propertyId, accessToken } = this.config;
    if (!propertyId || !accessToken) {
      throw new Error("Google Analytics requires a property ID and OAuth access token");
    }

    const resp = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: params.from, endDate: params.to }],
          metrics: params.metrics.map(m => ({ name: m })),
          dimensions: [{ name: "date" }],
          limit: 100,
        }),
      },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Google Analytics API error ${resp.status}: ${text}`);
    }

    const data = await resp.json();

    const metricHeaders: string[] = (data.metricHeaders ?? []).map((h: any) => h.name);
    const totals = data.totals?.[0]?.metricValues ?? [];

    const metrics: AnalyticsMetric[] = metricHeaders.map((name, i) => ({
      name,
      value: Number(totals[i]?.value ?? 0),
    }));

    return {
      dateRange: { from: params.from, to: params.to },
      metrics,
      dimensions: (data.rows ?? []).slice(0, 30).map((row: any) => ({
        name: "date",
        value: row.dimensionValues?.[0]?.value ?? "",
        count: Number(row.metricValues?.[0]?.value ?? 0),
      })),
    };
  }

  async getRealtimeUsers(): Promise<number> {
    const { propertyId, accessToken } = this.config;
    if (!propertyId || !accessToken) return 0;

    try {
      const resp = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runRealtimeReport`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            metrics: [{ name: "activeUsers" }],
          }),
        },
      );
      if (!resp.ok) return 0;
      const data = await resp.json();
      return Number(data.totals?.[0]?.metricValues?.[0]?.value ?? 0);
    } catch {
      return 0;
    }
  }

  async healthCheck(): Promise<boolean> {
    const { propertyId, accessToken } = this.config;
    if (!propertyId || !accessToken) return false;
    try {
      const resp = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}/metadata`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return resp.ok;
    } catch {
      return false;
    }
  }
}
