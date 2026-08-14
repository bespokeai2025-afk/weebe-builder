/**
 * Twilio environment resolution, shared by number provisioning and dialling.
 *
 * Deliberately import-free. Both the Vite config (via the campaign-scheduler
 * plugin) and server functions reach this code, and the config is loaded by Node
 * without the `@/` alias — anything imported here with an alias breaks
 * `vite dev` at startup rather than at call time.
 */

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

/**
 * Platform-level Twilio credentials.
 *
 * Deliberately env-only, matching `telephony.functions.ts`: the
 * `telephony_configs` table has credential columns from an earlier design but
 * they are never written, so reading them would silently pick up empty strings.
 */
export function resolveTwilioCredentials(): TwilioCredentials {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  if (!accountSid || !authToken) {
    throw new Error(
      "Twilio is not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to the environment.",
    );
  }
  return { accountSid, authToken };
}

/** Public origin Twilio must call back on. */
export function resolvePublicHost(): string {
  const host =
    process.env.PUBLIC_BASE_URL?.trim() ||
    process.env.WEBEE_PUBLIC_URL?.trim() ||
    process.env.PUBLIC_URL?.trim() ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
  if (!host) {
    throw new Error(
      "No public URL configured. Set PUBLIC_BASE_URL so Twilio can reach the inbound webhook.",
    );
  }
  return host.replace(/\/$/, "");
}

/**
 * Webhook configuration applied to every number we own.
 *
 * `voiceUrl` is the one that matters: it returns TwiML connecting the call to the
 * gateway's media stream. A number without it rings and then plays Twilio's
 * default message.
 */
export function buildNumberWebhooks(host = resolvePublicHost()) {
  return {
    voiceUrl: `${host}/api/public/telephony/inbound`,
    voiceMethod: "POST" as const,
    statusCallback: `${host}/api/public/telephony/status`,
    statusCallbackMethod: "POST" as const,
  };
}
