import type { WhatsAppProvider, WhatsAppMessage, WhatsAppTemplate, WhatsAppBroadcast } from "../interface";

// TODO: implement — delegate to Meta Cloud WhatsApp Business API
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
export class MetaWhatsAppAdapter implements WhatsAppProvider {
  readonly name = "meta";

  constructor(private readonly _config: { accessToken: string; phoneNumberId: string }) {}

  async sendMessage(_msg: WhatsAppMessage): Promise<{ messageId: string }> {
    throw new Error("Meta WhatsApp Cloud API provider not yet implemented.");
  }

  async sendTemplate(_msg: WhatsAppTemplate): Promise<{ messageId: string }> {
    throw new Error("Meta WhatsApp Cloud API provider not yet implemented.");
  }

  async sendBroadcast(_broadcast: WhatsAppBroadcast): Promise<{ sent: number; failed: number }> {
    throw new Error("Meta WhatsApp Cloud API provider not yet implemented.");
  }
}
