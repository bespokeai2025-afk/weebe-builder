#!/usr/bin/env node
/**
 * Run a WEBEE Native test call with a synthetic caller and report the latency of every turn.
 *
 *   node --env-file=.env scripts/probe-voice-latency.mjs --agent <agent uuid> \
 *     [--url ws://localhost:5003] [--stt deepgram] [--tts cartesia] [--model gpt-4.1-mini]
 *     [--turns 22] [--label name] [--set deepgramSttModel=flux-general-en ...]
 *
 * `--set key=value` (repeatable) overrides any agent setting for this call only; numbers and
 * true/false are parsed.
 *
 * It talks to the same relay the builder's browser test call uses (/api/el-voice-relay): it sends
 * `session.init` for the saved agent (optionally with the listening/speaking provider overridden
 * for this call only — the saved agent is not changed), streams caller audio in real time, and
 * reports `playback.done` once the agent's audio would have finished playing, as the browser does.
 *
 * The caller's lines are spoken by OpenAI text-to-speech. Each reply is picked from what the agent
 * just said (see ANSWERS); edit that list for a different flow. Nothing is played back, so there is
 * no speaker echo — what is measured is the engine and its providers.
 *
 * Measured here: caller's last word (end of the clip's speech, trailing silence excluded) → first
 * agent audio received. The engine's own per-stage numbers are in `call_turns` for the call id
 * printed at the end.
 */
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const SAMPLE_RATE = 24_000;
const CHUNK_MS = 50;
const CHUNK_BYTES = (SAMPLE_RATE * 2 * CHUNK_MS) / 1000;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const agentId = arg("agent");
const relayUrl = `${arg("url", "ws://localhost:5003")}/api/el-voice-relay`;
const sttOverride = arg("stt");
const ttsOverride = arg("tts");
const maxTurns = Number(arg("turns", "22"));
const label = arg("label", `${sttOverride ?? "saved"}+${ttsOverride ?? "saved"}`);
/** Gap between the agent finishing and the caller answering — a prompt human. */
const answerGapMs = Number(arg("gap", "350"));

if (!agentId) {
  console.error("Usage: node --env-file=.env scripts/probe-voice-latency.mjs --agent <uuid> [...]");
  process.exit(1);
}
for (const key of ["OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) {
    console.error(`${key} is not set (run with --env-file=.env)`);
    process.exit(1);
  }
}
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

/** What the caller says, chosen by the first pattern the agent's last line matches. */
const ANSWERS = [
  [/calendar|available slot|day and time/i, null], // stop before anything gets booked
  // Business-funding (MCA-style) flows — matched first, they are specific.
  [/get funded|funding today/i, "Yes."],
  [/EIN or .*social security|social security number used for the business/i, "It's an EIN."],
  [/social security number/i, "Five two nine, one two, five zero one one."],
  [/\bEIN\b|tax id/i, "One two three, four five, six seven eight nine."],
  [/amount.*(request|looking)|how much (funding|are you)/i, "Fifty thousand dollars."],
  [/business (was )?started|start date/i, "In 2019."],
  [/business name/i, "Ram Realtors."],
  [/home number|alternate number/i, "Five one two, five five five, one two three four."],
  [/type of business|business do you operate/i, "It's a real estate business."],
  [/monthly revenue/i, "About forty thousand a month."],
  [/business address/i, "123 Main Street, Dallas, Texas, 75201."],
  [/home address/i, "12 Elm Street, Austin, Texas, 73301."],
  [/percentage|how much of the business/i, "Sixty percent."],
  [/date of birth/i, "The twenty eighth of December, 1990."],
  [/upload link|do you see it/i, "Yes, I see it."],
  [/send them now|stay on the line/i, "Sure."],
  [/correct\?|is that (all )?(correct|right)|just to (confirm|recap)|to recap|confirm/i, "Yes, that's right."],
  [/sound (ok|okay|good)|will that be (ok|okay)|is that (ok|okay)\?/i, "Yes."],
  [/mobile|phone number/i, "Oh seven seven double oh, nine hundred, one two three."],
  [/first name/i, "Arjav."],
  [/title|mr, mrs/i, "Mister."],
  [/last name|surname/i, "Virani."],
  [/email/i, "arjav at gmail dot com"],
  [/same as your property/i, "Yes."],
  [/address|postcode/i, "12 High Street, Manchester, M1 1AA."],
  [/type of property/i, "It's a house."],
  [/vacant|rented|empty|living there/i, "It's vacant."],
  [/freehold|leasehold/i, "Freehold."],
  [/commercial/i, "No."],
  [/decision maker/i, "Just me."],
  [/timeframe|time frame/i, "As soon as possible."],
  [/on the market\?/i, "No."],
  [/affect what we are able|affect the offer/i, "Okay, no problem."],
  [/how does that sound|next step/i, "Sounds great."],
  [/.*/, "Yes."],
];

const sb = (path, init = {}) =>
  fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.headers ?? {}),
    },
  }).then((r) => r.json());

const clipCache = new Map();
/** The caller's line as 24 kHz PCM16, and where its speech actually ends. */
async function callerClip(text) {
  if (clipCache.has(text)) return clipCache.get(text);
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "ash", input: text, response_format: "pcm" }),
  });
  if (!res.ok) throw new Error(`caller TTS ${res.status}: ${await res.text()}`);
  const pcm = Buffer.from(await res.arrayBuffer());
  // Last sample louder than the noise floor: the caller's real last word.
  let speechEnd = pcm.length / 2;
  while (speechEnd > 0 && Math.abs(pcm.readInt16LE((speechEnd - 1) * 2)) < 400) speechEnd--;
  const clip = { pcm, speechEndMs: (speechEnd / SAMPLE_RATE) * 1000 };
  clipCache.set(text, clip);
  return clip;
}

const agent = (await sb(`agents?select=settings&id=eq.${agentId}`))?.[0];
if (!agent) {
  console.error(`agent ${agentId} not found`);
  process.exit(1);
}
const settings = { ...agent.settings };
if (sttOverride) settings.webeeSttProvider = sttOverride;
if (ttsOverride) settings.webeeTtsProvider = ttsOverride;
const modelOverride = arg("model");
if (modelOverride) settings.webeeSpeechModel = modelOverride;
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] !== "--set") continue;
  const [key, ...rest] = String(process.argv[i + 1] ?? "").split("=");
  if (!key || rest.length === 0) continue;
  const raw = rest.join("=");
  settings[key] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw === "true" ? true : raw === "false" ? false : raw;
}

const sessionId = randomUUID();
const ws = new WebSocket(relayUrl);
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

// ── Caller audio: a steady real-time stream, silence unless a line is queued ──────────────────
let outgoing = Buffer.alloc(0);
let lineEndsAt = null; // wall time the queued line's last word is sent
let pendingLine = null;
const silence = Buffer.alloc(CHUNK_BYTES);
let nextTick = Date.now();
function pump() {
  if (ws.readyState !== WebSocket.OPEN) return;
  let chunk = silence;
  if (outgoing.length > 0) {
    chunk = Buffer.alloc(CHUNK_BYTES);
    outgoing.copy(chunk, 0, 0, Math.min(CHUNK_BYTES, outgoing.length));
    outgoing = outgoing.subarray(Math.min(CHUNK_BYTES, outgoing.length));
  }
  ws.send(JSON.stringify({ type: "audio.chunk", data: chunk.toString("base64") }));
  nextTick += CHUNK_MS;
  setTimeout(pump, Math.max(0, nextTick - Date.now()));
}

async function say(text) {
  const clip = await callerClip(text);
  outgoing = Buffer.concat([outgoing, clip.pcm]);
  // Queued behind nothing (we only answer once the agent is quiet), so it starts on the next tick.
  lineEndsAt = Date.now() + CHUNK_MS + clip.speechEndMs;
  pendingLine = { text, endsAt: lineEndsAt, firstAudioAt: null };
  log(`caller: "${text}"`);
}

// ── Agent side: simulated playback, so playback.done goes out when the browser would send it ───
let playEndAt = 0;
let lastAudioAt = 0;
let agentLine = "";
let agentLinesSinceAnswer = [];
let doneTimer = null;
const results = [];
let turns = 0;
let ended = false;

function schedulePlaybackDone() {
  clearTimeout(doneTimer);
  doneTimer = setTimeout(() => {
    ws.send(JSON.stringify({ type: "playback.done" }));
    maybeAnswer();
  }, Math.max(0, playEndAt - Date.now()) + 150);
}

let answering = false;
function maybeAnswer() {
  if (answering || ended) return;
  answering = true;
  // The agent is quiet once nothing new has arrived for a moment after its playback ended.
  const check = setInterval(async () => {
    const quietFor = Date.now() - Math.max(playEndAt, lastAudioAt);
    if (quietFor < 900 || outgoing.length > 0) return;
    if (agentLinesSinceAnswer.length === 0 && turns > 0) return; // still waiting on its reply
    clearInterval(check);
    const heard = agentLinesSinceAnswer.join(" ");
    agentLinesSinceAnswer = [];
    // Answer the question the agent ended on, not every word of a long line ("…in a timeframe that
    // suits you. Does that all sound ok?" is a yes/no question, not a timeframe one).
    const lastQuestion = heard.match(/[^.?!]*\?[^?]*$/)?.[0] ?? heard;
    const reply = (ANSWERS.find(([re]) => re.test(lastQuestion)) ?? ANSWERS.find(([re]) => re.test(heard)))?.[1];
    if (reply === null || turns >= maxTurns) {
      finish(reply === null ? "reached the calendar step" : "turn limit");
      return;
    }
    await new Promise((r) => setTimeout(r, answerGapMs));
    turns += 1;
    await say(reply);
    answering = false;
  }, 100);
}

ws.on("open", () => {
  log(`connected — ${label}, call ${sessionId}`);
  ws.send(
    JSON.stringify({
      type: "session.init",
      voiceId: settings.webeeVoiceId,
      systemPrompt: "",
      beginMessage: settings.beginMessage ?? "",
      agentId,
      sessionId,
      settings,
      speechLanguages: settings.speechLanguages ?? [settings.language ?? "en-US"],
      silenceDurationMs: settings.hyperstreamSilenceDurationMs,
      responsiveness: settings.responsiveness,
      interruptionSensitivity: settings.interruptionSensitivity,
      boostedKeywords: settings.boostedKeywords,
      ttsProvider: settings.webeeTtsProvider,
      sttProvider: settings.webeeSttProvider,
      variables: {},
      startSpeaker: settings.startSpeaker,
    }),
  );
  nextTick = Date.now();
  pump();
  setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" })), 5000);
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  switch (msg.type) {
    case "relay.connected":
      log(`relay: mode=${msg.mode} stt=${msg.stt} tts=${msg.tts}`);
      maybeAnswer();
      break;
    case "audio.delta": {
      const bytes = Buffer.from(msg.data, "base64").length;
      const now = Date.now();
      if (pendingLine && !pendingLine.firstAudioAt && now > pendingLine.endsAt) {
        pendingLine.firstAudioAt = now;
        const ms = now - pendingLine.endsAt;
        results.push({ text: pendingLine.text, ms });
        log(`  → first agent audio ${ms} ms after "${pendingLine.text}"`);
      }
      lastAudioAt = now;
      playEndAt = Math.max(playEndAt, now) + (bytes / 2 / SAMPLE_RATE) * 1000;
      schedulePlaybackDone();
      break;
    }
    case "audio.clear":
      playEndAt = Date.now();
      break;
    case "transcript":
      if (msg.role === "agent") {
        agentLine = msg.text;
        agentLinesSinceAnswer.push(msg.text);
        log(`agent: ${String(msg.text).slice(0, 110)}`);
      } else {
        log(`  (engine heard: "${msg.text}")`);
      }
      break;
    case "relay.error":
      log(`relay error: ${msg.message}`);
      break;
    case "call.ended":
      finish(`agent ended the call (${msg.reason})`);
      break;
  }
});
ws.on("close", () => finish("socket closed"));
ws.on("error", (e) => {
  console.error(`socket error: ${e.message}`);
  process.exit(1);
});

let finished = false;
async function finish(reason) {
  if (finished) return;
  finished = ended = true;
  log(`ending: ${reason}`);
  try {
    ws.close();
  } catch {}
  // Let the engine write its last turn rows.
  await new Promise((r) => setTimeout(r, 4000));
  const rows = await sb(
    `call_turns?select=turn_index,node_id,voice_end_to_first_audio_ms,end_of_speech_wait_ms,stt_to_first_token_ms,stt_to_first_audio_ms,speculative_hit,partial_commit,llm_model,prompt_chars&call_id=eq.${sessionId}&order=turn_index`,
  );
  const sorted = (a) => [...a].sort((x, y) => x - y);
  const median = (a) => (a.length ? sorted(a)[Math.floor(a.length / 2)] : null);
  const client = results.map((r) => r.ms);
  const heard = (Array.isArray(rows) ? rows : []).map((r) => r.voice_end_to_first_audio_ms).filter((v) => v != null);
  console.log(`\n=== ${label} — call ${sessionId}`);
  console.log(`client-measured: n=${client.length} median=${median(client)} ms  min=${Math.min(...client)}  max=${Math.max(...client)}`);
  console.log(`engine (call_turns): n=${heard.length} median=${median(heard)} ms`);
  console.log(JSON.stringify({ label, sessionId, client: results, turns: rows }));
  process.exit(0);
}
