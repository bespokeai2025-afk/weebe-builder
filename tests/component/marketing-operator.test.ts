import { describe, it, expect } from "vitest";
import {
  assessConversionPriority,
  conversionPriorityRank,
  CONVERSION_PRIORITY_ORDER,
  CONVERSION_PRIORITY_WEIGHTS,
} from "@/lib/marketing/conversion-priority.shared";
import {
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EVENT_LABELS,
} from "@/lib/notifications/notification-engine.shared";

describe("conversion priority scoring", () => {
  it("keeps the fixed priority order (qualified > demos > revenue > CPQO > CPB > conv rate)", () => {
    expect(CONVERSION_PRIORITY_ORDER).toEqual([
      "qualified_opportunities",
      "booked_demos",
      "revenue",
      "cost_per_qualified_opportunity",
      "cost_per_booking",
      "conversion_rate",
    ]);
    // Weights strictly decreasing in priority order.
    const weights = CONVERSION_PRIORITY_ORDER.map((m) => CONVERSION_PRIORITY_WEIGHTS[m]);
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeLessThan(weights[i - 1]);
  });

  it("scores an all-round improvement positively", () => {
    const a = assessConversionPriority(
      { qualifiedOpportunities: 12, bookedDemos: 6, revenue: 5000, spend: 400, conversions: 30, clicks: 300 },
      { qualifiedOpportunities: 6, bookedDemos: 3, revenue: 2500, spend: 400, conversions: 15, clicks: 300 },
    );
    expect(a.adequateData).toBe(true);
    expect(a.score).toBeGreaterThan(10);
    expect(a.topSignal?.metric).toBe("qualified_opportunities");
  });

  it("treats cost-per metrics as lower-is-better", () => {
    // Spend halved, same qualified opps → CPQO improved.
    const a = assessConversionPriority(
      { qualifiedOpportunities: 10, spend: 200 },
      { qualifiedOpportunities: 10, spend: 400 },
    );
    const cpqo = a.metrics.find((m) => m.metric === "cost_per_qualified_opportunity")!;
    expect(cpqo.available).toBe(true);
    expect(cpqo.deltaPct).toBeLessThan(0);
    expect(cpqo.improved).toBe(true);
    expect(a.score).toBeGreaterThan(0);
  });

  it("refuses to judge on tiny volume (no single-event 'trends')", () => {
    const a = assessConversionPriority(
      { qualifiedOpportunities: 1 },
      { qualifiedOpportunities: 0 },
    );
    const q = a.metrics.find((m) => m.metric === "qualified_opportunities")!;
    expect(q.available).toBe(false);
    expect(a.adequateData).toBe(false);
    expect(a.score).toBe(0);
  });

  it("excludes unavailable metrics instead of inventing values", () => {
    const a = assessConversionPriority(
      { revenue: 1000 },   // no spend/clicks → cost + rate metrics null
      { revenue: 800 },
    );
    for (const m of a.metrics) {
      if (m.metric !== "revenue") expect(m.available).toBe(false);
      else expect(m.available).toBe(true);
    }
    expect(a.score).toBeGreaterThan(0); // revenue-only, weighted alone
  });

  it("ranks opportunities by weight × impact × confidence and clamps inputs", () => {
    const qual = conversionPriorityRank({ metric: "qualified_opportunities", estimatedImpact: 0.5, confidence: 0.8 });
    const rate = conversionPriorityRank({ metric: "conversion_rate", estimatedImpact: 0.5, confidence: 0.8 });
    expect(qual).toBeGreaterThan(rate);
    expect(conversionPriorityRank({ metric: "revenue", estimatedImpact: 5, confidence: 2 })).toBe(3); // clamped to 1×1×w
  });
});

describe("conversion trend findings fail closed", () => {
  const makeSb = (curRes: any, prevRes: any) => {
    let call = 0;
    const chain = (res: any) => {
      const c: any = {};
      for (const m of ["select", "eq", "gte", "lt"]) c[m] = () => c;
      c.then = (resolve: any) => resolve(res);
      return c;
    };
    return {
      from: () => ({ select: () => ({ eq: () => ({ gte: (..._a: any[]) => {
        const res = call++ === 0 ? curRes : prevRes;
        const obj: any = { lt: () => Promise.resolve(res) };
        obj.then = (resolve: any) => resolve(res);
        return obj;
      } }) }) }),
      _chain: chain,
    } as any;
  };

  it("returns no finding when the current-window read errors (never a fake 100% drop)", async () => {
    const { conversionTrendFindings } = await import("@/lib/hivemind/marketing-operator-tick");
    const sb = makeSb({ count: null, error: { message: "timeout" } }, { count: 40, error: null });
    const findings = await conversionTrendFindings(sb, "ws-1");
    expect(findings).toEqual([]);
  });

  it("still reports a genuine drop when both reads succeed", async () => {
    const { conversionTrendFindings } = await import("@/lib/hivemind/marketing-operator-tick");
    const sb = makeSb({ count: 5, error: null }, { count: 40, error: null });
    const findings = await conversionTrendFindings(sb, "ws-1");
    expect(findings).toHaveLength(1);
    expect(findings[0].finding_kind).toBe("conversion_drop");
    expect(findings[0].severity).toBe("critical");
  });
});

describe("measurement sweep confound rule", () => {
  it("classifies inconclusive (no learning) when ONE other same-platform action overlaps the window", async () => {
    const { runMarketingMeasurementSweep } = await import("@/lib/hivemind/marketing-operator-tick");
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const reassess = new Date(Date.now() - 60 * 1000).toISOString();
    const action = {
      id: "a1", platform: "google_ads", action_type: "negative_keyword_add",
      executed_at: past, reassess_at: reassess,
      baseline: { ok: true, conversions: 10, spend: 100, clicks: 200, qualified: 4, bookings: 2 },
      target: {}, outcome_classification: null,
    };
    const updates: any[] = [];
    const sb: any = {
      from(table: string) {
        const q: any = { _table: table, _head: false };
        for (const m of ["select", "eq", "neq", "not", "gte", "lte", "lt", "in", "is", "order", "limit"]) {
          q[m] = (...args: any[]) => { if (m === "select" && args[1]?.head) q._head = true; return q; };
        }
        q.update = (patch: any) => { updates.push({ table, patch }); return q; };
        q.insert = () => q;
        q.then = (resolve: any) => {
          if (table === "marketing_actions" && q._head) return resolve({ count: 1, error: null }); // ONE overlapping action
          if (table === "marketing_actions") return resolve({ data: [action], error: null });
          if (table === "growthmind_gads_campaign_daily") return resolve({ data: [{ cost_micros: 50e6, conversions: 20, clicks: 300 }], error: null });
          if (table === "conversion_events") return resolve({ count: 8, error: null });
          if (table === "calendar_bookings") return resolve({ data: [], error: null });
          return resolve({ data: [], count: 0, error: null });
        };
        return q;
      },
    };
    const res = await runMarketingMeasurementSweep(sb, "ws-1");
    expect(res.measured).toBe(1);
    const patch = updates.find((u) => u.table === "marketing_actions" && u.patch.outcome_classification)?.patch;
    expect(patch?.outcome_classification).toBe("inconclusive");
    // No confidence/pattern learning writes for inconclusive outcomes.
    expect(updates.some((u) => u.table === "growthmind_learned_patterns")).toBe(false);
  });
});

describe("marketing operator notification wiring", () => {
  it("registers the digest event key with a label", () => {
    expect(NOTIFICATION_EVENT_KEYS).toContain("marketing_operator_digest");
    expect(NOTIFICATION_EVENT_LABELS.marketing_operator_digest).toBeTruthy();
  });
});
