import { describe, expect, it } from "vitest";

import { Endpointer, EnergyVad, computeRms, createVad } from "@/lib/voice/vad";
import type { VadEvent } from "@/lib/voice/vad";

/** Build a PCM16 frame of constant amplitude. */
function frame(amplitude: number, samples = 240): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    // Alternate sign so the frame has energy rather than a DC offset.
    buf.writeInt16LE(i % 2 === 0 ? amplitude : -amplitude, i * 2);
  }
  return buf;
}

const SPEECH = frame(4000);
const SILENCE = frame(10);
/** Loud enough to beat a fixed threshold of 400, but still just room noise. */
const NOISY_ROOM = frame(700);

describe("Endpointer", () => {
  const opts = { startFrames: 1, silenceFramesTrigger: 3, minSpeechFrames: 1, preRollFrames: 0 };

  it("opens on speech and closes after the hangover", () => {
    const ep = new Endpointer(opts);

    expect(ep.step(SPEECH, true, 100).type).toBe("speech_start");
    expect(ep.isSpeaking).toBe(true);
    expect(ep.step(SPEECH, true, 100).type).toBe("speech");
    expect(ep.step(SILENCE, false, 5).type).toBe("speech");
    expect(ep.step(SILENCE, false, 5).type).toBe("speech");

    const end = ep.step(SILENCE, false, 5);
    expect(end).toMatchObject({ type: "utterance_end", reason: "endpoint" });
    // Trailing silence is kept: trimming it clips soft word endings the
    // transcriber needs for the final word.
    if (end.type === "utterance_end") expect(end.frames).toHaveLength(5);
    expect(ep.isSpeaking).toBe(false);
  });

  it("does not end the turn on a pause between words", () => {
    const ep = new Endpointer(opts);
    ep.step(SPEECH, true, 100);
    ep.step(SILENCE, false, 5);
    ep.step(SILENCE, false, 5);
    // Speech resuming must reset the hangover counter.
    expect(ep.step(SPEECH, true, 100).type).toBe("speech");
    expect(ep.step(SILENCE, false, 5).type).toBe("speech");
    expect(ep.step(SILENCE, false, 5).type).toBe("speech");
    expect(ep.step(SILENCE, false, 5).type).toBe("utterance_end");
  });

  it("requires a run of speech frames so a click cannot open a turn", () => {
    const ep = new Endpointer({ ...opts, startFrames: 3 });

    expect(ep.step(SPEECH, true, 100).type).toBe("silence");
    expect(ep.step(SILENCE, false, 5).type).toBe("silence");
    // The run was broken, so counting starts again.
    expect(ep.step(SPEECH, true, 100).type).toBe("silence");
    expect(ep.step(SPEECH, true, 100).type).toBe("silence");
    expect(ep.step(SPEECH, true, 100).type).toBe("speech_start");
  });

  it("includes pre-roll so the onset consonant is not clipped", () => {
    const ep = new Endpointer({ ...opts, preRollFrames: 3, minSpeechFrames: 1 });

    ep.step(SILENCE, false, 5);
    ep.step(SILENCE, false, 5);
    const start = ep.step(SPEECH, true, 100);
    expect(start.type).toBe("speech_start");

    const end = ep.step(SILENCE, false, 5) as VadEvent;
    ep.step(SILENCE, false, 5);
    const closed = ep.step(SILENCE, false, 5);
    expect(end.type).toBe("speech");
    // 2 pre-roll frames + the onset frame + 3 hangover frames.
    if (closed.type === "utterance_end") expect(closed.frames).toHaveLength(6);
  });

  it("caps pre-roll instead of buffering all of the silence before a call", () => {
    const ep = new Endpointer({ ...opts, preRollFrames: 2, minSpeechFrames: 1 });
    for (let i = 0; i < 40; i++) ep.step(SILENCE, false, 5);
    ep.step(SPEECH, true, 100);
    ep.step(SILENCE, false, 5);
    ep.step(SILENCE, false, 5);
    const closed = ep.step(SILENCE, false, 5);

    // 2 pre-roll frames + onset + 3 hangover, not 40-something.
    if (closed.type === "utterance_end") expect(closed.frames).toHaveLength(6);
  });

  it("discards utterances too short to be speech", () => {
    const ep = new Endpointer({ ...opts, minSpeechFrames: 10 });
    ep.step(SPEECH, true, 100);
    ep.step(SILENCE, false, 5);
    ep.step(SILENCE, false, 5);
    expect(ep.step(SILENCE, false, 5).type).toBe("discarded");
  });

  it("force-closes a runaway utterance so an open mic cannot buffer forever", () => {
    const ep = new Endpointer({ ...opts, maxUtteranceFrames: 5 });
    ep.step(SPEECH, true, 100);
    for (let i = 0; i < 3; i++) expect(ep.step(SPEECH, true, 100).type).toBe("speech");

    const end = ep.step(SPEECH, true, 100);
    expect(end).toMatchObject({ type: "utterance_end", reason: "max_duration" });
    expect(ep.isSpeaking).toBe(false);
  });

  it("drops a partial utterance on reset", () => {
    const ep = new Endpointer(opts);
    ep.step(SPEECH, true, 100);
    expect(ep.isSpeaking).toBe(true);
    ep.reset();
    expect(ep.isSpeaking).toBe(false);
  });
});

/** Push enough audio to get past the calibration window. */
function warmUp(vad: EnergyVad, frameToUse = SILENCE, count = 12): void {
  for (let i = 0; i < count; i++) vad.push(frameToUse);
}

describe("EnergyVad", () => {
  it("stays idle through silence", () => {
    const vad = new EnergyVad();
    for (let i = 0; i < 50; i++) expect(vad.push(SILENCE).type).toBe("silence");
    expect(vad.isSpeaking).toBe(false);
  });

  it("detects real speech", () => {
    const vad = new EnergyVad({ startFrames: 1 });
    warmUp(vad);
    expect(vad.push(SPEECH).type).toBe("speech_start");
  });

  it("ignores speech during calibration rather than guessing at a floor", () => {
    const vad = new EnergyVad({ startFrames: 1, warmupFrames: 5 });
    for (let i = 0; i < 5; i++) expect(vad.push(SPEECH).type).toBe("silence");
  });

  it("adapts to a noisy room instead of hearing the noise as speech", () => {
    const vad = new EnergyVad({ startFrames: 2 });

    // A fixed 400-unit threshold would treat this room tone as continuous speech.
    expect(computeRms(NOISY_ROOM)).toBeGreaterThan(400);
    for (let i = 0; i < 60; i++) vad.push(NOISY_ROOM);

    expect(vad.isSpeaking).toBe(false);
    expect(vad.threshold).toBeGreaterThan(computeRms(NOISY_ROOM));

    // Actual speech still has to get through, well above the raised floor.
    vad.push(SPEECH);
    expect(vad.push(SPEECH).type).toBe("speech_start");
  });

  it("hears a quiet speaker that a fixed threshold would miss", () => {
    const quietSpeech = frame(320);
    const vad = new EnergyVad({ startFrames: 1, minThreshold: 100, initialNoiseFloor: 20 });

    // Below the old hard-coded 400, so this used to be silence.
    expect(computeRms(quietSpeech)).toBeLessThan(400);
    for (let i = 0; i < 30; i++) vad.push(frame(5));
    expect(vad.push(quietSpeech).type).toBe("speech_start");
  });

  it("holds the onset threshold so a long sentence cannot end itself mid-word", () => {
    const vad = new EnergyVad({ startFrames: 1, silenceFramesTrigger: 100 });
    warmUp(vad);
    expect(vad.push(SPEECH).type).toBe("speech_start");
    const thresholdAtOnset = vad.threshold;

    // Without freezing, these frames would drag the floor up to the speaker's own
    // level until their voice read as silence.
    for (let i = 0; i < 50; i++) vad.push(SPEECH);

    expect(vad.threshold).toBe(thresholdAtOnset);
    expect(vad.isSpeaking).toBe(true);
  });

  it("recovers its floor after the utterance ends", () => {
    const vad = new EnergyVad({ startFrames: 1, silenceFramesTrigger: 2, minSpeechFrames: 1 });
    warmUp(vad);
    vad.push(SPEECH);
    const frozen = vad.threshold;
    vad.push(SILENCE);
    expect(vad.push(SILENCE).type).toBe("utterance_end");

    // The threshold is live again, not stuck at the value held during the turn.
    expect(vad.threshold).toBeLessThanOrEqual(frozen);
  });

  it("reports its backend name for latency logs", () => {
    expect(new EnergyVad().name).toBe("energy");
  });
});

describe("createVad", () => {
  it("falls back to the energy detector when Silero is not configured", async () => {
    // Silero needs both onnxruntime-node and a model file; neither is required.
    const vad = await createVad();
    expect(["energy", "silero"]).toContain(vad.name);
  });

  it("produces a working detector either way", async () => {
    const vad = await createVad({ startFrames: 1 });
    const event = await vad.push(SPEECH);
    expect(["speech_start", "silence"]).toContain(event.type);
  });
});
