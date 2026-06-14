import type { WhatsAppProvider, WhatsAppMessage, WhatsAppTemplate, WhatsAppBroadcast } from "../interface";

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

/**
 * Twilio WhatsApp Business API adapter.
 * Docs: https://www.twilio.com/docs/whatsapp
 */
export class TwilioWhatsAppAdapter implements WhatsAppProvider {
  readonly name = "twilio";

  constructor(private readonly config: { accountSid: string; authToken: string; from: string }) {}

  private get auth(): string {
    const { accountSid, authToken } = this.config;
    return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  }

  async sendMessage(msg: WhatsAppMessage): Promise<{ messageId: string }> {
    const { accountSid, from } = this.config;
    if (!accountSid) throw new Error("Twilio credentials not configured");

    const params: Record<string, string> = {
      To: `whatsapp:${msg.to}`,
      From: `whatsapp:${from}`,
      Body: msg.body,
    };
    if (msg.mediaUrl) params.MediaUrl0 = msg.mediaUrl;
    const body = new URLSearchParams(params);

    const resp = await fetch(`${TWILIO_BASE}/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: this.auth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Twilio WhatsApp send error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    return { messageId: data.sid ?? `twilio_${Date.now()}` };
  }

  async sendTemplate(msg: WhatsAppTemplate): Promise<{ messageId: string }> {
    // Twilio WhatsApp templates use pre-approved message templates
    return this.sendMessage({ to: msg.to, body: msg.templateName });
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
    const { accountSid, authToken } = this.config;
    if (!accountSid || !authToken) return false;
    try {
      const resp = await fetch(`${TWILIO_BASE}/Accounts/${accountSid}.json`, {
        headers: { Authorization: this.auth },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
