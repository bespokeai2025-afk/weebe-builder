import { describe, expect, it } from "vitest";
import { CallTurnTrace } from "@/lib/voice/graph/latency-trace";

/**
 * Reproduces the real per-turn ordering: the caller starts speaking and the
 * adaptive hangover is decided from partials, both *before* the turn and its
 * trace exist. Writing those straight to the current turn put them on the
 * previous turn, which is why speech_to_first_audio_ms came back null (or
 * nonsensically smaller than stt_to_first_audio_ms) and hangover_ms was null
 * on every row.
 */
describe("marks gathered before the trace exists", () => {
  it("records speech→audio relative to when the caller actually started", () => {
    const speechStart = 1_000;
    const sttFinal = 1_400;
    const firstAudio = 2_100;

    // Trace is constructed at STT time, after the speech already began.
    const trace = new CallTurnTrace(1, sttFinal, "[test]");
    trace.setUserSpeechStart(speechStart);
    trace.setSttFinal(sttFinal);
    trace.mark("tts_first_audio", firstAudio);

    const rec = trace.toRecord();
    expect(rec.speechToFirstAudioMs).toBe(firstAudio - speechStart); // 1100
    expect(rec.sttToFirstAudioMs).toBe(firstAudio - sttFinal); // 700
    // The headline number must never come out smaller than the STT-anchored
    // one — that inversion was the tell that the mark was on the wrong turn.
    expect(rec.speechToFirstAudioMs!).toBeGreaterThan(rec.sttToFirstAudioMs!);
  });

  it("carries the endpointing decision onto the turn it applied to", () => {
    const trace = new CallTurnTrace(2, 5_000, "[test]");
    trace.setEndpointing(900, true);
    trace.setSttFinal(5_000);
    const rec = trace.toRecord();
    expect(rec.hangoverMs).toBe(900);
    expect(rec.heldForIncomplete).toBe(true);
  });

  it("reports a base-window turn as not held", () => {
    const trace = new CallTurnTrace(3, 0, "[test]");
    trace.setEndpointing(500, false);
    expect(trace.toRecord()).toMatchObject({ hangoverMs: 500, heldForIncomplete: false });
  });

  it("leaves both null when nothing was recorded, rather than inventing zeros", () => {
    const rec = new CallTurnTrace(4, 0, "[test]").toRecord();
    expect(rec.hangoverMs).toBeNull();
    expect(rec.heldForIncomplete).toBeNull();
    expect(rec.speechToFirstAudioMs).toBeNull();
  });

  it("does not treat a turn with no timings as worth persisting", () => {
    expect(new CallTurnTrace(5, 0, "[test]").hasTimings()).toBe(false);
  });

  it("counts a turn with any usable timing as worth persisting", () => {
    const trace = new CallTurnTrace(6, 100, "[test]");
    trace.setSttFinal(100);
    trace.mark("tts_first_audio", 800);
    expect(trace.hasTimings()).toBe(true);
  });

  it("keeps the first value for a mark, so a retry cannot inflate it", () => {
    const trace = new CallTurnTrace(7, 0, "[test]");
    trace.setSttFinal(0);
    trace.mark("tts_first_audio", 500);
    trace.mark("tts_first_audio", 900);
    expect(trace.toRecord().sttToFirstAudioMs).toBe(500);
  });
});
