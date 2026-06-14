import type { WhatsAppProvider, WhatsAppMessage, WhatsAppTemplate, WhatsAppBroadcast } from "./interface";
import { WATIWhatsAppAdapter } from "./adapters/wati.adapter";
import { TwilioWhatsAppAdapter } from "./adapters/twilio.adapter";
import { MetaWhatsAppAdapter } from "./adapters/meta.adapter";
import { withProviderTracking, withProviderFallback } from "@/lib/providers/instrumentation";

export type WhatsAppProviderName = "wati" | "twilio" | "meta";

export type WhatsAppConfig =
  | { provider: "wati"; apiEndpoint: string; apiKey: string }
  | { provider: "twilio"; accountSid: string; authToken: string; from: string }
  | { provider: "meta"; accessToken: string; phoneNumberId: string };

/**
 * Create a WhatsAppProvider. When `workspaceId` is included in `config`, every
 * method call is automatically tracked in provider_usage.
 */
export function createWhatsAppProvider(
  config: WhatsAppConfig & { workspaceId?: string },
): WhatsAppProvider {
  let inner: WhatsAppProvider;
  switch (config.provider) {
    case "wati":
      inner = new WATIWhatsAppAdapter({ apiEndpoint: config.apiEndpoint, apiKey: config.apiKey });
      break;
    case "twilio":
      inner = new TwilioWhatsAppAdapter({ accountSid: config.accountSid, authToken: config.authToken, from: config.from });
      break;
    case "meta":
      inner = new MetaWhatsAppAdapter({ accessToken: config.accessToken, phoneNumberId: config.phoneNumberId });
      break;
    default:
      throw new Error(`Unknown WhatsApp provider: ${String((config as any).provider)}`);
  }

  if (!config.workspaceId) return inner;

  const { workspaceId, provider: providerName } = config;

  return {
    name: inner.name,
    sendMessage: (msg: WhatsAppMessage) =>
      withProviderTracking(
        { workspaceId, category: "whatsapp", providerName, unitsConsumed: 1, unitType: "message" },
        () => inner.sendMessage(msg),
      ),
    sendTemplate: (msg: WhatsAppTemplate) =>
      withProviderTracking(
        { workspaceId, category: "whatsapp", providerName, unitsConsumed: 1, unitType: "message" },
        () => inner.sendTemplate(msg),
      ),
    sendBroadcast: (b: WhatsAppBroadcast) =>
      withProviderTracking(
        {
          workspaceId,
          category: "whatsapp",
          providerName,
          unitType: "message",
          unitsExtractor: (r: { sent: number; failed: number }) => r.sent,
        },
        () => inner.sendBroadcast(b),
      ),
  };
}

/** @deprecated Use createWhatsAppProvider({ ..., workspaceId }) instead. */
export const createInstrumentedWhatsAppProvider = (
  config: WhatsAppConfig & { workspaceId: string },
): WhatsAppProvider => createWhatsAppProvider(config);

/**
 * Creates a WhatsAppProvider that automatically falls back to `fallbackConfig`
 * if any primary operation throws. Both providers are independently tracked.
 */
export function createWhatsAppProviderWithFallback(
  primaryConfig: WhatsAppConfig & { workspaceId: string },
  fallbackConfig: WhatsAppConfig | null,
): WhatsAppProvider {
  const primary  = createWhatsAppProvider(primaryConfig);
  const fallback = fallbackConfig
    ? createWhatsAppProvider({ ...fallbackConfig, workspaceId: primaryConfig.workspaceId })
    : null;
  const ctx = { category: "whatsapp", primaryName: primaryConfig.provider, fallbackName: fallbackConfig?.provider };

  return {
    name: primary.name,
    sendMessage:   (msg: WhatsAppMessage)  => withProviderFallback(() => primary.sendMessage(msg),   fallback ? () => fallback.sendMessage(msg)   : null, ctx),
    sendTemplate:  (msg: WhatsAppTemplate) => withProviderFallback(() => primary.sendTemplate(msg),  fallback ? () => fallback.sendTemplate(msg)  : null, ctx),
    sendBroadcast: (b:   WhatsAppBroadcast)=> withProviderFallback(() => primary.sendBroadcast(b),   fallback ? () => fallback.sendBroadcast(b)   : null, ctx),
  };
}
