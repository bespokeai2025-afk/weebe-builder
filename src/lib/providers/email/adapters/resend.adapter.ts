import type { EmailProvider, EmailMessage, EmailSendResult } from "../interface";

const RESEND_API = "https://api.resend.com";

export class ResendEmailAdapter implements EmailProvider {
  readonly name = "resend";

  constructor(private readonly apiKey: string, private readonly defaultFrom?: string) {}

  async sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
    const from = msg.from ?? this.defaultFrom ?? "noreply@example.com";
    const to = Array.isArray(msg.to) ? msg.to : [msg.to];

    const res = await fetch(`${RESEND_API}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ from, to, subject: msg.subject, html: msg.html, text: msg.text, reply_to: msg.replyTo }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend send failed HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return { messageId: data.id ?? "", accepted: to, rejected: [] };
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const resp = await fetch(`${RESEND_API}/domains`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
