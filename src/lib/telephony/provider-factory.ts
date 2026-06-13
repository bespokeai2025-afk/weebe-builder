import type { TelephonyConfig, TelephonyProvider } from "./types";
import { TwilioProvider } from "./twilio.provider";

/**
 * Factory: returns the correct TelephonyProvider for the given config.
 * Adding a new carrier (Telnyx, Plivo, Vonage) requires only a new case here
 * and a corresponding Provider class — agent logic never changes.
 */
export function createTelephonyProvider(config: TelephonyConfig): TelephonyProvider {
  switch (config.provider) {
    case "twilio":
      return new TwilioProvider({
        accountSid: config.account_sid ?? "",
        authToken: config.auth_token ?? "",
      });

    case "telnyx":
    case "plivo":
    case "vonage":
      throw new Error(
        `Provider "${config.provider}" is defined in the interface but not yet implemented. ` +
          `Create src/lib/telephony/${config.provider}.provider.ts implementing TelephonyProvider.`,
      );

    default:
      throw new Error(`Unknown telephony provider: ${String(config.provider)}`);
  }
}
