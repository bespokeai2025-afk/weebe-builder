import { describe, expect, it } from "vitest";
import { confirmedBookingFromCallOutputReply } from "@/lib/wbah/post-call/wbah-webespoke-writer.server";

describe("confirmedBookingFromCallOutputReply", () => {
  it("reads the reschedulings/ link the backend attached to the saved call", () => {
    const reply = {
      result: true,
      statuscode: 200,
      message: "Call output data created successfully",
      data: {
        calendly_booking_url: "https://calendly.com/reschedulings/90799b13-c1fb",
        appointment_date: "2026-10-23",
        appointment_time: "1:35 PM",
        booking_status: "success",
      },
    };
    expect(confirmedBookingFromCallOutputReply(reply)).toEqual({
      calendlyBookingUrl: "https://calendly.com/reschedulings/90799b13-c1fb",
      appointmentDate: "2026-10-23",
      appointmentTime: "1:35 PM",
    });
  });

  it("ignores slot-picker links and replies without a booking", () => {
    expect(
      confirmedBookingFromCallOutputReply({ data: { calendly_booking_url: "https://calendly.com/d/dv4k-5gp-7fb/2026" } }),
    ).toBeNull();
    expect(confirmedBookingFromCallOutputReply({ data: { calendly_booking_url: null } })).toBeNull();
    expect(confirmedBookingFromCallOutputReply(null)).toBeNull();
  });
});
