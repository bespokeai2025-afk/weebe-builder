/**
 * Caller-side noise suppression for the native voice engine.
 *
 * Retell's `denoising_mode` cleans the caller's audio before speech detection and transcription.
 * The native engine ignored the setting. This is a streaming spectral gate: it tracks the steady
 * noise floor in each frequency band and turns bands down when they sit at that floor, leaving
 * speech — which rises well above it — alone.
 *
 *   "noise-cancellation"                      steady noise: hiss, hum, fans, road, line noise
 *   "noise-and-background-speech-cancellation" the above, plus voices much quieter than the
 *                                             caller's own (a TV or people further from the phone)
 *
 * The second mode cannot separate two voices of similar loudness — nothing without a trained model
 * can — so it only removes background speech that is clearly quieter than the person on the call.
 * It learns that person's level from the call itself and does nothing until it has.
 *
 * Designed never to cost accuracy on clean audio: with no noise above the floor the gain stays at
 * unity, attenuation is capped, and gains are smoothed so speech edges are not clipped.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

export type DenoiseMode = "off" | "noise" | "noise_and_speech";

/** Builder / Retell `denoising_mode` → engine mode. Unknown or unset means off. */
export function resolveDenoiseMode(value: unknown): DenoiseMode {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "noise-cancellation") return "noise";
  if (v === "noise-and-background-speech-cancellation") return "noise_and_speech";
  return "off"; // "no-denoise", "no-denoising", unset
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place iterative radix-2 FFT (inverse when `inverse`, unscaled). */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr; im[b] = im[a]! - xi;
        re[a] = re[a]! + xr; im[a] = im[a]! + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface DenoiserOptions {
  mode: Exclude<DenoiseMode, "off">;
  sampleRate: number;
  /** Override the mode's strength (used by tests and tuning). */
  tuning?: { floorGain?: number; overSubtract?: number };
}

/**
 * Streaming denoiser. Feed PCM16 mono of any chunk size; get back the same number of samples,
 * delayed by about 32 ms at 8 kHz.
 */
export class StreamingDenoiser {
  private readonly n: number;
  private readonly hop: number;
  private readonly window: Float64Array;
  private readonly bins: number;

  private readonly inBuf: Float64Array; // last n input samples
  private readonly outAcc: Float64Array; // overlap-add accumulator, length n
  private pending: number[] = []; // input not yet consumed by a full hop
  private ready: number[] = []; // finished output samples

  private readonly power: Float64Array; // smoothed per-bin power
  private readonly noise: Float64Array; // per-bin noise floor
  private readonly gain: Float64Array; // smoothed per-bin gain
  private frames = 0;
  private skippedFirstHop = false;

  private readonly floorGain: number;
  private readonly overSubtract: number;
  private readonly speechGate: boolean;
  /** Caller's own speech level (energy), learned from frames that are clearly speech. */
  private speechLevel = 0;
  private speechFrames = 0;
  private gateGain = 1;

  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(opts: DenoiserOptions) {
    this.n = nextPow2(Math.round(opts.sampleRate * 0.032));
    this.hop = this.n / 2;
    this.bins = this.n / 2 + 1;
    // sqrt-Hann analysis and synthesis windows: 50% overlap-add reconstructs exactly.
    this.window = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.window[i] = Math.sqrt(0.5 * (1 - Math.cos((2 * Math.PI * i) / this.n)));
    }
    this.inBuf = new Float64Array(this.n);
    this.outAcc = new Float64Array(this.n);
    this.power = new Float64Array(this.bins);
    this.noise = new Float64Array(this.bins);
    this.gain = new Float64Array(this.bins).fill(1);
    this.re = new Float64Array(this.n);
    this.im = new Float64Array(this.n);

    const strong = opts.mode === "noise_and_speech";
    this.floorGain = opts.tuning?.floorGain ?? (strong ? 0.1 : 0.18); // max attenuation -20 dB / -15 dB
    this.overSubtract = opts.tuning?.overSubtract ?? (strong ? 1.6 : 1.3);
    this.speechGate = strong;
    // Output lags input by one hop, and the first frame emits nothing, so a chunk can ask for more
    // than has been produced. 2·hop − 1 zeros up front is the least that never runs short, whatever
    // the chunk sizes (total delay ≈ 32 ms at 8 kHz).
    for (let i = 0; i < 2 * this.hop - 1; i++) this.ready.push(0);
  }

  /** Process a chunk; returns exactly as many samples as it was given. */
  process(input: Int16Array): Int16Array {
    for (let i = 0; i < input.length; i++) this.pending.push(input[i]!);
    while (this.pending.length >= this.hop) {
      this.processHop(this.pending.splice(0, this.hop));
    }
    const out = new Int16Array(input.length);
    const take = Math.min(out.length, this.ready.length);
    for (let i = 0; i < take; i++) out[i] = this.ready[i]!;
    this.ready.splice(0, take);
    return out;
  }

  private processHop(samples: number[]): void {
    // Slide the input window by one hop.
    this.inBuf.copyWithin(0, this.hop);
    for (let i = 0; i < this.hop; i++) this.inBuf[this.hop + i] = samples[i]!;

    for (let i = 0; i < this.n; i++) {
      this.re[i] = this.inBuf[i]! * this.window[i]!;
      this.im[i] = 0;
    }
    fft(this.re, this.im, false);

    // Per-bin power, smoothed over time; noise floor tracks its minimum.
    let frameEnergy = 0;
    let excess = 0;
    for (let k = 0; k < this.bins; k++) {
      const p = this.re[k]! * this.re[k]! + this.im[k]! * this.im[k]!;
      frameEnergy += p;
      this.power[k] = this.frames === 0 ? p : 0.6 * this.power[k]! + 0.4 * p;
      if (this.frames === 0 || this.noise[k] === 0) {
        this.noise[k] = this.power[k]!;
      } else if (this.power[k]! < this.noise[k]!) {
        this.noise[k] = 0.8 * this.noise[k]! + 0.2 * this.power[k]!; // falls quickly
      } else {
        this.noise[k] = this.noise[k]! * 1.0035 + 1e-9; // rises slowly: speech must not raise it
      }
      if (this.power[k]! > 4 * this.noise[k]!) excess += 1;
    }
    this.frames += 1;

    // Spectral gain per bin.
    for (let k = 0; k < this.bins; k++) {
      const p = Math.max(this.power[k]!, 1e-12);
      let g = 1 - (this.overSubtract * this.noise[k]!) / p;
      if (!Number.isFinite(g)) g = 1;
      g = Math.min(1, Math.max(this.floorGain, g));
      // Fast to open (don't clip the start of a word), slower to close (no flutter).
      const prev = this.gain[k]!;
      this.gain[k] = g > prev ? 0.3 * prev + 0.7 * g : 0.75 * prev + 0.25 * g;
    }
    // Smooth across frequency so isolated bins don't ring.
    let g0 = this.gain[0]!;
    for (let k = 1; k < this.bins - 1; k++) {
      const smoothed = (g0 + 2 * this.gain[k]! + this.gain[k + 1]!) / 4;
      g0 = this.gain[k]!;
      this.gain[k] = smoothed;
    }

    // Background-speech gate: a frame well below the caller's own level is someone else.
    let gate = 1;
    if (this.speechGate) {
      const isSpeechLike = excess >= this.bins * 0.12; // enough bins clearly above the floor
      if (isSpeechLike) {
        this.speechLevel =
          this.speechFrames === 0
            ? frameEnergy
            : frameEnergy > this.speechLevel
              ? 0.7 * this.speechLevel + 0.3 * frameEnergy
              : 0.995 * this.speechLevel + 0.005 * frameEnergy;
        this.speechFrames += 1;
      }
      // Needs ~0.5 s of the caller's speech before it dares to judge anything.
      if (isSpeechLike && this.speechFrames > 30 && frameEnergy < this.speechLevel * 0.02) {
        gate = 0.18;
      }
    }
    this.gateGain = gate > this.gateGain ? 0.4 * this.gateGain + 0.6 * gate : 0.8 * this.gateGain + 0.2 * gate;

    for (let k = 0; k < this.bins; k++) {
      const g = this.gain[k]! * this.gateGain;
      this.re[k] = this.re[k]! * g;
      this.im[k] = this.im[k]! * g;
      if (k > 0 && k < this.n / 2) {
        this.re[this.n - k] = this.re[k]!;
        this.im[this.n - k] = -this.im[k]!;
      }
    }
    fft(this.re, this.im, true);

    for (let i = 0; i < this.n; i++) {
      this.outAcc[i] = this.outAcc[i]! + (this.re[i]! / this.n) * this.window[i]!;
    }
    // The first frame's first half is the zero padding before the call began — nothing to emit.
    if (this.skippedFirstHop) {
      for (let i = 0; i < this.hop; i++) {
        const v = Math.round(this.outAcc[i]!);
        this.ready.push(v > 32767 ? 32767 : v < -32768 ? -32768 : v);
      }
    }
    this.skippedFirstHop = true;
    this.outAcc.copyWithin(0, this.hop);
    this.outAcc.fill(0, this.n - this.hop);
  }
}
