/**
 * Which builder settings each runtime engine actually honours.
 *
 * The builder shows one settings panel for every engine, but engines differ: a setting stored and
 * exported for an engine that never reads it is a control that silently does nothing (voice emotion only reaches Fish Audio, background sound is Retell-only). This table is the one
 * place that records those gaps, so the UI can say so next to the control instead of letting users
 * configure behaviour that never happens.
 *
 * A setting missing from the table, or an engine missing from its entry, is fully supported.
 */
import { resolveDeploymentMode } from "@/lib/runtime/adapter";
import type { DeploymentMode } from "@/lib/runtime/types";
import type { BuilderSettings } from "./types";

export type SettingSupport = "full" | "partial" | "none";

interface EngineRule {
  support: Exclude<SettingSupport, "full">;
  note: string;
  /** Only applies when this returns true (e.g. partial support that depends on the TTS choice). */
  when?: (settings: BuilderSettings) => boolean;
}

const notFishTts = (s: BuilderSettings) => (s.webeeTtsProvider ?? "fish") !== "fish";

const FISH_ONLY_NATIVE: EngineRule = {
  support: "none",
  note: "On WEBEE Native this only applies with Fish Audio TTS.",
  when: notFishTts,
};

export const SETTING_ENGINE_RULES: Partial<
  Record<keyof BuilderSettings, Partial<Record<DeploymentMode, EngineRule>>>
> = {
  voiceEmotion: { WEBEE_NATIVE: FISH_ONLY_NATIVE },
  voiceTemperature: { WEBEE_NATIVE: FISH_ONLY_NATIVE },
  ambientSound: {
    WEBEE_NATIVE: {
      support: "partial",
      note: "Phone calls only (not the browser test). Beds are generated approximations of Retell's recordings.",
    },
  },
  ambientSoundVolume: {
    WEBEE_NATIVE: { support: "partial", note: "Phone calls only (not the browser test)." },
  },
  denoisingMode: {
    WEBEE_NATIVE: {
      support: "partial",
      note: "Reduces steady noise (hiss, hum, fans); the background-speech option only removes voices much quieter than the caller. Applied only when enabled for the deployment.",
    },
  },
};

export function settingSupport(
  key: keyof BuilderSettings,
  settings: BuilderSettings,
): { support: SettingSupport; note?: string } {
  const rule = SETTING_ENGINE_RULES[key]?.[resolveDeploymentMode(settings)];
  if (!rule || (rule.when && !rule.when(settings))) return { support: "full" };
  return { support: rule.support, note: rule.note };
}
