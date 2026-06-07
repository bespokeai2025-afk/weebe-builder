import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify the HMAC signature on an incoming Retell webhook body.
 *
 * If RETELL_WEBHOOK_SECRET is not configured we fall back to "open" mode
 * (logs a warning) so the system still works during initial setup. Set the
 * secret before going live so the public endpoints are not callable by
 * arbitrary third parties.
 */
export function verifyRetellSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RETELL_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[retell] RETELL_WEBHOOK_SECRET not set — rejecting request");
    return false;
  }
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
