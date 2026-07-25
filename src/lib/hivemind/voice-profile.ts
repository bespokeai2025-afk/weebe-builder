// ── Shared HiveMind voice profile ─────────────────────────────────────────────
// Single source of truth for the voice/personality settings used by BOTH
// HiveMind chat surfaces (the floating orb mini-chat and the full Assistant
// page). Settings are stored under one localStorage key so a change made in
// either interface is picked up by the other.

export type HiveMindPersonality = "professional" | "friendly" | "concise";

export type HiveMindVoiceSettings = {
  voiceId:     string;
  voiceName:   string;
  speed:       number;
  personality: HiveMindPersonality;
  autoPlay:    boolean;
};

export const HIVEMIND_VOICE_SETTINGS_KEY = "hivemind-voice-settings";
export const HIVEMIND_USER_NAME_KEY      = "hivemind-user-name";

export const DEFAULT_HIVEMIND_VOICE: HiveMindVoiceSettings = {
  voiceId:     "21m00Tcm4TlvDq8ikWAM",
  voiceName:   "Rachel",
  speed:       1.0,
  personality: "professional",
  autoPlay:    false,
};

export function loadHiveMindVoiceSettings(): HiveMindVoiceSettings {
  if (typeof window === "undefined") return DEFAULT_HIVEMIND_VOICE;
  try {
    const s = window.localStorage.getItem(HIVEMIND_VOICE_SETTINGS_KEY);
    return s ? { ...DEFAULT_HIVEMIND_VOICE, ...JSON.parse(s) } : DEFAULT_HIVEMIND_VOICE;
  } catch {
    return DEFAULT_HIVEMIND_VOICE;
  }
}

export function saveHiveMindVoiceSettings(s: HiveMindVoiceSettings) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(HIVEMIND_VOICE_SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

export function loadHiveMindUserName(): string {
  if (typeof window === "undefined") return "";
  try { return window.localStorage.getItem(HIVEMIND_USER_NAME_KEY) ?? ""; } catch { return ""; }
}
