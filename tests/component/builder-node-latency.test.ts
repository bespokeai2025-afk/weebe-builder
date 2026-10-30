/** Per-step response time on the builder canvas. */
import { describe, expect, it } from "vitest";
import { nodeLatencySummary } from "@/lib/voice/call-latency-stats.shared";

const turn = (node: string | null, ms: number | null, route = "heuristic", prompt?: number) => ({
  node_id: node,
  speech_to_first_audio_ms: ms,
  stt_to_first_audio_ms: ms == null ? 900 : ms - 400,
  edge_route_method: route,
  prompt_chars: prompt ?? null,
});

describe("nodeLatencySummary", () => {
  it("medians per step, slowest first, with the model-routed share", () => {
    const out = nodeLatencySummary([
      turn("greet", 1000),
      turn("greet", 1200),
      turn("greet", 1400),
      turn("qualify", 2500, "llm", 4000),
      turn("qualify", 3000, "heuristic", 6000),
      turn(null, 9999),
    ]);
    expect(out.map((n) => n.nodeId)).toEqual(["qualify", "greet"]);
    expect(out[0]).toMatchObject({ turns: 2, p50: 2500, p90: 3000, modelRoutedShare: 0.5, promptCharsP50: 4000 });
    expect(out[1]).toMatchObject({ turns: 3, p50: 1200, modelRoutedShare: 0, promptCharsP50: null });
  });

  it("falls back to STT → first audio when speech end was not recorded", () => {
    const [n] = nodeLatencySummary([turn("a", null)]);
    expect(n!.p50).toBe(900);
  });
});
