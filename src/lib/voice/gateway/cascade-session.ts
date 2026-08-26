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
import type { ConversationVm } from "../graph/vm";
import type { VmLatencyHooks } from "../graph/types";
import { type ChatMsg, gptStream } from "../llm/gpt";
import {
  CASCADE_SAMPLE_RATE,
  createSttProvider,
} from "../stt";
import type { SttProviderName, SttSession } from "../stt";
import { createTtsProvider } from "../tts";
import { normalizeSpeechText } from "../tts/types";
import { FishAudioTtsProvider, resolveFishTtsModel } from "../tts/fish.provider";
import type { TtsProvider, TtsProviderName } from "../tts";
import { createVad, EnergyVad, type Vad, type VadEvent } from "../vad";
import type { NativeCallLifecycle } from "../lifecycle/call-lifecycle";
import {
  buildLanguageLockInstruction,
  normalizeEnglishLockedSttText,
  resolveSttLanguageCode,
} from "../language-lock.shared";
import { resolveCascadeTuning } from "../cascade-tuning.shared";
import { WEBEE_NATIVE_SPEECH_MODEL } from "../webee-native.shared";
import { CallTurnTrace } from "../graph/latency-trace";
import {
  partialMatchesFinal,
  startSpeculativeFlat,
  startSpeculativeSpeech,
  streamSpeculativeTokens,
  type SpeculativeFlatRun,
} from "./speculative-flat";

/** Partial must be unchanged this long before speculative LLM starts. */
const PARTIAL_STABLE_MS = 350;
/** Minimum partial length to start speculative generation. */
const PARTIAL_MIN_CHARS = 4;
/** When agent is speaking, ignore quiet VAD (likely echo) below this RMS. */
const BARGE_IN_MIN_RMS = 900;
/** After TTS finishes sending, ignore quiet echo unless the caller is clearly loud. */
const BARGE_IN_POST_TTS_GRACE_MS = 450;
const BARGE_IN_LOUD_RMS = 1400;

/** Released automatically if the peer never reports playback completion. */
const PLAYBACK_TIMEOUT_MS = 30_000;
/**
 * Consecutive speech frames required to interrupt the agent.
 *
 * A single frame is not enough: echo cancellation is imperfect on both browsers
 * and phone lines, and a false interrupt is worse than a slightly late one
 * because it cuts the agent off mid-sentence for no reason.
 */
const BARGE_IN_SPEECH_FRAMES_DEFAULT = 6;
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
  /** Graph VM entered a node — used to highlight the active step in the Builder. */
  onNodeActive?(nodeId: string): void;
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
  /** BCP-47 speech languages from builder settings — drives STT + language lock. */
  speechLanguages?: string[];
  /** Builder tuning mapped into VAD / barge-in. */
  silenceDurationMs?: number;
  responsiveness?: number;
  interruptionSensitivity?: number;
  /** Deepgram keyword boost from builder boostedKeywords. */
  boostedKeywords?: string[];
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
  /** Graph routing finished and TTS pipeline is starting. */
  speakAt?: number;
  firstAudioAt?: number;
  trace?: CallTurnTrace;
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
  private graphVm: ConversationVm | null = null;
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
  private bargeInSpeechFrames = BARGE_IN_SPEECH_FRAMES_DEFAULT;
  private readonly languageLock: string;
  private readonly sttLanguage?: string;
  private readonly fishTtsModel: string;
  private readonly vadTuning: import("../vad/types").EndpointingOptions;

  /** Partial STT tracking for speculative flat-mode LLM. */
  private partialNormalized = "";
  private partialStableSince = 0;
  private speculativeFlat: SpeculativeFlatRun | null = null;
  /** Avoid restarting graph speculative LLM on every partial tick. */
  private speculativeGraphKey = "";
  private callerSpeaking = false;
  private lastSpeechRms = 0;
  /** When the last TTS stream finished sending (playback may still be draining). */
  private ttsStreamEndedAt = 0;
  /** Serialises caller turns so overlapping VAD endpoints do not stack agent replies. */
  private turnPipeline: Promise<void> = Promise.resolve();
  /** Frames accumulated across brief mid-thought pauses before STT runs. */
  private pendingUtteranceFrames: Buffer[] = [];
  private utteranceCoalesceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly utteranceCoalesceMs: number;

  constructor(transport: CascadeTransport, config: CascadeSessionConfig) {
    this.transport = transport;
    this.config = config;
    this.log = config.logPrefix ?? "[cascade]";
    this.sampleRate = config.sampleRate ?? CASCADE_SAMPLE_RATE;
    this.playbackTracking = config.playback ?? "reported";
    this.voiceId = config.voiceId;
    this.languageLock = buildLanguageLockInstruction(config.speechLanguages);
    this.sttLanguage = resolveSttLanguageCode(config.speechLanguages);
    this.fishTtsModel = resolveFishTtsModel();
    const tuning = resolveCascadeTuning({
      silenceDurationMs: config.silenceDurationMs,
      responsiveness: config.responsiveness,
      interruptionSensitivity: config.interruptionSensitivity,
    });
    this.bargeInSpeechFrames = tuning.bargeInSpeechFrames;
    this.vadTuning = tuning.vad;
    this.utteranceCoalesceMs = tuning.utteranceCoalesceMs;
  }

  get lifecycle(): NativeCallLifecycle | null {
    return this.lifecycleRef;
  }

  get isGraphMode(): boolean {
    return this.graph !== null;
  }

  /**
   * Bring up STT/TTS/VAD and load the graph, without speaking yet.
   * Browser relay sends `relay.connected` after this so the mic can open
   * while the greeting TTS is still synthesizing.
   */
  async prepare(): Promise<CascadeSessionBanner> {
    this.tts = createTtsProvider("fish", {
      fishApiKey: process.env.FISH_API_KEY,
      fishTtsModel: this.fishTtsModel,
    });
    // Browser relay ("reported" playback): energy VAD tracks mic RMS reliably.
    // Silero ONNX often never crosses threshold on laptop mics in dev.
    // Telephony ("estimated" playback): prefer Silero when the model is present.
    if (this.playbackTracking === "reported") {
      this.vad = new EnergyVad({
        ...this.vadTuning,
        warmupFrames: 4,
        minThreshold: 180,
      });
    } else {
      this.vad = await createVad({
        inputSampleRate: this.sampleRate,
        threshold: 0.35,
        ...this.vadTuning,
      });
    }

    const sttProvider = createSttProvider("fish", { fishApiKey: process.env.FISH_API_KEY });
    this.stt = await sttProvider.open({
      sampleRate: this.sampleRate,
      language: this.sttLanguage,
      keywords: this.config.boostedKeywords,
      onPartial: (text) => {
        this.transport.onPartialTranscript?.(text);
        this.onCallerPartial(text);
      },
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
      if (runtime.voiceId) this.voiceId = runtime.voiceId;
      for (const warning of runtime.warnings) console.warn(`${this.log} flow warning: ${warning}`);
      this.graphVm = runtime.vm;
      this.graphVm.setLatencyHooks(this.buildVmLatencyHooks());
      this.graph = this.buildGraphSession(runtime);
      this.warmTts();
      console.log(
        `${this.log} session ready mode=graph call=${this.config.callId} voice=${this.voiceId}` +
          ` stt=${banner.stt} tts=${banner.tts} tts_model=${this.fishTtsModel} vad=${banner.vad}`,
      );
      return banner;
    }

    console.log(
      `${this.log} session ready mode=flat call=${this.config.callId} voice=${this.voiceId}` +
        ` stt=${banner.stt} tts=${banner.tts} tts_model=${this.fishTtsModel} vad=${banner.vad}`,
    );
    this.warmTts();
    return banner;
  }

  /** Speak the greeting / flow start node after the transport is connected. */
  async beginConversation(): Promise<void> {
    if (this.graph) {
      await this.graph.begin();
      this.warmTts();
      return;
    }

    const greeting = (this.config.beginMessage ?? "").trim();
    if (greeting) {
      this.history.push({ role: "assistant", content: greeting });
      this.lifecycleRef?.addTurn("agent", greeting);
      this.transport.onTranscript?.("agent", greeting);
      await this.streamTts(greeting, this.beginTurn(Date.now()));
      this.awaitPlayback();
    }
    this.warmTts();
  }

  /** Telephony: prepare + greet in one step (caller is already on the line). */
  async start(): Promise<CascadeSessionBanner> {
    const banner = await this.prepare();
    await this.beginConversation();
    return banner;
  }

  /** Feed one PCM16 mono frame from the caller, at the session's sample rate. */
  pushCallerAudio(chunk: Buffer): void {
    const detector = this.vad;
    if (!detector || this.closed || chunk.byteLength === 0) return;

    // Full duplex: audio is processed while the agent speaks, which is what makes
    // barge-in possible at all.
    // Full duplex: VAD runs while the agent speaks (barge-in). STT is gated so
    // speaker echo does not fill the Fish buffer before the caller's turn.
    if (!this.agentSpeaking) {
      this.stt?.push(chunk);
    }
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
    console.log(`${this.log} playback done — caller may speak`);
    this.endPlayback();
  }

  /** Tear down. Idempotent; safe to call from a socket close handler. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearUtteranceCoalesce();
    this.endPlayback();
    this.turn?.ctrl.abort();
    this.stt?.close();
  }

  // ── Conversation drivers ───────────────────────────────────────────────────

  private buildVmLatencyHooks(): VmLatencyHooks {
    return {
      onRouteStart: () => this.warmTts(),
      onSpeculativeTts: (text) => {
        if (text) this.warmTtsWithText(text);
        else this.warmTts();
      },
    };
  }

  private logSpeculativeStatic(text: string): void {
    console.log(`${this.log} speculative TTS warm (${text.slice(0, 48)}${text.length > 48 ? "…" : ""})`);
  }

  /** Fish partial transcript while the caller is still speaking. */
  private onCallerPartial(raw: string): void {
    const normalized = normalizeEnglishLockedSttText(raw.trim(), this.sttLanguage);
    if (!normalized || normalized.length < 2) return;

    this.warmTts();

    if (this.graphVm) {
      const target = this.graphVm.peekSpeechWarmTarget(normalized);
      if (target?.kind === "static") {
        this.warmTtsWithText(target.text);
        this.logSpeculativeStatic(target.text);
      }
    }

    if (normalized === this.partialNormalized) {
      if (!this.partialStableSince) this.partialStableSince = Date.now();
    } else {
      this.partialNormalized = normalized;
      this.partialStableSince = Date.now();
      this.abortSpeculativeFlat("partial changed");
      this.speculativeGraphKey = "";
      this.graphVm?.clearSpeculativeSpeech();
    }

    if (
      this.callerSpeaking &&
      !this.agentSpeaking &&
      normalized.length >= PARTIAL_MIN_CHARS &&
      Date.now() - this.partialStableSince >= PARTIAL_STABLE_MS
    ) {
      this.turn?.trace?.mark("partial_stt_stable");
      if (this.graphVm) this.maybeStartSpeculativeGraph(normalized);
      else this.maybeStartSpeculativeFlat(normalized);
    }
  }

  private maybeStartSpeculativeGraph(partial: string): void {
    const vm = this.graphVm;
    if (!vm) return;

    const target = vm.peekSpeechWarmTarget(partial);
    if (!target || target.kind !== "prompt") return;

    const key = `${target.nodeId}:${partial}`;
    if (this.speculativeGraphKey === key) return;
    this.speculativeGraphKey = key;

    const run = startSpeculativeSpeech({
      apiKey: this.config.apiKey,
      model: target.model,
      messages: [...target.messages, { role: "user", content: partial }],
      partial,
    });
    vm.setSpeculativeSpeech(target.nodeId, run);
    this.turn?.trace?.mark("speculative_llm_start");
    console.log(
      `${this.log} speculative graph LLM started node=${target.nodeId} (${partial.slice(0, 40)})`,
    );
  }

  private maybeStartSpeculativeFlat(partial: string): void {
    if (this.speculativeFlat?.partial === partial) return;
    this.abortSpeculativeFlat("superseded");

    const systemContent = [this.config.systemPrompt ?? "", this.languageLock]
      .filter(Boolean)
      .join("\n\n");
    this.speculativeFlat = startSpeculativeFlat({
      apiKey: this.config.apiKey,
      model: this.config.model ?? WEBEE_NATIVE_SPEECH_MODEL,
      systemContent,
      history: this.history,
      partialUserText: partial,
    });
    this.turn?.trace?.mark("speculative_llm_start");
    console.log(`${this.log} speculative flat LLM started (${partial.slice(0, 40)})`);
  }

  private abortSpeculativeFlat(reason: string): void {
    if (!this.speculativeFlat) return;
    this.speculativeFlat.ctrl.abort();
    this.speculativeFlat = null;
    void reason;
  }

  private buildGraphSession(runtime: GraphRuntime): GraphSession {
    return new GraphSession(runtime.vm, {
      speak: (source, options) => {
        const t = this.turn ?? this.beginTurn(Date.now());
        if (!t.speakAt) {
          t.speakAt = Date.now();
          t.trace?.mark("tts_speak_start");
        }
        if (options.nodeId) this.transport.onNodeActive?.(options.nodeId);
        return this.streamTts(source, t);
      },
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
    const speculative = this.speculativeFlat;
    this.speculativeFlat = null;

    if (speculative && partialMatchesFinal(speculative.partial, userText)) {
      console.log(`${this.log} turn ${t.id} using speculative flat LLM (${userText.slice(0, 40)})`);
      const historyLenBefore = this.history.length;

      let agentText = "";
      const self = this;
      async function* tokensCapturingText(): AsyncGenerator<string> {
        for await (const delta of streamSpeculativeTokens(speculative)) {
          if (t.ctrl.signal.aborted) return;
          agentText += delta;
          yield delta;
        }
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
        console.error(`${this.log} speculative TTS error: ${(err as Error).message}`);
        this.history.length = historyLenBefore;
        this.endPlayback();
        return;
      }
      if (!t.ctrl.signal.aborted && agentText) this.awaitPlayback();
      else this.history.length = historyLenBefore;
      return;
    }

    if (speculative) speculative.ctrl.abort();

    const historyLenBefore = this.history.length;
    this.history.push({ role: "user", content: userText });
    const systemContent = [this.config.systemPrompt ?? "", this.languageLock]
      .filter(Boolean)
      .join("\n\n");
    const messages: ChatMsg[] = [
      { role: "system", content: systemContent },
      ...this.history,
    ];

    let agentText = "";
    const self = this;
    async function* tokensCapturingText(): AsyncGenerator<string> {
      for await (const delta of gptStream(messages, {
        model: self.config.model ?? WEBEE_NATIVE_SPEECH_MODEL,
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
    this.abortSpeculativeFlat("utterance_end");
    this.speculativeGraphKey = "";
    this.graphVm?.clearSpeculativeSpeech();
    this.partialNormalized = "";
    this.partialStableSince = 0;
    this.callerSpeaking = false;

    const t = this.beginTurn(endpointAt);

    let userText: string;
    try {
      userText = this.stt ? await this.stt.finalizeUtterance(frames) : "";
      userText = normalizeEnglishLockedSttText(userText, this.sttLanguage);
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
      console.warn(
        `${this.log} turn ${t.id}: empty STT after caller utterance — graph not advanced`,
      );
      this.endPlayback();
      return;
    }

    this.lifecycleRef?.addTurn("user", userText);
    this.transport.onTranscript?.("user", userText);
    console.log(`${this.log} turn ${t.id} user: ${userText.slice(0, 120)}`);

    if (this.graph) {
      const trace = new CallTurnTrace(t.id, t.startedAt, this.log);
      trace.setSttFinal(t.sttAt!);
      trace.mark("graph_user_submit");
      t.trace = trace;
      this.graphVm?.setTurnTrace(trace);
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
    const req = this.ttsVoiceRequest();
    const normalized =
      typeof source === "string" ? normalizeSpeechText(source) : source;
    const audio =
      typeof normalized === "string"
        ? tts.synthesize(normalized, req)
        : tts.synthesizeStream(normalized, req);

    for await (const chunk of audio) {
      // Breaking out here also returns the generator, which closes the provider's
      // upstream socket instead of leaving it streaming audio nobody wants.
      if (t.ctrl.signal.aborted || this.closed) break;
      if (!t.firstAudioAt) {
        t.firstAudioAt = Date.now();
        t.trace?.mark("tts_first_audio");
        t.trace?.flushSummary();
        this.reportLatency(t);
      }
      this.lifecycleRef?.recordAgent(pcm16View(chunk), this.sampleRate);
      this.emitAudio(chunk);
    }
    if (t.firstAudioAt) {
      console.log(`${this.log} turn ${t.id} TTS stream complete`);
      this.ttsStreamEndedAt = Date.now();
    }
    this.warmTts();
  }

  private ttsVoiceRequest() {
    return {
      voiceId: this.voiceId,
      sampleRate: this.sampleRate,
      latency: "low" as const,
      model: this.fishTtsModel,
    };
  }

  /** Pre-open Fish Audio while the caller speaks or while agent audio plays out. */
  private warmTts(): void {
    if (this.closed || !this.tts || this.tts.name !== "fish") return;
    (this.tts as FishAudioTtsProvider).warm(this.ttsVoiceRequest());
  }

  private warmTtsWithText(text: string): void {
    if (this.closed || !this.tts || this.tts.name !== "fish") return;
    (this.tts as FishAudioTtsProvider).warmWithText(text, this.ttsVoiceRequest());
  }

  private emitAudio(chunk: Buffer): void {
    if (!this.speakingFlag && chunk.byteLength > 0) {
      console.log(`${this.log} sending first audio chunk (${chunk.byteLength} bytes)`);
    }
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
    // Agent audio through the speaker leaves the VAD stuck in "speaking" and
    // poisons the streaming STT buffer. Reset both once playback has drained.
    this.vad?.reset();
    this.stt?.clearInputBuffer?.();
    this.callerSpeaking = false;
    this.speechFrames = 0;
    this.partialNormalized = "";
    this.partialStableSince = 0;
  }

  private clearUtteranceCoalesce(): void {
    if (this.utteranceCoalesceTimer) {
      clearTimeout(this.utteranceCoalesceTimer);
      this.utteranceCoalesceTimer = null;
    }
    this.pendingUtteranceFrames = [];
  }

  /**
   * Retell-style utterance coalescing: wait briefly after endpoint so
   * "Twenty Four Street." + "Dubai." become one STT pass and one graph turn.
   */
  private scheduleUtteranceProcessing(): void {
    if (this.utteranceCoalesceTimer) clearTimeout(this.utteranceCoalesceTimer);
    this.utteranceCoalesceTimer = setTimeout(() => {
      this.utteranceCoalesceTimer = null;
      const frames = this.pendingUtteranceFrames;
      this.pendingUtteranceFrames = [];
      if (frames.length === 0) return;
      this.turnPipeline = this.turnPipeline
        .then(() => this.processTurn(frames, Date.now()))
        .catch((err: Error) => {
          console.error(`${this.log} processTurn unhandled: ${err.message}`);
          this.endPlayback();
        });
    }, this.utteranceCoalesceMs);
  }

  // ── Turn bookkeeping ───────────────────────────────────────────────────────

  private beginTurn(startedAt: number): Turn {
    if (this.turn && !this.turn.firstAudioAt) {
      this.cancelTurn("superseded by newer utterance");
    }
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
    this.abortSpeculativeFlat("cancelled");
    this.speculativeGraphKey = "";
    this.graphVm?.clearSpeculativeSpeech();
    this.partialNormalized = "";
    this.partialStableSince = 0;
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
        ` stt→speak=${t.sttAt && t.speakAt ? span(t.sttAt, t.speakAt) : "n/a"}` +
        ` speak→audio=${t.speakAt ? span(t.speakAt, t.firstAudioAt) : "n/a"}` +
        ` stt→audio=${t.sttAt ? span(t.sttAt, t.firstAudioAt) : "n/a"}` +
        ` total=${total !== null ? `${total}ms` : "n/a"}` +
        `${total !== null && total > LATENCY_BUDGET_MS ? " OVER BUDGET" : ""}`,
    );
  }

  /** Act on one VAD verdict. */
  private handleVadEvent(event: VadEvent): void {
    switch (event.type) {
      case "speech_start":
        console.log(
          `${this.log} VAD speech_start rms=${Math.round(event.rms)} agentSpeaking=${this.agentSpeaking}`,
        );
        if (this.utteranceCoalesceTimer) {
          clearTimeout(this.utteranceCoalesceTimer);
          this.utteranceCoalesceTimer = null;
        }
        this.callerSpeaking = true;
        this.speechFrames = 1;
        this.lastSpeechRms = event.rms;
        if (this.agentSpeaking && event.rms < BARGE_IN_MIN_RMS) {
          this.speechFrames = 0;
        }
        this.warmTts();
        break;
      case "speech":
        this.lastSpeechRms = event.rms;
        if (this.agentSpeaking && event.rms < BARGE_IN_MIN_RMS) {
          break;
        }
        this.speechFrames += 1;
        break;
      case "silence":
        this.speechFrames = 0;
        return;
      case "discarded":
        this.callerSpeaking = false;
        this.speechFrames = 0;
        this.abortSpeculativeFlat("discarded");
        this.speculativeGraphKey = "";
        this.graphVm?.clearSpeculativeSpeech();
        this.partialNormalized = "";
        this.partialStableSince = 0;
        console.log(`${this.log} utterance too short (${event.frameCount} frames)`);
        return;
      case "utterance_end":
        console.log(
          `${this.log} VAD utterance_end frames=${event.frames.length} reason=${event.reason}`,
        );
        this.callerSpeaking = false;
        this.speechFrames = 0;
        this.pendingUtteranceFrames.push(...event.frames);
        this.scheduleUtteranceProcessing();
        return;
    }

    // Barge-in: sustained caller speech over the agent's own audio.
    if (this.agentSpeaking && this.speechFrames === this.bargeInSpeechFrames) {
      const inPostTtsGrace =
        this.ttsStreamEndedAt > 0 &&
        Date.now() - this.ttsStreamEndedAt < BARGE_IN_POST_TTS_GRACE_MS;
      if (inPostTtsGrace && this.lastSpeechRms < BARGE_IN_LOUD_RMS) {
        this.speechFrames = 0;
        return;
      }
      this.cancelTurn("caller interrupted");
    }
  }
}
