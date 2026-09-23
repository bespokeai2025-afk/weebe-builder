/**
 * OpenAI text-to-speech for the WEBEE native voice engine.
 *
 * `/v1/audio/speech` with `response_format: "pcm"` returns raw PCM16 mono at a fixed 24 kHz, which
 * is exactly what browser playback wants. Telephony asks for 8 kHz, so anything other than 24 kHz
 * is resampled here — the provider contract is "PCM16 mono at the requested rate", and a caller
 * that got 24 kHz audio while expecting 8 kHz would play it at three times speed.
 *
 * Unlike Fish there is no input streaming: the endpoint needs a complete string. `synthesizeStream`
 * therefore batches the token stream into clauses and synthesises each one, which is what keeps the
 * first words playing before the model has finished its sentence.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */
import { alignPcm16, batchForVoiceLatency, normalizeSpeechText } from "./types";
import type { PcmChunk, TtsProvider, TtsVoiceRequest } from "./types";
import {
  OPENAI_TTS_DEFAULT_MODEL,
  OPENAI_TTS_DEFAULT_VOICE,
  OPENAI_TTS_VOICES,
  isOpenAiTtsVoice,
} from "./openai-voices.shared";

/** Native output rate of /v1/audio/speech in PCM mode. */
const OPENAI_TTS_SAMPLE_RATE = 24_000;

export {
  OPENAI_TTS_DEFAULT_MODEL,
  OPENAI_TTS_DEFAULT_VOICE,
  OPENAI_TTS_VOICES,
} from "./openai-voices.shared";

export function resolveOpenAiTtsVoice(voiceId: string | null | undefined): string {
  const raw = String(voiceId ?? "").trim().toLowerCase();
  // A Fish reference_id or an ElevenLabs voice id means nothing here; falling back beats a 400
  // mid-call.
  return isOpenAiTtsVoice(raw) ? raw : OPENAI_TTS_DEFAULT_VOICE;
}

export function resolveOpenAiTtsModel(model?: string | null): string {
  const raw = String(model ?? "").trim();
  return raw || OPENAI_TTS_DEFAULT_MODEL;
}

/**
 * Resample PCM16 mono between rates.
 *
 * 24 kHz → 8 kHz is an exact 3:1 decimation; other ratios fall back to linear interpolation, which
 * is adequate for speech at these rates and costs nothing in dependencies.
 */
export function resamplePcm16(pcm: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate || pcm.byteLength < 2) return pcm;
  const inSamples = Math.floor(pcm.byteLength / 2);
  const ratio = toRate / fromRate;
  const outSamples = Math.max(1, Math.floor(inSamples * ratio));
  const out = Buffer.alloc(outSamples * 2);

  for (let i = 0; i < outSamples; i++) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, inSamples - 1);
    const frac = srcPos - i0;
    const s0 = pcm.readInt16LE(i0 * 2);
    const s1 = pcm.readInt16LE(i1 * 2);
    const value = Math.round(s0 + (s1 - s0) * frac);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, value)), i * 2);
  }
  return out;
}

export class OpenAiTtsProvider implements TtsProvider {
  readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly defaults: { model?: string | null; instructions?: string | null } = {},
  ) {
    if (!apiKey) throw new Error("OpenAI TTS requires OPENAI_API_KEY");
  }

  async *synthesize(text: string, req: TtsVoiceRequest): AsyncGenerator<PcmChunk> {
    const speech = normalizeSpeechText(text);
    if (!speech) return;
    yield* alignPcm16(this.stream(speech, req));
  }

  async *synthesizeStream(
    textStream: AsyncIterable<string>,
    req: TtsVoiceRequest,
  ): AsyncGenerator<PcmChunk> {
    // No native input streaming: synthesise clause by clause so audio starts early.
    for await (const segment of batchForVoiceLatency(textStream)) {
      const speech = normalizeSpeechText(segment);
      if (!speech) continue;
      yield* alignPcm16(this.stream(speech, req));
    }
  }

  private async *stream(text: string, req: TtsVoiceRequest): AsyncGenerator<Buffer> {
    const body: Record<string, unknown> = {
      model: resolveOpenAiTtsModel(req.model ?? this.defaults.model),
      voice: resolveOpenAiTtsVoice(req.voiceId),
      input: text,
      response_format: "pcm",
    };
    // Only the gpt-4o-*-tts models accept a delivery instruction; tts-1 rejects it.
    const instructions = this.defaults.instructions?.trim();
    if (instructions && /^gpt-4o/.test(String(body.model))) body.instructions = instructions;
    if (typeof req.speed === "number" && Number.isFinite(req.speed)) {
      body.speed = Math.max(0.25, Math.min(4, req.speed));
    }

    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => String(res.status));
      throw new Error(`OpenAI TTS ${res.status}: ${detail.slice(0, 300)}`);
    }

    const target = req.sampleRate || OPENAI_TTS_SAMPLE_RATE;
    const reader = res.body.getReader();
    // Resampling has to see whole samples, and a chunk can end mid-sample.
    let carry: Buffer | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      let buf = Buffer.from(value);
      if (carry) buf = Buffer.concat([carry, buf]);
      const aligned = buf.byteLength - (buf.byteLength % 2);
      carry = aligned < buf.byteLength ? buf.subarray(aligned) : null;
      if (aligned <= 0) continue;
      yield resamplePcm16(buf.subarray(0, aligned), OPENAI_TTS_SAMPLE_RATE, target);
    }
  }
}
