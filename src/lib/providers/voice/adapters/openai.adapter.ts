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

    // Use node:https directly to avoid Vinxi/undici fetch interceptors that can
    // re-route absolute HTTPS URLs back through the app server.  This mirrors
    // the proven transport used before the provider framework was introduced.
    const payload = JSON.stringify({
      model,
      voice,
      instructions: params.compiledPrompt || undefined,
    });
    const { request: httpsRequest } = await import("node:https");
    const clientSecret = await new Promise<string>((resolve, reject) => {
      const req = httpsRequest(
        {
          hostname: "api.openai.com",
          port: 443,
          path: "/v1/realtime/sessions",
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(body) as {
                id?: string;
                client_secret?: { value?: string } | string;
                error?: { message?: string };
              };
              if (!res.statusCode || res.statusCode >= 400) {
                reject(new Error((parsed.error as any)?.message ?? body));
              } else {
                const secret =
                  typeof parsed.client_secret === "object"
                    ? parsed.client_secret?.value
                    : parsed.client_secret;
                if (!secret) reject(new Error(`Unexpected response: ${body}`));
                else resolve(secret);
              }
            } catch {
              reject(new Error(`Non-JSON response: ${body}`));
            }
          });
        },
      );
      req.on("error", (e: Error) => reject(e));
      req.write(payload);
      req.end();
    });

    return { clientSecret };
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
