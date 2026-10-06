/**
 * The agent's voice, read and written through one table.
 *
 * Voice choice is stored in a different settings field per provider — `voiceId` (Retell),
 * `webeeVoiceId` (Fish), `openaiVoice`, `cartesiaVoice`, `elevenLabsVoiceId`, `voiceOutputId` —
 * because each engine was added with its own field. Rather than every picker and runtime path
 * knowing which field belongs to which provider, they go through this table: one place to add a
 * provider, and one answer to "which voice will this agent actually use".
 *
 * The stored fields are unchanged (no migration), so existing agents keep working.
 *
 * Relative imports only — reachable from the voice runtime.
 */
import { resolveDeploymentMode } from "../runtime/adapter";

export type VoiceProviderSlot =
  | "retell"
  | "fish"
  | "openai"
  | "cartesia"
  | "elevenlabs"
  | "elevenlabs_output";

interface SlotFields {
  id: string;
  name?: string;
  label: string;
}

export const VOICE_SLOTS: Record<VoiceProviderSlot, SlotFields> = {
  retell: { id: "voiceId", label: "OmniVoice" },
  fish: { id: "webeeVoiceId", name: "webeeVoiceName", label: "Fish Audio" },
  openai: { id: "openaiVoice", label: "OpenAI" },
  cartesia: { id: "cartesiaVoice", label: "Cartesia" },
  elevenlabs: { id: "elevenLabsVoiceId", name: "elevenLabsVoiceName", label: "ElevenLabs" },
  elevenlabs_output: { id: "voiceOutputId", name: "voiceOutputName", label: "ElevenLabs" },
};

type SettingsLike = Record<string, unknown> | null | undefined;

/** Which provider's voice this agent speaks with, given its engine and TTS choice. */
export function activeVoiceSlot(settings: SettingsLike): VoiceProviderSlot {
  const s = settings ?? {};
  const mode = resolveDeploymentMode(
    s as { deploymentMode?: string | null; voiceProvider?: string | null },
  );
  if (mode === "WEBEE_NATIVE") {
    const tts = String(s.webeeTtsProvider ?? "fish");
    return tts === "openai" || tts === "cartesia" ? tts : "fish";
  }
  if (mode === "ELEVENLABS_NATIVE") return "elevenlabs";
  if (mode === "OPENAI_NATIVE") {
    return s.voiceOutputProvider === "elevenlabs" ? "elevenlabs_output" : "openai";
  }
  return "retell";
}

/** The voice id stored for a provider ("" when none is set). */
export function voiceIdFor(settings: SettingsLike, slot: VoiceProviderSlot): string {
  return String((settings ?? {})[VOICE_SLOTS[slot].id] ?? "").trim();
}

/** The voice the agent will actually use. */
export function getAgentVoice(settings: SettingsLike): {
  slot: VoiceProviderSlot;
  provider: string;
  id: string;
  name: string;
} {
  const slot = activeVoiceSlot(settings);
  const fields = VOICE_SLOTS[slot];
  const id = voiceIdFor(settings, slot);
  const name = fields.name ? String((settings ?? {})[fields.name] ?? "").trim() : "";
  return { slot, provider: fields.label, id, name: name || id };
}

/** Settings patch that selects a voice for a provider. */
export function agentVoicePatch(
  slot: VoiceProviderSlot,
  id: string,
  name?: string,
): Record<string, string> {
  const fields = VOICE_SLOTS[slot];
  return { [fields.id]: id, ...(fields.name ? { [fields.name]: name ?? "" } : {}) };
}
