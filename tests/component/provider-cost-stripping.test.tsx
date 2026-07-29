/**
 * WBAH report repair v2 — client-facing provider-cost removal + stable totals.
 *
 * Spec invariants:
 *  • Client responses NEVER include provider costs (USD/Retell figures) or the
 *    provider reconciliation block — only the GBP Client Usage Charge.
 *  • stripProviderCostData preserves every client-legitimate figure unchanged
 *    (minutes, calls, rateCostGbp, reconciliation, series).
 *  • Aggregation is deterministic: identical input → identical totals, so a
 *    page refresh over the same snapshot can never change the numbers.
 */
import { describe, it, expect } from "vitest";
import { stripProviderCostData } from "@/lib/analytics-hub/campaign-usage.server";
import {
  aggregateCampaignUsage,
  type UsageCallInput,
} from "@/lib/analytics-hub/campaign-usage.shared";

function call(over: Partial<UsageCallInput> = {}): UsageCallInput {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    providerCallId: null,
    campaignId: null,
    agentId: null,
    startedAt: "2026-07-27T10:00:00Z",
    durationSeconds: 60,
    direction: "outbound",
    classification: "connected",
    sentiment: null,
    qualified: false,
    booked: false,
    costCents: null,
    ...over,
  };
}

function usageFixture(): any {
  const calls = [
    call({ id: "a", providerCallId: "p1", campaignId: "c1", costCents: 12, durationSeconds: 90 }),
    call({ id: "b", providerCallId: "p2", campaignId: "c1", costCents: 7 }),
    call({ id: "c", providerCallId: "p3", costCents: 5, durationSeconds: 30 }),
  ];
  const agg = aggregateCampaignUsage({
    calls,
    campaigns: [{ id: "c1", name: "Campaign One" }],
  });
  return {
    workspaceId: "ws1",
    range: { startIso: "2026-07-01T00:00:00Z", endIso: "2026-07-28T00:00:00Z" },
    mode: "wbah_dialler",
    ...agg,
    series: [],
    granularity: "day",
    truncated: false,
    crossSourceDuplicatesExcluded: 0,
    lastSyncedAt: null,
    dedupedCallCount: 3,
    excludedInvalidCount: 0,
    duplicatesRemoved: 0,
    provider: {
      minutes: 2.5,
      calls: 3,
      costUsdCents: 24,
      costUnavailableCalls: 0,
      differenceMinutes: 0,
      toleranceMinutes: 0.05,
      status: "verified",
    },
    error: null,
  };
}

describe("stripProviderCostData (client-facing scrubbing)", () => {
  it("removes the provider reconciliation block entirely", () => {
    const out = stripProviderCostData(usageFixture());
    expect(out.provider).toBeNull();
  });

  it("nulls provider cost fields on workspace, campaigns and unassigned", () => {
    const out = stripProviderCostData(usageFixture());
    expect(out.workspace.totalCostCents).toBeNull();
    expect(out.workspace.costPerMinuteCents).toBeNull();
    expect(out.unassigned.totalCostCents).toBeNull();
    expect(out.unassigned.costPerMinuteCents).toBeNull();
    for (const c of out.campaigns) {
      expect(c.totalCostCents).toBeNull();
      expect(c.costPerMinuteCents).toBeNull();
    }
  });

  it("serialized client response contains no USD cost values anywhere", () => {
    const out = stripProviderCostData(usageFixture());
    const json = JSON.stringify(out);
    expect(json).not.toContain("costUsdCents");
    expect(json).not.toMatch(/"totalCostCents":\s*\d/);
    expect(json).not.toMatch(/"costPerMinuteCents":\s*\d/);
  });

  it("preserves all client-legitimate figures unchanged (GBP charge, minutes, calls, reconciliation)", () => {
    const full = usageFixture();
    const out = stripProviderCostData(full);
    expect(out.workspace.minutesUsed).toBe(full.workspace.minutesUsed);
    expect(out.workspace.totalCalls).toBe(full.workspace.totalCalls);
    expect(out.workspace.rateCostGbp).toBe(full.workspace.rateCostGbp);
    expect(out.campaigns.map((c: any) => c.rateCostGbp)).toEqual(
      full.campaigns.map((c: any) => c.rateCostGbp),
    );
    expect(out.reconciliation).toEqual(full.reconciliation);
    expect(out.unassigned.minutesUsed).toBe(full.unassigned.minutesUsed);
  });

  it("does not mutate the original (cached) object", () => {
    const full = usageFixture();
    stripProviderCostData(full);
    expect(full.provider).not.toBeNull();
    expect(full.workspace.totalCostCents).not.toBeNull();
  });
});

describe("deterministic totals (stable on refresh)", () => {
  it("identical input always aggregates to identical totals and exact reconciliation", () => {
    const calls = Array.from({ length: 50 }, (_, i) =>
      call({
        id: `r${i}`,
        providerCallId: `p${i}`,
        campaignId: i % 3 === 0 ? "c1" : null,
        durationSeconds: (i * 7) % 130,
      }),
    );
    const campaigns = [{ id: "c1", name: "Campaign One" }];
    const a = aggregateCampaignUsage({ calls, campaigns });
    const b = aggregateCampaignUsage({ calls: [...calls], campaigns: [...campaigns] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Displayed rows + Unassigned must sum exactly to the workspace totals.
    const rowCalls = a.campaigns.reduce((s, c) => s + c.totalCalls, 0) + a.unassigned.totalCalls;
    expect(rowCalls).toBe(a.workspace.totalCalls);
    expect(a.reconciliation.reconciled).toBe(true);
  });
});
