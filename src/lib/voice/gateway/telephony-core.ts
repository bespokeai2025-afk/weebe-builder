/**
 * Shared telephony call plumbing for the Twilio and FreJun gateways.
 *
 * Both carriers need the same things — resolve the call row, compile the agent's
 * flow into a prompt, open a Realtime session, accumulate a transcript, update
 * call status — and differ only in their audio wire format. That common half
 * used to be copy-pasted between the two plugins, which is how they drifted into
 * carrying the same three bugs (retired model, beta header, pre-GA schema).
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";
import { compileRealtimePrompt } from "../../builder/compile-realtime-prompt";
import { isWebeeNativeMode, resolveDeploymentMode } from "../../runtime/adapter";
import type { DeploymentMode } from "../../runtime/types";
import { loadNativeCostCentsPerMinute } from "../lifecycle/cost";
import { NativeCallLifecycle } from "../lifecycle/call-lifecycle";
import { CallRecorder } from "../lifecycle/recording";
import type { AnalysisField } from "../lifecycle/types";
import {
  buildSessionUpdate,
  isAgentTranscriptDoneEvent,
  isAudioDeltaEvent,
  isUserTranscriptDoneEvent,
  openRealtimeSocket,
  resolveRealtimeModel,
  type TurnDetectionMode,
} from "./realtime-session";

const DEFAULT_PROMPT = "You are a helpful AI voice assistant. Be concise and natural.";
const DEFAULT_VOICE = "alloy";

export interface TranscriptEntry {
  role: "agent" | "user";
  text: string;
  ts: number;
}

export interface CallAgentConfig {
  agentId: string | null;
  agentName: string | null;
  workspaceId: string | null;
  systemPrompt: string;
  voiceId: string;
  model: string;
  turnDetection: TurnDetectionMode;
  /** Carrier-level facts, needed to report the call in Retell's shape. */
  direction: "inbound" | "outbound";
  fromNumber: string | null;
  toNumber: string | null;
  campaignId: string | null;
  /** The agent's `post_call_analysis_data` schema. */
  analysisSchema: AnalysisField[];
  analysisModel: string | null;
  successCriteria: string | null;
  /**
   * Which engine runs this call. WEBEE_NATIVE takes the cascade bridge (graph VM
   * + Fish TTS); every other mode takes the Realtime bridge.
   */
  deploymentMode: DeploymentMode;
  /** Raw agent settings, for engine-specific options. */
  settings: Record<string, unknown>;
}

/** Service-role client: gateways run outside any user session. */
export function makeSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Resolve everything needed to run a call from its `telephony_calls` row.
 *
 * Falls back to a generic assistant prompt rather than failing the call, since
 * a caller is already connected by the time this runs.
 */
export async function loadCallAgentConfig(
  sb: SupabaseClient,
  callId: string,
  logPrefix: string,
): Promise<CallAgentConfig> {
  const config: CallAgentConfig = {
    agentId: null,
    agentName: null,
    workspaceId: null,
    systemPrompt: DEFAULT_PROMPT,
    voiceId: DEFAULT_VOICE,
    model: resolveRealtimeModel(null),
    turnDetection: "semantic_vad",
    direction: "inbound",
    fromNumber: null,
    toNumber: null,
    campaignId: null,
    analysisSchema: [],
    analysisModel: null,
    successCriteria: null,
    deploymentMode: "RETELL",
    settings: {},
  };

  const { data: callRow } = await sb
    .from("telephony_calls")
    .select("agent_id, workspace_id, direction, from_number, to_number, campaign_id")
    .eq("id", callId)
    .maybeSingle();

  config.agentId = (callRow?.agent_id as string | null) ?? null;
  config.workspaceId = (callRow?.workspace_id as string | null) ?? null;
  config.direction = (callRow?.direction as string | null) === "outbound" ? "outbound" : "inbound";
  config.fromNumber = (callRow?.from_number as string | null) ?? null;
  config.toNumber = (callRow?.to_number as string | null) ?? null;
  config.campaignId = (callRow?.campaign_id as string | null) ?? null;
  if (!config.agentId) return config;

  const { data: agentRow } = await sb
    .from("agents")
    .select("name, flow_data, settings")
    .eq("id", config.agentId)
    .maybeSingle();
  if (!agentRow) return config;

  const settings = (agentRow.settings as Record<string, unknown>) ?? {};
  config.settings = settings;
  config.deploymentMode = resolveDeploymentMode(settings as never);
  config.agentName = (agentRow.name as string | null) ?? null;
  // The native cascade sends this to Fish Audio as `reference_id`, so it needs
  // the Fish model id rather than the OmniVoice/Realtime voice name.
  config.voiceId = isWebeeNativeMode(config.deploymentMode)
    ? ((settings.webeeVoiceId as string | undefined) ?? "")
    : ((settings.voice_id as string | undefined) ?? DEFAULT_VOICE);
  config.analysisSchema = readAnalysisSchema(settings);
  config.analysisModel = (settings.postCallAnalysisModel as string | undefined) ?? null;
  config.successCriteria = (settings.successCriteria as string | undefined) ?? null;
  // Stored model ids may be retired preview aliases, so always re-resolve.
  config.model = resolveRealtimeModel(settings.openai_model);
  if (settings.hyperstreamTurnDetection === "server_vad") {
    config.turnDetection = "server_vad";
  }

  // Use the same flow-graph compiler the browser relay uses so phone calls get
  // the turn-taking rules, knowledge base and begin message — not just raw node
  // text, which makes the agent race through the script.
  try {
    const flowData = (agentRow.flow_data as Record<string, unknown>) ?? {};
    const compiled = compileRealtimePrompt(
      (flowData.nodes ?? []) as never,
      (flowData.edges ?? []) as never,
      settings as never,
      (flowData.variables ?? settings.variables ?? []) as never,
    );
    if (compiled?.trim()) config.systemPrompt = compiled;
  } catch (err) {
    console.warn(`${logPrefix} compileRealtimePrompt failed, using fallback:`, err);
    const nodes =
      ((agentRow.flow_data as Record<string, unknown>)?.nodes as Array<{
        data?: Record<string, unknown>;
      }>) ?? [];
    const textNodes = nodes
      .filter((n) => n.data?.kind === "conversation" || n.data?.kind === "start")
      .map((n) => n.data?.dialogue ?? n.data?.prompt ?? n.data?.message ?? "")
      .filter(Boolean)
      .join("\n\n");
    if (textNodes) config.systemPrompt = String(textNodes);
  }

  return config;
}

/**
 * Read the post-call extraction schema out of an agent's settings.
 *
 * Two sources, because agents reach the DB by two routes: ones imported from
 * Retell keep the raw `post_call_analysis_data`, while ones built in the builder
 * only have `variables`, which the exporter turns into that same array. Reading
 * both means native calls extract the same fields the Retell path did.
 */
export function readAnalysisSchema(settings: Record<string, unknown>): AnalysisField[] {
  const raw = (settings.rawAgent as Record<string, unknown> | undefined)?.post_call_analysis_data;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((entry) => normalizeAnalysisField(entry as Record<string, unknown>));
  }

  const variables = settings.variables;
  if (!Array.isArray(variables)) return [];
  return variables
    .map((v) => v as Record<string, unknown>)
    .filter((v) => String(v.name ?? "").trim() && String(v.description ?? "").trim())
    .map((v) =>
      normalizeAnalysisField({
        name: v.name,
        description: v.description,
        type: v.type,
        // The builder stores a single `defaultValue`, which the exporter also
        // treats as the one example.
        examples: Array.isArray(v.examples)
          ? v.examples
          : v.defaultValue
            ? [v.defaultValue]
            : undefined,
      }),
    );
}

function normalizeAnalysisField(entry: Record<string, unknown>): AnalysisField {
  const declared = String(entry.type ?? "string");
  const examples = Array.isArray(entry.examples) ? entry.examples.map(String) : undefined;
  const choices = Array.isArray(entry.choices) ? entry.choices.map(String) : examples;
  // `system-presets` is a Retell UI type with no extraction semantics of its own,
  // and an enum with no choices cannot be validated against anything. Both become
  // free text, matching what the exporter does.
  const isEnum = declared === "enum" && Boolean(choices?.length);
  const type =
    declared === "number" || declared === "boolean" ? declared : isEnum ? "enum" : "string";
  return {
    name: String(entry.name ?? "").trim(),
    description: entry.description ? String(entry.description) : undefined,
    type,
    ...(isEnum ? { choices } : {}),
    ...(examples?.length ? { examples } : {}),
  };
}

/**
 * Build the lifecycle for a phone call.
 *
 * Recording is on by default: owning the media stream is the only chance to
 * capture it, and `calls.recording_url` is what the calls UI plays.
 */
export function createCallLifecycle(
  sb: SupabaseClient,
  callId: string,
  config: CallAgentConfig,
  options: { record?: boolean; logPrefix?: string } = {},
): NativeCallLifecycle {
  const lifecycle = new NativeCallLifecycle(
    {
      callId,
      agentId: config.agentId,
      agentName: config.agentName,
      workspaceId: config.workspaceId,
      callType: "phone_call",
      direction: config.direction,
      fromNumber: config.fromNumber,
      toNumber: config.toNumber,
      metadata: config.campaignId ? { campaign_id: config.campaignId } : undefined,
      analysisSchema: config.analysisSchema,
      analysisModel: config.analysisModel,
      successCriteria: config.successCriteria,
    },
    {
      sb,
      recorder: options.record === false ? null : new CallRecorder(),
      logPrefix: options.logPrefix ?? "[voice-lifecycle]",
    },
  );

  // Only the cascade's cost model applies to cascade calls; pricing a Realtime
  // call with Fish/Deepgram rates would be worse than reporting no cost. The
  // read is deliberately not awaited: nothing about answering a call should wait
  // on the cost table.
  if (isWebeeNativeMode(config.deploymentMode)) {
    void loadNativeCostCentsPerMinute(sb)
      .then((cents) => lifecycle.setCostCentsPerMinute(cents))
      .catch(() => {});
  }

  return lifecycle;
}

export interface RealtimeBridgeOptions {
  callId: string;
  config: CallAgentConfig;
  logPrefix: string;
  /** Called with each PCM16 24 kHz output chunk from the model. */
  onAudio: (pcm24: Int16Array) => void;
  transcript: TranscriptEntry[];
  /** Invoked when the agent finishes an utterance, for incremental persistence. */
  onTranscriptUpdate?: () => void;
  /**
   * The model connection failed, so the call cannot proceed.
   *
   * Reported separately from a normal hangup: a call that never got a brain is a
   * failure, and downstream retry logic keys off that distinction.
   */
  onFatalError?: (detail: string) => void;
}

/**
 * Open a Realtime session for a phone call.
 *
 * Audio is handed back as PCM16 at 24 kHz; the caller converts to whatever the
 * carrier expects.
 */
export function connectRealtimeForCall(options: RealtimeBridgeOptions): WebSocket {
  const { callId, config, logPrefix, onAudio, transcript } = options;
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  const oaiWs = openRealtimeSocket(apiKey, config.model);

  oaiWs.on("open", () => {
    oaiWs.send(
      buildSessionUpdate({
        instructions: config.systemPrompt,
        voice: config.voiceId,
        turnDetection: config.turnDetection,
        transcribe: true,
      }),
    );
    console.log(`${logPrefix} OpenAI connected callId=${callId} model=${config.model}`);
  });

  oaiWs.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    if (isAudioDeltaEvent(msg.type) && typeof msg.delta === "string") {
      const buf = Buffer.from(msg.delta, "base64");
      const sampleCount = Math.floor(buf.byteLength / 2);
      if (sampleCount > 0) {
        // byteOffset/length are required: Node pools small Buffers, so
        // `buf.buffer` alone is the whole pool, not just this chunk.
        onAudio(new Int16Array(buf.buffer, buf.byteOffset, sampleCount));
      }
      return;
    }

    if (isUserTranscriptDoneEvent(msg.type) && msg.transcript) {
      transcript.push({ role: "user", text: String(msg.transcript), ts: Date.now() });
      return;
    }

    if (isAgentTranscriptDoneEvent(msg.type) && msg.transcript) {
      transcript.push({ role: "agent", text: String(msg.transcript), ts: Date.now() });
      options.onTranscriptUpdate?.();
      return;
    }

    if (msg.type === "error") {
      console.error(`${logPrefix} OpenAI error:`, msg.error);
    }
  });

  oaiWs.on("close", (code, reason) => {
    console.log(`${logPrefix} OpenAI closed callId=${callId} ${code} ${reason}`);
  });
  oaiWs.on("error", (err: Error) => {
    console.error(`${logPrefix} OpenAI ws error:`, err.message);
    options.onFatalError?.(err.message);
  });

  return oaiWs;
}

export async function persistTranscript(
  sb: SupabaseClient,
  callId: string,
  transcript: TranscriptEntry[],
): Promise<void> {
  if (!callId || transcript.length === 0) return;
  await sb
    .from("telephony_calls")
    .update({ transcript, updated_at: new Date().toISOString() })
    .eq("id", callId);
}

export async function markCallAnswered(sb: SupabaseClient, callId: string): Promise<void> {
  await sb
    .from("telephony_calls")
    .update({ status: "answered", answered_at: new Date().toISOString() })
    .eq("id", callId);
}

/** Final bookkeeping when a call ends. Never throws. */
export async function finalizeCall(
  sb: SupabaseClient,
  callId: string,
  workspaceId: string | null,
  transcript: TranscriptEntry[],
): Promise<void> {
  await Promise.allSettled([
    persistTranscript(sb, callId, transcript),
    sb
      .from("telephony_calls")
      .update({ status: "completed", ended_at: new Date().toISOString() })
      .eq("id", callId),
    sb.from("call_events").insert({
      call_id: callId,
      workspace_id: workspaceId,
      event_type: "status_change",
      event_data: { from: "active", to: "completed" },
    }),
  ]);
}
