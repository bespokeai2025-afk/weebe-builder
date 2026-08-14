import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CallRecorder,
  NativeCallLifecycle,
  analyzeCall,
  buildWavFile,
  emitVoiceEvent,
  formatTranscript,
  mergeTurns,
  normalizeAnalysis,
  resolveWebhookUrl,
  setLocalBaseUrlForTests,
  signWebhookBody,
  toTranscriptObject,
  type AnalysisField,
  type VoiceWebhookPayload,
} from "@/lib/voice/lifecycle";
import { readAnalysisSchema } from "@/lib/voice/gateway/telephony-core";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  setLocalBaseUrlForTests(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("transcript assembly", () => {
  it("joins what one speaker said across several finals", () => {
    // Streaming STT splits one sentence into fragments; an unmerged transcript
    // reads as dozens of one-word turns and wrecks the analysis prompt.
    const turns = mergeTurns([
      { role: "user", text: "I wanted to ask", ts: 1 },
      { role: "user", text: "about my order", ts: 2 },
      { role: "agent", text: "Of course.", ts: 3 },
    ]);

    expect(turns).toEqual([
      { role: "user", text: "I wanted to ask. about my order", ts: 1 },
      { role: "agent", text: "Of course.", ts: 3 },
    ]);
  });

  it("does not add a second full stop when the fragment already ended one", () => {
    expect(
      mergeTurns([
        { role: "agent", text: "Hello there!", ts: 1 },
        { role: "agent", text: "How can I help?", ts: 2 },
      ])[0].text,
    ).toBe("Hello there! How can I help?");
  });

  it("orders by time and drops empty finals", () => {
    const turns = mergeTurns([
      { role: "agent", text: "Second", ts: 200 },
      { role: "user", text: "   ", ts: 150 },
      { role: "user", text: "First", ts: 100 },
    ]);
    expect(turns.map((t) => t.text)).toEqual(["First", "Second"]);
  });

  it("keeps arrival order when two turns share a millisecond", () => {
    // An agent utterance and its transcription can land in the same tick; the
    // order they arrived in is the true order.
    const turns = mergeTurns([
      { role: "agent", text: "Anything else?", ts: 500 },
      { role: "user", text: "No thanks", ts: 500 },
    ]);
    expect(turns.map((t) => t.role)).toEqual(["agent", "user"]);
  });

  it("renders both of Retell's transcript representations from the same turns", () => {
    const turns = [
      { role: "agent" as const, text: "Hi, this is Ava.", ts: 1 },
      { role: "user" as const, text: "Hello", ts: 2 },
    ];

    expect(formatTranscript(turns)).toBe("Agent: Hi, this is Ava.\nUser: Hello");
    expect(toTranscriptObject(turns)).toEqual([
      { role: "agent", content: "Hi, this is Ava." },
      { role: "user", content: "Hello" },
    ]);
  });
});

describe("post-call analysis", () => {
  const schema: AnalysisField[] = [
    { name: "customer_name", type: "string" },
    { name: "party_size", type: "number" },
    { name: "booked", type: "boolean" },
    { name: "channel", type: "enum", choices: ["phone", "web"] },
  ];

  it("coerces the types the model gets wrong", () => {
    const analysis = normalizeAnalysis(
      JSON.stringify({
        call_summary: "  The caller booked a table.  ",
        user_sentiment: "positive.",
        call_successful: "true",
        in_voicemail: "no",
        custom_analysis_data: {
          customer_name: "Dana",
          party_size: "4 people",
          booked: "yes",
          channel: "Phone",
        },
      }),
      schema,
    );

    expect(analysis.call_summary).toBe("The caller booked a table.");
    expect(analysis.user_sentiment).toBe("Positive");
    expect(analysis.call_successful).toBe(true);
    expect(analysis.in_voicemail).toBe(false);
    expect(analysis.custom_analysis_data).toEqual({
      customer_name: "Dana",
      party_size: 4,
      booked: true,
      channel: "phone",
    });
  });

  it("drops fields nobody asked for", () => {
    // Booking and CRM mappers look fields up by name, so a hallucinated
    // appointment_date must not survive.
    const analysis = normalizeAnalysis(
      JSON.stringify({
        custom_analysis_data: { customer_name: "Dana", appointment_date: "tomorrow" },
      }),
      [{ name: "customer_name", type: "string" }],
    );
    expect(analysis.custom_analysis_data).toEqual({ customer_name: "Dana" });
  });

  it("reads JSON back out of a fenced reply", () => {
    const analysis = normalizeAnalysis(
      '```json\n{"call_summary":"Short call.","user_sentiment":"Negative"}\n```',
      [],
    );
    expect(analysis.call_summary).toBe("Short call.");
    expect(analysis.user_sentiment).toBe("Negative");
  });

  it("reports unknown rather than false when the model says nothing useful", () => {
    // False would mark a real campaign contact as a failed outcome.
    expect(normalizeAnalysis("not json at all", []).call_successful).toBeNull();
  });

  it("keeps an enum with no configured choices as free text", () => {
    const analysis = normalizeAnalysis(
      JSON.stringify({ custom_analysis_data: { mood: "cheerful" } }),
      [{ name: "mood", type: "enum" }],
    );
    expect(analysis.custom_analysis_data).toEqual({ mood: "cheerful" });
  });

  it("skips the LLM entirely when the caller never spoke", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const analysis = await analyzeCall({
      turns: [{ role: "agent", text: "Hello? Anyone there?", ts: 1 }],
      durationSeconds: 8,
      apiKey: "sk-test",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(analysis.call_successful).toBe(false);
  });

  it("flags an answering machine from the shape of the call, not just keywords", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const voicemail = await analyzeCall({
      turns: [
        { role: "agent", text: "Hi, calling about your enquiry.", ts: 1 },
        { role: "user", text: "You have reached Sam. Please leave a message after the beep.", ts: 2 },
      ],
      durationSeconds: 12,
      apiKey: "",
    });
    expect(voicemail.in_voicemail).toBe(true);

    // A human who mentions leaving a message is not a machine: they took turns.
    const human = await analyzeCall({
      turns: [
        { role: "agent", text: "Is Sam available?", ts: 1 },
        { role: "user", text: "No, I can leave a message for him though", ts: 2 },
        { role: "agent", text: "Thank you.", ts: 3 },
        { role: "user", text: "No problem at all", ts: 4 },
      ],
      durationSeconds: 30,
      apiKey: "",
    });
    expect(human.in_voicemail).toBe(false);
  });
});

describe("readAnalysisSchema", () => {
  it("prefers the raw Retell schema on imported agents", () => {
    expect(
      readAnalysisSchema({
        rawAgent: {
          post_call_analysis_data: [
            { type: "enum", name: "outcome", description: "How it went", choices: ["won", "lost"] },
          ],
        },
        variables: [{ name: "ignored", description: "should not win", type: "string" }],
      }),
    ).toEqual([
      { name: "outcome", description: "How it went", type: "enum", choices: ["won", "lost"] },
    ]);
  });

  it("derives the schema from builder variables when there is no raw agent", () => {
    // Builder-built agents only have `variables`; the exporter is what turns them
    // into post_call_analysis_data, so native calls have to do the same.
    expect(
      readAnalysisSchema({
        variables: [
          { name: "customer_name", description: "Their name", type: "string", defaultValue: "Dana" },
          { name: "  ", description: "no name", type: "string", defaultValue: "" },
          { name: "missing_description", description: "", type: "string", defaultValue: "" },
        ],
      }),
    ).toEqual([
      {
        name: "customer_name",
        description: "Their name",
        type: "string",
        examples: ["Dana"],
      },
    ]);
  });

  it("degrades types it cannot extract against", () => {
    // `system-presets` is a Retell UI type, and an enum with no choices cannot be
    // validated, so both become free text.
    expect(
      readAnalysisSchema({
        rawAgent: {
          post_call_analysis_data: [
            { type: "system-presets", name: "preset", description: "d" },
            { type: "enum", name: "loose", description: "d" },
          ],
        },
      }),
    ).toEqual([
      { name: "preset", description: "d", type: "string" },
      { name: "loose", description: "d", type: "string" },
    ]);
  });

  it("returns nothing when the agent has no schema at all", () => {
    expect(readAnalysisSchema({})).toEqual([]);
  });
});

describe("webhook delivery", () => {
  it("prefers loopback over the public hostname", () => {
    // Loopback cannot be broken by proxy or TLS config, and in a sandbox the
    // public name often does not resolve from inside the box.
    process.env.PUBLIC_BASE_URL = "https://app.example.com";
    setLocalBaseUrlForTests("http://127.0.0.1:5173");

    expect(resolveWebhookUrl()).toBe("http://127.0.0.1:5173/api/public/voice-webhook");
  });

  it("falls back to the public hostname before localhost", () => {
    process.env.PUBLIC_BASE_URL = "https://app.example.com/";
    expect(resolveWebhookUrl()).toBe("https://app.example.com/api/public/voice-webhook");

    delete process.env.PUBLIC_BASE_URL;
    process.env.REPLIT_DEV_DOMAIN = "abc.replit.dev";
    expect(resolveWebhookUrl()).toBe("https://abc.replit.dev/api/public/voice-webhook");
  });

  it("honours an explicit override", () => {
    process.env.WEBEE_VOICE_WEBHOOK_URL = "https://other.example/hook";
    setLocalBaseUrlForTests("http://127.0.0.1:5173");
    expect(resolveWebhookUrl()).toBe("https://other.example/hook");
  });

  it("only signs when the receiver verifies signatures", () => {
    delete process.env.RETELL_SIGNATURE_VERIFICATION_ENABLED;
    expect(signWebhookBody("{}")).toBeNull();

    process.env.RETELL_SIGNATURE_VERIFICATION_ENABLED = "true";
    process.env.RETELL_API_KEY = "key_secret";
    const header = signWebhookBody("{}", 1_700_000_000_000);
    // Retell's v=timestamp,d=digest form, digest over body+timestamp.
    expect(header).toMatch(/^v=1700000000000,d=[0-9a-f]{64}$/);
  });

  it("retries and gives up without throwing", async () => {
    setLocalBaseUrlForTests("http://127.0.0.1:1");
    const fetchSpy = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await emitVoiceEvent({
      event: "call_ended",
      call: { call_id: "c1", agent_id: "a1", call_type: "phone_call", call_status: "ended", direction: "inbound" },
    });

    expect(result.ok).toBe(false);
    // One attempt plus the two retries.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("stops as soon as a delivery succeeds", async () => {
    setLocalBaseUrlForTests("http://127.0.0.1:1");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await emitVoiceEvent({
      event: "call_started",
      call: { call_id: "c1", agent_id: "a1", call_type: "phone_call", call_status: "registered", direction: "inbound" },
    });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("CallRecorder", () => {
  it("writes a canonical WAV header", () => {
    const wav = buildWavFile(new Int16Array([1, -1, 300]), 8_000);

    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(8_000);
    expect(wav.readUInt32LE(28)).toBe(16_000); // byte rate
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(6);
    expect(wav.readInt16LE(46)).toBe(-1);
  });

  it("places caller audio where it arrived in the call", () => {
    let now = 1_000;
    const rec = new CallRecorder({ now: () => now });

    now = 1_000 + 500; // half a second in
    rec.writeCaller(new Int16Array([100, 100]), 8_000);

    // 0.5 s of leading silence at 8 kHz, plus the two samples written.
    expect(rec.durationSeconds).toBeCloseTo(4_002 / 8_000, 5);
  });

  it("lays agent speech down contiguously instead of by arrival time", () => {
    // TTS streams a whole utterance in a burst well ahead of playback, so placing
    // it by arrival would compress speech into a fraction of its real duration.
    let now = 0;
    const rec = new CallRecorder({ now: () => now });

    rec.writeAgent(new Int16Array(8_000), 8_000); // one second of audio, instantly
    rec.writeAgent(new Int16Array(8_000), 8_000); // still the same millisecond

    expect(rec.durationSeconds).toBeCloseTo(2, 5);
  });

  it("re-syncs the agent to the clock after a gap", () => {
    let now = 0;
    const rec = new CallRecorder({ now: () => now });

    rec.writeAgent(new Int16Array(800), 8_000); // 100 ms of speech
    now = 5_000; // five seconds of conversation later
    rec.writeAgent(new Int16Array(800), 8_000);

    expect(rec.durationSeconds).toBeCloseTo(5.1, 5);
  });

  it("resets the cursor when an utterance is cut short", () => {
    let now = 0;
    const rec = new CallRecorder({ now: () => now });

    rec.writeAgent(new Int16Array(80_000), 8_000); // ten seconds queued
    rec.agentStoppedSpeaking(); // barge-in a moment later
    now = 500;
    rec.writeAgent(new Int16Array(800), 8_000);

    // The reply is placed at the interruption, not after ten seconds of audio
    // the caller never heard.
    expect(rec.durationSeconds).toBeCloseTo(10, 5);
  });

  it("mixes both directions with saturation rather than wrapping", () => {
    const rec = new CallRecorder({ now: () => 0 });
    rec.writeCaller(new Int16Array([30_000]), 8_000);
    rec.writeAgent(new Int16Array([30_000]), 8_000);

    // 60000 would wrap to a negative sample and be heard as a click.
    expect(rec.toWav().readInt16LE(44)).toBe(32_767);
  });

  it("resamples to the recording rate", () => {
    const rec = new CallRecorder({ now: () => 0 });
    rec.writeCaller(new Int16Array(24_000), 24_000);
    expect(rec.durationSeconds).toBeCloseTo(1, 3);
  });

  it("stops growing at the cap so an open line cannot exhaust memory", () => {
    let now = 0;
    const rec = new CallRecorder({ maxSeconds: 1, now: () => now });

    rec.writeCaller(new Int16Array(8_000), 8_000);
    now = 60_000;
    rec.writeCaller(new Int16Array(8_000), 8_000);

    expect(rec.durationSeconds).toBeLessThanOrEqual(1);
    expect(rec.hitLimit).toBe(true);
  });

  it("reports nothing to upload when no audio was captured", async () => {
    const rec = new CallRecorder({ now: () => 0 });
    expect(rec.isEmpty).toBe(true);
    expect(await rec.upload({} as never, { workspaceId: "w", callId: "c" })).toBeNull();
  });
});

describe("NativeCallLifecycle", () => {
  function collect() {
    const events: VoiceWebhookPayload[] = [];
    return {
      events,
      emit: async (payload: VoiceWebhookPayload) => {
        events.push(payload);
      },
    };
  }

  const identity = {
    callId: "call-1",
    agentId: "agent-uuid",
    agentName: "Ava",
    workspaceId: "ws-1",
    callType: "phone_call" as const,
    direction: "inbound" as const,
    fromNumber: "+15550100000",
    toNumber: "+15550100001",
  };

  it("emits Retell's field names so the existing processor understands it", async () => {
    const sink = collect();
    const lifecycle = new NativeCallLifecycle(identity, {
      emit: sink.emit,
      analyze: async () => ({ call_summary: "Booked.", user_sentiment: "Positive" }),
    });

    lifecycle.started();
    lifecycle.addTurn("agent", "Hi, this is Ava.");
    lifecycle.addTurn("user", "I'd like to book a table.");
    await lifecycle.ended("user_hangup");

    const started = sink.events[0].call;
    expect(started.call_id).toBe("call-1");
    expect(started.agent_id).toBe("agent-uuid");
    expect(started.call_type).toBe("phone_call");
    expect(started.direction).toBe("inbound");
    expect(started.from_number).toBe("+15550100000");
    expect(started.metadata).toMatchObject({ engine: "webee_native", workspace_id: "ws-1" });

    const ended = sink.events.find((e) => e.event === "call_ended")!.call;
    expect(ended.transcript).toBe("Agent: Hi, this is Ava.\nUser: I'd like to book a table.");
    expect(ended.transcript_object).toHaveLength(2);
    expect(ended.disconnection_reason).toBe("user_hangup");
    expect(typeof ended.end_timestamp).toBe("number");
    expect(typeof ended.duration_ms).toBe("number");
  });

  it("sends call_ended before call_analyzed", async () => {
    // Both events upsert the same row and call_ended carries no analysis, so the
    // reverse order would wipe the summary, sentiment and success flags.
    const sink = collect();
    const lifecycle = new NativeCallLifecycle(identity, {
      emit: sink.emit,
      analyze: async () => ({ call_summary: "Done." }),
    });

    lifecycle.started();
    lifecycle.addTurn("user", "Bye");
    await lifecycle.ended();

    const order = sink.events.map((e) => e.event);
    expect(order.indexOf("call_ended")).toBeLessThan(order.indexOf("call_analyzed"));
    expect(order[order.length - 1]).toBe("call_analyzed");
    expect(sink.events[sink.events.length - 1].call.call_analysis).toEqual({
      call_summary: "Done.",
    });
  });

  it("still reports the call when analysis throws", async () => {
    const sink = collect();
    const lifecycle = new NativeCallLifecycle(identity, {
      emit: sink.emit,
      analyze: async () => {
        throw new Error("openai down");
      },
    });

    lifecycle.started();
    await lifecycle.ended();

    const analyzed = sink.events.find((e) => e.event === "call_analyzed");
    expect(analyzed?.call.call_analysis).toEqual({});
  });

  it("ends only once, so a socket close after a hangup does not double-report", async () => {
    const sink = collect();
    const lifecycle = new NativeCallLifecycle(identity, {
      emit: sink.emit,
      analyze: async () => ({}),
    });

    lifecycle.started();
    await lifecycle.ended("agent_hangup");
    await lifecycle.ended("user_hangup");

    expect(sink.events.filter((e) => e.event === "call_ended")).toHaveLength(1);
  });

  it("does not emit for a call with no agent", async () => {
    const sink = collect();
    const lifecycle = new NativeCallLifecycle({ ...identity, agentId: null }, { emit: sink.emit });

    lifecycle.started();
    await lifecycle.ended();

    // The processor could only answer "unknown agent", so the request is waste.
    expect(sink.events).toHaveLength(0);
  });

  it("shows the first line immediately, then throttles", async () => {
    let now = 0;
    const sink = collect();
    const lifecycle = new NativeCallLifecycle(identity, { emit: sink.emit, now: () => now });

    lifecycle.started();
    lifecycle.addTurn("user", "one");
    lifecycle.addTurn("user", "two"); // inside the throttle window
    now = 3_000;
    lifecycle.addTurn("user", "three");

    const updates = sink.events.filter((e) => e.event === "transcript_updated");
    expect(updates).toHaveLength(2);
    // The live card would otherwise sit empty for the whole window.
    expect(updates[0].call.transcript).toBe("User: one");
    expect(updates[1].call.transcript).toContain("three");
  });

  it("keeps browser test calls out of the live transcript stream", () => {
    let now = 0;
    const sink = collect();
    const lifecycle = new NativeCallLifecycle(
      { ...identity, callType: "web_call" },
      { emit: sink.emit, now: () => now },
    );

    lifecycle.started();
    now = 10_000;
    lifecycle.addTurn("user", "testing");

    expect(sink.events.filter((e) => e.event === "transcript_updated")).toHaveLength(0);
  });

  it("reports a transfer as its own event", async () => {
    const sink = collect();
    const lifecycle = new NativeCallLifecycle(identity, {
      emit: sink.emit,
      analyze: async () => ({}),
    });

    lifecycle.started();
    lifecycle.transferred("+15551234567");
    await lifecycle.ended("user_hangup");

    const transferred = sink.events.find((e) => e.event === "call_transferred")!;
    expect(transferred.call.metadata).toMatchObject({ transfer_target: "+15551234567" });
    // Once bridged, the call ended by transfer regardless of who hung up after.
    expect(sink.events.find((e) => e.event === "call_ended")!.call.disconnection_reason).toBe(
      "call_transfer",
    );
  });

  it("reports a failure without an analysis pass", async () => {
    const sink = collect();
    const analyze = vi.fn();
    const lifecycle = new NativeCallLifecycle(identity, {
      emit: sink.emit,
      analyze: analyze as never,
    });

    lifecycle.started();
    await lifecycle.failed("dial_no_answer", "carrier reported no answer");

    expect(sink.events.map((e) => e.event)).toEqual(["call_started", "call_failed"]);
    expect(sink.events[1].call.disconnection_reason).toBe("dial_no_answer");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("prices the call when a per-minute rate is known", async () => {
    let now = 0;
    const sink = collect();
    const lifecycle = new NativeCallLifecycle(
      { ...identity, costCentsPerMinute: 3 },
      { emit: sink.emit, analyze: async () => ({}), now: () => now },
    );

    lifecycle.started();
    now = 120_000;
    await lifecycle.ended();

    expect(sink.events.find((e) => e.event === "call_ended")!.call.call_cost).toEqual({
      combined_cost: 6,
      total_duration_seconds: 120,
    });
  });
});
