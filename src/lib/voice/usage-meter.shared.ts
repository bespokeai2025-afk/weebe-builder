/**
 * Per-call usage, and its cost at the published rates (`providers/pricing.config.shared.ts`).
 *
 * What is metered, and how:
 *   LLM  tokens as the provider reports them (`usage` on each response, cached input included).
 *        A stream cut off before its usage arrives (barge-in, the slower of a hedged pair) is
 *        still billed by the provider, so it is estimated from characters (~4 per token) and
 *        flagged `estimated`.
 *   TTS  characters of text sent for synthesis (Cartesia bills per character, Fish per byte).
 *   STT  seconds of caller audio streamed to the recogniser.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

import { priceTable, tokenPriceFor, type PriceTable } from "./providers/pricing.config.shared";

export interface LlmUsage {
  provider: string;
  model: string;
  /** All input tokens, cached ones included. */
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  serviceTier?: string | null;
  estimated?: boolean;
}

export type LlmPurpose = "speech" | "routing" | "analysis" | "other";

interface LlmRow extends LlmUsage {
  purpose: LlmPurpose;
  requests: number;
}

export interface CallCostLine {
  label: string;
  quantity: string;
  usd: number;
  /** No rate for this model/provider: shown, but not priced. */
  unpriced?: boolean;
}

export interface CallCost {
  totalUsd: number;
  llmUsd: number;
  ttsUsd: number;
  sttUsd: number;
  lines: CallCostLine[];
  /** Some LLM usage was estimated from characters because the response was cut short. */
  estimated: boolean;
}

/** Rough tokens for text a provider never reported usage on. */
export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}

export class CallUsageMeter {
  private readonly llm = new Map<string, LlmRow>();
  private readonly tts = new Map<string, { provider: string; model: string; chars: number; bytes: number }>();
  private readonly stt = new Map<string, { provider: string; model: string; seconds: number; keyterms: boolean }>();

  addLlm(u: LlmUsage, purpose: LlmPurpose = "other"): void {
    const tier = u.serviceTier === "priority" || u.serviceTier === "fast" ? "fast" : "standard";
    const key = `${purpose}|${u.provider}|${u.model}|${tier}`;
    const row = this.llm.get(key) ?? {
      provider: u.provider,
      model: u.model,
      purpose,
      serviceTier: tier,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      requests: 0,
      estimated: false,
    };
    row.inputTokens += Math.max(0, u.inputTokens);
    row.cachedTokens += Math.max(0, u.cachedTokens);
    row.outputTokens += Math.max(0, u.outputTokens);
    row.requests += 1;
    row.estimated = row.estimated || !!u.estimated;
    this.llm.set(key, row);
  }

  addTts(provider: string, model: string, text: string): void {
    if (!text) return;
    const key = `${provider}|${model}`;
    const row = this.tts.get(key) ?? { provider, model, chars: 0, bytes: 0 };
    row.chars += [...text].length;
    row.bytes += new TextEncoder().encode(text).length;
    this.tts.set(key, row);
  }

  addSttAudio(provider: string, model: string, seconds: number, keyterms = false): void {
    if (!(seconds > 0)) return;
    const key = `${provider}|${model}`;
    const row = this.stt.get(key) ?? { provider, model, seconds: 0, keyterms };
    row.seconds += seconds;
    row.keyterms = row.keyterms || keyterms;
    this.stt.set(key, row);
  }

  /** Raw totals, for logs. */
  snapshot() {
    return { llm: [...this.llm.values()], tts: [...this.tts.values()], stt: [...this.stt.values()] };
  }

  cost(table: PriceTable = priceTable()): CallCost {
    const lines: CallCostLine[] = [];
    let llmUsd = 0;
    let ttsUsd = 0;
    let sttUsd = 0;
    let estimated = false;

    for (const r of this.llm.values()) {
      const price = r.provider === "openai" ? tokenPriceFor(r.model, r.serviceTier, table) : tokenPriceFor(r.model, null, table);
      const uncached = Math.max(0, r.inputTokens - r.cachedTokens);
      const usd = price
        ? (uncached * price.input + r.cachedTokens * price.cachedInput + r.outputTokens * price.output) / 1_000_000
        : 0;
      llmUsd += usd;
      estimated = estimated || !!r.estimated;
      lines.push({
        label: `LLM ${r.purpose} · ${r.model}${r.serviceTier === "fast" ? " (fast)" : ""}`,
        quantity: `${r.requests} req · ${r.inputTokens} in (${r.cachedTokens} cached) · ${r.outputTokens} out${r.estimated ? " · part estimated" : ""}`,
        usd,
        ...(price ? {} : { unpriced: true }),
      });
    }

    for (const r of this.tts.values()) {
      let usd = 0;
      let unpriced = false;
      if (r.provider === "cartesia") {
        usd = (r.chars * table.cartesiaTtsCreditsPerChar * table.cartesiaUsdPer1MCredits) / 1_000_000;
      } else if (r.provider === "fish") {
        usd = (r.bytes * table.fishTtsUsdPer1MBytes) / 1_000_000;
      } else unpriced = true;
      ttsUsd += usd;
      lines.push({ label: `TTS ${r.provider} · ${r.model}`, quantity: `${r.chars} chars`, usd, ...(unpriced ? { unpriced } : {}) });
    }

    for (const r of this.stt.values()) {
      let usd = 0;
      let unpriced = false;
      const minutes = r.seconds / 60;
      if (r.provider === "cartesia") {
        usd = (r.seconds * table.cartesiaSttCreditsPerSecond * table.cartesiaUsdPer1MCredits) / 1_000_000;
      } else if (r.provider === "deepgram") {
        const rate = table.deepgramUsdPerMin[r.model];
        if (rate === undefined) unpriced = true;
        else usd = minutes * (rate + (r.keyterms ? table.deepgramKeytermUsdPerMin : 0));
      } else if (r.provider === "fish") {
        usd = minutes * table.fishSttUsdPerMin;
      } else unpriced = true;
      sttUsd += usd;
      lines.push({
        label: `STT ${r.provider} · ${r.model}${r.keyterms && r.provider === "deepgram" ? " + keyterms" : ""}`,
        quantity: `${r.seconds.toFixed(1)} s audio`,
        usd,
        ...(unpriced ? { unpriced } : {}),
      });
    }

    return { totalUsd: llmUsd + ttsUsd + sttUsd, llmUsd, ttsUsd, sttUsd, lines, estimated };
  }
}

/** `[call_cost …]` log lines: the total, then one per metered line. */
export function callCostLogLines(cost: CallCost, durationSeconds: number | null): string[] {
  const perMin = durationSeconds && durationSeconds > 0 ? cost.totalUsd / (durationSeconds / 60) : null;
  const head =
    `[call_cost total=$${cost.totalUsd.toFixed(4)} llm=$${cost.llmUsd.toFixed(4)} tts=$${cost.ttsUsd.toFixed(4)} ` +
    `stt=$${cost.sttUsd.toFixed(4)}${perMin !== null ? ` per_min=$${perMin.toFixed(4)}` : ""}` +
    `${durationSeconds ? ` duration=${Math.round(durationSeconds)}s` : ""}${cost.estimated ? " part_estimated" : ""}]`;
  return [
    head,
    ...cost.lines.map((l) => `[call_cost_line ${l.label} | ${l.quantity} | $${l.usd.toFixed(5)}${l.unpriced ? " | NO RATE" : ""}]`),
  ];
}
