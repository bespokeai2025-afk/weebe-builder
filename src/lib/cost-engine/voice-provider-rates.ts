/**
 * Provider-accurate voice cost lookups.
 *
 * `provider_cost_rates` already exists for email/image/video/WhatsApp/etc — this is the first
 * thing to read/write it for voice's "stt"/"tts"/"telephony" categories, seeded by
 * `supabase/migrations/20261006000000_voice_provider_cost.sql`. LLM/router/analysis/concurrency
 * stay on the older blended `cost_engine_webee_native` rate (see `native-rates.ts`) — those are
 * WEBEE's own classifier/analysis overhead, not a single vendor's per-minute meter, so there is
 * no "provider" to differentiate by in the same sense STT/TTS have one.
 *
 * Kept import-free of server-function wrappers for the same reason `native-rates.ts` is: the
 * voice gateway bundle reaches this through relative imports, not the server-fn transform.
 */

export interface VoiceProviderRateRow {
  provider_category: string;
  provider_name: string;
  unit_type: string;
  cost_per_unit_usd: number;
}

function findRate(
  rates: VoiceProviderRateRow[],
  category: string,
  providerName: string,
  unitType = "minute",
): number | null {
  const row = rates.find(
    (r) =>
      r.provider_category === category &&
      r.provider_name === providerName &&
      r.unit_type === unitType,
  );
  return row ? Number(row.cost_per_unit_usd) : null;
}

export type TelephonyBasis = "twilio_outbound_us" | "twilio_inbound_us" | "web_estimate";

export function resolveTelephonyBasis(
  callType: string | null | undefined,
  direction: string | null | undefined,
): TelephonyBasis {
  if (callType === "web_call") return "web_estimate";
  return direction === "inbound" ? "twilio_inbound_us" : "twilio_outbound_us";
}

export interface VoiceCostBreakdownInput {
  rates: VoiceProviderRateRow[];
  durationMinutes: number;
  sttProvider: string | null;
  ttsProvider: string | null;
  /** Provider that actually served the call's LLM turns, after any mid-call fallback. */
  llmProvider: string | null;
  callType: string | null | undefined;
  direction: string | null | undefined;
}

export interface VoiceCostBreakdown {
  sttUsd: number;
  sttProvider: string | null;
  /** True when no rate was found for `sttProvider` and this fell back to $0 rather than guessing. */
  sttRateMissing: boolean;
  ttsUsd: number;
  ttsProvider: string | null;
  ttsRateMissing: boolean;
  llmUsd: number;
  llmProvider: string | null;
  llmRateMissing: boolean;
  telephonyUsd: number;
  telephonyBasis: TelephonyBasis;
  /**
   * Real carrier minutes (a phone call) are reconciled from the carrier's own invoice — adding
   * this into a total here would double-count (see `lifecycle/cost.ts`). A web test call has no
   * such invoice, so its estimate is the only number there is, and belongs in the total.
   */
  telephonyIncludedInTotal: boolean;
}

/** USD, not cents — callers convert once at the end, same as `calcWebeeNativeCostPerMin`. */
export function calcVoiceProviderCostBreakdown(input: VoiceCostBreakdownInput): VoiceCostBreakdown {
  const minutes = Math.max(0, input.durationMinutes);
  const sttRate = input.sttProvider ? findRate(input.rates, "stt", input.sttProvider) : null;
  const ttsRate = input.ttsProvider ? findRate(input.rates, "tts", input.ttsProvider) : null;
  const llmRate = input.llmProvider ? findRate(input.rates, "llm", input.llmProvider) : null;

  const telephonyBasis = resolveTelephonyBasis(input.callType, input.direction);
  const telephonyRate = findRate(input.rates, "telephony", telephonyBasis) ?? 0;

  return {
    sttUsd: (sttRate ?? 0) * minutes,
    sttProvider: input.sttProvider,
    sttRateMissing: !!input.sttProvider && sttRate == null,
    ttsUsd: (ttsRate ?? 0) * minutes,
    ttsProvider: input.ttsProvider,
    ttsRateMissing: !!input.ttsProvider && ttsRate == null,
    llmUsd: (llmRate ?? 0) * minutes,
    llmProvider: input.llmProvider,
    llmRateMissing: !!input.llmProvider && llmRate == null,
    telephonyUsd: telephonyRate * minutes,
    telephonyBasis,
    telephonyIncludedInTotal: telephonyBasis === "web_estimate",
  };
}
