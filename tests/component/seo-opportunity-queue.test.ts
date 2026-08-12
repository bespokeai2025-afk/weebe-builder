/**
 * SEO Opportunity Queue — detection, scoring and dedupe contracts.
 */
import { describe, it, expect, vi } from "vitest";
import {
  aggregatePerf,
  detectQueueOpportunities,
  scoreOpportunity,
  dedupeKeyFor,
  EXECUTION_EFFORT,
  type PerfRow,
  type Agg,
} from "@/lib/growthmind/seo-opportunity-core";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/marketing/action-engine.server", () => ({
  registerMarketingExecutor: vi.fn(),
}));

function rows(key: string, spec: Array<{ date: string; clicks: number; impressions: number; position: number | null }>): PerfRow[] {
  return spec.map((s) => ({ dim_key: key, ...s }));
}

function agg(partial: Partial<Agg> & { key: string }): Agg {
  return {
    clicks: 0, impressions: 0, ctr: 0, position: null, trend: "stable",
    firstHalf: { impressions: 0, clicks: 0 }, secondHalf: { impressions: 0, clicks: 0 },
    ...partial,
  };
}

const empty = { queries: [] as Agg[], pages: [] as Agg[], sitemaps: [{ path: "https://x.com/sitemap.xml" }], inspections: [], siteUrl: "https://x.com" };

describe("aggregatePerf", () => {
  it("aggregates clicks/impressions and computes impression-weighted position", () => {
    const out = aggregatePerf(rows("q", [
      { date: "2026-01-01", clicks: 1, impressions: 100, position: 10 },
      { date: "2026-02-01", clicks: 3, impressions: 300, position: 6 },
    ]));
    expect(out).toHaveLength(1);
    expect(out[0].clicks).toBe(4);
    expect(out[0].impressions).toBe(400);
    expect(out[0].position).toBeCloseTo((10 * 100 + 6 * 300) / 400);
    expect(out[0].ctr).toBeCloseTo(0.01);
  });
  it("flags declining trend when second half drops >25%", () => {
    const out = aggregatePerf(rows("q", [
      { date: "2026-01-01", clicks: 0, impressions: 200, position: 8 },
      { date: "2026-03-01", clicks: 0, impressions: 50, position: 8 },
    ]));
    expect(out[0].trend).toBe("declining");
  });
});

describe("detectQueueOpportunities", () => {
  it("high impressions + almost no clicks in top 10 → metadata change", () => {
    const ops = detectQueueOpportunities({ ...empty, queries: [agg({ key: "buy widgets", impressions: 500, clicks: 1, ctr: 0.002, position: 6 })] });
    const hit = ops.find((o) => o.kind === "high_impression_low_ctr");
    expect(hit).toBeTruthy();
    expect(hit!.recommendedExecution).toBe("metadata_change");
    expect(hit!.confidence).toBe("high");
  });
  it("position 11-20 with impressions → near_page_one via internal links", () => {
    const ops = detectQueueOpportunities({ ...empty, queries: [agg({ key: "widget guide", impressions: 80, clicks: 3, ctr: 0.037, position: 14 })] });
    expect(ops.some((o) => o.kind === "near_page_one" && o.recommendedExecution === "internal_links")).toBe(true);
  });
  it("high impressions beyond page two → missing_content article", () => {
    const ops = detectQueueOpportunities({ ...empty, queries: [agg({ key: "widget pricing", impressions: 120, clicks: 3, ctr: 0.025, position: 32 })] });
    expect(ops.some((o) => o.kind === "missing_content" && o.recommendedExecution === "create_article")).toBe(true);
  });
  it("declining query needs a meaningful first-half base", () => {
    const weak = detectQueueOpportunities({ ...empty, queries: [agg({ key: "q", trend: "declining", firstHalf: { impressions: 10, clicks: 0 }, secondHalf: { impressions: 2, clicks: 0 } })] });
    expect(weak.some((o) => o.kind === "declining_query")).toBe(false);
    const strong = detectQueueOpportunities({ ...empty, queries: [agg({ key: "q", impressions: 100, trend: "declining", firstHalf: { impressions: 80, clicks: 2 }, secondHalf: { impressions: 20, clicks: 0 } })] });
    expect(strong.some((o) => o.kind === "declining_query" && o.recommendedExecution === "refresh_content")).toBe(true);
  });
  it("non-PASS inspection verdict → indexing_issue; PASS is ignored", () => {
    const ops = detectQueueOpportunities({
      ...empty,
      inspections: [
        { url: "https://x.com/a", verdict: "FAIL", coverage_state: "Excluded" },
        { url: "https://x.com/b", verdict: "PASS", coverage_state: null },
      ],
    });
    const kinds = ops.filter((o) => o.kind === "indexing_issue");
    expect(kinds).toHaveLength(1);
    expect(kinds[0].dimKey).toBe("https://x.com/a");
  });
  it("no sitemaps → sitemap_missing; with sitemap → none", () => {
    const none = detectQueueOpportunities({ ...empty, sitemaps: [] });
    expect(none.some((o) => o.kind === "sitemap_missing" && o.recommendedExecution === "sitemap_submit")).toBe(true);
    expect(detectQueueOpportunities(empty).some((o) => o.kind === "sitemap_missing")).toBe(false);
  });
  it("thin/outdated is signal-based, low confidence, refresh path", () => {
    const ops = detectQueueOpportunities({ ...empty, pages: [agg({ key: "https://x.com/old", impressions: 90, clicks: 0, ctr: 0, position: 18 })] });
    const hit = ops.find((o) => o.kind === "thin_or_outdated");
    expect(hit).toBeTruthy();
    expect(hit!.confidence).toBe("low");
    expect(hit!.recommendedExecution).toBe("refresh_content");
  });
});

describe("scoreOpportunity", () => {
  const baseOp = { kind: "x", dimKey: "k", title: "", rationale: "", evidence: {}, confidence: "high" as const };
  it("score = value × opportunity × confidence ÷ effort — higher effort lowers score", () => {
    const a = { impressions: 1000, ctr: 0.001, position: 8 };
    const meta = scoreOpportunity({ ...baseOp, recommendedExecution: "metadata_change" }, a);
    const article = scoreOpportunity({ ...baseOp, recommendedExecution: "create_article" }, a);
    expect(meta.score).toBeGreaterThan(article.score);
    expect(meta.effort).toBe(EXECUTION_EFFORT.metadata_change);
    expect(meta.confidence).toBe(0.9);
    expect(meta.businessValue).toBeGreaterThan(0);
    expect(meta.businessValue).toBeLessThanOrEqual(1);
  });
  it("more demand → more value; null agg gets neutral opportunity, zero value", () => {
    const big = scoreOpportunity({ ...baseOp, recommendedExecution: "metadata_change" }, { impressions: 5000, ctr: 0.001, position: 5 });
    const small = scoreOpportunity({ ...baseOp, recommendedExecution: "metadata_change" }, { impressions: 50, ctr: 0.001, position: 5 });
    expect(big.score).toBeGreaterThan(small.score);
    const none = scoreOpportunity({ ...baseOp, recommendedExecution: "sitemap_submit" }, null);
    expect(none.businessValue).toBe(0.25); // neutral baseline for site-level items
    expect(none.rankingOpportunity).toBe(0.5);
    expect(none.score).toBeGreaterThan(0);
  });
});

describe("dedupe + execution mapping", () => {
  it("dedupe key is kind-scoped and bounded", () => {
    expect(dedupeKeyFor("near_page_one", "widgets")).toBe("near_page_one:widgets");
    expect(dedupeKeyFor("k", "x".repeat(600)).length).toBeLessThanOrEqual(500);
  });
  it("maps every queue execution path to a distinct seo_* action type", async () => {
    const { executionToActionType, SEO_ACTION_TYPES } = await import("@/lib/marketing/executors/seo.executor.server");
    const paths = ["create_article", "refresh_content", "faq_section", "metadata_change", "page_change", "internal_links", "sitemap_submit"];
    const mapped = paths.map(executionToActionType);
    expect(new Set(mapped).size).toBe(paths.length);
    for (const m of mapped) expect(SEO_ACTION_TYPES).toContain(m);
    expect(() => executionToActionType("nonsense")).toThrow();
  });
});

describe("campaign-type mapping matches the DB constraint", () => {
  // Must mirror the CHECK constraint on growthmind_seo_campaigns.campaign_type.
  const ALLOWED = ["strategy","general","product","service","industry","country","local","existing_page_improvement","content_refresh","internal_link","metadata","technical","blog"];
  it("every campaign-path action maps to an allowed campaign_type", async () => {
    const { CAMPAIGN_TYPES } = await import("@/lib/marketing/executors/seo.executor.server");
    for (const [actionType, campaignType] of Object.entries(CAMPAIGN_TYPES)) {
      expect(ALLOWED, `${actionType} → ${campaignType}`).toContain(campaignType);
    }
  });
});

describe("reconcileSeoOpportunities", () => {
  function mockDb(opps: any[], actions: Record<string, any>, approvals: Record<string, any> = {}) {
    const updates: any[] = [];
    const client = {
      from(table: string) {
        return {
          select() { return this; },
          eq(c: string, v: any) { if (c === "id") this._id = v; return this; },
          maybeSingle: async function () {
            const src = table === "hivemind_actions" ? approvals : actions;
            return { data: src[this._id] ?? null };
          },
          update(patch: any) {
            return {
              eq(_c1: string, id: any) {
                return {
                  eq: () => {
                    const chain = {
                      select: async () => { updates.push({ table, id, patch }); return { data: [{ id }], error: null }; },
                      then: (resolve: any) => { updates.push({ table, id, patch }); resolve({ error: null }); },
                    };
                    return chain as any;
                  },
                };
              },
            };
          },
          then(resolve: any) { resolve({ data: table === "growthmind_seo_opportunities" ? opps : [] }); },
        } as any;
      },
    };
    return { client, updates };
  }

  it("reopens when the linked marketing action failed, with failure context", async () => {
    const { reconcileSeoOpportunities } = await import("@/lib/growthmind/seo-opportunity-core");
    const { client, updates } = mockDb(
      [{ id: "opp1", marketing_action_id: "act1", status_changed_at: new Date().toISOString(), measurement: {} }],
      { act1: { id: "act1", status: "failed", status_history: [{ from: "executing", to: "failed", at: "x", note: "GSC PUT 403" }] } },
    );
    const r = await reconcileSeoOpportunities("ws1", client as any);
    expect(r.reopened).toBe(1);
    expect(updates[0].patch.status).toBe("open");
    expect(updates[0].patch.measurement.lastFailure.detail).toBe("GSC PUT 403");
  });

  it("leaves awaiting-approval and executing actions alone", async () => {
    const { reconcileSeoOpportunities } = await import("@/lib/growthmind/seo-opportunity-core");
    const { client, updates } = mockDb(
      [{ id: "opp1", marketing_action_id: "act1", status_changed_at: new Date().toISOString(), measurement: {} }],
      { act1: { id: "act1", status: "awaiting_approval", status_history: [] } },
    );
    const r = await reconcileSeoOpportunities("ws1", client as any);
    expect(r.reopened).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("reopens orphaned claims (no action linked) only after the grace period", async () => {
    const { reconcileSeoOpportunities } = await import("@/lib/growthmind/seo-opportunity-core");
    const fresh = mockDb([{ id: "o1", marketing_action_id: null, status_changed_at: new Date().toISOString(), measurement: {} }], {});
    expect((await reconcileSeoOpportunities("ws1", fresh.client as any)).reopened).toBe(0);
    const stale = mockDb([{ id: "o1", marketing_action_id: null, status_changed_at: new Date(Date.now() - 2 * 3600_000).toISOString(), measurement: {} }], {});
    const r = await reconcileSeoOpportunities("ws1", stale.client as any);
    expect(r.reopened).toBe(1);
    expect(stale.updates[0].patch.status).toBe("open");
  });

  it("recovers a stranded item whose approval was rejected: fails the action and reopens", async () => {
    const { reconcileSeoOpportunities } = await import("@/lib/growthmind/seo-opportunity-core");
    const { client, updates } = mockDb(
      [{ id: "opp1", marketing_action_id: "act1", status_changed_at: new Date().toISOString(), measurement: {} }],
      { act1: { id: "act1", status: "awaiting_approval", status_history: [], approval_action_id: "appr1" } },
      { appr1: { status: "rejected" } },
    );
    const r = await reconcileSeoOpportunities("ws1", client as any);
    expect(r.reopened).toBe(1);
    const actionUpdate = updates.find((u) => u.table === "marketing_actions");
    expect(actionUpdate?.patch.status).toBe("failed");
    const oppUpdate = updates.find((u) => u.table === "growthmind_seo_opportunities");
    expect(oppUpdate?.patch.status).toBe("open");
    expect(oppUpdate?.patch.measurement.lastFailure).toBeTruthy();
  });

  it("does not touch items whose approval is still pending", async () => {
    const { reconcileSeoOpportunities } = await import("@/lib/growthmind/seo-opportunity-core");
    const { client, updates } = mockDb(
      [{ id: "opp1", marketing_action_id: "act1", status_changed_at: new Date().toISOString(), measurement: {} }],
      { act1: { id: "act1", status: "awaiting_approval", status_history: [], approval_action_id: "appr1" } },
      { appr1: { status: "pending" } },
    );
    const r = await reconcileSeoOpportunities("ws1", client as any);
    expect(r.reopened).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
