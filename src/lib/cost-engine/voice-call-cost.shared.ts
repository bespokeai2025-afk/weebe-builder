/**
 * The one place a voice call's cost is decided.
 *
 * Before this existed the cost was computed two incompatible ways: `calls.cost_cents` was
 * written as `duration x one blended per-minute rate` (ignoring which providers served the
 * call), while every display surface recomputed a per-provider breakdown on read. The stored
 * headline and the rows beneath it therefore disagreed, and the per-provider rates — the whole
 * point of recording `stt_provider` / `tts_provider` / `llm_provider` — never reached the
 * number anyone was billed against.
 *
 * Both the writer (`NativeCallLifecycle.buildCall`) and the readers (`getTestCallCost`,
 * `getVoiceSpendDashboard`) call this. If they ever disagree again it will be because someone
 * stopped using it, not because the maths drifted.
 *
 * Relative imports only — this is reachable from the separately-bundled voice gateway.
 */

import { calcWebeeNativeCostPerMin, type WebeeNativeCost } from "./native-rates";
import {
  calcVoiceProviderCostBreakdown,
  type TelephonyBasis,
  type VoiceProviderRateRow,
} from "./voice-provider-rates";

export interface VoiceCallCostInput {
  /** The blended singleton. Null means unpriced — every figure comes back 0. */
  blended: WebeeNativeCost | null;
  /** Per-provider rows for THIS call's workspace. */
  rates: VoiceProviderRateRow[];
  durationMinutes: number;
  sttProvider: string | null;
  ttsProvider: string | null;
  llmProvider: string | null;
  callType: string | null | undefined;
  direction: string | null | undefined;
}

export interface VoiceCallCost {
  sttUsd: number;
  ttsUsd: number;
  llmUsd: number;
  routerUsd: number;
  analysisUsd: number;
  concurrencyUsd: number;
  /** Engine only — never includes telephony. This is what `cost_cents` stores. */
  engineTotalUsd: number;
  telephonyUsd: number;
  telephonyBasis: TelephonyBasis;
  /**
   * A real phone call's carrier minutes are reconciled from the carrier's own invoice, so
   * folding them in here would double-count. A browser test call has no such invoice, so its
   * estimate is the only number there is and does belong in the total.
   */
  telephonyIncludedInTotal: boolean;
  /** `engineTotalUsd`, plus telephony only when there is no invoice to reconcile against. */
  estimatedTotalUsd: number;
  sttProvider: string | null;
  ttsProvider: string | null;
  llmProvider: string | null;
  /** True when that stage fell back to the blended rate instead of its provider's own. */
  sttEstimated: boolean;
  ttsEstimated: boolean;
  llmEstimated: boolean;
}

/**
 * Price one call.
 *
 * Per stage: the rate of the provider that actually served the call wins. A stage falls back to
 * the blended figure when no provider was recorded (calls predating provider tracking) or that
 * provider has no seeded rate — a provider-specific $0 would understate the call rather than
 * merely lack detail, which is the one failure mode worth avoiding here.
 *
 * Router, analysis and concurrency have no vendor to differentiate them by: they are WEBEE's own
 * overhead and always come from the blended row.
 */
export function resolveVoiceCallCost(input: VoiceCallCostInput): VoiceCallCost {
  const minutes = Math.max(0, input.durationMinutes);

  // Pass the call's real duration, not the 3-minute default: `analysis_cost_per_call` is a
  // per-CALL charge that `calcWebeeNativeCostPerMin` amortises over this figure. Passing the
  // default made a 30-second call carry six times its share, and the writer and the readers
  // each used to pass something different.
  const perMin = calcWebeeNativeCostPerMin({
    native: input.blended,
    avgCallMinutes: minutes > 0 ? minutes : undefined,
  });

  const voice = calcVoiceProviderCostBreakdown({
    rates: input.rates,
    durationMinutes: minutes,
    sttProvider: input.sttProvider,
    ttsProvider: input.ttsProvider,
    llmProvider: input.llmProvider,
    callType: input.callType,
    direction: input.direction,
  });

  const sttEstimated = !voice.sttProvider || voice.sttRateMissing;
  const ttsEstimated = !voice.ttsProvider || voice.ttsRateMissing;
  const llmEstimated = !voice.llmProvider || voice.llmRateMissing;

  const sttUsd = sttEstimated ? perMin.stt * minutes : voice.sttUsd;
  const ttsUsd = ttsEstimated ? perMin.tts * minutes : voice.ttsUsd;
  const llmUsd = llmEstimated ? perMin.llm * minutes : voice.llmUsd;

  const routerUsd = perMin.router * minutes;
  const analysisUsd = perMin.analysis * minutes;
  const concurrencyUsd = perMin.concurrency * minutes;

  const engineTotalUsd = sttUsd + ttsUsd + llmUsd + routerUsd + analysisUsd + concurrencyUsd;

  return {
    sttUsd,
    ttsUsd,
    llmUsd,
    routerUsd,
    analysisUsd,
    concurrencyUsd,
    engineTotalUsd,
    telephonyUsd: voice.telephonyUsd,
    telephonyBasis: voice.telephonyBasis,
    telephonyIncludedInTotal: voice.telephonyIncludedInTotal,
    estimatedTotalUsd:
      engineTotalUsd + (voice.telephonyIncludedInTotal ? voice.telephonyUsd : 0),
    sttProvider: voice.sttProvider,
    ttsProvider: voice.ttsProvider,
    llmProvider: voice.llmProvider,
    sttEstimated,
    ttsEstimated,
    llmEstimated,
  };
}

/**
 * Whether this was a browser test call.
 *
 * `calls` has no web/phone flag and no `direction` column. `to_number === "web:test"` is the
 * sentinel the native engine writes, and `call_type` actually holds the inbound/outbound
 * direction (see the webhook processor's own `callType` local). Both readers had their own
 * copy of this; it lives here now so they cannot drift.
 */
export function isWebTestCall(toNumber: string | null | undefined): boolean {
  return toNumber === "web:test";
}
