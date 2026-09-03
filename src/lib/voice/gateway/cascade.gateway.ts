/**
 * Cascade gateway — browser <-> the WEBEE native voice engine.
 *
 * This is only the WebSocket protocol: the conversation itself (VAD, STT, graph
 * VM or flat prompt, TTS, barge-in, latency accounting) lives in CascadeSession,
 * which the WEBEE_NATIVE phone bridge drives the same way.
 *
 * Protocol (browser <-> relay):
 *   browser -> { type: "session.init", voiceId, systemPrompt, beginMessage, model,
 *                ttsProvider?, sttProvider?, agentId?, flow?, variables?, sessionId? }
 *   browser -> { type: "audio.chunk", data: "<base64 PCM16 24kHz mono>" }
 *   browser -> { type: "dtmf", digit } | { type: "playback.done" } | { type: "ping" }
 *   relay   -> { type: "relay.connected", mode: "graph"|"flat", stt, tts, vad }
 *   relay   -> { type: "transcript", role: "user"|"agent", text }
 *   relay   -> { type: "transcript.partial", text }
 *   relay   -> { type: "audio.delta", data: "<base64 PCM16 24kHz mono>", responseId, turnId? }
 *   relay   -> { type: "response.start", responseId, turnId?, nodeId? }
 *   relay   -> { type: "response.cancelled", responseId, reason }
 *   relay   -> { type: "audio.clear" }   // barge-in: drop queued playback NOW
 *   relay   -> { type: "response.done" } | { type: "pong" }
 *   relay   -> { type: "call.ended", reason } | { type: "relay.error", message }
 */
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { CascadeSession, type CascadeTransport } from "./cascade-session";
import { makeSupabaseAdmin, readAnalysisSchema } from "./telephony-core";
import { CASCADE_SAMPLE_RATE, parseSttProviderName } from "../stt";
import { resolveWebeeLlmProvider, resolveWebeeSpeechModel } from "../webee-native.shared";
import { resolveVoiceLlmApiKey } from "../llm/gpt";
import type { TtsProviderName } from "../tts";
import { NativeCallLifecycle } from "../lifecycle/call-lifecycle";
import { loadNativeCostCentsPerMinute } from "../lifecycle/cost";
import { CallRecorder } from "../lifecycle/recording";
import type { VariableValue } from "../graph/types";
import type { VoiceGatewayContext, VoiceGatewayRoute } from "./types";

const RELAY_PATH = "/api/el-voice-relay";
const LOG = "[cascade-gateway]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeSend(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function handleConnection(ws: WebSocket, _ctx: VoiceGatewayContext): void {
  let session: CascadeSession | null = null;
  let callerAudioChunks = 0;

  const transport: CascadeTransport = {
    sendAudio: (pcm, meta) =>
      safeSend(ws, {
        type: "audio.delta",
        data: pcm.toString("base64"),
        responseId: meta.responseId,
        turnId: meta.turnId,
      }),
    clearAudio: () => safeSend(ws, { type: "audio.clear" }),
    onResponseStart: (meta) =>
      safeSend(ws, {
        type: "response.start",
        responseId: meta.responseId,
        turnId: meta.turnId,
        nodeId: meta.nodeId,
      }),
    onResponseCancelled: (responseId, reason) =>
      safeSend(ws, { type: "response.cancelled", responseId, reason }),
    onTranscript: (role, text) => safeSend(ws, { type: "transcript", role, text }),
    onPartialTranscript: (text, role) =>
      safeSend(ws, { type: "transcript.partial", text, role: role ?? "user" }),
    onResponseDone: () => safeSend(ws, { type: "response.done" }),
    onEnd: (reason) => safeSend(ws, { type: "call.ended", reason }),
    onError: (message) => safeSend(ws, { type: "relay.error", message }),
    onNodeActive: (nodeId) => safeSend(ws, { type: "node.active", nodeId }),
    onToolCall: (toolId, result, ok) =>
      safeSend(ws, { type: "tool.result", toolId, result, ok }),
  };

  function startSession(msg: Record<string, unknown>): void {
    // The browser's session id becomes the reported call id, so a test call in
    // the UI and its stored row are the same call.
    const callId = msg.sessionId ? String(msg.sessionId) : randomUUID();
    const agentId = msg.agentId ? String(msg.agentId) : null;

    const settings = isRecord(msg.settings) ? (msg.settings as Record<string, unknown>) : null;
    const llmProvider = resolveWebeeLlmProvider(settings);
    session = new CascadeSession(transport, {
      callId,
      apiKey: resolveVoiceLlmApiKey(undefined, llmProvider),
      voiceId: String(msg.voiceId ?? ""),
      model: resolveWebeeSpeechModel(
        settings ?? (msg.model ? { model: msg.model } : null),
      ),
      systemPrompt: String(msg.systemPrompt ?? ""),
      beginMessage: String(msg.beginMessage ?? "").trim(),
      sampleRate: CASCADE_SAMPLE_RATE,
      logPrefix: LOG,
      playback: "reported",
      ttsProvider: msg.ttsProvider ? (String(msg.ttsProvider) as TtsProviderName) : null,
      sttProvider: parseSttProviderName(msg.sttProvider),
      agentId,
      supabase: agentId ? makeSupabaseAdmin() : null,
      flow: msg.flow,
      variables: (msg.variables ?? {}) as Record<string, VariableValue>,
      startSpeaker:
        msg.startSpeaker === "agent" || msg.startSpeaker === "user"
          ? msg.startSpeaker
          : undefined,
      speechLanguages: Array.isArray(msg.speechLanguages)
        ? (msg.speechLanguages as string[])
        : msg.speechLanguages
          ? [String(msg.speechLanguages)]
          : undefined,
      silenceDurationMs:
        typeof msg.silenceDurationMs === "number" ? msg.silenceDurationMs : undefined,
      responsiveness: typeof msg.responsiveness === "number" ? msg.responsiveness : undefined,
      interruptionSensitivity:
        typeof msg.interruptionSensitivity === "number" ? msg.interruptionSensitivity : undefined,
      boostedKeywords: Array.isArray(msg.boostedKeywords)
        ? (msg.boostedKeywords as string[])
        : undefined,
      settings,
      // Only saved agents are reported: an unsaved builder flow has no row to
      // report against.
      resolveLifecycle: (runtime) => {
        if (!runtime?.agent) return null;
        const sb = makeSupabaseAdmin();
        const lifecycle = new NativeCallLifecycle(
          {
            callId,
            agentId: runtime.agent.id,
            agentName: runtime.agent.name,
            workspaceId: runtime.agent.workspaceId,
            // Browser calls are test calls. The webhook processor filters them
            // out of analytics unless RETELL_STORE_WEB_CALLS is set, which is
            // what we want: a builder test must not look like customer traffic.
            callType: "web_call",
            direction: "outbound",
            fromNumber: "web",
            toNumber: "web:test",
            analysisSchema: readAnalysisSchema(runtime.settings),
            analysisModel: (runtime.settings.postCallAnalysisModel as string | undefined) ?? null,
            successCriteria: (runtime.settings.successCriteria as string | undefined) ?? null,
          },
          { sb, recorder: new CallRecorder(), logPrefix: LOG },
        );
        lifecycle.started();
        // A test call burns the same providers a real one does, so it is priced
        // the same way. Not awaited: the greeting must not wait on a rate lookup.
        void loadNativeCostCentsPerMinute(sb)
          .then((cents) => lifecycle.setCostCentsPerMinute(cents))
          .catch(() => {});
        return lifecycle;
      },
    });

    session
      .prepare()
      .then((banner) => {
        safeSend(ws, { type: "relay.connected", ...banner });
        return session!.beginConversation();
      })
      .catch((err: Error) => {
        console.error(`${LOG} session start failed: ${err.message}`);
        safeSend(ws, { type: "relay.error", message: err.message });
      });
  }

  ws.on("message", (raw: import("ws").RawData) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    // Keepalive: without traffic the reverse proxy closes the socket while
    // pre-buffered audio drains in the browser (up to ~15 s of silence).
    if (msg.type === "ping") {
      safeSend(ws, { type: "pong" });
      return;
    }

    if (msg.type === "playback.done") {
      console.log(`${LOG} playback.done received`);
      session?.playbackDone();
      return;
    }

    if (msg.type === "session.init") {
      startSession(msg);
      return;
    }

    if (msg.type === "dtmf") {
      session?.submitDigit(String(msg.digit ?? ""));
      return;
    }

    if (msg.type === "audio.chunk") {
      const pcm = Buffer.from(String(msg.data ?? ""), "base64");
      callerAudioChunks += 1;
      if (callerAudioChunks === 1) {
        console.log(`${LOG} first caller audio chunk (${pcm.byteLength} bytes)`);
      } else if (callerAudioChunks % 100 === 0) {
        console.log(`${LOG} caller audio chunks=${callerAudioChunks}`);
      }
      session?.pushCallerAudio(pcm);
      return;
    }
  });

  ws.on("close", () => {
    session?.close();
    // Idempotent, so a graph that already ended the call does not report twice.
    void session?.lifecycle?.ended("user_hangup");
    console.log(`${LOG} connection closed`);
  });
  ws.on("error", (e: Error) => {
    console.error(`${LOG} WS error: ${e.message}`);
  });
}

export const cascadeRoute: VoiceGatewayRoute = {
  name: "cascade",
  match: (pathname) => (pathname === RELAY_PATH ? {} : null),
  preflight: () => {
    const missing = [
      !process.env.OPENAI_API_KEY && !process.env.CEREBRAS_API_KEY && "OPENAI_API_KEY or CEREBRAS_API_KEY",
      !process.env.FISH_API_KEY && "FISH_API_KEY",
    ].filter(Boolean);
    return missing.length ? `Missing: ${missing.join(", ")}` : null;
  },
  onConnection: handleConnection,
};
