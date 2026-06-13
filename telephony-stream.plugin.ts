/**
 * Twilio Media Streams ↔ OpenAI Realtime audio bridge (Vite dev plugin)
 *
 * Twilio dials one of our numbers → inbound webhook responds with TwiML
 * <Connect><Stream url="wss://host/api/telephony/stream/:callId" />
 * This plugin accepts that WebSocket, decodes μ-law 8kHz audio from Twilio,
 * resamples → PCM16 24kHz → forwards to OpenAI Realtime API, then takes the
 * AI's TTS PCM16 24kHz response, resamples → μ-law 8kHz → sends back to Twilio.
 *
 * In production the same logic runs in the srvx server handler
 * (src/server/telephony-stream.handler.ts).
 */
import type { Plugin } from "vite";
import WebSocket, { WebSocketServer } from "ws";
import { createClient } from "@supabase/supabase-js";

// ── μ-law codec ────────────────────────────────────────────────────────────────

function mulawDecode(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exp = (u >> 4) & 0x07;
  const man = u & 0x0f;
  let x = ((man << 1) | 1) << (exp + 2);
  x -= 33;
  return sign ? -x : x;
}

function mulawEncode(sample: number): number {
  const BIAS = 33;
  const CLIP = 32635;
  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exp = 7;
  for (let mask = 0x4000; exp > 0 && (sample & mask) === 0; exp--, mask >>= 1) {}
  const man = (sample >> (exp + 1)) & 0x0f;
  return ~(sign | (exp << 4) | man) & 0xff;
}

/** Resample a mono Int16 buffer from srcHz to dstHz via linear interpolation */
function resample(src: Int16Array, srcHz: number, dstHz: number): Int16Array {
  if (srcHz === dstHz) return src;
  const ratio = srcHz / dstHz;
  const dstLen = Math.round((src.length * dstHz) / srcHz);
  const dst = new Int16Array(dstLen);
  for (let i = 0; i < dstLen; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, src.length - 1);
    const frac = pos - lo;
    dst[i] = Math.round(src[lo] * (1 - frac) + src[hi] * frac);
  }
  return dst;
}

function mulawBytesToPcm16(payload: Buffer): Int16Array {
  const pcm = new Int16Array(payload.length);
  for (let i = 0; i < payload.length; i++) pcm[i] = mulawDecode(payload[i]);
  return pcm;
}

function pcm16ToMulawBase64(samples: Int16Array): string {
  const out = Buffer.allocUnsafe(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = mulawEncode(samples[i]);
  return out.toString("base64");
}

// ── Supabase admin (server-only) ───────────────────────────────────────────────

function makeSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    "";
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Session state ──────────────────────────────────────────────────────────────

interface SessionState {
  callId: string;
  streamSid: string;
  twilioWs: WebSocket;
  openaiWs: WebSocket | null;
  agentId: string | null;
  workspaceId: string | null;
  transcript: Array<{ role: "agent" | "user"; text: string; ts: number }>;
  audioBuffer: Int16Array[]; // outgoing TTS chunks waiting for Twilio drain
  connected: boolean;
}

// ── OpenAI Realtime session ────────────────────────────────────────────────────

async function connectOpenAI(
  session: SessionState,
  systemPrompt: string,
  voiceId: string,
  model: string,
): Promise<WebSocket> {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  const oaiUrl = `wss://api.openai.com/v1/realtime?model=${model}`;

  const oaiWs = new WebSocket(oaiUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  oaiWs.on("open", () => {
    // Configure session
    oaiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          instructions: systemPrompt,
          voice: voiceId,
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: { model: "whisper-1" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 600,
          },
        },
      }),
    );
    console.log(`[tel-stream] OpenAI connected callId=${session.callId}`);
  });

  oaiWs.on("message", (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "response.audio.delta" && msg.delta) {
      // PCM16 24kHz → μ-law 8kHz → Twilio
      const pcm24 = new Int16Array(
        Buffer.from(msg.delta, "base64").buffer,
      );
      const pcm8 = resample(pcm24, 24000, 8000);
      const payload = pcm16ToMulawBase64(pcm8);

      if (
        session.twilioWs.readyState === WebSocket.OPEN &&
        session.streamSid
      ) {
        session.twilioWs.send(
          JSON.stringify({
            event: "media",
            streamSid: session.streamSid,
            media: { payload },
          }),
        );
      }
    }

    if (
      msg.type === "conversation.item.input_audio_transcription.completed" &&
      msg.transcript
    ) {
      session.transcript.push({
        role: "user",
        text: msg.transcript,
        ts: Date.now(),
      });
    }

    if (
      msg.type === "response.audio_transcript.done" &&
      msg.transcript
    ) {
      session.transcript.push({
        role: "agent",
        text: msg.transcript,
        ts: Date.now(),
      });
      persistTranscript(session).catch(() => {});
    }

    if (msg.type === "error") {
      console.error("[tel-stream] OpenAI error:", msg.error);
    }
  });

  oaiWs.on("close", () => {
    console.log(`[tel-stream] OpenAI closed callId=${session.callId}`);
  });

  oaiWs.on("error", (err) => {
    console.error("[tel-stream] OpenAI ws error:", err.message);
  });

  return oaiWs;
}

async function persistTranscript(session: SessionState) {
  if (!session.callId || session.transcript.length === 0) return;
  const sb = makeSupabase();
  await sb
    .from("telephony_calls")
    .update({
      transcript: session.transcript,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.callId);
}

// ── Main handler ───────────────────────────────────────────────────────────────

async function handleTwilioStream(ws: WebSocket, callId: string) {
  console.log(`[tel-stream] Twilio connected callId=${callId}`);

  const session: SessionState = {
    callId,
    streamSid: "",
    twilioWs: ws,
    openaiWs: null,
    agentId: null,
    workspaceId: null,
    transcript: [],
    audioBuffer: [],
    connected: false,
  };

  // Look up call + agent
  const sb = makeSupabase();
  const { data: callRow } = await sb
    .from("telephony_calls")
    .select("agent_id, workspace_id")
    .eq("id", callId)
    .single()
    .catch(() => ({ data: null }));

  session.agentId = callRow?.agent_id ?? null;
  session.workspaceId = callRow?.workspace_id ?? null;

  let systemPrompt = "You are a helpful AI voice assistant. Be concise and natural.";
  let voiceId = "alloy";
  let model = "gpt-4o-realtime-preview-2024-12-17";

  if (session.agentId) {
    const { data: agentRow } = await sb
      .from("agents")
      .select("name, flow_data, settings")
      .eq("id", session.agentId)
      .single()
      .catch(() => ({ data: null }));

    if (agentRow) {
      const settings = (agentRow.settings as any) ?? {};
      voiceId = settings.voice_id ?? "alloy";
      model = settings.openai_model ?? "gpt-4o-realtime-preview-2024-12-17";

      // Use the same full flow-graph → prompt compiler the browser relay uses,
      // so telephony HyperStream calls get the proper turn-taking rules, KB,
      // begin message, and all conversation steps — not just raw node text.
      try {
        const { compileRealtimePrompt } = await import(
          "./src/lib/builder/compile-realtime-prompt.js"
        );
        const flowData = (agentRow.flow_data as any) ?? {};
        const nodes    = flowData.nodes ?? [];
        const edges    = flowData.edges ?? [];
        const vars     = flowData.variables ?? settings.variables ?? [];
        const compiled = compileRealtimePrompt(nodes, edges, settings, vars);
        if (compiled.trim()) systemPrompt = compiled;
      } catch (err) {
        // Fallback: basic concatenation if compiler unavailable
        console.warn("[tel-stream] compileRealtimePrompt failed, using fallback:", err);
        const nodes = (agentRow.flow_data as any)?.nodes ?? [];
        const textNodes = nodes
          .filter((n: any) => n.data?.kind === "conversation" || n.data?.kind === "start")
          .map((n: any) => n.data?.dialogue ?? n.data?.prompt ?? n.data?.message ?? "")
          .filter(Boolean)
          .join("\n\n");
        if (textNodes) systemPrompt = textNodes;
      }
    }
  }

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.event === "connected") {
      console.log(`[tel-stream] Twilio connected event callId=${callId}`);
    }

    if (msg.event === "start") {
      session.streamSid = msg.start?.streamSid ?? msg.streamSid ?? "";

      // Update call status to answered
      await sb
        .from("telephony_calls")
        .update({ status: "answered", answered_at: new Date().toISOString() })
        .eq("id", callId);

      // Connect to OpenAI
      session.openaiWs = await connectOpenAI(session, systemPrompt, voiceId, model);
      session.connected = true;
      console.log(
        `[tel-stream] stream started streamSid=${session.streamSid}`,
      );
    }

    if (msg.event === "media" && session.connected && session.openaiWs?.readyState === WebSocket.OPEN) {
      // μ-law 8kHz → PCM16 8kHz → PCM16 24kHz → OpenAI
      const payload = msg.media?.payload as string | undefined;
      if (!payload) return;

      const mulawBuf = Buffer.from(payload, "base64");
      const pcm8 = mulawBytesToPcm16(mulawBuf);
      const pcm24 = resample(pcm8, 8000, 24000);

      const pcmBase64 = Buffer.from(pcm24.buffer).toString("base64");
      session.openaiWs.send(
        JSON.stringify({ type: "input_audio_buffer.append", audio: pcmBase64 }),
      );
    }

    if (msg.event === "stop") {
      console.log(`[tel-stream] Twilio stream stopped callId=${callId}`);
      session.connected = false;
      session.openaiWs?.close();

      // Final transcript persist + call status update
      await Promise.allSettled([
        persistTranscript(session),
        sb
          .from("telephony_calls")
          .update({ status: "completed", ended_at: new Date().toISOString() })
          .eq("id", callId),
        sb.from("call_events").insert({
          call_id: callId,
          workspace_id: session.workspaceId,
          event_type: "status_change",
          event_data: { from: "active", to: "completed" },
        }),
      ]);
    }
  });

  ws.on("close", () => {
    console.log(`[tel-stream] Twilio WS closed callId=${callId}`);
    session.openaiWs?.close();
  });

  ws.on("error", (err) => {
    console.error(`[tel-stream] Twilio WS error callId=${callId}:`, err.message);
  });
}

// ── Vite plugin ────────────────────────────────────────────────────────────────

export function telephonyStreamPlugin(): Plugin {
  const STREAM_PATH = /^\/api\/telephony\/stream\/([a-zA-Z0-9-]+)$/;
  let wss: WebSocketServer | null = null;

  return {
    name: "telephony-stream-plugin",
    configureServer(server) {
      wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on("upgrade", (req, socket, head) => {
        const url = req.url ?? "";
        const match = STREAM_PATH.exec(url);
        if (!match) return;

        const callId = match[1];
        wss!.handleUpgrade(req, socket as any, head, (ws) => {
          handleTwilioStream(ws, callId).catch((err) => {
            console.error("[tel-stream] handler error:", err);
            ws.close();
          });
        });
      });

      console.log("[tel-stream] Telephony stream plugin ready — /api/telephony/stream/:callId");
    },
  };
}
