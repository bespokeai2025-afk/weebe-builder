/**
 * Google Ads conversion tracking for website Ava bookings — pure-logic
 * contract tests (no network, no DB).
 *
 * Covers the spec's trigger + dedup rules:
 *  - booking conversion fires ONLY on a genuine Cal.com tool result with a
 *    real UID (never verbal claims / extracted fields);
 *  - conversion-action resolution per conversion name (map, env override,
 *    observation-only never falls back to the primary action);
 *  - order_id (booking UID) is the provider transaction id;
 *  - consent gating (denied blocks upload);
 *  - GA4 payload shape + dedup reference.
 */
import { describe, it, expect } from "vitest";
import {
  decideInitialStatus,
  OBSERVATION_ONLY_CONVERSIONS,
} from "@/lib/tracking/conversion-events.server";
import {
  resolveConversionActionId,
  buildIngestEventsBody,
} from "@/lib/tracking/datamanager-upload.server";
import { buildGa4Payload, ga4ClientId } from "@/lib/tracking/ga4-events.server";
import { verifyCalBookingFromToolCalls } from "@/lib/lead-gen/ava-web-call.server";

const target = {
  operatingAccountId: "1234567890",
  loginAccountId: null,
  productDestinationId: "987654321",
};

describe("resolveConversionActionId", () => {
  const env = {} as Record<string, string | undefined>;

  it("uses the explicit per-name mapping when present (string JSON)", () => {
    const creds = {
      uploadConversionActionId: "111222333",
      conversionActionMap: JSON.stringify({ ava_appointment_booked: "444555666" }),
    };
    expect(resolveConversionActionId(creds, "ava_appointment_booked", env)).toBe("444555666");
  });

  it("falls back to the default action for standard conversions", () => {
    const creds = { uploadConversionActionId: "111222333" };
    expect(resolveConversionActionId(creds, "ava_qualified_lead", env)).toBe("111222333");
    expect(resolveConversionActionId(creds, "webform_lead", env)).toBe("111222333");
  });

  it("observation-only names NEVER fall back to the primary action", () => {
    expect(OBSERVATION_ONLY_CONVERSIONS.has("ava_call_started")).toBe(true);
    const creds = { uploadConversionActionId: "111222333" };
    // A microphone click must not count against the booking/lead action.
    expect(resolveConversionActionId(creds, "ava_call_started", env)).toBeNull();
    // …but an explicit mapping enables it.
    const mapped = { ...creds, conversionActionMap: JSON.stringify({ ava_call_started: "777888999" }) };
    expect(resolveConversionActionId(mapped, "ava_call_started", env)).toBe("777888999");
  });

  it("env override wins for the booking conversion", () => {
    const creds = {
      uploadConversionActionId: "111222333",
      conversionActionMap: JSON.stringify({ ava_appointment_booked: "444555666" }),
    };
    expect(
      resolveConversionActionId(creds, "ava_appointment_booked", {
        GOOGLE_ADS_AVA_BOOKING_CONVERSION_ACTION_ID: "313131313",
      }),
    ).toBe("313131313");
  });

  it("rejects non-numeric ids", () => {
    expect(resolveConversionActionId({ uploadConversionActionId: "abc" }, "webform_lead", env)).toBeNull();
  });
});

describe("decideInitialStatus (consent + attribution honesty)", () => {
  it("blocks upload when consent is denied, even with a click id", () => {
    expect(decideInitialStatus({ duplicateOfLead: false, hasClickId: true, consentDenied: true }))
      .toBe("consent_blocked");
  });
  it("records with click id, no_attribution without", () => {
    expect(decideInitialStatus({ duplicateOfLead: false, hasClickId: true, consentDenied: false }))
      .toBe("recorded");
    expect(decideInitialStatus({ duplicateOfLead: false, hasClickId: false, consentDenied: false }))
      .toBe("no_attribution");
  });
  it("duplicate suppression wins over everything", () => {
    expect(decideInitialStatus({ duplicateOfLead: true, hasClickId: true, consentDenied: true }))
      .toBe("duplicate_suppressed");
  });
});

describe("buildIngestEventsBody — order id + consent", () => {
  const baseEv = {
    eventId: "evt-1",
    conversionName: "ava_appointment_booked",
    source: "ava_web_call",
    createdAt: "2026-08-01T12:53:21.000Z",
    gclid: "TeStGcLiD_123456",
    gbraid: null,
    wbraid: null,
  };

  it("uses the Cal.com booking UID as the transaction id when present", () => {
    const body = buildIngestEventsBody(target, { ...baseEv, orderId: "cal-uid-abc123" }, false) as any;
    expect(body.events[0].transactionId).toBe("cal-uid-abc123");
  });

  it("falls back to the ledger event id without an order id", () => {
    const body = buildIngestEventsBody(target, baseEv, false) as any;
    expect(body.events[0].transactionId).toBe("evt-1");
  });

  it("sends exactly one click identifier (gclid preferred)", () => {
    const body = buildIngestEventsBody(
      target,
      { ...baseEv, gbraid: "AlsoValidBraid123", wbraid: "AlsoValidWbraid12" },
      false,
    ) as any;
    expect(body.events[0].adIdentifiers).toEqual({ gclid: "TeStGcLiD_123456" });
  });

  it("passes explicit consent through", () => {
    const granted = buildIngestEventsBody(target, { ...baseEv, adUserDataConsent: "granted" }, false) as any;
    expect(granted.events[0].consent.adUserData).toBe("CONSENT_GRANTED");
    const denied = buildIngestEventsBody(target, { ...baseEv, adUserDataConsent: "denied" }, false) as any;
    expect(denied.events[0].consent.adUserData).toBe("CONSENT_DENIED");
  });
});

describe("verifyCalBookingFromToolCalls — booking conversion trigger rules", () => {
  const toolCall = (result: unknown) => ({
    transcript_with_tool_calls: [
      { role: "tool_call_invocation", tool_call_id: "t1", name: "book_appointment_cal" },
      {
        role: "tool_call_result",
        tool_call_id: "t1",
        content: typeof result === "string" ? result : JSON.stringify(result),
      },
    ],
  });

  it("confirms ONLY on a successful tool result with a real UID (case A)", () => {
    const v = verifyCalBookingFromToolCalls(
      toolCall({ status: "success", data: { uid: "abc123uid", start: "2026-08-08T15:00:00Z" } }) as never,
    );
    expect(v.confirmed).toBe(true);
    expect(v.uid).toBe("abc123uid");
  });

  it("verbal claim / transcript text alone never confirms (case C)", () => {
    const v = verifyCalBookingFromToolCalls({
      transcript: "Great, your booking is confirmed for Friday!",
      call_analysis: { custom_analysis_data: { booking_status: "booked", booking_slot: "Friday 3pm" } },
    } as never);
    expect(v.confirmed).toBe(false);
    expect(v.uid).toBeNull();
  });

  it("tool result without a UID never confirms", () => {
    const v = verifyCalBookingFromToolCalls(toolCall({ status: "success", data: {} }) as never);
    expect(v.confirmed).toBe(false);
  });

  it("pending / non-success statuses never confirm", () => {
    const v = verifyCalBookingFromToolCalls(
      toolCall({ status: "pending", data: { uid: "abc123uid" } }) as never,
    );
    expect(v.confirmed).toBe(false);
  });

  it("a generic id (not uid/booking_uid) never confirms", () => {
    const v = verifyCalBookingFromToolCalls(
      toolCall({ status: "success", data: { id: 998877 } }) as never,
    );
    expect(v.confirmed).toBe(false);
  });

  it("error tool results never confirm", () => {
    const v = verifyCalBookingFromToolCalls(
      toolCall({ status: "error", error: "email_validation_error" }) as never,
    );
    expect(v.confirmed).toBe(false);
  });
});

describe("GA4 payload", () => {
  it("builds a deterministic client id and transaction reference", () => {
    const p = buildGa4Payload({
      name: "ava_appointment_booked",
      clientRef: "visitor-123",
      transactionId: "cal-uid-abc123",
      params: { source: "ava_web_call" },
    }) as any;
    expect(p.client_id).toBe(ga4ClientId("visitor-123"));
    expect(p.events[0].params.transaction_id).toBe("cal-uid-abc123");
  });
  it("returns null with no usable reference (never fabricates identity)", () => {
    expect(buildGa4Payload({ name: "x", clientRef: null })).toBeNull();
  });
  it("falls back to the call id so retries stay consistent", () => {
    const a = buildGa4Payload({ name: "x", clientRef: null, fallbackRef: "call_1" }) as any;
    const b = buildGa4Payload({ name: "x", clientRef: null, fallbackRef: "call_1" }) as any;
    expect(a.client_id).toBe(b.client_id);
  });
});
