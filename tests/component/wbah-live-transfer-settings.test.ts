import { describe, expect, it } from "vitest";
import {
  buildLiveTransferWeeklySchedule,
  hydrateLiveTransferRows,
  parseWbahLiveTransferSettings,
  validateLiveTransferRows,
  WBAH_LIVE_TRANSFER_DEFAULT_SCHEDULE,
} from "@/lib/integrations/webespokeEnterprise/wbah-campaign-sync.types";

describe("parseWbahLiveTransferSettings", () => {
  const sample = {
    settings: {
      timezone: "Europe/London",
      fallback: "callback",
      weekly_schedule: [
        { weekday: 1, start: "09:00", end: "17:00" },
        { weekday: 2, start: "09:00", end: "17:00" },
        { weekday: 3, start: "09:00", end: "17:00" },
        { weekday: 4, start: "09:00", end: "17:00" },
        { weekday: 5, start: "09:00", end: "17:00" },
        { weekday: 6, start: "09:00", end: "15:00" },
      ],
    },
    source: "redis",
    envDefaults: {
      timezone: "Europe/London",
      fallback: "callback",
      weekly_schedule: WBAH_LIVE_TRANSFER_DEFAULT_SCHEDULE,
    },
    live: {
      allowed: false,
      now_local: "Sat 24 Aug 2026, 16:05",
      today_window: { start: "09:00", end: "15:00" },
      schedule_label: "Mon–Fri 09:00–17:00, Sat 09:00–15:00",
      weekly_schedule: [
        { weekday: 1, start: "09:00", end: "17:00" },
        { weekday: 6, start: "09:00", end: "15:00" },
      ],
      next_opens_at_label: "Mon 26 Aug 2026, 09:00",
      timezone: "Europe/London",
      fallback: "callback",
    },
  };

  it("parses a wrapped API response", () => {
    const parsed = parseWbahLiveTransferSettings({ data: sample });
    expect(parsed?.settings.weekly_schedule).toHaveLength(6);
    expect(parsed?.settings.weekly_schedule[5]?.end).toBe("15:00");
    expect(parsed?.source).toBe("redis");
    expect(parsed?.live.allowed).toBe(false);
    expect(parsed?.live.schedule_label).toContain("Sat 09:00–15:00");
    expect(parsed?.live.today_window).toEqual({ start: "09:00", end: "15:00" });
  });

  it("parses a flat payload", () => {
    const parsed = parseWbahLiveTransferSettings(sample);
    expect(parsed?.settings.weekly_schedule[0]?.weekday).toBe(1);
    expect(parsed?.live.next_opens_at_label).toBe("Mon 26 Aug 2026, 09:00");
  });

  it("returns null when required blocks are missing", () => {
    expect(parseWbahLiveTransferSettings({ settings: sample.settings })).toBeNull();
    expect(parseWbahLiveTransferSettings(null)).toBeNull();
  });
});

describe("live transfer schedule helpers", () => {
  it("hydrates seven rows with Sunday closed by default", () => {
    const rows = hydrateLiveTransferRows(WBAH_LIVE_TRANSFER_DEFAULT_SCHEDULE);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.weekday === 7)?.open).toBe(false);
    expect(rows.find((r) => r.weekday === 6)?.end).toBe("15:00");
  });

  it("builds PATCH payload omitting closed days", () => {
    const rows = hydrateLiveTransferRows(WBAH_LIVE_TRANSFER_DEFAULT_SCHEDULE);
    const schedule = buildLiveTransferWeeklySchedule(rows);
    expect(schedule.some((d) => d.weekday === 7)).toBe(false);
    expect(schedule.find((d) => d.weekday === 6)).toEqual({
      weekday: 6,
      start: "09:00",
      end: "15:00",
    });
  });

  it("validates at least one open day and start before end", () => {
    const closed = hydrateLiveTransferRows([]).map((r) => ({ ...r, open: false }));
    expect(validateLiveTransferRows(closed)).toMatch(/At least one day/);

    const rows = hydrateLiveTransferRows(WBAH_LIVE_TRANSFER_DEFAULT_SCHEDULE);
    rows[0] = { ...rows[0]!, open: true, start: "17:00", end: "09:00" };
    expect(validateLiveTransferRows(rows)).toMatch(/Monday.*before end/);
  });
});
