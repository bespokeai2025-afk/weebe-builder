/**
 * Conversion-priority scoring — PURE, shared.
 *
 * WEBEE's marketing optimisation priority order (fixed by product decision):
 *   1. qualified opportunities   (weight 5)
 *   2. booked demos              (weight 4)
 *   3. revenue                   (weight 3)
 *   4. cost per qualified opp    (weight 2.5, lower is better)
 *   5. cost per booking          (weight 2,   lower is better)
 *   6. conversion rate           (weight 1)
 *
 * Used by marketing objectives, the Daily Marketing Operator and the
 * Google Ads / SEO engines to rank opportunities by real business impact
 * instead of raw click metrics. Never invents data: metrics without inputs
 * are reported as unavailable and excluded from the score.
 */

export const CONVERSION_PRIORITY_ORDER = [
  "qualified_opportunities",
  "booked_demos",
  "revenue",
  "cost_per_qualified_opportunity",
  "cost_per_booking",
  "conversion_rate",
] as const;

export type ConversionPriorityMetric = (typeof CONVERSION_PRIORITY_ORDER)[number];

export const CONVERSION_PRIORITY_WEIGHTS: Record<ConversionPriorityMetric, number> = {
  qualified_opportunities: 5,
  booked_demos: 4,
  revenue: 3,
  cost_per_qualified_opportunity: 2.5,
  cost_per_booking: 2,
  conversion_rate: 1,
};

/** Metrics where a DECREASE is an improvement. */
const LOWER_IS_BETTER: ReadonlySet<ConversionPriorityMetric> = new Set([
  "cost_per_qualified_opportunity",
  "cost_per_booking",
]);

export const CONVERSION_PRIORITY_LABELS: Record<ConversionPriorityMetric, string> = {
  qualified_opportunities: "Qualified opportunities",
  booked_demos: "Booked demos",
  revenue: "Revenue",
  cost_per_qualified_opportunity: "Cost per qualified opportunity",
  cost_per_booking: "Cost per booking",
  conversion_rate: "Conversion rate",
};

export interface ConversionWindowStats {
  qualifiedOpportunities?: number | null;
  bookedDemos?: number | null;
  revenue?: number | null;      // currency units
  spend?: number | null;        // currency units
  conversions?: number | null;
  clicks?: number | null;
}

export interface ConversionMetricAssessment {
  metric: ConversionPriorityMetric;
  label: string;
  current: number | null;
  baseline: number | null;
  deltaPct: number | null;       // signed % change vs baseline (null when not computable)
  improved: boolean | null;      // direction-aware
  available: boolean;
  weight: number;
}

export interface ConversionPriorityAssessment {
  metrics: ConversionMetricAssessment[];
  /** Weighted, direction-aware score in roughly [-100, +100]. 0 = flat/no data. */
  score: number;
  /** Highest-priority metric that moved meaningfully (>=10%), or null. */
  topSignal: ConversionMetricAssessment | null;
  adequateData: boolean;
}

function derive(stats: ConversionWindowStats): Record<ConversionPriorityMetric, number | null> {
  const q = numOrNull(stats.qualifiedOpportunities);
  const b = numOrNull(stats.bookedDemos);
  const rev = numOrNull(stats.revenue);
  const spend = numOrNull(stats.spend);
  const conv = numOrNull(stats.conversions);
  const clicks = numOrNull(stats.clicks);
  return {
    qualified_opportunities: q,
    booked_demos: b,
    revenue: rev,
    cost_per_qualified_opportunity: spend != null && q != null && q > 0 ? spend / q : null,
    cost_per_booking: spend != null && b != null && b > 0 ? spend / b : null,
    conversion_rate: conv != null && clicks != null && clicks > 0 ? conv / clicks : null,
  };
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
}

/**
 * Compare a current window against a baseline window across the priority
 * metrics. Minimum-data rule: a metric only counts as available when BOTH
 * windows have a computable value, and volume-based metrics need
 * `minVolume` (default 3) combined events to avoid single-event noise.
 */
export function assessConversionPriority(
  current: ConversionWindowStats,
  baseline: ConversionWindowStats,
  opts: { minVolume?: number } = {},
): ConversionPriorityAssessment {
  const minVolume = Math.max(0, opts.minVolume ?? 3);
  const cur = derive(current);
  const base = derive(baseline);

  const metrics: ConversionMetricAssessment[] = CONVERSION_PRIORITY_ORDER.map((metric) => {
    const c = cur[metric];
    const b = base[metric];
    let available = c != null && b != null;
    // Volume floor for count metrics — a 0→1 jump is not a trend, and the
    // baseline window must independently have signal (≥1 event) so a burst
    // entirely inside the after-window can't masquerade as an improvement.
    if (available && (metric === "qualified_opportunities" || metric === "booked_demos")) {
      if ((c ?? 0) + (b ?? 0) < minVolume || (b ?? 0) < 1) available = false;
    }
    let deltaPct: number | null = null;
    let improved: boolean | null = null;
    if (available && b !== 0) {
      deltaPct = ((c! - b!) / Math.abs(b!)) * 100;
      improved = LOWER_IS_BETTER.has(metric) ? deltaPct < 0 : deltaPct > 0;
    } else if (available && b === 0 && c !== 0) {
      deltaPct = c! > 0 ? 100 : -100;
      improved = LOWER_IS_BETTER.has(metric) ? c! < 0 : c! > 0;
    }
    return {
      metric,
      label: CONVERSION_PRIORITY_LABELS[metric],
      current: c,
      baseline: b,
      deltaPct: deltaPct == null ? null : Math.round(deltaPct * 10) / 10,
      improved,
      available: available && deltaPct != null,
      weight: CONVERSION_PRIORITY_WEIGHTS[metric],
    };
  });

  const usable = metrics.filter((m) => m.available && m.deltaPct != null);
  let score = 0;
  if (usable.length) {
    const totalWeight = usable.reduce((s, m) => s + m.weight, 0);
    score = usable.reduce((s, m) => {
      const capped = Math.max(-100, Math.min(100, m.deltaPct!));
      const signed = LOWER_IS_BETTER.has(m.metric) ? -capped : capped;
      return s + (signed * m.weight) / totalWeight;
    }, 0);
    score = Math.round(score * 10) / 10;
  }

  const topSignal =
    usable
      .filter((m) => Math.abs(m.deltaPct!) >= 10)
      .sort((a, b) => b.weight - a.weight)[0] ?? null;

  return { metrics, score, topSignal, adequateData: usable.length > 0 };
}

/**
 * Rank arbitrary opportunity items by estimated qualified-opportunity impact.
 * Items declare which priority metric they primarily move and an estimated
 * relative impact (0..1); ranking = weight × impact × confidence.
 */
export interface RankableOpportunity {
  metric: ConversionPriorityMetric;
  estimatedImpact: number;   // 0..1
  confidence: number;        // 0..1
}

export function conversionPriorityRank(item: RankableOpportunity): number {
  const w = CONVERSION_PRIORITY_WEIGHTS[item.metric] ?? 1;
  const impact = Math.max(0, Math.min(1, Number(item.estimatedImpact) || 0));
  const conf = Math.max(0, Math.min(1, Number(item.confidence) || 0));
  return Math.round(w * impact * conf * 1000) / 1000;
}
