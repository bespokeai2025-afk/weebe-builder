/**
 * Negative-keyword policy: four-way search-term classification + the
 * permanent Negative Keyword Decision Log.
 *
 * Policy (non-negotiable):
 *  - RELEVANT             → never excluded.
 *  - IRRELEVANT           → the ONLY class that may become a recommended negative.
 *  - UNCERTAIN            → never auto-excluded; needs human review with evidence.
 *  - HIGH_VALUE_DISCOVERY → converting terms; candidates to ADD as keywords, never exclude.
 *
 * Every term CONSIDERED for exclusion gets an append-only decision-log row,
 * whatever the outcome — the log is the permanent record of why terms were
 * or were not excluded.
 */
import { classifySearchTerm, type SearchTermClass } from "./gads-deep-analysis.server";

export type FourWayClass = "relevant" | "irrelevant" | "uncertain" | "high_value_discovery";

export const FOUR_WAY_META: Record<FourWayClass, { label: string; excludable: boolean }> = {
  relevant:             { label: "Relevant",             excludable: false },
  irrelevant:           { label: "Irrelevant",           excludable: true },
  uncertain:            { label: "Uncertain",            excludable: false },
  high_value_discovery: { label: "High-value discovery", excludable: false },
};

/** Map the internal 5-way classifier onto the four-way policy classes. */
export function toFourWay(cls: SearchTermClass): FourWayClass {
  switch (cls) {
    case "converting":              return "high_value_discovery";
    case "irrelevant":              return "irrelevant";
    // High cost with no conversions is a COST signal, not an intent signal —
    // it must be reviewed by a human, never auto-excluded.
    case "high_cost_no_conversion": return "uncertain";
    case "low_data":                return "uncertain";
    case "relevant_no_conversion":  return "relevant";
    default:                        return "uncertain"; // fail closed
  }
}

export function classifySearchTermFourWay(
  t: { searchTerm: string; impressions: number | null; clicks: number | null; cost: number | null; conversions: number | null },
  businessTerms: string[],
): { classification: FourWayClass; reason: string } {
  const base = classifySearchTerm(t, businessTerms);
  return { classification: toFourWay(base.classification), reason: base.reason };
}

/**
 * Evaluate a wasted-spend search term for the standard recommendation path.
 * Returns the four-way classification, whether a negative may be RECOMMENDED
 * (irrelevant only), the honest recommended-action wording, and the decision
 * to record in the permanent log.
 */
export function evaluateWastedTerm(
  t: { searchTerm: string; impressions: number | null; clicks: number | null; cost: number | null; conversions: number | null },
  campaignName: string,
): { classification: FourWayClass; reason: string; excludable: boolean; recommendedAction: string; decision: "recommended_negative" | "not_recommended" } {
  const cls = classifySearchTermFourWay(t, []);
  const excludable = FOUR_WAY_META[cls.classification].excludable;
  return {
    ...cls,
    excludable,
    recommendedAction: excludable
      ? `Add "${t.searchTerm}" as a negative keyword in "${campaignName}".`
      : `Review "${t.searchTerm}" (classified ${FOUR_WAY_META[cls.classification].label.toUpperCase()}) — do NOT exclude without human review. ${cls.reason}`,
    decision: excludable ? "recommended_negative" : "not_recommended",
  };
}

export interface NegativeDecisionLogEntry {
  workspace_id: string;
  account_row_id?: string | null;
  customer_id?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  search_term: string;
  match_type?: string | null;
  classification: FourWayClass;
  decision: "recommended_negative" | "not_recommended" | "approved" | "declined" | "applied" | "apply_failed";
  reason?: string | null;
  evidence?: Record<string, any>;
  decided_by?: string | null;
  marketing_action_id?: string | null;
  recommendation_id?: string | null;
}

/**
 * Append rows to the permanent decision log. Best-effort but LOUD: failures
 * are logged and returned, never swallowed silently into fake success.
 */
export async function recordNegativeDecisions(sbAdmin: any, entries: NegativeDecisionLogEntry[]): Promise<{ ok: boolean; error?: string }> {
  if (!entries.length) return { ok: true };
  const rows = entries.map((e) => ({
    workspace_id: e.workspace_id,
    account_row_id: e.account_row_id ?? null,
    customer_id: e.customer_id ?? null,
    campaign_id: e.campaign_id != null ? String(e.campaign_id) : null,
    campaign_name: e.campaign_name ?? null,
    search_term: e.search_term,
    match_type: e.match_type ?? null,
    classification: e.classification,
    decision: e.decision,
    reason: e.reason ?? null,
    evidence: e.evidence ?? {},
    decided_by: e.decided_by ?? null,
    marketing_action_id: e.marketing_action_id ?? null,
    recommendation_id: e.recommendation_id ?? null,
  }));
  const { error } = await sbAdmin.from("growthmind_gads_negative_decision_log").insert(rows);
  if (error) {
    console.error("[gads-negative-policy] decision log insert failed:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
