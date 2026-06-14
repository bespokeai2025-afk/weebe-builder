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
    const data = (await watiPost(
      this.config.apiEndpoint,
      this.config.apiKey,
      `/api/v1/sendSessionMessage/${encodeURIComponent(msg.to)}?messageText=${encodeURIComponent(msg.body)}`,
    )) as any;
    return { messageId: data?.id ?? `wati_${Date.now()}` };
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
}
