import { describe, expect, it } from "vitest";
import {
  engineSpeedStats,
  isSpeedStatReliable,
  speedStatLabel,
  type EngineSpeedRow,
} from "@/lib/voice/call-latency-stats.shared";
import { resolveTextModel } from "@/lib/voice/llm/gpt";

const row = (call: string, model: string, tts: string, tok: number, aud: number): EngineSpeedRow => ({
  call_id: call,
  llm_model: model,
  tts_provider: tts,
  stt_to_first_token_ms: tok,
  stt_to_first_audio_ms: aud,
});

describe("engineSpeedStats", () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => row("a", "gpt-4.1-mini", "fish", 800 + i, 1800 + i)),
    ...Array.from({ length: 4 }, (_, i) => row("b", "gpt-4.1-mini", "cartesia", 700 + i, 1100 + i)),
    ...Array.from({ length: 5 }, () => row("c", "gpt-4.1", "cartesia", 3700, 4200)),
    { ...row("d", "gpt-4.1", "cartesia", 0, 0), stt_to_first_token_ms: null, stt_to_first_audio_ms: 500 },
  ];
  const s = engineSpeedStats(rows);

  it("groups first-word time by model and voice time by provider", () => {
    expect(s.models["gpt-4.1-mini"]).toMatchObject({ turns: 10, calls: 2 });
    expect(s.models["gpt-4.1"]).toMatchObject({ medianMs: 3700, turns: 5, calls: 1 });
    expect(s.voices.fish!.medianMs).toBe(1000);
    expect(s.voices.cartesia).toMatchObject({ medianMs: 500, turns: 9 });
  });

  it("needs several calls before it judges a model", () => {
    expect(isSpeedStatReliable(s.models["gpt-4.1-mini"])).toBe(true);
    expect(isSpeedStatReliable(s.models["gpt-4.1"])).toBe(false);
    expect(speedStatLabel(s.models["gpt-4.1"])).toContain("too few to judge");
    expect(speedStatLabel(undefined)).toBe("Not measured on your calls yet");
  });
});

describe("resolveTextModel", () => {
  it("runs Retell's -fast ids as the base OpenAI model", () => {
    expect(resolveTextModel("gpt-4.1-fast", "openai")).toBe("gpt-4.1");
    expect(resolveTextModel("gpt-5-mini-fast", "openai")).toBe("gpt-5-mini");
    expect(resolveTextModel("gpt-4.1-mini", "openai")).toBe("gpt-4.1-mini");
  });
});
