/**
 * Create a Retell web call — POST /v3/create-web-call.
 *
 * Retell ended support for /v2/create-web-call on 2026-10-18 (it may be removed at any time). v3
 * can answer with a non-LiveKit "gateway" transport, so callers must hand `transport`, `url` and
 * `iceServers` to the browser along with the token: retell-client-js-sdk 3.x
 * (`RetellWebClient.startCall({ accessToken, transport, callId, iceServers, url })`) picks the
 * right transport from them; without `transport` it assumes LiveKit.
 */
const RETELL_API = "https://api.retellai.com";

export interface RetellWebCallSession {
  callId: string;
  accessToken: string;
  /** "livekit" | "gateway" — undefined on older backends (LiveKit). */
  transport?: string;
  url?: string;
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}

export async function createRetellWebCallV3(
  apiKey: string,
  body: {
    agent_id: string;
    agent_version?: number;
    metadata?: Record<string, unknown>;
    retell_llm_dynamic_variables?: Record<string, unknown>;
  },
): Promise<RetellWebCallSession> {
  const res = await fetch(`${RETELL_API}/v3/create-web-call`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let message = text.slice(0, 300);
    try {
      message = String((JSON.parse(text) as { message?: unknown }).message ?? message);
    } catch {
      // keep the raw body
    }
    throw new RetellWebCallError(res.status, message);
  }
  const data = JSON.parse(text) as {
    call_id?: string;
    access_token?: string;
    transport?: string;
    url?: string;
    ice_servers?: RetellWebCallSession["iceServers"];
  };
  if (!data.call_id || !data.access_token) {
    throw new RetellWebCallError(502, "Retell returned no call_id / access_token");
  }
  return {
    callId: data.call_id,
    accessToken: data.access_token,
    ...(data.transport ? { transport: data.transport } : {}),
    ...(data.url ? { url: data.url } : {}),
    ...(Array.isArray(data.ice_servers) ? { iceServers: data.ice_servers } : {}),
  };
}

export class RetellWebCallError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(
      status === 402
        ? `Retell account is out of credit (${message}). Top up in the Retell dashboard.`
        : `Retell create-web-call failed (${status}): ${message}`,
    );
    this.name = "RetellWebCallError";
  }
}
