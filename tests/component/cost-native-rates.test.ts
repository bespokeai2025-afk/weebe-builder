import { describe, expect, it } from "vitest";

import {
  calcWebeeNativeCostPerMin,
  type WebeeNativeCost,
} from "@/lib/cost-engine/native-rates";

/** The defaults the migration seeds, so the maths is checked against real rates. */
function rates(overrides: Partial<WebeeNativeCost> = {}): WebeeNativeCost {
  return {
    id: "current",
    tts_cost_per_1m_bytes: 15,
    tts_chars_per_min: 900,
    agent_talk_ratio: 0.5,
    stt_cost_per_min: 0.006,
    llm_cost_per_min: 0.015,
    router_cost_per_min: 0.002,
    analysis_cost_per_call: 0.004,
    concurrency_tier_monthly: 0,
    estimated_monthly_minutes: 5000,
    is_current: true,
    notes: null,
    ...overrides,
  };
}

describe("calcWebeeNativeCostPerMin", () => {
  it("prices TTS from spoken characters, not wall-clock minutes", () => {
    // 900 chars/min * 0.5 talk ratio = 450 bytes/min at $15/1M bytes.
    const { tts } = calcWebeeNativeCostPerMin({ native: rates() });
    expect(tts).toBeCloseTo((450 / 1_000_000) * 15, 10);
  });

  it("halves the TTS figure when the agent talks half as much", () => {
    const full = calcWebeeNativeCostPerMin({ native: rates({ agent_talk_ratio: 0.5 }) });
    const half = calcWebeeNativeCostPerMin({ native: rates({ agent_talk_ratio: 0.25 }) });
    expect(half.tts).toBeCloseTo(full.tts / 2, 10);
  });

  it("amortises the per-call analysis pass over the call length", () => {
    const short = calcWebeeNativeCostPerMin({ native: rates(), avgCallMinutes: 1 });
    const long = calcWebeeNativeCostPerMin({ native: rates(), avgCallMinutes: 10 });
    expect(short.analysis).toBeCloseTo(0.004, 10);
    expect(long.analysis).toBeCloseTo(0.0004, 10);
  });

  it("assumes a three-minute call when none is given", () => {
    const implied = calcWebeeNativeCostPerMin({ native: rates() });
    const explicit = calcWebeeNativeCostPerMin({ native: rates(), avgCallMinutes: 3 });
    expect(implied.analysis).toBe(explicit.analysis);
  });

  it("spreads the concurrency tier over the estimated monthly minutes", () => {
    // Fish's higher tiers are prepaid, so the $1,000 tier only makes sense per
    // minute once a volume assumption is attached to it.
    const { concurrency } = calcWebeeNativeCostPerMin({
      native: rates({ concurrency_tier_monthly: 1000, estimated_monthly_minutes: 200_000 }),
    });
    expect(concurrency).toBeCloseTo(1000 / 200_000, 10);
  });

  it("keeps carrier and infrastructure costs out of the engine total", () => {
    const b = calcWebeeNativeCostPerMin({
      native: rates(),
      telephonyPerMin: 0.015,
      numberRentalMonthly: 1.15,
      infraPerMin: 0.001,
    });
    expect(b.engineTotal).toBeCloseTo(b.tts + b.stt + b.llm + b.router + b.analysis + b.concurrency, 10);
    expect(b.total).toBeCloseTo(b.engineTotal + b.telephony + b.number + b.infra, 10);
    expect(b.total).toBeGreaterThan(b.engineTotal);
  });

  it("lands near the $0.03/min the plan is costed on", () => {
    // A guard on the business case, not on the arithmetic: if seeded rates drift
    // far from this, the margin the migration was justified by has moved.
    const { engineTotal } = calcWebeeNativeCostPerMin({ native: rates() });
    expect(engineTotal).toBeGreaterThan(0.02);
    expect(engineTotal).toBeLessThan(0.045);
  });

  it("reports zero rather than NaN when no rates are configured", () => {
    // Reached whenever the admin has not filled the table in; a NaN here would
    // propagate into a stored call cost.
    const b = calcWebeeNativeCostPerMin({ native: null });
    for (const value of Object.values(b)) expect(Number.isFinite(value)).toBe(true);
    expect(b.total).toBe(0);
  });

  it("survives a zero monthly-minutes estimate", () => {
    // Division by the estimate is unavoidable; a fresh row can legitimately have
    // it unset, and the fixed costs must not become Infinity per minute.
    const b = calcWebeeNativeCostPerMin({
      native: rates({ estimated_monthly_minutes: 0 }),
      numberRentalMonthly: 1.15,
    });
    expect(Number.isFinite(b.concurrency)).toBe(true);
    expect(Number.isFinite(b.number)).toBe(true);
  });
});
