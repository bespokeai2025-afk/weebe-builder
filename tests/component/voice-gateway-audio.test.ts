import { describe, expect, it } from "vitest";

import {
  base64ToPcm16,
  mulawBytesToPcm16,
  mulawDecode,
  mulawEncode,
  pcm16ToBase64,
  pcm16ToMulawBase64,
  resample,
} from "@/lib/voice/gateway/audio";
import { EnergyVad, computeRms } from "@/lib/voice/vad";
import {
  buildSessionUpdate,
  isAgentTranscriptDoneEvent,
  isAudioDeltaEvent,
  resolveRealtimeModel,
} from "@/lib/voice/gateway/realtime-session";

/** Build a PCM16 frame from sample values. */
function pcmFrame(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf;
}

describe("mu-law codec", () => {
  it("maps silence to exact silence", () => {
    // A non-zero result here is a DC offset on every call: the previous codec
    // returned -29, which is a constant buzz under the audio.
    expect(mulawDecode(mulawEncode(0))).toBe(0);
  });

  it("round-trips within G.711 quantisation error", () => {
    // mu-law is logarithmic, so absolute error grows with amplitude while
    // relative error stays roughly constant (~1.5% is the codec's design point).
    for (const sample of [0, 50, 100, -100, 500, 1000, -1000, 8000, -8000, 30000, -30000]) {
      const decoded = mulawDecode(mulawEncode(sample));
      const tolerance = Math.max(8, Math.abs(sample) * 0.03);
      expect(Math.abs(decoded - sample)).toBeLessThanOrEqual(tolerance);
      // Sign inversion near zero was the loudest artefact of the old codec.
      if (sample !== 0) expect(Math.sign(decoded)).toBe(Math.sign(sample));
    }
  });

  it("keeps mean error low across a full-scale sweep", () => {
    // Regression guard with teeth: the previous encode/decode mismatch scored a
    // mean absolute error of ~7176 here, which this bound would have caught.
    let total = 0;
    let count = 0;
    for (let i = 0; i < 20000; i++) {
      const sample = Math.round(20000 * Math.sin(i / 50));
      total += Math.abs(mulawDecode(mulawEncode(sample)) - sample);
      count++;
    }
    expect(total / count).toBeLessThan(300);
  });

  it("clips beyond the codec's maximum instead of wrapping", () => {
    // Wrapping would turn a loud sample into a loud sample of opposite sign,
    // which is heard as a click.
    const loud = mulawDecode(mulawEncode(40000));
    expect(loud).toBeGreaterThan(0);
    expect(loud).toBeLessThanOrEqual(32635);
    // The most negative Int16 must not overflow when negated.
    expect(mulawDecode(mulawEncode(-32768))).toBeLessThan(0);
  });

  it("converts a mu-law byte buffer to one PCM sample per byte", () => {
    const bytes = Buffer.from([0x00, 0x7f, 0xff, 0x80]);
    const pcm = mulawBytesToPcm16(bytes);
    expect(pcm).toHaveLength(4);
  });

  it("encodes PCM to base64 mu-law at one byte per sample", () => {
    const b64 = pcm16ToMulawBase64(new Int16Array([0, 1000, -1000, 5000]));
    expect(Buffer.from(b64, "base64")).toHaveLength(4);
  });
});

describe("resample", () => {
  it("returns the input untouched when rates match", () => {
    const src = new Int16Array([1, 2, 3]);
    expect(resample(src, 8000, 8000)).toBe(src);
  });

  it("upsamples 8k to 24k by 3x", () => {
    const src = new Int16Array(160); // 20 ms at 8 kHz
    expect(resample(src, 8000, 24000)).toHaveLength(480);
  });

  it("downsamples 24k to 8k by 1/3", () => {
    const src = new Int16Array(480);
    expect(resample(src, 24000, 8000)).toHaveLength(160);
  });

  it("preserves a constant signal through a round trip", () => {
    const src = new Int16Array(240).fill(5000);
    const round = resample(resample(src, 24000, 8000), 8000, 24000);
    expect(round).toHaveLength(240);
    for (const s of round) expect(s).toBe(5000);
  });

  it("handles an empty buffer without dividing by zero", () => {
    expect(resample(new Int16Array(0), 8000, 24000)).toHaveLength(0);
  });
});

describe("base64ToPcm16", () => {
  it("decodes exactly the encoded samples", () => {
    const samples = new Int16Array([0, 1234, -1234, 32767, -32768]);
    const decoded = base64ToPcm16(pcm16ToBase64(samples));
    expect(Array.from(decoded)).toEqual(Array.from(samples));
  });

  it("does not leak bytes from Node's shared Buffer pool", () => {
    // Regression guard: `new Int16Array(Buffer.from(b64,"base64").buffer)`
    // ignores byteOffset and exposes the entire allocation pool, so the view
    // ends up far longer than the audio and full of unrelated samples.
    const samples = new Int16Array([111, 222, 333]);
    const b64 = pcm16ToBase64(samples);

    // Allocate around the decode so the pool is likely to be shared.
    const noise: Buffer[] = [];
    for (let i = 0; i < 20; i++) noise.push(Buffer.from("padding-padding"));

    const decoded = base64ToPcm16(b64);
    expect(decoded).toHaveLength(3);
    expect(Array.from(decoded)).toEqual([111, 222, 333]);
    expect(noise).toHaveLength(20);
  });

  it("drops a trailing odd byte rather than reading past the buffer", () => {
    const odd = Buffer.from([0x01, 0x02, 0x03]).toString("base64");
    expect(base64ToPcm16(odd)).toHaveLength(1);
  });

  it("returns empty for empty input", () => {
    expect(base64ToPcm16("")).toHaveLength(0);
  });
});

describe("computeRms", () => {
  it("computes higher RMS for louder frames", () => {
    expect(computeRms(pcmFrame(new Array(240).fill(4000)))).toBeGreaterThan(
      computeRms(pcmFrame(new Array(240).fill(10))),
    );
    expect(computeRms(Buffer.alloc(0))).toBe(0);
  });

  it("ignores frames too small to hold a sample", () => {
    expect(new EnergyVad().push(Buffer.alloc(1)).type).toBe("silence");
  });
});

describe("realtime session config", () => {
  it("emits the nested gpt-realtime schema, not the retired flat one", () => {
    const payload = JSON.parse(buildSessionUpdate({ instructions: "be brief", voice: "alloy" }));

    expect(payload.type).toBe("session.update");
    // session.type is required on every update or the model rejects it.
    expect(payload.session.type).toBe("realtime");
    expect(payload.session.output_modalities).toEqual(["audio"]);
    // Nested, not top-level: flat fields fail with unknown_parameter.
    expect(payload.session.audio.output.voice).toBe("alloy");
    expect(payload.session.audio.input.turn_detection.type).toBe("server_vad");
    expect(payload.session.audio.input.format).toEqual({
      type: "audio/pcm",
      rate: 24000,
    });
    expect(payload.session.voice).toBeUndefined();
    expect(payload.session.input_audio_format).toBeUndefined();
    expect(payload.session.turn_detection).toBeUndefined();
  });

  it("uses low-eagerness semantic VAD when asked, so callers are not cut off", () => {
    const payload = JSON.parse(
      buildSessionUpdate({
        instructions: "x",
        voice: "alloy",
        turnDetection: "semantic_vad",
      }),
    );
    expect(payload.session.audio.input.turn_detection).toMatchObject({
      type: "semantic_vad",
      eagerness: "low",
    });
  });

  it("only requests transcription when enabled", () => {
    const off = JSON.parse(buildSessionUpdate({ instructions: "x", voice: "a" }));
    expect(off.session.audio.input.transcription).toBeUndefined();

    const on = JSON.parse(buildSessionUpdate({ instructions: "x", voice: "a", transcribe: true }));
    expect(on.session.audio.input.transcription).toEqual({ model: "whisper-1" });
  });

  it("rewrites retired dated preview models to the stable alias", () => {
    expect(resolveRealtimeModel("gpt-4o-realtime-preview-2024-12-17")).toBe("gpt-realtime");
    expect(resolveRealtimeModel("gpt-4o-mini-realtime-preview")).toBe("gpt-realtime");
    expect(resolveRealtimeModel(null)).toBe("gpt-realtime");
    expect(resolveRealtimeModel("")).toBe("gpt-realtime");
    // A deliberately configured non-realtime override is respected.
    expect(resolveRealtimeModel("gpt-realtime-mini")).toBe("gpt-realtime-mini");
  });

  it("accepts both the GA and legacy audio event names", () => {
    expect(isAudioDeltaEvent("response.output_audio.delta")).toBe(true);
    expect(isAudioDeltaEvent("response.audio.delta")).toBe(true);
    expect(isAudioDeltaEvent("response.text.delta")).toBe(false);

    expect(isAgentTranscriptDoneEvent("response.output_audio_transcript.done")).toBe(true);
    expect(isAgentTranscriptDoneEvent("response.audio_transcript.done")).toBe(true);
    expect(isAgentTranscriptDoneEvent("response.done")).toBe(false);
  });
});
