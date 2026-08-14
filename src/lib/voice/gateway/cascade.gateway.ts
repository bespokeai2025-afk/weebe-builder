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
 *   relay   -> { type: "audio.delta", data: "<base64 PCM16 24kHz mono>" }
 *   relay   -> { type: "audio.clear" }   // barge-in: drop queued playback NOW
 *   relay   -> { type: "response.done" } | { type: "pong" }
 *   relay   -> { type: "call.ended", reason } | { type: "relay.error", message }
 */
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { CascadeSession, type CascadeTransport } from "./cascade-session";
import { makeSupabaseAdmin, readAnalysisSchema } from "./telephony-core";
import { availableSttProviders, CASCADE_SAMPLE_RATE } from "../stt";
import { availableTtsProviders, type TtsProviderName } from "../tts";
import type { SttProviderName } from "../stt";
import { NativeCallLifecycle } from "../lifecycle/call-lifecycle";
import { loadNativeCostCentsPerMinute } from "../lifecycle/cost";
import { CallRecorder } from "../lifecycle/recording";
import type { VariableValue } from "../graph/types";
import type { VoiceGatewayContext, VoiceGatewayRoute } from "./types";

const RELAY_PATH = "/api/el-voice-relay";
const LOG = "[cascade-gateway]";

function safeSend(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function handleConnection(ws: WebSocket, _ctx: VoiceGatewayContext): void {
  let session: CascadeSession | null = null;

  const transport: CascadeTransport = {
    sendAudio: (pcm) => safeSend(ws, { type: "audio.delta", data: pcm.toString("base64") }),
    clearAudio: () => safeSend(ws, { type: "audio.clear" }),
    onTranscript: (role, text) => safeSend(ws, { type: "transcript", role, text }),
    onPartialTranscript: (text) => safeSend(ws, { type: "transcript.partial", text }),
    onResponseDone: () => safeSend(ws, { type: "response.done" }),
    onEnd: (reason) => safeSend(ws, { type: "call.ended", reason }),
    onError: (message) => safeSend(ws, { type: "relay.error", message }),
  };

  function startSession(msg: Record<string, unknown>): void {
    // The browser's session id becomes the reported call id, so a test call in
    // the UI and its stored row are the same call.
    const callId = msg.sessionId ? String(msg.sessionId) : randomUUID();
    const agentId = msg.agentId ? String(msg.agentId) : null;

    session = new CascadeSession(transport, {
      callId,
      apiKey: process.env.OPENAI_API_KEY!,
      voiceId: String(msg.voiceId ?? ""),
      model: String(msg.model ?? "gpt-4.1"),
      systemPrompt: String(msg.systemPrompt ?? ""),
      beginMessage: String(msg.beginMessage ?? "").trim(),
      sampleRate: CASCADE_SAMPLE_RATE,
      logPrefix: LOG,
      playback: "reported",
      ttsProvider: msg.ttsProvider ? (String(msg.ttsProvider) as TtsProviderName) : null,
      sttProvider: msg.sttProvider ? (String(msg.sttProvider) as SttProviderName) : null,
      agentId,
      supabase: agentId ? makeSupabaseAdmin() : null,
      flow: msg.flow,
      variables: (msg.variables ?? {}) as Record<string, VariableValue>,
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
      .start()
      .then((banner) => safeSend(ws, { type: "relay.connected", ...banner }))
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
      session?.pushCallerAudio(Buffer.from(String(msg.data ?? ""), "base64"));
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
    // The LLM needs OpenAI; STT needs Deepgram or OpenAI; TTS needs at least one
    // supported vendor.
    const missing = [
      !process.env.OPENAI_API_KEY && "OPENAI_API_KEY",
      availableSttProviders().length === 0 && "DEEPGRAM_API_KEY or OPENAI_API_KEY",
      availableTtsProviders().length === 0 && "FISH_API_KEY or ELEVENLABS_API_KEY",
    ].filter(Boolean);
    return missing.length ? `Missing: ${missing.join(", ")}` : null;
  },
  onConnection: handleConnection,
};
