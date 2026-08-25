/**
 * Smoke-test Fish Audio TTS locally (WebSocket + MessagePack, same path as production).
 *
 *   node --env-file=.env scripts/probe-fish-tts.mjs
 *   node --env-file=.env scripts/probe-fish-tts.mjs --list
 *   node --env-file=.env scripts/probe-fish-tts.mjs --voice <reference_id> --text "Hello from WEBEE"
 *
 * Writes probe-fish-tts.wav in the repo root (24 kHz PCM16 mono).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { decode, encode } from "@msgpack/msgpack";

const __dir = dirname(fileURLToPath(import.meta.url));
const FISH_TTS_WS = "wss://api.fish.audio/v1/tts/live";
const FISH_API_BASE = "https://api.fish.audio";
const SAMPLE_RATE = 24_000;
const DEFAULT_MODEL = process.env.FISH_TTS_MODEL?.trim() || "s2.1-pro-free";
const CONNECT_TIMEOUT_MS = 10_000;

function loadDotEnv() {
  try {
    for (const line of readFileSync(resolve(__dir, "../.env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* optional when using --env-file */
  }
}

loadDotEnv();

function parseArgs(argv) {
  const out = { list: false, voice: process.env.FISH_VOICE_ID?.trim() || "", text: "Hello from WEBEE Native. Fish Audio TTS is working." };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") out.list = true;
    else if (a === "--voice" && argv[i + 1]) out.voice = argv[++i];
    else if (a === "--text" && argv[i + 1]) out.text = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`Usage:
  node --env-file=.env scripts/probe-fish-tts.mjs [--list]
  node --env-file=.env scripts/probe-fish-tts.mjs [--voice <reference_id>] [--text "..."]

Env:
  FISH_API_KEY     required
  FISH_VOICE_ID    optional default for --voice
`);
      process.exit(0);
    }
  }
  return out;
}

const apiKey = process.env.FISH_API_KEY?.trim();
if (!apiKey) {
  console.error("Missing FISH_API_KEY — add it to .env or pass --env-file=.env");
  process.exit(1);
}

async function listVoices() {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const [ownedRes, libraryRes] = await Promise.all([
    fetch(`${FISH_API_BASE}/model?self=true&page_size=20`, { headers }),
    fetch(`${FISH_API_BASE}/model?page_size=10`, { headers }),
  ]);

  for (const [label, res] of [
    ["Your voices (self=true)", ownedRes],
    ["Public library (first 10)", libraryRes],
  ]) {
    if (!res.ok) {
      console.error(`${label}: HTTP ${res.status} ${await res.text().catch(() => "")}`);
      continue;
    }
    const body = await res.json();
    const items = Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];
    console.log(`\n${label}:`);
    if (items.length === 0) {
      console.log("  (none)");
      continue;
    }
    for (const item of items) {
      const id = item._id ?? item.id ?? "?";
      const title = item.title ?? "(untitled)";
      console.log(`  ${id}  ${title}`);
    }
  }
}

function pcmToWav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
}

async function waitForOpen(ws) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Fish connect timed out after ${CONNECT_TIMEOUT_MS}ms`));
      ws.terminate();
    }, CONNECT_TIMEOUT_MS);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.once("close", (code, reasonBuf) => {
      clearTimeout(timer);
      reject(new Error(`Fish closed during handshake: ${code} ${reasonBuf?.toString?.() ?? ""}`));
    });
  });
}

async function synthesize(text, voiceId) {
  const pcmChunks = [];
  const started = Date.now();
  let firstAudioMs = null;

  const request = {
    text: "",
    format: "pcm",
    sample_rate: SAMPLE_RATE,
    latency: "low",
  };
  if (voiceId) request.reference_id = voiceId;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(FISH_TTS_WS, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        model: DEFAULT_MODEL,
      },
    });

    ws.on("message", (data) => {
      try {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
        const msg = decode(buf);
        if (msg?.event === "audio" && msg.audio) {
          if (firstAudioMs === null) firstAudioMs = Date.now() - started;
          pcmChunks.push(Buffer.from(msg.audio));
          return;
        }
        if (msg?.event === "finish") {
          if (msg.reason === "error") {
            reject(new Error(`Fish synthesis error: ${msg.message ?? "unknown"}`));
          } else {
            resolve();
          }
          ws.close();
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    ws.on("error", reject);

    waitForOpen(ws)
      .then(() => {
        ws.send(encode({ event: "start", request }));
        ws.send(encode({ event: "text", text }));
        ws.send(encode({ event: "stop" }));
      })
      .catch(reject);
  });

  const pcm = Buffer.concat(pcmChunks);
  return { pcm, firstAudioMs, totalMs: Date.now() - started, bytes: pcm.byteLength };
}

const args = parseArgs(process.argv.slice(2));

if (args.list) {
  await listVoices();
  process.exit(0);
}

console.log("Fish Audio TTS probe");
console.log(`  model header: ${DEFAULT_MODEL}`);
console.log(`  sample rate:  ${SAMPLE_RATE} Hz`);
console.log(`  voice:        ${args.voice || "(default model voice)"}`);
console.log(`  text:         ${JSON.stringify(args.text)}`);

try {
  const { pcm, firstAudioMs, totalMs, bytes } = await synthesize(args.text, args.voice);
  if (bytes === 0) {
    console.error("No audio returned — check API key, voice id, or account quota.");
    process.exit(1);
  }
  const outPath = resolve(__dir, "../probe-fish-tts.wav");
  writeFileSync(outPath, pcmToWav(pcm));
  const durationSec = (bytes / 2 / SAMPLE_RATE).toFixed(2);
  console.log(`\nOK — ${bytes} bytes PCM (~${durationSec}s)`);
  console.log(`  time to first audio: ${firstAudioMs ?? "?"} ms`);
  console.log(`  total session:       ${totalMs} ms`);
  console.log(`  saved: ${outPath}`);
  console.log("\nTip: open probe-fish-tts.wav or run with --list to pick a voice id.");
} catch (err) {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  console.error("\nTry: node --env-file=.env scripts/probe-fish-tts.mjs --list");
  process.exit(1);
}
