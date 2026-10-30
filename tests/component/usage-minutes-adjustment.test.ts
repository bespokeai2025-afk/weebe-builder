import { describe, expect, it } from "vitest";
import { applyUsageMinutesAdjustment } from "@/lib/analytics-hub/campaign-usage.shared";

const ws = {
  minutesUsed: 4772.82,
  totalDurationSeconds: 286369,
  rateCostGbp: 1718.21,
  minutesThisMonth: 4772.82,
  minutesToday: 100,
};
const oct = { startIso: "2026-09-30T23:00:00.000Z", endIso: "2026-10-31T23:00:00.000Z" };
const adj = { minutes: 2800, date: "2026-10-30", note: null };
const now = Date.parse("2026-10-30T12:00:00Z");

describe("usage minutes adjustment", () => {
  it("adds minutes and charge when the date is in the period", () => {
    const { workspace, applied } = applyUsageMinutesAdjustment(ws, adj, oct, now);
    expect(applied).toEqual(adj);
    expect(workspace.minutesUsed).toBe(7572.82);
    expect(workspace.rateCostGbp).toBe(Math.round(((286369 + 168000) / 60) * 0.36 * 100) / 100);
    expect(workspace.minutesThisMonth).toBe(7572.82);
    expect(workspace.minutesToday).toBe(2900);
  });

  it("leaves other periods alone", () => {
    const sep = { startIso: "2026-08-31T23:00:00.000Z", endIso: "2026-09-30T23:00:00.000Z" };
    const { workspace, applied } = applyUsageMinutesAdjustment(ws, adj, sep, now);
    expect(applied).toBeNull();
    expect(workspace).toBe(ws);
  });

  it("counts on the last day of the range (end is exclusive)", () => {
    const { applied } = applyUsageMinutesAdjustment(ws, { ...adj, date: "2026-10-31" }, oct, now);
    expect(applied).not.toBeNull();
  });
});
