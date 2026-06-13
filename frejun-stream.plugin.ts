/**
 * FreJun Teler ↔ OpenAI Realtime audio bridge (Vite dev plugin)
 *
 * FreJun calls our number → flow URL returns:
 *   { "action": "stream", "ws_url": "wss://host/api/frejun/stream/:callId", "sample_rate": "16k", "chunk_size": 400 }
 *
 * This plugin accepts that WebSocket from FreJun. FreJun streams raw binary PCM16
 * at 16kHz in each frame. We resample → PCM16 24kHz → forward to OpenAI Realtime,
 * then take the AI's 24kHz PCM16 response → resample → 16kHz → send back to FreJun.
 *
 * In production the same logic runs in src/server/frejun-stream.handler.ts.
 */
import type { Plugin } from "vite";
import WebSocket, { WebSocketServer } from "ws";
import { createClient } from "@supabase/supabase-js";

// ── Resampler ──────────────────────────────────────────────────────────────────

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

// ── Supabase admin ─────────────────────────────────────────────────────────────

function makeSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Session state ──────────────────────────────────────────────────────────────

interface SessionState {
  callId: string;
  frejunWs: WebSocket;
  openaiWs: WebSocket | null;
  agentId: string | null;
  workspaceId: string | null;
  transcript: Array<{ role: "agent" | "user"; text: string; ts: number }>;
  connected: boolean;
  inputSampleRate: 8000 | 16000;
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
    console.log(`[frejun-stream] OpenAI connected callId=${session.callId}`);
  });

  oaiWs.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg.type === "response.audio.delta" && msg.delta) {
      const pcm24 = new Int16Array(Buffer.from(msg.delta as string, "base64").buffer);
      const outHz = session.inputSampleRate;
      const pcmOut = resample(pcm24, 24000, outHz);
      const outBuf = Buffer.from(pcmOut.buffer);

      if (session.frejunWs.readyState === WebSocket.OPEN) {
        session.frejunWs.send(outBuf);
      }
    }

    if (
      msg.type === "conversation.item.input_audio_transcription.completed" &&
      msg.transcript
    ) {
      session.transcript.push({ role: "user", text: msg.transcript as string, ts: Date.now() });
    }

    if (msg.type === "response.audio_transcript.done" && msg.transcript) {
      session.transcript.push({ role: "agent", text: msg.transcript as string, ts: Date.now() });
      persistTranscript(session).catch(() => {});
    }

    if (msg.type === "error") {
      console.error("[frejun-stream] OpenAI error:", msg.error);
    }
  });

  oaiWs.on("close", () => console.log(`[frejun-stream] OpenAI closed callId=${session.callId}`));
  oaiWs.on("error", (err) => console.error("[frejun-stream] OpenAI ws error:", err.message));

  return oaiWs;
}

async function persistTranscript(session: SessionState) {
  if (!session.callId || session.transcript.length === 0) return;
  const sb = makeSupabase();
  await sb
    .from("telephony_calls")
    .update({ transcript: session.transcript, updated_at: new Date().toISOString() })
    .eq("id", session.callId);
}

// ── Main handler ───────────────────────────────────────────────────────────────

async function handleFreJunStream(ws: WebSocket, callId: string) {
  console.log(`[frejun-stream] FreJun connected callId=${callId}`);

  const session: SessionState = {
    callId,
    frejunWs: ws,
    openaiWs: null,
    agentId: null,
    workspaceId: null,
    transcript: [],
    connected: false,
    inputSampleRate: 16000,
  };

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
      const settings = (agentRow.settings as Record<string, unknown>) ?? {};
      voiceId = (settings.voice_id as string | undefined) ?? "alloy";
      model = (settings.openai_model as string | undefined) ?? "gpt-4o-realtime-preview-2024-12-17";

      try {
        const { compileRealtimePrompt } = await import(
          "./src/lib/builder/compile-realtime-prompt.js"
        );
        const flowData = (agentRow.flow_data as Record<string, unknown>) ?? {};
        const compiled = compileRealtimePrompt(
          flowData.nodes ?? [],
          flowData.edges ?? [],
          settings,
          (flowData as Record<string, unknown>).variables ?? settings.variables ?? [],
        );
        if ((compiled as string).trim()) systemPrompt = compiled as string;
      } catch (err) {
        console.warn("[frejun-stream] compileRealtimePrompt failed, using fallback:", err);
        const nodes = ((agentRow.flow_data as Record<string, unknown>)?.nodes as Array<{ data?: Record<string, unknown> }>) ?? [];
        const textNodes = nodes
          .filter((n) => n.data?.kind === "conversation" || n.data?.kind === "start")
          .map((n) => n.data?.dialogue ?? n.data?.prompt ?? n.data?.message ?? "")
          .filter(Boolean)
          .join("\n\n");
        if (textNodes) systemPrompt = textNodes as string;
      }
    }
  }

  await sb
    .from("telephony_calls")
    .update({ status: "answered", answered_at: new Date().toISOString() })
    .eq("id", callId);

  session.openaiWs = await connectOpenAI(session, systemPrompt, voiceId, model);
  session.connected = true;

  ws.on("message", async (raw) => {
    if (!session.connected || session.openaiWs?.readyState !== WebSocket.OPEN) return;

    let pcmIn: Int16Array;

    if (Buffer.isBuffer(raw) || raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBufferView);
      pcmIn = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
    } else {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.event === "media" && msg.payload) {
          const decoded = Buffer.from(msg.payload as string, "base64");
          pcmIn = new Int16Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 2);
        } else {
          return;
        }
      } catch {
        return;
      }
    }

    const pcm24 = resample(pcmIn, session.inputSampleRate, 24000);
    const pcmBase64 = Buffer.from(pcm24.buffer).toString("base64");
    session.openaiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcmBase64 }));
  });

  ws.on("close", async () => {
    console.log(`[frejun-stream] FreJun WS closed callId=${callId}`);
    session.connected = false;
    session.openaiWs?.close();

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
  });

  ws.on("error", (err) => console.error(`[frejun-stream] FreJun WS error callId=${callId}:`, err.message));
}

// ── Vite plugin ────────────────────────────────────────────────────────────────

export function frejunStreamPlugin(): Plugin {
  const STREAM_PATH = /^\/api\/frejun\/stream\/([a-zA-Z0-9-]+)$/;
  let wss: WebSocketServer | null = null;

  return {
    name: "frejun-stream-plugin",
    configureServer(server) {
      wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on("upgrade", (req, socket, head) => {
        const url = req.url ?? "";
        const match = STREAM_PATH.exec(url);
        if (!match) return;

        const callId = match[1];
        wss!.handleUpgrade(req, socket as never, head, (ws) => {
          handleFreJunStream(ws, callId).catch((err) => {
            console.error("[frejun-stream] handler error:", err);
            ws.close();
          });
        });
      });

      console.log("[frejun-stream] FreJun stream plugin ready — /api/frejun/stream/:callId");
    },
  };
}
