/**
 * Map Builder speech settings → Fish Audio TTS start request fields.
 * Fish has no Retell-style emotion enum — we map emotion to temperature + prosody.
 */

import type { TtsVoiceRequest } from "./tts/types";

type BuilderEmotion =
  | "none"
  | "calm"
  | "sympathetic"
  | "happy"
  | "sad"
  | "angry"
  | "fearful"
  | "surprised";

const EMOTION_TEMPERATURE: Record<BuilderEmotion, number> = {
  none: 0.7,
  calm: 0.45,
  sympathetic: 0.55,
  happy: 0.78,
  sad: 0.5,
  angry: 0.82,
  fearful: 0.62,
  surprised: 0.8,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function numSetting(settings: Record<string, unknown> | null | undefined, key: string): number | undefined {
  const v = settings?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Builder voiceTemperature 0–2 maps loosely to Fish temperature 0–1. */
function resolveTemperature(
  settings?: Record<string, unknown> | null,
  voiceId?: string,
  cloneVoice = false,
): number | undefined {
  const emotion = String(settings?.voiceEmotion ?? "none").trim().toLowerCase() as BuilderEmotion;
  const fromEmotion = EMOTION_TEMPERATURE[emotion] ?? EMOTION_TEMPERATURE.none;
  const voiceTemp = numSetting(settings, "voiceTemperature");
  let temp = voiceTemp == null ? fromEmotion : clamp(0.35 + voiceTemp * 0.25, 0.35, 0.95);
  // Fish reference voices shift perceived identity at high temperature — keep stable
  // for the whole call so utterances sound like the same speaker (Retell-style).
  const id = String(voiceId ?? "").trim();
  if (id) {
    temp = Math.min(temp, cloneVoice ? 0.1 : 0.2);
  }
  return temp;
}

export function isOwnedFishCloneVoice(settings?: Record<string, unknown> | null): boolean {
  if (!settings) return false;
  if (settings.webeeVoiceOwned === true) return true;
  return /your clone/i.test(String(settings.webeeVoiceName ?? ""));
}

export function resolveFishTtsVoiceRequest(input: {
  voiceId: string;
  sampleRate: number;
  model?: string;
  settings?: Record<string, unknown> | null;
}): TtsVoiceRequest {
  const cloneVoice = isOwnedFishCloneVoice(input.settings);
  const speed = numSetting(input.settings, "voiceSpeed");
  const volume = numSetting(input.settings, "volume");
  const temperature = resolveTemperature(input.settings, input.voiceId, cloneVoice);

  const req: TtsVoiceRequest = {
    voiceId: input.voiceId,
    sampleRate: input.sampleRate,
    latency: "low",
    model: input.model,
    cloneVoice,
  };

  if (speed != null) req.speed = clamp(speed, 0.5, 2);
  if (temperature != null) req.temperature = temperature;
  if (volume != null) req.volume = clamp((volume - 1) * 10, -20, 20);

  return req;
}
