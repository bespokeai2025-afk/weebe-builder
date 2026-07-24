/**
 * HiveMind Executive OS — deterministic reasoning core (Stage 2).
 *
 * Pure functions only: multi-factor priority scoring, evidence packages,
 * the recommendation quality gate (validate + cap), baseline/anomaly maths
 * and the cross-department correlation rule set. No IO, no AI — everything
 * here is unit-testable and runs BEFORE any model is asked to phrase output.
 *
 * INVARIANTS:
 *   • The AI interprets evidence — it never invents it. Every draft produced
 *     here already carries its numeric evidence and freshness stamps.
 *   • Routine noise can never score critical: the critical band requires an
 *     explicit critical-class factor (security/compliance/major revenue).
 *   • Vague advice is rejected, mirroring the proven GrowthMind
 *     validateRecDraft gate.
 */

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export const EXEC_REC_STATES = [
  "new", "acknowledged", "under_review", "approved", "rejected",
  "assigned", "in_progress", "waiting", "completed", "failed",
  "dismissed", "expired", "reopened",
] as const;
export type ExecRecState = (typeof EXEC_REC_STATES)[number];

/** States considered "open" for dedup purposes — a new draft with the same
 * dedupe_key must not be created while one of these exists. */
export const OPEN_REC_STATES: ExecRecState[] = [
  "new", "acknowledged", "under_review", "approved",
  "assigned", "in_progress", "waiting", "reopened",
];

export type ExecPriority = "critical" | "high" | "medium" | "low";
export type ExecDepartment =
  | "growth" | "system" | "accounts" | "crm" | "operations" | "cross_department";

// ── Priority scoring ──────────────────────────────────────────────────────────

/** Multi-factor inputs, each 0..1 (0 = none, 1 = maximal). Omitted = 0. */
export interface PriorityFactors {
  revenueImpact?: number;
  costImpact?: number;
  profitImpact?: number;
  customerImpact?: number;
  pipelineImpact?: number;
  operationalImpact?: number;
  securityImpact?: number;
  complianceImpact?: number;
  urgency?: number;
  confidence?: number;         // low confidence dampens the score
  reversibility?: number;      // 1 = fully reversible (dampens), 0 = irreversible
  affectedUsers?: number;      // normalised 0..1
  timeWaiting?: number;        // 0..1 (e.g. days waiting / 14, capped)
  strategicImportance?: number;
  riskOfInaction?: number;
  humanEffort?: number;        // 1 = huge effort required (dampens slightly)
}

const FACTOR_WEIGHTS: Array<[keyof PriorityFactors, number]> = [
  ["revenueImpact",       0.16],
  ["costImpact",          0.10],
  ["profitImpact",        0.10],
  ["customerImpact",      0.12],
  ["pipelineImpact",      0.10],
  ["operationalImpact",   0.08],
  ["securityImpact",      0.12],
  ["complianceImpact",    0.08],
  ["urgency",             0.10],
  ["affectedUsers",       0.04],
  ["timeWaiting",         0.04],
  ["strategicImportance", 0.04],
  ["riskOfInaction",      0.06],
];

const clamp01 = (v: unknown): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
};

export interface PriorityScore {
  score: number;        // 0..100
  priority: ExecPriority;
  criticalEligible: boolean;
}

/**
 * Deterministic multi-factor priority. Weighted sum (0..100), dampened by low
 * confidence, high reversibility and high required effort. The CRITICAL band
 * is gated: a score alone is never enough — at least one critical-class
 * factor (security, compliance, or severe revenue/customer impact) must be
 * strongly present, so routine noise can never classify as critical.
 */
export function computePriorityScore(f: PriorityFactors): PriorityScore {
  let raw = 0;
  for (const [key, w] of FACTOR_WEIGHTS) raw += clamp01(f[key]) * w;

  const confidence = f.confidence === undefined ? 0.6 : clamp01(f.confidence);
  // Confidence dampens up to 40%; reversibility and effort up to 10% each.
  let score = raw * (0.6 + 0.4 * confidence);
  score *= 1 - 0.10 * clamp01(f.reversibility);
  score *= 1 - 0.10 * clamp01(f.humanEffort);
  score = Math.round(score * 1000) / 10; // 0..100, 1dp

  const criticalEligible =
    clamp01(f.securityImpact) >= 0.7 ||
    clamp01(f.complianceImpact) >= 0.7 ||
    clamp01(f.revenueImpact) >= 0.8 ||
    clamp01(f.customerImpact) >= 0.8;

  let priority: ExecPriority;
  if (score >= 55 && criticalEligible) priority = "critical";
  else if (score >= 40) priority = "high";
  else if (score >= 18) priority = "medium";
  else priority = "low";

  return { score, priority, criticalEligible };
}

// ── Baseline / anomaly maths ──────────────────────────────────────────────────

export interface BaselineComparison {
  current: number;
  baseline: number;
  deltaPct: number | null;   // null when baseline is 0 (no meaningful %)
  direction: "up" | "down" | "flat";
  anomalous: boolean;        // |deltaPct| >= threshold with a material baseline
}

/** Compare a current-window metric against a prior-window baseline. */
export function compareToBaseline(
  current: number,
  baseline: number,
  opts?: { anomalyPct?: number; minBaseline?: number },
): BaselineComparison {
  const anomalyPct  = opts?.anomalyPct ?? 30;
  const minBaseline = opts?.minBaseline ?? 5;
  const deltaPct = baseline > 0
    ? Math.round(((current - baseline) / baseline) * 1000) / 10
    : null;
  const direction: BaselineComparison["direction"] =
    deltaPct === null ? (current > 0 ? "up" : "flat")
    : deltaPct > 5 ? "up" : deltaPct < -5 ? "down" : "flat";
  const anomalous =
    deltaPct !== null && baseline >= minBaseline && Math.abs(deltaPct) >= anomalyPct;
  return { current, baseline, deltaPct, direction, anomalous };
}

/** Days an obligation has been waiting, capped/normalised for scoring. */
export function timeWaitingFactor(sinceIso: string | null | undefined, capDays = 14): number {
  if (!sinceIso) return 0;
  const days = (Date.now() - new Date(sinceIso).getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.min(days / capDays, 1);
}

// ── Evidence packages ─────────────────────────────────────────────────────────

export interface EvidenceSourceFreshness {
  source: string;
  status: string;               // healthy | stale | degraded | disconnected | empty
  lastActivityAt: string | null;
}

export interface EvidencePackage {
  builtAt: string;
  workspaceId: string;
  /** Numeric facts — the ONLY thing AI may cite; ≥2 required to pass the gate. */
  metrics: Record<string, number>;
  /** Non-numeric supporting facts (names, statuses, ids). */
  facts: Record<string, unknown>;
  relatedEntities: Array<{ type: string; id: string; name?: string }>;
  sourceSystems: string[];
  freshness: EvidenceSourceFreshness[];
  /** True when any contributing source is stale/degraded/disconnected. */
  degradedInputs: boolean;
}

export function buildEvidencePackage(input: {
  workspaceId: string;
  metrics: Record<string, number>;
  facts?: Record<string, unknown>;
  relatedEntities?: Array<{ type: string; id: string; name?: string }>;
  sourceSystems: string[];
  freshness: EvidenceSourceFreshness[];
}): EvidencePackage {
  const metrics: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.metrics)) {
    if (typeof v === "number" && Number.isFinite(v)) metrics[k] = v;
  }
  const relevant = input.freshness.filter((f) =>
    input.sourceSystems.some((s) => f.source === s || s.startsWith(f.source)),
  );
  const degraded = relevant.some((f) =>
    ["stale", "degraded", "disconnected"].includes(f.status),
  );
  return {
    builtAt: new Date().toISOString(),
    workspaceId: input.workspaceId,
    metrics,
    facts: input.facts ?? {},
    relatedEntities: (input.relatedEntities ?? []).slice(0, 25),
    sourceSystems: input.sourceSystems,
    freshness: relevant.length ? relevant : input.freshness,
    degradedInputs: degraded,
  };
}

/** Stale/degraded inputs reduce confidence deterministically (spec: "Stale
 * sources reduce confidence"). */
export function adjustConfidenceForFreshness(
  confidence: number,
  pkg: Pick<EvidencePackage, "degradedInputs" | "freshness">,
): number {
  let c = clamp01(confidence);
  if (pkg.degradedInputs) c *= 0.7;
  const disconnected = pkg.freshness.some((f) => f.status === "disconnected");
  if (disconnected) c *= 0.8;
  return Math.max(0.05, Math.round(c * 1000) / 1000);
}

// ── Recommendation drafts + quality gate ──────────────────────────────────────

export interface ExecRecDraft {
  title: string;
  department: ExecDepartment;
  priority: ExecPriority;
  business_issue: string;
  evidence: EvidencePackage;
  commercial_impact: string | null;
  risk_of_inaction: string | null;
  recommended_action: string;
  next_step: string | null;
  suggested_owner: string | null;
  due_date: string | null;
  approval_required: boolean;
  confidence: number;
  correlation_key: string | null;
  dedupe_key: string;
  reassess_at: string | null;
  source_event_ids: string[];
}

/** Vague executive advice that must never be stored (spec list + GrowthMind list). */
export const EXEC_VAGUE_PHRASES = [
  "follow up with your leads", "improve performance", "check your emails",
  "review your calendar", "optimise the system", "optimize the system",
  "speak to the client", "monitor the campaign", "improve targeting",
  "optimise your campaign", "optimize your campaign", "monitor performance",
  "increase engagement", "improve your processes", "review your pipeline",
];

/**
 * Quality gate mirroring GrowthMind's validateRecDraft: required fields,
 * bounded confidence, ≥2 numeric evidence metrics, a specific action (length
 * + not a bare vague phrase), and a specific business issue.
 */
export function validateExecRecDraft(r: ExecRecDraft): boolean {
  if (!r.title || !r.recommended_action || !r.dedupe_key || !r.business_issue) return false;
  if (typeof r.confidence !== "number" || !Number.isFinite(r.confidence)) return false;
  if (r.confidence <= 0 || r.confidence > 1) return false;
  const numericMetrics = Object.values(r.evidence?.metrics ?? {}).filter(
    (v) => typeof v === "number" && Number.isFinite(v),
  );
  if (numericMetrics.length < 2) return false;
  if (!r.evidence?.sourceSystems?.length) return false;
  const action = r.recommended_action.trim().toLowerCase();
  if (action.length < 30) return false;
  if (EXEC_VAGUE_PHRASES.some((p) => action === p || action === `${p}.`)) return false;
  if (r.business_issue.trim().length < 20) return false;
  return true;
}

/** Volume caps: max 3 critical, 5 high, 12 total per run. */
export function capExecRecDrafts(recs: ExecRecDraft[]): ExecRecDraft[] {
  const order: Record<ExecPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...recs].sort(
    (a, b) => order[a.priority] - order[b.priority] || b.confidence - a.confidence,
  );
  const out: ExecRecDraft[] = [];
  let crit = 0, high = 0;
  for (const r of sorted) {
    if (out.length >= 12) break;
    if (r.priority === "critical") { if (crit >= 3) continue; crit++; }
    if (r.priority === "high")     { if (high >= 5) continue; high++; }
    out.push(r);
  }
  return out;
}

// ── Cross-department correlation rules ────────────────────────────────────────
//
// Deterministic rules join signals across Minds into executive conclusions
// BEFORE any AI phrasing. Each rule only fires when its numeric preconditions
// hold, and its output already carries the metrics that prove it.

export interface DepartmentSignals {
  growth?: {
    leadVolumeCurrent?: number;
    leadVolumeBaseline?: number;
    qualifiedRateCurrentPct?: number;    // 0..100
    qualifiedRateBaselinePct?: number;
    costPerQualifiedCurrent?: number;
    costPerQualifiedBaseline?: number;
    activeCampaigns?: number;
  };
  crm?: {
    qualifiedLeadsNoBooking?: number;
    qualifiedNoBookingValue?: number | null;
    staleLeads?: number;
    oldestStaleSinceIso?: string | null;
  };
  system?: {
    failedIntegrations?: Array<{ id: string; name: string }>;
    failedWorkflows?: Array<{ id: string; name: string; failures: number }>;
    bookingIntegrationDown?: boolean;
  };
  accounts?: {
    usagePctOfLimit?: number | null;     // 0..100
    renewalInDays?: number | null;
    openComplaints?: number;
  };
}

export interface ExecConclusion {
  ruleKey: string;
  department: ExecDepartment;
  title: string;
  business_issue: string;
  recommended_action: string;
  next_step: string;
  risk_of_inaction: string;
  commercial_impact: string | null;
  metrics: Record<string, number>;
  relatedEntities: Array<{ type: string; id: string; name?: string }>;
  sourceSystems: string[];
  factors: PriorityFactors;
  correlation_key: string;
}

export function runCorrelationRules(s: DepartmentSignals): ExecConclusion[] {
  const out: ExecConclusion[] = [];
  const g = s.growth ?? {};
  const c = s.crm ?? {};
  const sys = s.system ?? {};
  const a = s.accounts ?? {};

  // Rule 1 — volume up but commercial performance deteriorated: do NOT scale spend.
  const vol = compareToBaseline(g.leadVolumeCurrent ?? 0, g.leadVolumeBaseline ?? 0, { anomalyPct: 20 });
  const qualDown =
    g.qualifiedRateCurrentPct !== undefined &&
    g.qualifiedRateBaselinePct !== undefined &&
    g.qualifiedRateBaselinePct > 0 &&
    g.qualifiedRateCurrentPct < g.qualifiedRateBaselinePct * 0.7;
  const cpqUp =
    g.costPerQualifiedCurrent !== undefined &&
    g.costPerQualifiedBaseline !== undefined &&
    g.costPerQualifiedBaseline > 0 &&
    g.costPerQualifiedCurrent > g.costPerQualifiedBaseline * 1.3;
  if (vol.direction === "up" && vol.anomalous && qualDown && cpqUp) {
    out.push({
      ruleKey: "volume_up_quality_down",
      department: "cross_department",
      title: "Lead volume is up but lead quality and cost efficiency have deteriorated",
      business_issue:
        `Lead volume rose ${vol.deltaPct}% while the qualified-lead rate fell from ` +
        `${g.qualifiedRateBaselinePct}% to ${g.qualifiedRateCurrentPct}% and cost per qualified lead ` +
        `rose from ${g.costPerQualifiedBaseline} to ${g.costPerQualifiedCurrent}.`,
      recommended_action:
        "Do not increase campaign budget. Review targeting, search terms and lead-quality filters on the campaigns driving the extra volume before any spend change.",
      next_step: "Open GrowthMind campaign analysis and compare search terms for the last two windows.",
      risk_of_inaction: "Budget scales into low-quality volume, raising acquisition cost without adding pipeline.",
      commercial_impact: `Cost per qualified lead up ${Math.round(((g.costPerQualifiedCurrent! - g.costPerQualifiedBaseline!) / g.costPerQualifiedBaseline!) * 100)}%`,
      metrics: {
        leadVolumeCurrent: vol.current, leadVolumeBaseline: vol.baseline,
        qualifiedRateCurrentPct: g.qualifiedRateCurrentPct!, qualifiedRateBaselinePct: g.qualifiedRateBaselinePct!,
        costPerQualifiedCurrent: g.costPerQualifiedCurrent!, costPerQualifiedBaseline: g.costPerQualifiedBaseline!,
      },
      relatedEntities: [],
      sourceSystems: ["campaigns", "leads"],
      factors: { revenueImpact: 0.5, costImpact: 0.7, pipelineImpact: 0.6, urgency: 0.6, confidence: 0.8, riskOfInaction: 0.7 },
      correlation_key: "xdept:volume_up_quality_down",
    });
  }

  // Rule 2 — booking/integration failure while qualified leads have no appointment.
  const noBooking = c.qualifiedLeadsNoBooking ?? 0;
  const failedIntegrations = sys.failedIntegrations ?? [];
  if ((sys.bookingIntegrationDown || failedIntegrations.length > 0) && noBooking >= 3) {
    const failing = failedIntegrations[0];
    out.push({
      ruleKey: "integration_down_unbooked_leads",
      department: "cross_department",
      title: "Revenue-impacting technical incident: integration failure while qualified leads sit unbooked",
      business_issue:
        `${noBooking} qualified leads have no appointment while ` +
        (sys.bookingIntegrationDown
          ? "the booking integration is failing."
          : `${failedIntegrations.length} integration(s) are failing health checks (${failedIntegrations.map((f) => f.name).join(", ").slice(0, 200)}).`),
      recommended_action:
        "Escalate the integration repair as revenue-impacting, create a manual booking task for the affected qualified leads and notify the sales owner today.",
      next_step: "Open SystemMind integration health and re-run the failing connection check.",
      risk_of_inaction: "Qualified pipeline goes cold while the technical fault persists — direct revenue loss.",
      commercial_impact: c.qualifiedNoBookingValue
        ? `Estimated pipeline at risk: ${c.qualifiedNoBookingValue}` : null,
      metrics: {
        qualifiedLeadsNoBooking: noBooking,
        failedIntegrationCount: failedIntegrations.length + (sys.bookingIntegrationDown ? 1 : 0),
        ...(typeof c.qualifiedNoBookingValue === "number" ? { pipelineValueAtRisk: c.qualifiedNoBookingValue } : {}),
      },
      relatedEntities: failing ? [{ type: "provider", id: failing.id, name: failing.name }] : [],
      sourceSystems: ["providers", "leads", "calendar"],
      factors: { revenueImpact: 0.85, customerImpact: 0.6, operationalImpact: 0.7, urgency: 0.85, confidence: 0.85, riskOfInaction: 0.8 },
      correlation_key: "xdept:integration_down_unbooked_leads",
    });
  }

  // Rule 3 — usage approaching package limit while activity/results are strong.
  const usagePct = a.usagePctOfLimit ?? null;
  if (usagePct !== null && usagePct >= 80 && (g.activeCampaigns ?? 0) > 0 && vol.direction !== "down") {
    out.push({
      ruleKey: "usage_near_cap_strong_results",
      department: "cross_department",
      title: "Usage approaching package limit while campaign activity is growing",
      business_issue:
        `Workspace usage is at ${Math.round(usagePct)}% of its package limit while ` +
        `${g.activeCampaigns} campaign(s) are active and lead volume is ${vol.direction === "up" ? "rising" : "steady"}.`,
      recommended_action:
        "Create an upsell/upgrade conversation before usage is interrupted: propose the next package tier with current usage figures attached.",
      next_step: "Open AccountsMind usage view and prepare the upgrade comparison.",
      risk_of_inaction: "Service interruption at the usage cap during a period of strong results.",
      commercial_impact: "Upsell opportunity; avoided interruption of active campaigns.",
      metrics: { usagePctOfLimit: Math.round(usagePct), activeCampaigns: g.activeCampaigns ?? 0, leadVolumeCurrent: vol.current },
      relatedEntities: [],
      sourceSystems: ["billing", "campaigns"],
      factors: { revenueImpact: 0.5, customerImpact: 0.5, urgency: 0.5, confidence: 0.75, strategicImportance: 0.6, riskOfInaction: 0.5 },
      correlation_key: "xdept:usage_near_cap",
    });
  }

  // Rule 4 — complaint + repeated workflow failure + imminent renewal = retention risk.
  const failedWfs = sys.failedWorkflows ?? [];
  const repeatFailure = failedWfs.find((w) => w.failures >= 3);
  const renewalSoon = a.renewalInDays !== null && a.renewalInDays !== undefined && a.renewalInDays <= 14;
  if ((a.openComplaints ?? 0) > 0 && repeatFailure && renewalSoon) {
    out.push({
      ruleKey: "retention_risk_complaint_failures_renewal",
      department: "cross_department",
      title: "Critical retention risk: complaint + repeated workflow failures + renewal within 14 days",
      business_issue:
        `${a.openComplaints} open complaint(s), workflow "${repeatFailure.name}" has failed ` +
        `${repeatFailure.failures} times, and the account renews in ${a.renewalInDays} day(s).`,
      recommended_action:
        "Assign an owner immediately, prioritise the failing workflow repair above routine work, and prepare an executive response to the complaint before the renewal date.",
      next_step: "Assign the repair task and schedule the executive response today.",
      risk_of_inaction: "High probability of non-renewal — direct recurring-revenue loss.",
      commercial_impact: "Renewal at risk within 14 days.",
      metrics: {
        openComplaints: a.openComplaints ?? 0,
        workflowFailures: repeatFailure.failures,
        renewalInDays: a.renewalInDays!,
      },
      relatedEntities: [{ type: "workflow", id: repeatFailure.id, name: repeatFailure.name }],
      sourceSystems: ["workflows", "email", "billing"],
      factors: { revenueImpact: 0.85, customerImpact: 0.9, urgency: 0.9, confidence: 0.85, riskOfInaction: 0.9 },
      correlation_key: "xdept:retention_risk",
    });
  }

  return out;
}
