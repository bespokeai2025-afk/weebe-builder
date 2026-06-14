export interface WhatsAppMessage {
  to: string;
  body: string;
  from?: string;
  mediaUrl?: string;
}

export interface WhatsAppTemplate {
  to: string;
  templateName: string;
  parameters?: string[];
  from?: string;
}

export interface WhatsAppBroadcast {
  recipients: string[];
  body: string;
  templateName?: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendMessage(msg: WhatsAppMessage): Promise<{ messageId: string }>;
  sendTemplate(msg: WhatsAppTemplate): Promise<{ messageId: string }>;
  sendBroadcast(broadcast: WhatsAppBroadcast): Promise<{ sent: number; failed: number }>;
  healthCheck?(): Promise<boolean>;
}
