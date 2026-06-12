/**
 * Runtime adapter — the single source of truth for deployment mode resolution.
 *
 * All builder components and server functions MUST call resolveDeploymentMode()
 * instead of reading settings.voiceProvider directly. This provides:
 *
 *   1. Backward compatibility: legacy agents with voiceProvider="OPENAI_REALTIME"
 *      and no deploymentMode field automatically resolve to OPENAI_NATIVE.
 *   2. A single upgrade path: new modes are added here, nowhere else.
 *   3. Retell isolation: the RETELL path is the fallback for every agent that
 *      has no explicit deploymentMode set — which is every existing agent.
 *
 * RETELL CODE IS NEVER CALLED FROM THIS MODULE.
 * This module only resolves a mode string. Execution is the caller's concern.
 */

import type { DeploymentMode, RuntimeConfig } from "./types";

/**
 * Resolve the active deployment mode for a given agent settings object.
 *
 * Resolution order (first match wins):
 *   1. settings.deploymentMode        — explicit new field
 *   2. settings.voiceProvider === "OPENAI_REALTIME" — legacy HyperStream agents
 *   3. "RETELL"                        — default for all existing agents
 */
export function resolveDeploymentMode(
  settings: {
    deploymentMode?: DeploymentMode | string | null;
    voiceProvider?: string | null;
  } | null | undefined,
): DeploymentMode {
  if (!settings) return "RETELL";

  const explicit = settings.deploymentMode;
  if (
    explicit === "RETELL" ||
    explicit === "OPENAI_NATIVE" ||
    explicit === "ELEVENLABS_NATIVE" ||
    explicit === "CLAUDE_NATIVE" ||
    explicit === "GEMINI_NATIVE"
  ) {
    return explicit;
  }

  if (settings.voiceProvider === "OPENAI_REALTIME") return "OPENAI_NATIVE";

  return "RETELL";
}

/**
 * Resolve the full runtime configuration for execution.
 * Callers use this to get provider-specific options alongside the mode.
 */
export function resolveRuntimeConfig(
  settings: {
    deploymentMode?: DeploymentMode | string | null;
    voiceProvider?: string | null;
    openaiVoice?: string | null;
    openaiReasoningEffort?: string | null;
  } | null | undefined,
): RuntimeConfig {
  const mode = resolveDeploymentMode(settings);
  return {
    mode,
    openaiVoice: settings?.openaiVoice ?? undefined,
    openaiReasoningEffort: settings?.openaiReasoningEffort ?? undefined,
  };
}

/** Convenience predicates — avoids string comparisons at call sites. */
export const isRetellMode = (mode: DeploymentMode) => mode === "RETELL";
export const isOpenAINativeMode = (mode: DeploymentMode) => mode === "OPENAI_NATIVE";
export const isElevenLabsNativeMode = (mode: DeploymentMode) => mode === "ELEVENLABS_NATIVE";
export const isClaudeNativeMode = (mode: DeploymentMode) => mode === "CLAUDE_NATIVE";
export const isGeminiNativeMode = (mode: DeploymentMode) => mode === "GEMINI_NATIVE";
export const isNativeMode = (mode: DeploymentMode) => mode !== "RETELL";
