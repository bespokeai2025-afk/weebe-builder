/**
 * Native call lifecycle.
 *
 * One instance per call. Gateways feed it transcript turns and audio; it owns
 * the event contract — when each Retell-shaped event fires, what it carries, and
 * the post-call work (recording upload, analysis pass) that has to finish before
 * `call_analyzed` goes out.
 *
 * Relative imports only (reachable from vite.config.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeCall } from "./analysis";
import { CallRecorder } from "./recording";
import { formatTranscript, mergeTurns, toTranscriptObject } from "./transcript";
import { emitVoiceEvent } from "./webhook";
import type {
  AnalysisField,
  DisconnectionReason,
  RetellCallAnalysis,
  RetellShapedCall,
  TranscriptTurn,
  VoiceLifecycleEvent,
  VoiceWebhookPayload,
} from "./types";

/** Retell fires `transcript_updated` continuously; this is a sane floor. */
const TRANSCRIPT_THROTTLE_MS = 2_000;

export interface NativeCallIdentity {
  /** Reused as Retell's `call_id`, so it lands in `calls.retell_call_id`. */
  callId: string;
  /** The WEBEE agent UUID. `resolveAgent()` matches native ids against it. */
  agentId: string | null;
  agentName?: string | null;
  workspaceId: string | null;
  callType: "phone_call" | "web_call";
  direction: "inbound" | "outbound";
  fromNumber?: string | null;
  toNumber?: string | null;
  metadata?: Record<string, unknown>;
  dynamicVariables?: Record<string, string>;
  /** The agent's `post_call_analysis_data` schema. */
  analysisSchema?: AnalysisField[];
  analysisModel?: string | null;
  successCriteria?: string | null;
  /** Blended engine cost, used to report `call_cost`. */
  costCentsPerMinute?: number | null;
}

export interface NativeCallLifecycleDeps {
  /** Service-role client for the recording upload. Omit to skip recording. */
  sb?: SupabaseClient | null;
  recorder?: CallRecorder | null;
  logPrefix?: string;
  /** Test seams. */
  emit?: (payload: VoiceWebhookPayload) => Promise<unknown>;
  analyze?: typeof analyzeCall;
  now?: () => number;
}

export class NativeCallLifecycle {
  private readonly identity: NativeCallIdentity;
  private readonly deps: NativeCallLifecycleDeps;
  private readonly logPrefix: string;
  private readonly now: () => number;
  private readonly turns: TranscriptTurn[] = [];

  private startedAt: number;
  private endedAt: number | null = null;
  /** Mutable because rates are loaded asynchronously, after the call is up. */
  private costCentsPerMinute: number | null;
  /** Null until the first live transcript event has gone out. */
  private lastTranscriptEmit: number | null = null;
  private lastTranscriptText = "";
  private transferTarget: string | null = null;
  private finished = false;

  constructor(identity: NativeCallIdentity, deps: NativeCallLifecycleDeps = {}) {
    this.identity = identity;
    this.deps = deps;
    this.logPrefix = deps.logPrefix ?? "[voice-lifecycle]";
    this.now = deps.now ?? Date.now;
    this.startedAt = this.now();
    this.costCentsPerMinute = identity.costCentsPerMinute ?? null;
  }

  /**
   * Set the engine's blended rate, in USD cents per minute.
   *
   * Only read when the call ends, so arriving mid-call is fine — which it has to
   * be, since the rate comes from a database read that must not delay answering.
   */
  setCostCentsPerMinute(cents: number | null): void {
    this.costCentsPerMinute = cents;
  }

  get recorder(): CallRecorder | null {
    return this.deps.recorder ?? null;
  }

  get transcriptTurns(): TranscriptTurn[] {
    return mergeTurns(this.turns);
  }

  /** Call once the media path is up. Resets the clock to the connect moment. */
  started(): void {
    this.startedAt = this.now();
    this.fire("call_started", { call_status: "registered" });
  }

  addTurn(role: TranscriptTurn["role"], text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.turns.push({ role, text: trimmed, ts: this.now() });
    this.maybeEmitTranscript();
  }

  recordCaller(pcm: Int16Array, sampleRate: number): void {
    this.recorder?.writeCaller(pcm, sampleRate);
  }

  recordAgent(pcm: Int16Array, sampleRate: number): void {
    this.recorder?.writeAgent(pcm, sampleRate);
  }

  agentStoppedSpeaking(): void {
    this.recorder?.agentStoppedSpeaking();
  }

  /**
   * A warm/cold transfer happened.
   *
   * Emitted as its own event because CRM and executive reporting treat a
   * transferred call differently from one the agent completed alone.
   */
  transferred(target: string): void {
    this.transferTarget = target;
    this.fire("call_transferred", {
      call_status: "ended",
      disconnection_reason: "call_transfer",
      metadata: { ...this.baseMetadata(), transfer_target: target },
    });
  }

  /**
   * The call could not be completed. Terminal: no analysis pass follows, since
   * there is nothing to analyse and the downstream failure paths only read the
   * disconnection reason.
   */
  async failed(reason: DisconnectionReason, detail?: string): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.endedAt = this.now();
    await this.fireAndWait("call_failed", {
      call_status: "error",
      disconnection_reason: reason,
      metadata: detail ? { ...this.baseMetadata(), error: detail } : this.baseMetadata(),
    });
  }

  mergeDynamicVariables(values: Record<string, string>): void {
    this.identity.dynamicVariables = {
      ...(this.identity.dynamicVariables ?? {}),
      ...values,
    };
  }

  /**
   * Normal end of call: emit `call_ended`, then upload the recording, run the
   * analysis pass and emit `call_analyzed`.
   *
   * `call_ended` is awaited before `call_analyzed` is sent, and that ordering is
   * load-bearing. Both events upsert the same `calls` row and `call_ended`
   * carries no analysis, so if it landed second it would overwrite the summary,
   * sentiment and success flags with nulls.
   */
  async ended(reason: DisconnectionReason = "user_hangup"): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.endedAt = this.now();
    const disconnection = this.transferTarget ? "call_transfer" : reason;

    await this.fireAndWait("call_ended", {
      call_status: "ended",
      disconnection_reason: disconnection,
    });

    // Independent work, so run both and let neither failure block the other.
    const [recordingUrl, analysis] = await Promise.all([
      this.uploadRecording(),
      this.runAnalysis(disconnection),
    ]);

    await this.fireAndWait("call_analyzed", {
      call_status: "ended",
      disconnection_reason: disconnection,
      recording_url: recordingUrl,
      call_analysis: analysis,
    });
  }

  private async uploadRecording(): Promise<string | null> {
    const { sb } = this.deps;
    const recorder = this.recorder;
    if (!sb || !recorder || !this.identity.workspaceId) return null;
    return recorder.upload(sb, {
      workspaceId: this.identity.workspaceId,
      callId: this.identity.callId,
    });
  }

  private async runAnalysis(disconnection: string): Promise<RetellCallAnalysis> {
    const analyze = this.deps.analyze ?? analyzeCall;
    try {
      return await analyze({
        turns: this.turns,
        agentName: this.identity.agentName ?? null,
        successCriteria: this.identity.successCriteria ?? null,
        schema: this.identity.analysisSchema ?? [],
        model: this.identity.analysisModel ?? null,
        durationSeconds: this.durationSeconds(),
        disconnectionReason: disconnection,
      });
    } catch (err) {
      console.warn(
        `${this.logPrefix} analysis threw, emitting call_analyzed without it:`,
        err instanceof Error ? err.message : err,
      );
      return {};
    }
  }

  /**
   * Live transcript for the in-call UI.
   *
   * Throttled and change-gated: this event fires per utterance, is display-only,
   * and is deliberately excluded from the calls table, so sending one per token
   * would be pure load.
   */
  private maybeEmitTranscript(): void {
    if (this.identity.callType === "web_call") return;
    const now = this.now();
    // The first line always goes out: the live call card would otherwise sit
    // empty for the length of the throttle window.
    if (
      this.lastTranscriptEmit !== null &&
      now - this.lastTranscriptEmit < TRANSCRIPT_THROTTLE_MS
    ) {
      return;
    }
    const text = formatTranscript(this.turns);
    if (text === this.lastTranscriptText) return;
    this.lastTranscriptEmit = now;
    this.lastTranscriptText = text;
    this.fire("transcript_updated", { call_status: "ongoing" });
  }

  private durationSeconds(): number {
    return Math.max(0, Math.round(((this.endedAt ?? this.now()) - this.startedAt) / 1000));
  }

  private baseMetadata(): Record<string, unknown> {
    return {
      // Tells the processor and analytics which engine produced the call.
      engine: "webee_native",
      workspace_id: this.identity.workspaceId ?? undefined,
      ...(this.identity.metadata ?? {}),
    };
  }

  private buildCall(overrides: Partial<RetellShapedCall>): RetellShapedCall {
    const turns = mergeTurns(this.turns);
    const durationSeconds = this.durationSeconds();
    const call: RetellShapedCall = {
      call_id: this.identity.callId,
      agent_id: this.identity.agentId ?? "",
      agent_name: this.identity.agentName ?? null,
      call_type: this.identity.callType,
      call_status: "ongoing",
      direction: this.identity.direction,
      from_number: this.identity.fromNumber ?? null,
      to_number: this.identity.toNumber ?? null,
      start_timestamp: this.startedAt,
      transcript: formatTranscript(turns),
      transcript_object: toTranscriptObject(turns),
      metadata: this.baseMetadata(),
      ...overrides,
    };

    if (this.identity.dynamicVariables) {
      call.retell_llm_dynamic_variables = this.identity.dynamicVariables;
    }
    if (this.endedAt) {
      call.end_timestamp = this.endedAt;
      call.duration_ms = this.endedAt - this.startedAt;
    }
    const perMinute = this.costCentsPerMinute;
    if (perMinute != null && this.endedAt) {
      call.call_cost = {
        combined_cost: Number(((durationSeconds / 60) * perMinute).toFixed(4)),
        total_duration_seconds: durationSeconds,
      };
    }
    return call;
  }

  /** Fire-and-forget: never delays audio or teardown. */
  private fire(event: VoiceLifecycleEvent, overrides: Partial<RetellShapedCall>): void {
    void this.fireAndWait(event, overrides);
  }

  private async fireAndWait(
    event: VoiceLifecycleEvent,
    overrides: Partial<RetellShapedCall>,
  ): Promise<void> {
    // Without an agent the processor can only answer "unknown agent", so the
    // request would be pure overhead.
    if (!this.identity.agentId) {
      console.warn(`${this.logPrefix} skipping ${event}: call has no agent id`);
      return;
    }
    const payload: VoiceWebhookPayload = { event, call: this.buildCall(overrides) };
    const emit = this.deps.emit ?? emitVoiceEvent;
    try {
      await emit(payload);
    } catch (err) {
      console.warn(
        `${this.logPrefix} ${event} emit threw:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
