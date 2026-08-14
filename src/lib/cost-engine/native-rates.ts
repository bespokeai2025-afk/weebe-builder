/**
 * WEBEE native cascade rate maths.
 *
 * Kept free of imports and server-function wrappers because both sides need it:
 * the admin cost dashboard, and the voice gateway — which is bundled separately
 * and can only reach modules through relative imports.
 */

/**
 * Editable rates for the native engine, one current row.
 *
 * Unlike Retell's single blended minute, the cascade bills four meters, so they
 * are kept apart. Only TTS needs deriving: Fish Audio charges per byte of input
 * text, so the two assumptions that convert bytes to minutes are stored as
 * fields rather than hidden in code.
 */
export interface WebeeNativeCost {
  id: string;
  tts_cost_per_1m_bytes: number;
  tts_chars_per_min: number;
  agent_talk_ratio: number;
  stt_cost_per_min: number;
  llm_cost_per_min: number;
  router_cost_per_min: number;
  analysis_cost_per_call: number;
  concurrency_tier_monthly: number;
  estimated_monthly_minutes: number;
  is_current: boolean;
  notes: string | null;
}

export interface WebeeNativeCostBreakdown {
  tts: number;
  stt: number;
  llm: number;
  router: number;
  analysis: number;
  concurrency: number;
  /** Everything the engine itself costs, per minute, in USD. */
  engineTotal: number;
  telephony: number;
  number: number;
  infra: number;
  /** Engine plus carrier plus amortised fixed costs, per minute, in USD. */
  total: number;
}

export interface NativeRateInputs {
  native: WebeeNativeCost | null;
  /** Carrier cost per minute for this call's direction. */
  telephonyPerMin?: number;
  /** Monthly number rental, amortised over estimated monthly minutes. */
  numberRentalMonthly?: number;
  infraPerMin?: number;
  /** Used only to amortise the per-call analysis pass. */
  avgCallMinutes?: number;
}

function num(v: unknown): number {
  return Number(v) || 0;
}

/**
 * Per-minute cost of one native call, in USD.
 *
 * Characters are treated as bytes when pricing TTS, which holds for ASCII and
 * understates non-Latin scripts — worth remembering before quoting a margin on
 * an Arabic or Hindi deployment.
 *
 * The analysis pass is charged per call, so it is amortised over the assumed
 * call length instead of being added at full price to every minute.
 */
export function calcWebeeNativeCostPerMin(opts: NativeRateInputs): WebeeNativeCostBreakdown {
  const native = opts.native;
  const spokenCharsPerMin = num(native?.tts_chars_per_min) * num(native?.agent_talk_ratio);
  const tts = (spokenCharsPerMin / 1_000_000) * num(native?.tts_cost_per_1m_bytes);
  const stt = num(native?.stt_cost_per_min);
  const llm = num(native?.llm_cost_per_min);
  const router = num(native?.router_cost_per_min);

  const callMinutes = opts.avgCallMinutes && opts.avgCallMinutes > 0 ? opts.avgCallMinutes : 3;
  const analysis = num(native?.analysis_cost_per_call) / callMinutes;

  const monthlyMinutes = num(native?.estimated_monthly_minutes) || 1;
  const concurrency = num(native?.concurrency_tier_monthly) / monthlyMinutes;

  const engineTotal = tts + stt + llm + router + analysis + concurrency;
  const telephony = num(opts.telephonyPerMin);
  const numberCost = num(opts.numberRentalMonthly) / monthlyMinutes;
  const infra = num(opts.infraPerMin);

  return {
    tts,
    stt,
    llm,
    router,
    analysis,
    concurrency,
    engineTotal,
    telephony,
    number: numberCost,
    infra,
    total: engineTotal + telephony + numberCost + infra,
  };
}
