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
 *   - "reported": the peer tells us when it finished playing (browser, Twilio
 *     `mark` events). Estimated duration is only a timeout fallback.
 *   - "estimated": nobody reports anything (FreJun), so the end of playback is
 *     inferred from how much audio has been handed to the carrier.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { pcm16View } from "./audio";
import { GraphSession } from "./graph-session";
import { buildGraphRuntime, type GraphRuntime } from "./graph-agent";
import { transcriptCaughtUpToAudio } from "../graph/spoken-transcript.shared";
import type { ConversationVm } from "../graph/vm";
import type { TransferDirective, VmLatencyHooks, VariableValue } from "../graph/types";
import { type ChatMsg, gptStream } from "../llm/gpt";
import { applyKeywordBoost } from "../stt/keyword-boost.shared";
import {
  CASCADE_SAMPLE_RATE,
  createSttProvider,
  lookupWorkspaceVoiceApiKey,
  parseSttProviderName,
  resolveWebeeSttPreference,
  type SttProviderKeys,
  type SttProviderName,
  type SttSession,
} from "../stt";
import { createTtsProvider, parseTtsProviderName } from "../tts";
import { normalizeSpeechText, type TtsVoiceRequest } from "../tts/types";
import { FishAudioTtsProvider, resolveFishTtsModel } from "../tts/fish.provider";
import type { TtsProvider, TtsProviderName } from "../tts";
import {
  BackchannelScheduler,
  DEFAULT_BACKCHANNEL_WORDS,
  prepareBackchannelClip,
} from "../backchannel.shared";
import { createVad, EnergyVad, type Vad, type VadEvent } from "../vad";
import type { NativeCallLifecycle } from "../lifecycle/call-lifecycle";
import {
  buildLanguageLockInstruction,
  isEnglishOnlyAgent,
  normalizeEnglishLockedSttText,
  resolveSttLanguageCode,
} from "../language-lock.shared";
import { resolveCascadeTuning, resolveUtteranceCoalesceMs, BROWSER_VAD_FRAME_MS } from "../cascade-tuning.shared";
import {
  looksLikeCommitReadyPartial,
  looksLikeCompleteShortReply,
  resolveEndpointHangoverMs,
  isIdleCallerTurn,
  shouldSkipSttFinal,
  INCOMPLETE_PARTIAL_HANGOVER_MS,
} from "../turn-commit.shared";
import {
  lockCallVoiceProfile,
  voiceIdDiffersFromProfile,
  type CallVoiceProfile,
} from "../call-voice-profile.shared";
import { WEBEE_NATIVE_SPEECH_MODEL, resolveWebeeLlmProvider } from "../webee-native.shared";
import { isAckOrRepeat, isRepeatOf, isStaleReply } from "../stale-reply.shared";
import { looksLikePlaybackEcho } from "../graph/speech-guard.shared";
import { resolveEndCallAfterSilenceMs, resolveMaxCallDurationMs } from "../lifecycle/call-safety-limits.shared";
import { DEFAULT_REMINDER_TEXT, resolveReminderSettings } from "../lifecycle/reminder-settings.shared";
import { shouldAcceptDtmf } from "../lifecycle/dtmf-policy.shared";
import { resolveDynamicSilenceTimeoutMs } from "../lifecycle/dynamic-responsiveness.shared";
import { normalizeForSpeech } from "../tts/speech-normalization.shared";
import { normaliseSpokenIdentifiers } from "../graph/spoken-identifiers.shared";
import { interpolateStaticSpeech } from "../graph/flow";
import { resolveDenoiseMode, StreamingDenoiser } from "../audio/denoise";
import {
  detectVoicemailGreeting,
  resolveVoicemailPolicy,
  type VoicemailPolicy,
} from "../voicemail.shared";
import {
  applyPronunciationDictionary,
  applyPronunciationDictionaryStream,
  type PronunciationEntry,
} from "../tts/pronunciation-dictionary.shared";
import { resolveDynamicSpeed } from "../tts/dynamic-voice-speed.shared";
import { resolveDeepgramModel } from "../stt/stt-tuning.shared";
import { CallTurnTrace, type LatencyMark } from "../graph/latency-trace";
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
/** ~600ms of mic audio at the browser's 50ms frames — enough to cover VAD confirmation lag plus onset. */
const WITHHELD_STT_FRAMES_MAX = 12;
/**
 * How many times one utterance may fan out speculative generation before the endpoint.
 *
 * Each round costs up to `MAX_SPECULATIVE_FANOUT` mostly-discarded LLM calls, so this bounds the
 * token cost of a caller who keeps pausing. Two is enough to cover the common "pause, then finish
 * the sentence" shape without letting a hesitant caller multiply the bill.
 */
const MAX_SPECULATIVE_FANOUT_ROUNDS = 2;
/**
 * How many times one utterance may start edge routing before the endpoint.
 *
 * Higher than the fanout's budget because it buys more and costs less: one small classifier call,
 * against up to three full-model generations per fanout round. It needs the extra headroom because
 * a changing partial discards the previous route, and the only route that can actually be adopted
 * is the one started from the partial that matches the final transcript — usually the last.
 */
const MAX_SPECULATIVE_ROUTE_ROUNDS = 4;
/** Turnaround target from the plan; exceeding it is logged, not enforced. */
const LATENCY_BUDGET_MS = 800;
/** Nudge this many times before giving up on real speech that STT keeps returning empty for. */
const MAX_STT_MISS_NUDGES = 2;
const STT_MISS_NUDGE_TEXT = "Sorry, I didn't catch that — could you say that again?";

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
  onPartialTranscript?(text: string, role?: "user" | "agent"): void;
  /** Agent finished an utterance; the caller is expected to speak next. */
  onResponseDone?(): void;
  onEnd?(reason: string): void;
  onError?(message: string): void;
  /** Bridge the call. Resolve true once connected, false if it could not be. */
  transferCall?(options: TransferDirective): Promise<boolean>;
  /** Graph VM entered a node — used to highlight the active step in the Builder. */
  onNodeActive?(nodeId: string): void;
  onToolCall?(toolId: string, result: string, ok: boolean): void;
  /**
   * Speech-to-first-audio latency for the turn that just started speaking — the same
   * end-to-end number persisted to `call_turns.speech_to_first_audio_ms`, surfaced live so a
   * test-call UI can show a running latency badge the way Retell's own test-call widget does,
   * without needing to wait for the call to end and the debugger's Latency tab to poll for it.
   */
  onTurnLatency?(ms: number): void;
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
  /** Workspace that owns the agent — used to resolve Voice Engine API keys. */
  workspaceId?: string | null;
  supabase?: SupabaseClient | null;
  /** Pre-exported flow, for builder test calls on unsaved agents. */
  flow?: unknown;
  settings?: Record<string, unknown> | null;
  variables?: Record<string, VariableValue>;
  /** Builder web test: force who speaks first, ignoring inbound start_speaker. */
  startSpeaker?: "agent" | "user";
  /**
   * Marks this as a test call, so its turns are recorded but excluded from
   * production latency percentiles. Set by the builder/test-call surfaces.
   */
  isTestCall?: boolean;
  /** BCP-47 speech languages from builder settings — drives STT + language lock. */
  speechLanguages?: string[];
  /** Builder tuning mapped into VAD / barge-in. */
  silenceDurationMs?: number;
  responsiveness?: number;
  interruptionSensitivity?: number;
  /** Vocabulary bias from builder boostedKeywords (Fish prompt / Deepgram keywords). */
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
  private createClipTts: (() => import("../tts/types").TtsProvider) | null = null;
  /** Builder backchannel settings → when to murmur "mm-hm" while the caller talks. */
  private readonly backchannel: BackchannelScheduler | null;
  private backchannelClips: Buffer[] = [];
  private backchannelPrep: Promise<void> | null = null;
  /** Playback-done signals before this time come from a backchannel clip, not an agent line. */
  private backchannelWindowUntil = 0;
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
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Hard cap on total call length — `settings.maxCallDurationMs`, armed once at start. */
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Live answering-machine handling. Null unless the agent configured it, and only ever armed on
   * a phone call — a browser test has no machine to hear.
   */
  private voicemail: {
    policy: VoicemailPolicy;
    state: "listening" | "greeting" | "done";
    /** What the other end has said so far (the greeting arrives in several finals). */
    heard: string;
    detectedAt: number;
    timer: ReturnType<typeof setInterval> | null;
  } | null = null;
  private voicemailWindowStartAt = 0;
  /** Cleans the caller's audio before speech detection and transcription (builder `denoisingMode`). */
  private denoiser: StreamingDenoiser | null = null;
  /** Last time the other end made a sound the VAD called speech. */
  private lastCallerVoiceAt = 0;
  /** Whole-call dead-air watchdog — `settings.endCallAfterSilenceMs`, reset on every caller turn. */
  private deadAirTimer: ReturnType<typeof setTimeout> | null = null;
  /** `settings.reminderTriggerMs` / `reminderMaxCount` — proactive "are you still there?" nudges. */
  private reminderTimer: ReturnType<typeof setTimeout> | null = null;
  private reminderCount = 0;
  /** Consecutive turns where VAD caught real speech but STT came back with nothing at all. */
  private sttMissCount = 0;
  private readonly runtime: VoiceRuntimeConfig;
  private readonly languageLock: string;
  private readonly sttLanguage?: string;
  /** English word-pattern turn-taking rules apply only to English-only agents. */
  private readonly englishTurnRules: boolean;
  /** UK postcode shapes are only recognised for agents that work in the UK. */
  private readonly ukPostcodes: boolean;
  private sttName = "fish";
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
  /** Variables present before the conversation started — the extraction baseline. */
  private seededVariables: Record<string, string> = {};
  /** Resolved once, so persistTurnLatency needs no await mid-turn. */
  private workspaceIdCache: string | null | undefined;
  /**
   * Facts about the turn that is *about* to start.
   *
   * The caller starts speaking, and partials drive the adaptive hangover, both
   * before `beginTurn` creates the Turn and its trace. Writing them straight to
   * `this.turn.trace` therefore landed them on the previous turn (or nowhere):
   * speech_to_first_audio_ms came out null or nonsensical, and hangover_ms was
   * null on every row. Buffer here, seed the trace the moment it exists.
   */
  private pendingUserSpeechStartAt: number | null = null;
  private pendingEndpointing: { hangoverMs: number; heldForIncomplete: boolean } | null = null;
  /**
   * Marks for events that happen while the caller is still talking, held until the turn they
   * belong to exists.
   *
   * `beginTurn` only runs once STT has finalised, so anything recorded during the utterance was
   * being written to `this.turn?.trace` while that was either null or — worse — still the previous
   * turn. Every pre-endpoint timing was therefore either dropped or attributed to the wrong turn:
   * across 400 recorded turns `partial_commit` was false on all of them and
   * `speech→stt_partial` logged "n/a" every time, which read as "speculation never runs" when it
   * actually meant "we never measured it". Same buffer-and-replay shape as `pendingEndpointing`.
   */
  private pendingMarks: Array<{ name: LatencyMark; at: number }> = [];
  /**
   * Fanout rounds spent on the utterance in progress.
   *
   * A changed partial aborts the in-flight speculative runs, so a caller who trails off and
   * resumes ("um… so… my name is…") would otherwise restart a full fanout at every pause. The
   * 220ms stability gate already keeps that to a handful, and this caps the worst case outright.
   */
  /** Most recent mic frames kept back from STT by the echo gate, replayed if the caller turns out to be speaking. */
  private withheldSttFrames: Buffer[] = [];
  private fanoutRoundsThisUtterance = 0;
  /** Speculative routing starts spent on the utterance in progress — see `MAX_SPECULATIVE_ROUTE_ROUNDS`. */
  private routeRoundsThisUtterance = 0;
  /** Pending re-check of "has the partial stopped changing" — see `onCallerPartial`. */
  private partialStabilityTimer: ReturnType<typeof setTimeout> | null = null;
  /** At most one LLM-assisted turn-completion check per utterance — see `applyAdaptiveHangover`. */
  private turnCheckFired = false;
  /** Bumped on every new utterance so a late-arriving check from an earlier one is a no-op. */
  private turnCheckGeneration = 0;
  private partialNormalized = "";
  private partialStableSince = 0;
  private speculativeFlat: SpeculativeFlatRun | null = null;
  /** Avoid restarting graph speculative LLM on every partial tick. */
  private speculativeGraphKey = "";
  /** Dest identity for keeping speculative work across growing partials. */
  private speculativeGraphDestKey = "";
  private callerSpeaking = false;
  private lastSpeechRms = 0;
  /** Dedupe rapid identical caller utterances (echo / double endpoint). */
  private lastAcceptedUserText = "";
  private lastAcceptedUserAt = 0;
  /** When the caller started the utterance now being collected (first burst, survives coalescing). */
  private utteranceSpeechStartAt: number | null = null;
  /** When the agent began / was first heard replying to the last accepted caller turn. */
  private replySpeakAt: number | null = null;
  private replyAudioStartAt: number | null = null;
  /** Rolling agent-line-end -> caller-response gaps, for `enableDynamicResponsiveness`. */
  private recentResponseGapsMs: number[] = [];
  /** The effective silence-timeout for the current wait, cached so a false-start (VAD `discarded`) can re-arm it. */
  private currentSilenceTimeoutMs: number | undefined;
  /** Set when `onAwaitUser` fires while the agent's own line is still draining — armed for real once `endPlayback` confirms playback actually finished. */
  private pendingWaitArm: { silenceTimeoutMs: number | undefined } | null = null;
  /** Last spoken agent line — used to ignore speaker-echo STT. */
  private lastAgentText = "";
  /** Full agent line waiting to be revealed as audio plays. */
  private pendingAgentTranscript: string | null = null;
  private lastShownAgentTranscript = "";
  private agentTranscriptTimer: ReturnType<typeof setTimeout> | null = null;
  private agentTranscriptStartedAt = 0;
  /** PCM16 bytes sent for the current agent line — transcript follows this, not wall clock. */
  private agentPcmBytesThisUtterance = 0;
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
    this.englishTurnRules = isEnglishOnlyAgent(config.speechLanguages);
    {
      const st = (config.settings ?? {}) as Record<string, unknown>;
      const locale = String(
        (Array.isArray(st.speechLanguages) ? st.speechLanguages[0] : undefined) ?? st.language ?? "",
      );
      this.ukPostcodes =
        /^en[-_]gb$/i.test(locale.trim()) ||
        String(st.phoneCountryCode ?? "").replace(/\D/g, "") === "44" ||
        /^Europe\/London$/i.test(String(st.timezone ?? ""));
      // Opt-in at the deployment: every builder agent has `denoisingMode` saved as the strongest
      // option by default, so honouring it unconditionally would change the audio of every
      // existing native agent the moment this ships. Set WEBEE_DENOISE=on to apply it.
      const denoise = process.env.WEBEE_DENOISE === "on" ? resolveDenoiseMode(st.denoisingMode) : "off";
      if (denoise !== "off") {
        this.denoiser = new StreamingDenoiser({ mode: denoise, sampleRate: this.sampleRate });
      }
    }
    this.backchannel =
      config.settings?.enableBackchannel === true
        ? new BackchannelScheduler({ frequency: Number(config.settings?.backchannelFrequency ?? 0.3) })
        : null;
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

  private async resolveCallWorkspaceId(): Promise<string | null> {
    if (this.config.workspaceId) return this.config.workspaceId;
    if (this.workspaceIdCache !== undefined) return this.workspaceIdCache;
    if (!this.config.supabase || !this.config.agentId) return null;
    const { data } = await this.config.supabase
      .from("agents")
      .select("workspace_id")
      .eq("id", this.config.agentId)
      .maybeSingle();
    // Cached so reportLatency can persist without an await mid-turn.
    this.workspaceIdCache = (data?.workspace_id as string | null) ?? null;
    return this.workspaceIdCache;
  }

  private async resolveSttKeys(): Promise<SttProviderKeys> {
    const workspaceId = await this.resolveCallWorkspaceId();
    const [deepgramWorkspace, assemblyaiWorkspace, cartesiaWorkspace] = await Promise.all([
      lookupWorkspaceVoiceApiKey(this.config.supabase, workspaceId, "deepgram"),
      lookupWorkspaceVoiceApiKey(this.config.supabase, workspaceId, "assemblyai"),
      lookupWorkspaceVoiceApiKey(this.config.supabase, workspaceId, "cartesia"),
    ]);
    return {
      fishApiKey: process.env.FISH_API_KEY,
      deepgramApiKey: deepgramWorkspace || process.env.DEEPGRAM_API_KEY,
      assemblyaiApiKey: assemblyaiWorkspace || process.env.ASSEMBLYAI_API_KEY,
      cartesiaApiKey: cartesiaWorkspace || process.env.CARTESIA_API_KEY,
    };
  }

  /**
   * Bring up STT/TTS/VAD and load the graph, without speaking yet.
   * Browser relay sends `relay.connected` after this so the mic can open
   * while the greeting TTS is still synthesizing.
   */
  async prepare(): Promise<CascadeSessionBanner> {
    // Honour the agent's TTS choice; "fish" remains the default when nothing is set.
    const ttsChoice =
      parseTtsProviderName(this.config.ttsProvider) ??
      parseTtsProviderName((this.config.settings as Record<string, unknown> | null)?.webeeTtsProvider) ??
      "fish";
    const ttsOptions = {
      fishApiKey: process.env.FISH_API_KEY,
      fishTtsModel: this.fishTtsModel,
      openaiApiKey: process.env.OPENAI_API_KEY,
      openaiTtsModel: (this.config.settings as Record<string, unknown> | null)?.webeeTtsModel as
        | string
        | undefined,
      openaiTtsInstructions: (this.config.settings as Record<string, unknown> | null)
        ?.webeeTtsInstructions as string | undefined,
      cartesiaApiKey: process.env.CARTESIA_API_KEY,
      cartesiaTtsModel: (this.config.settings as Record<string, unknown> | null)?.webeeTtsModel as
        | string
        | undefined,
    };
    this.tts = createTtsProvider(ttsChoice, ttsOptions);
    // A second, unbound provider for one-off clips (backchannels), so rendering them never queues
    // behind — or delays — the call's own lines.
    this.createClipTts = () => createTtsProvider(ttsChoice, ttsOptions);

    // Lock voice before graph load — Retell agent-level voice, never re-resolved mid-call.
    this.voiceProfile = lockCallVoiceProfile({
      sessionVoiceId: this.config.voiceId,
      settings: this.config.settings,
      sampleRate: this.sampleRate,
      model:
        ttsChoice === "openai" || ttsChoice === "cartesia"
          ? ((this.config.settings as Record<string, unknown> | null)?.webeeTtsModel as
              | string
              | undefined)
          : this.fishTtsModel,
      ttsProvider: ttsChoice,
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

    const sttKeys = await this.resolveSttKeys();
    const sttName =
      this.config.sttProvider ??
      resolveWebeeSttPreference(this.config.settings, sttKeys) ??
      parseSttProviderName(this.config.settings?.webeeSttProvider) ??
      "fish";
    const sttProvider = createSttProvider(
      sttName,
      sttKeys,
      sttName === "deepgram" ? resolveDeepgramModel(this.config.settings) : undefined,
    );
    this.sttName = sttProvider.name;
    this.stt = await sttProvider.open({
      sampleRate: this.sampleRate,
      language: this.sttLanguage,
      keywords: this.config.boostedKeywords,
      onPartial: (text) => {
        this.transport.onPartialTranscript?.(text, "user");
        this.onCallerPartial(text);
      },
    });

    const runtime = await this.loadGraphRuntime();

    // What the flow starts with — test-prep values, lead fields, current_date
    // and friends. Held so "collected" can mean what the conversation actually
    // produced. Without this every seeded value was reported as an extraction,
    // so a call where the caller volunteered nothing still listed ten
    // "extracted variables".
    // Read from `runtime.vm`, not `this.graphVm` — the latter is not assigned
    // until further down, so this snapshot was always empty and every seeded
    // value still came back reported as an extraction.
    this.seededVariables = {};
    for (const [k, v] of Object.entries(runtime?.vm?.getVariables() ?? {})) {
      if (v === undefined || v === null) continue;
      this.seededVariables[k] = String(v);
    }

    this.lifecycleRef = this.config.resolveLifecycle?.(runtime) ?? null;
    // Only known once providers actually resolve (above) — too late to pass through the
    // `resolveLifecycle` factory's own construction. Read back at call end, for the cost
    // breakdown to charge the rate the call actually used instead of a blended guess.
    this.lifecycleRef?.setProviderInfo({
      sttProvider: this.sttName,
      ttsProvider: this.tts?.name ?? null,
    });

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

  /**
   * Native calls must run the conversation graph. Swallowing a load error and
   * flattening the flow into one prompt is how agents skipped steps. Prompt-only
   * sessions (no agent, no flow) still use the flat path.
   */
  private async loadGraphRuntime(): Promise<GraphRuntime | null> {
    const expectsGraph = Boolean(this.config.agentId || this.config.flow);
    try {
      const runtime = await buildGraphRuntime({
        apiKey: this.config.apiKey,
        logPrefix: this.log,
        agentId: this.config.agentId ?? null,
        supabase: this.config.supabase ?? null,
        flow: this.config.flow,
        settings: this.config.settings ?? null,
        variables: this.config.variables,
        startSpeaker: this.config.startSpeaker,
      });
      if (runtime) return runtime;
      if (!expectsGraph) return null;
      throw new Error(
        "WEBEE Native requires a runnable conversation graph — this call will not fall back to a flat prompt.",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${this.log} graph load failed: ${message}`);
      throw err instanceof Error ? err : new Error(message);
    }
  }

  /** Speak the greeting / flow start node after the transport is connected. */
  async beginConversation(): Promise<void> {
    // Builder "Begin delay (ms)": wait before the agent's first line, as Retell does. The setting
    // was stored and exported but never read on this engine. TTS warms during the wait.
    const beginDelayMs = Math.min(
      5000,
      Math.max(0, Number(this.config.settings?.beginMessageDelayMs ?? 0) || 0),
    );
    if (beginDelayMs > 0) {
      this.warmTts();
      await new Promise((resolve) => setTimeout(resolve, beginDelayMs));
      if (this.closed) return;
    }
    if (this.graph) {
      await this.graph.begin();
      this.warmTts();
      return;
    }

    const greeting = (this.config.beginMessage ?? "").trim();
    if (greeting) {
      this.history.push({ role: "assistant", content: greeting });
      this.queueAgentTranscript(greeting);
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
    this.armVoicemailWatch();
    this.armMaxDurationTimer();
    this.armDeadAirTimer();
    await this.beginConversation();
    return banner;
  }

  /** Feed one PCM16 mono frame from the caller, at the session's sample rate. */
  pushCallerAudio(chunk: Buffer): void {
    const detector = this.vad;
    if (!detector || this.closed || chunk.byteLength === 0) return;

    // The recording keeps what the caller actually sent; detection and transcription get the
    // cleaned audio.
    const rawChunk = chunk;
    if (this.denoiser) {
      const cleaned = this.denoiser.process(pcm16View(chunk));
      chunk = Buffer.from(cleaned.buffer, cleaned.byteOffset, cleaned.byteLength);
    }

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
      // The gate above exists so the agent's own voice does not reach STT. But the VAD only
      // confirms the caller has started a few frames after they actually did, so by the time the
      // gate lifts the first part of what they said has already been withheld — and a streaming
      // recogniser fed a word with its onset cut off returns nothing or a fragment. Measured
      // against Deepgram and Cartesia: withholding just the first 150ms of "Yes" or "Virani" turned
      // it into "" or "S", while the same audio whole transcribed correctly. That is a bare
      // "yes" needing to be said twice. The withheld tail is replayed first, only once the VAD
      // has confirmed a real caller is speaking, so echo is still discarded.
      if (this.withheldSttFrames.length > 0) {
        if (this.callerSpeaking) for (const held of this.withheldSttFrames) this.stt?.push(held);
        this.withheldSttFrames = [];
      }
      this.stt?.push(chunk);
    } else {
      this.withheldSttFrames.push(chunk);
      if (this.withheldSttFrames.length > WITHHELD_STT_FRAMES_MAX) this.withheldSttFrames.shift();
    }
    this.lifecycleRef?.recordCaller(pcm16View(rawChunk), this.sampleRate);
    this.framePump = this.framePump
      .then(async () => {
        const event = await detector.push(chunk);
        this.handleVadEvent(event);
        this.maybeBackchannel(chunk, event);
      })
      .catch((err: Error) => {
        console.error(`${this.log} VAD error: ${err.message}`);
      });
  }

  /** A keypad digit from the caller. Only graph mode routes on digits. */
  submitDigit(digit: string): void {
    const trimmed = digit.trim();
    if (!this.graph || !trimmed) return;
    if (!shouldAcceptDtmf(this.config.settings, this.agentSpeaking)) {
      console.log(`${this.log} DTMF "${trimmed}" ignored — allowUserDtmf/allowDtmfInterruption policy`);
      return;
    }
    // A keypress is a real response — the wait it answers is over, same as speech ending it.
    this.clearSilenceTimer();
    this.clearReminderTimer();
    this.graph.submitDigit(trimmed).catch((err: Error) => {
      this.transport.onError?.(err.message);
    });
  }

  /** The peer finished playing everything we sent ("reported" mode only). */
  /** Render the agent's backchannel words once per call, in the locked call voice. */
  private prepareBackchannelClips(): Promise<void> {
    if (!this.backchannel || this.backchannelPrep || !this.createClipTts || !this.voiceProfile) {
      return this.backchannelPrep ?? Promise.resolve();
    }
    const configured = Array.isArray(this.config.settings?.backchannelWords)
      ? (this.config.settings?.backchannelWords as unknown[]).map((w) => String(w ?? "").trim()).filter(Boolean)
      : [];
    const words = (configured.length ? configured : DEFAULT_BACKCHANNEL_WORDS).slice(0, 4);
    const createClipTts = this.createClipTts;
    const req = this.ttsVoiceRequest();
    this.backchannelPrep = (async () => {
      let tts: import("../tts/types").TtsProvider;
      try {
        tts = createClipTts();
      } catch (err) {
        console.warn(`${this.log} backchannel disabled: ${(err as Error).message}`);
        return;
      }
      for (const word of words) {
        if (this.closed) return;
        try {
          const parts: Buffer[] = [];
          for await (const chunk of tts.synthesize(word, req)) parts.push(chunk);
          const clip = prepareBackchannelClip(Buffer.concat(parts));
          const seconds = clip.byteLength / (this.sampleRate * 2);
          if (seconds >= 0.15 && seconds <= 1.5) this.backchannelClips.push(clip);
        } catch (err) {
          console.warn(`${this.log} backchannel clip "${word}" failed: ${(err as Error).message}`);
        }
      }
      console.log(`${this.log} backchannel ready: ${this.backchannelClips.length} clip(s)`);
    })();
    return this.backchannelPrep;
  }

  private maybeBackchannel(chunk: Buffer, event: VadEvent): void {
    const scheduler = this.backchannel;
    if (!scheduler || this.backchannelClips.length === 0 || this.closed) return;
    if (event.type === "speech_start") {
      scheduler.startTalking(Date.now());
      return;
    }
    if (event.type === "utterance_end" || event.type === "discarded") {
      scheduler.stopTalking();
      return;
    }
    if (event.type !== "speech") return;
    const fire = scheduler.onFrame({
      now: Date.now(),
      rms: event.rms,
      frameMs: (chunk.byteLength / (this.sampleRate * 2)) * 1000,
      agentBusy: this.bargeInActive || !this.awaitingCallerInput,
    });
    if (fire) this.playBackchannel();
  }

  /** Play one clip without starting an agent turn. */
  private playBackchannel(): void {
    const clip = this.backchannelClips[Math.floor(Math.random() * this.backchannelClips.length)];
    if (!clip) return;
    const responseId = this.responses.activeResponseId;
    const step = Math.floor(this.sampleRate * 0.1) * 2;
    for (let off = 0; off < clip.byteLength; off += step) {
      this.transport.sendAudio(clip.subarray(off, off + step), { responseId });
    }
    const clipMs = (clip.byteLength / (this.sampleRate * 2)) * 1000;
    this.backchannelWindowUntil = Date.now() + clipMs + 1500;
    console.log(`${this.log} backchannel (${Math.round(clipMs)}ms)`);
  }

  playbackDone(): void {
    // A backchannel clip drained while the caller was mid-turn. Treating that as the end of an
    // agent line would reset the VAD and STT buffer and lose what the caller is saying.
    if (Date.now() < this.backchannelWindowUntil && !this.bargeInActive) {
      console.log(`${this.log} playback done from a backchannel — ignored`);
      return;
    }
    console.log(`${this.log} playback done — caller may speak`);
    this.endPlayback();
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /** Tracks the last few agent-line-end -> caller-response gaps, feeding `enableDynamicResponsiveness`. */
  private recordResponseGap(): void {
    if (!this.ttsStreamEndedAt) return;
    const gap = Date.now() - this.ttsStreamEndedAt;
    if (gap < 0) return;
    this.recentResponseGapsMs.push(gap);
    if (this.recentResponseGapsMs.length > 5) this.recentResponseGapsMs.shift();
  }

  private armSilenceTimer(ms?: number): void {
    this.clearSilenceTimer();
    if (!ms || ms <= 0) return;
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (this.closed || !this.awaitingCallerInput || !this.graph) return;
      console.log(`${this.log} silence timeout ${ms}ms — routing wait/timeout edge`);
      this.awaitingCallerInput = false;
      // This wait cycle is over — the flow is moving on regardless of the caller now, most
      // commonly to speak its own next line. A reminder still scheduled from THIS wait must not
      // survive into whatever comes next: it fires a plain "are you still there?" mid-way through
      // that next line, because the VM's own staleness check (`vm.ts`'s "reminder" case) only
      // knows "are we waiting on the caller" in general, not which specific wait a reminder was
      // scheduled for — and the new line's own await_user re-affirms that same general state
      // almost immediately, well before its audio has finished playing.
      this.clearReminderTimer();
      this.graph.submitSilenceTimeout().catch((err: Error) => {
        this.transport.onError?.(err.message);
      });
    }, ms);
  }

  /**
   * A hard stop the graph itself has no say in — distinct from the per-node
   * `armSilenceTimer` above, which routes to a wait/timeout *edge* the flow
   * author placed. These two exist regardless of what the flow does: Retell
   * enforces both as agent-level policy, and the native engine previously had
   * no equivalent, so a stuck or abandoned call could run (and bill) forever.
   */
  private forceEnd(reason: "max_duration_reached" | "inactivity"): void {
    if (this.closed) return;
    console.log(`${this.log} ${reason} — ending call`);
    void this.lifecycleRef?.ended(reason);
    this.transport.onEnd?.(reason);
    this.close();
  }

  // ── Live voicemail handling ─────────────────────────────────────────────────

  /** Start watching for an answering machine, if this agent is set up for it and this is a phone call. */
  private armVoicemailWatch(): void {
    if (this.playbackTracking !== "reported") return; // phone calls only (Twilio reports playback)
    const policy = resolveVoicemailPolicy(this.config.settings);
    if (!policy) return;
    this.voicemailWindowStartAt = Date.now();
    this.voicemail = { policy, state: "listening", heard: "", detectedAt: 0, timer: null };
    console.log(`${this.log} voicemail watch armed action=${policy.action} window=${policy.timeoutMs}ms`);
  }

  /**
   * Whether this caller-side text was swallowed because it is (part of) an answering machine.
   * Routing must not see it: a recorded greeting is not an answer to anything.
   */
  private consumeAsVoicemail(userText: string): boolean {
    const vm = this.voicemail;
    if (!vm || vm.state === "done") return false;

    if (vm.state === "greeting") {
      // The rest of the greeting — keep it in the transcript, never route it.
      this.lifecycleRef?.addTurn("user", userText);
      this.transport.onTranscript?.("user", userText);
      return true;
    }

    if (Date.now() - this.voicemailWindowStartAt > vm.policy.timeoutMs) {
      vm.state = "done"; // past the window: whoever is talking now is a person
      return false;
    }

    vm.heard = `${vm.heard} ${userText}`.trim().slice(-800);
    const verdict = detectVoicemailGreeting(vm.heard);
    if (!verdict) return false;

    vm.state = "greeting";
    vm.detectedAt = Date.now();
    console.log(`${this.log} voicemail detected cues=[${verdict.cues.join(", ")}] action=${vm.policy.action}`);
    this.lifecycleRef?.addTurn("user", userText);
    this.transport.onTranscript?.("user", userText);

    // Stop talking to a recording, and stop every timer that would speak for the flow.
    this.cancelTurn("voicemail");
    this.clearSilenceTimer();
    this.clearReminderTimer();
    this.clearDeadAirTimer();
    this.awaitingCallerInput = false;

    if (vm.policy.action === "hangup") {
      this.finishVoicemailCall(0);
      return true;
    }
    this.waitForGreetingEnd();
    return true;
  }

  /**
   * A message left over the greeting is lost; one left after the beep is heard. The greeting is
   * over when the line has been quiet for a moment — the beep itself is a tone, not speech.
   */
  private waitForGreetingEnd(): void {
    const vm = this.voicemail;
    if (!vm) return;
    const QUIET_MS = 1_300;
    const MIN_WAIT_MS = 1_200;
    const MAX_WAIT_MS = 30_000;
    vm.timer = setInterval(() => {
      if (this.closed || vm.state !== "greeting") {
        if (vm.timer) clearInterval(vm.timer);
        return;
      }
      const now = Date.now();
      const quietFor = now - Math.max(this.lastCallerVoiceAt, vm.detectedAt);
      const waited = now - vm.detectedAt;
      if ((quietFor >= QUIET_MS && waited >= MIN_WAIT_MS) || waited >= MAX_WAIT_MS) {
        if (vm.timer) clearInterval(vm.timer);
        vm.timer = null;
        void this.leaveVoicemailMessage();
      }
    }, 250);
  }

  private async leaveVoicemailMessage(): Promise<void> {
    const vm = this.voicemail;
    if (!vm || this.closed) return;
    vm.state = "done";
    const variables = (this.graphVm?.getVariables() ?? {}) as Record<string, VariableValue>;
    const text = interpolateStaticSpeech(vm.policy.message, variables).trim();
    if (!text) {
      this.finishVoicemailCall(0);
      return;
    }
    try {
      const t = this.beginTurn(Date.now());
      const responseId = this.responses.begin(t.id);
      this.transport.onResponseStart?.({ responseId, turnId: t.id });
      this.queueAgentTranscript(text);
      await this.streamTts(text, t, responseId);
    } catch (err) {
      console.error(`${this.log} voicemail message failed: ${(err as Error).message}`);
    }
    // Twilio buffers what we sent; hang up only once it has had time to play.
    this.finishVoicemailCall(Math.max(0, this.playheadAt - Date.now()) + 800);
  }

  private finishVoicemailCall(afterMs: number): void {
    setTimeout(() => {
      if (this.closed) return;
      console.log(`${this.log} voicemail reached — ending call`);
      void this.lifecycleRef?.ended("voicemail_reached");
      this.transport.onEnd?.("voicemail_reached");
      this.close();
    }, afterMs);
  }

  private armMaxDurationTimer(): void {
    const ms = resolveMaxCallDurationMs(this.config.settings);
    if (ms == null) return;
    this.maxDurationTimer = setTimeout(() => this.forceEnd("max_duration_reached"), ms);
  }

  private clearDeadAirTimer(): void {
    if (this.deadAirTimer) {
      clearTimeout(this.deadAirTimer);
      this.deadAirTimer = null;
    }
  }

  private clearReminderTimer(): void {
    if (this.reminderTimer) {
      clearTimeout(this.reminderTimer);
      this.reminderTimer = null;
    }
  }

  /**
   * Schedule the next "are you still there?" nudge, if reminders are configured and there are
   * any left for this wait cycle. Re-arms itself after each one fires, so `reminderMaxCount`
   * nudges are spaced `reminderTriggerMs` apart rather than all firing at once.
   */
  private armReminderTimer(): void {
    this.clearReminderTimer();
    const reminders = resolveReminderSettings(this.config.settings);
    if (!reminders || this.reminderCount >= reminders.maxCount) return;
    this.reminderTimer = setTimeout(() => {
      this.reminderCount++;
      this.graph?.submitReminder(DEFAULT_REMINDER_TEXT).catch((err: Error) => {
        this.transport.onError?.(err.message);
      });
      this.armReminderTimer();
    }, reminders.triggerMs);
  }

  /** (Re)start the whole-call silence watchdog. Called once at start, then on every caller turn. */
  private armDeadAirTimer(): void {
    this.clearDeadAirTimer();
    const ms = resolveEndCallAfterSilenceMs(this.config.settings);
    if (ms == null) return;
    this.deadAirTimer = setTimeout(() => this.forceEnd("inactivity"), ms);
  }

  /** Tear down. Idempotent; safe to call from a socket close handler. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.tts?.name === "fish") {
      (this.tts as FishAudioTtsProvider).releaseCall();
    }
    this.clearUtteranceCoalesce();
    this.clearPartialStability();
    this.clearSilenceTimer();
    this.clearDeadAirTimer();
    this.clearReminderTimer();
    if (this.voicemail?.timer) clearInterval(this.voicemail.timer);
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    this.endPlayback();
    this.turn?.ctrl.abort();
    this.stt?.close();
    this.flushPendingAgentTranscript("complete");
    this.mergeCollectedVariables(this.graphVm?.getVariables() ?? {});
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

    const target = this.graphVm?.peekSpeechWarmTarget(normalized) ?? null;
    const destKey =
      target?.kind === "static"
        ? `static:${target.text}`
        : target?.kind === "prompt"
          ? `prompt:${target.nodeId}`
          : "";

    if (this.graphVm) {
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
      if (destKey && destKey === this.speculativeGraphDestKey) {
        /* same predicted dest — keep speculative LLM / TTS */
      } else {
        this.speculativeGraphKey = "";
        this.speculativeGraphDestKey = destKey;
        this.graphVm?.clearSpeculativeSpeech();
        // The routing decision was made from words the caller has since changed. `partialMatchesFinal`
        // would reject it at adoption anyway; dropping it here frees the slot so the next stable
        // partial can start a fresh one.
        this.graphVm?.clearSpeculativeRoute();
      }
    }

    const shortReply = looksLikeCompleteShortReply(normalized);
    const commitReady = looksLikeCommitReadyPartial(normalized);
    const minChars = shortReply || commitReady ? 2 : PARTIAL_MIN_CHARS;
    const stableMs = shortReply
      ? SHORT_REPLY_STABLE_MS
      : commitReady
        ? COMMIT_READY_STABLE_MS
        : PARTIAL_STABLE_MS;
    this.clearPartialStability();
    if (!this.callerSpeaking || normalized.length < minChars) return;

    const stableFor = Date.now() - this.partialStableSince;
    if (stableFor >= stableMs) {
      this.startPreEndpointWork(normalized);
      return;
    }
    // Not stable long enough *yet*. This gate used to be checked only here, on partial arrival —
    // but the condition it waits for ("the transcript stopped changing") becomes true precisely
    // when the caller stops talking, and no further partial arrives during that silence to
    // re-trigger the check. So on a real call it never passed: across 400 recorded turns
    // `partial_commit` was false every time and nothing was ever started before the endpoint,
    // leaving the whole ~800ms hangover idle. A timer closes that gap.
    this.partialStabilityTimer = setTimeout(() => {
      this.partialStabilityTimer = null;
      // Re-check rather than trust: the caller may have resumed, or said something new.
      if (!this.callerSpeaking || this.partialNormalized !== normalized) return;
      this.startPreEndpointWork(normalized);
    }, stableMs - stableFor);
  }

  private startPreEndpointWork(normalized: string): void {
    this.markUtterance("partial_stt_stable");
    if (this.graphVm) this.maybeStartSpeculativeGraph(normalized);
    else this.maybeStartSpeculativeFlat(normalized);
  }

  private clearPartialStability(): void {
    if (!this.partialStabilityTimer) return;
    clearTimeout(this.partialStabilityTimer);
    this.partialStabilityTimer = null;
  }

  private maybeStartSpeculativeGraph(partial: string): void {
    const vm = this.graphVm;
    if (!vm) return;

    const target = vm.peekSpeechWarmTarget(partial);
    if (!target) {
      this.startSpeculativeGraphFanout(vm, partial);
      return;
    }

    if (target.kind === "static") {
      this.speculativeGraphDestKey = `static:${target.text}`;
      return;
    }

    const key = target.nodeId;
    this.speculativeGraphDestKey = `prompt:${target.nodeId}`;
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
    this.markUtterance("speculative_llm_start");
    console.log(
      `${this.log} speculative graph LLM started node=${target.nodeId} (${partial.slice(0, 40)})`,
    );
  }

  /**
   * Warm every plausible destination while the caller is still trailing off.
   *
   * The single-target path above only fires when a heuristic predicts the destination outright. On
   * every other turn nothing used to start until the endpoint, so the full LLM round trip — ~1.3s
   * here, of which only ~250ms is the model and the rest is network — landed entirely after the
   * caller stopped talking, with the ~800ms VAD hangover spent idle. This fans out the same
   * candidates `beginRouteRaceSpeech` would have started post-endpoint, so that hangover overlaps
   * the round trip instead of preceding it.
   *
   * Runs already in flight are skipped by `speechWarmFanout`, so a growing partial re-enters here
   * without stacking duplicates, and a partial that genuinely changes clears them (see
   * `onCallerPartial`). Whichever runs lose are aborted by `keepSpeculativeFor` once routing
   * resolves, and `prepareSpeech` only adopts a run whose partial still matches the final
   * transcript — so a misprediction costs tokens, never a wrong answer.
   */
  private startSpeculativeGraphFanout(vm: ConversationVm, partial: string): void {
    // Routing gets its own budget, checked before the fanout's. Sharing one counter was a mistake:
    // a growing partial ("it's" → "it's correct and" → the full sentence) clears the speculative
    // route each time it changes, so on a long utterance the fanout cap was reached before the
    // *last* partial — the only one that matches the final transcript — got a route at all. Measured
    // on a real call: generation was fully hidden behind routing, then routing itself still cost
    // 1250-1739ms cold. The two are not comparable in price either, which is why one number for
    // both was wrong: a route is a single cheap classifier call, a fanout round is up to three
    // full-model generations.
    if (this.routeRoundsThisUtterance < MAX_SPECULATIVE_ROUTE_ROUNDS) {
      if (vm.beginSpeculativeRoute(partial)) {
        this.routeRoundsThisUtterance += 1;
        this.markUtterance("llm_route_request_start");
        console.log(`${this.log} speculative route started (${partial.slice(0, 40)})`);
      }
    }

    if (this.fanoutRoundsThisUtterance >= MAX_SPECULATIVE_FANOUT_ROUNDS) return;
    const targets = vm.speechWarmFanout(partial);
    if (targets.length === 0) return;
    this.fanoutRoundsThisUtterance += 1;

    const provider = resolveWebeeLlmProvider(this.config.settings);
    for (const target of targets) {
      const run = startSpeculativeSpeech({
        apiKey: this.config.apiKey,
        model: target.model,
        messages: [...target.messages, { role: "user", content: partial }],
        partial,
        provider,
      });
      vm.setSpeculativeSpeech(target.nodeId, run);
    }
    this.markUtterance("speculative_llm_start");
    console.log(
      `${this.log} speculative graph fanout started n=${targets.length} nodes=${targets
        .map((t) => t.nodeId)
        .join(",")} (${partial.slice(0, 40)})`,
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
    this.markUtterance("speculative_llm_start");
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
        if (this.replySpeakAt === null) this.replySpeakAt = Date.now();
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
          this.queueAgentTranscript(text);
          return;
        }
        this.transport.onTranscript?.(role, text);
      },
      onVariables: (values) => {
        this.mergeCollectedVariables(values);
      },
      onToolCall: (toolId, result, ok) => {
        console.info(
          `${this.log} [FUNCTION_RESULT] ${toolId} ${ok ? "ok" : "fail"} ${String(result).slice(0, 160)}`,
        );
        this.lifecycleRef?.recordToolCall({
          name: toolId,
          type: "custom",
          success: ok,
        });
        this.transport.onToolCall?.(toolId, result, ok);
      },
      onTransfer: async (options) => {
        if (!this.transport.transferCall) return false;
        const ok = await this.transport.transferCall(options).catch(() => false);
        if (ok) this.lifecycleRef?.transferred(options.destination);
        return ok;
      },
      onAwaitUser: (options) => {
        this.awaitingCallerInput = true;
        void this.prepareBackchannelClips();
        const nodeId = this.graphVm?.nodeId;
        if (nodeId) this.transport.onNodeActive?.(nodeId);
        console.log(`${this.log} awaiting caller input (duplex — mic open during playback)`);
        this.responses.markListening();
        this.vad?.reset();
        this.stt?.clearInputBuffer?.();
        // A reminder nudge re-affirms the *same* wait it interrupted, not a new one — restarting
        // the silence-timeout clock and the reminder count here would let a silent caller be
        // "still there?"-ed forever and would defeat the node's own timeout edge (the bug this
        // guard fixes: reminders used to reset themselves indefinitely instead of respecting
        // reminderMaxCount and letting the flow's own timeout ever fire).
        if (options?.isReminderReaffirmation) return;
        this.currentSilenceTimeoutMs = resolveDynamicSilenceTimeoutMs(
          options?.silenceTimeoutMs,
          this.recentResponseGapsMs,
          this.config.settings,
        );
        // A fresh wait cycle — someone who answered the last question and then goes quiet on
        // this one deserves the full set of nudges again, not whatever was left over from before.
        this.reminderCount = 0;
        // `speak` resolves once the line has been fully SENT, not once the caller has actually
        // heard it — a long line can still be draining through Twilio/the browser's playback
        // buffer for several more seconds after that. Starting the silence/reminder clock here
        // for a long line meant "are you still there?" could fire while the agent was still
        // mid-sentence. Wait for the real playback-done signal (`endPlayback`) before starting
        // either clock; only start immediately when the agent has nothing left to finish playing.
        if (this.agentSpeaking) {
          this.pendingWaitArm = { silenceTimeoutMs: this.currentSilenceTimeoutMs };
          return;
        }
        this.armSilenceTimer(this.currentSilenceTimeoutMs);
        this.armReminderTimer();
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
          self.queueAgentTranscript(agentText);
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
        self.queueAgentTranscript(agentText);
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
  private async processTurn(
    frames: Buffer[],
    endpointAt: number,
    speechStartAt: number | null = null,
  ): Promise<void> {
    // Retell-like: never drop the utterance before STT. Laptop-speaker echo is
    // empty/hallucinated text; a real "yes" must be allowed to interrupt.
    this.abortSpeculativeFlat("utterance_end");
    this.speculativeGraphKey = "";
    this.speculativeGraphDestKey = "";
    // Keep graph speculative speech — prepareSpeech accepts it if the final matches.
    const partialFallback = this.partialNormalized.trim();
    this.partialNormalized = "";
    this.partialStableSince = 0;
    this.callerSpeaking = false;

    // Fish is excluded for the same reason as Deepgram: its partials are full transcripts of the
    // utterance up to the last pause, and its final returns at once when no speech followed that
    // pause. Using the partial instead would drop anything said after the pause.
    const skipSttFinal =
      this.englishTurnRules &&
      this.sttName !== "deepgram" &&
      this.sttName !== "fish" &&
      shouldSkipSttFinal(
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
        // Real speech reached STT (VAD endpointed a genuine utterance — this is not the silence
        // case above) and it still came back empty. The caller said something and heard nothing
        // back: previously this just called `endPlayback()` and returned, re-arming the mic with
        // zero acknowledgement — indistinguishable, from their side, from the call being frozen,
        // which is exactly the "it got stuck" symptom this exists to fix. Whatever the underlying
        // cause (a provider hiccup, a dropped few hundred ms of audio, a bad connection) the right
        // behaviour is the same one a human agent falls back to: say so, and ask them to repeat —
        // not silently keep listening as if nothing happened.
        console.warn(
          `${this.log} empty STT after caller utterance — stt=${this.sttName} frames=${frames.length} misses=${this.sttMissCount + 1}`,
        );
        this.sttMissCount++;
        if (this.sttMissCount <= MAX_STT_MISS_NUDGES) {
          this.graph
            ?.submitReminder(STT_MISS_NUDGE_TEXT)
            .catch((err: Error) => this.transport.onError?.(err.message));
        } else {
          // Nudged enough times with no real reply getting through — this is no longer "say that
          // again", it's "something is actually broken for this caller". Defer to the flow's own
          // configured wait/timeout edge, the same graceful give-up a genuine silence timeout
          // already uses, rather than nudging forever.
          this.sttMissCount = 0;
          this.graph?.submitSilenceTimeout().catch((err: Error) => this.transport.onError?.(err.message));
        }
        return;
      }
    }

    this.sttMissCount = 0;
    userText = applyKeywordBoost(userText, this.config.boostedKeywords);
    // Emails, spelled names and addresses arrive as they sound ("j o e at gmail dot com"); turn
    // them into the text they stand for so the model reads and repeats them correctly.
    userText = normaliseSpokenIdentifiers(userText, { ukPostcodes: this.ukPostcodes });
    if (this.consumeAsVoicemail(userText)) return;

    // Said before the caller could have heard the agent's reply — and nothing but "yeah" / a repeat
    // of their last answer. Routing it would answer a question they never heard (the node gets
    // skipped), and treating it as barge-in would cut that question off. Drop it.
    if (
      isStaleReply({
        speechStartAt,
        lastAcceptedUserAt: this.lastAcceptedUserAt,
        replySpeakAt: this.replySpeakAt,
        replyAudioStartAt: this.replyAudioStartAt,
      }) &&
      isAckOrRepeat(userText, this.lastAcceptedUserText, this.englishTurnRules)
    ) {
      console.log(
        `${this.log} ignoring "${userText.slice(0, 40)}" — said before the agent's reply was heard (repeat/acknowledgement)`,
      );
      this.callerBargeIn = false;
      return;
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
      console.log(`${this.log} caller interrupted — stopping agent audio: "${userText.slice(0, 60)}"`);
      this.callerBargeIn = true;
      this.pendingDuplexUserText = null;
      this.cancelTurn("caller interrupted");
    }
    this.callerBargeIn = false;
    this.awaitingCallerInput = false;
    this.clearSilenceTimer();

    const t = this.beginTurn(endpointAt);
    t.sttAt = Date.now();
    if (this.graph) {
      const trace = this.startTurnTrace(t);
      this.graphVm?.setTurnTrace(trace);
      trace.setSttFinal(t.sttAt);
      trace.mark("stt_final");
      trace.mark("graph_user_submit");
    }

    if (t.ctrl.signal.aborted) return;

    this.lifecycleRef?.addTurn("user", userText);
    this.transport.onTranscript?.("user", userText);
    this.armDeadAirTimer(); // the caller just spoke — the whole-call silence clock restarts
    this.clearReminderTimer(); // they responded — no stale nudge should fire mid-turn
    console.log(`${this.log} turn ${t.id} user: ${userText.slice(0, 120)}`);

    const normalizedUser = userText.trim().toLowerCase();
    if (
      normalizedUser &&
      isRepeatOf(normalizedUser, this.lastAcceptedUserText) &&
      Date.now() - this.lastAcceptedUserAt < 2500
    ) {
      console.log(`${this.log} turn ${t.id}: duplicate user utterance ignored`);
      return;
    }
    this.lastAcceptedUserText = normalizedUser;
    this.recordResponseGap();
    this.lastAcceptedUserAt = Date.now();
    this.replySpeakAt = null;
    this.replyAudioStartAt = null;

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
    this.agentPcmBytesThisUtterance = 0;
    this.agentAudioStartedAt = 0;
    // Both paths get the same treatment: symbol/abbreviation spelling-out, then the agent's
    // pronunciation dictionary rendered for this voice. A streamed reply used to skip both.
    const pronunciation = (this.config.settings?.pronunciationDictionary ?? []) as PronunciationEntry[];
    const pronTarget = { provider: tts.name };
    const normalized =
      typeof source === "string"
        ? applyPronunciationDictionary(
            normalizeForSpeech(normalizeSpeechText(source), this.config.settings),
            pronunciation,
            pronTarget,
          )
        : applyPronunciationDictionaryStream(source, pronunciation, pronTarget, (text) =>
            normalizeForSpeech(text, this.config.settings),
          );
    if (typeof normalized === "string") {
      req.speed = resolveDynamicSpeed(req.speed, normalized, this.config.settings);
    }

    const openAudio = () =>
      typeof normalized === "string"
        ? tts.synthesize(normalized, req)
        : tts.synthesizeStream(normalized, req);

    const pumpAudio = async (audio: AsyncIterable<import("../tts/types").PcmChunk>) => {
      for await (const chunk of audio) {
        if (!this.responses.isActive(responseId) || t.ctrl.signal.aborted || this.closed) break;
        if (this.replySpeakAt !== null && this.replyAudioStartAt === null) {
          this.replyAudioStartAt = Date.now();
        }
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
    };

    try {
      await pumpAudio(openAudio());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable =
        typeof normalized === "string" &&
        !t.firstAudioAt &&
        !t.ctrl.signal.aborted &&
        !this.closed &&
        /socket closed|closed during synthesis|closed before stop/i.test(message);
      if (!retryable) throw err;
      console.warn(`${this.log} TTS dropped, retrying once: ${message}`);
      await pumpAudio(openAudio());
    }
    if (
      !t.firstAudioAt &&
      typeof normalized === "string" &&
      normalized.trim() &&
      !t.ctrl.signal.aborted &&
      this.responses.isActive(responseId) &&
      !this.closed
    ) {
      console.warn(`${this.log} TTS produced no audio, retrying once`);
      try {
        await pumpAudio(openAudio());
      } catch (err) {
        console.error(
          `${this.log} TTS retry failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (!t.firstAudioAt && !t.ctrl.signal.aborted && this.responses.isActive(responseId)) {
      console.warn(
        `${this.log} turn ${t.id} response ${responseId} TTS produced no audio (check Fish reference_id)`,
      );
      this.flushPendingAgentTranscript("complete");
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

  /**
   * Reveal the agent transcript as audio plays, instead of dumping the whole
   * node script in one block the moment the VM yields it.
   */
  private queueAgentTranscript(text: string): void {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    this.lastAgentText = clean;
    this.pendingAgentTranscript = clean;
    this.lastShownAgentTranscript = "";
    this.agentTranscriptStartedAt = Date.now();
    if (!this.agentAudioStartedAt) this.agentPcmBytesThisUtterance = 0;
    this.stopAgentTranscriptTicker();
    const tick = () => {
      if (this.closed || this.pendingAgentTranscript !== clean) return;
      if (!this.agentAudioStartedAt || this.agentPcmBytesThisUtterance <= 0) {
        this.agentTranscriptTimer = setTimeout(tick, 80);
        return;
      }
      const shown = transcriptCaughtUpToAudio(
        clean,
        this.agentPcmBytesThisUtterance,
        this.sampleRate,
      );
      if (shown && shown !== this.lastShownAgentTranscript) {
        this.lastShownAgentTranscript = shown;
        this.transport.onPartialTranscript?.(shown, "agent");
      }
      this.agentTranscriptTimer = setTimeout(tick, 160);
    };
    this.agentTranscriptTimer = setTimeout(tick, 80);
  }

  private stopAgentTranscriptTicker(): void {
    if (this.agentTranscriptTimer) {
      clearTimeout(this.agentTranscriptTimer);
      this.agentTranscriptTimer = null;
    }
  }

  private flushPendingAgentTranscript(mode: "complete" | "interrupted"): void {
    this.stopAgentTranscriptTicker();
    const full = (this.pendingAgentTranscript ?? "").trim();
    const heard = transcriptCaughtUpToAudio(
      full,
      this.agentPcmBytesThisUtterance,
      this.sampleRate,
    ).trim();
    const shown = this.lastShownAgentTranscript.trim();
    const text = mode === "interrupted" ? shown || heard || full : full || heard || shown;
    this.pendingAgentTranscript = null;
    this.lastShownAgentTranscript = "";
    if (!text) return;
    this.lastAgentText = text;
    this.lifecycleRef?.addTurn("agent", text);
    this.transport.onTranscript?.("agent", text);
  }

  private mergeCollectedVariables(values: Record<string, VariableValue>): void {
    const str: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null) continue;
      const text = String(value).trim();
      if (!text) continue;
      // Unchanged from the seed means the caller never told us this — it was
      // already known. Reporting it as collected is what made the extraction
      // list indistinguishable from the test inputs.
      if (this.seededVariables[key] === text) continue;
      str[key] = text;
    }
    if (Object.keys(str).length === 0) return;
    this.lifecycleRef?.mergeDynamicVariables(str);
    console.log(`${this.log} collected ${Object.keys(str).join(", ")}`);
  }

  private emitAudio(chunk: Buffer, responseId: number, turnId: number): void {
    if (!this.responses.isActive(responseId)) return;
    if (!this.speakingFlag && chunk.byteLength > 0) {
      console.log(
        `${this.log} sending first audio chunk response=${responseId} turn=${turnId} (${chunk.byteLength} bytes)`,
      );
      this.agentAudioStartedAt = Date.now();
    }
    this.agentPcmBytesThisUtterance += chunk.byteLength;
    this.transport.sendAudio(chunk, { responseId, turnId });
    const durationMs = (chunk.byteLength / 2 / this.sampleRate) * 1000;
    this.playheadAt = Math.max(this.playheadAt, Date.now()) + durationMs;
    if (this.playbackTracking === "reported") {
      this.speakingFlag = true;
      this.responses.markSpeaking();
      return;
    }
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
    const remainingMs = Math.max(0, this.playheadAt - Date.now());
    // Twilio buffers, so wait a bit longer than the PCM duration. Marks call
    // playbackDone() earlier when the carrier actually reached that audio.
    const timeout = Math.min(
      this.runtime.playback.playbackTimeoutMs,
      Math.max(remainingMs + 500, 800),
    );
    this.playbackTimer = setTimeout(() => this.endPlayback(), timeout);
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
    this.flushPendingAgentTranscript("complete");
    this.agentPcmBytesThisUtterance = 0;
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

    // The agent's line has now actually finished playing — start the clock a wait node armed
    // earlier was deferring, if the caller hasn't already answered in the meantime.
    if (this.pendingWaitArm && this.awaitingCallerInput) {
      const arm = this.pendingWaitArm;
      this.pendingWaitArm = null;
      this.armSilenceTimer(arm.silenceTimeoutMs);
      this.armReminderTimer();
    } else {
      this.pendingWaitArm = null;
    }
  }

  /** Process a caller reply held during duplex playback (no STT pass). */
  private async submitBufferedUserText(userText: string): Promise<void> {
    if (this.closed || !userText.trim()) return;
    this.clearSilenceTimer();
    console.log(`${this.log} processing buffered duplex reply: "${userText.slice(0, 80)}"`);
    if (this.consumeAsVoicemail(userText)) return;

    const t = this.beginTurn(Date.now());
    t.sttAt = Date.now();
    if (this.graph) {
      const trace = this.startTurnTrace(t);
      this.graphVm?.setTurnTrace(trace);
      trace.setSttFinal(t.sttAt);
      trace.mark("stt_final");
      trace.mark("graph_user_submit");
    }

    if (t.ctrl.signal.aborted) return;

    this.lifecycleRef?.addTurn("user", userText);
    this.transport.onTranscript?.("user", userText);
    this.armDeadAirTimer(); // the caller just spoke — the whole-call silence clock restarts
    this.clearReminderTimer(); // they responded — no stale nudge should fire mid-turn
    console.log(`${this.log} turn ${t.id} user (buffered): ${userText.slice(0, 120)}`);

    const normalizedUser = userText.trim().toLowerCase();
    if (
      normalizedUser &&
      isRepeatOf(normalizedUser, this.lastAcceptedUserText) &&
      Date.now() - this.lastAcceptedUserAt < 2500
    ) {
      console.log(`${this.log} turn ${t.id}: duplicate buffered utterance ignored`);
      return;
    }
    this.lastAcceptedUserText = normalizedUser;
    this.recordResponseGap();
    this.lastAcceptedUserAt = Date.now();
    this.replySpeakAt = null;
    this.replyAudioStartAt = null;
    this.awaitingCallerInput = false;

    if (this.graph) {
      await this.graph.submitUserText(userText);
      return;
    }
    await this.runFlatTurn(userText, t);
  }

  /**
   * Create the turn's trace and hand it the marks already gathered for it.
   * Pending values are consumed so they can never leak into the next turn.
   */
  private startTurnTrace(t: Turn): CallTurnTrace {
    const trace = new CallTurnTrace(t.id, t.startedAt, this.log);
    t.trace = trace;
    for (const { name, at } of this.pendingMarks) trace.mark(name, at);
    this.pendingMarks = [];
    this.fanoutRoundsThisUtterance = 0;
    this.routeRoundsThisUtterance = 0;
    // This utterance is committed; a stability re-check for it would act on stale text.
    this.clearPartialStability();
    if (this.pendingUserSpeechStartAt !== null) {
      trace.setUserSpeechStart(this.pendingUserSpeechStartAt);
      this.pendingUserSpeechStartAt = null;
    }
    if (this.pendingEndpointing) {
      trace.setEndpointing(
        this.pendingEndpointing.hangoverMs,
        this.pendingEndpointing.heldForIncomplete,
      );
      this.pendingEndpointing = null;
    }
    return trace;
  }

  /**
   * Record a mark for the turn the caller is still speaking into.
   *
   * Always buffers rather than writing through to `this.turn`: a pre-endpoint event belongs to the
   * turn about to be created, never the one still on `this.turn` (which is the agent's previous
   * response until it is cancelled or superseded). First write per mark wins, so this reports when
   * work on this utterance *first* started even if a changing partial restarts it.
   */
  private markUtterance(name: LatencyMark, at: number = Date.now()): void {
    if (this.pendingMarks.some((m) => m.name === name)) return;
    this.pendingMarks.push({ name, at });
  }

  private applyAdaptiveHangover(partial: string): void {
    const baseMs = this.runtime.endpointing.silenceDurationMs;
    // Reads the partial for English "unfinished" cues; other languages keep the configured wait.
    if (!this.englishTurnRules) return;
    const hangoverMs = resolveEndpointHangoverMs(partial, baseMs, this.graphVm?.currentInstructionText);
    const frames = Math.max(3, Math.round(hangoverMs / BROWSER_VAD_FRAME_MS));
    this.vad?.setSilenceFramesTrigger(frames);
    // Buffered, not written to this.turn: partials arrive before beginTurn
    // creates the turn this window applies to. Recorded so the adaptive window
    // can be judged from data rather than by ear.
    this.pendingEndpointing = { hangoverMs, heldForIncomplete: hangoverMs > baseMs };

    // Text-only heuristic was genuinely unsure (neither the "definitely complete" nor the
    // "definitely incomplete" fast path fired) — ask the classifier once per utterance whether
    // this reads as a finished thought, the same principle Retell's own turn-detection model
    // applies (judge from content, not just silence duration), at a scale that's actually
    // buildable here. Fire-and-forget: can only extend the wait, never shorten it, and a stale
    // response from an utterance that has since ended or been superseded is a no-op.
    //
    // No minimum word count: a name/title answer is often just one word, and a caller who
    // trails off mid-word on exactly that kind of answer ("Ar" — pausing before finishing
    // "Arjav") is precisely the case with nothing else to catch it. A short partial costs the
    // classifier nothing extra to reason about; gating it out only meant single-word answers
    // got no safety net at all.
    const wordCount = partial.trim().split(/\s+/).filter(Boolean).length;
    if (hangoverMs === baseMs && wordCount >= 1 && !this.turnCheckFired && this.graphVm) {
      this.turnCheckFired = true;
      const generation = this.turnCheckGeneration;
      this.graphVm
        .isLikelyStillSpeaking(partial)
        .then((stillSpeaking) => {
          if (!stillSpeaking || this.closed || generation !== this.turnCheckGeneration || !this.vad) {
            return;
          }
          const extendedFrames = Math.max(
            frames,
            Math.round(INCOMPLETE_PARTIAL_HANGOVER_MS / BROWSER_VAD_FRAME_MS),
          );
          this.vad.setSilenceFramesTrigger(extendedFrames);
          this.pendingEndpointing = { hangoverMs: INCOMPLETE_PARTIAL_HANGOVER_MS, heldForIncomplete: true };
        })
        .catch(() => {
          /* no signal — the heuristic's own decision stands */
        });
    }
  }

  private restoreHangover(): void {
    this.vad?.setSilenceFramesTrigger(this.defaultSilenceFrames);
    // Whatever utterance a pending completion check was reasoning about is over — a late answer
    // must not reach back and extend a window that no longer applies to anything live.
    this.turnCheckGeneration++;
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
      const speechStartAt = this.utteranceSpeechStartAt;
      this.utteranceSpeechStartAt = null;
      if (frames.length === 0) return;
      this.turnPipeline = this.turnPipeline
        .then(() => this.processTurn(frames, Date.now(), speechStartAt))
        .catch((err: Error) => {
          console.error(`${this.log} processTurn unhandled: ${err.message}`);
          this.endPlayback();
        });
    }, delay);
  }

  // ── Turn bookkeeping ───────────────────────────────────────────────────────

  private beginTurn(startedAt: number): Turn {
    // Never abort in-flight TTS (greeting / collect line). VAD during generate
    // used to supersede turn 1 and mute the call before firstAudioAt.
    if (isIdleCallerTurn(this.turn) && !this.activeSpeak) {
      console.log(`${this.log} superseding caller turn ${this.turn!.id} (STT not finished)`);
      this.turn!.ctrl.abort();
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
    // The playback this was waiting to confirm is never completing now — whatever silence/
    // reminder timer would have started belongs to a wait the caller has already resolved by
    // barging in, so a later, unrelated endPlayback must not arm it against the wrong turn.
    this.pendingWaitArm = null;
    this.abortSpeculativeFlat("cancelled");
    this.speculativeGraphKey = "";
    this.speculativeGraphDestKey = "";
    this.graphVm?.clearSpeculativeSpeech();
    this.partialNormalized = "";
    this.partialStableSince = 0;
    this.restoreHangover();
    this.flushPendingAgentTranscript("interrupted");
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
    if (total !== null) this.transport.onTurnLatency?.(total);
    this.persistTurnLatency(t);
  }

  /**
   * Store the turn's marks. Fire-and-forget by construction: a latency row is
   * worth losing, a blocking write mid-conversation is not.
   */
  private persistTurnLatency(t: Turn): void {
    const trace = t.trace;
    if (!trace || !trace.hasTimings()) return;
    const workspaceId = this.config.workspaceId ?? this.workspaceIdCache;
    if (!workspaceId) return;
    void import("../call-turn-latency.server")
      .then(({ recordCallTurnLatencyAsync }) =>
        recordCallTurnLatencyAsync(
          {
            workspaceId,
            callId: this.config.callId,
            nodeId: this.graphVm?.nodeId ?? null,
            engine: "webee_native",
            agentId: this.config.agentId ?? null,
            isTestCall: this.config.isTestCall ?? false,
          },
          trace.toRecord(),
        ),
      )
      .catch(() => {
        /* latency telemetry must never affect a live call */
      });
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
        this.lastCallerVoiceAt = Date.now();
        this.speechFrames = 1;
        this.lastSpeechRms = event.rms;
        if (this.utteranceSpeechStartAt === null) this.utteranceSpeechStartAt = Date.now();
        // New speech burst — allow one more LLM-assisted completion check for it, and make sure a
        // check still in flight from before this burst started can no longer act (they resuming
        // is itself evidence they weren't done, so that check's answer is moot either way).
        this.turnCheckFired = false;
        this.turnCheckGeneration++;
        // Belongs to the turn this speech will produce, not the one just finished.
        this.pendingUserSpeechStartAt = Date.now();
        this.turn?.trace?.mark("turn_detected");
        // The caller has started talking — stop counting toward "still there?" and the node's
        // own silence-timeout edge right now, not only once STT finalises. Finalisation (plus
        // utterance coalescing for a paused, multi-clause answer like a spelled-out email) can
        // take several seconds after speech actually starts, and both timers used to keep
        // running through that gap — firing "are you still there?" over the caller's own answer,
        // or worse, routing the timeout edge while they were still mid-sentence.
        if (this.awaitingCallerInput) {
          this.clearSilenceTimer();
          this.clearReminderTimer();
        }
        if (this.bargeInActive && event.rms < this.runtime.interruption.bargeInMinRms) {
          this.speechFrames = 0;
        }
        this.warmTts();
        break;
      case "speech":
        this.lastCallerVoiceAt = Date.now();
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
        if (this.pendingUtteranceFrames.length === 0) this.utteranceSpeechStartAt = null;
        this.speechFrames = 0;
        this.abortSpeculativeFlat("discarded");
        this.speculativeGraphKey = "";
        this.speculativeGraphDestKey = "";
        this.graphVm?.clearSpeculativeSpeech();
        this.partialNormalized = "";
        this.partialStableSince = 0;
        this.restoreHangover();
        console.log(`${this.log} utterance too short (${event.frameCount} frames)`);
        // A false start (noise, breath, a stray click) — speech_start paused both timers above,
        // but nothing was actually said, so if a node is still waiting, resume the clock rather
        // than leaving the caller with no timeout and no reminder for the rest of the wait.
        if (this.awaitingCallerInput) {
          this.armSilenceTimer(this.currentSilenceTimeoutMs);
          this.armReminderTimer();
        }
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
