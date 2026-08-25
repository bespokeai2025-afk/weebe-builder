import { describe, expect, it } from "vitest";
import {
  WBAH_DYNAMICS_AGENT_PREFERENCE,
  mapWbahCallbackTypeToAgentPreference,
  resolveWbahCallbackFromAnalysis,
} from "@/lib/wbah/post-call/wbah-callback-dynamics.shared";
import {
  buildWbahAllensCrmPayload,
} from "@/lib/wbah/post-call/wbah-crm-payload.shared";
import { applyAllensLogicV5 } from "@/lib/wbah/post-call/wbah-allens-logic.shared";
import { formatWbahRetellCallData } from "@/lib/wbah/post-call/wbah-format-data.shared";

describe("resolveWbahCallbackFromAnalysis", () => {
  it("uses callback_datetime for after_legal with AI preference", () => {
    const resolved = resolveWbahCallbackFromAnalysis({
      callback_datetime: "2026-08-20T15:00:00",
      callback_type: "after_legal",
    });
    expect(resolved.isCallbackRequest).toBe(true);
    expect(resolved.datetimeSource).toBe("callback_datetime");
    expect(resolved.callbackDatetimeUtc).toBe("2026-08-20T14:00:00.000Z");
    expect(resolved.dynamicsAgentPreference).toBe(WBAH_DYNAMICS_AGENT_PREFERENCE.AI_OR_HUMAN);
  });

  it("falls back to human_callback_datetime when callback_datetime is empty", () => {
    const resolved = resolveWbahCallbackFromAnalysis({
      human_callback_datetime: "2026-08-21T11:30:00",
      callback_type: "live_transfer_fallback",
    });
    expect(resolved.isCallbackRequest).toBe(true);
    expect(resolved.datetimeSource).toBe("human_callback_datetime");
    expect(resolved.callbackDatetime).toBe("2026-08-21T11:30:00");
    expect(resolved.dynamicsAgentPreference).toBe(WBAH_DYNAMICS_AGENT_PREFERENCE.HUMAN_ONLY);
  });

  it("uses booking_callback_datetime for AI schedule_callback types", () => {
    const resolved = resolveWbahCallbackFromAnalysis({
      booking_callback_datetime: "2026-09-01T10:00:00",
      callback_type: "beyond_booking_window",
      callback_handler: "ai",
    });
    expect(resolved.datetimeSource).toBe("booking_callback_datetime");
    expect(resolved.dynamicsAgentPreference).toBe(WBAH_DYNAMICS_AGENT_PREFERENCE.AI_OR_HUMAN);
  });

  it("prefers human_callback_datetime over callback_datetime for human types", () => {
    const resolved = resolveWbahCallbackFromAnalysis({
      human_callback_datetime: "2026-08-22T14:00:00",
      callback_datetime: "2026-08-22T09:00:00",
      callback_type: "human_callback",
    });
    expect(resolved.callbackDatetime).toBe("2026-08-22T14:00:00");
    expect(resolved.dynamicsAgentPreference).toBe(WBAH_DYNAMICS_AGENT_PREFERENCE.HUMAN_ONLY);
  });
});

describe("mapWbahCallbackTypeToAgentPreference", () => {
  it("maps live_transfer_fallback to Human Only", () => {
    expect(
      mapWbahCallbackTypeToAgentPreference({ callbackType: "live_transfer_fallback" }),
    ).toBe(WBAH_DYNAMICS_AGENT_PREFERENCE.HUMAN_ONLY);
  });

  it("maps no_slots to AI or Human", () => {
    expect(mapWbahCallbackTypeToAgentPreference({ callbackType: "no_slots" })).toBe(
      WBAH_DYNAMICS_AGENT_PREFERENCE.AI_OR_HUMAN,
    );
  });
});

describe("buildWbahAllensCrmPayload callback fields", () => {
  it("PATCHes cr_agentpreference on callback", () => {
    const formatted = formatWbahRetellCallData({
      dynVars: { lead_id: "lead-1" },
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
    const patch = buildWbahAllensCrmPayload({
      formatted,
      allens,
      calendlyBookingUrl: null,
      callbackUtc: formatted.callbackDatetimeUtc,
    });
    expect(patch.cr_agentpreference).toBe(WBAH_DYNAMICS_AGENT_PREFERENCE.AI_OR_HUMAN);
    expect(patch.cos_callbackrequest).toBe("2026-08-20T14:00:00.000Z");
  });

  it("PATCHes Human Only for live_transfer_fallback via human datetime", () => {
    const formatted = formatWbahRetellCallData({
      dynVars: { lead_id: "lead-1" },
      custom: {
        human_callback_datetime: "2026-08-21T15:00:00",
        callback_type: "live_transfer_fallback",
        callback_handler: "human",
      },
    });
    const allens = applyAllensLogicV5({
      userSentiment: formatted.userSentiment,
      callbackDatetime: formatted.callbackDatetime,
      callbackDatetimeUtc: formatted.callbackDatetimeUtc,
      callbackType: formatted.callbackType,
      calendlyBookingUrl: null,
      appointmentBooked: false,
    });
    const patch = buildWbahAllensCrmPayload({
      formatted,
      allens,
      calendlyBookingUrl: null,
      callbackUtc: formatted.callbackDatetimeUtc,
    });
    expect(patch.cr_agentpreference).toBe(WBAH_DYNAMICS_AGENT_PREFERENCE.HUMAN_ONLY);
    expect(patch.new_currentstatus).toBe(181510002);
  });
});
