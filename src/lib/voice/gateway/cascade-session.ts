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
import type { VmLatencyHooks, VariableValue } from "../graph/types";
import { type ChatMsg, gptStream } from "../llm/gpt";
import {
  CASCADE_SAMPLE_RATE,
  createSttProvider,
} from "../stt";
import type { SttProviderName, SttSession } from "../stt";
import { createTtsProvider } from "../tts";
import { normalizeSpeechText, type TtsVoiceRequest } from "../tts/types";
import { FishAudioTtsProvider, resolveFishTtsModel } from "../tts/fish.provider";
import type { TtsProvider, TtsProviderName } from "../tts";
import { createVad, EnergyVad, type Vad, type VadEvent } from "../vad";
import type { NativeCallLifecycle } from "../lifecycle/call-lifecycle";
import {
  buildLanguageLockInstruction,
  normalizeEnglishLockedSttText,
  resolveSttLanguageCode,
} from "../language-lock.shared";
import { resolveCascadeTuning, resolveUtteranceCoalesceMs, BROWSER_VAD_FRAME_MS } from "../cascade-tuning.shared";
import {
  looksLikeCommitReadyPartial,
  looksLikeCompleteShortReply,
  resolveEndpointHangoverMs,
  shouldSkipSttFinal,
} from "../turn-commit.shared";
import {
  lockCallVoiceProfile,
  voiceIdDiffersFromProfile,
  type CallVoiceProfile,
} from "../call-voice-profile.shared";
import { WEBEE_NATIVE_SPEECH_MODEL, resolveWebeeLlmProvider } from "../webee-native.shared";
import { looksLikePlaybackEcho } from "../graph/speech-guard.shared";
import { CallTurnTrace } from "../graph/latency-trace";
import { ResponseLifecycle } from "../response-lifecycle.shared";
import {
  resolveVoiceRuntimeConfig,
  type VoiceAudioState,
  type VoiceRuntimeConfig,
} from "../voice-runtime-config.shared";
import {
  partialMatchesFinal,
  startSpeculativeFlat,
  startSpeculativeSpeech,
  streamSpeculativeTokens,
  type SpeculativeFlatRun,
} from "./speculative-flat";

/** Partial must be unchanged this long before speculative LLM starts. */
const PARTIAL_STABLE_MS = 220;
/** Short yes/no — start speculative work almost immediately. */
const SHORT_REPLY_STABLE_MS = 80;
/** Collect-path answers (phone, postcode, owner) — commit sooner than open speech. */
const COMMIT_READY_STABLE_MS = 100;
/** Minimum partial length to start speculative generation. */
const PARTIAL_MIN_CHARS = 4;
/** Turnaround target from the plan; exceeding it is logged, not enforced. */
const LATENCY_BUDGET_MS = 800;

export type PlaybackTracking = "reported" | "estimated";

export interface AudioOutboundMeta {
  responseId: number;
  turnId?: number;
  nodeId?: string;
}

/** How a session reaches the caller. */
export interface CascadeTransport {
  /** One chunk of agent audio: PCM16 mono at the session's sample rate. */
  sendAudio(pcm: Buffer, meta: AudioOutboundMeta): void;
  /** Barge-in: drop everything already queued downstream, now. */
  clearAudio(): void;
  /** A new agent response is starting — peers may reset playback filters. */
  onResponseStart?(meta: AudioOutboundMeta): void;
  onResponseCancelled?(responseId: number, reason: string): void;
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
  /** Fish reference_id locked for this call (agent-level voice). */
  voiceId: string;
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

  /** Locked at call start — Retell-style agent-level voice, never changes mid-call. */
  private voiceProfile: CallVoiceProfile | null = null;
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
  private readonly runtime: VoiceRuntimeConfig;
  private readonly languageLock: string;
  private readonly sttLanguage?: string;
  private readonly fishTtsModel: string;
  private readonly vadTuning: import("../vad/types").EndpointingOptions;
  private readonly responses = new ResponseLifecycle();

  /** Epoch ms when the current agent utterance began emitting audio. */
  private agentAudioStartedAt = 0;
  /** Set when sustained caller speech triggered barge-in on this utterance. */
  private callerBargeIn = false;
  /** Active agent speech — may outlive the caller turn that triggered it. */
  private activeSpeak: { turn: Turn; responseId: number } | null = null;
  /** Graph is blocked on caller input — accept speech even during agent playback. */
  private awaitingCallerInput = false;
  /** Caller spoke during duplex playback; process after audio drains. */
  private pendingDuplexUserText: string | null = null;
  private partialNormalized = "";
  private partialStableSince = 0;
  private speculativeFlat: SpeculativeFlatRun | null = null;
  /** Avoid restarting graph speculative LLM on every partial tick. */
  private speculativeGraphKey = "";
  private callerSpeaking = false;
  private lastSpeechRms = 0;
  /** Dedupe rapid identical caller utterances (echo / double endpoint). */
  private lastAcceptedUserText = "";
  private lastAcceptedUserAt = 0;
  /** Last spoken agent line — used to ignore speaker-echo STT. */
  private lastAgentText = "";
  /** When the last TTS stream finished sending (playback may still be draining). */
  private ttsStreamEndedAt = 0;
  /** Serialises caller turns so overlapping VAD endpoints do not stack agent replies. */
  private turnPipeline: Promise<void> = Promise.resolve();
  /** Frames accumulated across brief mid-thought pauses before STT runs. */
  private pendingUtteranceFrames: Buffer[] = [];
  private utteranceCoalesceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly utteranceCoalesceMs: number;
  private readonly defaultSilenceFrames: number;

  constructor(transport: CascadeTransport, config: CascadeSessionConfig) {
    this.transport = transport;
    this.config = config;
    this.log = config.logPrefix ?? "[cascade]";
    this.sampleRate = config.sampleRate ?? CASCADE_SAMPLE_RATE;
    this.playbackTracking = config.playback ?? "reported";
    this.languageLock = buildLanguageLockInstruction(config.speechLanguages);
    this.sttLanguage = resolveSttLanguageCode(config.speechLanguages);
    this.fishTtsModel = resolveFishTtsModel();
    this.runtime = resolveVoiceRuntimeConfig({
      silenceDurationMs: config.silenceDurationMs,
      responsiveness: config.responsiveness,
      interruptionSensitivity: config.interruptionSensitivity,
    });
    const tuning = resolveCascadeTuning({
      silenceDurationMs: config.silenceDurationMs,
      responsiveness: config.responsiveness,
      interruptionSensitivity: config.interruptionSensitivity,
    });
    this.vadTuning = tuning.vad;
    this.utteranceCoalesceMs = tuning.utteranceCoalesceMs;
    this.defaultSilenceFrames = tuning.vad.silenceFramesTrigger ?? 10;
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

    // Lock voice before graph load — Retell agent-level voice, never re-resolved mid-call.
    this.voiceProfile = lockCallVoiceProfile({
      sessionVoiceId: this.config.voiceId,
      settings: this.config.settings,
      sampleRate: this.sampleRate,
      model: this.fishTtsModel,
    });
    if (this.tts.name === "fish") {
      (this.tts as FishAudioTtsProvider).bindCall(this.voiceProfile);
    }
    console.log(
      `${this.log} voice locked for call ${this.config.callId}: reference_id=${this.voiceProfile.voiceId}` +
        (typeof this.voiceProfile.speed === "number" ? ` speed=${this.voiceProfile.speed}` : "") +
        (typeof this.voiceProfile.temperature === "number"
          ? ` temp=${this.voiceProfile.temperature.toFixed(2)}`
          : ""),
    );

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
      voiceId: this.voiceProfile.voiceId,
    };

    if (runtime) {
      for (const warning of runtime.warnings) console.warn(`${this.log} flow warning: ${warning}`);
      this.graphVm = runtime.vm;
      this.graphVm.setLatencyHooks(this.buildVmLatencyHooks());
      this.graph = this.buildGraphSession(runtime);
      this.warmTts();
      console.log(
        `${this.log} session ready mode=graph call=${this.config.callId} voice=${this.voiceProfile!.voiceId}` +
          ` stt=${banner.stt} tts=${banner.tts} tts_model=${this.fishTtsModel} vad=${banner.vad}`,
      );
      return banner;
    }

    console.log(
      `${this.log} session ready mode=flat call=${this.config.callId} voice=${this.voiceProfile!.voiceId}` +
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
      const t = this.beginTurn(Date.now());
      const responseId = this.responses.begin(t.id);
      this.transport.onResponseStart?.({ responseId, turnId: t.id });
      await this.streamTts(greeting, t, responseId);
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
    const agentBlockingMic =
      (this.agentSpeaking || this.activeSpeak !== null) &&
      !this.awaitingCallerInput &&
      !this.callerBargeIn;
    const blockSttDuringIntro = this.inPromptOpeningGrace() && !this.callerBargeIn;
    if (!agentBlockingMic && !blockSttDuringIntro) {
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
    if (this.tts?.name === "fish") {
      (this.tts as FishAudioTtsProvider).releaseCall();
    }
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

    if (this.graphVm) {
      const target = this.graphVm.peekSpeechWarmTarget(normalized);
      if (target?.kind === "static") {
        this.warmTtsWithText(target.text);
        this.logSpeculativeStatic(target.text);
      } else {
        this.warmTts();
      }
    } else {
      this.warmTts();
    }

    this.applyAdaptiveHangover(normalized);

    if (normalized === this.partialNormalized) {
      if (!this.partialStableSince) this.partialStableSince = Date.now();
    } else {
      this.partialNormalized = normalized;
      this.partialStableSince = Date.now();
      this.abortSpeculativeFlat("partial changed");
      this.speculativeGraphKey = "";
      this.graphVm?.clearSpeculativeSpeech();
    }

    const shortReply = looksLikeCompleteShortReply(normalized);
    const commitReady = looksLikeCommitReadyPartial(normalized);
    const minChars = shortReply || commitReady ? 2 : PARTIAL_MIN_CHARS;
    const stableMs = shortReply
      ? SHORT_REPLY_STABLE_MS
      : commitReady
        ? COMMIT_READY_STABLE_MS
        : PARTIAL_STABLE_MS;
    if (
      this.callerSpeaking &&
      !this.agentSpeaking &&
      normalized.length >= minChars &&
      Date.now() - this.partialStableSince >= stableMs
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
      provider: resolveWebeeLlmProvider(this.config.settings),
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
      provider: resolveWebeeLlmProvider(this.config.settings),
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
        this.awaitingCallerInput = false;
        const t = this.turn ?? this.activeSpeak?.turn ?? this.beginTurn(Date.now());
        if (!t.speakAt) {
          t.speakAt = Date.now();
          t.trace?.mark("tts_speak_start");
        }
        if (options.nodeId) this.transport.onNodeActive?.(options.nodeId);
        const responseId = this.responses.begin(t.id, options.nodeId);
        t.trace?.mark("response_start");
        this.transport.onResponseStart?.({
          responseId,
          turnId: t.id,
          nodeId: options.nodeId,
        });
        this.activeSpeak = { turn: t, responseId };
        return this.streamTts(source, t, responseId, options.nodeId)
          .catch((err: Error) => {
            if (!t.ctrl.signal.aborted) {
              console.error(`${this.log} streamTts error: ${err.message}`);
            }
          })
          .finally(() => {
            if (this.activeSpeak?.turn === t) this.activeSpeak = null;
            if (!t.ctrl.signal.aborted && !this.closed) this.awaitPlayback();
          });
      },
      onTranscript: (role, text) => {
        // Agent lines only: user lines are recorded at transcription time, so
        // adding them again here would duplicate every caller turn.
        if (role === "agent") {
          this.lastAgentText = text;
          this.lifecycleRef?.addTurn("agent", text);
        }
        this.transport.onTranscript?.(role, text);
      },
      onTransfer: async (destination, transferType) => {
        if (!this.transport.transferCall) return false;
        const ok = await this.transport.transferCall(destination, transferType).catch(() => false);
        if (ok) this.lifecycleRef?.transferred(destination);
        return ok;
      },
      onAwaitUser: () => {
        this.awaitingCallerInput = true;
        const nodeId = this.graphVm?.nodeId;
        if (nodeId) this.transport.onNodeActive?.(nodeId);
        console.log(`${this.log} awaiting caller input (duplex — mic open during playback)`);
        this.responses.markListening();
        this.vad?.reset();
        this.stt?.clearInputBuffer?.();
      },
      onNodeActive: (nodeId) => this.transport.onNodeActive?.(nodeId),
      onAwaitDigit: () => {
        this.awaitingCallerInput = true;
        this.responses.markListening();
        this.vad?.reset();
        this.stt?.clearInputBuffer?.();
      },
      onEnd: (reason) => {
        console.log(
          `${this.log} graph ended reason=${reason} node=${this.graphVm?.nodeId ?? "unknown"}`,
        );
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
        for await (const delta of streamSpeculativeTokens(speculative!)) {
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
        await this.streamTts(tokensCapturingText(), t, this.ensureResponse(t));
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
        provider: resolveWebeeLlmProvider(self.config.settings),
        signal: t.ctrl.signal,
      })) {
        agentText += delta;
        yield delta;
      }
      // Publish the transcript as soon as the model finishes rather than after the
      // audio drains, so on-screen text is not held back by playback.
      agentText = agentText.trim();
      if (agentText) {
        self.lastAgentText = agentText;
        self.history.push({ role: "assistant", content: agentText });
        self.lifecycleRef?.addTurn("agent", agentText);
        self.transport.onTranscript?.("agent", agentText);
      }
    }

    try {
      await this.streamTts(tokensCapturingText(), t, this.ensureResponse(t));
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
    // Retell-like: never drop the utterance before STT. Laptop-speaker echo is
    // empty/hallucinated text; a real "yes" must be allowed to interrupt.
    this.abortSpeculativeFlat("utterance_end");
    this.speculativeGraphKey = "";
    // Keep graph speculative speech — prepareSpeech accepts it if the final matches.
    const partialFallback = this.partialNormalized.trim();
    this.partialNormalized = "";
    this.partialStableSince = 0;
    this.callerSpeaking = false;

    const skipSttFinal = shouldSkipSttFinal(
      partialFallback,
      !!this.graphVm?.peekSpeechWarmTarget(partialFallback),
    );

    let userText: string;
    try {
      if (skipSttFinal) {
        userText = normalizeEnglishLockedSttText(partialFallback, this.sttLanguage);
        void this.stt?.finalizeUtterance(frames).catch(() => {});
        console.log(
          `${this.log} skipping STT final — commit-ready partial "${userText.slice(0, 40)}"`,
        );
      } else {
        userText = this.stt ? await this.stt.finalizeUtterance(frames) : "";
        userText = normalizeEnglishLockedSttText(userText, this.sttLanguage);
      }
    } catch (err) {
      const message = (err as Error).message;
      console.error(`${this.log} STT error: ${message}`);
      this.transport.onError?.(`STT error: ${message}`);
      if (!this.agentSpeaking && !this.activeSpeak) this.endPlayback();
      return;
    }

    if (!userText.trim()) {
      if (partialFallback.length >= PARTIAL_MIN_CHARS) {
        userText = partialFallback;
      } else if (this.agentSpeaking || this.activeSpeak !== null) {
        console.log(`${this.log} ignoring empty STT during agent playback (likely echo)`);
        this.callerBargeIn = false;
        return;
      } else {
        console.warn(`${this.log} empty STT after caller utterance — graph not advanced`);
        this.endPlayback();
        return;
      }
    }

    const agentStillPlaying = this.agentSpeaking || this.activeSpeak !== null;
    const recentlyPlayed =
      this.ttsStreamEndedAt > 0 &&
      Date.now() - this.ttsStreamEndedAt < this.runtime.interruption.postTtsGraceMs;
    if (
      (agentStillPlaying || recentlyPlayed) &&
      looksLikePlaybackEcho(userText, this.lastAgentText)
    ) {
      console.log(
        `${this.log} ignoring STT that matches agent playback (echo): "${userText.slice(0, 60)}"`,
      );
      this.callerBargeIn = false;
      return;
    }
    // Echo of the opening words often transcribes as "yes"/"ok" — ignore short
    // STT for the first ~1.5s of every agent line.
    if (agentStillPlaying && this.inPromptOpeningGrace() && userText.trim().length < 12) {
      console.log(`${this.log} ignoring short STT during agent opening grace: "${userText}"`);
      this.callerBargeIn = false;
      return;
    }
    if (agentStillPlaying && userText.trim().length >= 2) {
      if (this.awaitingCallerInput) {
        this.pendingDuplexUserText = userText;
        console.log(
          `${this.log} duplex — holding caller reply until agent playback finishes: "${userText.slice(0, 60)}"`,
        );
        return;
      }
      console.log(`${this.log} caller answered during prompt — stopping agent audio`);
      this.callerBargeIn = true;
      this.cancelTurn("caller answered during prompt");
    }
    this.callerBargeIn = false;
    this.awaitingCallerInput = false;

    const t = this.beginTurn(endpointAt);
    t.sttAt = Date.now();
    if (this.graph) {
      const trace = new CallTurnTrace(t.id, t.startedAt, this.log);
      t.trace = trace;
      this.graphVm?.setTurnTrace(trace);
      trace.setSttFinal(t.sttAt);
      trace.mark("stt_final");
      trace.mark("graph_user_submit");
    }

    if (t.ctrl.signal.aborted) return;

    this.lifecycleRef?.addTurn("user", userText);
    this.transport.onTranscript?.("user", userText);
    console.log(`${this.log} turn ${t.id} user: ${userText.slice(0, 120)}`);

    const normalizedUser = userText.trim().toLowerCase();
    if (
      normalizedUser &&
      normalizedUser === this.lastAcceptedUserText &&
      Date.now() - this.lastAcceptedUserAt < 2500
    ) {
      console.log(`${this.log} turn ${t.id}: duplicate user utterance ignored`);
      return;
    }
    this.lastAcceptedUserText = normalizedUser;
    this.lastAcceptedUserAt = Date.now();

    if (this.graph) {
      await this.graph.submitUserText(userText);
      return;
    }
    await this.runFlatTurn(userText, t);
  }

  // ── Audio out ──────────────────────────────────────────────────────────────

  private ensureResponse(t: Turn, nodeId?: string): number {
    if (this.responses.activeResponseId && this.responses.snapshot.turnId === t.id) {
      return this.responses.activeResponseId;
    }
    const responseId = this.responses.begin(t.id, nodeId);
    t.trace?.mark("response_start");
    this.transport.onResponseStart?.({ responseId, turnId: t.id, nodeId });
    return responseId;
  }

  /**
   * Stream synthesised speech to the transport.
   *
   * Int16 alignment across chunk boundaries is handled by the TTS provider.
   */
  private async streamTts(
    source: string | AsyncIterable<string>,
    t: Turn,
    responseId: number,
    nodeId?: string,
  ): Promise<void> {
    const tts = this.tts;
    if (!tts) throw new Error("TTS provider not initialised");
    const req = this.ttsVoiceRequest();
    if (voiceIdDiffersFromProfile(this.voiceProfile!, req.voiceId)) {
      console.warn(
        `${this.log} turn ${t.id} voice profile drift blocked locked=${this.voiceProfile!.voiceId} attempted=${req.voiceId}`,
      );
    }
    console.log(
      `${this.log} tts voice call=${this.config.callId} turn=${t.id} response=${responseId}` +
        ` node=${nodeId ?? "-"} reference_id=${req.voiceId}` +
        (typeof req.temperature === "number" ? ` temp=${req.temperature.toFixed(2)}` : "") +
        (typeof req.speed === "number" ? ` speed=${req.speed}` : ""),
    );
    const normalized =
      typeof source === "string" ? normalizeSpeechText(source) : source;
    const audio =
      typeof normalized === "string"
        ? tts.synthesize(normalized, req)
        : tts.synthesizeStream(normalized, req);

    for await (const chunk of audio) {
      if (!this.responses.isActive(responseId) || t.ctrl.signal.aborted || this.closed) break;
      if (!t.firstAudioAt) {
        t.firstAudioAt = Date.now();
        t.trace?.mark("tts_first_audio");
        t.trace?.flushSummary();
        this.reportLatency(t);
        this.responses.markSpeaking();
      }
      this.lifecycleRef?.recordAgent(pcm16View(chunk), this.sampleRate);
      this.emitAudio(chunk, responseId, t.id);
    }
    if (!t.firstAudioAt && !t.ctrl.signal.aborted && this.responses.isActive(responseId)) {
      console.warn(
        `${this.log} turn ${t.id} response ${responseId} TTS produced no audio (check Fish reference_id)`,
      );
    }
    if (t.firstAudioAt && this.responses.isActive(responseId)) {
      console.log(
        `${this.log} turn ${t.id} response ${responseId} TTS stream complete queue_state=${this.audioStateLabel()}`,
      );
      this.ttsStreamEndedAt = Date.now();
    }
    this.warmTts();
  }

  private ttsVoiceRequest(): TtsVoiceRequest {
    if (!this.voiceProfile) {
      throw new Error("Voice profile not locked — prepare() must run first");
    }
    return { ...this.voiceProfile };
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

  private emitAudio(chunk: Buffer, responseId: number, turnId: number): void {
    if (!this.responses.isActive(responseId)) return;
    if (!this.speakingFlag && chunk.byteLength > 0) {
      console.log(
        `${this.log} sending first audio chunk response=${responseId} turn=${turnId} (${chunk.byteLength} bytes)`,
      );
      this.agentAudioStartedAt = Date.now();
    }
    this.transport.sendAudio(chunk, { responseId, turnId });
    if (this.playbackTracking === "reported") {
      this.speakingFlag = true;
      this.responses.markSpeaking();
      return;
    }
    const durationMs = (chunk.byteLength / 2 / this.sampleRate) * 1000;
    this.playheadAt = Math.max(this.playheadAt, Date.now()) + durationMs;
    this.responses.markSpeaking();
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
    this.playbackTimer = setTimeout(
      () => this.endPlayback(),
      this.runtime.playback.playbackTimeoutMs,
    );
  }

  private endPlayback(): void {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
    this.speakingFlag = false;
    this.playheadAt = 0;
    this.agentAudioStartedAt = 0;
    this.ttsStreamEndedAt = 0;
    this.responses.markListening();
    this.vad?.reset();
    this.stt?.clearInputBuffer?.();
    this.callerSpeaking = false;
    this.speechFrames = 0;
    this.partialNormalized = "";
    this.partialStableSince = 0;

    const pending = this.pendingDuplexUserText;
    if (pending) {
      this.pendingDuplexUserText = null;
      void this.submitBufferedUserText(pending);
    }
  }

  /** Process a caller reply held during duplex playback (no STT pass). */
  private async submitBufferedUserText(userText: string): Promise<void> {
    if (this.closed || !userText.trim()) return;
    console.log(`${this.log} processing buffered duplex reply: "${userText.slice(0, 80)}"`);

    const t = this.beginTurn(Date.now());
    t.sttAt = Date.now();
    if (this.graph) {
      const trace = new CallTurnTrace(t.id, t.startedAt, this.log);
      t.trace = trace;
      this.graphVm?.setTurnTrace(trace);
      trace.setSttFinal(t.sttAt);
      trace.mark("stt_final");
      trace.mark("graph_user_submit");
    }

    if (t.ctrl.signal.aborted) return;

    this.lifecycleRef?.addTurn("user", userText);
    this.transport.onTranscript?.("user", userText);
    console.log(`${this.log} turn ${t.id} user (buffered): ${userText.slice(0, 120)}`);

    const normalizedUser = userText.trim().toLowerCase();
    if (
      normalizedUser &&
      normalizedUser === this.lastAcceptedUserText &&
      Date.now() - this.lastAcceptedUserAt < 2500
    ) {
      console.log(`${this.log} turn ${t.id}: duplicate buffered utterance ignored`);
      return;
    }
    this.lastAcceptedUserText = normalizedUser;
    this.lastAcceptedUserAt = Date.now();
    this.awaitingCallerInput = false;

    if (this.graph) {
      await this.graph.submitUserText(userText);
      return;
    }
    await this.runFlatTurn(userText, t);
  }

  private applyAdaptiveHangover(partial: string): void {
    const hangoverMs = resolveEndpointHangoverMs(
      partial,
      this.runtime.endpointing.silenceDurationMs,
    );
    const frames = Math.max(3, Math.round(hangoverMs / BROWSER_VAD_FRAME_MS));
    this.vad?.setSilenceFramesTrigger(frames);
  }

  private restoreHangover(): void {
    this.vad?.setSilenceFramesTrigger(this.defaultSilenceFrames);
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
    const delay = resolveUtteranceCoalesceMs(this.partialNormalized, this.utteranceCoalesceMs);
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
    }, delay);
  }

  // ── Turn bookkeeping ───────────────────────────────────────────────────────

  private beginTurn(startedAt: number): Turn {
    // Only supersede a caller turn still being transcribed — never cancel in-flight
    // agent speech (that was killing responses before firstAudioAt).
    if (this.turn && !this.turn.sttAt) {
      console.log(`${this.log} superseding caller turn ${this.turn.id} (STT not finished)`);
      this.turn.ctrl.abort();
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
    const speak = this.activeSpeak;
    const t = speak?.turn ?? this.turn;
    if (!t) return;
    const turnId = t.id;
    const responseId = this.responses.cancel(reason);
    console.log(
      `${this.log} turn ${turnId} response ${responseId} cancelled (${reason}) state=${this.audioStateLabel()}`,
    );
    t.trace?.mark("response_cancelled");
    t.trace?.mark("interruption_detected");
    t.trace?.mark("audio_stop");
    t.ctrl.abort();
    if (this.turn === t) this.turn = null;
    if (this.activeSpeak?.turn === t) this.activeSpeak = null;
    this.abortSpeculativeFlat("cancelled");
    this.speculativeGraphKey = "";
    this.graphVm?.clearSpeculativeSpeech();
    this.partialNormalized = "";
    this.partialStableSince = 0;
    this.restoreHangover();
    if (responseId) this.transport.onResponseCancelled?.(responseId, reason);
    this.transport.clearAudio();
    this.lifecycleRef?.agentStoppedSpeaking();
    this.responses.markInterrupted(reason);
    this.endPlayback();
  }

  private audioStateLabel(): VoiceAudioState {
    return this.responses.snapshot.state;
  }

  /** Ignore echo-driven STT/VAD briefly after agent audio starts. */
  private inPromptOpeningGrace(): boolean {
    return (
      this.agentAudioStartedAt > 0 &&
      Date.now() - this.agentAudioStartedAt < this.runtime.interruption.openingGraceMs
    );
  }

  private shouldAbortTurn(rms: number): boolean {
    const cfg = this.runtime.interruption;
    if (!cfg.interruptibleResponse || !this.bargeInActive) return false;
    const inOpeningGrace =
      this.agentAudioStartedAt > 0 &&
      Date.now() - this.agentAudioStartedAt < cfg.openingGraceMs;
    const inPostTtsGrace =
      this.ttsStreamEndedAt > 0 && Date.now() - this.ttsStreamEndedAt < cfg.postTtsGraceMs;
    if ((inOpeningGrace || inPostTtsGrace) && rms < cfg.bargeInLoudRms) return false;
    return rms >= cfg.bargeInMinRms;
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

  private get bargeInActive(): boolean {
    return this.agentSpeaking || this.activeSpeak !== null;
  }

  /** Act on one VAD verdict. */
  private handleVadEvent(event: VadEvent): void {
    switch (event.type) {
      case "speech_start":
        console.log(
          `${this.log} VAD speech_start rms=${Math.round(event.rms)} agentSpeaking=${this.bargeInActive} state=${this.audioStateLabel()}`,
        );
        if (this.utteranceCoalesceTimer) {
          clearTimeout(this.utteranceCoalesceTimer);
          this.utteranceCoalesceTimer = null;
        }
        this.callerSpeaking = true;
        this.speechFrames = 1;
        this.lastSpeechRms = event.rms;
        this.turn?.trace?.setUserSpeechStart(Date.now());
        this.turn?.trace?.mark("turn_detected");
        if (this.bargeInActive && event.rms < this.runtime.interruption.bargeInMinRms) {
          this.speechFrames = 0;
        }
        this.warmTts();
        break;
      case "speech":
        this.lastSpeechRms = event.rms;
        if (this.bargeInActive && event.rms < this.runtime.interruption.bargeInMinRms) {
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
        this.restoreHangover();
        console.log(`${this.log} utterance too short (${event.frameCount} frames)`);
        return;
      case "utterance_end":
        console.log(
          `${this.log} VAD utterance_end frames=${event.frames.length} reason=${event.reason}`,
        );
        this.callerSpeaking = false;
        this.speechFrames = 0;
        this.pendingUtteranceFrames.push(...event.frames);
        this.restoreHangover();
        this.scheduleUtteranceProcessing();
        return;
    }

    const bargeFrames = this.runtime.interruption.bargeInSpeechFrames;
    if (
      this.bargeInActive &&
      this.speechFrames === bargeFrames &&
      this.shouldAbortTurn(this.lastSpeechRms)
    ) {
      // Do not cancel TTS on VAD alone — speaker echo looks like loud speech.
      // processTurn interrupts only after STT returns real words.
      console.log(
        `${this.log} barge-in candidate rms=${Math.round(this.lastSpeechRms)} frames=${bargeFrames} — waiting for STT`,
      );
    }
  }
}
