/**
 * Background sound for phone calls (Retell's `ambient_sound` / `ambient_sound_volume`).
 *
 * The agent's voice is mixed with a quiet loop — a café, a call centre, wind — so a call does not
 * have the dead-silent, studio-clean sound that tells the listener they are talking to software.
 *
 * Beds are synthesized, deterministically, rather than shipped as recordings: crowd beds are many
 * simulated talkers (formant-filtered pitched noise with syllable rhythm) so they read as
 * indistinct speech rather than any words; outdoor beds are filtered wind with bird calls. They
 * are approximations of Retell's recordings. Real recordings override them: put
 * `<name>.wav` (e.g. `coffee-shop.wav`, mono or stereo PCM16, any rate) in the directory named by
 * `WEBEE_AMBIENT_DIR` and that file is used instead.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resample } from "../gateway/audio";

export type AmbientKind =
  | "coffee-shop"
  | "convention-hall"
  | "summer-outdoor"
  | "mountain-outdoor"
  | "static-noise"
  | "call-center";

export const AMBIENT_KINDS: AmbientKind[] = [
  "coffee-shop",
  "convention-hall",
  "summer-outdoor",
  "mountain-outdoor",
  "static-noise",
  "call-center",
];

export function parseAmbientKind(value: unknown): AmbientKind | null {
  const v = String(value ?? "").trim().toLowerCase();
  return (AMBIENT_KINDS as string[]).includes(v) ? (v as AmbientKind) : null;
}

/** Retell's volume is 0–2 with 1 as the default. */
export function clampAmbientVolume(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0, n));
}

/** A bed at volume 1 sits at about −35 dBFS RMS: audible, well under speech. */
const BASE_RMS = 600;
const BED_SECONDS = 24;
const CROSSFADE_SECONDS = 1.5;

// ── Small DSP toolkit ─────────────────────────────────────────────────────────

function rngFor(seedText: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;

  bandpass(freq: number, q: number, rate: number): this {
    const w = (2 * Math.PI * Math.min(freq, rate * 0.45)) / rate;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  lowpass(freq: number, q: number, rate: number): this {
    const w = (2 * Math.PI * Math.min(freq, rate * 0.45)) / rate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = (1 - cos) / 2 / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = (1 - cos) / 2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  process(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** First three formants (Hz) of five vowels — what makes a pitched buzz sound like a voice. */
const VOWELS: Array<[number, number, number]> = [
  [730, 1090, 2440], // a
  [530, 1840, 2480], // e
  [270, 2290, 3010], // i
  [570, 840, 2410], // o
  [300, 870, 2240], // u
];

/** One simulated talker: a wandering pitch through shifting formants, speaking in phrases. */
function talker(n: number, rate: number, rand: () => number): Float32Array {
  const out = new Float32Array(n);
  const f0Base = 95 + rand() * 120;
  const formants = [new Biquad(), new Biquad(), new Biquad()];
  const Q = [7, 9, 11];
  const weight = [1, 0.55, 0.28];
  let phase = 0;
  let vowelFrom = VOWELS[Math.floor(rand() * 5)]!;
  let vowelTo = VOWELS[Math.floor(rand() * 5)]!;
  let vowelPos = 0;
  let speaking = rand() < 0.6;
  let stateLeft = Math.floor(rate * (0.4 + rand() * 1.6));
  let sylLeft = 0;
  let sylLen = 1;
  let env = 0;
  let envTarget = 0;
  const update = Math.max(1, Math.round(rate * 0.005));

  for (let i = 0; i < n; i++) {
    if (--stateLeft <= 0) {
      speaking = !speaking || rand() < 0.15;
      stateLeft = Math.floor(rate * (speaking ? 0.6 + rand() * 2.2 : 0.3 + rand() * 1.4));
    }
    if (--sylLeft <= 0) {
      sylLen = Math.floor(rate * (0.12 + rand() * 0.14));
      sylLeft = sylLen;
      vowelFrom = vowelTo;
      vowelTo = VOWELS[Math.floor(rand() * 5)]!;
      vowelPos = 0;
      envTarget = speaking ? 0.45 + rand() * 0.55 : 0;
    }
    if (i % update === 0) {
      vowelPos = Math.min(1, vowelPos + update / Math.max(1, sylLen * 0.6));
      for (let f = 0; f < 3; f++) {
        const freq = vowelFrom[f]! + (vowelTo[f]! - vowelFrom[f]!) * vowelPos;
        formants[f]!.bandpass(freq, Q[f]!, rate);
      }
    }
    env += (envTarget - env) * (32 / rate);
    const f0 = f0Base * (1 + 0.08 * Math.sin((2 * Math.PI * i) / (rate * 1.7)) + 0.04 * (vowelPos - 0.5));
    phase += f0 / rate;
    if (phase >= 1) phase -= 1;
    const glottal = (phase < 0.4 ? phase / 0.4 : 1 - (phase - 0.4) / 0.6) * 2 - 1;
    const excitation = 0.85 * glottal + 0.3 * (rand() * 2 - 1);
    let v = 0;
    for (let f = 0; f < 3; f++) v += formants[f]!.process(excitation) * weight[f]!;
    out[i] = v * env;
  }
  return out;
}

function addInto(dst: Float32Array, src: Float32Array, gain = 1): void {
  for (let i = 0; i < dst.length; i++) dst[i] = dst[i]! + src[i]! * gain;
}

function whiteNoise(n: number, rand: () => number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rand() * 2 - 1;
  return out;
}

function filtered(x: Float32Array, make: (b: Biquad) => Biquad, passes = 1): Float32Array {
  const out = new Float32Array(x.length);
  let src = x;
  for (let p = 0; p < passes; p++) {
    const bq = make(new Biquad());
    for (let i = 0; i < src.length; i++) out[i] = bq.process(src[i]!);
    src = out;
  }
  return out;
}

/** Short decaying tone, e.g. a cup on a saucer or a bird call. */
function addChirp(
  dst: Float32Array,
  at: number,
  rate: number,
  opts: { f0: number; f1: number; ms: number; gain: number; vibrato?: number },
): void {
  const len = Math.floor((opts.ms / 1000) * rate);
  let phase = 0;
  for (let i = 0; i < len && at + i < dst.length; i++) {
    const p = i / len;
    const f = opts.f0 + (opts.f1 - opts.f0) * p + (opts.vibrato ? opts.vibrato * Math.sin(i * 0.05) : 0);
    phase += (2 * Math.PI * Math.min(f, rate * 0.45)) / rate;
    const env = Math.sin(Math.PI * p) ** 2;
    dst[at + i] = dst[at + i]! + Math.sin(phase) * env * opts.gain;
  }
}

function reverb(x: Float32Array, rate: number): Float32Array {
  const out = Float32Array.from(x);
  for (const [ms, fb] of [
    [23, 0.32],
    [41, 0.28],
    [67, 0.22],
  ] as const) {
    const d = Math.floor((ms / 1000) * rate);
    for (let i = d; i < out.length; i++) out[i] = out[i]! + out[i - d]! * fb;
  }
  return out;
}

// ── Beds ──────────────────────────────────────────────────────────────────────

function wind(n: number, rate: number, rand: () => number, depth: number): Float32Array {
  const w = filtered(whiteNoise(n, rand), (b) => b.lowpass(380, 0.8, rate), 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const gust = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.11 * t + 1) * Math.sin(2 * Math.PI * 0.045 * t + 2);
    w[i] = w[i]! * (1 - depth + depth * gust);
  }
  return w;
}

function babbleBed(
  n: number,
  rate: number,
  rand: () => number,
  talkers: number,
): Float32Array {
  const bed = new Float32Array(n);
  for (let k = 0; k < talkers; k++) addInto(bed, talker(n, rate, rand), 1 / Math.sqrt(talkers));
  return bed;
}

function synthesizeBed(kind: AmbientKind, rate: number, n: number): Float32Array {
  const rand = rngFor(`webee-ambient-${kind}`);
  switch (kind) {
    case "call-center": {
      const bed = babbleBed(n, rate, rand, 6);
      // Keyboard clicks in short runs.
      const clicks = new Float32Array(n);
      for (let t = rate; t < n - rate; t += Math.floor(rate * (0.4 + rand() * 1.6))) {
        const run = 2 + Math.floor(rand() * 6);
        for (let c = 0; c < run; c++) {
          const at = t + Math.floor(c * rate * (0.07 + rand() * 0.08));
          for (let i = 0; i < Math.floor(rate * 0.003) && at + i < n; i++) {
            clicks[at + i] = (rand() * 2 - 1) * (1 - i / (rate * 0.003)) * 0.6;
          }
        }
      }
      addInto(bed, filtered(clicks, (b) => b.lowpass(3300, 0.7, rate)), 0.35);
      addInto(bed, filtered(whiteNoise(n, rand), (b) => b.lowpass(1800, 0.6, rate)), 0.04);
      return bed;
    }
    case "coffee-shop": {
      const bed = babbleBed(n, rate, rand, 9);
      for (let t = Math.floor(rate * 1.5); t < n - rate; t += Math.floor(rate * (1.6 + rand() * 4.5))) {
        const f = 2200 + rand() * 1000;
        addChirp(bed, t, rate, { f0: f, f1: f * 0.98, ms: 70 + rand() * 60, gain: 0.16 + rand() * 0.14 });
        addChirp(bed, t + Math.floor(rate * 0.012), rate, { f0: f * 1.42, f1: f * 1.4, ms: 50, gain: 0.1 });
      }
      addInto(bed, filtered(whiteNoise(n, rand), (b) => b.lowpass(1200, 0.6, rate)), 0.05);
      return filtered(bed, (b) => b.lowpass(3400, 0.7, rate));
    }
    case "convention-hall": {
      const bed = reverb(babbleBed(n, rate, rand, 16), rate);
      addInto(bed, filtered(whiteNoise(n, rand), (b) => b.lowpass(900, 0.6, rate)), 0.08);
      return bed;
    }
    case "summer-outdoor": {
      const bed = wind(n, rate, rand, 0.5);
      for (let t = Math.floor(rate * 0.6); t < n - rate; t += Math.floor(rate * (0.7 + rand() * 2.6))) {
        const notes = 1 + Math.floor(rand() * 4);
        const f = 2600 + rand() * 900;
        for (let c = 0; c < notes; c++) {
          addChirp(bed, t + Math.floor(c * rate * 0.11), rate, {
            f0: f,
            f1: f + (rand() - 0.3) * 700,
            ms: 70 + rand() * 70,
            gain: 0.9,
            vibrato: 90,
          });
        }
      }
      addInto(bed, filtered(whiteNoise(n, rand), (b) => b.lowpass(2800, 0.6, rate)), 0.05);
      return bed;
    }
    case "mountain-outdoor": {
      const bed = wind(n, rate, rand, 0.9);
      addInto(bed, filtered(whiteNoise(n, rand), (b) => b.lowpass(900, 0.7, rate), 2), 0.3);
      for (let t = Math.floor(rate * 4); t < n - rate; t += Math.floor(rate * (6 + rand() * 9))) {
        addChirp(bed, t, rate, { f0: 2300, f1: 2900, ms: 140, gain: 0.5, vibrato: 60 });
      }
      return bed;
    }
    case "static-noise": {
      const bed = filtered(whiteNoise(n, rand), (b) => b.lowpass(3400, 0.7, rate));
      for (let i = 0; i < n; i++) if (rand() < 0.0004) bed[i] = bed[i]! + (rand() * 2 - 1) * 4;
      return bed;
    }
  }
}

function rmsOf(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, x.length)) || 1;
}

const bedCache = new Map<string, Int16Array>();

/** Generate one seamless loop, scaled to the base level. */
export function generateAmbientBed(kind: AmbientKind, sampleRate: number): Int16Array {
  const key = `${kind}@${sampleRate}`;
  const hit = bedCache.get(key);
  if (hit) return hit;

  const loop = Math.floor(BED_SECONDS * sampleRate);
  const fade = Math.floor(CROSSFADE_SECONDS * sampleRate);
  const raw = synthesizeBed(kind, sampleRate, loop + fade);

  // Seamless loop: blend the extra tail into the start with equal-power weights.
  const seamless = new Float32Array(loop);
  for (let i = 0; i < loop; i++) {
    if (i < fade) {
      const p = i / fade;
      seamless[i] = raw[i]! * Math.sin((p * Math.PI) / 2) + raw[loop + i]! * Math.cos((p * Math.PI) / 2);
    } else {
      seamless[i] = raw[i]!;
    }
  }

  const gain = BASE_RMS / rmsOf(seamless);
  const out = new Int16Array(loop);
  for (let i = 0; i < loop; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(seamless[i]! * gain)));
  }
  bedCache.set(key, out);
  return out;
}

/** Decode a PCM16 WAV (mono or stereo, any rate) to mono at `rate`. */
export function decodeWavToMono(buf: Buffer, rate: number): Int16Array | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
  let off = 12;
  let channels = 1;
  let srcRate = 8000;
  let bits = 16;
  let data: Buffer | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(off + 10);
      srcRate = buf.readUInt32LE(off + 12);
      bits = buf.readUInt16LE(off + 22);
    } else if (id === "data") {
      data = buf.subarray(off + 8, Math.min(buf.length, off + 8 + size));
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!data || bits !== 16 || channels < 1) return null;
  const frames = Math.floor(data.length / (2 * channels));
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = data.readInt16LE(i * 2 * channels);
  return srcRate === rate ? mono : resample(mono, srcRate, rate);
}

/** A bed ready to loop: a recording from `WEBEE_AMBIENT_DIR` if present, else the synthesized one. */
export function loadAmbientBed(kind: AmbientKind, sampleRate: number): Int16Array {
  const dir = process.env.WEBEE_AMBIENT_DIR;
  if (dir) {
    const file = join(dir, `${kind}.wav`);
    try {
      if (existsSync(file)) {
        const wav = decodeWavToMono(readFileSync(file), sampleRate);
        if (wav && wav.length > sampleRate) {
          const gain = BASE_RMS / rmsOf(wav);
          return Int16Array.from(wav, (v) => Math.max(-32768, Math.min(32767, Math.round(v * gain))));
        }
      }
    } catch (err) {
      console.warn(`[ambient] could not read ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  return generateAmbientBed(kind, sampleRate);
}

// ── Mixer ─────────────────────────────────────────────────────────────────────

/** Loops a bed and adds it, at the chosen volume, to frames of speech. */
export class AmbientMixer {
  private pos = 0;

  constructor(
    private readonly bed: Int16Array,
    private readonly volume: number,
  ) {}

  /** `frame` (agent speech, or silence) with the next stretch of the bed added in place. */
  mixInto(frame: Int16Array): Int16Array {
    for (let i = 0; i < frame.length; i++) {
      const v = frame[i]! + this.bed[this.pos]! * this.volume;
      frame[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v);
      if (++this.pos >= this.bed.length) this.pos = 0;
    }
    return frame;
  }
}

// ── Pacer ─────────────────────────────────────────────────────────────────────

export interface AmbientPacerOptions {
  mixer: AmbientMixer;
  sampleRate: number;
  /** Called for every 20 ms frame; `hasAgent` is true when it carries agent speech. */
  send: (frame: Int16Array, hasAgent: boolean) => void;
  frameMs?: number;
  /** How far ahead of real time to stay, to ride out event-loop stalls. */
  leadMs?: number;
  /** Test seams. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Sends a steady stream of 20 ms frames, so the background keeps playing while the agent is
 * silent and speech and bed share one stream.
 *
 * Without a bed the gateway forwards agent audio the moment the synthesizer produces it. With one,
 * every frame must carry the bed, so agent audio waits here and goes out at real-time pace —
 * which also means a barge-in can drop it before it is sent (see `clearAgent`).
 */
export class AmbientPacer {
  private readonly frameSamples: number;
  private readonly frameMs: number;
  private readonly leadFrames: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private queue: Int16Array[] = [];
  private queued = 0;
  private startedAt = 0;
  private framesSent = 0;
  private handle: unknown = null;
  private drainWaiters: Array<() => void> = [];
  private stopped = true;

  constructor(private readonly opts: AmbientPacerOptions) {
    this.frameMs = opts.frameMs ?? 20;
    this.frameSamples = Math.round((opts.sampleRate * this.frameMs) / 1000);
    this.leadFrames = Math.max(1, Math.round((opts.leadMs ?? 100) / this.frameMs));
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.startedAt = this.now();
    this.framesSent = 0;
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.handle !== null) this.clearTimer(this.handle);
    this.handle = null;
    this.queue = [];
    this.queued = 0;
    this.flushDrainWaiters();
  }

  /** Queue agent speech (PCM16 at the pacer's rate). */
  pushAgent(pcm: Int16Array): void {
    if (pcm.length === 0) return;
    this.queue.push(Int16Array.from(pcm)); // the caller may reuse its buffer
    this.queued += pcm.length;
  }

  /** Drop agent speech that has not been sent yet (barge-in). */
  clearAgent(): void {
    this.queue = [];
    this.queued = 0;
    this.flushDrainWaiters();
  }

  get queuedSamples(): number {
    return this.queued;
  }

  /** Run `fn` once every queued agent sample has been sent (immediately if none is queued). */
  afterAgentDrained(fn: () => void): void {
    if (this.queued === 0) fn();
    else this.drainWaiters.push(fn);
  }

  private flushDrainWaiters(): void {
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const fn of waiters) fn();
  }

  private schedule(): void {
    if (this.stopped) return;
    const dueAt = this.startedAt + (this.framesSent - this.leadFrames) * this.frameMs;
    this.handle = this.setTimer(() => this.tick(), Math.max(1, dueAt - this.now()));
  }

  private tick(): void {
    this.handle = null;
    if (this.stopped) return;
    // Everything that should have gone out by now, plus the lead.
    const target = Math.floor((this.now() - this.startedAt) / this.frameMs) + this.leadFrames;
    let guard = 0;
    while (this.framesSent < target && guard++ < 50) {
      const frame = new Int16Array(this.frameSamples);
      const taken = this.takeAgent(frame);
      this.opts.mixer.mixInto(frame);
      this.framesSent += 1;
      this.opts.send(frame, taken > 0);
    }
    if (this.queued === 0 && this.drainWaiters.length) this.flushDrainWaiters();
    this.schedule();
  }

  private takeAgent(frame: Int16Array): number {
    let filled = 0;
    while (filled < frame.length && this.queue.length) {
      const head = this.queue[0]!;
      const n = Math.min(head.length, frame.length - filled);
      frame.set(head.subarray(0, n), filled);
      filled += n;
      if (n === head.length) this.queue.shift();
      else this.queue[0] = head.subarray(n);
    }
    this.queued -= filled;
    return filled;
  }
}
