import { describe, expect, it } from "vitest";
import {
  WBAH_DYNAMICS_STATUS,
  applyAllensLogicV5,
} from "@/lib/wbah/post-call/wbah-allens-logic.shared";

describe("applyAllensLogicV5", () => {
  it("RULE 2: booked slot (even Neutral, no Calendly URL) → Logged", () => {
    const result = applyAllensLogicV5({
      userSentiment: "Neutral",
      callbackDatetime: null,
      calendlyBookingUrl: null,
      appointmentBooked: true,
    });
    expect(result.rule).toBe("logged");
    expect(result.newCurrentStatus).toBe(WBAH_DYNAMICS_STATUS.LOGGED);
    expect(result.skipAppointmentUpdate).toBe(false);
  });

  it("RULE 2: positive + Retell appointment (no Calendly URL) → Logged", () => {
    const result = applyAllensLogicV5({
      userSentiment: "Positive",
      callbackDatetime: null,
      calendlyBookingUrl: null,
      appointmentBooked: true,
    });
    expect(result.rule).toBe("logged");
    expect(result.newCurrentStatus).toBe(WBAH_DYNAMICS_STATUS.LOGGED);
    expect(result.skipAppointmentUpdate).toBe(false);
  });

  it("RULE 3: positive without booking → Tried To Contact", () => {
    const result = applyAllensLogicV5({
      userSentiment: "Positive",
      callbackDatetime: null,
      calendlyBookingUrl: null,
      appointmentBooked: false,
    });
    expect(result.rule).toBe("tried_to_contact");
    expect(result.newCurrentStatus).toBe(WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT);
  });

  it("RULE 4: neutral/no sentiment → no update", () => {
    const result = applyAllensLogicV5({
      userSentiment: "Neutral",
      callbackDatetime: null,
      calendlyBookingUrl: null,
      appointmentBooked: false,
    });
    expect(result.rule).toBe("none");
    expect(result.skipStatusUpdate).toBe(true);
  });

  it("RULE 0: neutral + callback_datetime → Callback Request", () => {
    const result = applyAllensLogicV5({
      userSentiment: "Neutral",
      callbackDatetime: "2026-08-20T15:00:00",
      callbackDatetimeUtc: "2026-08-20T14:00:00.000Z",
      calendlyBookingUrl: null,
      appointmentBooked: false,
    });
    expect(result.rule).toBe("callback");
    expect(result.newCurrentStatus).toBe(WBAH_DYNAMICS_STATUS.CALLBACK);
    expect(result.skipStatusUpdate).toBe(false);
  });
});
