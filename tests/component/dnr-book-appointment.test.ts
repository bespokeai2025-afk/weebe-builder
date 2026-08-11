import { describe, expect, it } from "vitest";
import { parseDnrBookAppointment } from "@/lib/dnr/dnr-book-appointment.shared";

describe("dnr-book-appointment", () => {
  it("accepts standard payload", () => {
    const r = parseDnrBookAppointment({
      contact_id: 12345,
      service_name: "Ultherapy - Lower Face",
      start_date: "2026-08-15",
      start_time: "10:30",
    });
    expect(r.ok).toBe(true);
  });

  it("normalizes field aliases and time formats", () => {
    const r = parseDnrBookAppointment({
      client_id: "999",
      treatment: "Ultherapy - Lower Face",
      appointment_date: "15/08/2026",
      time: "10.30",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.contact_id).toBe("999");
      expect(r.data.start_date).toBe("2026-08-15");
      expect(r.data.start_time).toBe("10:30");
    }
  });

  it("uses slot object when date/time omitted", () => {
    const r = parseDnrBookAppointment({
      contact_id: 1,
      service_name: "Ultherapy",
      slot: { start_date: "2026-08-15", start_time: "11:00" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.start_date).toBe("2026-08-15");
      expect(r.data.start_time).toBe("11:00");
    }
  });

  it("reports missing fields", () => {
    const r = parseDnrBookAppointment({ service_name: "Ultherapy" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toContain("contact_id");
      expect(r.missing).toContain("start_date");
    }
  });
});
