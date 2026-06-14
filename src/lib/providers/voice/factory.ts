import type { VoiceProvider, VoiceSessionParams, VoiceSessionResult } from "./interface";
import { RetellVoiceAdapter } from "./adapters/retell.adapter";
import { OpenAIVoiceAdapter } from "./adapters/openai.adapter";
import { ElevenLabsVoiceAdapter } from "./adapters/elevenlabs.adapter";
import { withProviderTracking, withProviderFallback } from "@/lib/providers/instrumentation";

export type VoiceProviderName = "retell" | "openai" | "elevenlabs" | "claude" | "gemini";

export function createVoiceProvider(name: VoiceProviderName): VoiceProvider {
  switch (name) {
    case "retell":
      return new RetellVoiceAdapter();
    case "openai":
      return new OpenAIVoiceAdapter();
    case "elevenlabs":
      return new ElevenLabsVoiceAdapter();
    case "claude":
    case "gemini":
      throw new Error(`Voice provider "${name}" is coming soon. Watch the HiveMind System Health page for availability.`);
    default:
      throw new Error(`Unknown voice provider: ${String(name)}`);
  }
}

/**
 * Returns a VoiceProvider instrumented with usage tracking via withProviderTracking.
 * Records each createSession attempt (duration, error status) to provider_usage.
 */
export function createInstrumentedVoiceProvider(
  name: VoiceProviderName,
  workspaceId: string,
): VoiceProvider {
  const inner = createVoiceProvider(name);

  return {
    name: inner.name,
    status: inner.status,
    async createSession(params: VoiceSessionParams): Promise<VoiceSessionResult> {
      return withProviderTracking(
        { workspaceId, category: "voice", providerName: name },
        () => inner.createSession(params),
      );
    },
    async endSession(sessionId: string): Promise<void> {
      return inner.endSession?.(sessionId);
    },
  };
}

/**
 * Creates a VoiceProvider that automatically falls back to `fallbackName`
 * if the primary provider's `createSession` call throws.
 * Both primary and fallback are independently instrumented for usage tracking.
 */
export function createVoiceProviderWithFallback(
  primaryName: VoiceProviderName,
  fallbackName: VoiceProviderName | null,
  workspaceId: string,
): VoiceProvider {
  const primary  = createInstrumentedVoiceProvider(primaryName, workspaceId);
  const fallback = fallbackName ? createInstrumentedVoiceProvider(fallbackName, workspaceId) : null;

  return {
    name: primary.name,
    status: primary.status,
    async createSession(params: VoiceSessionParams): Promise<VoiceSessionResult> {
      return withProviderFallback(
        () => primary.createSession(params),
        fallback ? () => fallback.createSession(params) : null,
        { category: "voice", primaryName, fallbackName: fallbackName ?? undefined },
      );
    },
    async endSession(sessionId: string): Promise<void> {
      return primary.endSession?.(sessionId);
    },
  };
}
