/**
 * Call recording capture.
 *
 * Retell hands us a hosted `recording_url`; owning the media stream means we
 * have to produce one ourselves. Both directions of audio already pass through
 * the gateway, so they are mixed into a single mono WAV here and uploaded to the
 * existing `call-recordings` bucket, which the calls UI already plays from.
 *
 * Relative imports only (reachable from vite.config.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resample } from "../gateway/audio";

const BUCKET = "call-recordings";

/**
 * Recordings are stored at telephone quality regardless of the engine's internal
 * rate. Speech carries fine at 8 kHz — it is what the PSTN itself delivers — and
 * the rate directly sets the memory ceiling, since the mix is held in RAM until
 * the call ends. At 24 kHz a half-hour call would need 86 MB and exceed the
 * bucket's 50 MB object limit.
 */
const RECORD_SAMPLE_RATE = 8_000;

/** 30 minutes ≈ 28.8 MB of PCM, which fits the bucket limit with headroom. */
const DEFAULT_MAX_SECONDS = 1_800;

export interface CallRecorderOptions {
  maxSeconds?: number;
  /** Injectable for tests; real calls use wall-clock time. */
  now?: () => number;
}

/**
 * Mixes caller and agent audio into one time-aligned mono track.
 *
 * Placement differs by direction on purpose. Caller audio arrives in real time,
 * so its wall-clock arrival is its true position. Agent audio does not: TTS
 * streams a whole utterance in a burst well ahead of playback, so placing it by
 * arrival time would compress speech into a fraction of its real duration. Agent
 * chunks are therefore laid down contiguously from where the utterance began,
 * and only re-synced to the clock when a gap means a new utterance started.
 */
export class CallRecorder {
  private readonly startedAt: number;
  private readonly now: () => number;
  private readonly maxSamples: number;
  private mix: Int16Array;
  /** Highest sample index written; the export length. */
  private length = 0;
  private agentCursor = 0;
  private truncated = false;

  constructor(options: CallRecorderOptions = {}) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.maxSamples = (options.maxSeconds ?? DEFAULT_MAX_SECONDS) * RECORD_SAMPLE_RATE;
    // One minute up front; doubles as needed so short calls stay cheap.
    this.mix = new Int16Array(RECORD_SAMPLE_RATE * 60);
  }

  get durationSeconds(): number {
    return this.length / RECORD_SAMPLE_RATE;
  }

  get isEmpty(): boolean {
    return this.length === 0;
  }

  get hitLimit(): boolean {
    return this.truncated;
  }

  /** Caller audio, positioned by arrival time. */
  writeCaller(pcm: Int16Array, sampleRate: number): void {
    this.writeAt(this.clockOffset(), this.toRecordRate(pcm, sampleRate));
  }

  /** Agent audio, laid down contiguously from the start of its utterance. */
  writeAgent(pcm: Int16Array, sampleRate: number): void {
    const converted = this.toRecordRate(pcm, sampleRate);
    const offset = Math.max(this.agentCursor, this.clockOffset());
    this.writeAt(offset, converted);
    this.agentCursor = offset + converted.length;
  }

  /**
   * Mark the agent as no longer speaking.
   *
   * Without this an interrupted utterance leaves the cursor parked in the future,
   * so the next reply is written after silence that never happened.
   */
  agentStoppedSpeaking(): void {
    this.agentCursor = 0;
  }

  private clockOffset(): number {
    return Math.floor(((this.now() - this.startedAt) / 1000) * RECORD_SAMPLE_RATE);
  }

  private toRecordRate(pcm: Int16Array, sampleRate: number): Int16Array {
    return sampleRate === RECORD_SAMPLE_RATE ? pcm : resample(pcm, sampleRate, RECORD_SAMPLE_RATE);
  }

  /** Sum into the mix with saturation, so overlapping speech does not wrap. */
  private writeAt(offset: number, pcm: Int16Array): void {
    if (pcm.length === 0) return;
    const start = Math.max(0, offset);
    if (start >= this.maxSamples) {
      this.truncated = true;
      return;
    }
    const writable = Math.min(pcm.length, this.maxSamples - start);
    if (writable < pcm.length) this.truncated = true;

    this.ensureCapacity(start + writable);
    for (let i = 0; i < writable; i++) {
      const sum = this.mix[start + i] + pcm[i];
      this.mix[start + i] = sum > 32767 ? 32767 : sum < -32768 ? -32768 : sum;
    }
    if (start + writable > this.length) this.length = start + writable;
  }

  private ensureCapacity(needed: number): void {
    if (needed <= this.mix.length) return;
    let size = this.mix.length;
    while (size < needed) size *= 2;
    const grown = new Int16Array(Math.min(size, this.maxSamples));
    grown.set(this.mix.subarray(0, this.length));
    this.mix = grown;
  }

  /** The mix as a 16-bit mono WAV file. */
  toWav(): Buffer {
    return buildWavFile(this.mix.subarray(0, this.length), RECORD_SAMPLE_RATE);
  }

  /**
   * Upload and return the public URL, or null on any failure.
   *
   * A missing recording must never fail the call or block the webhook, so this
   * swallows errors after logging them.
   */
  async upload(
    sb: SupabaseClient,
    args: { workspaceId: string; callId: string },
  ): Promise<string | null> {
    if (this.isEmpty) return null;
    try {
      await ensureBucket(sb);
      const path = `${args.workspaceId}/${args.callId}.wav`;
      const { error } = await sb.storage
        .from(BUCKET)
        .upload(path, this.toWav(), { contentType: "audio/wav", upsert: true });
      if (error) {
        console.warn(`[voice-recording] upload failed for ${path}: ${error.message}`);
        return null;
      }
      const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
      return data?.publicUrl ?? null;
    } catch (err) {
      console.warn(
        "[voice-recording] upload threw:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }
}

async function ensureBucket(sb: SupabaseClient): Promise<void> {
  const { data: buckets } = await sb.storage.listBuckets();
  if ((buckets ?? []).some((b) => b.name === BUCKET)) return;
  await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 52_428_800 });
}

/** Canonical 44-byte RIFF header for 16-bit mono PCM. */
export function buildWavFile(samples: Int16Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  return buf;
}

export { RECORD_SAMPLE_RATE };
