/**
 * Twilio Media Streams bridge.
 *
 * Twilio dials one of our numbers, the inbound webhook answers with TwiML
 * <Connect><Stream url="wss://host/api/telephony/stream/:callId" />, and this
 * gateway bridges the audio for whichever engine the agent is set to:
 *
 *   WEBEE_NATIVE  -> CascadeSession: VAD -> STT -> graph VM -> Fish TTS, run
 *                    entirely at 8 kHz so no resampling touches the call.
 *   anything else -> OpenAI Realtime, with mu-law 8 kHz converted to PCM16
 *                    24 kHz in both directions.
 *
 * Extracted from telephony-stream.plugin.ts, which only ran under `vite dev` —
 * so inbound phone calls had no stream endpoint in production.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";
import {
  mulawBytesToPcm16,
  pcm16ToBase64,
  pcm16ToBuffer,
  pcm16ToMulawBase64,
  pcm16View,
  resample,
} from "./audio";
import { CascadeSession, type CascadeTransport } from "./cascade-session";
import { resolveWebeeLlmProvider, resolveWebeeSpeechModel } from "../webee-native.shared";
import { resolveVoiceLlmApiKey } from "../llm/gpt";
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
import type { NativeCallLifecycle } from "../lifecycle/call-lifecycle";
import type { VoiceGatewayContext, VoiceGatewayRoute } from "./types";
import type { TwilioCredentials } from "../../telephony/twilio-env";
import { resolveTwilioCredentialsForWorkspace } from "../../telephony/twilio-credentials.server";

const STREAM_PATH = /^\/api\/telephony\/stream\/([a-zA-Z0-9-]+)$/;
const LOG = "[tel-stream]";
const TWILIO_RATE = 8000;
const REALTIME_RATE = 24000;

/** Twilio's inbound `start` frame, reduced to what either bridge needs. */
function readStreamSid(msg: Record<string, unknown>): string {
  const start = msg.start as Record<string, unknown> | undefined;
  return String(start?.streamSid ?? msg.streamSid ?? "");
}

/**
 * Hand the live call to another number.
 *
 * Redirecting the parent call with new TwiML is the only transfer that survives
 * the media stream ending: the caller stays on the same PSTN leg while Twilio
 * dials the destination. Done over REST rather than the SDK because this module
 * is bundled for the gateway and the Twilio client pulls in a large tree.
 */
async function redirectTwilioCall(
  callSid: string,
  destination: string,
  credentials: TwilioCredentials,
): Promise<boolean> {
  const { accountSid: sid, authToken: token } = credentials;
  if (!sid || !token || !callSid) {
    console.warn(`${LOG} transfer skipped: missing Twilio credentials or call sid`);
    return false;
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${destination}</Dial></Response>`;
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls/${encodeURIComponent(callSid)}.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Twiml: twiml }).toString(),
    },
  ).catch((err: Error) => {
    console.error(`${LOG} transfer request failed: ${err.message}`);
    return null;
  });

  if (!res?.ok) {
    console.error(`${LOG} transfer rejected by Twilio: ${res?.status ?? "no response"}`);
    return false;
  }
  return true;
}

/**
 * WEBEE native engine over Twilio.
 *
 * Everything runs at the carrier's 8 kHz: mu-law decodes straight into the VAD
 * and the TTS renders straight back out to mu-law. That is not just cheaper than
 * bouncing through 24 kHz, it is more faithful — a round trip through
 * interpolation on a band-limited signal only adds error.
 */
async function runCascadeBridge(
  ws: WebSocket,
  callId: string,
  sb: SupabaseClient,
  config: CallAgentConfig,
): Promise<void> {
  let streamSid = "";
  let callSid = "";
  let session: CascadeSession | null = null;
  let lifecycle: NativeCallLifecycle | null = null;
  const transcript: TranscriptEntry[] = [];
  let twilioCredentials: TwilioCredentials | null = null;

  if (config.workspaceId) {
    try {
      twilioCredentials = await resolveTwilioCredentialsForWorkspace(sb, config.workspaceId);
    } catch (err) {
      console.warn(
        `${LOG} workspace Twilio credentials unavailable for transfer:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const persist = () => void persistTranscript(sb, callId, transcript).catch(() => {});

  const transport: CascadeTransport = {
    sendAudio: (pcm, _meta) => {
      if (ws.readyState !== WebSocket.OPEN || !streamSid) return;
      ws.send(
        JSON.stringify({
          event: "media",
          streamSid,
          media: { payload: pcm16ToMulawBase64(pcm16View(pcm)) },
        }),
      );
    },
    // Twilio buffers everything we send, so silencing the agent means telling it
    // to drop that buffer; stopping the stream at our end does nothing.
    clearAudio: () => {
      if (ws.readyState === WebSocket.OPEN && streamSid) {
        ws.send(JSON.stringify({ event: "clear", streamSid }));
      }
    },
    onTranscript: (role, text) => {
      transcript.push({ role, text, ts: Date.now() });
      persist();
    },
    onEnd: (reason) => {
      console.log(`${LOG} graph ended call=${callId} reason=${reason}`);
      // Hanging up immediately would cut off the goodbye still in Twilio's
      // buffer, so the socket closes once the audio has had time to play.
      setTimeout(() => ws.close(1000, "call ended"), 4000);
    },
    onError: (message) => console.error(`${LOG} cascade error call=${callId}: ${message}`),
    transferCall: (destination) => {
      if (!twilioCredentials) return Promise.resolve(false);
      return redirectTwilioCall(callSid, destination, twilioCredentials);
    },
  };

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg.event === "start") {
      streamSid = readStreamSid(msg);
      const start = msg.start as Record<string, unknown> | undefined;
      callSid = String(start?.callSid ?? "");
      void markCallAnswered(sb, callId);

      lifecycle = createCallLifecycle(sb, callId, config, { logPrefix: LOG });
      lifecycle.started();

      session = new CascadeSession(transport, {
        callId,
        apiKey: resolveVoiceLlmApiKey(undefined, resolveWebeeLlmProvider(config.settings)),
        voiceId: config.voiceId,
        model: resolveWebeeSpeechModel(config.settings),
        // Only reached when the agent has no runnable graph; the compiled prompt
        // is a better fallback than dropping the call.
        systemPrompt: config.systemPrompt,
        sampleRate: TWILIO_RATE,
        logPrefix: LOG,
        // Twilio never reports playback progress, so it has to be inferred from
        // how much audio has been handed over.
        playback: "estimated",
        agentId: config.agentId,
        supabase: sb,
        settings: config.settings,
        resolveLifecycle: () => lifecycle,
      });

      session.start().catch((err: Error) => {
        console.error(`${LOG} cascade start failed call=${callId}: ${err.message}`);
        void lifecycle?.failed("error_llm_websocket_open", err.message);
        ws.close(1011, "engine unavailable");
      });
      console.log(`${LOG} cascade stream started streamSid=${streamSid} call=${callId}`);
      return;
    }

    if (msg.event === "media") {
      const payload = (msg.media as Record<string, unknown> | undefined)?.payload;
      if (typeof payload !== "string" || !session) return;
      session.pushCallerAudio(pcm16ToBuffer(mulawBytesToPcm16(Buffer.from(payload, "base64"))));
      return;
    }

    if (msg.event === "dtmf") {
      const digit = (msg.dtmf as Record<string, unknown> | undefined)?.digit;
      if (typeof digit === "string") session?.submitDigit(digit);
      return;
    }

    if (msg.event === "stop") {
      console.log(`${LOG} cascade stream stopped call=${callId}`);
      session?.close();
      void finalizeCall(sb, callId, config.workspaceId, transcript);
      void lifecycle?.ended("user_hangup");
    }
  });

  ws.on("close", () => {
    session?.close();
    // A socket that drops without `stop` still has to produce the post-call
    // events, otherwise the call never reaches analytics. Both calls are
    // idempotent.
    void finalizeCall(sb, callId, config.workspaceId, transcript);
    void lifecycle?.ended("user_hangup");
    console.log(`${LOG} cascade WS closed call=${callId}`);
  });

  ws.on("error", (err: Error) => {
    console.error(`${LOG} Twilio WS error call=${callId}: ${err.message}`);
  });
}

/** OpenAI Realtime over Twilio, bridging mu-law 8 kHz <-> PCM16 24 kHz. */
async function runRealtimeBridge(
  ws: WebSocket,
  callId: string,
  sb: SupabaseClient,
  config: CallAgentConfig,
): Promise<void> {
  const transcript: TranscriptEntry[] = [];
  let streamSid = "";
  let openaiWs: WebSocket | null = null;
  let connected = false;

  const lifecycle = createCallLifecycle(sb, callId, config, { logPrefix: LOG });
  // Transcript entries land in `transcript` from the Realtime bridge; mirror them
  // into the lifecycle so the webhook and the analysis pass see the same turns.
  let mirrored = 0;
  const mirrorTranscript = () => {
    for (; mirrored < transcript.length; mirrored++) {
      lifecycle.addTurn(transcript[mirrored].role, transcript[mirrored].text);
    }
  };

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg.event === "start") {
      streamSid = readStreamSid(msg);

      void markCallAnswered(sb, callId);
      lifecycle.started();

      openaiWs = connectRealtimeForCall({
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
          if (ws.readyState !== WebSocket.OPEN || !streamSid) return;
          const pcm8 = resample(pcm24, REALTIME_RATE, TWILIO_RATE);
          lifecycle.recordAgent(pcm8, TWILIO_RATE);
          ws.send(
            JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: pcm16ToMulawBase64(pcm8) },
            }),
          );
        },
      });
      connected = true;
      console.log(`${LOG} stream started streamSid=${streamSid}`);
      return;
    }

    if (msg.event === "media") {
      if (!connected || openaiWs?.readyState !== WebSocket.OPEN) return;
      const media = msg.media as Record<string, unknown> | undefined;
      const payload = media?.payload;
      if (typeof payload !== "string") return;

      const pcm8 = mulawBytesToPcm16(Buffer.from(payload, "base64"));
      lifecycle.recordCaller(pcm8, TWILIO_RATE);
      const pcm24 = resample(pcm8, TWILIO_RATE, REALTIME_RATE);
      openaiWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: pcm16ToBase64(pcm24),
        }),
      );
      return;
    }

    if (msg.event === "stop") {
      console.log(`${LOG} Twilio stream stopped callId=${callId}`);
      connected = false;
      openaiWs?.close();
      mirrorTranscript();
      void finalizeCall(sb, callId, config.workspaceId, transcript);
      // Twilio sends `stop` when the caller hangs up.
      void lifecycle.ended("user_hangup");
    }
  });

  ws.on("close", () => {
    console.log(`${LOG} Twilio WS closed callId=${callId}`);
    connected = false;
    openaiWs?.close();
    mirrorTranscript();
    // A socket that drops without `stop` still has to produce the post-call
    // events, otherwise the call never reaches analytics. `ended()` is idempotent.
    void lifecycle.ended("user_hangup");
  });

  ws.on("error", (err: Error) => {
    console.error(`${LOG} Twilio WS error callId=${callId}:`, err.message);
  });
}

async function handleTwilioStream(ws: WebSocket, callId: string): Promise<void> {
  console.log(`${LOG} Twilio connected callId=${callId}`);
  const sb = makeSupabaseAdmin();
  const config = await loadCallAgentConfig(sb, callId, LOG);

  if (isWebeeNativeMode(config.deploymentMode)) {
    console.log(`${LOG} engine=webee_native callId=${callId}`);
    return runCascadeBridge(ws, callId, sb, config);
  }
  return runRealtimeBridge(ws, callId, sb, config);
}

export const telephonyRoute: VoiceGatewayRoute = {
  name: "telephony",
  match: (pathname) => {
    const m = STREAM_PATH.exec(pathname);
    return m ? { callId: m[1] } : null;
  },
  preflight: () =>
    process.env.CEREBRAS_API_KEY || process.env.OPENAI_API_KEY
      ? null
      : "OPENAI_API_KEY or CEREBRAS_API_KEY not configured",
  onConnection: (ws: WebSocket, ctx: VoiceGatewayContext) => {
    handleTwilioStream(ws, ctx.params.callId).catch((err) => {
      console.error(`${LOG} handler error:`, err);
      ws.close(1011, "gateway error");
    });
  },
};
