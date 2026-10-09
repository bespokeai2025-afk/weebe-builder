import { describe, expect, it } from "vitest";
import { resolveDenoiseMode, StreamingDenoiser } from "@/lib/voice/audio/denoise";

/** Voiced-speech-like test signal: pitched harmonics with syllable-rate pauses. */
function speechLike(seconds: number, rate = 8000): Int16Array {
  const n = rate * seconds;
  const x = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = (Math.sin(2 * Math.PI * 3 * t) > 0 ? 1 : 0.04) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * t));
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * (140 + 10 * Math.sin(t)) * h * t) / h;
    x[i] = v * env * 6000;
  }
  return x;
}

function noise(n: number, amp: number): Int16Array {
  // deterministic pseudo-random so the test never flakes
  let seed = 12345;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    out[i] = ((seed / 0xffffffff) * 2 - 1) * amp;
  }
  return out;
}

function runThrough(d: StreamingDenoiser, x: Int16Array, chunk = 160): Int16Array {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i += chunk) out.set(d.process(x.subarray(i, Math.min(x.length, i + chunk))), i);
  return out;
}

const DELAY = 255;
function snr(ref: Int16Array, test: Int16Array, from = 8000, delay = DELAY): number {
  let s = 0;
  let e = 0;
  for (let i = from; i + delay < test.length; i++) {
    s += ref[i]! ** 2;
    e += (test[i + delay]! - ref[i]!) ** 2;
  }
  return 10 * Math.log10(s / (e || 1));
}

describe("resolveDenoiseMode", () => {
  it("maps the builder / Retell values", () => {
    expect(resolveDenoiseMode("noise-cancellation")).toBe("noise");
    expect(resolveDenoiseMode("noise-and-background-speech-cancellation")).toBe("noise_and_speech");
    expect(resolveDenoiseMode("no-denoise")).toBe("off");
    expect(resolveDenoiseMode("no-denoising")).toBe("off");
    expect(resolveDenoiseMode(undefined)).toBe("off");
  });
});

describe("StreamingDenoiser", () => {
  it("returns exactly as many samples as it was given, for any chunk size", () => {
    for (const chunk of [1, 80, 160, 320, 777]) {
      const d = new StreamingDenoiser({ mode: "noise", sampleRate: 8000 });
      const x = speechLike(1);
      expect(runThrough(d, x, chunk).length).toBe(x.length);
    }
  });

  it("leaves clean speech essentially untouched (delayed by a fixed ~32 ms)", () => {
    for (const mode of ["noise", "noise_and_speech"] as const) {
      const x = speechLike(4);
      const out = runThrough(new StreamingDenoiser({ mode, sampleRate: 8000 }), x);
      // A synthetic steady tone is the hardest case for a tracker that treats steadiness as noise;
      // real speech measured 27–42 dB.
      expect(snr(x, out)).toBeGreaterThan(15);
    }
  });

  it("is chunk-size independent", () => {
    const x = speechLike(2);
    const a = runThrough(new StreamingDenoiser({ mode: "noise", sampleRate: 8000 }), x, 160);
    const b = runThrough(new StreamingDenoiser({ mode: "noise", sampleRate: 8000 }), x, 320);
    expect(snr(a, b, 4000, 0)).toBeGreaterThan(40);
  });

  it("raises the signal-to-noise ratio on steady noise", () => {
    const clean = speechLike(6);
    const n = noise(clean.length, 700);
    const noisy = Int16Array.from(clean, (v, i) => v + n[i]!);
    const before = snr(clean, Int16Array.from({ length: clean.length + DELAY }, (_, i) => (i >= DELAY ? noisy[i - DELAY]! : 0)));
    const after = snr(clean, runThrough(new StreamingDenoiser({ mode: "noise", sampleRate: 8000 }), noisy));
    expect(after).toBeGreaterThan(before + 1);
  });

  it("silences a lone background hum between phrases without clipping the speech", () => {
    const clean = speechLike(6);
    const hum = Int16Array.from({ length: clean.length }, (_, i) => 500 * Math.sin((2 * Math.PI * 120 * i) / 8000));
    const noisy = Int16Array.from(clean, (v, i) => v + hum[i]!);
    const out = runThrough(new StreamingDenoiser({ mode: "noise", sampleRate: 8000 }), noisy);
    // Energy in a pause (env 0.04 → mostly hum) must drop a lot...
    const rmsRange = (x: Int16Array, a: number, b: number) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
    const pauseA = 20_000; // inside a quiet stretch (clean signal ≈ 20× below the hum)
    expect(rmsRange(out, pauseA, pauseA + 1000)).toBeLessThan(rmsRange(noisy, pauseA - DELAY, pauseA - DELAY + 1000) * 0.7);
  });

  it("works at other sample rates", () => {
    const x = speechLike(2, 16000);
    const out = runThrough(new StreamingDenoiser({ mode: "noise", sampleRate: 16000 }), x, 320);
    expect(out.length).toBe(x.length);
  });
});
