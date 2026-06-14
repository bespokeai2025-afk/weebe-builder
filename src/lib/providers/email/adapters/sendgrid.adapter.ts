import type { EmailProvider, EmailMessage, EmailSendResult } from "../interface";

const SENDGRID_API = "https://api.sendgrid.com/v3";

export class SendGridEmailAdapter implements EmailProvider {
  readonly name = "sendgrid";

  constructor(private readonly apiKey: string) {}

  async sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
    if (!this.apiKey) throw new Error("SendGrid API key not configured");

    const to = Array.isArray(msg.to) ? msg.to : [msg.to];
    const from = msg.from ?? "noreply@example.com";

    const resp = await fetch(`${SENDGRID_API}/mail/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: to.map(email => ({ email })) }],
        from: { email: from },
        subject: msg.subject,
        content: [
          { type: "text/html", value: msg.html },
          ...(msg.text ? [{ type: "text/plain", value: msg.text }] : []),
        ],
        reply_to: msg.replyTo ? { email: msg.replyTo } : undefined,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`SendGrid send failed HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    const messageId = resp.headers.get("x-message-id") ?? `sg_${Date.now()}`;
    return { messageId, accepted: to, rejected: [] };
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const resp = await fetch(`${SENDGRID_API}/scopes`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
