import type { EmailProvider, EmailMessage, EmailSendResult } from "../interface";

// TODO: implement — connect to SendGrid v3 API
// Docs: https://docs.sendgrid.com/api-reference/mail-send/mail-send
export class SendGridEmailAdapter implements EmailProvider {
  readonly name = "sendgrid";

  constructor(private readonly _apiKey: string) {}

  async sendEmail(_msg: EmailMessage): Promise<EmailSendResult> {
    throw new Error("SendGrid email provider not yet implemented.");
  }
}
