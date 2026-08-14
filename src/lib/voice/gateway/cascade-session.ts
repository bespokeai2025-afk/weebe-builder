/**
 * Cascade session — the native voice engine's conversation loop, minus transport.
 *
 * VAD -> STT -> conversation-graph VM (or a flat prompt) -> TTS, full duplex.
 * The browser relay and the WEBEE_NATIVE phone bridge drive the same instance of
 * this; only the wire format differs. Keeping one loop matters because barge-in,
 * turn cancellation and latency accounting are the subtle parts, and the previous
 * generation of relays proved that duplicating them means two sets of bugs.
 *
 * Everything is parameterised on `sampleRate`, so telephony can run the whole
 * pipeline at 8 kHz and never resample: mu-law decodes straight into the VAD and
 * TTS renders straight back out to mu-law.
 *
 * Playback tracking differs per transport, which is why `playback` exists:
 *   - "reported": the peer tells us when it finished playing (browser).
 *   - "estimated": nobody reports anything, so the end of playback is inferred
 *     from how much audio has been handed to the carrier (telephony). Without
 *     this the agent is never considered to be speaking and barge-in is dead.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { pcm16View } from "./audio";
import { GraphSession } from "./graph-session";
import { buildGraphRuntime, type GraphRuntime } from "./graph-agent";
import { type ChatMsg, gptStream } from "../llm/gpt";
import { CASCADE_SAMPLE_RATE, createSttProvider } from "../stt";
import type { SttProviderName, SttSession } from "../stt";
import { createTtsProvider } from "../tts";
import type { TtsProvider, TtsProviderName } from "../tts";
import { createVad, type Vad, type VadEvent } from "../vad";
import type { NativeCallLifecycle } from "../lifecycle/call-lifecycle";
import type { VariableValue } from "../graph/types";

/** Released automatically if the peer never reports playback completion. */
const PLAYBACK_TIMEOUT_MS = 30_000;
/**
 * Consecutive speech frames required to interrupt the agent.
 *
 * A single frame is not enough: echo cancellation is imperfect on both browsers
 * and phone lines, and a false interrupt is worse than a slightly late one
 * because it cuts the agent off mid-sentence for no reason.
 */
const BARGE_IN_SPEECH_FRAMES = 6;
/** Turnaround target from the plan; exceeding it is logged, not enforced. */
const LATENCY_BUDGET_MS = 800;

export type PlaybackTracking = "reported" | "estimated";

/** How a session reaches the caller. */
export interface CascadeTransport {
  /** One chunk of agent audio: PCM16 mono at the session's sample rate. */
  sendAudio(pcm: Buffer): void;
  /** Barge-in: drop everything already queued downstream, now. */
  clearAudio(): void;
  onTranscript?(role: "agent" | "user", text: string): void;
  onPartialTranscript?(text: string): void;
  /** Agent finished an utterance; the caller is expected to speak next. */
  onResponseDone?(): void;
  onEnd?(reason: string): void;
  onError?(message: string): void;
  /** Bridge the call. Resolve true once connected, false if it could not be. */
  transferCall?(destination: string, transferType: string): Promise<boolean>;
}

export interface CascadeSessionConfig {
  /** Reported call id; also the lifecycle's `call_id`. */
  callId: string;
  apiKey: string;
  voiceId: string;
  /** Text model for flat mode and graph generation. */
  model?: string;
  /** Flat-mode system prompt, used when there is no executable graph. */
  systemPrompt?: string;
  /** Flat-mode greeting. Graph mode greets from its start node instead. */
  beginMessage?: string;
  sampleRate?: number;
  logPrefix?: string;
  ttsProvider?: TtsProviderName | null;
  sttProvider?: SttProviderName | null;
  playback?: PlaybackTracking;
  /** Load the graph from storage. */
  agentId?: string | null;
  supabase?: SupabaseClient | null;
  /** Pre-exported flow, for builder test calls on unsaved agents. */
  flow?: unknown;
  settings?: Record<string, unknown> | null;
  variables?: Record<string, VariableValue>;
  /**
   * Attach call reporting once it is known whether a graph (and therefore a
   * stored agent) backs this call. Returning null disables reporting.
   */
  resolveLifecycle?(runtime: GraphRuntime | null): NativeCallLifecycle | null;
}

export interface CascadeSessionBanner {
  mode: "graph" | "flat";
  stt: string;
  tts: string;
  vad: string;
}

/** One caller turn, and the handle used to abandon it on barge-in. */
interface Turn {
  id: number;
  ctrl: AbortController;
  /** Endpoint timestamp, the reference point for the latency budget. */
  startedAt: number;
  sttAt?: number;
  firstAudioAt?: number;
}

export class CascadeSession {
  private readonly transport: CascadeTransport;
  private readonly config: CascadeSessionConfig;
  private readonly log: string;
  private readonly sampleRate: number;
  private readonly playbackTracking: PlaybackTracking;

  private tts: TtsProvider | null = null;
  private stt: SttSession | null = null;
  private vad: Vad | null = null;
  private graph: GraphSession | null = null;
  private lifecycleRef: NativeCallLifecycle | null = null;

  private voiceId: string;
  private readonly history: ChatMsg[] = [];

  /**
   * Frames must reach the VAD in order — it is a state machine — and a neural
   * detector's `push` is async, so frames are chained rather than raced.
   */
  private framePump: Promise<void> = Promise.resolve();

  private turn: Turn | null = null;
  private turnSeq = 0;
  private speechFrames = 0;
  /** "reported" mode: true from the first audio chunk until the peer says done. */
  private speakingFlag = false;
  /** "estimated" mode: epoch ms at which queued audio finishes playing. */
  private playheadAt = 0;
  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(transport: CascadeTransport, config: CascadeSessionConfig) {
    this.transport = transport;
    this.config = config;
    this.log = config.logPrefix ?? "[cascade]";
    this.sampleRate = config.sampleRate ?? CASCADE_SAMPLE_RATE;
    this.playbackTracking = config.playback ?? "reported";
    this.voiceId = config.voiceId;
  }

  get lifecycle(): NativeCallLifecycle | null {
    return this.lifecycleRef;
  }

  get isGraphMode(): boolean {
    return this.graph !== null;
  }

  /**
   * Bring up the pipeline and greet the caller.
   *
   * Graph mode is preferred whenever the agent has an executable flow; a missing
   * or broken flow falls back to the flat prompt rather than failing the call,
   * because by the time this runs someone is already on the line.
   */
  async start(): Promise<CascadeSessionBanner> {
    this.tts = createTtsProvider(this.config.ttsProvider ?? null);
    this.vad = await createVad({ inputSampleRate: this.sampleRate });

    const sttProvider = createSttProvider(this.config.sttProvider ?? null, {
      openaiApiKey: this.config.apiKey,
    });
    this.stt = await sttProvider.open({
      sampleRate: this.sampleRate,
      onPartial: (text) => this.transport.onPartialTranscript?.(text),
    });

    const runtime = await buildGraphRuntime({
      apiKey: this.config.apiKey,
      logPrefix: this.log,
      agentId: this.config.agentId ?? null,
      supabase: this.config.supabase ?? null,
      flow: this.config.flow,
      settings: this.config.settings ?? null,
      variables: this.config.variables,
    }).catch((err: Error) => {
      console.warn(`${this.log} graph unavailable, using flat prompt: ${err.message}`);
      return null;
    });

    this.lifecycleRef = this.config.resolveLifecycle?.(runtime) ?? null;

    const banner: CascadeSessionBanner = {
      mode: runtime ? "graph" : "flat",
      stt: sttProvider.name,
      tts: this.tts.name,
      vad: this.vad.name,
    };

    if (runtime) {
      // The agent's own voice wins over whatever the transport guessed.
      if (runtime.voiceId) this.voiceId = runtime.voiceId;
      for (const warning of runtime.warnings) console.warn(`${this.log} flow warning: ${warning}`);
      this.graph = this.buildGraphSession(runtime);
      console.log(
        `${this.log} session start mode=graph call=${this.config.callId} voice=${this.voiceId}` +
          ` stt=${banner.stt} tts=${banner.tts} vad=${banner.vad}`,
      );
      // The flow's start node provides the greeting, so a separately configured
      // begin message is ignored here to avoid saying hello twice.
      await this.graph.begin();
      return banner;
    }

    console.log(
      `${this.log} session start mode=flat call=${this.config.callId} voice=${this.voiceId}` +
        ` stt=${banner.stt} tts=${banner.tts} vad=${banner.vad}`,
    );

    const greeting = (this.config.beginMessage ?? "").trim();
    if (greeting) {
      this.history.push({ role: "assistant", content: greeting });
      this.lifecycleRef?.addTurn("agent", greeting);
      this.transport.onTranscript?.("agent", greeting);
      await this.streamTts(greeting, this.beginTurn(Date.now()));
      this.awaitPlayback();
    }
    return banner;
  }

  /** Feed one PCM16 mono frame from the caller, at the session's sample rate. */
  pushCallerAudio(chunk: Buffer): void {
    const detector = this.vad;
    if (!detector || this.closed || chunk.byteLength === 0) return;

    // Full duplex: audio is processed while the agent speaks, which is what makes
    // barge-in possible at all.
    this.stt?.push(chunk);
    this.lifecycleRef?.recordCaller(pcm16View(chunk), this.sampleRate);
    this.framePump = this.framePump
      .then(async () => {
        this.handleVadEvent(await detector.push(chunk));
      })
      .catch((err: Error) => {
        console.error(`${this.log} VAD error: ${err.message}`);
      });
  }

  /** A keypad digit from the caller. Only graph mode routes on digits. */
  submitDigit(digit: string): void {
    const trimmed = digit.trim();
    if (!this.graph || !trimmed) return;
    this.graph.submitDigit(trimmed).catch((err: Error) => {
      this.transport.onError?.(err.message);
    });
  }

  /** The peer finished playing everything we sent ("reported" mode only). */
  playbackDone(): void {
    this.endPlayback();
  }

  /** Tear down. Idempotent; safe to call from a socket close handler. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.endPlayback();
    this.turn?.ctrl.abort();
    this.stt?.close();
  }

  // ── Conversation drivers ───────────────────────────────────────────────────

  private buildGraphSession(runtime: GraphRuntime): GraphSession {
    return new GraphSession(runtime.vm, {
      speak: (text) => this.streamTts(text, this.turn ?? this.beginTurn(Date.now())),
      onTranscript: (role, text) => {
        // Agent lines only: user lines are recorded at transcription time, so
        // adding them again here would duplicate every caller turn.
        if (role === "agent") this.lifecycleRef?.addTurn("agent", text);
        this.transport.onTranscript?.(role, text);
      },
      onTransfer: async (destination, transferType) => {
        if (!this.transport.transferCall) return false;
        const ok = await this.transport.transferCall(destination, transferType).catch(() => false);
        if (ok) this.lifecycleRef?.transferred(destination);
        return ok;
      },
      onAwaitUser: () => this.awaitPlayback(),
      onAwaitDigit: () => this.awaitPlayback(),
      onEnd: (reason) => {
        this.transport.onEnd?.(reason);
        void this.lifecycleRef?.ended("agent_hangup");
        // Leave the transport open so buffered audio finishes playing.
        this.awaitPlayback();
      },
      onError: (message) => this.transport.onError?.(message),
    });
  }

  /** Flat mode: one system prompt, tokens piped straight into TTS. */
  private async runFlatTurn(userText: string, t: Turn): Promise<void> {
    const historyLenBefore = this.history.length;
    this.history.push({ role: "user", content: userText });
    const messages: ChatMsg[] = [
      { role: "system", content: this.config.systemPrompt ?? "" },
      ...this.history,
    ];

    let agentText = "";
    const self = this;
    async function* tokensCapturingText(): AsyncGenerator<string> {
      for await (const delta of gptStream(messages, {
        model: self.config.model ?? "gpt-4.1",
        apiKey: self.config.apiKey,
        signal: t.ctrl.signal,
      })) {
        agentText += delta;
        yield delta;
      }
      // Publish the transcript as soon as the model finishes rather than after the
      // audio drains, so on-screen text is not held back by playback.
      agentText = agentText.trim();
      if (agentText) {
        self.history.push({ role: "assistant", content: agentText });
        self.lifecycleRef?.addTurn("agent", agentText);
        self.transport.onTranscript?.("agent", agentText);
      }
    }

    try {
      await this.streamTts(tokensCapturingText(), t);
    } catch (err) {
      if (t.ctrl.signal.aborted) return;
      const message = (err as Error).message;
      console.error(`${this.log} LLM/TTS error: ${message}`);
      this.transport.onError?.(`Response error: ${message}`);
      this.history.length = historyLenBefore;
      this.endPlayback();
      return;
    }

    if (t.ctrl.signal.aborted) return;
    if (!agentText) {
      this.history.length = historyLenBefore;
      this.endPlayback();
      return;
    }
    this.awaitPlayback();
  }

  /** Transcribe an endpointed utterance and hand it to whichever driver is active. */
  private async processTurn(frames: Buffer[], endpointAt: number): Promise<void> {
    const t = this.beginTurn(endpointAt);

    let userText: string;
    try {
      userText = this.stt ? await this.stt.finalizeUtterance(frames) : "";
    } catch (err) {
      const message = (err as Error).message;
      console.error(`${this.log} STT error: ${message}`);
      this.transport.onError?.(`STT error: ${message}`);
      this.endPlayback();
      return;
    }
    t.sttAt = Date.now();

    // A turn cancelled while we were transcribing has already been superseded.
    if (t.ctrl.signal.aborted) return;
    if (!userText.trim()) {
      this.endPlayback();
      return;
    }

    this.lifecycleRef?.addTurn("user", userText);
    this.transport.onTranscript?.("user", userText);

    if (this.graph) {
      // The graph owns speech, transcripts and playback gating from here.
      await this.graph.submitUserText(userText);
      return;
    }
    await this.runFlatTurn(userText, t);
  }

  // ── Audio out ──────────────────────────────────────────────────────────────

  /**
   * Stream synthesised speech to the transport.
   *
   * Int16 alignment across chunk boundaries is handled by the TTS provider.
   */
  private async streamTts(source: string | AsyncIterable<string>, t: Turn): Promise<void> {
    const tts = this.tts;
    if (!tts) throw new Error("TTS provider not initialised");
    const req = { voiceId: this.voiceId, sampleRate: this.sampleRate, latency: "low" as const };
    const audio =
      typeof source === "string" ? tts.synthesize(source, req) : tts.synthesizeStream(source, req);

    for await (const chunk of audio) {
      // Breaking out here also returns the generator, which closes the provider's
      // upstream socket instead of leaving it streaming audio nobody wants.
      if (t.ctrl.signal.aborted || this.closed) break;
      if (!t.firstAudioAt) {
        t.firstAudioAt = Date.now();
        this.reportLatency(t);
      }
      this.lifecycleRef?.recordAgent(pcm16View(chunk), this.sampleRate);
      this.emitAudio(chunk);
    }
  }

  private emitAudio(chunk: Buffer): void {
    this.transport.sendAudio(chunk);
    if (this.playbackTracking === "reported") {
      this.speakingFlag = true;
      return;
    }
    // Audio leaves faster than it plays, so the playhead advances by the chunk's
    // real duration from wherever the previous chunk ended.
    const durationMs = (chunk.byteLength / 2 / this.sampleRate) * 1000;
    this.playheadAt = Math.max(this.playheadAt, Date.now()) + durationMs;
  }

  private get agentSpeaking(): boolean {
    return this.playbackTracking === "estimated"
      ? this.playheadAt > Date.now()
      : this.speakingFlag;
  }

  /** Signal the end of agent audio and wait for it to drain. */
  private awaitPlayback(): void {
    this.transport.onResponseDone?.();
    if (this.playbackTracking !== "reported") return;
    if (this.playbackTimer) clearTimeout(this.playbackTimer);
    this.playbackTimer = setTimeout(() => this.endPlayback(), PLAYBACK_TIMEOUT_MS);
  }

  private endPlayback(): void {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
    this.speakingFlag = false;
    this.playheadAt = 0;
  }

  // ── Turn bookkeeping ───────────────────────────────────────────────────────

  private beginTurn(startedAt: number): Turn {
    this.turnSeq += 1;
    this.turn = { id: this.turnSeq, ctrl: new AbortController(), startedAt };
    return this.turn;
  }

  /**
   * Abandon the in-flight turn.
   *
   * Aborting the controller stops the LLM mid-generation and breaks the TTS loop;
   * `clearAudio` is what actually silences the agent, since the transport has
   * already buffered audio the session can no longer recall.
   */
  private cancelTurn(reason: string): void {
    if (!this.turn) return;
    console.log(`${this.log} turn ${this.turn.id} cancelled (${reason})`);
    this.turn.ctrl.abort();
    this.turn = null;
    this.transport.clearAudio();
    // The recording must not keep a cursor parked past an utterance that was cut
    // short, or the next reply lands after silence that never happened.
    this.lifecycleRef?.agentStoppedSpeaking();
    this.endPlayback();
  }

  private reportLatency(t: Turn): void {
    const span = (from: number, to?: number) => (to ? `${Math.round(to - from)}ms` : "n/a");
    const total = t.firstAudioAt ? Math.round(t.firstAudioAt - t.startedAt) : null;
    console.log(
      `${this.log} turn ${t.id} latency` +
        ` endpoint→stt=${span(t.startedAt, t.sttAt)}` +
        ` stt→audio=${t.sttAt ? span(t.sttAt, t.firstAudioAt) : "n/a"}` +
        ` total=${total !== null ? `${total}ms` : "n/a"}` +
        `${total !== null && total > LATENCY_BUDGET_MS ? " OVER BUDGET" : ""}`,
    );
  }

  /** Act on one VAD verdict. */
  private handleVadEvent(event: VadEvent): void {
    switch (event.type) {
      case "speech_start":
        this.speechFrames = 1;
        break;
      case "speech":
        this.speechFrames += 1;
        break;
      case "silence":
        this.speechFrames = 0;
        return;
      case "discarded":
        this.speechFrames = 0;
        console.log(`${this.log} utterance too short (${event.frameCount} frames)`);
        return;
      case "utterance_end":
        this.speechFrames = 0;
        this.processTurn(event.frames, Date.now()).catch((err: Error) => {
          console.error(`${this.log} processTurn unhandled: ${err.message}`);
          this.endPlayback();
        });
        return;
    }

    // Barge-in: sustained caller speech over the agent's own audio.
    if (this.agentSpeaking && this.speechFrames === BARGE_IN_SPEECH_FRAMES) {
      this.cancelTurn("caller interrupted");
    }
  }
}
