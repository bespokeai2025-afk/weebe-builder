import { describe, expect, it } from "vitest";
import {
  buildDnrAppointmentNotes,
  describePabauBookingFailure,
} from "@/lib/dnr/dnr-pabau-booking.server";
import { DNR_VOICE } from "@/lib/dnr/dnr-voice.config";

describe("buildDnrAppointmentNotes", () => {
  it("falls back to a default note", () => {
    expect(buildDnrAppointmentNotes(undefined)).toBe("Booked via WEBEE AI receptionist");
  });

  it("records a requested clinician so front of house can reassign", () => {
    const notes = buildDnrAppointmentNotes("Wants a quiet room", 142159);
    expect(notes).toContain("Wants a quiet room");
    expect(notes).toContain("142159");
    expect(notes).toContain("reassign");
  });

  it("does not annotate when the request is already the booking column", () => {
    const notes = buildDnrAppointmentNotes("Note", DNR_VOICE.pabau.bookingEmployeeId);
    expect(notes).toBe("Note");
  });

  it("stays within the 500 character limit", () => {
    expect(buildDnrAppointmentNotes("x".repeat(600), 142159).length).toBe(500);
  });
});

describe("describePabauBookingFailure", () => {
  it("treats a missing rota as a recoverable slot problem", () => {
    const f = describePabauBookingFailure("There is no shift for this timeslot");
    expect(f.reason).toBe("no_shift");
    expect(f.message).toContain("another time");
    expect(f.hint).toContain("check_availability");
  });

  it("treats an off-location roster the same as a missing shift", () => {
    const f = describePabauBookingFailure(
      "Practitioner is not rostered at this location for the selected time",
    );
    expect(f.reason).toBe("no_shift");
    expect(f.message).not.toContain("rostered");
  });

  it("routes a permission refusal to front of house", () => {
    const f = describePabauBookingFailure("Request not allowed.");
    expect(f.reason).toBe("permission");
    expect(f.hint).toContain("transfer_to_foh");
  });

  it("offers the next slot when the time was taken", () => {
    const f = describePabauBookingFailure("This slot is already booked");
    expect(f.reason).toBe("slot_taken");
  });

  it("passes an unknown Pabau message through to the caller", () => {
    const f = describePabauBookingFailure("Service requires a deposit");
    expect(f.reason).toBe("pabau_rejected");
    expect(f.message).toContain("Service requires a deposit");
  });

  it("stays speakable when Pabau sends no message at all", () => {
    const f = describePabauBookingFailure(null);
    expect(f.reason).toBe("pabau_rejected");
    expect(f.message).not.toContain("null");
  });
});
