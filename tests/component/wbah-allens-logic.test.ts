import { describe, expect, it } from "vitest";
import {
  WBAH_DYNAMICS_STATUS,
  applyAllensLogicV5,
} from "@/lib/wbah/post-call/wbah-allens-logic.shared";

describe("applyAllensLogicV5", () => {
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
});
