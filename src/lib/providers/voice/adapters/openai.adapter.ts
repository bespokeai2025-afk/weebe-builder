import type { VoiceProvider, VoiceSessionParams, VoiceSessionResult } from "../interface";

/**
 * Delegates to the OpenAI Realtime Sessions API (ephemeral token path).
 * Returns a clientSecret (ephemeral key) that the browser can use to connect
 * to the OpenAI Realtime WebSocket via the HyperStream relay.
 */
export class OpenAIVoiceAdapter implements VoiceProvider {
  readonly name = "openai";
  readonly status = "available" as const;

  constructor(private readonly apiKey: string = process.env.OPENAI_API_KEY ?? "") {}

  async createSession(params: VoiceSessionParams): Promise<VoiceSessionResult> {
    if (!this.apiKey) throw new Error("OpenAI API key not configured (OPENAI_API_KEY)");

    const model =
      (params.additionalConfig?.model as string | undefined) ??
      "gpt-4o-realtime-preview-2024-12-17";

    const voice = (params.additionalConfig?.voice as string | undefined) ?? "alloy";

    const resp = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        instructions: params.compiledPrompt || undefined,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenAI Realtime session error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return {
      clientSecret: data.client_secret?.value ?? data.client_secret,
      sessionId: data.id,
    };
  }

  async healthCheck(): Promise<boolean> {
    const key = this.apiKey || process.env.OPENAI_API_KEY || "";
    if (!key) return false;
    try {
      const resp = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
