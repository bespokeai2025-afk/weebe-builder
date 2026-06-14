export interface EmailMessage {
  to: string | string[];
  from?: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface EmailCampaign {
  recipients: string[];
  subject: string;
  html: string;
  scheduledAt?: string;
}

export interface EmailSendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

export interface EmailProvider {
  readonly name: string;
  sendEmail(msg: EmailMessage): Promise<EmailSendResult>;
  sendCampaign?(campaign: EmailCampaign): Promise<{ sent: number; failed: number }>;
}
