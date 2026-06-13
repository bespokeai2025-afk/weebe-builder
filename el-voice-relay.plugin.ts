/**
 * Vite dev-server plugin: WebSocket relay for ElevenLabs Voice test calls.
 *
 * Pipeline (per turn):
 *   Browser PCM16 mic audio (24 kHz mono, 50 ms chunks)
 *     → server VAD (RMS energy threshold)
 *     → OpenAI Whisper STT
 *     → GPT-4.1 text LLM (streaming)
 *     → ElevenLabs streaming TTS (pcm_24000)
 *     → Browser PCM16 audio playback
 *
 * WebSocket path: /api/el-voice-relay
 *
 * Protocol (browser ↔ relay):
 *   Browser → relay:
 *     { type: "session.init", voiceId, systemPrompt, beginMessage, model }
 *     { type: "audio.chunk",  data: "<base64 PCM16 24kHz mono>" }
 *
 *   Relay → browser:
 *     { type: "relay.connected" }
 *     { type: "transcript",   role: "user"|"agent", text }
 *     { type: "audio.delta",  data: "<base64 PCM16 24kHz mono>" }
 *     { type: "response.done" }
 *     { type: "relay.error",  message }
 *
 * Only active in the Vite dev server (configureServer hook).
 */
import { WebSocket, WebSocketServer } from "ws";
import type { Plugin } from "vite";

const RELAY_PATH = "/api/el-voice-relay";
const SAMPLE_RATE = 24_000;

// ── VAD parameters ────────────────────────────────────────────────────────────
// Energy threshold in raw Int16 units (0–32 768).
// Typical speech: 1 000–6 000.  Background noise / silence: < 300.
const RMS_THRESHOLD = 400;
// Consecutive frames of silence that trigger STT (1 frame ≈ 50 ms).
const SILENCE_FRAMES_TRIGGER = 22; // ≈ 1.1 s silence → end of utterance
// Minimum speech frames before we bother sending to Whisper.
const MIN_SPEECH_FRAMES = 8; // ≈ 400 ms minimum utterance

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeRms(chunk: Buffer): number {
  const samples = Math.floor(chunk.byteLength / 2);
  if (samples === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = chunk.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}

function buildWav(bufs: Buffer[]): Buffer {
  const pcm = Buffer.concat(bufs);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);         // fmt chunk size
  header.writeUInt16LE(1, 20);          // PCM
  header.writeUInt16LE(1, 22);          // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);          // block align
  header.writeUInt16LE(16, 34);         // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
}

function safeSend(ws: WebSocket, msg: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── STT (Whisper) ─────────────────────────────────────────────────────────────

async function whisperTranscribe(wav: Buffer, apiKey: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "speech.wav");
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => String(res.status));
    throw new Error(`Whisper ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { text: string };
  return (data.text ?? "").trim();
}

// ── LLM (GPT text streaming) ──────────────────────────────────────────────────

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

function resolveTextModel(modelId: string): string {
  const MAP: Record<string, string> = {
    "gpt-realtime":               "gpt-4.1",
    "gpt-4o-realtime-preview":    "gpt-4.1",
    "gpt-4o-mini-realtime-preview": "gpt-4.1-mini",
    "gpt-4.1":                    "gpt-4.1",
    "gpt-4.1-fast":               "gpt-4.1",
    "gpt-4.1-mini":               "gpt-4.1-mini",
  };
  return MAP[modelId] ?? "gpt-4.1";
}

async function gptComplete(
  messages: ChatMsg[],
  model: string,
  apiKey: string,
): Promise<string> {
  const textModel = resolveTextModel(model);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: textModel, messages, stream: true }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => String(res.status));
    throw new Error(`GPT ${res.status}: ${body}`);
  }

  let full = "";
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let lineBuf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuf += dec.decode(value, { stream: true });
    const lines = lineBuf.split("\n");
    lineBuf = lines.pop() ?? "";
    for (const line of lines) {
      const payload = line.replace(/^data:\s*/, "").trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload) as {
          choices: Array<{ delta: { content?: string } }>;
        };
        full += chunk.choices?.[0]?.delta?.content ?? "";
      } catch { /* skip malformed SSE line */ }
    }
  }
  return full.trim();
}

// ── TTS (ElevenLabs streaming) ────────────────────────────────────────────────

async function* elTtsStream(
  text: string,
  voiceId: string,
  apiKey: string,
): AsyncGenerator<Buffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream` +
      `?output_format=pcm_24000&optimize_streaming_latency=3`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.0 },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => String(res.status));
    throw new Error(`ElevenLabs TTS ${res.status}: ${body}`);
  }
  const reader = res.body!.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield Buffer.from(value);
  }
}

// ── Connection handler ────────────────────────────────────────────────────────

function handleConnection(ws: WebSocket, openaiKey: string, elKey: string) {
  // Session config — populated on session.init
  let voiceId = "";
  let model = "gpt-4.1";
  let systemPrompt = "";
  const history: ChatMsg[] = [];

  // VAD state
  type VadState = "idle" | "speaking";
  let vadState: VadState = "idle";
  const speechBufs: Buffer[] = [];
  let silFrames = 0;
  let spchFrames = 0;
  let busy = false; // true while STT→LLM→TTS is in flight

  // ── TTS: stream agent audio to browser ─────────────────────────────────────
  async function streamTts(text: string): Promise<void> {
    let leftover = 0; // odd-byte carry between chunks
    let leftoverByte = 0;
    for await (const chunk of elTtsStream(text, voiceId, elKey)) {
      // Build aligned Int16 buffer (carry odd byte forward).
      let start = 0;
      let payloadBuf: Buffer;
      if (leftover) {
        // Prepend the orphaned byte from the previous chunk.
        payloadBuf = Buffer.alloc(1 + chunk.byteLength);
        payloadBuf.writeUInt8(leftoverByte, 0);
        chunk.copy(payloadBuf, 1);
        start = 0;
        leftover = 0;
      } else {
        payloadBuf = chunk;
      }
      const alignedLen = Math.floor(payloadBuf.byteLength / 2) * 2;
      if (payloadBuf.byteLength % 2 !== 0) {
        leftoverByte = payloadBuf[payloadBuf.byteLength - 1];
        leftover = 1;
      }
      if (alignedLen > 0) {
        const aligned = payloadBuf.subarray(start, alignedLen);
        safeSend(ws, { type: "audio.delta", data: aligned.toString("base64") });
      }
    }
  }

  // ── Process one speech turn: STT → LLM → TTS ────────────────────────────
  async function processTurn(bufs: Buffer[]): Promise<void> {
    busy = true;
    try {
      // STT
      const wav = buildWav(bufs);
      let userText: string;
      try {
        userText = await whisperTranscribe(wav, openaiKey);
      } catch (err) {
        console.error("[el-voice-relay] Whisper error:", (err as Error).message);
        safeSend(ws, { type: "relay.error", message: `STT error: ${(err as Error).message}` });
        return;
      }
      if (!userText) return;
      safeSend(ws, { type: "transcript", role: "user", text: userText });
      console.log(`[el-voice-relay] user: ${userText}`);

      // LLM
      history.push({ role: "user", content: userText });
      const messages: ChatMsg[] = [{ role: "system", content: systemPrompt }, ...history];
      let agentText: string;
      try {
        agentText = await gptComplete(messages, model, openaiKey);
      } catch (err) {
        console.error("[el-voice-relay] GPT error:", (err as Error).message);
        safeSend(ws, { type: "relay.error", message: `LLM error: ${(err as Error).message}` });
        history.pop();
        return;
      }
      if (!agentText) { history.pop(); return; }
      history.push({ role: "assistant", content: agentText });
      safeSend(ws, { type: "transcript", role: "agent", text: agentText });
      console.log(`[el-voice-relay] agent: ${agentText.slice(0, 120)}${agentText.length > 120 ? "…" : ""}`);

      // TTS
      try {
        await streamTts(agentText);
      } catch (err) {
        console.error("[el-voice-relay] TTS error:", (err as Error).message);
        safeSend(ws, { type: "relay.error", message: `TTS error: ${(err as Error).message}` });
        return;
      }
      safeSend(ws, { type: "response.done" });
    } finally {
      busy = false;
    }
  }

  // ── Message router ────────────────────────────────────────────────────────
  ws.on("message", (raw: import("ws").RawData) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    // ── ping (keepalive) ──────────────────────────────────────────────────────
    // Browser sends a ping every 5 s to prevent the reverse-proxy from closing
    // the connection during long AI audio playback (when neither side sends
    // messages for up to ~15 s while pre-buffered audio drains in the browser).
    if (msg.type === "ping") {
      safeSend(ws, { type: "pong" });
      return;
    }

    // ── session.init ─────────────────────────────────────────────────────────
    if (msg.type === "session.init") {
      voiceId      = String(msg.voiceId      ?? "");
      model        = String(msg.model        ?? "gpt-4.1");
      systemPrompt = String(msg.systemPrompt ?? "");
      const beginMessage = String(msg.beginMessage ?? "").trim();
      console.log(`[el-voice-relay] session.init voiceId=${voiceId} model=${model}`);
      safeSend(ws, { type: "relay.connected" });

      if (beginMessage) {
        busy = true;
        history.push({ role: "assistant", content: beginMessage });
        safeSend(ws, { type: "transcript", role: "agent", text: beginMessage });
        streamTts(beginMessage)
          .then(() => { safeSend(ws, { type: "response.done" }); })
          .catch((e: Error) => safeSend(ws, { type: "relay.error", message: e.message }))
          .finally(() => { busy = false; });
      }
      return;
    }

    // ── audio.chunk ───────────────────────────────────────────────────────────
    if (msg.type === "audio.chunk") {
      if (busy) return; // discard mic input while agent is processing/speaking
      const chunk = Buffer.from(String(msg.data ?? ""), "base64");
      if (chunk.byteLength < 2) return;
      const rms = computeRms(chunk);

      if (vadState === "idle") {
        if (rms >= RMS_THRESHOLD) {
          vadState = "speaking";
          spchFrames = 1;
          silFrames = 0;
          speechBufs.push(chunk);
          console.log(`[el-voice-relay] VAD speech start (rms=${rms.toFixed(0)})`);
        }
      } else {
        // vadState === "speaking"
        speechBufs.push(chunk);
        if (rms >= RMS_THRESHOLD) {
          spchFrames++;
          silFrames = 0;
        } else {
          silFrames++;
          if (silFrames >= SILENCE_FRAMES_TRIGGER) {
            // End of utterance detected
            const capturedBufs = speechBufs.splice(0);
            vadState = "idle";
            spchFrames = 0;
            silFrames = 0;
            console.log(`[el-voice-relay] VAD utterance end (frames=${capturedBufs.length})`);
            if (capturedBufs.length >= MIN_SPEECH_FRAMES) {
              processTurn(capturedBufs).catch((e: Error) => {
                console.error("[el-voice-relay] processTurn unhandled:", e.message);
                busy = false;
              });
            } else {
              console.log(`[el-voice-relay] utterance too short (<${MIN_SPEECH_FRAMES} frames), discarded`);
            }
          }
        }
      }
      return;
    }
  });

  ws.on("close", () => { console.log("[el-voice-relay] connection closed"); });
  ws.on("error", (e: Error) => { console.error("[el-voice-relay] WS error:", e.message); });
}

// ── Vite plugin ───────────────────────────────────────────────────────────────

export function elVoiceRelayPlugin(): Plugin {
  return {
    name: "el-voice-relay",

    configureServer(server) {
      if (!server.httpServer) {
        console.error("[el-voice-relay] server.httpServer is null — plugin inactive");
        return;
      }
      console.log("[el-voice-relay] registered on httpServer ✓");

      server.httpServer.on("upgrade", (req, socket, head) => {
        try {
          const parsedUrl = new URL(req.url ?? "/", "http://localhost");
          if (parsedUrl.pathname !== RELAY_PATH) return;

          const openaiKey = process.env.OPENAI_API_KEY;
          const elKey = process.env.ELEVENLABS_API_KEY;
          const missing = [
            !openaiKey && "OPENAI_API_KEY",
            !elKey && "ELEVENLABS_API_KEY",
          ].filter(Boolean).join(", ");
          if (missing) {
            console.error(`[el-voice-relay] missing env vars: ${missing}`);
            socket.write(`HTTP/1.1 503 Service Unavailable\r\n\r\nMissing: ${missing}`);
            socket.destroy();
            return;
          }

          const wss = new WebSocketServer({ noServer: true });
          wss.handleUpgrade(req, socket, head, (browserWs) => {
            handleConnection(browserWs, openaiKey!, elKey!);
          });
        } catch (e) {
          console.error("[el-voice-relay] upgrade handler error:", e);
          socket.destroy();
        }
      });
    },
  };
}
