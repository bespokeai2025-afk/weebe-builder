import { describe, expect, it, vi } from "vitest";
import { CallTurnTrace } from "@/lib/voice/graph/latency-trace";

/**
 * Reproduces the real per-turn ordering: the caller starts speaking and the
 * adaptive hangover is decided from partials, both *before* the turn and its
 * trace exist. Writing those straight to the current turn put them on the
 * previous turn, which is why hangover_ms was null on every row — covered by
 * the endpointing tests below.
 */
describe("marks gathered before the trace exists", () => {
  it("logs speech-end latency consistently with persisted timing and separates TTS input wait", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const trace = new CallTurnTrace(1, 1000);
      trace.setUserSpeechStart(0);
      trace.setSttFinal(1200);
      trace.mark("tts_provider_start", 1300);
      trace.mark("tts_first_text", 1600);
      trace.mark("tts_first_audio", 2100);
      trace.flushSummary();
      expect(log.mock.calls[0][0]).toContain("speech→audio=1100ms");
      expect(log.mock.calls[0][0]).toContain("tts_input_wait=300ms");
      expect(log.mock.calls[0][0]).toContain("tts_text_to_audio=500ms");
      expect(trace.toRecord().speechToFirstAudioMs).toBe(1100);
    } finally {
      log.mockRestore();
    }
  });

  it("does not invent TTS spans when a call has no audio", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      new CallTurnTrace(1, 0).flushSummary();
      expect(log.mock.calls[0][0]).toContain("tts_input_wait=n/a");
      expect(log.mock.calls[0][0]).toContain("tts_text_to_audio=n/a");
      expect(log.mock.calls[0][0]).toContain("speech→audio=n/a");
    } finally {
      log.mockRestore();
    }
  });
  it("measures speech_to_first_audio_ms from the VAD endpoint (turnOrigin), not from when the caller started talking", () => {
    // `speechToFirstAudioMs` is documented (see the call_turns migration) as "caller stopped
    // talking → caller hears audio" — Retell's own definition of end-to-end latency. It used to
    // be measured from `userSpeechStartAt` (speech START) instead, which silently folded the
    // caller's own talking time into the number: a caller who spoke for two seconds made the
    // reported latency look two seconds worse than the system actually was, with no way to tell
    // the difference from a real regression.
    const turnOrigin = 1_400; // the VAD endpoint — caller just stopped talking
    const speechStart = 1_000; // caller had been talking since before the turn origin
    const firstAudio = 2_100;

    const trace = new CallTurnTrace(1, turnOrigin, "[test]");
    trace.setUserSpeechStart(speechStart);
    trace.setSttFinal(turnOrigin);
    trace.mark("tts_first_audio", firstAudio);

    const rec = trace.toRecord();
    expect(rec.speechToFirstAudioMs).toBe(firstAudio - turnOrigin); // 700, not 1100
    expect(rec.sttToFirstAudioMs).toBe(firstAudio - turnOrigin); // 700
    // turnOrigin is always <= sttFinalAt by causality (the endpoint fires before STT can finish
    // transcribing it), so the headline number can never legitimately come out smaller than the
    // STT-anchored one.
    expect(rec.speechToFirstAudioMs!).toBeGreaterThanOrEqual(rec.sttToFirstAudioMs!);
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
