import type { VoiceProvider, VoiceSessionParams, VoiceSessionResult } from "./interface";
import { RetellVoiceAdapter } from "./adapters/retell.adapter";
import { OpenAIVoiceAdapter } from "./adapters/openai.adapter";
import { ElevenLabsVoiceAdapter } from "./adapters/elevenlabs.adapter";
import { withProviderTracking, withProviderFallback } from "@/lib/providers/instrumentation";

export type VoiceProviderName = "retell" | "openai" | "elevenlabs" | "claude" | "gemini";

/**
 * Per-provider credential overrides. When supplied, the adapter uses these
 * instead of falling back to process.env, enabling workspace-level credential
 * isolation from provider_settings.
 */
export interface VoiceCreds {
  apiKey?: string;
}

export function createVoiceProvider(name: VoiceProviderName, creds?: VoiceCreds): VoiceProvider {
  switch (name) {
    case "retell":
      return new RetellVoiceAdapter(creds?.apiKey);
    case "openai":
      return new OpenAIVoiceAdapter(creds?.apiKey);
    case "elevenlabs":
      return new ElevenLabsVoiceAdapter(creds?.apiKey);
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
 * Pass `creds` to inject workspace-specific API keys from provider_settings.
 */
export function createInstrumentedVoiceProvider(
  name: VoiceProviderName,
  workspaceId: string,
  creds?: VoiceCreds,
): VoiceProvider {
  const inner = createVoiceProvider(name, creds);

  return {
    name: inner.name,
    status: inner.status,
    async createSession(params: VoiceSessionParams): Promise<VoiceSessionResult> {
      return withProviderTracking(
        { workspaceId, category: "voice", providerName: name, unitsConsumed: 1, unitType: "session" },
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
 * Pass `primaryCreds` / `fallbackCreds` to supply workspace-specific keys.
 */
export function createVoiceProviderWithFallback(
  primaryName: VoiceProviderName,
  fallbackName: VoiceProviderName | null,
  workspaceId: string,
  primaryCreds?: VoiceCreds,
  fallbackCreds?: VoiceCreds,
): VoiceProvider {
  const primary  = createInstrumentedVoiceProvider(primaryName, workspaceId, primaryCreds);
  const fallback = fallbackName ? createInstrumentedVoiceProvider(fallbackName, workspaceId, fallbackCreds) : null;

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
