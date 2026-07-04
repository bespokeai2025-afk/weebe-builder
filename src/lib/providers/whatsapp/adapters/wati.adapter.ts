import type { WhatsAppProvider, WhatsAppMessage, WhatsAppTemplate, WhatsAppBroadcast } from "../interface";

// Inline WATI REST calls — avoids importing TanStack server functions which can't run in adapters
async function watiPost(endpoint: string, apiKey: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WATI API ${path} returned ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export class WATIWhatsAppAdapter implements WhatsAppProvider {
  readonly name = "wati";

  constructor(private readonly config: { apiEndpoint: string; apiKey: string }) {}

  async sendMessage(msg: WhatsAppMessage): Promise<{ messageId: string }> {
    // Media messages route through WATI's session-file endpoint (multipart upload).
    if (msg.mediaUrl) {
      return this.sendSessionFile(msg.to, msg.mediaUrl, msg.body);
    }
    const data = (await watiPost(
      this.config.apiEndpoint,
      this.config.apiKey,
      `/api/v1/sendSessionMessage/${encodeURIComponent(msg.to)}?messageText=${encodeURIComponent(msg.body)}`,
    )) as any;
    return { messageId: data?.id ?? `wati_${Date.now()}` };
  }

  /**
   * Sends media (image/video/audio/document) via WATI's sendSessionFile endpoint.
   * WATI has no send-by-URL API for session files, so the file is fetched from
   * `mediaUrl` server-side and uploaded as multipart form-data. The optional
   * `caption` is passed as a query param.
   */
  private async sendSessionFile(
    to: string,
    mediaUrl: string,
    caption?: string,
  ): Promise<{ messageId: string }> {
    const fileRes = await fetch(mediaUrl);
    if (!fileRes.ok) {
      throw new Error(`WATI media fetch failed for ${mediaUrl}: ${fileRes.status}`);
    }
    const arrayBuf = await fileRes.arrayBuffer();
    const contentType = fileRes.headers.get("content-type") ?? "application/octet-stream";
    const filename = mediaUrl.split("/").pop()?.split("?")[0] || "file";

    const form = new FormData();
    form.append("file", new Blob([arrayBuf], { type: contentType }), filename);

    const qs = caption ? `?caption=${encodeURIComponent(caption)}` : "";
    const res = await fetch(
      `${this.config.apiEndpoint}/api/v1/sendSessionFile/${encodeURIComponent(to)}${qs}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: form,
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`WATI API sendSessionFile returned ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json().catch(() => ({}))) as any;
    return { messageId: data?.id ?? `wati_file_${Date.now()}` };
  }

  async sendTemplate(msg: WhatsAppTemplate): Promise<{ messageId: string }> {
    const params = (msg.parameters ?? []).map((v, i) => ({ name: `${i + 1}`, value: v }));
    const data = (await watiPost(
      this.config.apiEndpoint,
      this.config.apiKey,
      "/api/v1/sendTemplateMessage",
      { whatsappNumber: msg.to, template_name: msg.templateName, broadcast_name: "provider_framework", parameters: params },
    )) as any;
    return { messageId: data?.id ?? `wati_tpl_${Date.now()}` };
  }

  async sendBroadcast(broadcast: WhatsAppBroadcast): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    await Promise.allSettled(
      broadcast.recipients.map(async (to) => {
        try {
          await this.sendMessage({ to, body: broadcast.body });
          sent++;
        } catch {
          failed++;
        }
      }),
    );
    return { sent, failed };
  }

  async healthCheck(): Promise<boolean> {
    const { apiEndpoint, apiKey } = this.config;
    if (!apiEndpoint || !apiKey) return false;
    try {
      // GET getContacts is a lightweight read-only WATI endpoint;
      // a 200 response confirms the endpoint + Bearer token are valid.
      const res = await fetch(`${apiEndpoint}/api/v1/getContacts?pageSize=1`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
