/**
 * Energy-based voice activity detection with an adaptive noise floor.
 *
 * Replaces the original fixed `RMS_THRESHOLD = 400`. A fixed threshold fails in
 * both directions and there is no value that works everywhere: on a noisy line
 * the room itself clears 400 and the agent hears speech continuously, while a
 * quiet speaker on a good headset never reaches it.
 *
 * This tracks the room's noise floor while nobody is talking and requires speech
 * to stand a fixed ratio above it, so the effective threshold follows the line.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { Endpointer, type EndpointingOptions, type Vad, type VadEvent } from "./types";

/** Root-mean-square amplitude of a PCM16 frame, in raw Int16 units. */
export function computeRms(chunk: Buffer): number {
  const samples = Math.floor(chunk.byteLength / 2);
  if (samples === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = chunk.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}

export interface EnergyVadOptions extends EndpointingOptions {
  /**
   * How far above the measured noise floor a frame must sit to count as speech.
   * 3.0 is roughly 10 dB SNR, which separates speech from room tone reliably.
   */
  snrRatio?: number;
  /**
   * Absolute minimum threshold in Int16 units, so a pathologically quiet line
   * (noise floor near zero) does not treat faint hiss as speech.
   */
  minThreshold?: number;
  /** Noise-floor estimate used before enough audio has been measured. */
  initialNoiseFloor?: number;
  /**
   * Frames of audio observed before speech detection is allowed.
   *
   * Without this, a call that opens on a noisy line latches onto the noise as an
   * utterance before any floor has been measured, and never recovers. The caller
   * is not talking during the agent's greeting anyway.
   */
  warmupFrames?: number;
  /** How many recent frames the noise floor is estimated from. */
  windowFrames?: number;
}

export class EnergyVad implements Vad {
  readonly name = "energy";

  private readonly endpointer: Endpointer;
  private readonly snrRatio: number;
  private readonly minThreshold: number;
  private readonly initialNoiseFloor: number;
  private readonly warmupFrames: number;
  private readonly windowFrames: number;

  /** Recent frame energies; the floor is the quietest of them. */
  private window: number[] = [];
  private framesSeen = 0;
  /** Threshold captured at speech onset and held for the utterance. */
  private frozenThreshold: number | null = null;

  constructor(options: EnergyVadOptions = {}) {
    this.endpointer = new Endpointer(options);
    this.snrRatio = options.snrRatio ?? 3;
    this.minThreshold = options.minThreshold ?? 250;
    this.initialNoiseFloor = options.initialNoiseFloor ?? 120;
    this.warmupFrames = options.warmupFrames ?? 10;
    this.windowFrames = options.windowFrames ?? 150;
  }

  get isSpeaking(): boolean {
    return this.endpointer.isSpeaking;
  }

  /**
   * Estimated noise floor.
   *
   * Taken as the minimum of recent energies rather than an average of frames
   * believed to be silence. Speech has gaps, so the minimum lands on the noise
   * either way — and unlike an average gated on "not speech", it cannot be
   * poisoned by its own misclassification and left stuck.
   */
  get noiseFloor(): number {
    if (this.window.length === 0) return this.initialNoiseFloor;
    let min = Infinity;
    for (const value of this.window) if (value < min) min = value;
    return min;
  }

  /** Current speech threshold in Int16 units; useful in latency logs. */
  get threshold(): number {
    if (this.frozenThreshold !== null) return this.frozenThreshold;
    return Math.max(this.minThreshold, this.noiseFloor * this.snrRatio);
  }

  reset(): void {
    this.endpointer.reset();
    this.frozenThreshold = null;
  }

  push(frame: Buffer): VadEvent {
    if (frame.byteLength < 2) return { type: "silence" };

    const rms = computeRms(frame);
    this.window.push(rms);
    if (this.window.length > this.windowFrames) this.window.shift();
    this.framesSeen += 1;

    // Hold the onset threshold for the whole utterance: recomputing mid-sentence
    // would let the speaker's own voice raise the floor until they read as
    // silence and the turn ends mid-word.
    const effective = this.threshold;
    const isSpeech = this.framesSeen > this.warmupFrames && rms >= effective;

    const event = this.endpointer.step(frame, isSpeech, rms);
    if (event.type === "speech_start") this.frozenThreshold = effective;
    else if (event.type === "utterance_end" || event.type === "discarded") {
      this.frozenThreshold = null;
    }
    return event;
  }
}
