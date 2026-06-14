import type { WhatsAppProvider, WhatsAppMessage, WhatsAppTemplate, WhatsAppBroadcast } from "../interface";

const GRAPH_BASE = "https://graph.facebook.com/v19.0";

/**
 * Meta Cloud WhatsApp Business API adapter.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */
export class MetaWhatsAppAdapter implements WhatsAppProvider {
  readonly name = "meta";

  constructor(private readonly config: { accessToken: string; phoneNumberId: string }) {}

  async sendMessage(msg: WhatsAppMessage): Promise<{ messageId: string }> {
    const { accessToken, phoneNumberId } = this.config;
    if (!accessToken || !phoneNumberId) throw new Error("Meta WhatsApp requires accessToken and phoneNumberId");

    const resp = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to,
        type: "text",
        text: { body: msg.body },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Meta WhatsApp send error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return { messageId: data.messages?.[0]?.id ?? `meta_${Date.now()}` };
  }

  async sendTemplate(msg: WhatsAppTemplate): Promise<{ messageId: string }> {
    const { accessToken, phoneNumberId } = this.config;
    if (!accessToken || !phoneNumberId) throw new Error("Meta WhatsApp requires accessToken and phoneNumberId");

    const components = msg.parameters?.length
      ? [{ type: "body", parameters: msg.parameters.map(v => ({ type: "text", text: v })) }]
      : [];

    const resp = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to,
        type: "template",
        template: {
          name: msg.templateName,
          language: { code: msg.languageCode ?? "en_US" },
          components,
        },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Meta WhatsApp template error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return { messageId: data.messages?.[0]?.id ?? `meta_tpl_${Date.now()}` };
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
    const { accessToken } = this.config;
    if (!accessToken) return false;
    try {
      const resp = await fetch(`${GRAPH_BASE}/me?access_token=${accessToken}`);
      return resp.ok;
    } catch {
      return false;
    }
  }
}
