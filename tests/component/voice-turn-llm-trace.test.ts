import { describe, expect, it } from "vitest";
import { CallTurnTrace } from "@/lib/voice/graph/latency-trace";
import { createTracedVmLlm, promptCharCount } from "@/lib/voice/graph/traced-llm";
import { DEFAULT_SILENCE_MS, resolveCascadeTuning } from "@/lib/voice/cascade-tuning.shared";

describe("turn trace records the reply model", () => {
  it("records the model, prompt size and STT→request time of the reply", async () => {
    const trace = new CallTurnTrace(1, 1_000);
    trace.setSttFinal(1_100);
    const llm = createTracedVmLlm(
      {
        generate: async () => "ok",
        generateStream: async function* () {
          yield "Hello";
        },
        classify: async () => 0,
        extract: async () => ({}),
      },
      () => trace,
    );
    const stream = llm.generateStream!(
      [
        { role: "system", content: "You are a receptionist." },
        { role: "user", content: "Hi" },
      ],
      { model: "gpt-oss-120b" },
    );
    for await (const _ of stream) {
      /* drain */
    }
    const rec = trace.toRecord();
    expect(rec.llmModel).toBe("gpt-oss-120b");
    expect(rec.promptChars).toBe(promptCharCount([{ content: "You are a receptionist." }, { content: "Hi" }]));
    expect(rec.sttToLlmRequestMs).not.toBeNull();
    expect(rec.sttToFirstTokenMs).not.toBeNull();
  });

  it("keeps the first reply request when a turn makes several", () => {
    const trace = new CallTurnTrace(2, 0);
    trace.setSpeechLlm("gpt-oss-120b", 1200);
    trace.setSpeechLlm("gpt-4.1", 9000);
    expect(trace.toRecord().llmModel).toBe("gpt-oss-120b");
    expect(trace.toRecord().promptChars).toBe(1200);
  });
});

describe("end-of-speech wait", () => {
  it("defaults to 400 ms when the agent leaves it unset", () => {
    expect(DEFAULT_SILENCE_MS).toBe(400);
    expect(resolveCascadeTuning({}).silenceDurationMs).toBe(400);
    expect(resolveCascadeTuning({ silenceDurationMs: undefined, responsiveness: 1 }).silenceDurationMs).toBe(400);
  });

  it("still honours an explicit setting", () => {
    expect(resolveCascadeTuning({ silenceDurationMs: 800 }).silenceDurationMs).toBe(800);
  });
});
