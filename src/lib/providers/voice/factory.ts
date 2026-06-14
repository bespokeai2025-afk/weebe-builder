import type { VoiceProvider, VoiceSessionParams, VoiceSessionResult } from "./interface";
import { RetellVoiceAdapter } from "./adapters/retell.adapter";
import { OpenAIVoiceAdapter } from "./adapters/openai.adapter";
import { ElevenLabsVoiceAdapter } from "./adapters/elevenlabs.adapter";
import { trackProviderUsage } from "@/lib/providers/usage.server";

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
 * Returns a VoiceProvider instrumented with usage tracking.
 * Records each createSession attempt (duration, error status) to provider_usage.
 */
export function createInstrumentedVoiceProvider(
  name: VoiceProviderName,
  workspaceId: string,
): VoiceProvider {
  const inner = createVoiceProvider(name);

  async function track(durationMs: number, isError: boolean) {
    await trackProviderUsage({ workspaceId, category: "voice", providerName: name, durationMs, isError }).catch(() => {});
  }

  return {
    name: inner.name,
    status: inner.status,
    async createSession(params: VoiceSessionParams): Promise<VoiceSessionResult> {
      const t0 = Date.now();
      try {
        const result = await inner.createSession(params);
        await track(Date.now() - t0, false);
        return result;
      } catch (err) {
        await track(Date.now() - t0, true);
        throw err;
      }
    },
    async endSession(sessionId: string): Promise<void> {
      return inner.endSession?.(sessionId);
    },
  };
}
