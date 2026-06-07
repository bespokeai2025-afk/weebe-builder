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

/**
 * Multi-key variant: try the platform key AND any additional candidate keys
 * (e.g. the workspace-specific Retell API key). Returns true if ANY key matches.
 *
 * Retell signs custom tool-call payloads with the Retell workspace API key that
 * owns the agent. For per-workspace agents that use workspace_settings.retell_workspace_id
 * as their key, the platform RETELL_API_KEY will not match. This function lets
 * each endpoint supply the workspace key as a fallback so verification succeeds.
 */
export function verifyRetellSignatureMultiKey(
  rawBody: string,
  signature: string | null,
  candidateKeys: string[],
): boolean {
  if (!signature) return false;
  const platformSecret = process.env.RETELL_WEBHOOK_SECRET || process.env.RETELL_API_KEY || "";
  const allKeys = [platformSecret, ...candidateKeys].filter(Boolean);
  if (!allKeys.length) {
    console.error("[retell] No Retell secrets available — rejecting request");
    return false;
  }
  for (const secret of allKeys) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    try {
      if (timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return true;
    } catch {
      // Buffer.from(signature) and Buffer.from(expected) have different byte
      // lengths if the hex strings differ in length — not equal, try next key.
    }
  }
  return false;
}
