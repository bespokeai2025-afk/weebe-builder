/**
 * Campaign minutes-used aggregation core — spec invariants:
 * dedup by provider call id, attribution order, Unassigned bucket,
 * reconciliation (campaigns + unassigned == workspace), real-costs-only,
 * 2dp minutes, valid-duration filtering, usage series.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateCampaignUsage,
  buildUsageSeries,
  dedupeCalls,
  attributeCall,
  isValidUsageCall,
  roundMinutes,
  formatDurationHuman,
  UNASSIGNED_CAMPAIGN,
  type UsageCallInput,
} from "@/lib/analytics-hub/campaign-usage.shared";

const NOW = new Date("2026-07-28T12:00:00Z");

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

describe("dedupeCalls", () => {
  it("counts each provider call id exactly once", () => {
    const rows = [
      call({ id: "a", providerCallId: "call_1" }),
      call({ id: "b", providerCallId: "call_1" }),
      call({ id: "c", providerCallId: "call_2" }),
      call({ id: "d", providerCallId: null }),
      call({ id: "d", providerCallId: null }), // same local id
    ];
    const out = dedupeCalls(rows);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.id)).toEqual(["a", "c", "d"]);
  });
});

describe("isValidUsageCall", () => {
  it("accepts zero/positive/null (real attempt, no duration), rejects NaN/negative", () => {
    expect(isValidUsageCall(call({ durationSeconds: 0 }))).toBe(true);
    expect(isValidUsageCall(call({ durationSeconds: 12.5 }))).toBe(true);
    expect(isValidUsageCall(call({ durationSeconds: null }))).toBe(true); // no-answer attempt
    expect(isValidUsageCall(call({ durationSeconds: NaN }))).toBe(false);
    expect(isValidUsageCall(call({ durationSeconds: -5 }))).toBe(false);
  });
});

describe("attributeCall", () => {
  const known = new Set(["c1", "c2"]);
  const agentMap = new Map<string, Set<string>>([
    ["agent_solo", new Set(["c1"])],
    ["agent_shared", new Set(["c1", "c2"])],
  ]);
  it("prefers explicit campaign id", () => {
    expect(attributeCall(call({ campaignId: "c2", agentId: "agent_solo" }), known, agentMap)).toBe("c2");
  });
  it("ignores unknown campaign ids (cross-workspace safety)", () => {
    expect(attributeCall(call({ campaignId: "foreign" }), known, agentMap)).toBe(null);
  });
  it("falls back to agent mapping only when unambiguous", () => {
    expect(attributeCall(call({ agentId: "agent_solo" }), known, agentMap)).toBe("c1");
    expect(attributeCall(call({ agentId: "agent_shared" }), known, agentMap)).toBe(null);
    expect(attributeCall(call({ agentId: "unknown" }), known, agentMap)).toBe(null);
  });
});

describe("aggregateCampaignUsage", () => {
  const campaigns = [
    { id: "c1", name: "Campaign One", agentId: "agent_1" },
    { id: "c2", name: "Campaign Two", agentId: "agent_2" },
  ];

  it("reconciles: campaign minutes + unassigned == workspace total (seconds exact)", () => {
    const calls = [
      call({ campaignId: "c1", durationSeconds: 61 }),
      call({ campaignId: "c1", durationSeconds: 30.5 }),
      call({ campaignId: "c2", durationSeconds: 125 }),
      call({ agentId: "agent_1", durationSeconds: 45 }), // agent fallback → c1
      call({ durationSeconds: 33 }), // unassigned
      call({ durationSeconds: null }), // no-answer: counts as a call, 0 minutes
      call({ durationSeconds: -4 }), // corrupt → excluded everywhere
    ];
    const r = aggregateCampaignUsage({ calls, campaigns, now: NOW });
    const sum = r.campaigns.reduce((a, c) => a + c.totalDurationSeconds, 0) + r.unassigned.totalDurationSeconds;
    expect(sum).toBe(r.workspace.totalDurationSeconds);
    expect(r.workspace.totalDurationSeconds).toBe(61 + 30.5 + 125 + 45 + 33);
    expect(r.workspace.totalCalls).toBe(6); // null-duration attempt still counts
    expect(r.workspace.missingDurationCalls).toBe(1);
    expect(r.excludedInvalidCount).toBe(1);
    expect(r.reconciliation.reconciled).toBe(true);
    expect(r.reconciliation.attributedSeconds).toBe(r.reconciliation.workspaceSeconds);
    expect(r.reconciliation.attributedCalls).toBe(r.workspace.totalCalls);
    const c1 = r.campaigns.find((c) => c.campaignId === "c1")!;
    expect(c1.totalDurationSeconds).toBe(61 + 30.5 + 45);
    expect(c1.minutesUsed).toBe(roundMinutes(136.5));
    expect(r.unassigned.campaignName).toBe(UNASSIGNED_CAMPAIGN);
    expect(r.unassigned.totalDurationSeconds).toBe(33);
  });

  it("dedups double webhook deliveries before summing", () => {
    const calls = [
      call({ providerCallId: "p1", campaignId: "c1", durationSeconds: 100 }),
      call({ providerCallId: "p1", campaignId: "c1", durationSeconds: 100 }),
    ];
    const r = aggregateCampaignUsage({ calls, campaigns, now: NOW });
    expect(r.workspace.totalDurationSeconds).toBe(100);
    expect(r.dedupedCallCount).toBe(1);
    expect(r.duplicatesRemoved).toBe(1);
  });

  it("breaks down unassigned reasons (no agent / unmapped agent / ambiguous agent)", () => {
    const shared = [
      { id: "c1", name: "One", agentId: "agent_shared" },
      { id: "c2", name: "Two", agentId: "agent_shared" },
    ];
    const calls = [
      call({ durationSeconds: 10 }), // no agent
      call({ agentId: "agent_unknown", durationSeconds: 10 }), // agent in no campaign
      call({ agentId: "agent_shared", durationSeconds: 10 }), // ambiguous
    ];
    const r = aggregateCampaignUsage({ calls, campaigns: shared, now: NOW });
    expect(r.unassignedReasons).toEqual({ noAgent: 1, agentNotInAnyCampaign: 1, ambiguousAgent: 1 });
    expect(r.unassigned.totalCalls).toBe(3);
  });

  it("emits cost only from real cost data, never invents", () => {
    const noCost = aggregateCampaignUsage({ calls: [call({ campaignId: "c1" })], campaigns, now: NOW });
    expect(noCost.campaigns.find((c) => c.campaignId === "c1")!.totalCostCents).toBe(null);
    expect(noCost.campaigns.find((c) => c.campaignId === "c1")!.costPerMinuteCents).toBe(null);

    const withCost = aggregateCampaignUsage({
      calls: [
        call({ campaignId: "c1", durationSeconds: 60, costCents: 30 }),
        call({ campaignId: "c1", durationSeconds: 60, costCents: null }),
      ],
      campaigns, now: NOW,
    });
    const c1 = withCost.campaigns.find((c) => c.campaignId === "c1")!;
    expect(c1.totalCostCents).toBe(30);
    expect(c1.costPerMinuteCents).toBe(15); // 30c over 2 minutes
  });

  it("derives rate cost at £0.36/min for every bucket", () => {
    const calls = [
      call({ campaignId: "c1", durationSeconds: 600 }), // 10 min → £3.60
      call({ durationSeconds: 300 }), // unassigned, 5 min → £1.80
    ];
    const r = aggregateCampaignUsage({ calls, campaigns, now: NOW });
    expect(r.campaigns.find((c) => c.campaignId === "c1")!.rateCostGbp).toBe(3.6);
    expect(r.unassigned.rateCostGbp).toBe(1.8);
    expect(r.workspace.rateCostGbp).toBe(5.4);
    // Rate cost is derived, never a substitute for real recorded cost.
    expect(r.workspace.totalCostCents).toBe(null);
  });

  it("rate cost reconciles across buckets within rounding tolerance (fractional seconds)", () => {
    const calls = [
      call({ campaignId: "c1", durationSeconds: 61.7 }),
      call({ campaignId: "c2", durationSeconds: 33.33 }),
      call({ agentId: "agent_1", durationSeconds: 45.05 }),
      call({ durationSeconds: 17.9 }),
    ];
    const r = aggregateCampaignUsage({ calls, campaigns, now: NOW });
    const sum = r.campaigns.reduce((a, c) => a + c.rateCostGbp, 0) + r.unassigned.rateCostGbp;
    expect(Math.abs(sum - r.workspace.rateCostGbp)).toBeLessThanOrEqual(0.01 * (r.campaigns.length + 1));
  });

  it("computes today / ISO-week / month windows and % of workspace", () => {
    const calls = [
      call({ campaignId: "c1", startedAt: "2026-07-28T09:00:00Z", durationSeconds: 120 }), // today (Tue)
      call({ campaignId: "c1", startedAt: "2026-07-27T09:00:00Z", durationSeconds: 60 }),  // this ISO week (Mon)
      call({ campaignId: "c1", startedAt: "2026-07-02T09:00:00Z", durationSeconds: 60 }),  // this month
      call({ campaignId: "c2", startedAt: "2026-06-15T09:00:00Z", durationSeconds: 240 }), // previous month
    ];
    const r = aggregateCampaignUsage({ calls, campaigns, now: NOW });
    const c1 = r.campaigns.find((c) => c.campaignId === "c1")!;
    expect(c1.minutesToday).toBe(2);
    expect(c1.minutesThisWeek).toBe(3);
    expect(c1.minutesThisMonth).toBe(4);
    expect(c1.percentageOfWorkspaceMinutes).toBe(50); // 240 of 480 seconds
    expect(r.workspace.minutesToday).toBe(2);
  });

  it("includes zero-usage campaigns and buckets sorted by usage", () => {
    const r = aggregateCampaignUsage({ calls: [call({ campaignId: "c2" })], campaigns, now: NOW });
    expect(r.campaigns.map((c) => c.campaignId)).toEqual(["c2", "c1"]);
    expect(r.campaigns[1].minutesUsed).toBe(0);
  });

  it("classification and direction minute splits reconcile with total", () => {
    const calls = [
      call({ campaignId: "c1", classification: "connected", durationSeconds: 100 }),
      call({ campaignId: "c1", classification: "voicemail", durationSeconds: 20 }),
      call({ campaignId: "c1", classification: "failed", direction: "inbound", durationSeconds: 10 }),
    ];
    const r = aggregateCampaignUsage({ calls, campaigns, now: NOW });
    const c1 = r.campaigns.find((c) => c.campaignId === "c1")!;
    expect(c1.connectedMinutes + c1.voicemailMinutes + c1.failedMinutes).toBeCloseTo(c1.minutesUsed, 5);
    expect(c1.inboundMinutes).toBeCloseTo(roundMinutes(10), 5);
    expect(c1.outboundMinutes).toBeCloseTo(roundMinutes(120), 5);
  });
});

describe("buildUsageSeries", () => {
  it("buckets by day with 2dp minutes and dedup applied", () => {
    const calls = [
      call({ providerCallId: "x", startedAt: "2026-07-27T10:00:00Z", durationSeconds: 90 }),
      call({ providerCallId: "x", startedAt: "2026-07-27T10:00:00Z", durationSeconds: 90 }), // dup
      call({ startedAt: "2026-07-28T01:00:00Z", durationSeconds: 45, classification: "voicemail" }),
    ];
    const s = buildUsageSeries(calls, "day");
    expect(s).toEqual([
      { bucket: "2026-07-27", minutesUsed: 1.5, calls: 1, connectedMinutes: 1.5 },
      { bucket: "2026-07-28", minutesUsed: 0.75, calls: 1, connectedMinutes: 0 },
    ]);
  });

  it("buckets by hour and month", () => {
    const calls = [call({ startedAt: "2026-07-27T10:30:00Z", durationSeconds: 60 })];
    expect(buildUsageSeries(calls, "hour")[0].bucket).toBe("2026-07-27T10:00");
    expect(buildUsageSeries(calls, "month")[0].bucket).toBe("2026-07");
  });
});

describe("avg per call + human duration (spec repair)", () => {
  it("avgSecondsPerCall = total duration / ALL calls (incl. voicemail/failed)", () => {
    const rows = [
      call({ id: "a", durationSeconds: 120, classification: "connected" }),
      call({ id: "b", durationSeconds: 30, classification: "voicemail" }),
      call({ id: "c", durationSeconds: 0, classification: "failed" }),
    ];
    const agg = aggregateCampaignUsage({ calls: rows, campaigns: [] });
    expect(agg.workspace.avgSecondsPerCall).toBe(50); // 150s / 3 calls
  });

  it("formatDurationHuman renders seconds/minutes/hours", () => {
    expect(formatDurationHuman(45)).toBe("45s");
    expect(formatDurationHuman(90)).toBe("1m 30s");
    expect(formatDurationHuman(3600)).toBe("1h");
    expect(formatDurationHuman(3720)).toBe("1h 2m");
    expect(formatDurationHuman(null)).toBe("—");
    expect(formatDurationHuman(-1)).toBe("—");
  });

  it("costCents sums only real recorded costs, null when none", () => {
    const none = aggregateCampaignUsage({ calls: [call({ id: "x", costCents: null })], campaigns: [] });
    expect(none.workspace.totalCostCents).toBe(null);
    const some = aggregateCampaignUsage({
      calls: [call({ id: "a", costCents: 100 }), call({ id: "b", costCents: null })],
      campaigns: [],
    });
    expect(some.workspace.totalCostCents).toBe(100);
  });
});
