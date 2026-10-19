/**
 * Availability must span several days, not fill up on the first one.
 *
 * The clinic is open 10:00–20:00, which is twenty 30-minute starts. With only an overall cap of 12
 * slots, every slot returned came from the first open day and the loop broke before reaching the
 * second — so a caller asking for "sometime next week" was read today's times.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAvailabilityRange } from "@/lib/dnr/dnr-london-dates.shared";

describe("normalizeAvailabilityRange", () => {
  // The dates below are "near future" relative to this fixed today.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("defaults to a two-week window rather than a single day", () => {
    const r = normalizeAvailabilityRange("2026-10-05", undefined);
    expect(r.start).toBe("2026-10-05");
    expect(r.end).toBe("2026-10-19");
  });

  it("never searches the past", () => {
    const r = normalizeAvailabilityRange("2020-01-01", "2020-01-02");
    expect(r.start).not.toBe("2020-01-01");
    expect(r.adjusted).toBe(true);
  });

  it("caps the window at three weeks so the search stays bounded", () => {
    const r = normalizeAvailabilityRange("2026-10-05", "2027-01-01");
    expect(r.end).toBe("2026-10-26");
    expect(r.adjusted).toBe(true);
  });

  it("accepts an explicit near-future range", () => {
    const r = normalizeAvailabilityRange("2026-10-05", "2026-10-12");
    expect(r).toEqual({ start: "2026-10-05", end: "2026-10-12", adjusted: false });
  });
});
