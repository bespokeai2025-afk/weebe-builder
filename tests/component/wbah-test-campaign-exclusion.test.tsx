import { describe, it, expect } from "vitest";
import { isWbahTestCampaign, wbahBookingWhen } from "@/lib/integrations/webespokeEnterprise/wbah-campaign-reporting.server";
import { formatAppointment } from "@/components/analytics-hub/CampaignsTab";

describe("isWbahTestCampaign", () => {
  it("flags deleted campaigns with test-lead status", () => {
    expect(isWbahTestCampaign({ name: "Anything", lead_status: "Test Lead", is_deleted: true })).toBe(true);
  });

  it("flags deleted campaigns with test-like names", () => {
    expect(isWbahTestCampaign({ name: "Test", lead_status: null, is_deleted: true })).toBe(true);
    expect(isWbahTestCampaign({ name: "testing", lead_status: null, is_deleted: true })).toBe(true);
    expect(isWbahTestCampaign({ name: "Rebook Test", lead_status: null, is_deleted: true })).toBe(true);
  });

  it("NEVER flags deleted REAL campaigns", () => {
    expect(isWbahTestCampaign({ name: "Rebook Initial Consultation", lead_status: "Disqualified", is_deleted: true })).toBe(false);
    expect(isWbahTestCampaign({ name: "Latest Sweep", lead_status: null, is_deleted: true })).toBe(false);
  });

  it("never flags active campaigns, even with test-like names", () => {
    expect(isWbahTestCampaign({ name: "Test", lead_status: "Test Lead", is_deleted: false })).toBe(false);
    expect(isWbahTestCampaign({ name: "Test", lead_status: null, is_deleted: null })).toBe(false);
  });
});

describe("wbahBookingWhen", () => {
  it("prefers structured callback_datetime over date-only column", () => {
    const w = wbahBookingWhen({
      appointment_date: "2026-07-23",
      meta: { custom_analysis: { callback_datetime: "2026-07-23T15:00:00" } },
    });
    expect(w.date).toBe("2026-07-23");
    expect(w.dateTime).toBe("2026-07-23T15:00:00");
  });

  it("returns nulls when nothing is held", () => {
    const w = wbahBookingWhen({ appointment_date: null, meta: {} });
    expect(w.date).toBeNull();
    expect(w.dateTime).toBeNull();
  });

  it("rejects malformed/short datetime strings", () => {
    const w = wbahBookingWhen({ meta: { custom_analysis: { callback_datetime: "2026-07-23" } } });
    expect(w.dateTime).toBeNull();
  });
});

describe("formatAppointment", () => {
  it("renders date + UK time from appointmentDateTime", () => {
    expect(formatAppointment({ appointmentDateTime: "2026-07-23T15:00:00" })).toBe("23 Jul 2026, 15:00 UK");
  });

  it("falls back to date-only appointmentDate", () => {
    expect(formatAppointment({ appointmentDate: "2026-07-23" })).toBe("23 Jul 2026");
  });

  it("returns null when nothing is available", () => {
    expect(formatAppointment({})).toBeNull();
  });
});
