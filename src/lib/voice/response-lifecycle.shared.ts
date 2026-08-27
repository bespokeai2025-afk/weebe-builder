/**
 * Response identity and cancellation for WEBEE Native voice playback.
 *
 * Every agent utterance gets a monotonic responseId. Late LLM tokens, TTS chunks
 * and transport audio tagged with a stale id are dropped — Retell-style.
 *
 * Turn-level abort (LLM/TTS) stays on the turn's AbortController in CascadeSession;
 * this type only tracks which response id is allowed to emit audio.
 */

import type { VoiceAudioState } from "./voice-runtime-config.shared";

export interface ResponseLifecycleSnapshot {
  responseId: number;
  turnId: number;
  state: VoiceAudioState;
  nodeId?: string;
  cancelReason?: string;
}

export class ResponseLifecycle {
  private seq = 0;
  private activeId = 0;
  private activeTurnId = 0;
  private activeNodeId: string | undefined;
  private state: VoiceAudioState = "idle";
  private cancelReason: string | undefined;

  get snapshot(): ResponseLifecycleSnapshot {
    return {
      responseId: this.activeId,
      turnId: this.activeTurnId,
      state: this.state,
      nodeId: this.activeNodeId,
      cancelReason: this.cancelReason,
    };
  }

  get activeResponseId(): number {
    return this.activeId;
  }

  setState(state: VoiceAudioState): void {
    this.state = state;
  }

  /** Begin a new response; invalidates any in-flight response id. */
  begin(turnId: number, nodeId?: string): number {
    this.invalidate("superseded");
    this.seq += 1;
    this.activeId = this.seq;
    this.activeTurnId = turnId;
    this.activeNodeId = nodeId;
    this.cancelReason = undefined;
    this.state = "generating";
    return this.activeId;
  }

  isActive(responseId: number): boolean {
    return responseId > 0 && responseId === this.activeId;
  }

  markSpeaking(): void {
    if (this.activeId > 0) this.state = "speaking";
  }

  markListening(): void {
    this.state = "listening";
  }

  markIdle(): void {
    this.state = "idle";
    this.activeId = 0;
    this.activeTurnId = 0;
    this.activeNodeId = undefined;
    this.cancelReason = undefined;
  }

  markInterrupted(reason: string): void {
    this.cancelReason = reason;
    this.state = "interrupted";
  }

  /** Invalidate the active response without touching the turn AbortController. */
  invalidate(reason: string): number {
    const prev = this.activeId;
    if (this.activeId > 0) {
      this.cancelReason = reason;
      this.activeId = 0;
      this.state = "cancelled";
    }
    return prev;
  }

  cancel(reason: string): number {
    return this.invalidate(reason);
  }
}
