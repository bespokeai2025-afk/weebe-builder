/**
 * FreJun telephony bridge (regional carrier).
 *
 * FreJun sends linear PCM16 rather than mu-law, either as raw binary frames or
 * base64 inside a JSON `media` event, at a fixed 16 kHz. Otherwise the call
 * lifecycle is identical to Twilio, so everything except the wire format comes
 * from telephony-core — including the choice of engine: WEBEE_NATIVE agents run
 * the cascade session, everything else runs OpenAI Realtime.
 *
 * Extracted from frejun-stream.plugin.ts, which only ran under `vite dev`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { WebSocket, type RawData } from "ws";
import { base64ToPcm16, pcm16ToBase64, pcm16ToBuffer, resample } from "./audio";
import { CascadeSession, type CascadeTransport } from "./cascade-session";
import {
  connectRealtimeForCall,
  createCallLifecycle,
  finalizeCall,
  loadCallAgentConfig,
  makeSupabaseAdmin,
  markCallAnswered,
  persistTranscript,
  type CallAgentConfig,
  type TranscriptEntry,
} from "./telephony-core";
import { isWebeeNativeMode } from "../../runtime/adapter";
import type { VoiceGatewayContext, VoiceGatewayRoute } from "./types";

const STREAM_PATH = /^\/api\/frejun\/stream\/([a-zA-Z0-9-]+)$/;
const LOG = "[frejun-stream]";
const FREJUN_RATE = 16000;
const REALTIME_RATE = 24000;

/** Normalise any `ws` frame payload into a single Buffer. */
function toBuffer(raw: RawData): Buffer | null {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  if (raw instanceof ArrayBuffer) return Buffer.from(new Uint8Array(raw));
  return null;
}

/** ASCII '{' — the first byte of a JSON control frame. */
const JSON_OPEN_BRACE = 0x7b;

/**
 * Extract PCM16 samples from either a raw binary frame or a JSON media event.
 *
 * The frame type cannot be used to tell these apart: `ws` hands every payload
 * to the listener as a Buffer, including text frames. The previous code
 * therefore matched `Buffer.isBuffer` first and never reached its JSON branch,
 * so a base64 `media` event would have been played as if it were raw PCM —
 * i.e. as noise. Sniffing the leading byte handles both shapes.
 */
function decodeInboundAudio(raw: RawData): Int16Array | null {
  const buf = toBuffer(raw);
  if (!buf || buf.byteLength === 0) return null;

  if (buf[0] === JSON_OPEN_BRACE) {
    try {
      const msg = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
      if (msg.event === "media" && typeof msg.payload === "string") {
        const pcm = base64ToPcm16(msg.payload);
        return pcm.length > 0 ? pcm : null;
      }
      // Any other control event carries no audio.
      return null;
    } catch {
      // Not JSON after all; fall through and treat the bytes as PCM.
    }
  }

  const sampleCount = Math.floor(buf.byteLength / 2);
  if (sampleCount === 0) return null;
  return new Int16Array(buf.buffer, buf.byteOffset, sampleCount);
}

/**
 * WEBEE native engine over FreJun.
 *
 * The pipeline runs at FreJun's own 16 kHz, which is also a rate every provider
 * in the cascade accepts, so no resampling is needed in either direction.
 *
 * FreJun has no "discard buffered audio" control, so an interrupted reply stops
 * being generated but whatever already reached the carrier still plays. Barge-in
 * is therefore softer here than on Twilio; the alternative is not detecting
 * interruptions at all.
 */
async function runCascadeBridge(
  ws: WebSocket,
  callId: string,
  sb: SupabaseClient,
  config: CallAgentConfig,
): Promise<void> {
  const transcript: TranscriptEntry[] = [];
  const lifecycle = createCallLifecycle(sb, callId, config, { logPrefix: LOG });

  await markCallAnswered(sb, callId);
  lifecycle.started();

  const transport: CascadeTransport = {
    sendAudio: (pcm) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
    },
    clearAudio: () => {},
    onTranscript: (role, text) => {
      transcript.push({ role, text, ts: Date.now() });
      void persistTranscript(sb, callId, transcript).catch(() => {});
    },
    onEnd: (reason) => {
      console.log(`${LOG} graph ended callId=${callId} reason=${reason}`);
      setTimeout(() => ws.close(1000, "call ended"), 4000);
    },
    onError: (message) => console.error(`${LOG} cascade error callId=${callId}: ${message}`),
  };

  const session = new CascadeSession(transport, {
    callId,
    apiKey: process.env.OPENAI_API_KEY ?? "",
    voiceId: config.voiceId,
    model: String(config.settings.model ?? "gpt-4.1"),
    systemPrompt: config.systemPrompt,
    sampleRate: FREJUN_RATE,
    logPrefix: LOG,
    playback: "estimated",
    agentId: config.agentId,
    supabase: sb,
    settings: config.settings,
    resolveLifecycle: () => lifecycle,
  });

  await session.start().catch((err: Error) => {
    console.error(`${LOG} cascade start failed callId=${callId}: ${err.message}`);
    void lifecycle.failed("error_llm_websocket_open", err.message);
    ws.close(1011, "engine unavailable");
  });

  ws.on("message", (raw: RawData) => {
    const pcmIn = decodeInboundAudio(raw);
    if (pcmIn) session.pushCallerAudio(pcm16ToBuffer(pcmIn));
  });

  ws.on("close", () => {
    console.log(`${LOG} cascade WS closed callId=${callId}`);
    session.close();
    void finalizeCall(sb, callId, config.workspaceId, transcript);
    void lifecycle.ended("user_hangup");
  });

  ws.on("error", (err: Error) => {
    console.error(`${LOG} FreJun WS error callId=${callId}:`, err.message);
  });
}

async function runRealtimeBridge(
  ws: WebSocket,
  callId: string,
  sb: SupabaseClient,
  config: CallAgentConfig,
): Promise<void> {
  const transcript: TranscriptEntry[] = [];
  const lifecycle = createCallLifecycle(sb, callId, config, { logPrefix: LOG });

  let mirrored = 0;
  const mirrorTranscript = () => {
    for (; mirrored < transcript.length; mirrored++) {
      lifecycle.addTurn(transcript[mirrored].role, transcript[mirrored].text);
    }
  };

  await markCallAnswered(sb, callId);
  lifecycle.started();

  const openaiWs = connectRealtimeForCall({
    callId,
    config,
    logPrefix: LOG,
    transcript,
    onTranscriptUpdate: () => {
      mirrorTranscript();
      void persistTranscript(sb, callId, transcript).catch(() => {});
    },
    onFatalError: (detail) => {
      void lifecycle.failed("error_llm_websocket_open", detail);
    },
    onAudio: (pcm24) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const pcmOut = resample(pcm24, REALTIME_RATE, FREJUN_RATE);
      lifecycle.recordAgent(pcmOut, FREJUN_RATE);
      ws.send(Buffer.from(pcmOut.buffer, pcmOut.byteOffset, pcmOut.byteLength));
    },
  });

  ws.on("message", (raw: RawData) => {
    if (openaiWs.readyState !== WebSocket.OPEN) return;
    const pcmIn = decodeInboundAudio(raw);
    if (!pcmIn) return;

    lifecycle.recordCaller(pcmIn, FREJUN_RATE);
    const pcm24 = resample(pcmIn, FREJUN_RATE, REALTIME_RATE);
    openaiWs.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: pcm16ToBase64(pcm24),
      }),
    );
  });

  ws.on("close", () => {
    console.log(`${LOG} FreJun WS closed callId=${callId}`);
    openaiWs.close();
    mirrorTranscript();
    void finalizeCall(sb, callId, config.workspaceId, transcript);
    void lifecycle.ended("user_hangup");
  });

  ws.on("error", (err: Error) => {
    console.error(`${LOG} FreJun WS error callId=${callId}:`, err.message);
  });
}

async function handleFreJunStream(ws: WebSocket, callId: string): Promise<void> {
  console.log(`${LOG} FreJun connected callId=${callId}`);
  const sb = makeSupabaseAdmin();
  const config = await loadCallAgentConfig(sb, callId, LOG);

  if (isWebeeNativeMode(config.deploymentMode)) {
    console.log(`${LOG} engine=webee_native callId=${callId}`);
    return runCascadeBridge(ws, callId, sb, config);
  }
  return runRealtimeBridge(ws, callId, sb, config);
}

export const frejunRoute: VoiceGatewayRoute = {
  name: "frejun",
  match: (pathname) => {
    const m = STREAM_PATH.exec(pathname);
    return m ? { callId: m[1] } : null;
  },
  preflight: () => (process.env.OPENAI_API_KEY ? null : "OPENAI_API_KEY not configured"),
  onConnection: (ws: WebSocket, ctx: VoiceGatewayContext) => {
    handleFreJunStream(ws, ctx.params.callId).catch((err) => {
      console.error(`${LOG} handler error:`, err);
      ws.close(1011, "gateway error");
    });
  },
};
