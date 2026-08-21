import { describe, expect, it } from "vitest";
import { isWbahExplicitDoNotContactRequest } from "@/lib/wbah/post-call/wbah-explicit-dnc.shared";
import {
  WBAH_DYNAMICS_STATUS,
  applyAllensLogicV5,
} from "@/lib/wbah/post-call/wbah-allens-logic.shared";
import { buildWbahAllensCrmPayload } from "@/lib/wbah/post-call/wbah-crm-payload.shared";

describe("isWbahExplicitDoNotContactRequest", () => {
  it("matches explicit remove-details requests (Dixon Dixon case)", () => {
    expect(
      isWbahExplicitDoNotContactRequest(
        "The user declined and requested their details to be removed. The agent confirmed removal.",
      ),
    ).toBe(true);
  });

  it("matches stop calling / do not call phrasing", () => {
    expect(isWbahExplicitDoNotContactRequest("Please don't call me again")).toBe(true);
    expect(isWbahExplicitDoNotContactRequest("Take me off your list")).toBe(true);
  });

  it("does not match not-interested-only negative calls", () => {
    expect(
      isWbahExplicitDoNotContactRequest(
        "The user was not interested in selling their property. No appointment was booked.",
      ),
    ).toBe(false);
  });
});

describe("applyAllensLogicV5 negative + DNC", () => {
  it("Disqualified without donotphone when negative but no explicit removal", () => {
    const result = applyAllensLogicV5({
      userSentiment: "Negative",
      callbackDatetime: null,
      calendlyBookingUrl: null,
      callSummary: "User was not interested in selling. No removal requested.",
    });
    expect(result.rule).toBe("negative");
    expect(result.newCurrentStatus).toBe(WBAH_DYNAMICS_STATUS.DISQUALIFIED);
    expect(result.setDoNotPhone).toBe(false);

    const patch = buildWbahAllensCrmPayload({
      formatted: {
        userSentiment: "Negative",
        callSummary: "User was not interested in selling.",
        verifiedDetails: {},
        structuredJsonOutput: {},
        email: null,
        requestedStartUtc: null,
        appointmentDate: null,
      } as any,
      allens: result,
      calendlyBookingUrl: null,
      callbackUtc: null,
    });
    expect(patch.donotphone).toBeUndefined();
  });

  it("Disqualified + donotphone when negative and explicit removal", () => {
    const summary =
      "User was not interested and requested their details to be removed. Agent confirmed.";
    const result = applyAllensLogicV5({
      userSentiment: "Negative",
      callbackDatetime: null,
      calendlyBookingUrl: null,
      detailedCallSummary: summary,
    });
    expect(result.setDoNotPhone).toBe(true);

    const patch = buildWbahAllensCrmPayload({
      formatted: {
        userSentiment: "Negative",
        callSummary: summary,
        verifiedDetails: { cos_sourcetype: "181510001" },
        structuredJsonOutput: {},
        email: null,
        requestedStartUtc: null,
        appointmentDate: null,
      } as any,
      allens: result,
      calendlyBookingUrl: null,
      callbackUtc: null,
    });
    expect(patch.donotphone).toBe(true);
    expect(patch.new_currentstatus).toBe(WBAH_DYNAMICS_STATUS.DISQUALIFIED);
  });

  it("already Disqualified + explicit DNC → donotphone only", () => {
    const result = applyAllensLogicV5({
      userSentiment: "Negative",
      callbackDatetime: null,
      calendlyBookingUrl: null,
      existingCurrentStatus: WBAH_DYNAMICS_STATUS.DISQUALIFIED,
      detailedCallSummary: "User asked to be removed from the call list.",
    });
    expect(result.skipStatusUpdate).toBe(true);
    expect(result.setDoNotPhone).toBe(true);
  });

  it("already Disqualified + negative without explicit DNC → no donotphone", () => {
    const result = applyAllensLogicV5({
      userSentiment: "Negative",
      callbackDatetime: null,
      calendlyBookingUrl: null,
      existingCurrentStatus: WBAH_DYNAMICS_STATUS.DISQUALIFIED,
      callSummary: "Not interested in selling at this time.",
    });
    expect(result.setDoNotPhone).toBe(false);
  });
});