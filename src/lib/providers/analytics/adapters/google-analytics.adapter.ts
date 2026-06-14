import type { AnalyticsProvider, AnalyticsReport } from "../interface";

// TODO: implement — connect to Google Analytics 4 Data API
// Docs: https://developers.google.com/analytics/devguides/reporting/data/v1
export class GoogleAnalyticsAdapter implements AnalyticsProvider {
  readonly name = "google_analytics";

  constructor(private readonly _config: { propertyId: string; accessToken: string }) {}

  async getReport(_params: { from: string; to: string; metrics: string[] }): Promise<AnalyticsReport> {
    throw new Error("Google Analytics provider not yet implemented.");
  }

  async getRealtimeUsers(): Promise<number> {
    throw new Error("Google Analytics provider not yet implemented.");
  }
}
