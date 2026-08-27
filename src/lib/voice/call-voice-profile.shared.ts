/**
 * Call-scoped voice identity for WEBEE Native (Retell-aligned).
 *
 * Retell sets voice on the agent / conversation flow — not on subflow components
 * or individual nodes. WEBEE locks one Fish `reference_id` + prosody for the
 * entire call so TTS does not drift or switch mid-conversation.
 */

import { resolveFishTtsVoiceRequest } from "./fish-tts-prosody.shared";
import type { TtsVoiceRequest } from "./tts/types";

export interface CallVoiceProfile extends TtsVoiceRequest {
  /** Frozen for the call — never mutate after lock. */
  lockedAt: number;
}

/** Retell/OmniVoice ids are not valid Fish reference_id values. */
export function isFishReferenceVoiceId(voiceId: string): boolean {
  const id = voiceId.trim();
  if (!id) return false;
  if (/^11labs-/i.test(id)) return false;
  return true;
}

/**
 * Resolve the Fish `reference_id` for a call (agent-level, Retell-aligned).
 *
 * Priority:
 *   1. `settings.webeeVoiceId` — canonical agent voice (builder + telephony)
 *   2. `sessionVoiceId` — explicit session.init override (test call)
 *   3. Legacy Fish id in `voice_id` / `voiceId` when not 11labs-*
 */
export function resolveCallVoiceId(input: {
  sessionVoiceId?: string;
  settings?: Record<string, unknown> | null;
}): string {
  const settings = input.settings ?? {};
  const webee = String(settings.webeeVoiceId ?? "").trim();
  const session = String(input.sessionVoiceId ?? "").trim();
  const legacyRaw = String(settings.voice_id ?? settings.voiceId ?? "").trim();
  const legacyFish = isFishReferenceVoiceId(legacyRaw) ? legacyRaw : "";

  for (const id of [webee, session, legacyFish]) {
    if (isFishReferenceVoiceId(id)) return id;
  }
  return "";
}

/**
 * Resolve and lock the voice used for every TTS utterance in a call.
 * Prosody (speed, temperature, volume) is frozen here — never re-read from settings mid-call.
 */
export function lockCallVoiceProfile(input: {
  sessionVoiceId?: string;
  settings?: Record<string, unknown> | null;
  sampleRate: number;
  model?: string;
}): CallVoiceProfile {
  const voiceId = resolveCallVoiceId(input);

  if (!voiceId) {
    throw new Error(
      "No Fish Audio voice configured for this call. Set webeeVoiceId on the agent (Voice Infrastructure → WEBEE Native Voice).",
    );
  }

  const req = resolveFishTtsVoiceRequest({
    voiceId,
    sampleRate: input.sampleRate,
    model: input.model,
    settings: input.settings,
  });

  return { ...req, lockedAt: Date.now() };
}

/** True when an attempted voice id differs from the locked call profile. */
export function voiceIdDiffersFromProfile(
  profile: CallVoiceProfile,
  candidate: string | undefined | null,
): boolean {
  const next = String(candidate ?? "").trim();
  if (!next || !isFishReferenceVoiceId(next)) return false;
  return next !== profile.voiceId;
}
