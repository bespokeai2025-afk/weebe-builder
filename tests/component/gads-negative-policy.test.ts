import { describe, it, expect } from "vitest";
import { evaluateWastedTerm, toFourWay, classifySearchTermFourWay, FOUR_WAY_META } from "@/lib/growthmind/gads-negative-policy.server";
import { mapGadsRecommendationToAction } from "@/lib/growthmind/gads-actions-bridge.server";

describe("four-way search-term classification policy", () => {
  it("maps converting terms to high_value_discovery (never excludable)", () => {
    expect(toFourWay("converting")).toBe("high_value_discovery");
    expect(FOUR_WAY_META.high_value_discovery.excludable).toBe(false);
  });

  it("maps high_cost_no_conversion to UNCERTAIN — cost alone never justifies exclusion", () => {
    expect(toFourWay("high_cost_no_conversion")).toBe("uncertain");
    expect(FOUR_WAY_META.uncertain.excludable).toBe(false);
  });

  it("only irrelevant is excludable", () => {
    const excludable = (Object.keys(FOUR_WAY_META) as Array<keyof typeof FOUR_WAY_META>)
      .filter((k) => FOUR_WAY_META[k].excludable);
    expect(excludable).toEqual(["irrelevant"]);
  });

  it("maps low_data to uncertain and relevant_no_conversion to relevant", () => {
    expect(toFourWay("low_data")).toBe("uncertain");
    expect(toFourWay("relevant_no_conversion")).toBe("relevant");
  });

  it("classifies intent-mismatch terms as irrelevant end-to-end", () => {
    const r = classifySearchTermFourWay(
      { searchTerm: "receptionist jobs near me", impressions: 100, clicks: 12, cost: 25, conversions: 0 }, []);
    expect(r.classification).toBe("irrelevant");
  });

  it("classifies expensive but plausible terms as uncertain, not irrelevant", () => {
    const r = classifySearchTermFourWay(
      { searchTerm: "ai phone answering service", impressions: 200, clicks: 30, cost: 60, conversions: 0 }, []);
    expect(r.classification).toBe("uncertain");
  });

  it("classifies converting terms as high_value_discovery", () => {
    const r = classifySearchTermFourWay(
      { searchTerm: "virtual receptionist pricing", impressions: 50, clicks: 8, cost: 20, conversions: 2 }, []);
    expect(r.classification).toBe("high_value_discovery");
  });
});

describe("recommendation → marketing action mapping", () => {
  const base = { id: "rec-1", account_row_id: "acc-1", customer_id: "1234567890", campaign_id: "111", title: "t", recommended_action: null as string | null, evidence: {} as Record<string, any> };

  it("wasted_spend with an IRRELEVANT term becomes an executable negative_keyword_add", () => {
    const m = mapGadsRecommendationToAction({ ...base, section: "wasted_spend",
      evidence: { searchTerm: "free receptionist template", cost30d: 40, clicks30d: 10, conversions30d: 0 } });
    expect("advisory" in m).toBe(false);
    if (!("advisory" in m)) {
      expect(m.action_type).toBe("negative_keyword_add");
      expect(m.proposed_value.negative_keyword).toBe("free receptionist template");
      expect(m.risk_level).toBe("low");
    }
  });

  it("wasted_spend with an UNCERTAIN (high-cost) term stays advisory — never auto-excluded", () => {
    const m = mapGadsRecommendationToAction({ ...base, section: "wasted_spend",
      evidence: { searchTerm: "answering service for clinics", cost30d: 80, clicks30d: 20, conversions30d: 0 } });
    expect("advisory" in m).toBe(true);
    if ("advisory" in m) expect(m.advisory).toContain("UNCERTAIN");
  });

  it("budget_opportunity maps to a +20% budget_change with existing value captured", () => {
    const m = mapGadsRecommendationToAction({ ...base, section: "budget_opportunity", evidence: { dailyBudget: 50, roas: 4 } });
    expect("advisory" in m).toBe(false);
    if (!("advisory" in m)) {
      expect(m.action_type).toBe("budget_change");
      expect(m.existing_value.daily_budget).toBe(50);
      expect(m.proposed_value.daily_budget).toBe(60);
    }
  });

  it("budget_opportunity without a known current budget is advisory", () => {
    const m = mapGadsRecommendationToAction({ ...base, section: "budget_opportunity", evidence: { roas: 4 } });
    expect("advisory" in m).toBe(true);
  });

  it("zero-conversion 'Pause …' recommendation maps to campaign_pause", () => {
    const m = mapGadsRecommendationToAction({ ...base, section: "immediate_attention",
      recommended_action: 'Pause or restructure "X"', evidence: { spend30d: 300, conversions30d: 0 } });
    expect("advisory" in m).toBe(false);
    if (!("advisory" in m)) expect(m.action_type).toBe("campaign_pause");
  });

  it("non-pause immediate_attention and unknown sections stay advisory", () => {
    const m1 = mapGadsRecommendationToAction({ ...base, section: "immediate_attention",
      recommended_action: "Check for disapproved ads", evidence: { conversions30d: 0 } });
    const m2 = mapGadsRecommendationToAction({ ...base, section: "conversion", evidence: {} });
    expect("advisory" in m1).toBe(true);
    expect("advisory" in m2).toBe(true);
  });
});

describe("evaluateWastedTerm (standard sync path)", () => {
  it("irrelevant high-cost term is the only recommended negative", () => {
    const r = evaluateWastedTerm({ searchTerm: "free download crack", impressions: 500, clicks: 40, cost: 55, conversions: 0 }, "Brand");
    expect(r.classification).toBe("irrelevant");
    expect(r.excludable).toBe(true);
    expect(r.decision).toBe("recommended_negative");
    expect(r.recommendedAction).toContain("negative keyword");
  });

  it("high-cost zero-conversion term without irrelevance signals is review-only, never a negative rec", () => {
    const r = evaluateWastedTerm({ searchTerm: "emergency boiler repair near me", impressions: 900, clicks: 60, cost: 80, conversions: 0 }, "Boilers");
    expect(r.excludable).toBe(false);
    expect(r.decision).toBe("not_recommended");
    expect(r.recommendedAction).toContain("do NOT exclude");
    expect(r.recommendedAction).not.toMatch(/^Add /);
  });
});
