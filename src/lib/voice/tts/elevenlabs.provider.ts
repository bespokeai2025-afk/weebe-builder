/**
 * ElevenLabs streaming TTS provider.
 *
 * Extracted from el-voice-relay.plugin.ts so the voice gateway can swap TTS
 * vendors without touching relay logic. Kept as a fallback while Fish Audio
 * becomes the default engine.
 *
 * ElevenLabs has no token-level input streaming on this endpoint, so
 * synthesizeStream batches the token stream into sentences and issues one
 * request per sentence.
 */
import {
  alignPcm16,
  batchIntoSentences,
  type PcmChunk,
  type TtsProvider,
  type TtsVoiceRequest,
} from "./types";

const EL_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_MODEL = "eleven_turbo_v2_5";

/** PCM sample rates ElevenLabs can emit directly. */
const SUPPORTED_RATES = [8000, 16000, 22050, 24000, 44100] as const;

function resolveOutputFormat(sampleRate: number): string {
  if ((SUPPORTED_RATES as readonly number[]).includes(sampleRate)) {
    return `pcm_${sampleRate}`;
  }
  throw new Error(
    `ElevenLabs cannot emit PCM at ${sampleRate}Hz (supported: ${SUPPORTED_RATES.join(", ")})`,
  );
}

async function* fetchElevenLabsPcm(
  text: string,
  req: TtsVoiceRequest,
  apiKey: string,
): AsyncGenerator<Buffer> {
  const outputFormat = resolveOutputFormat(req.sampleRate);
  // optimize_streaming_latency=3 trades a little quality for time-to-first-byte.
  const url =
    `${EL_BASE}/${encodeURIComponent(req.voiceId)}/stream` +
    `?output_format=${outputFormat}&optimize_streaming_latency=3`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: req.model ?? DEFAULT_MODEL,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        speed: req.speed ?? 1.0,
      },
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => String(res.status));
    throw new Error(`ElevenLabs TTS ${res.status}: ${body}`);
  }

  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) yield Buffer.from(value);
  }
}

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = "elevenlabs";

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("ElevenLabsTtsProvider requires an API key");
  }

  synthesize(text: string, req: TtsVoiceRequest): AsyncGenerator<PcmChunk> {
    return alignPcm16(fetchElevenLabsPcm(text, req, this.apiKey));
  }

  synthesizeStream(
    textStream: AsyncIterable<string>,
    req: TtsVoiceRequest,
  ): AsyncGenerator<PcmChunk> {
    const apiKey = this.apiKey;
    async function* perSentence(): AsyncGenerator<Buffer> {
      for await (const sentence of batchIntoSentences(textStream)) {
        yield* fetchElevenLabsPcm(sentence, req, apiKey);
      }
    }
    return alignPcm16(perSentence());
  }
}
