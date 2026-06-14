export interface AnalyticsMetric {
  name: string;
  value: number;
  unit?: string;
  change?: number;
  changePercent?: number;
}

export interface AnalyticsReport {
  dateRange: { from: string; to: string };
  metrics: AnalyticsMetric[];
  dimensions?: Array<{ name: string; value: string; count: number }>;
}

export interface AnalyticsProvider {
  readonly name: string;
  getReport(params: { from: string; to: string; metrics: string[] }): Promise<AnalyticsReport>;
  getRealtimeUsers?(): Promise<number>;
}
