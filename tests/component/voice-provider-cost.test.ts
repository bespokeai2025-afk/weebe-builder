import { describe, expect, it } from "vitest";

import {
  calcVoiceProviderCostBreakdown,
  resolveTelephonyBasis,
  type VoiceProviderRateRow,
} from "@/lib/cost-engine/voice-provider-rates";

/** The defaults the migration seeds, so the maths is checked against real rates. */
const RATES: VoiceProviderRateRow[] = [
  { provider_category: "stt", provider_name: "deepgram", unit_type: "minute", cost_per_unit_usd: 0.0077 },
  { provider_category: "stt", provider_name: "assemblyai", unit_type: "minute", cost_per_unit_usd: 0.0025 },
  { provider_category: "stt", provider_name: "cartesia", unit_type: "minute", cost_per_unit_usd: 0.0024 },
  { provider_category: "stt", provider_name: "fish", unit_type: "minute", cost_per_unit_usd: 0.006 },
  { provider_category: "tts", provider_name: "fish", unit_type: "minute", cost_per_unit_usd: 0.012 },
  { provider_category: "tts", provider_name: "cartesia", unit_type: "minute", cost_per_unit_usd: 0.03 },
  { provider_category: "telephony", provider_name: "twilio_outbound_us", unit_type: "minute", cost_per_unit_usd: 0.013 },
  { provider_category: "telephony", provider_name: "twilio_inbound_us", unit_type: "minute", cost_per_unit_usd: 0.0085 },
  { provider_category: "telephony", provider_name: "web_estimate", unit_type: "minute", cost_per_unit_usd: 0.013 },
  { provider_category: "llm", provider_name: "cerebras", unit_type: "minute", cost_per_unit_usd: 0.00148 },
  { provider_category: "llm", provider_name: "openai", unit_type: "minute", cost_per_unit_usd: 0.0096 },
];

describe("resolveTelephonyBasis", () => {
  it("picks the web estimate for a browser test call regardless of direction", () => {
    expect(resolveTelephonyBasis("web_call", "outbound")).toBe("web_estimate");
    expect(resolveTelephonyBasis("web_call", "inbound")).toBe("web_estimate");
  });

  it("picks the real carrier basis for a phone call, by direction", () => {
    expect(resolveTelephonyBasis("phone_call", "outbound")).toBe("twilio_outbound_us");
    expect(resolveTelephonyBasis("phone_call", "inbound")).toBe("twilio_inbound_us");
  });
});

describe("calcVoiceProviderCostBreakdown", () => {
  it("prices STT and TTS against the specific provider the call actually used", () => {
    const b = calcVoiceProviderCostBreakdown({
      rates: RATES,
      durationMinutes: 2,
      sttProvider: "assemblyai",
      ttsProvider: "fish",
      callType: "phone_call",
      direction: "outbound",
    });
    expect(b.sttUsd).toBeCloseTo(0.0025 * 2, 10);
    expect(b.ttsUsd).toBeCloseTo(0.012 * 2, 10);
    expect(b.sttRateMissing).toBe(false);
    expect(b.ttsRateMissing).toBe(false);
  });

  // The whole point: two calls on different STT providers must cost differently, not share one
  // blended average.
  it("charges a different amount for the same duration on a different STT provider", () => {
    const onDeepgram = calcVoiceProviderCostBreakdown({
      rates: RATES,
      durationMinutes: 3,
      sttProvider: "deepgram",
      ttsProvider: null,
      callType: "phone_call",
      direction: "outbound",
    });
    const onAssemblyAi = calcVoiceProviderCostBreakdown({
      rates: RATES,
      durationMinutes: 3,
      sttProvider: "assemblyai",
      ttsProvider: null,
      callType: "phone_call",
      direction: "outbound",
    });
    expect(onDeepgram.sttUsd).not.toBeCloseTo(onAssemblyAi.sttUsd, 6);
    expect(onDeepgram.sttUsd).toBeCloseTo(0.0077 * 3, 10);
  });

  it("flags a missing rate instead of silently reporting zero", () => {
    const b = calcVoiceProviderCostBreakdown({
      rates: RATES,
      durationMinutes: 5,
      sttProvider: "some_future_provider",
      ttsProvider: null,
      callType: "phone_call",
      direction: "outbound",
    });
    expect(b.sttRateMissing).toBe(true);
    expect(b.sttUsd).toBe(0);
  });

  it("estimates telephony for a web call and marks it as belonging in the total", () => {
    const b = calcVoiceProviderCostBreakdown({
      rates: RATES,
      durationMinutes: 4,
      sttProvider: null,
      ttsProvider: null,
      callType: "web_call",
      direction: "outbound",
    });
    expect(b.telephonyBasis).toBe("web_estimate");
    expect(b.telephonyUsd).toBeCloseTo(0.013 * 4, 10);
    expect(b.telephonyIncludedInTotal).toBe(true);
  });

  it("reports telephony for a real phone call but marks it as reference-only (reconciled via carrier)", () => {
    const b = calcVoiceProviderCostBreakdown({
      rates: RATES,
      durationMinutes: 4,
      sttProvider: null,
      ttsProvider: null,
      callType: "phone_call",
      direction: "inbound",
    });
    expect(b.telephonyBasis).toBe("twilio_inbound_us");
    expect(b.telephonyUsd).toBeCloseTo(0.0085 * 4, 10);
    expect(b.telephonyIncludedInTotal).toBe(false);
  });

  it("reports zero rather than NaN for a call with no known provider at all", () => {
    const b = calcVoiceProviderCostBreakdown({
      rates: [],
      durationMinutes: 2,
      sttProvider: null,
      ttsProvider: null,
      callType: "phone_call",
      direction: "outbound",
    });
    expect(Number.isFinite(b.sttUsd)).toBe(true);
    expect(Number.isFinite(b.ttsUsd)).toBe(true);
    expect(Number.isFinite(b.telephonyUsd)).toBe(true);
    expect(b.sttUsd).toBe(0);
    expect(b.sttRateMissing).toBe(false); // no provider claimed, so nothing is "missing"
  });
});

describe("LLM cost follows the provider that actually served the call", () => {
  const base = {
    rates: RATES,
    durationMinutes: 2,
    sttProvider: "fish",
    ttsProvider: "fish",
    callType: "phone_call" as const,
    direction: "outbound" as const,
  };

  it("prices Cerebras and OpenAI differently for an identical call", () => {
    const cerebras = calcVoiceProviderCostBreakdown({ ...base, llmProvider: "cerebras" });
    const openai = calcVoiceProviderCostBreakdown({ ...base, llmProvider: "openai" });
    expect(cerebras.llmUsd).toBeCloseTo(0.00296, 6);
    expect(openai.llmUsd).toBeCloseTo(0.0192, 6);
    // The whole point: the configured-provider flat rate hid a ~6.5x difference.
    expect(openai.llmUsd / cerebras.llmUsd).toBeGreaterThan(5);
  });

  it("flags a missing rate instead of silently charging zero", () => {
    const b = calcVoiceProviderCostBreakdown({ ...base, llmProvider: "some-new-provider" });
    expect(b.llmUsd).toBe(0);
    expect(b.llmRateMissing).toBe(true);
    // Callers use this flag to fall back to the blended figure rather than under-bill.
  });

  it("does not flag a missing rate when no provider was recorded at all", () => {
    const b = calcVoiceProviderCostBreakdown({ ...base, llmProvider: null });
    expect(b.llmRateMissing).toBe(false);
    expect(b.llmProvider).toBeNull();
  });
});
