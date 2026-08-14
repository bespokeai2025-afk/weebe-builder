/**
 * Voice activity detection — shared contract.
 *
 * `push` may return synchronously or asynchronously: the energy detector is pure
 * arithmetic, while a neural detector runs ONNX inference. Callers must therefore
 * `await` the result and keep frames strictly ordered — a VAD is a state machine,
 * so processing frame N+1 before frame N corrupts endpointing.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

export type VadEvent =
  /** Nothing to do. */
  | { type: "silence" }
  /** First frame of a new utterance. */
  | { type: "speech_start"; rms: number }
  /** Still inside an utterance. */
  | { type: "speech" }
  /** Endpoint reached; `frames` is the complete utterance including pre-roll. */
  | { type: "utterance_end"; frames: Buffer[]; reason: "endpoint" | "max_duration" }
  /** Endpoint reached but the utterance was too short to be speech. */
  | { type: "discarded"; frameCount: number };

export interface Vad {
  /** Feed one PCM16 mono frame. */
  push(frame: Buffer): VadEvent | Promise<VadEvent>;
  /** Drop any partially captured utterance. */
  reset(): void;
  /** True while an utterance is being captured. */
  readonly isSpeaking: boolean;
  /** Identifies the backend in logs and latency reports. */
  readonly name: string;
}

export interface EndpointingOptions {
  /**
   * Consecutive silent frames that close an utterance.
   *
   * This is the single biggest lever on perceived latency: every frame of
   * hangover is added to every turn's response time. Frames are ~20 ms.
   */
  silenceFramesTrigger?: number;
  /** Consecutive loud frames required to open an utterance; rejects clicks. */
  startFrames?: number;
  /** Minimum captured frames before an utterance is worth transcribing. */
  minSpeechFrames?: number;
  /**
   * Frames of audio kept from before speech was detected.
   *
   * Without pre-roll the onset consonant is clipped, and transcribers routinely
   * turn a clipped "fifty" into "fifty" vs "if he" style errors.
   */
  preRollFrames?: number;
  /** Hard cap so an open mic cannot buffer without bound. */
  maxUtteranceFrames?: number;
}

/**
 * Endpointing state machine shared by every detector.
 *
 * Detectors only decide "is this frame speech"; when a turn starts and stops is
 * identical logic regardless of how that decision was made, and duplicating it
 * per backend is how the two old relays drifted apart.
 */
export class Endpointer {
  private readonly silenceFramesTrigger: number;
  private readonly startFrames: number;
  private readonly minSpeechFrames: number;
  private readonly preRollFrames: number;
  private readonly maxUtteranceFrames: number;

  private state: "idle" | "speaking" = "idle";
  private frames: Buffer[] = [];
  /** Ring of recent pre-speech frames, so the onset is not clipped. */
  private preRoll: Buffer[] = [];
  private silentFrames = 0;
  private loudRun = 0;

  constructor(options: EndpointingOptions = {}) {
    this.silenceFramesTrigger = options.silenceFramesTrigger ?? 24;
    this.startFrames = options.startFrames ?? 2;
    this.minSpeechFrames = options.minSpeechFrames ?? 10;
    this.maxUtteranceFrames = options.maxUtteranceFrames ?? 1500;
    // The frames that made up the opening run are speech and must survive, so the
    // ring is never smaller than that run however pre-roll is configured.
    this.preRollFrames = Math.max(options.preRollFrames ?? 8, this.startFrames - 1);
  }

  get isSpeaking(): boolean {
    return this.state === "speaking";
  }

  reset(): void {
    this.state = "idle";
    this.frames = [];
    this.preRoll = [];
    this.silentFrames = 0;
    this.loudRun = 0;
  }

  /** Advance the machine with one frame's speech/non-speech verdict. */
  step(frame: Buffer, isSpeech: boolean, level: number): VadEvent {
    if (this.state === "idle") {
      if (!isSpeech) {
        this.loudRun = 0;
        this.rememberPreRoll(frame);
        return { type: "silence" };
      }
      this.loudRun++;
      // Require a short run so a door click or keyboard tap cannot open a turn.
      if (this.loudRun < this.startFrames) {
        this.rememberPreRoll(frame);
        return { type: "silence" };
      }

      this.state = "speaking";
      this.silentFrames = 0;
      // The triggering frame is always kept, whatever the pre-roll budget is.
      this.frames = [...this.preRoll, frame];
      this.preRoll = [];
      return { type: "speech_start", rms: level };
    }

    // Trailing silence stays in the buffer: trimming it clips soft word endings
    // the transcriber needs for the final word.
    this.frames.push(frame);

    if (this.frames.length >= this.maxUtteranceFrames) {
      const captured = this.frames;
      this.reset();
      return { type: "utterance_end", frames: captured, reason: "max_duration" };
    }

    if (isSpeech) {
      this.silentFrames = 0;
      return { type: "speech" };
    }

    this.silentFrames++;
    if (this.silentFrames < this.silenceFramesTrigger) return { type: "speech" };

    const captured = this.frames;
    const frameCount = captured.length;
    this.reset();

    if (frameCount < this.minSpeechFrames) return { type: "discarded", frameCount };
    return { type: "utterance_end", frames: captured, reason: "endpoint" };
  }

  private rememberPreRoll(frame: Buffer): void {
    if (this.preRollFrames <= 0) return;
    this.preRoll.push(frame);
    if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
  }
}
