import type { VoiceProvider, VoiceSessionParams, VoiceSessionResult } from "./interface";
import { RetellVoiceAdapter } from "./adapters/retell.adapter";
import { OpenAIVoiceAdapter } from "./adapters/openai.adapter";
import { ElevenLabsVoiceAdapter } from "./adapters/elevenlabs.adapter";
import { withProviderTracking } from "@/lib/providers/instrumentation";

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
