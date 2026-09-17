import { describe, expect, it } from "vitest";
import {
  LATENCY_BUDGET_MS,
  percentiles,
  routeMethodShare,
  speculationStat,
  stageBreakdown,
  withinBudget,
  type CallTurnRow,
} from "@/lib/voice/call-latency-stats.shared";

function turn(i: number, over: Partial<CallTurnRow> = {}): CallTurnRow {
  return {
    call_id: "call_1",
    turn_index: i,
    speech_to_first_audio_ms: 700,
    endpoint_to_stt_final_ms: 120,
    stt_to_route_ms: 40,
    stt_to_first_token_ms: 180,
    stt_to_first_sentence_ms: 260,
    stt_to_first_audio_ms: 420,
    edge_route_method: "heuristic",
    global_route_method: "global_skip",
    speculative_hit: false,
    partial_commit: false,
    interrupted: false,
    node_id: "n1",
    created_at: "2026-09-16T10:00:00.000Z",
    ...over,
  };
}

describe("percentiles", () => {
  it("uses nearest rank, never inventing a value no turn took", () => {
    const p = percentiles([100, 200, 300, 400])!;
    expect([100, 200, 300, 400]).toContain(p.p50);
    expect(p.max).toBe(400);
    expect(p.count).toBe(4);
  });

  it("handles a single turn — the common case right after one test call", () => {
    expect(percentiles([512])).toEqual({ p50: 512, p90: 512, p95: 512, max: 512, count: 1 });
  });

  it("returns null rather than zero when nothing was measured", () => {
    expect(percentiles([])).toBeNull();
    expect(percentiles([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
  });
});

describe("withinBudget", () => {
  it("reports the share at or under the 800ms budget", () => {
    const rows = [
      turn(0, { speech_to_first_audio_ms: 600 }),
      turn(1, { speech_to_first_audio_ms: 800 }),
      turn(2, { speech_to_first_audio_ms: 1400 }),
    ];
    const b = withinBudget(rows);
    expect(b.budgetMs).toBe(LATENCY_BUDGET_MS);
    expect(b.measured).toBe(3);
    // 800 is inside the budget, not outside it.
    expect(b.within).toBe(2);
  });

  it("falls back to stt→audio when the speech mark is missing", () => {
    const rows = [turn(0, { speech_to_first_audio_ms: null, stt_to_first_audio_ms: 300 })];
    expect(withinBudget(rows).measured).toBe(1);
  });

  it("does not claim 0% when there is simply nothing measured", () => {
    const rows = [turn(0, { speech_to_first_audio_ms: null, stt_to_first_audio_ms: null })];
    expect(withinBudget(rows)).toMatchObject({ measured: 0, within: 0, share: 0 });
  });
});

describe("routeMethodShare", () => {
  const rows = [
    turn(0, { edge_route_method: "heuristic", stt_to_first_audio_ms: 300 }),
    turn(1, { edge_route_method: "heuristic", stt_to_first_audio_ms: 340 }),
    turn(2, { edge_route_method: "llm", stt_to_first_audio_ms: 900 }),
    turn(3, { edge_route_method: null, stt_to_first_audio_ms: 200 }),
  ];

  it("shows how often an LLM classify sat on the critical path", () => {
    const llm = routeMethodShare(rows, "edge").find((m) => m.method === "llm")!;
    expect(llm.turns).toBe(1);
    expect(llm.share).toBeCloseTo(0.25);
  });

  it("reports cost per method, so a rare slow path cannot hide", () => {
    const share = routeMethodShare(rows, "edge");
    const llm = share.find((m) => m.method === "llm")!;
    const heuristic = share.find((m) => m.method === "heuristic")!;
    expect(llm.medianMs!).toBeGreaterThan(heuristic.medianMs!);
  });

  it("buckets a missing method as none rather than dropping the turn", () => {
    expect(routeMethodShare(rows, "edge").find((m) => m.method === "none")?.turns).toBe(1);
    expect(routeMethodShare(rows, "edge").reduce((n, m) => n + m.turns, 0)).toBe(rows.length);
  });
});

describe("speculationStat", () => {
  it("reports savings, not just a hit rate", () => {
    const rows = [
      turn(0, { speculative_hit: true, speech_to_first_audio_ms: 400 }),
      turn(1, { speculative_hit: true, speech_to_first_audio_ms: 420 }),
      turn(2, { speculative_hit: false, speech_to_first_audio_ms: 800 }),
    ];
    const s = speculationStat(rows);
    expect(s.hits).toBe(2);
    expect(s.hitRate).toBeCloseTo(2 / 3);
    // Positive savedMs = speculation is earning its token cost.
    expect(s.savedMs!).toBeGreaterThan(0);
  });

  it("shows negative savings honestly when speculation is not helping", () => {
    const rows = [
      turn(0, { speculative_hit: true, speech_to_first_audio_ms: 900 }),
      turn(1, { speculative_hit: false, speech_to_first_audio_ms: 500 }),
    ];
    expect(speculationStat(rows).savedMs!).toBeLessThan(0);
  });

  it("withholds a savings figure until both groups exist", () => {
    const rows = [turn(0, { speculative_hit: true, speech_to_first_audio_ms: 400 })];
    expect(speculationStat(rows).savedMs).toBeNull();
  });
});

describe("stageBreakdown", () => {
  it("covers every stage of the turn, in pipeline order", () => {
    const stages = stageBreakdown([turn(0)]);
    expect(stages.map((s) => s.key)).toEqual([
      "endpoint_to_stt_final_ms",
      "stt_to_route_ms",
      "stt_to_first_token_ms",
      "stt_to_first_sentence_ms",
      "stt_to_first_audio_ms",
      "speech_to_first_audio_ms",
    ]);
  });

  it("marks an unmeasured stage null instead of zero", () => {
    const stages = stageBreakdown([turn(0, { stt_to_route_ms: null })]);
    expect(stages.find((s) => s.key === "stt_to_route_ms")!.stats).toBeNull();
    expect(stages.find((s) => s.key === "stt_to_first_audio_ms")!.stats!.p50).toBe(420);
  });
});
