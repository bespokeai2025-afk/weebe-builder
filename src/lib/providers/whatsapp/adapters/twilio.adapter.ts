import type { WhatsAppProvider, WhatsAppMessage, WhatsAppTemplate, WhatsAppBroadcast } from "../interface";

// TODO: implement — delegate to Twilio WhatsApp Business API
// Docs: https://www.twilio.com/docs/whatsapp
export class TwilioWhatsAppAdapter implements WhatsAppProvider {
  readonly name = "twilio";

  constructor(private readonly _config: { accountSid: string; authToken: string; from: string }) {}

  async sendMessage(_msg: WhatsAppMessage): Promise<{ messageId: string }> {
    throw new Error("Twilio WhatsApp provider not yet implemented.");
  }

  async sendTemplate(_msg: WhatsAppTemplate): Promise<{ messageId: string }> {
    throw new Error("Twilio WhatsApp provider not yet implemented.");
  }

  async sendBroadcast(_broadcast: WhatsAppBroadcast): Promise<{ sent: number; failed: number }> {
    throw new Error("Twilio WhatsApp provider not yet implemented.");
  }
}
