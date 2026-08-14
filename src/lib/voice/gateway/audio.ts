/**
 * Audio codec helpers shared by the telephony gateways.
 *
 * Telephony carriers (Twilio, FreJun) speak μ-law 8 kHz; OpenAI Realtime and
 * Fish Audio speak PCM16 at 24 kHz, so every call needs conversion in both
 * directions. This logic used to be duplicated in telephony-stream.plugin.ts
 * and frejun-stream.plugin.ts.
 *
 * NOTE: these modules are imported from vite.config.ts, so they must use
 * relative imports only — the `@/` alias is not available at config load time.
 */

/**
 * ITU-T G.711 μ-law, as used by every PSTN carrier.
 *
 * The previous implementation (copied between the two telephony plugins) had a
 * mismatched encode/decode pair: encode extracted the mantissa with
 * `>> (exp + 1)` instead of `>> (exp + 3)`, so it stored the wrong four bits,
 * and decode used a different reconstruction formula again. Measured against
 * the reference codec over a sine sweep, mean absolute error was 7176 versus
 * 142 — plus sign inversions near zero and a DC offset (`decode(encode(0))`
 * returned -29). Callers heard that as distorted, buzzy audio in both
 * directions.
 *
 * BIAS (0x84) is the standard mid-tread offset; CLIP is the largest magnitude
 * representable before the sign bit.
 */
const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

/** μ-law byte -> linear PCM16 sample. */
export function mulawDecode(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const magnitude = (((mantissa << 3) + MULAW_BIAS) << exponent) - MULAW_BIAS;
  return sign ? -magnitude : magnitude;
}

/** Linear PCM16 sample -> μ-law byte. */
export function mulawEncode(sample: number): number {
  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample += MULAW_BIAS;

  // Exponent is the segment index: the position of the most significant set
  // bit, searched down from bit 14.
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && (sample & mask) === 0; exponent--, mask >>= 1) {
    /* locate segment */
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Resample a mono Int16 buffer between rates via linear interpolation. */
export function resample(src: Int16Array, srcHz: number, dstHz: number): Int16Array {
  if (srcHz === dstHz) return src;
  if (src.length === 0) return src;
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

export function mulawBytesToPcm16(payload: Buffer): Int16Array {
  const pcm = new Int16Array(payload.length);
  for (let i = 0; i < payload.length; i++) pcm[i] = mulawDecode(payload[i]);
  return pcm;
}

export function pcm16ToMulawBase64(samples: Int16Array): string {
  const out = Buffer.allocUnsafe(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = mulawEncode(samples[i]);
  return out.toString("base64");
}

/**
 * Decode base64 PCM16 into an Int16Array view of exactly those bytes.
 *
 * `new Int16Array(Buffer.from(b64, "base64").buffer)` is wrong: Node allocates
 * small Buffers inside a shared pool, so `.buffer` is the whole pool and the
 * view picks up unrelated audio from other allocations (heard as clicks and
 * garbage) while `byteOffset` is ignored entirely. Always pass byteOffset and
 * length, and guard the odd trailing byte that a truncated frame can leave.
 */
export function base64ToPcm16(b64: string): Int16Array {
  return pcm16View(Buffer.from(b64, "base64"));
}

/**
 * View a Buffer of little-endian PCM16 as Int16Array without copying.
 *
 * Same pooling hazard as above: byteOffset and length are mandatory, and an odd
 * trailing byte (a truncated frame) has to be dropped rather than read.
 */
export function pcm16View(buf: Buffer): Int16Array {
  const sampleCount = Math.floor(buf.byteLength / 2);
  if (sampleCount === 0) return new Int16Array(0);
  return new Int16Array(buf.buffer, buf.byteOffset, sampleCount);
}

/** Encode PCM16 samples as base64, copying only this view's bytes. */
export function pcm16ToBase64(samples: Int16Array): string {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString("base64");
}

/** Wrap PCM16 samples as a Buffer over the same bytes, without copying. */
export function pcm16ToBuffer(samples: Int16Array): Buffer {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}
