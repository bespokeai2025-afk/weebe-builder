/**
 * Silero VAD (ONNX) — neural speech/non-speech classification.
 *
 * Loaded lazily and treated as optional on purpose. `onnxruntime-node` unpacks to
 * roughly 270 MB of native binaries, which is a poor trade to force into every
 * deploy for one classifier; instead this is used when the runtime and model are
 * present and the energy detector is used otherwise.
 *
 * To enable:
 *   1. install a runtime:  `bun add onnxruntime-node`
 *   2. point at a model:   `SILERO_VAD_MODEL_PATH=/path/to/silero_vad.onnx`
 *      (the file ships inside the `@ricky0123/vad-node` package if you prefer)
 *
 * Both Silero v4 (`h`/`c` inputs) and v5 (single `state` input) are supported,
 * detected from the model's own input names rather than configured.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { resample } from "../gateway/audio";
import { computeRms } from "./energy";
import { resolveSileroModelPath } from "./silero-path.shared";
import { Endpointer, type EndpointingOptions, type Vad, type VadEvent } from "./types";

/** Silero operates on 16 kHz audio in fixed windows. */
const MODEL_SAMPLE_RATE = 16_000;
const WINDOW_SAMPLES = 512;

// Minimal structural types: onnxruntime is an optional dependency, so importing
// its real types would make this file fail to compile when it is absent.
interface OrtTensor {
  data: ArrayLike<number> | Float32Array;
}
interface OrtSession {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}
interface OrtModule {
  InferenceSession: { create(path: string): Promise<OrtSession> };
  Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => unknown;
}

export interface SileroVadOptions extends EndpointingOptions {
  /** Speech probability above which a window counts as speech. */
  threshold?: number;
  /** Sample rate of the frames being pushed. */
  inputSampleRate?: number;
  modelPath?: string;
}

export class SileroVad implements Vad {
  readonly name = "silero";

  private readonly endpointer: Endpointer;
  private readonly threshold: number;
  private readonly inputSampleRate: number;
  private readonly ort: OrtModule;
  private readonly session: OrtSession;
  private readonly usesLegacyState: boolean;

  /** Leftover 16 kHz samples that did not fill a window. */
  private pending: Int16Array = new Int16Array(0);
  private h: Float32Array;
  private c: Float32Array;
  private state: Float32Array;

  private constructor(
    ort: OrtModule,
    session: OrtSession,
    options: SileroVadOptions,
  ) {
    this.ort = ort;
    this.session = session;
    this.endpointer = new Endpointer(options);
    this.threshold = options.threshold ?? 0.5;
    this.inputSampleRate = options.inputSampleRate ?? 24_000;
    this.usesLegacyState = session.inputNames.includes("h");
    this.h = new Float32Array(2 * 64);
    this.c = new Float32Array(2 * 64);
    this.state = new Float32Array(2 * 128);
  }

  /**
   * Load the model. Rejects when the runtime or the model file is unavailable so
   * the caller can fall back rather than run a half-initialised detector.
   */
  static async create(options: SileroVadOptions = {}): Promise<SileroVad> {
    const modelPath = resolveSileroModelPath(options.modelPath);
    if (!modelPath) {
      throw new Error(
        "SILERO_VAD_MODEL_PATH is not set and models/silero_vad.onnx was not found (run node scripts/setup-silero-vad.mjs)",
      );
    }

    let ort: OrtModule;
    try {
      // Specifier held in a variable so bundlers do not try to resolve an
      // optional native dependency at build time.
      const specifier = "onnxruntime-node";
      ort = (await import(/* @vite-ignore */ specifier)) as unknown as OrtModule;
    } catch (err) {
      throw new Error(
        `onnxruntime-node is not installed (${err instanceof Error ? err.message : String(err)})`,
      );
    }

    const session = await ort.InferenceSession.create(modelPath);
    return new SileroVad(ort, session, options);
  }

  get isSpeaking(): boolean {
    return this.endpointer.isSpeaking;
  }

  reset(): void {
    this.endpointer.reset();
    this.pending = new Int16Array(0);
    this.h = new Float32Array(this.h.length);
    this.c = new Float32Array(this.c.length);
    this.state = new Float32Array(this.state.length);
  }

  async push(frame: Buffer): Promise<VadEvent> {
    if (frame.byteLength < 2) return { type: "silence" };

    const samples = new Int16Array(frame.buffer, frame.byteOffset, Math.floor(frame.byteLength / 2));
    const at16k =
      this.inputSampleRate === MODEL_SAMPLE_RATE
        ? samples
        : resample(samples, this.inputSampleRate, MODEL_SAMPLE_RATE);

    // Frames rarely align to the model's window size, so carry the remainder.
    const merged = new Int16Array(this.pending.length + at16k.length);
    merged.set(this.pending, 0);
    merged.set(at16k, this.pending.length);

    let offset = 0;
    let peakProbability = 0;
    while (merged.length - offset >= WINDOW_SAMPLES) {
      const window = merged.subarray(offset, offset + WINDOW_SAMPLES);
      offset += WINDOW_SAMPLES;
      peakProbability = Math.max(peakProbability, await this.infer(window));
    }
    this.pending = merged.slice(offset);

    // A frame counts as speech if any window within it did: missing the onset
    // costs more than a marginally early trigger.
    const isSpeech = peakProbability >= this.threshold;
    return this.endpointer.step(frame, isSpeech, computeRms(frame));
  }

  /** Run one window through the model, carrying recurrent state forward. */
  private async infer(window: Int16Array): Promise<number> {
    const input = new Float32Array(window.length);
    for (let i = 0; i < window.length; i++) input[i] = window[i] / 32768;

    const { Tensor } = this.ort;
    const feeds: Record<string, unknown> = {
      input: new Tensor("float32", input, [1, window.length]),
      sr: new Tensor("int64", BigInt64Array.from([BigInt(MODEL_SAMPLE_RATE)]), []),
    };
    if (this.usesLegacyState) {
      feeds.h = new Tensor("float32", this.h, [2, 1, 64]);
      feeds.c = new Tensor("float32", this.c, [2, 1, 64]);
    } else {
      feeds.state = new Tensor("float32", this.state, [2, 1, 128]);
    }

    const results = await this.session.run(feeds);

    // Output names differ between exports, so take the first non-state output.
    const stateKeys = new Set(["hn", "cn", "stateN", "state"]);
    const outputKey =
      this.session.outputNames.find((n) => !stateKeys.has(n)) ?? this.session.outputNames[0];
    const probability = Number(results[outputKey]?.data?.[0] ?? 0);

    if (this.usesLegacyState) {
      if (results.hn?.data) this.h = Float32Array.from(results.hn.data as Float32Array);
      if (results.cn?.data) this.c = Float32Array.from(results.cn.data as Float32Array);
    } else {
      const next = results.stateN ?? results.state;
      if (next?.data) this.state = Float32Array.from(next.data as Float32Array);
    }

    return Number.isFinite(probability) ? probability : 0;
  }
}
