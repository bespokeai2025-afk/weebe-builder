import { describe, expect, it } from "vitest";
import {
  computeTurnTimings,
  latencyMetaLines,
  summarizeLatency,
  turnMetricsLine,
} from "@/lib/voice/turn-timings.shared";

/** A turn as `call_turns` stores it: marks from the commit and from the final transcript. */
const row = {
  voice_end_to_first_audio_ms: 2282,
  end_of_speech_wait_ms: 560,
  speech_to_first_audio_ms: 1722,
  endpoint_to_stt_final_ms: 40,
  stt_to_route_ms: 12,
  stt_to_llm_request_ms: 20,
  stt_to_first_token_ms: 1300,
  stt_to_first_speakable_ms: 1390,
  stt_to_first_audio_ms: 1682,
  full_turn_ms: 6100,
};

describe("computeTurnTimings", () => {
  it("reports measured intervals, never sums of stages", () => {
    const t = computeTurnTimings(row);
    expect(t.perceivedMs).toBe(1722);
    expect(t.callerWaitMs).toBe(2282);
    expect(t.endpointingMs).toBe(560);
    expect(t.asrMs).toBe(40);
    expect(t.workflowMs).toBe(12);
    expect(t.llmRequestStartOffsetMs).toBe(60);
    expect(t.llmTtftMs).toBe(1280);
    expect(t.llmFirstSpeakableMs).toBe(1370); // the gap over TTFT is phrase buffering
    expect(t.ttsFirstAudioMs).toBe(292);
    expect(t.fullTurnMs).toBe(6100);
    expect(t.speechEndReference).toBe("estimated_from_silence");
    // Stages overlap: adding them would not give the headline.
    expect((t.asrMs ?? 0) + (t.llmTtftMs ?? 0) + (t.ttsFirstAudioMs ?? 0)).not.toBe(t.perceivedMs);
  });

  it("keeps unmeasured values null instead of zero", () => {
    const t = computeTurnTimings({ speech_to_first_audio_ms: 210 }); // a fixed line: no model call
    expect(t.perceivedMs).toBe(210);
    expect(t.llmTtftMs).toBeNull();
    expect(t.llmFirstSpeakableMs).toBeNull();
    expect(t.fullTurnMs).toBeNull();
  });

  it("labels the boundary when only the endpoint is known, rather than claiming a caller wait", () => {
    const t = computeTurnTimings({ speech_to_first_audio_ms: 900, end_of_speech_wait_ms: 500 });
    expect(t.speechEndReference).toBe("endpoint");
    expect(t.callerWaitMs).toBe(900);
    expect(t.endpointingMs).toBeNull();
  });
});

describe("summaries", () => {
  it("medians like statistics.median and takes p95 by nearest rank, skipping unmeasured turns", () => {
    expect(summarizeLatency([400, null, 100, 300, 200])).toEqual({ count: 4, median: 250, p95: 400 });
    expect(summarizeLatency([null, undefined])).toBeNull();
  });

  it("writes the per-turn metrics line and the dashboard meta lines", () => {
    const line = turnMetricsLine(3, computeTurnTimings(row), { llm_tier: "priority" });
    expect(line).toMatch(/^\[turn_metrics turn=3 perceived=1722 caller_wait=2282 endpointing=560 /);
    expect(line).toContain("llm_first_speakable=1370");
    expect(line).toMatch(/speech_end=estimated_from_silence llm_tier=priority\]$/);
    expect(latencyMetaLines([row])).toContain("[latency_median_perceived_ms=1722]");
  });
});
