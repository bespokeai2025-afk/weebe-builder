// ── Validated Business Briefing — pure, client-safe core ─────────────────────
// Shared schema + deterministic math/validation/formatting for HiveMind's
// daily briefing pipeline. Everything here is pure (no DB, no fetch) so the
// server pipeline and the regression tests share the exact same definitions.
//
// Pipeline contract (see validated-briefing.server.ts):
//   gather → normalize → validate → verified KPIs → rank → recommendations
//   → ONE ValidatedBusinessBriefing object → voice + screen outputs.

// ── Metric provenance ─────────────────────────────────────────────────────────

export type MetricUnit = "count" | "percent" | "gbp" | "usd" | "minutes" | "seconds";

/** A KPI that passed validation. Every percentage carries its full provenance. */
export interface VerifiedMetric {
  key: string;
  label: string;
  value: number;
  unit: MetricUnit;
  /** Present for every rate/percentage metric. */
  numerator?: number;
  denominator?: number;
  /** Human-readable formula, e.g. "connected ÷ total calls × 100". */
  formula: string;
  /** Data source, e.g. "wbah_calls (Supabase)" or "calls table". */
  source: string;
  /** Time range the figure covers, e.g. "today (Europe/London)" or "last 30 days". */
  timeRange: string;
  note?: string;
}

/** A metric we could NOT confirm — never rendered as a fabricated zero. */
export interface UnverifiedMetric {
  key: string;
  label: string;
  reason: string;
  source: string;
}

export type WarningSeverity = "info" | "warning" | "critical";

export interface DataWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
}

export interface RecommendedBriefingAction {
  id: string;
  title: string;
  issue: string;
  action: string;
  expectedOutcome: string;
  approvalRequired: boolean;
  department: "HiveMind" | "GrowthMind" | "SystemMind" | "AccountsMind";
  successCheck: string;
}

export interface CommercialRisk {
  rank: number;
  title: string;
  detail: string;
}

export interface SourceFreshness {
  source: string;
  status: string;
  lastActivityAt: string | null;
}

export interface ValidatedBusinessBriefing {
  workspaceId: string;
  generatedAt: string;
  reportingPeriod: { label: string; from: string; to: string; timezone: string };
  dataSources: string[];
  sourceFreshness: SourceFreshness[];
  verifiedMetrics: VerifiedMetric[];
  unverifiedMetrics: UnverifiedMetric[];
  dataWarnings: DataWarning[];
  positiveOutcomes: string[];
  commercialRisks: CommercialRisk[];
  recommendedActions: RecommendedBriefingAction[];
  voiceSummary: string;
  screenSummary: string;
}

// ── Math ──────────────────────────────────────────────────────────────────────

/**
 * Percentage to ONE decimal place, or null when the denominator is not a
 * positive number (a rate with no denominator is meaningless, never 0%).
 * 159/380 → 41.8.
 */
export function ratePct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Build a verified rate metric with full provenance, or null when undefined. */
export function rateMetric(args: {
  key: string;
  label: string;
  numerator: number;
  denominator: number;
  formula: string;
  source: string;
  timeRange: string;
  note?: string;
}): VerifiedMetric | null {
  const pct = ratePct(args.numerator, args.denominator);
  if (pct === null) return null;
  return {
    key: args.key,
    label: args.label,
    value: pct,
    unit: "percent",
    numerator: args.numerator,
    denominator: args.denominator,
    formula: args.formula,
    source: args.source,
    timeRange: args.timeRange,
    note: args.note,
  };
}

export function countMetric(args: {
  key: string; label: string; value: number; source: string; timeRange: string; note?: string; unit?: MetricUnit;
}): VerifiedMetric {
  return {
    key: args.key,
    label: args.label,
    value: args.value,
    unit: args.unit ?? "count",
    formula: "direct count",
    source: args.source,
    timeRange: args.timeRange,
    note: args.note,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Cross-check a claimed percentage against its underlying numbers.
 * Returns a warning when the claim differs by more than 0.5 points.
 */
export function checkRateClaim(
  claimedPct: number,
  numerator: number,
  denominator: number,
  label: string,
): DataWarning | null {
  const actual = ratePct(numerator, denominator);
  if (actual === null) {
    return {
      code: "rate_no_denominator",
      severity: "warning",
      message: `${label}: a rate of ${claimedPct}% was claimed but the denominator is zero or unknown, so the figure cannot be verified.`,
    };
  }
  if (Math.abs(actual - claimedPct) > 0.5) {
    return {
      code: "rate_mismatch",
      severity: "critical",
      message: `${label}: the displayed ${claimedPct}% does not match the underlying numbers (${numerator} ÷ ${denominator} = ${actual}%). Using the recalculated figure.`,
    };
  }
  return null;
}

/**
 * Validate a call-outcome breakdown for overlaps and unaccounted records.
 * Mirrors the spec example: if connected + voicemail already account for all
 * calls but failures are also reported, flag the overlap instead of adding.
 */
export function validateCallBreakdown(args: {
  total: number;
  connected: number;
  voicemail: number;
  failed: number;
  source: string;
}): DataWarning[] {
  const { total, connected, voicemail, failed, source } = args;
  const warnings: DataWarning[] = [];
  const accounted = connected + voicemail;
  if (accounted > total) {
    warnings.push({
      code: "call_categories_exceed_total",
      severity: "critical",
      message: `Connected (${connected}) plus voicemail (${voicemail}) exceeds the total of ${total} calls in ${source} — the categories overlap or the total is wrong. Treating the total as authoritative.`,
    });
  } else if (accounted === total && failed > 0) {
    warnings.push({
      code: "call_failed_overlap",
      severity: "warning",
      message: `There appears to be a reporting mismatch: connected calls and voicemails already account for all ${total} calls, while ${source} also reports ${failed} failed calls. Failed attempts are likely counted inside those categories rather than separately — not adding them together.`,
    });
  } else if (accounted + failed < total) {
    const unclassified = total - accounted - failed;
    warnings.push({
      code: "call_unclassified",
      severity: "info",
      message: `${unclassified} of ${total} calls in ${source} have no outcome classification (not connected, voicemail or failed).`,
    });
  }
  return warnings;
}

/** Sentiment totals must identify unclassified records rather than hide them. */
export function sentimentUnknownCount(args: {
  total: number; positive: number; neutral: number; negative: number;
}): number {
  return Math.max(0, args.total - args.positive - args.neutral - args.negative);
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/** "a", "a and b", "a, b and c" */
export function joinNatural(items: string[]): string {
  const xs = items.filter(Boolean);
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0];
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Strip any markdown that might have crept into voice text. */
export function stripMarkdownForVoice(text: string): string {
  return text
    .replace(/[*_`#>|]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Voice output ──────────────────────────────────────────────────────────────

export interface VoiceFacts {
  /** One-sentence overall assessment, e.g. "Today was busy, but results were weaker than the activity suggests." */
  assessment: string;
  /** Short spoken-friendly phrases; at most 2 are used. */
  wentWell: string[];
  /** Short spoken-friendly phrases; at most 2 are used. */
  underperformed: string[];
  /** Data-quality issues; at most 2 are used. */
  dataWarnings: string[];
  /** Recommended action titles; at most 3 are used. */
  topActions: string[];
  closingQuestion: string;
}

/**
 * Deterministic natural-language voice briefing:
 * assessment → what worked → what didn't → data warnings → top actions →
 * one closing question. No markdown, no long lists, ~80–160 words.
 */
export function buildVoiceSummary(f: VoiceFacts): string {
  const parts: string[] = [];
  parts.push(f.assessment);

  const good = f.wentWell.filter(Boolean).slice(0, 2);
  if (good.length) parts.push(`The encouraging part is that ${joinNatural(good)}.`);

  const bad = f.underperformed.filter(Boolean).slice(0, 2);
  if (bad.length) parts.push(`The main concern is that ${joinNatural(bad)}.`);

  const warns = f.dataWarnings.filter(Boolean).slice(0, 2);
  if (warns.length) parts.push(`There's also a data issue I don't fully trust yet: ${joinNatural(warns)}.`);

  const actions = f.topActions.filter(Boolean).slice(0, 3);
  if (actions.length === 1) parts.push(`My recommendation is to ${lowerFirst(actions[0])}.`);
  else if (actions.length > 1) {
    parts.push(`The first action I'd take is to ${lowerFirst(actions[0])}. After that, ${joinNatural(actions.slice(1).map(lowerFirst))}.`);
  }

  parts.push(f.closingQuestion);

  let text = stripMarkdownForVoice(parts.join(" "));

  // Hard budget: keep the spoken briefing comfortably under ~160 words by
  // trimming whole sentences from the middle (never the assessment or the
  // closing question).
  const MAX_WORDS = 160;
  if (countWords(text) > MAX_WORDS) {
    const sentences = text.split(/(?<=[.?!])\s+/);
    while (sentences.length > 3 && countWords(sentences.join(" ")) > MAX_WORDS) {
      sentences.splice(sentences.length - 2, 1);
    }
    text = sentences.join(" ");
  }
  return text;
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// ── Screen output ─────────────────────────────────────────────────────────────

export function formatMetricValue(m: VerifiedMetric): string {
  switch (m.unit) {
    case "percent": return `${m.value}%`;
    case "gbp":     return `£${m.value.toLocaleString()}`;
    case "usd":     return `$${m.value.toLocaleString()}`;
    case "minutes": return `${m.value.toLocaleString()} min`;
    case "seconds": return `${m.value.toLocaleString()}s`;
    default:        return m.value.toLocaleString();
  }
}

/** Provenance line rendered next to every KPI so it is traceable. */
export function metricProvenance(m: VerifiedMetric): string {
  const frac = m.numerator !== undefined && m.denominator !== undefined
    ? ` (${m.numerator} ÷ ${m.denominator})`
    : "";
  return `${m.formula}${frac} — ${m.source}, ${m.timeRange}`;
}

/**
 * Screen briefing markdown built from the SAME validated object as the voice
 * output: executive summary, verified KPIs with provenance, warnings, key
 * findings and recommended actions.
 */
export function buildScreenSummary(b: Omit<ValidatedBusinessBriefing, "voiceSummary" | "screenSummary">, opts?: { greeting?: string }): string {
  const lines: string[] = [];
  if (opts?.greeting) lines.push(`${opts.greeting}. Here's your validated briefing for ${b.reportingPeriod.label}:`, "");

  if (b.verifiedMetrics.length) {
    lines.push("**Verified KPIs**");
    for (const m of b.verifiedMetrics) {
      lines.push(`• **${m.label}: ${formatMetricValue(m)}** — ${metricProvenance(m)}${m.note ? ` · ${m.note}` : ""}`);
    }
    lines.push("");
  }

  if (b.unverifiedMetrics.length) {
    lines.push("**Not confirmed** (no figure shown — these are unavailable, not zero)");
    for (const u of b.unverifiedMetrics) lines.push(`• ${u.label} — ${u.reason}`);
    lines.push("");
  }

  if (b.dataWarnings.length) {
    lines.push("**Data-quality warnings**");
    for (const w of b.dataWarnings) lines.push(`• ${w.severity === "critical" ? "⚠️ " : w.severity === "warning" ? "⚠ " : ""}${w.message}`);
    lines.push("");
  }

  if (b.positiveOutcomes.length) {
    lines.push("**What performed well**");
    for (const p of b.positiveOutcomes) lines.push(`• ${p}`);
    lines.push("");
  }

  if (b.commercialRisks.length) {
    lines.push("**What needs attention**");
    for (const r of [...b.commercialRisks].sort((a, c) => a.rank - c.rank)) lines.push(`• ${r.title} — ${r.detail}`);
    lines.push("");
  }

  if (b.recommendedActions.length) {
    lines.push("**Recommended actions**");
    b.recommendedActions.forEach((a, i) => {
      lines.push(`${i + 1}. **${a.title}** — ${a.action} Expected outcome: ${a.expectedOutcome} (${a.department}${a.approvalRequired ? ", needs your approval" : ""}). Success check: ${a.successCheck}`);
    });
    lines.push("");
  }

  lines.push(`_Sources: ${b.dataSources.join(", ")} · generated ${new Date(b.generatedAt).toLocaleString("en-GB")}_`);
  return lines.join("\n");
}
