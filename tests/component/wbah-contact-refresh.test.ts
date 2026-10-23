import { describe, expect, it } from "vitest";
import {
  isWbahContactUpdateCurrent,
  planWbahContactRefresh,
} from "@/lib/wbah/post-call/wbah-contact-refresh.shared";

const JULY = Date.parse("2026-07-07T10:00:00Z");
const TODAY = Date.parse("2026-10-23T08:13:00Z");

/** Danny Gee, 23 Oct: the number's row was a July contact (Rajat Kumar, DQ, booked 7 July). */
const julyRow = {
  external_id: "3c478e5c-c960-f111-a826-7c1e5236ca2a",
  start_timestamp: JULY,
  name: "Rajat Kumar",
  lead_status: "Disqualified",
  appointment_date: "2026-07-07",
  appointment_time: "2026-07-07T11:10:00.000Z",
  booking_status: "success",
  calendly_booking_url: "https://calendly.com/reschedulings/old",
  meta: null,
};

function incoming(extra: Record<string, unknown> = {}) {
  return {
    name: "Danny Gee",
    agent_name: "WBAH New Leads Agent",
    call_status: "ended",
    sentiment: "Positive",
    start_timestamp: TODAY,
    lead_status: "New",
    appointment_date: null,
    appointment_time: null,
    booking_status: null,
    calendly_booking_url: null,
    ...extra,
  };
}

describe("planWbahContactRefresh", () => {
  it("a new enquiry on a known number replaces the name, status and old booking", () => {
    const patch = planWbahContactRefresh({
      existing: julyRow,
      incoming: incoming({
        appointment_date: "2026-10-23",
        appointment_time: "2026-10-23T08:35:00.000Z",
        booking_status: "success",
        calendly_booking_url: "https://calendly.com/reschedulings/new",
      }),
      leadId: "071c8b75-b9ce-f111-a05a-70a8a581f497",
      hasOutcome: true,
      callDate: "2026-10-23",
    })!;
    expect(patch.name).toBe("Danny Gee");
    expect(patch.full_name).toBe("Danny Gee");
    expect(patch.lead_status).toBe("New");
    expect(patch.external_id).toBe("071c8b75-b9ce-f111-a05a-70a8a581f497");
    expect(patch.appointment_date).toBe("2026-10-23");
    expect(patch.calendly_booking_url).toBe("https://calendly.com/reschedulings/new");
    expect(patch.start_timestamp).toBe(TODAY);
  });

  it("a new enquiry with no booking clears the old one", () => {
    const patch = planWbahContactRefresh({
      existing: julyRow,
      incoming: incoming(),
      leadId: "new-lead",
      hasOutcome: true,
      callDate: "2026-10-23",
    })!;
    expect(patch.appointment_date).toBeNull();
    expect(patch.calendly_booking_url).toBeNull();
  });

  it("same lead, no booking on this call: a past appointment is cleared, a future one kept", () => {
    const sameLead = { ...julyRow, external_id: "lead-1" };
    const past = planWbahContactRefresh({
      existing: sameLead,
      incoming: incoming(),
      leadId: "lead-1",
      hasOutcome: true,
      callDate: "2026-10-23",
    })!;
    expect(past.appointment_date).toBeNull();
    expect(past.lead_status).toBeUndefined();

    const future = planWbahContactRefresh({
      existing: { ...sameLead, appointment_date: "2026-10-30" },
      incoming: incoming(),
      leadId: "lead-1",
      hasOutcome: true,
      callDate: "2026-10-23",
    })!;
    expect("appointment_date" in future).toBe(false);
  });

  it("keeps the confirmed link when this call repeats the same appointment without it", () => {
    const patch = planWbahContactRefresh({
      existing: { ...julyRow, external_id: "lead-1", appointment_date: "2026-10-23" },
      incoming: incoming({ appointment_date: "2026-10-23", booking_status: "pending" }),
      leadId: "lead-1",
      hasOutcome: true,
      callDate: "2026-10-23",
    })!;
    expect(patch.calendly_booking_url).toBe("https://calendly.com/reschedulings/old");
    expect(patch.booking_status).toBe("success");
  });

  it("call_ended (no outcome yet) refreshes call fields but never touches the booking", () => {
    const patch = planWbahContactRefresh({
      existing: { ...julyRow, external_id: "lead-1" },
      incoming: incoming({ sentiment: null }),
      leadId: "lead-1",
      hasOutcome: false,
      callDate: "2026-10-23",
    })!;
    expect(patch.name).toBe("Danny Gee");
    expect("sentiment" in patch).toBe(false);
    expect("appointment_date" in patch).toBe(false);
  });

  it("an older call never overwrites a newer row", () => {
    expect(
      planWbahContactRefresh({
        existing: { ...julyRow, start_timestamp: TODAY },
        incoming: incoming({ start_timestamp: JULY }),
        leadId: "x",
        hasOutcome: true,
        callDate: "2026-07-07",
      }),
    ).toBeNull();
    expect(isWbahContactUpdateCurrent({ start_timestamp: TODAY }, JULY)).toBe(false);
    expect(isWbahContactUpdateCurrent({ start_timestamp: JULY }, TODAY)).toBe(true);
    expect(isWbahContactUpdateCurrent(undefined, JULY)).toBe(true);
  });
});
