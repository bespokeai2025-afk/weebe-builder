/**
 * Fish Audio speech-to-text for the cascade voice engine.
 *
 * Primary path: OpenAI-compatible Realtime WebSocket with `?intent=transcription`
 * so audio is transcribed as it arrives and `input_audio_buffer.commit` at
 * end-of-speech returns quickly (~100ms in probes).
 *
 * Fallback: `POST /v1/asr` batch transcription when the realtime socket cannot
 * be opened (account rollout, network, mid-call disconnect).
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
import { applyKeywordBoost, keywordBoostPrompt } from "./keyword-boost.shared";
import { buildWav } from "./whisper";
import type { SttOpenOptions, SttProvider, SttSession } from "./types";

const FISH_ASR_URL = "https://api.fish.audio/v1/asr";
const FISH_REALTIME_URL =
  "wss://api.fish.audio/compat/v1/realtime?intent=transcription&model=fish-audio/transcribe-1";
const CONNECT_TIMEOUT_MS = 8_000;
const FINALIZE_TIMEOUT_MS = 2_000;
const TRANSCRIBE_MODEL = "fish-audio/transcribe-1";

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
  keywords?: string[],
): Promise<string> {
  const form = new FormData();
  const bytes = new Uint8Array(wav.byteLength);
  bytes.set(wav);
  form.append("audio", new Blob([bytes], { type: "audio/wav" }), "speech.wav");
  if (language) form.append("language", language.slice(0, 2).toLowerCase());
  const prompt = keywordBoostPrompt(keywords);
  if (prompt) form.append("prompt", prompt);
  form.append("ignore_timestamps", "true");

  const res = await fetch(FISH_ASR_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => String(res.status));
    throw new Error(`Fish ASR ${res.status}: ${body}`);
  }
  const data = (await res.json()) as FishAsrResponse;
  return (data.text ?? "").trim();
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

class FishStreamingSttSession implements SttSession {
  private readonly ws: WebSocket;
  private ready = false;
  private closed = false;
  private latestPartial = "";
  private lastGoodLatinPartial = "";
  private pendingCommit: ((text: string) => void) | null = null;
  private appendedThisUtterance = false;

  private constructor(
    ws: WebSocket,
    private readonly apiKey: string,
    private readonly options: SttOpenOptions,
  ) {
    this.ws = ws;

    ws.on("message", (raw) => {
      let msg: FishRealtimeEvent;
      try {
        msg = JSON.parse(raw.toString()) as FishRealtimeEvent;
      } catch {
        return;
      }

      switch (msg.type) {
        case "transcription_session.created": {
          const lang = this.options.language?.slice(0, 2).toLowerCase();
          const prompt = keywordBoostPrompt(this.options.keywords);
          this.send({
            type: "transcription_session.update",
            session: {
              ...(lang ? { language: lang } : {}),
              input_audio_format: { type: "audio/pcm", rate: this.options.sampleRate },
              turn_detection: null,
              input_audio_transcription: {
                model: TRANSCRIBE_MODEL,
                ...(lang ? { language: lang } : {}),
                ...(prompt ? { prompt } : {}),
              },
            },
          });
          return;
        }

        case "transcription_session.updated":
          this.ready = true;
          return;

        case "conversation.item.input_audio_transcription.delta":
          if (msg.delta) {
            this.latestPartial += msg.delta;
            const partial = applyKeywordBoost(this.latestPartial.trim(), this.options.keywords);
            const lang = this.options.language?.slice(0, 2).toLowerCase();
            const normalized =
              lang === "en" ? normalizeEnglishLockedSttText(partial, lang) : partial;
            if (normalized.length >= 2) this.lastGoodLatinPartial = normalized;
            this.options.onPartial?.(partial);
          }
          return;

        case "conversation.item.input_audio_transcription.completed": {
          const text = applyKeywordBoost(
            String(msg.transcript ?? this.latestPartial).trim(),
            this.options.keywords,
          );
          this.latestPartial = "";
          if (text) this.options.onFinal?.(text);
          this.resolveCommit(text);
          return;
        }

        case "conversation.item.input_audio_transcription.failed":
          this.resolveCommit(this.latestPartial.trim());
          return;

        case "error": {
          const message = msg.error?.message ?? "unknown";
          if (/empty/i.test(message) && !this.appendedThisUtterance) {
            this.resolveCommit(this.lastGoodLatinPartial || this.latestPartial.trim());
            return;
          }
          console.error("[fish-stt] ws error event:", message);
          this.resolveCommit(this.latestPartial.trim());
          return;
        }
      }
    });

    ws.on("error", (err: Error) => {
      console.error("[fish-stt] ws error:", err.message);
      this.resolveCommit(this.latestPartial.trim());
    });

    ws.on("close", () => {
      this.closed = true;
      this.ready = false;
      this.resolveCommit(this.latestPartial.trim());
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

  private resolveCommit(text: string): void {
    if (!this.pendingCommit) return;
    const resolve = this.pendingCommit;
    this.pendingCommit = null;
    resolve(applyKeywordBoost(text, this.options.keywords));
  }

  push(frame: Buffer): void {
    if (!this.ready || this.closed || frame.byteLength === 0) return;
    this.appendedThisUtterance = true;
    this.send({ type: "input_audio_buffer.append", audio: frame.toString("base64") });
  }

  clearInputBuffer(): void {
    if (!this.ready || this.closed) return;
    this.latestPartial = "";
    this.lastGoodLatinPartial = "";
    this.appendedThisUtterance = false;
    this.send({ type: "input_audio_buffer.clear" });
  }

  async finalizeUtterance(frames: Buffer[]): Promise<string> {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      this.appendedThisUtterance = false;
      return this.batchFallback(frames);
    }

    if (!this.appendedThisUtterance) {
      const saved = this.lastGoodLatinPartial || this.latestPartial.trim();
      this.latestPartial = "";
      return saved || this.batchFallback(frames);
    }
    this.appendedThisUtterance = false;

    const flushed = await new Promise<string>((resolve) => {
      this.pendingCommit = resolve;
      this.send({ type: "input_audio_buffer.commit" });
      setTimeout(() => {
        if (this.pendingCommit !== resolve) return;
        this.pendingCommit = null;
        resolve(this.latestPartial.trim());
      }, FINALIZE_TIMEOUT_MS);
    });

    if (flushed) {
      const out = await this.preferEnglishLatinTranscript(flushed, frames);
      this.lastGoodLatinPartial = "";
      return out;
    }
    const batch = await this.batchFallback(frames);
    const out = await this.preferEnglishLatinTranscript(batch, frames);
    this.lastGoodLatinPartial = "";
    return out;
  }

  /** Streaming ASR often ignores language hints; recover via batch, romanization, or partials. */
  private async preferEnglishLatinTranscript(text: string, frames: Buffer[]): Promise<string> {
    const lang = this.options.language?.slice(0, 2).toLowerCase();
    if (lang !== "en" || !text) return text;
    if (isLikelyEnglishSttHallucination(text)) {
      console.warn(`[fish-stt] dropping English hallucination (${text.slice(0, 32)})`);
      return this.recoverEnglishTranscript("", frames);
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
    return this.recoverEnglishTranscript(text, frames);
  }

  private recoverEnglishTranscript(failedFinal: string, frames: Buffer[]): string {
    if (this.lastGoodLatinPartial) {
      console.warn(
        `[fish-stt] using Latin partial after failed final (${failedFinal.slice(0, 32) || "empty"}) → ${this.lastGoodLatinPartial.slice(0, 32)}`,
      );
      const saved = this.lastGoodLatinPartial;
      this.lastGoodLatinPartial = "";
      return saved;
    }
    return "";
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
