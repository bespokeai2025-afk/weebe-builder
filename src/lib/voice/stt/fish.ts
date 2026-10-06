/**
 * Fish Audio speech-to-text for the cascade voice engine.
 *
 * Primary path: Fish's OpenAI-compatible Realtime WebSocket opened with `?intent=transcription`
 * (docs.fish.audio/developer-guide/compat/realtime-protocol). Audio is appended as it arrives and
 * `input_audio_buffer.commit` at end-of-speech returns the transcript. That socket serves only
 * `fish-audio/transcribe-1` (asking for `transcribe-1-pro` is refused with HTTP 400), sends NO
 * partial transcripts, and answered commit in 536–771ms when measured — so turns cannot start
 * routing or generating before the caller finishes. Delta events are still handled in case Fish
 * adds them.
 *
 * Fallback: `POST /v1/asr` batch transcription when the realtime socket cannot be opened
 * (network, mid-call disconnect) or returns nothing.
 *
 * Fish ignores `prompt` / keyword hints on both paths, so keyword boosting here is only the local
 * post-correction in `applyKeywordBoost`.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

import { WebSocket } from "ws";
import {
  isLikelyEnglishSttHallucination,
  isMostlyNonLatinScript,
  normalizeEnglishLockedSttText,
  romanizeForEnglishStt,
} from "../language-lock.shared";
import { applyKeywordBoost } from "./keyword-boost.shared";
import { buildWav } from "./whisper";
import type { SttOpenOptions, SttProvider, SttSession } from "./types";

const FISH_ASR_URL = "https://api.fish.audio/v1/asr";
const FISH_REALTIME_URL =
  "wss://api.fish.audio/compat/v1/realtime?intent=transcription&model=fish-audio/transcribe-1";
const CONNECT_TIMEOUT_MS = 8_000;
const FINALIZE_TIMEOUT_MS = 2_000;
const TRANSCRIBE_MODEL = "fish-audio/transcribe-1";
/**
 * Batch model, sent in the `model` header. Without the header Fish silently serves (and bills)
 * `transcribe-1`; naming it keeps that explicit. `transcribe-1-pro` is no slower on short clips but
 * adds speaker markers to the text, which `cleanFishTranscript` strips.
 */
const BATCH_MODEL = "transcribe-1";
/** One quick retry on 429 / 5xx: Fish sends no Retry-After, and a live turn cannot wait long. */
const BATCH_RETRY_DELAY_MS = 250;

/** Strip `transcribe-1-pro` speaker markers (`<|speaker:0|>`) so only spoken words remain. */
export function cleanFishTranscript(text: string): string {
  return text.replace(/<\|speaker:\d+\|>/g, " ").replace(/\s+/g, " ").trim();
}

export interface FishAsrResponse {
  text: string;
  duration: number;
  language_code?: string | null;
  segments?: Array<{ text: string; start: number; end: number }>;
}

interface FishRealtimeEvent {
  type?: string;
  transcript?: string;
  delta?: string;
  error?: { message?: string };
}

export async function fishTranscribe(
  wav: Buffer,
  apiKey: string,
  language?: string,
  _keywords?: string[],
): Promise<string> {
  const send = async (): Promise<Response> => {
    const form = new FormData();
    const bytes = new Uint8Array(wav.byteLength);
    bytes.set(wav);
    form.append("audio", new Blob([bytes], { type: "audio/wav" }), "speech.wav");
    // Lowercase ISO 639-1 only; forms like `en-US` can be rejected with 400.
    if (language) form.append("language", language.slice(0, 2).toLowerCase());
    form.append("ignore_timestamps", "true");
    return fetch(FISH_ASR_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, model: BATCH_MODEL },
      body: form,
    });
  };

  let res = await send();
  if (res.status === 429 || res.status >= 500) {
    await res.body?.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, BATCH_RETRY_DELAY_MS));
    res = await send();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => String(res.status));
    const requestId = res.headers.get("x-request-id");
    throw new Error(`Fish ASR ${res.status}${requestId ? ` (${requestId})` : ""}: ${body}`);
  }
  const data = (await res.json()) as FishAsrResponse;
  return cleanFishTranscript(data.text ?? "");
}

class FishBatchSttSession implements SttSession {
  constructor(
    private readonly apiKey: string,
    private readonly options: SttOpenOptions,
  ) {}

  push(): void {}

  clearInputBuffer(): void {}

  async finalizeUtterance(frames: Buffer[]): Promise<string> {
    if (frames.length === 0) return "";
    const text = applyKeywordBoost(
      await fishTranscribe(
        buildWav(frames, this.options.sampleRate),
        this.apiKey,
        this.options.language,
        this.options.keywords,
      ),
      this.options.keywords,
    );
    if (text) this.options.onFinal?.(text);
    return text;
  }

  close(): void {}
}

/** Pause inside an utterance that triggers a speculative full-utterance transcription. */
export const FISH_SPECULATIVE_PAUSE_MS = 200;
/** Audio kept before the first detected speech, so the onset is never clipped. */
const PRE_SPEECH_KEEP_MS = 400;
/** Recent frames the noise floor is estimated from (the quietest of them). */
const NOISE_WINDOW_FRAMES = 40;
/** Speech must stand this far above the floor, and never below the absolute minimum. */
const SPEECH_SNR = 3;
const SPEECH_MIN_RMS = 250;
/** Raw bytes per `input_audio_buffer.append` frame (well under Fish's 32 MiB frame limit). */
const APPEND_CHUNK_BYTES = 256 * 1024;

function frameRms(chunk: Buffer): number {
  const samples = Math.floor(chunk.byteLength / 2);
  if (samples === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples * 2; i += 2) {
    const v = chunk.readInt16LE(i);
    sum += v * v;
  }
  return Math.sqrt(sum / samples);
}

interface FishCommit {
  generation: number;
  /** Utterance bytes this commit's audio covered. */
  coveredBytes: number;
}

/**
 * Realtime Fish session with speculative full-utterance commits.
 *
 * Fish's realtime socket only transcribes on `commit` and never sends partials. Streaming audio
 * and committing once at end-of-speech therefore put the whole transcription (~0.5–0.8s) after the
 * caller stopped, and left every pre-endpoint optimisation in the cascade (partial-driven routing
 * and speech warm-up, adaptive endpointing) with nothing to work from.
 *
 * Instead the session buffers the caller's audio and, at every short pause, sends the WHOLE
 * utterance so far as a fresh item and commits it. Each result is a full-context transcript of
 * everything said up to that pause, reported as a partial. When end-of-speech arrives with no new
 * speech since the last commit — the usual case, since the endpoint fires after a pause — that
 * result is the final transcript, often already back. Measured on the same clips: final ready
 * 747–1018ms after the caller's last word, against 1188–1473ms committing once at the end, with
 * identical text. Committing only the new audio at each pause was faster still but split phrases
 * ("joe.gilmartin.1000@gmail.com" came back as "Joe Gil Martin? 1000 at gmail dot com").
 *
 * Re-sending earlier audio costs only transcription time ($0.36/audio hour).
 */
class FishStreamingSttSession implements SttSession {
  private readonly ws: WebSocket;
  private ready = false;
  private closed = false;

  /** Bumped whenever the utterance resets; results for older generations are ignored. */
  private generation = 0;
  private frames: Buffer[] = [];
  private bytes = 0;
  /** Byte offset where the first speech frame starts, or -1 before any speech. */
  private firstSpeechByte = -1;
  /** Byte offset where the last speech frame ends. */
  private lastSpeechEnd = 0;
  private silentMs = 0;
  private speechSinceCommit = false;
  private readonly floorWindow: number[] = [];

  /** Commits sent but not yet acknowledged with `input_audio_buffer.committed`. */
  private readonly unacked: FishCommit[] = [];
  private readonly byItem = new Map<string, FishCommit>();
  /** Latest commit sent this generation (what a final must wait for). */
  private lastCommit: FishCommit | null = null;
  /** Best transcript this generation and the bytes it covers. */
  private latest: { coveredBytes: number; text: string } = { coveredBytes: 0, text: "" };
  private waiters: Array<() => void> = [];

  private constructor(
    ws: WebSocket,
    private readonly apiKey: string,
    private readonly options: SttOpenOptions,
  ) {
    this.ws = ws;

    ws.on("message", (raw) => {
      let msg: FishRealtimeEvent & { item_id?: string };
      try {
        msg = JSON.parse(raw.toString()) as FishRealtimeEvent & { item_id?: string };
      } catch {
        return;
      }

      switch (msg.type) {
        case "transcription_session.created": {
          const lang = this.options.language?.slice(0, 2).toLowerCase();
          this.send({
            type: "transcription_session.update",
            session: {
              ...(lang ? { language: lang } : {}),
              input_audio_format: { type: "audio/pcm", rate: this.options.sampleRate },
              turn_detection: null,
              input_audio_transcription: {
                model: TRANSCRIBE_MODEL,
                ...(lang ? { language: lang } : {}),
              },
            },
          });
          return;
        }

        case "transcription_session.updated":
          this.ready = true;
          return;

        case "input_audio_buffer.committed": {
          const commit = this.unacked.shift();
          if (commit && msg.item_id) this.byItem.set(msg.item_id, commit);
          return;
        }

        case "conversation.item.input_audio_transcription.completed": {
          const commit = msg.item_id ? this.byItem.get(msg.item_id) : undefined;
          if (msg.item_id) this.byItem.delete(msg.item_id);
          if (commit) this.acceptResult(commit, String(msg.transcript ?? ""));
          this.wake();
          return;
        }

        case "conversation.item.input_audio_transcription.failed":
          if (msg.item_id) this.byItem.delete(msg.item_id);
          this.wake();
          return;

        case "error": {
          console.error("[fish-stt] ws error event:", msg.error?.message ?? "unknown");
          // A refused commit never gets `committed`; drop it so a final does not wait on it.
          this.unacked.shift();
          this.wake();
          return;
        }
      }
    });

    ws.on("error", (err: Error) => {
      console.error("[fish-stt] ws error:", err.message);
      this.wake();
    });

    ws.on("close", () => {
      this.closed = true;
      this.ready = false;
      this.wake();
    });
  }

  static async connect(apiKey: string, options: SttOpenOptions): Promise<FishStreamingSttSession> {
    const ws = new WebSocket(FISH_REALTIME_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    // Swallow late errors after a failed connect (common in tests / sandboxed network).
    ws.on("error", () => {});

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`Fish streaming ASR did not connect within ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS);

      ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once("error", (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const session = new FishStreamingSttSession(ws, apiKey, options);
    await session.awaitReady();
    return session;
  }

  private awaitReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Fish streaming ASR session did not become ready"));
      }, CONNECT_TIMEOUT_MS);

      const check = setInterval(() => {
        if (this.ready) {
          clearTimeout(timer);
          clearInterval(check);
          resolve();
        }
        if (this.closed) {
          clearTimeout(timer);
          clearInterval(check);
          reject(new Error("Fish streaming ASR closed before ready"));
        }
      }, 10);
    });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  private acceptResult(commit: FishCommit, transcript: string): void {
    if (commit.generation !== this.generation) return;
    if (commit.coveredBytes < this.latest.coveredBytes) return;
    const text = applyKeywordBoost(cleanFishTranscript(transcript), this.options.keywords);
    this.latest = { coveredBytes: commit.coveredBytes, text };
    if (text) this.options.onPartial?.(text);
  }

  private isSpeech(frame: Buffer): boolean {
    const level = frameRms(frame);
    const floor = this.floorWindow.length ? Math.min(...this.floorWindow) : 0;
    const speech = level > Math.max(SPEECH_MIN_RMS, floor * SPEECH_SNR);
    // Track the floor from non-speech frames only, so a long utterance cannot raise it.
    if (!speech) {
      this.floorWindow.push(level);
      if (this.floorWindow.length > NOISE_WINDOW_FRAMES) this.floorWindow.shift();
    }
    return speech;
  }

  private bytesToMs(bytes: number): number {
    return (bytes / (this.options.sampleRate * 2)) * 1000;
  }

  /** Audio from just before the first speech to the end of what has been buffered. */
  private utteranceAudio(): Buffer {
    const all = Buffer.concat(this.frames);
    if (this.firstSpeechByte < 0) return all;
    const keep = Math.floor((PRE_SPEECH_KEEP_MS / 1000) * this.options.sampleRate) * 2;
    return all.subarray(Math.max(0, this.firstSpeechByte - keep));
  }

  /** Send the whole utterance so far as one fresh item and commit it. */
  private commitUtterance(): void {
    const audio = this.utteranceAudio();
    if (audio.byteLength === 0) return;
    for (let off = 0; off < audio.byteLength; off += APPEND_CHUNK_BYTES) {
      this.send({
        type: "input_audio_buffer.append",
        audio: audio.subarray(off, off + APPEND_CHUNK_BYTES).toString("base64"),
      });
    }
    // Recorded before sending, so an acknowledgement can never arrive ahead of its entry.
    const commit: FishCommit = { generation: this.generation, coveredBytes: this.bytes };
    this.unacked.push(commit);
    this.lastCommit = commit;
    this.speechSinceCommit = false;
    this.send({ type: "input_audio_buffer.commit" });
  }

  push(frame: Buffer): void {
    if (!this.ready || this.closed || frame.byteLength === 0) return;
    const start = this.bytes;
    this.frames.push(frame);
    this.bytes += frame.byteLength;

    if (this.isSpeech(frame)) {
      if (this.firstSpeechByte < 0) this.firstSpeechByte = start;
      this.lastSpeechEnd = this.bytes;
      this.speechSinceCommit = true;
      this.silentMs = 0;
      return;
    }

    if (this.firstSpeechByte < 0) {
      // Nothing said yet: keep only the pre-speech window so a long wait doesn't pile up audio.
      const keepBytes = Math.floor((PRE_SPEECH_KEEP_MS / 1000) * this.options.sampleRate) * 2;
      while (this.frames.length > 1 && this.bytes - this.frames[0]!.byteLength >= keepBytes) {
        this.bytes -= this.frames.shift()!.byteLength;
      }
      return;
    }

    this.silentMs += this.bytesToMs(frame.byteLength);
    if (this.speechSinceCommit && this.silentMs >= FISH_SPECULATIVE_PAUSE_MS) {
      this.commitUtterance();
    }
  }

  private resetUtterance(): void {
    this.generation++;
    this.frames = [];
    this.bytes = 0;
    this.firstSpeechByte = -1;
    this.lastSpeechEnd = 0;
    this.silentMs = 0;
    this.speechSinceCommit = false;
    this.lastCommit = null;
    this.latest = { coveredBytes: 0, text: "" };
  }

  clearInputBuffer(): void {
    this.resetUtterance();
    this.wake();
  }

  /** Wait until the latest commit's transcript is in, or the timeout passes. */
  private async awaitCommit(commit: FishCommit): Promise<void> {
    const deadline = Date.now() + FINALIZE_TIMEOUT_MS;
    while (
      !this.closed &&
      commit.generation === this.generation &&
      this.latest.coveredBytes < commit.coveredBytes &&
      (this.unacked.includes(commit) || [...this.byItem.values()].includes(commit))
    ) {
      const left = deadline - Date.now();
      if (left <= 0) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  async finalizeUtterance(frames: Buffer[]): Promise<string> {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      this.resetUtterance();
      return this.batchFallback(frames);
    }

    // New speech since the last speculative commit (or none was made): commit everything now.
    // Otherwise the last commit already covers every word, and its result is the final.
    const covered = this.lastCommit?.coveredBytes ?? 0;
    if (this.speechSinceCommit || !this.lastCommit || covered < this.lastSpeechEnd) {
      this.commitUtterance();
    }
    const commit = this.lastCommit;
    if (commit) await this.awaitCommit(commit);

    const got =
      commit && this.latest.coveredBytes >= commit.coveredBytes ? this.latest.text : "";
    const partial = this.latest.text;
    this.resetUtterance();

    if (got) return this.preferEnglishLatinTranscript(got, frames, partial);
    const batch = await this.batchFallback(frames);
    return this.preferEnglishLatinTranscript(batch, frames, partial);
  }

  /** Streaming ASR often ignores language hints; recover via batch, romanization, or partials. */
  private async preferEnglishLatinTranscript(
    text: string,
    frames: Buffer[],
    partial: string,
  ): Promise<string> {
    const lang = this.options.language?.slice(0, 2).toLowerCase();
    if (lang !== "en" || !text) return text || this.usablePartial(partial);
    if (isLikelyEnglishSttHallucination(text)) {
      console.warn(`[fish-stt] dropping English hallucination (${text.slice(0, 32)})`);
      return this.usablePartial(partial, text);
    }
    if (!isMostlyNonLatinScript(text)) return text;

    const batch = await this.batchFallback(frames);
    if (batch && !isMostlyNonLatinScript(batch) && !isLikelyEnglishSttHallucination(batch)) {
      console.warn(
        `[fish-stt] streaming non-Latin (${text.slice(0, 32)}); batch → ${batch.slice(0, 32)}`,
      );
      return batch;
    }

    const romanized = romanizeForEnglishStt(text) || (batch ? romanizeForEnglishStt(batch) : "");
    if (romanized) {
      console.warn(
        `[fish-stt] romanized non-Latin (${text.slice(0, 32)}) → ${romanized.slice(0, 32)}`,
      );
      return romanized;
    }

    console.warn(`[fish-stt] dropping unusable English transcript (${text.slice(0, 32)})`);
    return this.usablePartial(partial, text);
  }

  /** An earlier speculative transcript, when the final one is unusable. */
  private usablePartial(partial: string, failedFinal = ""): string {
    const lang = this.options.language?.slice(0, 2).toLowerCase();
    const p = partial.trim();
    if (!p || p === failedFinal.trim()) return "";
    if (lang === "en" && (isMostlyNonLatinScript(p) || isLikelyEnglishSttHallucination(p))) return "";
    console.warn(
      `[fish-stt] using earlier transcript after failed final (${failedFinal.slice(0, 32) || "empty"}) → ${p.slice(0, 32)}`,
    );
    return normalizeEnglishLockedSttText(p, lang ?? "");
  }

  private async batchFallback(frames: Buffer[]): Promise<string> {
    if (frames.length === 0) return "";
    try {
      return applyKeywordBoost(
        await fishTranscribe(
          buildWav(frames, this.options.sampleRate),
          this.apiKey,
          this.options.language,
          this.options.keywords,
        ),
        this.options.keywords,
      );
    } catch (err) {
      console.error("[fish-stt] batch fallback failed:", (err as Error).message);
      return "";
    }
  }

  close(): void {
    this.closed = true;
    this.wake();
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

export class FishSttProvider implements SttProvider {
  readonly name = "fish";
  readonly streaming = true;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("FishSttProvider requires an API key");
  }

  async open(options: SttOpenOptions): Promise<SttSession> {
    try {
      return await FishStreamingSttSession.connect(this.apiKey, options);
    } catch (err) {
      console.warn(
        `[fish-stt] streaming unavailable (${(err as Error).message}); using batch /v1/asr`,
      );
      return new FishBatchSttSession(this.apiKey, options);
    }
  }
}
