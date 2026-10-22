import { describe, expect, it } from "vitest";
import {
  nextWorkingDaySameUkTime,
  summaryAsksForCallbackWithoutTime,
} from "@/lib/wbah/post-call/wbah-callback-default.shared";
import { formatWbahRetellCallData } from "@/lib/wbah/post-call/wbah-format-data.shared";
import { WBAH_DYNAMICS_STATUS, applyAllensLogicV5 } from "@/lib/wbah/post-call/wbah-allens-logic.shared";

describe("nextWorkingDaySameUkTime", () => {
  it("Wednesday → Thursday, same UK time", () => {
    // Wed 21 Oct 2026 14:30 BST = 13:30Z
    expect(nextWorkingDaySameUkTime(Date.parse("2026-10-21T13:30:00Z"))).toEqual({
      local: "2026-10-22T14:30:00",
      utc: "2026-10-22T13:30:00.000Z",
    });
  });

  it("Friday → Monday, across the clocks going back (BST → GMT)", () => {
    // Fri 23 Oct 2026 18:05 BST = 17:05Z; Mon 26 Oct 18:05 GMT = 18:05Z
    expect(nextWorkingDaySameUkTime(Date.parse("2026-10-23T17:05:00Z"))).toEqual({
      local: "2026-10-26T18:05:00",
      utc: "2026-10-26T18:05:00.000Z",
    });
  });

  it("Saturday and Sunday → Monday", () => {
    expect(nextWorkingDaySameUkTime(Date.parse("2026-11-07T10:00:00Z"))?.local).toBe("2026-11-09T10:00:00");
    expect(nextWorkingDaySameUkTime(Date.parse("2026-11-08T10:00:00Z"))?.local).toBe("2026-11-09T10:00:00");
  });
});

describe("summaryAsksForCallbackWithoutTime", () => {
  it("matches callback asks, busy/at work/driving and line trouble", () => {
    for (const s of [
      "The user requested to reschedule the call for a later time and ended the call.", // Saeed Toumeh
      "The user declined to proceed at the moment and requested a callback later.",
      "The user said they were busy and could not talk.",
      "The user was driving.",
      "The user could not hear the agent clearly.",
      "The line was breaking up throughout.",
      "The user asked to be called back.",
    ]) {
      expect(summaryAsksForCallbackWithoutTime(s), s).toBe(true);
    }
  });

  it("ignores 'no callback requested' and calls with no such ask", () => {
    for (const s of [
      "The user reached an automated message stating that all operators were busy.",
      "The call was not answered and went to voicemail.",
      "No appointment was booked and no callback was requested.",
      "The user did not request a callback.",
      "The user declined to book a consultation and requested an email instead.",
    ]) {
      expect(summaryAsksForCallbackWithoutTime(s), s).toBe(false);
    }
  });
});

describe("format + Allen's Logic with a defaulted callback", () => {
  const startedAt = Date.parse("2026-10-01T14:03:00Z"); // Thu 1 Oct 2026 15:03 BST

  it("Saeed Toumeh: 'reschedule for a later time' → Call Back Request next working day 15:03", () => {
    const formatted = formatWbahRetellCallData({
      dynVars: {},
      custom: {
        call_summary:
          "The call was answered and the agent attempted to transfer the user to another representative but no human response was detected. The user requested to reschedule the call for a later time and ended the call.",
        callback_datetime: "",
      },
      callStartedAtMs: startedAt,
    });
    expect(formatted.callbackDatetimeSource).toBe("default_next_working_day");
    expect(formatted.callbackDatetime).toBe("2026-10-02T15:03:00");
    expect(formatted.callbackDatetimeUtc).toBe("2026-10-02T14:03:00.000Z");

    const r = applyAllensLogicV5({
      userSentiment: "Neutral",
      callbackDatetime: formatted.callbackDatetime,
      callbackDatetimeUtc: formatted.callbackDatetimeUtc,
      callbackDefaulted: true,
      calendlyBookingUrl: null,
      existingCurrentStatus: WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT,
      callSummary: formatted.callSummary,
    });
    expect(r.rule).toBe("callback");
    expect(r.newCurrentStatus).toBe(WBAH_DYNAMICS_STATUS.CALLBACK);
  });

  it("a callback time the caller actually gave is kept as-is", () => {
    const formatted = formatWbahRetellCallData({
      dynVars: {},
      custom: { callback_datetime: "2026-10-06T10:52:00", call_summary: "The user requested a callback tomorrow." },
      callStartedAtMs: startedAt,
    });
    expect(formatted.callbackDatetimeSource).toBe("callback_datetime");
    expect(formatted.callbackDatetime).toBe("2026-10-06T10:52:00");
  });

  it("junk callback_datetime ('/', 'null') is not a callback request", () => {
    for (const junk of ["/", "null", ".", "/**/null,"]) {
      const formatted = formatWbahRetellCallData({
        dynVars: {},
        custom: { callback_datetime: junk, call_summary: "The user was not interested in selling." },
        callStartedAtMs: startedAt,
      });
      expect(formatted.isCallbackRequest, junk).toBe(false);
      expect(formatted.callbackDatetime, junk).toBeNull();
      const r = applyAllensLogicV5({
        userSentiment: "Neutral",
        callbackDatetime: junk,
        callbackDatetimeUtc: null,
        calendlyBookingUrl: null,
        existingCurrentStatus: WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT,
      });
      expect(r.rule, junk).not.toBe("callback");
    }
  });

  it("junk callback_datetime plus a spoken callback ask → defaulted callback", () => {
    const formatted = formatWbahRetellCallData({
      dynVars: {},
      custom: { callback_datetime: "/", call_summary: "The user asked to be called back later on tomorrow." },
      callStartedAtMs: startedAt,
    });
    expect(formatted.callbackDatetimeSource).toBe("default_next_working_day");
  });

  it("a booking beats a defaulted callback", () => {
    const r = applyAllensLogicV5({
      userSentiment: "Positive",
      callbackDatetime: "2026-10-02T15:03:00",
      callbackDatetimeUtc: "2026-10-02T14:03:00.000Z",
      callbackDefaulted: true,
      calendlyBookingUrl: null,
      appointmentBooked: true,
      callSummary: "Appointment booked; a consultant will call back at the booked time.",
    });
    expect(r.rule).toBe("logged");
  });

  it("a clear decline beats a defaulted callback ('busy, not interested')", () => {
    const r = applyAllensLogicV5({
      userSentiment: "Negative",
      callbackDatetime: "2026-10-02T15:03:00",
      callbackDatetimeUtc: "2026-10-02T14:03:00.000Z",
      callbackDefaulted: true,
      calendlyBookingUrl: null,
      existingCurrentStatus: WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT,
      callSummary: "The user said they were busy and not interested in selling.",
    });
    expect(r.rule).toBe("decline");
  });
});
