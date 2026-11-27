import { describe, expect, it } from "vitest";

import { CallTurnTrace } from "@/lib/voice/graph/latency-trace";
import { ConversationVm } from "@/lib/voice/graph/vm";
import type { ConversationFlow, LlmMessage, VmDirective, VmLlm } from "@/lib/voice/graph/types";

/** A scripted line, then a generated one behind an edge the "yes" heuristic resolves. */
function scriptedThenGenerated(globalPrompt = ""): ConversationFlow {
  return {
    start_node_id: "legal",
    start_speaker: "agent",
    ...(globalPrompt ? { global_prompt: globalPrompt } : {}),
    nodes: [
      {
        id: "legal",
        type: "conversation",
        instruction: { type: "static_text", text: "Our service is free to use. Does that sound ok?" },
        edges: [
          {
            id: "e1",
            destination_node_id: "name",
            transition_condition: { type: "prompt", prompt: "User says yes or confirms" },
          },
        ],
      },
      {
        id: "name",
        type: "conversation",
        instruction: { type: "prompt", text: "Ask for the caller's first name." },
      },
      {
        id: "postcode",
        type: "conversation",
        model_choice: { model: "other-model" },
        instruction: { type: "prompt", text: "Ask for the postcode." },
      } as ConversationFlow["nodes"][number],
    ],
  };
}

type StreamCall = { messages: LlmMessage[]; model?: string; signal?: AbortSignal; untraced?: boolean };

function recordingLlm(reply = "Can I just check your first name?") {
  const streams: StreamCall[] = [];
  const warmed: Array<{ messages: LlmMessage[]; model?: string }> = [];
  const llm: VmLlm = {
    generate: async () => reply,
    async *generateStream(messages, opts) {
      streams.push({ messages, ...opts });
      yield reply;
    },
    classify: async () => 0,
    extract: async () => ({}),
    warm: async (messages, opts) => {
      warmed.push({ messages, model: opts?.model });
    },
  };
  return { llm, streams, warmed };
}

async function drain(gen: AsyncGenerator<VmDirective>): Promise<string[]> {
  const spoken: string[] = [];
  for await (const d of gen) {
    if (d.type !== "speak") continue;
    if (d.text) spoken.push(d.text);
    else if (d.textStream) {
      let full = "";
      for await (const chunk of d.textStream) full += chunk;
      spoken.push(full);
    }
  }
  return spoken;
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("pre-endpoint speech", () => {
  it("goes through the VM's client, untraced, and replaces the run when the caller says more", async () => {
    const { llm, streams } = recordingLlm();
    const vm = new ConversationVm({ flow: scriptedThenGenerated(), llm, model: "speech-model" });
    await drain(vm.run({ type: "begin" }));
    const target = vm.peekSpeechWarmTarget("yes");
    expect(target?.kind).toBe("prompt");
    if (target?.kind !== "prompt") return;

    vm.startPreEndpointSpeech(target, "yes");
    vm.startPreEndpointSpeech(target, "yes it is");
    await tick();

    expect(streams).toHaveLength(2);
    expect(streams.every((s) => s.untraced === true && s.model === target.model)).toBe(true);
    // The first run was for words the caller has since added to.
    expect(streams[0]!.signal?.aborted).toBe(true);
    expect(streams[1]!.signal?.aborted).toBe(false);
  });

  it("records the adopted run's request and first token on the turn that speaks it", async () => {
    const { llm, streams } = recordingLlm();
    const vm = new ConversationVm({ flow: scriptedThenGenerated(), llm, model: "speech-model" });
    await drain(vm.run({ type: "begin" }));
    const target = vm.peekSpeechWarmTarget("yes");
    if (target?.kind !== "prompt") throw new Error("expected a generated destination");

    vm.startPreEndpointSpeech(target, "yes");
    await tick(5); // the reply's first token lands while the caller is still in the end-of-speech wait

    const trace = new CallTurnTrace(3, Date.now(), "[test]");
    trace.setSttFinal(Date.now());
    vm.setTurnTrace(trace);
    const spoken = await drain(vm.run({ type: "user_utterance", text: "Yes." }));

    expect(spoken.join(" ")).toContain("Can I just check your first name?");
    expect(streams).toHaveLength(1); // adopted, not generated again
    const rec = trace.toRecord();
    expect(rec.speculativeHit).toBe(true);
    expect(rec.llmModel).toBe(target.model);
    expect(rec.promptChars).toBeGreaterThan(0);
    // Both happened before the final transcript: that part of the model's wait was hidden.
    expect(rec.sttToLlmRequestMs).not.toBeNull();
    expect(rec.sttToLlmRequestMs!).toBeLessThan(0);
    expect(rec.sttToFirstTokenMs).not.toBeNull();
    expect(rec.sttToFirstTokenMs!).toBeLessThanOrEqual(0);
  });
});

describe("speech prompt warm-up", () => {
  it("warms each model a generated line uses, with the exact prefix every reply starts with", async () => {
    const { llm, warmed } = recordingLlm();
    const vm = new ConversationVm({
      flow: scriptedThenGenerated("You are Clare, calling about a property enquiry."),
      llm,
      model: "speech-model",
    });
    vm.warmSpeechPrompt();
    await drain(vm.run({ type: "begin" }));

    expect(warmed.map((w) => w.model).sort()).toEqual(["other-model", "speech-model"]);
    const prefix = String(warmed[0]!.messages[0]!.content);
    expect(prefix).toContain("You are Clare");

    const target = vm.peekSpeechWarmTarget("yes");
    if (target?.kind !== "prompt") throw new Error("expected a generated destination");
    // The provider caches by leading bytes, so the real reply must open with the warmed text.
    expect(String(target.messages[0]!.content).startsWith(`${prefix}\n`)).toBe(true);
  });

  it("sends nothing when the call has no shared prompt to cache", () => {
    const { llm, warmed } = recordingLlm();
    const vm = new ConversationVm({ flow: scriptedThenGenerated(), llm, model: "speech-model" });
    vm.warmSpeechPrompt();
    expect(warmed).toEqual([]);
  });
});

describe("finished STT segments before the endpoint", () => {
  type Caps = { partials: boolean; segmentFinalsBeforeEndpoint: boolean; partialCanReplaceFinal: boolean };
  type Probe = {
    sttCaps: Caps;
    callerSpeaking: boolean;
    finalSegmentsThisUtterance: string[];
    onCallerPartial(text: string, opts?: { alreadyStable?: boolean }): void;
    onCallerSegmentFinal(text: string): void;
    withFinishedSegments(text: string): string;
  };

  async function probe(caps: Caps) {
    const { CascadeSession } = await import("@/lib/voice/gateway/cascade-session");
    const s = Object.create(CascadeSession.prototype) as Probe;
    const seen: Array<{ text: string; stable: boolean }> = [];
    s.sttCaps = caps;
    s.callerSpeaking = true;
    s.finalSegmentsThisUtterance = [];
    s.onCallerPartial = (text, opts) => seen.push({ text, stable: !!opts?.alreadyStable });
    return { s, seen };
  }

  it("starts pre-endpoint work from a segment on a provider that also streams partials", async () => {
    // A one-word reply on Deepgram can arrive only as a finished segment, with no partial first.
    const { s, seen } = await probe({ partials: true, segmentFinalsBeforeEndpoint: true, partialCanReplaceFinal: false });
    s.onCallerSegmentFinal("Yes.");
    expect(seen).toEqual([{ text: "Yes.", stable: true }]);
  });

  it("joins a partial onto the segments before it, since the partial restarts at each one", async () => {
    const { s } = await probe({ partials: true, segmentFinalsBeforeEndpoint: true, partialCanReplaceFinal: false });
    s.finalSegmentsThisUtterance = ["It's a three bed,"];
    expect(s.withFinishedSegments("semi detached")).toBe("It's a three bed, semi detached");
  });

  it("leaves partials alone on a provider without segment finals", async () => {
    const { s, seen } = await probe({ partials: true, segmentFinalsBeforeEndpoint: false, partialCanReplaceFinal: false });
    s.onCallerSegmentFinal("Yes.");
    expect(seen).toEqual([]);
    expect(s.withFinishedSegments("yes")).toBe("yes");
  });

  it("ignores a segment that lands after the caller's utterance has ended", async () => {
    const { s, seen } = await probe({ partials: true, segmentFinalsBeforeEndpoint: true, partialCanReplaceFinal: false });
    s.callerSpeaking = false;
    s.onCallerSegmentFinal("Yes.");
    expect(seen).toEqual([]);
  });
});

describe("utterance coalescing without a partial to read", () => {
  type Coalescer = {
    englishTurnRules: boolean;
    sttLanguage: string;
    partialNormalized: string;
    utteranceCoalesceMs: number;
    utteranceCoalesceTimer: ReturnType<typeof setTimeout> | null;
    pendingUtteranceFrames: Buffer[];
    utteranceSpeechStartAt: number | null;
    utteranceVoiceEndAt: number | null;
    turnPipeline: Promise<void>;
    burstTranscripts: { request(f: () => Promise<string>): void };
    processTurn(...args: unknown[]): Promise<void>;
    scheduleUtteranceProcessing(): void;
  };

  async function coalescer(transcript: string, transcriptMs: number) {
    const { CascadeSession } = await import("@/lib/voice/gateway/cascade-session");
    const { BurstTranscripts } = await import("@/lib/voice/gateway/burst-transcripts");
    const s = Object.create(CascadeSession.prototype) as Coalescer;
    let processedAt: number | null = null;
    Object.assign(s, {
      englishTurnRules: true,
      sttLanguage: "en",
      partialNormalized: "", // a provider that sends no partials (Cartesia)
      utteranceCoalesceMs: 160,
      utteranceCoalesceTimer: null,
      pendingUtteranceFrames: [Buffer.alloc(320)],
      utteranceSpeechStartAt: null,
      utteranceVoiceEndAt: null,
      turnPipeline: Promise.resolve(),
      burstTranscripts: new BurstTranscripts(),
      processTurn: async () => {
        processedAt = Date.now();
      },
    });
    s.burstTranscripts.request(() => new Promise((r) => setTimeout(() => r(transcript), transcriptMs)));
    const start = Date.now();
    s.scheduleUtteranceProcessing();
    return { s, start, processed: () => processedAt };
  }

  it("ends the wait once the transcript shows a complete short answer", async () => {
    const { start, processed } = await coalescer("Yes.", 10);
    await tick(80);
    expect(processed()).not.toBeNull();
    expect(processed()! - start).toBeLessThan(120);
  });

  it("keeps the full wait for words the caller may carry on from", async () => {
    const { start, processed } = await coalescer("24 Manhattan Street", 10);
    await tick(80);
    expect(processed()).toBeNull();
    await tick(140);
    expect(processed()! - start).toBeGreaterThanOrEqual(150);
  });

  it("does nothing once the caller has started speaking again", async () => {
    const { s, processed } = await coalescer("Yes.", 30);
    // speech_start clears the timer: the next burst belongs to the same turn.
    clearTimeout(s.utteranceCoalesceTimer!);
    s.utteranceCoalesceTimer = null;
    await tick(220);
    expect(processed()).toBeNull();
  });
});
