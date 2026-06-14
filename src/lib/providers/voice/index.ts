export type { VoiceProvider, VoiceSessionParams, VoiceSessionResult } from "./interface";
export { createVoiceProvider, type VoiceProviderName } from "./factory";

// Re-export existing runtime adapter — existing call sites unchanged
export { resolveDeploymentMode, resolveRuntimeConfig, isRetellMode, isOpenAINativeMode, isElevenLabsNativeMode } from "@/lib/runtime/adapter";
export { getHandler, RUNTIME_REGISTRY } from "@/lib/runtime/registry";
