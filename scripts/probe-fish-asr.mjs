/**
 * Probe Fish Audio ASR (batch + realtime availability) with FISH_API_KEY.
 *
 *   node --env-file=.env scripts/probe-fish-asr.mjs
 *   node --env-file=.env scripts/probe-fish-asr.mjs --wav path/to/file.wav
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const __dir = dirname(fileURLToPath(import.meta.url));
const FISH_ASR_URL = "https://api.fish.audio/v1/asr";
const REALTIME_URL =
  "wss://api.fish.audio/compat/v1/realtime?intent=transcription&model=fish-audio/transcribe-1";
const CONNECT_TIMEOUT_MS = 8_000;

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
  const out = { wav: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--wav" && argv[i + 1]) out.wav = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage:
  node --env-file=.env scripts/probe-fish-asr.mjs [--wav speech.wav]

Env:
  FISH_API_KEY   required
`);
      process.exit(0);
    }
  }
  return out;
}

/** Minimal 24 kHz PCM16 mono WAV saying nothing useful — enough to test the API. */
function syntheticWav() {
  const sampleRate = 24_000;
  const durationSec = 0.4;
  const samples = Math.floor(sampleRate * durationSec);
  const pcm = Buffer.alloc(samples * 2);
  // Quiet tone so the file is non-empty audio, not silence rejected as empty.
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * 440 * t) * 0.08;
    pcm.writeInt16LE(Math.round(sample * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
}

async function probeBatchAsr(apiKey, wavBuf) {
  const form = new FormData();
  form.append("audio", new Blob([wavBuf], { type: "audio/wav" }), "probe.wav");
  form.append("language", "en");
  form.append("ignore_timestamps", "true");

  const started = Date.now();
  const res = await fetch(FISH_ASR_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const elapsed = Date.now() - started;
  const bodyText = await res.text();
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    /* non-json error */
  }

  return {
    ok: res.ok,
    status: res.status,
    elapsedMs: elapsed,
    text: json?.text ?? null,
    language_code: json?.language_code ?? null,
    duration: json?.duration ?? null,
    error: res.ok ? null : bodyText.slice(0, 400),
  };
}

async function probeRealtimeAsr(apiKey) {
  return new Promise((resolve) => {
    const ws = new WebSocket(REALTIME_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      resolve({
        ok: false,
        error: `Timed out after ${CONNECT_TIMEOUT_MS}ms`,
        events: [],
      });
    }, CONNECT_TIMEOUT_MS);

    const events = [];
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        events.push(msg.type ?? "unknown");
        if (msg.type === "transcription_session.created" || msg.type === "session.created") {
          clearTimeout(timer);
          ws.close();
          resolve({ ok: true, events });
        }
        if (msg.type === "error") {
          clearTimeout(timer);
          ws.close();
          resolve({
            ok: false,
            error: msg.error?.message ?? JSON.stringify(msg.error ?? msg),
            events,
          });
        }
      } catch {
        events.push("parse_error");
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, events });
    });
    ws.on("close", (code, reasonBuf) => {
      if (events.some((e) => e === "transcription_session.created" || e === "session.created")) return;
      clearTimeout(timer);
      resolve({
        ok: false,
        error: `Closed ${code} ${reasonBuf?.toString?.() ?? ""}`.trim(),
        events,
      });
    });
  });
}

const apiKey = process.env.FISH_API_KEY?.trim();
if (!apiKey) {
  console.error("Missing FISH_API_KEY — add it to .env or pass --env-file=.env");
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const wavBuf = args.wav ? readFileSync(resolve(args.wav)) : syntheticWav();

console.log("Fish ASR probe");
console.log(`  key: ${apiKey.slice(0, 6)}…${apiKey.slice(-4)} (${apiKey.length} chars)`);
console.log(`  wav: ${args.wav || "synthetic 0.4s tone"} (${wavBuf.byteLength} bytes)`);
console.log("");

console.log("── Batch ASR (POST /v1/asr) ──");
const batch = await probeBatchAsr(apiKey, wavBuf);
if (batch.ok) {
  console.log(`  ✓ ${batch.status} in ${batch.elapsedMs}ms`);
  console.log(`  text: ${JSON.stringify(batch.text)}`);
  console.log(`  language: ${batch.language_code ?? "n/a"}  duration: ${batch.duration ?? "n/a"}s`);
} else {
  console.log(`  ✗ ${batch.status} in ${batch.elapsedMs}ms`);
  console.log(`  ${batch.error}`);
}

console.log("");
console.log("── Realtime ASR (WebSocket ?intent=transcription) ──");
const realtime = await probeRealtimeAsr(apiKey);
if (realtime.ok) {
  console.log(`  ✓ Realtime transcription session available`);
  console.log(`  events: ${realtime.events.join(" → ")}`);
} else {
  console.log(`  ✗ Realtime ASR not available on this account (batch still works)`);
  console.log(`  ${realtime.error}`);
  if (realtime.events.length) console.log(`  events seen: ${realtime.events.join(" → ")}`);
}

console.log("");
console.log("Summary:");
console.log(
  `  Batch /v1/asr: ${batch.ok ? "READY — use sttProvider=fish in WEBEE Native" : "FAILED — check key/billing"}`,
);
console.log(
  `  Realtime WS:   ${realtime.ok ? "ENABLED — WEBEE Native uses streaming Fish STT" : "NOT ENABLED — falls back to batch /v1/asr"}`,
);
