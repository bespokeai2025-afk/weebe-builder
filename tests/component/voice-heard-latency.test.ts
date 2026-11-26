import { describe, expect, it } from "vitest";

import { Endpointer } from "@/lib/voice/vad";
import { CallTurnTrace } from "@/lib/voice/graph/latency-trace";
import { pcm16FrameBytes, regroupPcm16 } from "@/lib/voice/gateway/audio";
import { resolveCascadeTuning, VAD_FRAME_MS } from "@/lib/voice/cascade-tuning.shared";

const frame = (bytes: number) => Buffer.alloc(bytes, 1);

describe("caller audio regrouping", () => {
  it("turns Twilio's 20 ms chunks into 50 ms VAD frames", () => {
    const frameBytes = pcm16FrameBytes(8000, VAD_FRAME_MS); // 400 samples
    expect(frameBytes).toBe(800);
    const twilioChunk = 160 * 2; // 20 ms of 8 kHz PCM16
    let remainder = Buffer.alloc(0);
    let emitted = 0;
    for (let i = 0; i < 25; i++) {
      // 25 × 20 ms = 500 ms → exactly 10 frames
      const out = regroupPcm16(remainder, frame(twilioChunk), frameBytes);
      remainder = out.remainder;
      for (const f of out.frames) expect(f.byteLength).toBe(frameBytes);
      emitted += out.frames.length;
    }
    expect(emitted).toBe(10);
    expect(remainder.byteLength).toBe(0);
  });

  it("passes the browser's 50 ms chunks straight through", () => {
    const frameBytes = pcm16FrameBytes(24000, VAD_FRAME_MS);
    const out = regroupPcm16(Buffer.alloc(0), frame(1200 * 2), frameBytes);
    expect(out.frames).toHaveLength(1);
    expect(out.remainder.byteLength).toBe(0);
  });

  it("makes the configured end-of-speech wait last that long on a phone call", () => {
    const tuning = resolveCascadeTuning({ silenceDurationMs: 400 });
    // Frames are counted after regrouping, so 400 ms is 8 frames of 50 ms, on every transport.
    expect(tuning.vad.silenceFramesTrigger! * VAD_FRAME_MS).toBe(400);
  });
});

describe("Endpointer trailing silence", () => {
  it("reports how many silent frames closed the utterance", () => {
    const ep = new Endpointer({
      startFrames: 1,
      silenceFramesTrigger: 3,
      minSpeechFrames: 1,
      preRollFrames: 0,
    });
    const s = frame(4);
    ep.step(s, true, 100);
    ep.step(s, true, 100);
    ep.step(s, false, 1);
    ep.step(s, false, 1);
    const end = ep.step(s, false, 1);
    expect(end).toMatchObject({
      type: "utterance_end",
      reason: "endpoint",
      trailingSilenceFrames: 3,
    });
  });
});

describe("heard latency on the turn trace", () => {
  it("measures from the caller's last word, including the end-of-speech wait", () => {
    const voiceEnd = 1_000;
    const turnOrigin = 1_560; // 400 ms wait + 160 ms coalescing
    const trace = new CallTurnTrace(1, turnOrigin, "[test]");
    trace.setVoiceEnd(voiceEnd);
    trace.setSttFinal(1_950);
    trace.mark("tts_first_audio", 2_700);
    const rec = trace.toRecord();
    expect(rec.endOfSpeechWaitMs).toBe(560);
    expect(rec.voiceEndToFirstAudioMs).toBe(1_700);
    expect(rec.speechToFirstAudioMs).toBe(1_140); // unchanged meaning: from the turn origin
  });

  it("leaves both null when the last word was not recorded", () => {
    const trace = new CallTurnTrace(2, 1_000, "[test]");
    trace.mark("tts_first_audio", 1_800);
    expect(trace.toRecord()).toMatchObject({
      voiceEndToFirstAudioMs: null,
      endOfSpeechWaitMs: null,
    });
  });
});
