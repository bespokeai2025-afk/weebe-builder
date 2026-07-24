import { describe, it, expect } from "vitest";
import { validateRecDraft, capRecDrafts, attributePaidLeadsToCampaigns, type RecDraft } from "../../src/lib/growthmind/gads-live-core.server";

function draft(over: Partial<RecDraft> = {}): RecDraft {
  return {
    section: "wasted_spend",
    priority: "high",
    confidence: 0.8,
    title: 'Campaign "Brand" spent £120 with zero conversions',
    campaign_id: "123",
    campaign_name: "Brand",
    evidence: { spend30d: 120, clicks30d: 300, conversions30d: 0 },
    expected_benefit: "Recover £120/month in wasted spend",
    recommended_action: 'Pause the "generic terms" ad group in "Brand" — 300 clicks and £120 spend produced zero conversions in 30 days.',
    dedupe_key: "gads:111:123:zero_conv",
    ...over,
  };
}

describe("validateRecDraft", () => {
  it("accepts a specific, evidence-backed recommendation", () => {
    expect(validateRecDraft(draft())).toBe(true);
  });

  it("rejects missing campaign for non-account-level checks", () => {
    expect(validateRecDraft(draft({ campaign_id: null }))).toBe(false);
  });

  it("accepts account-level checks without a campaign", () => {
    expect(validateRecDraft(draft({ campaign_id: null, dedupe_key: "gads:111:acct:tracking_zero" }))).toBe(true);
  });

  it("rejects fewer than 2 numeric evidence metrics", () => {
    expect(validateRecDraft(draft({ evidence: { spend30d: 120 } }))).toBe(false);
    expect(validateRecDraft(draft({ evidence: {} }))).toBe(false);
    expect(validateRecDraft(draft({ evidence: { a: "x", b: "y" } }))).toBe(false);
  });

  it("rejects vague or too-short actions", () => {
    expect(validateRecDraft(draft({ recommended_action: "Improve targeting" }))).toBe(false);
    expect(validateRecDraft(draft({ recommended_action: "Monitor performance." }))).toBe(false);
    expect(validateRecDraft(draft({ recommended_action: "Fix it now" }))).toBe(false);
  });

  it("rejects invalid confidence", () => {
    expect(validateRecDraft(draft({ confidence: 0 }))).toBe(false);
    expect(validateRecDraft(draft({ confidence: 1.5 }))).toBe(false);
    expect(validateRecDraft(draft({ confidence: NaN as any }))).toBe(false);
  });

  it("rejects missing title/action/dedupe_key", () => {
    expect(validateRecDraft(draft({ title: "" }))).toBe(false);
    expect(validateRecDraft(draft({ dedupe_key: "" }))).toBe(false);
  });
});

describe("capRecDrafts", () => {
  it("caps critical at 3, high at 5, total at 10", () => {
    const recs: RecDraft[] = [
      ...Array.from({ length: 5 }, (_, i) => draft({ priority: "critical", dedupe_key: `c${i}` })),
      ...Array.from({ length: 8 }, (_, i) => draft({ priority: "high", dedupe_key: `h${i}` })),
      ...Array.from({ length: 8 }, (_, i) => draft({ priority: "medium", dedupe_key: `m${i}` })),
    ];
    const out = capRecDrafts(recs);
    expect(out.length).toBe(10);
    expect(out.filter(r => r.priority === "critical").length).toBe(3);
    expect(out.filter(r => r.priority === "high").length).toBe(5);
    expect(out.filter(r => r.priority === "medium").length).toBe(2);
  });

  it("prefers higher priority then higher confidence", () => {
    const out = capRecDrafts([
      draft({ priority: "medium", confidence: 0.9, dedupe_key: "m1" }),
      draft({ priority: "critical", confidence: 0.5, dedupe_key: "c1" }),
      draft({ priority: "high", confidence: 0.6, dedupe_key: "h1" }),
      draft({ priority: "high", confidence: 0.9, dedupe_key: "h2" }),
    ]);
    expect(out.map(r => r.dedupe_key)).toEqual(["c1", "h2", "h1", "m1"]);
  });

  it("returns everything when under the caps", () => {
    const out = capRecDrafts([draft({ dedupe_key: "a" }), draft({ priority: "low", dedupe_key: "b" })]);
    expect(out.length).toBe(2);
  });
});

describe("attributePaidLeadsToCampaigns", () => {
  const campaigns = [
    { id: "c1", name: "Brand Search UK" },
    { id: "c2", name: "Generic Search" },
    { id: "c3", name: "Brand Search US" },
  ];

  it("assigns exact normalized matches", () => {
    const out = attributePaidLeadsToCampaigns(
      [{ id: "l1", utm_campaign: "brand-search-uk" }, { id: "l2", utm_campaign: "Generic Search" }],
      campaigns,
    );
    expect(out.get("c1")?.map((l: any) => l.id)).toEqual(["l1"]);
    expect(out.get("c2")?.map((l: any) => l.id)).toEqual(["l2"]);
  });

  it("assigns each lead to at most one campaign", () => {
    const out = attributePaidLeadsToCampaigns([{ id: "l1", utm_campaign: "brand-search-uk" }], campaigns);
    let total = 0;
    for (const leads of out.values()) total += leads.length;
    expect(total).toBe(1);
  });

  it("drops ambiguous containment matches (matches multiple campaigns)", () => {
    // "brand search" is contained in both "Brand Search UK" and "Brand Search US"
    const out = attributePaidLeadsToCampaigns([{ id: "l1", utm_campaign: "brand search" }], campaigns);
    expect([...out.values()].flat().length).toBe(0);
  });

  it("accepts unambiguous containment matches", () => {
    const out = attributePaidLeadsToCampaigns([{ id: "l1", utm_campaign: "generic" }], campaigns);
    expect(out.get("c2")?.length).toBe(1);
  });

  it("ignores too-short / empty utm_campaign values", () => {
    const out = attributePaidLeadsToCampaigns(
      [{ id: "l1", utm_campaign: "uk" }, { id: "l2", utm_campaign: "" }, { id: "l3", utm_campaign: null }],
      campaigns,
    );
    expect([...out.values()].flat().length).toBe(0);
  });

  it("skips exact matches when two campaigns share the same normalized name", () => {
    const dup = [{ id: "a", name: "Promo" }, { id: "b", name: "PROMO" }];
    const out = attributePaidLeadsToCampaigns([{ id: "l1", utm_campaign: "promo" }], dup);
    expect([...out.values()].flat().length).toBe(0);
  });
});
