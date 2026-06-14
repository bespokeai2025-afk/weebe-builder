import type { EmailProvider, EmailMessage, EmailSendResult, EmailCampaign } from "./interface";
import { ResendEmailAdapter } from "./adapters/resend.adapter";
import { SendGridEmailAdapter } from "./adapters/sendgrid.adapter";
import { trackProviderUsage } from "@/lib/providers/usage.server";

export type EmailProviderName = "resend" | "sendgrid" | "mailgun" | "ses";

export type EmailConfig =
  | { provider: "resend"; apiKey: string; defaultFrom?: string }
  | { provider: "sendgrid"; apiKey: string }
  | { provider: "mailgun"; apiKey: string; domain: string }
  | { provider: "ses"; accessKeyId: string; secretAccessKey: string; region: string };

export function createEmailProvider(config: EmailConfig): EmailProvider {
  switch (config.provider) {
    case "resend":
      return new ResendEmailAdapter(config.apiKey, config.defaultFrom);
    case "sendgrid":
      return new SendGridEmailAdapter(config.apiKey);
    case "mailgun":
    case "ses":
      throw new Error(`Email provider "${config.provider}" not yet implemented. Add an adapter in src/lib/providers/email/adapters/${config.provider}.adapter.ts.`);
    default:
      throw new Error(`Unknown email provider: ${String((config as any).provider)}`);
  }
}

/**
 * Returns an EmailProvider instrumented with usage tracking.
 * Records each sendEmail / sendCampaign attempt to provider_usage.
 */
export function createInstrumentedEmailProvider(
  config: EmailConfig & { workspaceId: string },
): EmailProvider {
  const inner = createEmailProvider(config);
  const { workspaceId, provider: providerName } = config;

  async function track(durationMs: number, isError: boolean) {
    await trackProviderUsage({ workspaceId, category: "email", providerName, durationMs, isError }).catch(() => {});
  }

  return {
    name: inner.name,
    async sendEmail(message: EmailMessage): Promise<EmailSendResult> {
      const t0 = Date.now();
      try {
        const result = await inner.sendEmail(message);
        await track(Date.now() - t0, false);
        return result;
      } catch (err) {
        await track(Date.now() - t0, true);
        throw err;
      }
    },
    ...(inner.sendCampaign
      ? {
          async sendCampaign(campaign: EmailCampaign): Promise<{ sent: number; failed: number }> {
            const t0 = Date.now();
            try {
              const result = await inner.sendCampaign!(campaign);
              await track(Date.now() - t0, false);
              return result;
            } catch (err) {
              await track(Date.now() - t0, true);
              throw err;
            }
          },
        }
      : {}),
  };
}
