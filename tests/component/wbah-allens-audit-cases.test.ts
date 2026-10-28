import { describe, expect, it } from "vitest";
import {
  WBAH_DYNAMICS_STATUS,
  applyAllensLogicV5,
} from "@/lib/wbah/post-call/wbah-allens-logic.shared";
import { isWbahClearDecline } from "@/lib/wbah/post-call/wbah-decline.shared";
import { isWbahExplicitDoNotContactRequest } from "@/lib/wbah/post-call/wbah-explicit-dnc.shared";

const NEW = 100000000;

function run(input: Partial<Parameters<typeof applyAllensLogicV5>[0]>) {
  return applyAllensLogicV5({
    userSentiment: "Neutral",
    callbackDatetime: null,
    calendlyBookingUrl: null,
    appointmentBooked: false,
    ...input,
  });
}

// Summaries below are the real ones from the daily-audit leads (Sept–Oct 2026).
describe("Allen's Logic — daily audit cases", () => {
  it("Joanna Hadyniak: wanted a human, transfer failed → not disqualified", () => {
    const r = run({
      userSentiment: "Negative",
      existingCurrentStatus: WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT,
      callSummary:
        "The user did not want to speak with the AI and requested a human agent. The transfer to a human agent failed due to no response. The user then requested to cancel the call.",
    });
    expect(r.newCurrentStatus).not.toBe(WBAH_DYNAMICS_STATUS.DISQUALIFIED);
    expect(r.skipStatusUpdate).toBe(true);
  });

  it("silent live answer on a new lead → Tried To Contact, not Disqualified", () => {
    const r = run({
      userSentiment: "Negative",
      existingCurrentStatus: NEW,
      callSummary: "The call was answered but no conversation took place beyond the initial greeting.",
    });
    expect(r.rule).toBe("tried_to_contact");
    expect(r.newCurrentStatus).toBe(WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT);
  });

  it("Alice Ibrahim: hostile call does not overwrite a pending callback", () => {
    const r = run({
      userSentiment: "Negative",
      existingCurrentStatus: WBAH_DYNAMICS_STATUS.CALLBACK,
      callSummary:
        "The call was answered but the user was hostile and did not want to proceed. The user threatened to report the call as spam and the agent ended the call politely.",
    });
    expect(r.skipStatusUpdate).toBe(true);
  });

  it("Anna Saliah: a voicemail or positive chat never resets Call Back Request", () => {
    for (const userSentiment of ["Neutral", "Positive"]) {
      const r = run({
        userSentiment,
        existingCurrentStatus: WBAH_DYNAMICS_STATUS.CALLBACK,
        callSummary: "Voicemail from Anna; no property details captured; call not answered.",
      });
      expect(r.skipStatusUpdate).toBe(true);
    }
  });

  it("Veronica White: neutral call with a clear decline → Disqualified", () => {
    const r = run({
      userSentiment: "Neutral",
      existingCurrentStatus: WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT,
      callSummary:
        "The call was answered and the user confirmed their details and property information but did not book a consultation as they had already spoken to a property consultant. The user declined further updates and ended the call politely.",
    });
    expect(r.rule).toBe("decline");
    expect(r.newCurrentStatus).toBe(WBAH_DYNAMICS_STATUS.DISQUALIFIED);
    expect(r.setDoNotPhone).toBe(false);
  });

  it("removal request in any sentiment → Disqualified + donotphone, even with a callback time", () => {
    const r = run({
      userSentiment: "Neutral",
      callbackDatetime: "2026-10-20T15:00:00",
      callbackDatetimeUtc: "2026-10-20T14:00:00.000Z",
      callSummary:
        "The user indicated they had already spoken to someone and requested no further calls. The agent acknowledged and ended the call politely.",
    });
    expect(r.rule).toBe("remove");
    expect(r.newCurrentStatus).toBe(WBAH_DYNAMICS_STATUS.DISQUALIFIED);
    expect(r.setDoNotPhone).toBe(true);
  });

  it("the agent's own 'we won't call again' line is not a removal request", () => {
    const r = run({
      userSentiment: "Positive",
      appointmentBooked: true,
      transcript:
        "Agent: If you'd prefer we don't call you again, just let me know.\nUser: No, that's fine, book me in.",
    });
    expect(r.rule).toBe("logged");
    expect(r.setDoNotPhone).toBe(false);
  });

  it("positive call on a disqualified lead (evening sweep) still re-opens it as Tried To Contact", () => {
    const r = run({ userSentiment: "Positive", existingCurrentStatus: WBAH_DYNAMICS_STATUS.DISQUALIFIED });
    expect(r.newCurrentStatus).toBe(WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT);
  });
});

describe("refusals on negative calls", () => {
  it("a bare refusal on a negative call is a decline", () => {
    const r = run({
      userSentiment: "Negative",
      existingCurrentStatus: WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT,
      callSummary: "The call was answered but the user declined to proceed and ended the call quickly.",
      detailedCallSummary: "Follow-up: no callback requested; no consultation with a human consultant booked.",
    });
    expect(r.rule).toBe("decline");
  });

  it("a refusal with a softer reason (busy, wants email, wants a person) is not", () => {
    for (const callSummary of [
      "The user declined to proceed with booking a consultation, stating they were busy.",
      "The user declined to proceed, requesting an email instead of a call.",
      "The user declined to proceed, preferring to speak to a person.",
    ]) {
      const r = run({ userSentiment: "Negative", existingCurrentStatus: WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT, callSummary });
      expect(r.rule, callSummary).toBe("none");
    }
  });

  it("a bare refusal on a neutral call is not a decline", () => {
    const r = run({
      userSentiment: "Neutral",
      existingCurrentStatus: WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT,
      callSummary: "The user expressed some interest in a cash price but declined to proceed.",
    });
    expect(r.rule).toBe("none");
  });
});

describe("isWbahClearDecline", () => {
  it("does not treat 'declined to book a consultation' as a decline to sell", () => {
    expect(
      isWbahClearDecline(
        "The user provided details but declined to book a consultation call, only wanting a price at the present time.",
      ),
    ).toBe(false);
  });

  it("does not treat 'not interested in speaking to an AI' as a decline", () => {
    expect(isWbahClearDecline("The user said they were not interested in speaking to an AI.")).toBe(false);
  });

  it("matches clear declines", () => {
    expect(isWbahClearDecline("The user declined to proceed with selling their property.")).toBe(true);
    expect(isWbahClearDecline("The user was not interested in selling.")).toBe(true);
    expect(isWbahClearDecline("The user said it was the wrong number.")).toBe(true);
    expect(isWbahClearDecline("The property has already sold.")).toBe(true);
    expect(isWbahClearDecline("The user stated they have not put any house up for sale.")).toBe(true);
    expect(isWbahClearDecline("The user is not considering selling their property at the moment.")).toBe(true);
  });
});

describe("isWbahExplicitDoNotContactRequest — summary phrasing", () => {
  it("matches how the AI summaries word removal requests", () => {
    expect(isWbahExplicitDoNotContactRequest("The user asked to stop receiving calls.")).toBe(true);
    expect(isWbahExplicitDoNotContactRequest("The user requested no further calls.")).toBe(true);
    expect(isWbahExplicitDoNotContactRequest("The user requested to be removed from the contact list.")).toBe(true);
    expect(isWbahExplicitDoNotContactRequest("The user requested to have their number removed from the database.")).toBe(true);
    expect(isWbahExplicitDoNotContactRequest("The user requested not to be called again.")).toBe(true);
  });
});

describe("caller turned down the AI, not the sale", () => {
  it("call_678f045434b26c8f034f8e18ecf — expected a human: Tried To Contact, not Not Interested", () => {
    const result = run({
      userSentiment: "Negative",
      existingCurrentStatus: NEW,
      callSummary:
        "The call was answered but the user declined to proceed after learning it was an AI assistant and not a human consultant. No appointment was booked.",
      detailedCallSummary:
        "The call was answered and a conversation took place. The lead was not qualified as the user declined to proceed, expecting a human consultant to call immediately. No appointment was booked. The caller identified themselves as Andrew and declined further contact.",
    });
    expect(result.rule).toBe("tried_to_contact");
    expect(result.newCurrentStatus).not.toBe(WBAH_DYNAMICS_STATUS.DISQUALIFIED);
  });

  it("call_d16899c473bfec47611fbcdb81f — asked for a human to call instead: not a decline", () => {
    expect(
      isWbahClearDecline(
        "The user declined to continue with the AI and asked to have a human call them instead, without confirming a property.",
      ),
    ).toBe(false);
  });

  it("still a decline when they also say no to selling", () => {
    expect(
      isWbahClearDecline("The user wanted to speak to a human, and said they are no longer selling the property."),
    ).toBe(true);
    expect(isWbahClearDecline("Expected a real person; not interested in selling.")).toBe(true);
  });

  it("call_47ed060ed9c07566c9720aeec38 — wanted a human, then asked to be removed: still removed", () => {
    const result = run({
      userSentiment: "Negative",
      existingCurrentStatus: NEW,
      callSummary:
        "The call was answered but the user requested to speak to a human consultant immediately. The transfer to a human agent failed, and the user then asked to be removed from the system and not contacted again.",
    });
    expect(result.rule).toBe("remove");
    expect(result.setDoNotPhone).toBe(true);
  });
});
