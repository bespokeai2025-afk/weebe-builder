/**
 * What one WEBEE Native call costs, priced from what it actually used.
 *
 * Rates are the providers' published list prices, read 2026-11-27:
 *   OpenAI   developers.openai.com/api/docs/pricing — USD per 1M tokens (input / cached / output).
 *            "Fast" is what OpenAI renamed priority processing on 2026-07-30
 *            (`service_tier: "priority"` / `"fast"`, see WEBEE_NATIVE_OPENAI_SERVICE_TIER).
 *   Cartesia cartesia.ai/pricing — Sonic TTS 1 credit per character; Ink STT 3 credits per second.
 *            A credit's dollar value depends on the plan: Scale is $299 for 8M ($37.4 per 1M),
 *            Startup $49 for 1.25M ($39.2 per 1M); overage is $38 / $45 / $65 per 1M.
 *   Deepgram deepgram.com/pricing — Pay As You Go streaming, per minute. Nova-3 and Flux are on
 *            promotional rates; the regular ones are noted beside them.
 *   Fish     $15 per 1M UTF-8 bytes of input text.
 *
 * Every rate can be overridden without a deploy: WEBEE_NATIVE_PRICES takes JSON in the shape of
 * `PriceTable` (only the fields you set change), e.g.
 *   {"cartesiaUsdPer1MCredits":45,"llm":{"gpt-4.1":{"input":2,"cachedInput":0.5,"output":8}}}
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

export interface TokenPrice {
  /** USD per 1M tokens. */
  input: number;
  cachedInput: number;
  output: number;
}

export interface PriceTable {
  /** Standard tier, by model id. */
  llm: Record<string, TokenPrice>;
  /** Fast (priority) tier, by model id; a model without a row is priced at standard. */
  llmFast: Record<string, TokenPrice>;
  cartesiaUsdPer1MCredits: number;
  cartesiaTtsCreditsPerChar: number;
  cartesiaSttCreditsPerSecond: number;
  /** USD per minute of streamed audio, by Deepgram model id. */
  deepgramUsdPerMin: Record<string, number>;
  deepgramKeytermUsdPerMin: number;
  fishTtsUsdPer1MBytes: number;
  /** Fish streaming STT, USD per minute. */
  fishSttUsdPerMin: number;
}

export const DEFAULT_PRICES: PriceTable = {
  llm: {
    "gpt-4.1": { input: 2.0, cachedInput: 0.5, output: 8.0 },
    "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
    // Not on the current standard table; its last published rate.
    "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
    "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
    "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
    "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
    "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
    "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  },
  llmFast: {
    "gpt-4.1": { input: 3.5, cachedInput: 0.875, output: 14.0 },
    "gpt-4.1-mini": { input: 0.7, cachedInput: 0.175, output: 2.8 },
    "gpt-4o-mini": { input: 0.25, cachedInput: 0.125, output: 1.0 },
    "gpt-5-mini": { input: 0.45, cachedInput: 0.045, output: 3.6 },
  },
  // Scale-plan credit value. Startup is ~39.2, overage 38–65 depending on plan.
  cartesiaUsdPer1MCredits: 37.4,
  cartesiaTtsCreditsPerChar: 1,
  cartesiaSttCreditsPerSecond: 3,
  deepgramUsdPerMin: {
    "nova-3": 0.0048, // promo; regular 0.0077
    "nova-3-multilingual": 0.0058, // promo; regular 0.0092
    "nova-3-medical": 0.0077,
    "nova-2": 0.0058,
    "flux-general-en": 0.0065, // promo; regular 0.0077
    "flux-general-multi": 0.0078,
  },
  deepgramKeytermUsdPerMin: 0.0013,
  fishTtsUsdPer1MBytes: 15,
  fishSttUsdPerMin: 0.006,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

let cached: { raw: string | undefined; table: PriceTable } | null = null;

/** The price table, with WEBEE_NATIVE_PRICES applied over the defaults. */
export function priceTable(): PriceTable {
  const raw = typeof process !== "undefined" ? process.env?.WEBEE_NATIVE_PRICES : undefined;
  if (cached && cached.raw === raw) return cached.table;
  let table = DEFAULT_PRICES;
  if (raw && raw.trim()) {
    try {
      const o = JSON.parse(raw) as unknown;
      if (isRecord(o)) {
        table = {
          ...DEFAULT_PRICES,
          ...(o as Partial<PriceTable>),
          llm: { ...DEFAULT_PRICES.llm, ...(isRecord(o.llm) ? (o.llm as PriceTable["llm"]) : {}) },
          llmFast: { ...DEFAULT_PRICES.llmFast, ...(isRecord(o.llmFast) ? (o.llmFast as PriceTable["llmFast"]) : {}) },
          deepgramUsdPerMin: {
            ...DEFAULT_PRICES.deepgramUsdPerMin,
            ...(isRecord(o.deepgramUsdPerMin) ? (o.deepgramUsdPerMin as Record<string, number>) : {}),
          },
        };
      }
    } catch {
      console.warn("[voice-pricing] WEBEE_NATIVE_PRICES is not valid JSON — using the default rates");
    }
  }
  cached = { raw, table };
  return table;
}

/**
 * The model's row, matching a dated snapshot ("gpt-4.1-2025-04-14") to its family. Longest id
 * first, so "gpt-4.1-mini-…" never prices as "gpt-4.1".
 */
export function tokenPriceFor(model: string, tier: string | null | undefined, table = priceTable()): TokenPrice | null {
  const id = model.trim().toLowerCase();
  const fast = tier === "priority" || tier === "fast";
  const find = (rows: Record<string, TokenPrice>) => {
    if (rows[id]) return rows[id]!;
    const key = Object.keys(rows)
      .sort((a, b) => b.length - a.length)
      .find((k) => id.startsWith(`${k}-`));
    return key ? rows[key]! : null;
  };
  return (fast ? find(table.llmFast) : null) ?? find(table.llm);
}
