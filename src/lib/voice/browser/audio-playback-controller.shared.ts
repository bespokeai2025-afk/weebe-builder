/**
 * Browser-side PCM16 playback queue with response-id filtering and barge-in support.
 *
 * Schedules gapless playback while chunks arrive, resyncs the playhead when the
 * queue drains (prevents long-utterance silence), and drops stale response audio.
 */

export interface AudioPlaybackControllerOptions {
  sampleRate?: number;
  /** First-chunk scheduling jitter (seconds). */
  firstChunkJitterSec?: number;
  /** Subsequent chunk jitter (seconds). */
  chunkJitterSec?: number;
  /** When true, reset playhead if chunks arrive after the queue drained. */
  resyncOnQueueDrain?: boolean;
  onFirstPlayback?: (responseId: number) => void;
  onQueueEmpty?: () => void;
  logPrefix?: string;
}

export class AudioPlaybackController {
  private nextPlayTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private activeResponseId = 0;
  private chunkCount = 0;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly sampleRate: number;
  private readonly firstChunkJitterSec: number;
  private readonly chunkJitterSec: number;
  private readonly resyncOnQueueDrain: boolean;
  private readonly onFirstPlayback?: (responseId: number) => void;
  private readonly onQueueEmpty?: () => void;
  private readonly log: string;

  constructor(
    private getCtx: () => AudioContext | null,
    private getGain: () => AudioNode | null,
    options: AudioPlaybackControllerOptions = {},
  ) {
    this.sampleRate = options.sampleRate ?? 24_000;
    this.firstChunkJitterSec = options.firstChunkJitterSec ?? 0.04;
    this.chunkJitterSec = options.chunkJitterSec ?? 0.012;
    this.resyncOnQueueDrain = options.resyncOnQueueDrain ?? true;
    this.onFirstPlayback = options.onFirstPlayback;
    this.onQueueEmpty = options.onQueueEmpty;
    this.log = options.logPrefix ?? "[audio-playback]";
  }

  get queueLength(): number {
    return this.activeSources.length;
  }

  get scheduledEndTime(): number {
    return this.nextPlayTime;
  }

  setActiveResponse(responseId: number): void {
    if (responseId !== this.activeResponseId) {
      this.cancelCurrentAudio("response_superseded");
      this.activeResponseId = responseId;
      this.chunkCount = 0;
    }
  }

  async enqueueAudio(b64: string, responseId: number): Promise<void> {
    if (!b64 || responseId !== this.activeResponseId) return;

    const ctx = this.getCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const binaryStr = atob(b64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const sampleCount = Math.floor(bytes.length / 2);
    if (sampleCount === 0) return;

    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i]! / 32768;

    const buf = ctx.createBuffer(1, float32.length, this.sampleRate);
    buf.copyToChannel(float32, 0);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.getGain() ?? ctx.destination);
    this.activeSources.push(src);

    src.onended = () => {
      const arr = this.activeSources;
      const idx = arr.indexOf(src);
      if (idx !== -1) arr.splice(idx, 1);
      if (arr.length === 0) this.onQueueEmpty?.();
    };

    if (this.chunkCount === 0) {
      console.log(
        `${this.log} first chunk response=${responseId} samples=${sampleCount} ctx=${ctx.state}`,
      );
      this.onFirstPlayback?.(responseId);
    }
    this.chunkCount += 1;

    if (
      this.resyncOnQueueDrain &&
      this.activeSources.length === 1 &&
      this.nextPlayTime > ctx.currentTime + 0.05
    ) {
      this.nextPlayTime = ctx.currentTime;
    }

    const jitter = this.chunkCount === 1 ? this.firstChunkJitterSec : this.chunkJitterSec;
    const startAt =
      this.nextPlayTime > ctx.currentTime ? this.nextPlayTime : ctx.currentTime + jitter;
    src.start(startAt);
    this.nextPlayTime = startAt + buf.duration;
  }

  stopPlayback(): void {
    this.cancelCurrentAudio("stop");
  }

  clearQueue(): void {
    this.cancelCurrentAudio("clear_queue");
  }

  cancelCurrentAudio(reason?: string): void {
    if (reason) {
      console.log(
        `${this.log} cancel response=${this.activeResponseId} queue=${this.activeSources.length} reason=${reason}`,
      );
    }
    for (const node of this.activeSources) {
      try {
        node.stop();
      } catch {
        /* already ended */
      }
    }
    this.activeSources = [];
    this.nextPlayTime = 0;
    this.chunkCount = 0;
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  /** Schedule callback once scheduled audio finishes playing. */
  schedulePlaybackComplete(callback: () => void, paddingMs = 300): void {
    const ctx = this.getCtx();
    const remainingMs =
      ctx && this.nextPlayTime > ctx.currentTime
        ? (this.nextPlayTime - ctx.currentTime) * 1000
        : 0;
    if (this.drainTimer !== null) clearTimeout(this.drainTimer);
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      callback();
    }, remainingMs + paddingMs);
  }

  reset(): void {
    this.cancelCurrentAudio("reset");
    this.activeResponseId = 0;
  }
}
