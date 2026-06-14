import type { VoiceProvider, VoiceSessionParams, VoiceSessionResult } from "../interface";

const RETELL_BASE = "https://api.retellai.com";

/**
 * Delegates to the Retell v2 create-web-call REST API.
 * Requires `params.additionalConfig.retellAgentId` — the Retell agent ID string
 * (format: agent_xxxxxxxx), not the internal DB row UUID.
 */
export class RetellVoiceAdapter implements VoiceProvider {
  readonly name = "retell";
  readonly status = "available" as const;

  constructor(private readonly apiKey: string = process.env.RETELL_API_KEY ?? "") {}

  async createSession(params: VoiceSessionParams): Promise<VoiceSessionResult> {
    if (!this.apiKey) throw new Error("Retell API key not configured (RETELL_API_KEY)");

    const agentId =
      (params.additionalConfig?.retellAgentId as string | undefined) ??
      (params.additionalConfig?.agentId as string | undefined);
    if (!agentId) {
      throw new Error(
        "RetellVoiceAdapter.createSession requires additionalConfig.retellAgentId " +
        "(the Retell agent ID string, e.g. agent_xxxxxxxx)",
      );
    }

    const resp = await fetch(`${RETELL_BASE}/v2/create-web-call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ agent_id: agentId }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Retell create-web-call error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return {
      clientSecret: data.access_token,
      sessionId: data.call_id,
    };
  }

  async endSession(sessionId: string): Promise<void> {
    if (!this.apiKey || !sessionId) return;
    await fetch(`${RETELL_BASE}/v2/call/${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    }).catch(() => {});
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const resp = await fetch(`${RETELL_BASE}/list-agents`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
