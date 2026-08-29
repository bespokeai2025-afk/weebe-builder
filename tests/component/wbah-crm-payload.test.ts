import { describe, expect, it } from "vitest";
import {
  WBAH_DYNAMICS_STATUS,
  applyAllensLogicV5,
} from "@/lib/wbah/post-call/wbah-allens-logic.shared";
import {
  buildWbahAllensCrmPayload,
  filterValidDynamicsFields,
} from "@/lib/wbah/post-call/wbah-crm-payload.shared";
import { formatWbahRetellCallData } from "@/lib/wbah/post-call/wbah-format-data.shared";

describe("filterValidDynamicsFields", () => {
  it("keeps numeric option-set and statecode values", () => {
    expect(
      filterValidDynamicsFields({
        new_currentstatus: WBAH_DYNAMICS_STATUS.CALLBACK,
        statecode: 0,
        cos_callbackrequest: "2026-08-20T14:00:00.000Z",
      }),
    ).toEqual({
      new_currentstatus: 181510002,
      statecode: 0,
      cos_callbackrequest: "2026-08-20T14:00:00.000Z",
    });
  });

  it("coerces numeric option strings to numbers", () => {
    expect(filterValidDynamicsFields({ new_currentstatus: "181510002" })).toEqual({
      new_currentstatus: 181510002,
    });
  });
});

describe("buildWbahAllensCrmPayload — callback (Amal Samine scenario)", () => {
  it("includes Callback Request status on Neutral + callback_datetime", () => {
    const formatted = formatWbahRetellCallData({
      dynVars: { lead_id: "3646b979-e59b-f111-b8dc-7c1e5236ca2a" },
      custom: {
        callback_datetime: "2026-08-20T15:00:00",
        callback_type: "after_legal",
      },
      callAnalysis: { user_sentiment: "Neutral" },
    });

    const allens = applyAllensLogicV5({
      userSentiment: formatted.userSentiment,
      callbackDatetime: formatted.callbackDatetime,
      callbackDatetimeUtc: formatted.callbackDatetimeUtc,
      callbackType: formatted.callbackType,
      calendlyBookingUrl: null,
      appointmentBooked: false,
    });

    expect(allens.rule).toBe("callback");

    const patch = buildWbahAllensCrmPayload({
      formatted,
      allens,
      calendlyBookingUrl: null,
      callbackUtc: formatted.callbackDatetimeUtc,
    });

    expect(patch.new_currentstatus).toBe(WBAH_DYNAMICS_STATUS.CALLBACK);
    expect(patch.statecode).toBe(0);
    expect(patch.cos_callbackrequest).toBe("2026-08-20T14:00:00.000Z");
    expect(patch.cos_user_sentiment).toBe("Neutral");
  });
});

describe("buildWbahAllensCrmPayload — booked slot without Calendly URL", () => {
  it("writes appointment date/time and clears stale callback (Anthony)", () => {
    const formatted = formatWbahRetellCallData({
      dynVars: { lead_id: "29c6caa3-06a2-f111-b8db-70a8a57daaff", email: "" },
      custom: {
        calendly_slot: JSON.stringify({ preferred_slot: { date: "2026-08-28", time: "09:25" } }),
        email_address: "antw9@hotmail.com",
        detailed_call_summary: "Appointment booked for Friday 28 August at 9:25 AM UK time.",
        structured_json_output: JSON.stringify({
          verified_details: {
            firstname: "Anthony",
            lastname: "Warrington",
            emailaddress1: "antw9@hotmail.com",
            cos_call_summary: "Three-bedroom semi booked 28 Aug 9:25.",
          },
        }),
      },
      callAnalysis: { user_sentiment: "Positive" },
    });

    const allens = applyAllensLogicV5({
      userSentiment: formatted.userSentiment,
      callbackDatetime: formatted.callbackDatetime,
      callbackDatetimeUtc: formatted.callbackDatetimeUtc,
      calendlyBookingUrl: null,
      appointmentBooked: formatted.hasBookingSlot,
    });
    expect(allens.rule).toBe("logged");

    const patch = buildWbahAllensCrmPayload({
      formatted,
      allens,
      calendlyBookingUrl: null,
      callbackUtc: formatted.callbackDatetimeUtc,
    });

    expect(patch.cos_appointment_date).toBe("2026-08-28");
    expect(patch.cos_appointment_time).toBeTruthy();
    expect(patch.cos_callbackrequest).toBeNull();
    expect(patch.cos_calendly_booking_url).toBeUndefined();
    expect(patch.emailaddress1).toBe("antw9@hotmail.com");
    expect(patch.cos_user_sentiment).toBe("Positive");
    expect(String(patch.cos_call_summary)).toContain("Three-bedroom");
  });
});