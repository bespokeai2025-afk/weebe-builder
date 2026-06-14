import type { WhatsAppProvider, WhatsAppMessage, WhatsAppTemplate, WhatsAppBroadcast } from "./interface";
import { WATIWhatsAppAdapter } from "./adapters/wati.adapter";
import { TwilioWhatsAppAdapter } from "./adapters/twilio.adapter";
import { MetaWhatsAppAdapter } from "./adapters/meta.adapter";
import { withProviderTracking } from "@/lib/providers/instrumentation";

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
  const track = <T>(fn: () => Promise<T>) =>
    withProviderTracking({ workspaceId, category: "whatsapp", providerName }, fn);

  return {
    name: inner.name,
    sendMessage: (msg: WhatsAppMessage) => track(() => inner.sendMessage(msg)),
    sendTemplate: (msg: WhatsAppTemplate) => track(() => inner.sendTemplate(msg)),
    sendBroadcast: (b: WhatsAppBroadcast) => track(() => inner.sendBroadcast(b)),
  };
}

/** @deprecated Use createWhatsAppProvider({ ..., workspaceId }) instead. */
export const createInstrumentedWhatsAppProvider = (
  config: WhatsAppConfig & { workspaceId: string },
): WhatsAppProvider => createWhatsAppProvider(config);
