import { describe, it, expect } from "vitest";
import {
  hivemindCallsSourceTable,
  londonDayWindowUtc,
  londonMonthStartUtc,
  computeWbahCallMetrics,
  wbahCallMetricsError,
  buildWbahCallsContextLines,
  WBAH_CALLS_UNAVAILABLE_WARNING,
  type WbahCallRowLike,
} from "@/lib/hivemind/wbah-call-metrics.shared";

const WINDOW = { windowStartUtc: new Date("2026-07-25T23:00:00Z"), windowEndUtc: new Date("2026-07-26T23:00:00Z") };

function row(p: Partial<WbahCallRowLike> & { id: string }): WbahCallRowLike {
  return { retell_call_id: `call_${p.id}`, sentiment: null, end_reason: "hangup", started_at: "2026-07-26T10:00:00Z", synced_at: "2026-07-26T10:05:00Z", ...p };
}

describe("WBAH HiveMind call metrics", () => {
  it("WBAH sources calls from wbah_calls; standard workspaces still use calls", () => {
    expect(hivemindCallsSourceTable(true)).toBe("wbah_calls");
    expect(hivemindCallsSourceTable(false)).toBe("calls");
  });

  it("Europe/London BST (summer) day window is 23:00 UTC → 23:00 UTC", () => {
    const w = londonDayWindowUtc(new Date("2026-07-26T12:00:00Z"));
    expect(w.startUtc.toISOString()).toBe("2026-07-25T23:00:00.000Z");
    expect(w.endUtc.toISOString()).toBe("2026-07-26T23:00:00.000Z");
  });

  it("BST window is correct even late-evening UTC when London is already the next day", () => {
    // 23:30 UTC on Jul 25 is 00:30 Jul 26 in London → the Jul 26 window.
    const w = londonDayWindowUtc(new Date("2026-07-25T23:30:00Z"));
    expect(w.startUtc.toISOString()).toBe("2026-07-25T23:00:00.000Z");
    expect(w.endUtc.toISOString()).toBe("2026-07-26T23:00:00.000Z");
  });

  it("GMT (winter) day window is midnight UTC → midnight UTC", () => {
    const w = londonDayWindowUtc(new Date("2026-01-15T12:00:00Z"));
    expect(w.startUtc.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(w.endUtc.toISOString()).toBe("2026-01-16T00:00:00.000Z");
  });

  it("handles the GMT→BST spring-forward day (23h day, Mar 29 2026)", () => {
    const w = londonDayWindowUtc(new Date("2026-03-29T12:00:00Z"));
    expect(w.startUtc.toISOString()).toBe("2026-03-29T00:00:00.000Z"); // GMT at local midnight
    expect(w.endUtc.toISOString()).toBe("2026-03-29T23:00:00.000Z"); // BST by next midnight → 23h day
  });

  it("handles the BST→GMT transition day (25h day, Oct 25 2026)", () => {
    const w = londonDayWindowUtc(new Date("2026-10-25T12:00:00Z"));
    expect(w.startUtc.toISOString()).toBe("2026-10-24T23:00:00.000Z"); // still BST at local midnight
    expect(w.endUtc.toISOString()).toBe("2026-10-26T00:00:00.000Z"); // GMT by next midnight
  });

  it("London month start respects BST", () => {
    expect(londonMonthStartUtc(new Date("2026-07-26T12:00:00Z")).toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(londonMonthStartUtc(new Date("2026-01-15T12:00:00Z")).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("total calls include ALL outcomes; qualified/sentiment are subsets", () => {
    const rows = [
      row({ id: "1", sentiment: "positive" }),
      row({ id: "2", sentiment: "neutral" }),
      row({ id: "3", sentiment: "negative" }),
      row({ id: "4", end_reason: "voicemail_reached" }),
      row({ id: "5", end_reason: "dial_no_answer" }),
      row({ id: "6", sentiment: null }),
    ];
    const m = computeWbahCallMetrics({ rowsToday: rows, monthTotal: 100, newestSyncAt: "2026-07-26T10:05:00Z", now: new Date("2026-07-26T11:00:00Z"), ...WINDOW });
    expect(m.status).toBe("ok");
    expect(m.totalToday).toBe(6); // voicemails, failures, unknown sentiment all counted
    expect(m.voicemailToday).toBe(1);
    expect(m.connectedToday).toBe(5);
    expect(m.failedToday).toBe(1);
    expect(m.positiveToday).toBe(1);
    expect(m.neutralToday).toBe(1);
    expect(m.negativeToday).toBe(1);
    expect(m.qualifiedToday).toBe(1); // approved WBAH definition: positive sentiment
    expect(m.qualifiedToday).toBeLessThanOrEqual(m.totalToday);
    expect(m.monthTotal).toBe(100);
  });

  it("dedupes by authoritative provider call id (retell_call_id)", () => {
    const rows = [
      row({ id: "a", retell_call_id: "call_X" }),
      row({ id: "b", retell_call_id: "call_X" }), // weak-id duplicate of the same provider call
      row({ id: "c", retell_call_id: null }),
      row({ id: "d", retell_call_id: null }), // distinct rows without provider id both count
    ];
    const m = computeWbahCallMetrics({ rowsToday: rows, monthTotal: 4, newestSyncAt: "2026-07-26T10:05:00Z", now: new Date("2026-07-26T11:00:00Z"), ...WINDOW });
    expect(m.totalToday).toBe(3);
  });

  it("successful query with zero rows is a real zero, fresh, no warning", () => {
    const m = computeWbahCallMetrics({ rowsToday: [], monthTotal: 0, newestSyncAt: new Date("2026-07-26T10:00:00Z").toISOString(), now: new Date("2026-07-26T11:00:00Z"), ...WINDOW });
    expect(m.status).toBe("ok");
    expect(m.totalToday).toBe(0);
    expect(m.stale).toBe(false);
    expect(m.warning).toBeNull();
  });

  it("stale sync sets the explicit delayed/unavailable warning", () => {
    const m = computeWbahCallMetrics({ rowsToday: [row({ id: "1" })], monthTotal: 1, newestSyncAt: "2026-07-25T00:00:00Z", now: new Date("2026-07-26T11:00:00Z"), ...WINDOW });
    expect(m.stale).toBe(true);
    expect(m.warning).toBe(WBAH_CALLS_UNAVAILABLE_WARNING);
  });

  it("failed source returns unavailable — never a silent zero in the context", () => {
    const err = wbahCallMetricsError({ startUtc: WINDOW.windowStartUtc, endUtc: WINDOW.windowEndUtc });
    expect(err.status).toBe("error");
    expect(err.warning).toBe(WBAH_CALLS_UNAVAILABLE_WARNING);
    const lines = buildWbahCallsContextLines(err).join("\n");
    expect(lines).toContain(WBAH_CALLS_UNAVAILABLE_WARNING);
    expect(lines).not.toMatch(/0 total calls/);
    expect(lines).toContain("Do NOT report a call count");
  });

  it("HiveMind context block includes the WBAH calls metrics and source", () => {
    const m = computeWbahCallMetrics({
      rowsToday: [row({ id: "1", sentiment: "positive" }), row({ id: "2", end_reason: "voicemail_reached" })],
      monthTotal: 42,
      newestSyncAt: "2026-07-26T10:05:00Z",
      now: new Date("2026-07-26T11:00:00Z"),
      ...WINDOW,
    });
    const text = buildWbahCallsContextLines(m).join("\n");
    expect(text).toContain("wbah_calls");
    expect(text).toContain("Europe/London");
    expect(text).toContain("2 total calls");
    expect(text).toContain("1 voicemail");
    expect(text).toContain("Qualified today (positive sentiment): 1");
    expect(text).toContain("This month: 42 calls");
    expect(text).toContain("(fresh)");
  });
});
