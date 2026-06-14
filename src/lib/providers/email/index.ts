export type { EmailProvider, EmailMessage, EmailCampaign, EmailSendResult } from "./interface";
export { createEmailProvider, type EmailProviderName, type EmailConfig } from "./factory";
export { ResendEmailAdapter } from "./adapters/resend.adapter";
