import type { VoiceProvider, VoiceSessionParams, VoiceSessionResult } from "../interface";

/**
 * Delegates to the ElevenLabs ConvAI signed URL endpoint.
 * Returns a wsUrl (signed WebSocket URL) that the browser SDK can use to
 * connect to the ElevenLabs ConvAI agent session (VoxStream flow).
 * Requires `params.additionalConfig.elevenlabsAgentId` (or `agentId`) —
 * the ElevenLabs agent ID string.
 */
export class ElevenLabsVoiceAdapter implements VoiceProvider {
  readonly name = "elevenlabs";
  readonly status = "available" as const;

  constructor(private readonly apiKey: string = process.env.ELEVENLABS_API_KEY ?? "") {}

  async createSession(params: VoiceSessionParams): Promise<VoiceSessionResult> {
    if (!this.apiKey) throw new Error("ElevenLabs API key not configured (ELEVENLABS_API_KEY)");

    const agentId =
      (params.additionalConfig?.elevenlabsAgentId as string | undefined) ??
      (params.additionalConfig?.agentId as string | undefined);
    if (!agentId) {
      throw new Error(
        "ElevenLabsVoiceAdapter.createSession requires additionalConfig.elevenlabsAgentId " +
        "(the ElevenLabs ConvAI agent ID string)",
      );
    }

    const url = `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`;
    const resp = await fetch(url, {
      headers: { "xi-api-key": this.apiKey },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`ElevenLabs signed URL error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return {
      wsUrl: data.signed_url,
    };
  }
}
