/**
 * OpenAI Whisper speech-to-text for the cascade voice engine.
 *
 * Whisper is a batch endpoint: it needs a complete utterance wrapped in a
 * container, so the caller accumulates PCM frames and calls transcribe() once
 * the VAD reports end-of-speech.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

/** PCM16 mono sample rate used across the cascade engine. */
export const CASCADE_SAMPLE_RATE = 24_000;

/**
 * Wrap raw PCM16 mono frames in a WAV container.
 *
 * Whisper rejects headerless PCM, so the 44-byte canonical header is built by
 * hand rather than pulling in an encoder dependency.
 */
export function buildWav(bufs: Buffer[], sampleRate: number = CASCADE_SAMPLE_RATE): Buffer {
  const pcm = Buffer.concat(bufs);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
}

export async function whisperTranscribe(wav: Buffer, apiKey: string): Promise<string> {
  const form = new FormData();
  // Copy into a fresh Uint8Array: a pooled Buffer's underlying ArrayBuffer is
  // larger than the Buffer itself, which would append unrelated bytes.
  const bytes = new Uint8Array(wav.byteLength);
  bytes.set(wav);
  form.append("file", new Blob([bytes], { type: "audio/wav" }), "speech.wav");
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
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
