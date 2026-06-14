import type { EmailProvider, EmailMessage, EmailSendResult, EmailCampaign } from "./interface";
import { ResendEmailAdapter } from "./adapters/resend.adapter";
import { SendGridEmailAdapter } from "./adapters/sendgrid.adapter";
import { withProviderTracking, withProviderFallback } from "@/lib/providers/instrumentation";

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
 * Returns an EmailProvider instrumented with usage tracking via withProviderTracking.
 * Records each sendEmail / sendCampaign attempt to provider_usage.
 */
export function createInstrumentedEmailProvider(
  config: EmailConfig & { workspaceId: string },
): EmailProvider {
  const inner = createEmailProvider(config);
  const { workspaceId, provider: providerName } = config;

  return {
    name: inner.name,
    async sendEmail(message: EmailMessage): Promise<EmailSendResult> {
      return withProviderTracking(
        { workspaceId, category: "email", providerName, unitsConsumed: 1, unitType: "email" },
        () => inner.sendEmail(message),
      );
    },
    ...(inner.sendCampaign
      ? {
          async sendCampaign(campaign: EmailCampaign): Promise<{ sent: number; failed: number }> {
            return withProviderTracking(
              {
                workspaceId,
                category: "email",
                providerName,
                unitType: "email",
                unitsExtractor: (r: { sent: number; failed: number }) => r.sent,
              },
              () => inner.sendCampaign!(campaign),
            );
          },
        }
      : {}),
  };
}

/**
 * Creates an EmailProvider that automatically falls back to `fallbackConfig`
 * if the primary provider throws. Both are independently tracked.
 */
export function createEmailProviderWithFallback(
  primaryConfig: EmailConfig & { workspaceId: string },
  fallbackConfig: EmailConfig | null,
): EmailProvider {
  const primary  = createInstrumentedEmailProvider(primaryConfig);
  const fallback = fallbackConfig
    ? createInstrumentedEmailProvider({ ...fallbackConfig, workspaceId: primaryConfig.workspaceId })
    : null;
  const ctx = { category: "email", primaryName: primaryConfig.provider, fallbackName: fallbackConfig?.provider };

  return {
    name: primary.name,
    async sendEmail(message: EmailMessage): Promise<EmailSendResult> {
      return withProviderFallback(() => primary.sendEmail(message), fallback ? () => fallback.sendEmail(message) : null, ctx);
    },
    ...(primary.sendCampaign || fallback?.sendCampaign
      ? {
          async sendCampaign(campaign: EmailCampaign): Promise<{ sent: number; failed: number }> {
            return withProviderFallback(
              () => primary.sendCampaign!(campaign),
              fallback?.sendCampaign ? () => fallback.sendCampaign!(campaign) : null,
              ctx,
            );
          },
        }
      : {}),
  };
}
