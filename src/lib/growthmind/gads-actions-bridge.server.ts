/**
 * Bridge: approved Google Ads recommendations / change requests → the
 * Marketing Action Engine (which owns guardrails, approvals, execution,
 * verification and rollback via the google_ads executor).
 *
 * Honesty rules:
 *  - A change request is "executed" ONLY when the engine confirms the write.
 *  - Recommendations without a deterministic, executable mapping stay
 *    advisory: the change request is created with status "draft" and an
 *    explicit status_detail saying a human must make the change manually.
 *  - Negative-keyword recs are gated by the four-way classification: only
 *    IRRELEVANT terms become executable actions; everything else stays
 *    review-only and is recorded in the permanent decision log either way.
 */
import {
  createMarketingAction,
  submitMarketingActionForExecution,
  type CreateMarketingActionInput,
  type SubmitResult,
} from "@/lib/marketing/action-engine.server";
import { classifySearchTermFourWay, recordNegativeDecisions } from "./gads-negative-policy.server";

export interface GadsRecLike {
  id: string;
  account_row_id: string | null;
  customer_id: string | null;
  campaign_id: string | null;
  section: string;
  title: string | null;
  recommended_action: string | null;
  evidence: Record<string, any> | null;
}

export interface BridgeOutcome {
  /** null when the recommendation has no executable mapping (advisory-only). */
  marketingActionId: string | null;
  submit: SubmitResult | null;
  /** honest change-request status derived from the engine outcome. */
  changeRequestStatus: "submitted" | "executed" | "failed" | "draft";
  detail: string;
}

/** Deterministic mapping of a recommendation to an executable engine action. */
export function mapGadsRecommendationToAction(rec: GadsRecLike): CreateMarketingActionInput | { advisory: string } {
  const ev = rec.evidence ?? {};
  const target = {
    customer_id: rec.customer_id,
    campaign_id: rec.campaign_id,
    campaign_name: (ev as any).campaignName ?? null,
  };
  const base = {
    source: "gads_recommendation",
    platform: "google_ads",
    objective: rec.title ?? rec.recommended_action ?? null,
    evidence: { recommendation_id: rec.id, section: rec.section, ...ev },
  };

  // Negative keyword (wasted spend on a search term)
  if (rec.section === "wasted_spend" && typeof ev.searchTerm === "string" && ev.searchTerm.trim() && rec.campaign_id) {
    const cls = classifySearchTermFourWay({
      searchTerm: ev.searchTerm,
      impressions: ev.impressions30d ?? null,
      clicks: ev.clicks30d ?? null,
      cost: ev.cost30d ?? null,
      conversions: ev.conversions30d ?? 0,
    }, []);
    if (cls.classification !== "irrelevant") {
      return { advisory: `Search term "${ev.searchTerm}" classified ${cls.classification.toUpperCase()} — policy allows negatives only for IRRELEVANT terms. Review manually. (${cls.reason})` };
    }
    return {
      ...base,
      action_type: "negative_keyword_add",
      target,
      existing_value: { negative_keyword_present: false },
      proposed_value: { negative_keyword: ev.searchTerm, match_type: "EXACT" },
      expected_impact: rec.title ?? null,
      risk_level: "low",
    };
  }

  // Budget increase for strong performers (scale_roas / budget_limited)
  if (rec.section === "budget_opportunity" && rec.campaign_id) {
    const daily = Number(ev.dailyBudget);
    if (Number.isFinite(daily) && daily > 0) {
      const proposed = Math.round(daily * 1.2 * 100) / 100; // the ~20% step the rec describes
      return {
        ...base,
        action_type: "budget_change",
        target,
        existing_value: { daily_budget: daily },
        proposed_value: { daily_budget: proposed },
        expected_impact: rec.title ?? null,
        risk_level: "medium",
      };
    }
    return { advisory: "Budget recommendation has no current daily budget in evidence — set the new budget manually." };
  }

  // Pause an unconverting campaign (zero-conversion immediate attention)
  if (rec.section === "immediate_attention" && rec.campaign_id
      && Number(ev.conversions30d ?? -1) === 0
      && /^pause\b/i.test(String(rec.recommended_action ?? ""))) {
    return {
      ...base,
      action_type: "campaign_pause",
      target,
      existing_value: { status: "ENABLED" },
      proposed_value: { status: "PAUSED" },
      expected_impact: rec.title ?? null,
      risk_level: "medium",
    };
  }

  return { advisory: "This recommendation is advisory — no safe deterministic API change maps to it. Apply it manually in Google Ads." };
}

/**
 * Route an approved recommendation into the engine and keep the linked
 * change-request row honest. Never throws for engine refusals — the refusal
 * IS the honest outcome.
 */
export async function routeGadsRecommendationToEngine(
  sbAdmin: any,
  workspaceId: string,
  rec: GadsRecLike,
  opts: { changeRequestId: string | null; userId: string | null; objectiveId?: string | null },
): Promise<BridgeOutcome> {
  const mapped = mapGadsRecommendationToAction(rec);
  const now = new Date().toISOString();
  const updateCr = async (status: string, detail: string, marketingActionId?: string | null) => {
    if (!opts.changeRequestId) return;
    await sbAdmin.from("growthmind_gads_change_requests").update({
      status, status_detail: detail,
      ...(marketingActionId !== undefined ? { marketing_action_id: marketingActionId } : {}),
      ...(status === "executed" ? { executed_at: now } : {}),
    }).eq("id", opts.changeRequestId).eq("workspace_id", workspaceId);
  };

  if ("advisory" in mapped) {
    await updateCr("draft", mapped.advisory, null);
    // Record blocked negative attempts in the permanent decision log.
    const ev = rec.evidence ?? {};
    if (rec.section === "wasted_spend" && typeof (ev as any).searchTerm === "string") {
      const cls = classifySearchTermFourWay({
        searchTerm: (ev as any).searchTerm, impressions: (ev as any).impressions30d ?? null,
        clicks: (ev as any).clicks30d ?? null, cost: (ev as any).cost30d ?? null, conversions: (ev as any).conversions30d ?? 0,
      }, []);
      await recordNegativeDecisions(sbAdmin, [{
        workspace_id: workspaceId, account_row_id: rec.account_row_id, customer_id: rec.customer_id,
        campaign_id: rec.campaign_id, search_term: (ev as any).searchTerm, classification: cls.classification,
        decision: "declined", reason: mapped.advisory, decided_by: opts.userId, recommendation_id: rec.id,
        evidence: { source: "recommendation_approval", ...ev },
      }]);
    }
    return { marketingActionId: null, submit: null, changeRequestStatus: "draft", detail: mapped.advisory };
  }

  // New work-order-driven recommendations carry their exact objective through
  // the approval payload. Rows approved directly from the recommendations UI
  // predate that chain, so preserve the old fail-closed single-active-objective
  // fallback for those legacy rows only.
  let objectiveId = opts.objectiveId ?? null;
  if (!objectiveId) {
    const { data: objectives, error: objectiveError } = await sbAdmin.from("marketing_objectives")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .eq("metric_source", "google_ads")
      .limit(2);
    if (!objectiveError && objectives?.length === 1) objectiveId = objectives[0].id;
  }

  const action = await createMarketingAction(sbAdmin, workspaceId, {
    ...mapped,
    requested_by: opts.userId,
    objective_id: objectiveId,
  });
  const submit = await submitMarketingActionForExecution(sbAdmin, workspaceId, action.id);

  const crStatus: BridgeOutcome["changeRequestStatus"] =
    submit.outcome === "executed" || submit.outcome === "executed_unverified" ? "executed"
    : submit.outcome === "failed" ? "failed"
    : submit.outcome === "awaiting_approval" ? "submitted" // engine owns it from here
    // not_allowed = the engine refused to queue anything (e.g. autonomy is
    // observe/recommend). Nothing is pending — the change stays a manual draft.
    : "draft";
  await updateCr(crStatus, submit.detail, action.id);

  // Log approved negative decisions permanently.
  if (mapped.action_type === "negative_keyword_add") {
    const applied = submit.outcome === "executed" || submit.outcome === "executed_unverified";
    await recordNegativeDecisions(sbAdmin, [{
      workspace_id: workspaceId, account_row_id: rec.account_row_id, customer_id: rec.customer_id,
      campaign_id: rec.campaign_id, search_term: String((mapped.proposed_value as any).negative_keyword),
      match_type: String((mapped.proposed_value as any).match_type ?? "EXACT"),
      classification: "irrelevant",
      decision: applied ? "applied" : submit.outcome === "failed" ? "apply_failed" : "approved",
      reason: submit.detail, decided_by: opts.userId, marketing_action_id: action.id, recommendation_id: rec.id,
      evidence: { source: "recommendation_approval", ...(rec.evidence ?? {}) },
    }]);
  }

  return { marketingActionId: action.id, submit, changeRequestStatus: crStatus, detail: submit.detail };
}
