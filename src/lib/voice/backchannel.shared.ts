/**
 * When the agent should backchannel ("mm-hm", "yeah") while the caller is talking.
 *
 * Builder settings `enableBackchannel`, `backchannelFrequency` and `backchannelWords` were stored
 * and exported to Retell but never used by WEBEE Native. This decides the moments; the session
 * plays a short pre-rendered clip of the agent's own voice without taking the turn.
 *
 * A backchannel only fits inside a long turn: the caller has been talking a while and has paused
 * briefly mid-thought. It must never land on a turn's ending (the agent is about to answer) or
 * repeat too often, so: at least `minTalkMs` of caller speech, a pause of `pauseMs` that is
 * shorter than the endpoint wait, a gap of `minGapMs` since the last one, then a coin flip
 * weighted by the builder's frequency.
 */

export const DEFAULT_BACKCHANNEL_WORDS = ["mm-hmm", "yeah", "right", "okay"];

export interface BackchannelOptions {
  /** 0–1, the builder's backchannel frequency. */
  frequency: number;
  minTalkMs?: number;
  pauseMs?: number;
  minGapMs?: number;
}

export class BackchannelScheduler {
  private readonly frequency: number;
  private readonly minTalkMs: number;
  private readonly pauseMs: number;
  private readonly minGapMs: number;
  private talking = false;
  private talkStartAt = 0;
  private silentMs = 0;
  private peakRms = 0;
  private decidedThisPause = false;
  private lastFiredAt = -Infinity;

  constructor(options: BackchannelOptions) {
    this.frequency = Math.min(1, Math.max(0, Number.isFinite(options.frequency) ? options.frequency : 0.3));
    this.minTalkMs = options.minTalkMs ?? 3000;
    this.pauseMs = options.pauseMs ?? 280;
    this.minGapMs = options.minGapMs ?? 5000;
  }

  /** The caller started a new burst of speech. */
  startTalking(now: number): void {
    this.talking = true;
    this.talkStartAt = now;
    this.silentMs = 0;
    this.peakRms = 0;
    this.decidedThisPause = false;
  }

  /** The caller's turn ended (or was reset). */
  stopTalking(): void {
    this.talking = false;
  }

  /**
   * One frame of caller audio while their turn is open. Returns true when a backchannel should
   * play now. `random` is injectable for tests.
   */
  onFrame(input: {
    now: number;
    rms: number;
    frameMs: number;
    agentBusy: boolean;
    random?: () => number;
  }): boolean {
    if (!this.talking || input.agentBusy || this.frequency <= 0) return false;
    this.peakRms = Math.max(this.peakRms, input.rms);
    const quiet = input.rms < Math.max(250, this.peakRms * 0.15);
    if (!quiet) {
      this.silentMs = 0;
      this.decidedThisPause = false;
      return false;
    }
    this.silentMs += input.frameMs;
    if (this.decidedThisPause || this.silentMs < this.pauseMs) return false;
    // One decision per pause, whether or not it fires.
    this.decidedThisPause = true;
    if (input.now - this.talkStartAt < this.minTalkMs) return false;
    if (input.now - this.lastFiredAt < this.minGapMs) return false;
    if ((input.random ?? Math.random)() >= this.frequency) return false;
    this.lastFiredAt = input.now;
    return true;
  }
}

/** Trim leading/trailing near-silence from a PCM16 clip and soften it, so it reads as a murmur. */
export function prepareBackchannelClip(pcm: Buffer, gain = 0.6): Buffer {
  const samples = Math.floor(pcm.byteLength / 2);
  let start = 0;
  let end = samples;
  const threshold = 400;
  while (start < end && Math.abs(pcm.readInt16LE(start * 2)) < threshold) start++;
  while (end > start && Math.abs(pcm.readInt16LE((end - 1) * 2)) < threshold) end--;
  const out = Buffer.alloc((end - start) * 2);
  for (let i = start; i < end; i++) {
    const v = Math.round(pcm.readInt16LE(i * 2) * gain);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, v)), (i - start) * 2);
  }
  return out;
}
