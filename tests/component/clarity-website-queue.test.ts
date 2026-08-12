/**
 * Microsoft Clarity sync + Website Change Queue — parsing, detection,
 * multi-day confidence and executor honesty contracts.
 */
import { describe, it, expect, vi } from "vitest";
import {
  parseClarityPayload,
  aggregateClaritySignals,
  detectWebsiteChanges,
  dedupeKeyForChange,
  MIN_SIGNAL_DAYS,
  CLARITY_LIMITS,
  type PageSignal,
} from "@/lib/growthmind/clarity-sync-core";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/marketing/action-engine.server", () => ({
  registerMarketingExecutor: vi.fn(),
}));

// ── parseClarityPayload ───────────────────────────────────────────────────────

describe("parseClarityPayload", () => {
  const payload = [
    {
      metricName: "Traffic",
      information: [
        { URL: "https://x.com/pricing", Device: "PC", totalSessionCount: "120", distinctUserCount: "90", totalBotSessionCount: "5" },
        { URL: "https://x.com/pricing", Device: "Mobile", totalSessionCount: "80", distinctUserCount: "60", totalBotSessionCount: "2" },
      ],
    },
    {
      metricName: "DeadClickCount",
      information: [{ URL: "https://x.com/pricing", Device: "PC", subTotal: "14" }],
    },
    {
      metricName: "RageClickCount",
      information: [{ URL: "https://x.com/pricing", Device: "Mobile", sessionsCount: "6" }],
    },
    { metricName: "SomethingUnknown", information: [{ URL: "https://x.com/pricing", Device: "PC", subTotal: "99" }] },
  ];

  it("groups rows by URL+Device and maps known metrics", () => {
    const out = parseClarityPayload(payload);
    expect(out).toHaveLength(2);
    const pc = out.find((r) => r.device === "PC")!;
    expect(pc.sessions).toBe(120);
    expect(pc.distinctUsers).toBe(90);
    expect(pc.metrics.deadClicks).toBe(14);
    const mobile = out.find((r) => r.device === "Mobile")!;
    expect(mobile.metrics.rageClicks).toBe(6);
  });

  it("ignores unknown metrics instead of guessing", () => {
    const pc = parseClarityPayload(payload).find((r) => r.device === "PC")!;
    expect(Object.keys(pc.metrics)).not.toContain("SomethingUnknown");
    expect(Object.values(pc.metrics)).not.toContain(99);
  });

  it("returns [] for non-array payloads and skips rows without a URL", () => {
    expect(parseClarityPayload({ oops: true })).toEqual([]);
    expect(parseClarityPayload([{ metricName: "Traffic", information: [{ Device: "PC", totalSessionCount: 5 }] }])).toEqual([]);
  });
});

// ── aggregateClaritySignals ───────────────────────────────────────────────────

function day(date: string, url: string, device: string, sessions: number, m: Record<string, number>) {
  return { metric_date: date, url, device, sessions, metrics: m };
}

describe("aggregateClaritySignals", () => {
  it("sums across days/devices and counts distinct days", () => {
    const s = aggregateClaritySignals([
      day("2026-08-10", "https://x.com/p", "PC", 50, { deadClicks: 5, rageClicks: 1 }),
      day("2026-08-11", "https://x.com/p", "PC", 60, { deadClicks: 7, rageClicks: 2 }),
      day("2026-08-11", "https://x.com/p", "Mobile", 40, { deadClicks: 20, rageClicks: 3 }),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].days).toBe(2);
    expect(s[0].sessions).toBe(150);
    expect(s[0].deadClicks).toBe(32);
  });

  it("computes mobile share of frustration problems", () => {
    const s = aggregateClaritySignals([
      day("2026-08-10", "https://x.com/p", "PC", 50, { deadClicks: 2, rageClicks: 0 }),
      day("2026-08-11", "https://x.com/p", "Mobile", 40, { deadClicks: 8, rageClicks: 0 }),
    ]);
    expect(s[0].mobileShareOfProblems).toBeCloseTo(0.8);
  });
});

// ── detectWebsiteChanges ──────────────────────────────────────────────────────

function signal(partial: Partial<PageSignal> & { url: string }): PageSignal {
  return {
    days: 3, sessions: 100, deadClicks: 0, rageClicks: 0, excessiveScroll: 0,
    quickbackClicks: 0, scriptErrors: 0, errorClicks: 0, mobileShareOfProblems: 0,
    ...partial,
  };
}

describe("detectWebsiteChanges", () => {
  it("rejects single-day signals regardless of severity (no single-day noise)", () => {
    const out = detectWebsiteChanges([signal({ url: "https://x.com/p", days: 1, deadClicks: 50 })], []);
    expect(out).toEqual([]);
    expect(MIN_SIGNAL_DAYS).toBeGreaterThanOrEqual(2);
  });

  it("ignores negligible-traffic pages", () => {
    const out = detectWebsiteChanges([signal({ url: "https://x.com/p", sessions: 5, deadClicks: 4 })], []);
    expect(out).toEqual([]);
  });

  it("emits a fully structured candidate for dead-click pages with evidence attached", () => {
    const out = detectWebsiteChanges([signal({ url: "https://x.com/features", deadClicks: 12 })], []);
    expect(out.length).toBeGreaterThan(0);
    const c = out[0];
    for (const field of ["currentState", "proposedState", "why", "expectedImpact", "risk", "rollbackPlan"] as const) {
      expect(String(c[field]).length).toBeGreaterThan(10);
    }
    expect((c.supportingData as any).claritySignal.deadClicks).toBe(12);
    expect(c.score).toBeGreaterThan(0);
    expect(c.confidence).toBeLessThanOrEqual(0.9);
  });

  it("routes pricing pages to pricing_presentation and form pages to form_optimisation", () => {
    const out = detectWebsiteChanges([
      signal({ url: "https://x.com/pricing", deadClicks: 12 }),
      signal({ url: "https://x.com/contact", deadClicks: 12 }),
    ], []);
    expect(out.map((c) => c.changeType).sort()).toEqual(["form_optimisation", "pricing_presentation"]);
  });

  it("detects quick-back mismatch as headline on landing pages", () => {
    const out = detectWebsiteChanges([signal({ url: "https://x.com/", quickbackClicks: 20 })], []);
    expect(out[0].changeType).toBe("headline");
  });

  it("flags mobile-concentrated frustration as cta_position", () => {
    const out = detectWebsiteChanges(
      [signal({ url: "https://x.com/deep-page", deadClicks: 8, rageClicks: 4, mobileShareOfProblems: 0.8 })],
      [],
    );
    expect(out.some((c) => c.changeType === "cta_position")).toBe(true);
  });

  it("cites conversion decline in why and boosts confidence when outcome data exists", () => {
    const withConv = detectWebsiteChanges(
      [signal({ url: "https://x.com/features", deadClicks: 12 })],
      [{ path: "/features", recent: 3, prior: 10 }],
    )[0];
    const without = detectWebsiteChanges([signal({ url: "https://x.com/features", deadClicks: 12 })], [])[0];
    expect(withConv.why).toContain("3 recent vs 10 prior");
    expect(without.why).toContain("No conversion events recorded");
    expect(withConv.confidence).toBeGreaterThan(without.confidence);
  });

  it("sorts candidates by score descending", () => {
    const out = detectWebsiteChanges([
      signal({ url: "https://x.com/a", sessions: 40, deadClicks: 5 }),
      signal({ url: "https://x.com/b", sessions: 4000, deadClicks: 500, days: 5 }),
    ], []);
    expect(out[0].pageUrl).toBe("https://x.com/b");
    expect(out[0].score).toBeGreaterThanOrEqual(out[out.length - 1].score);
  });
});

// ── dedupe keys ───────────────────────────────────────────────────────────────

describe("dedupeKeyForChange", () => {
  it("is stable per change_type + normalised path (query/host-noise free)", () => {
    expect(dedupeKeyForChange({ changeType: "headline", pageUrl: "https://x.com/pricing/" }))
      .toBe(dedupeKeyForChange({ changeType: "headline", pageUrl: "https://x.com/pricing" }));
    expect(dedupeKeyForChange({ changeType: "headline", pageUrl: "https://x.com/pricing" }))
      .not.toBe(dedupeKeyForChange({ changeType: "cta_copy", pageUrl: "https://x.com/pricing" }));
  });
});

// ── documented API limits stay honest ────────────────────────────────────────

describe("CLARITY_LIMITS", () => {
  it("matches Microsoft's documented Data Export API quotas", () => {
    expect(CLARITY_LIMITS.maxRequestsPerProjectPerDay).toBe(10);
    expect(CLARITY_LIMITS.maxNumOfDays).toBe(3);
    expect(CLARITY_LIMITS.maxDimensions).toBe(3);
    expect(CLARITY_LIMITS.maxRowsPerResponse).toBe(1000);
  });
});

// ── executor honesty ─────────────────────────────────────────────────────────

describe("website executor module", () => {
  it("registers a website-platform executor without auto-executable action types", async () => {
    const { registerMarketingExecutor } = await import("@/lib/marketing/action-engine.server");
    await import("@/lib/marketing/executors/website.executor.server");
    const calls = (registerMarketingExecutor as any).mock.calls;
    const executor = calls.map((c: any[]) => c[0]).find((e: any) => e.platform === "website");
    expect(executor).toBeTruthy();
    expect(executor.autoExecutableActionTypes).toBeUndefined();
    expect(executor.buildRollback()).toBeNull();
  });
});
