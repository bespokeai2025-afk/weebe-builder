import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify the HMAC signature on an incoming Retell webhook body.
 *
 * Retell signs custom tool-call webhooks using the workspace Retell API key.
 * We check RETELL_WEBHOOK_SECRET first (set this to match the key Retell uses),
 * then fall back to RETELL_API_KEY. If neither is set, requests are rejected.
 */
export function verifyRetellSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RETELL_WEBHOOK_SECRET || process.env.RETELL_API_KEY;
  if (!secret) {
    console.error("[retell] RETELL_WEBHOOK_SECRET / RETELL_API_KEY not set — rejecting request");
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
