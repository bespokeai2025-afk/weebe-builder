import { createHmac, timingSafeEqual } from "crypto";

function safeCompareHex(aHex: string, bHex: string): boolean {
  if (!/^[a-f0-9]+$/i.test(aHex) || !/^[a-f0-9]+$/i.test(bHex)) return false;
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyRetellSignatureWithKey(
  rawBody: string,
  signature: string,
  apiKey: string,
): boolean {
  const parsed = Object.fromEntries(
    signature.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
  const timestamp = parsed.v;
  const digest = parsed.d;

  if (timestamp && digest) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    const ageMs = Math.abs(Date.now() - ts);
    if (ageMs > 5 * 60 * 1000) return false;
    const expected = createHmac("sha256", apiKey).update(`${rawBody}${timestamp}`).digest("hex");
    return safeCompareHex(digest, expected);
  }

  const expectedLegacy = createHmac("sha256", apiKey).update(rawBody).digest("hex");
  return safeCompareHex(signature.trim(), expectedLegacy);
}

/**
 * Verify the HMAC signature on an incoming Retell webhook body.
 *
 * Retell signs custom tool-call webhooks using the workspace Retell API key.
 * Supports both `v=<ts>,d=<digest>` and legacy raw-hex formats.
 */
export function verifyRetellSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RETELL_WEBHOOK_SECRET || process.env.RETELL_API_KEY;
  if (!secret) {
    console.error("[retell] RETELL_WEBHOOK_SECRET / RETELL_API_KEY not set — rejecting request");
    return false;
  }
  if (!signature) return false;
  return verifyRetellSignatureWithKey(rawBody, signature, secret);
}

/**
 * Multi-key variant: try the platform key AND any additional candidate keys
 * (e.g. the workspace-specific Retell API key). Returns true if ANY key matches.
 */
export function verifyRetellSignatureMultiKey(
  rawBody: string,
  signature: string | null,
  candidateKeys: string[],
  options?: { prependKeys?: string[]; skipPlatformKey?: boolean },
): boolean {
  if (!signature) return false;
  const platformSecret = options?.skipPlatformKey
    ? ""
    : process.env.RETELL_WEBHOOK_SECRET || process.env.RETELL_API_KEY || "";
  const allKeys = [
    ...new Set([...(options?.prependKeys ?? []), platformSecret, ...candidateKeys].filter(Boolean)),
  ];
  if (!allKeys.length) {
    console.error("[retell] No Retell secrets available — rejecting request");
    return false;
  }
  for (const secret of allKeys) {
    if (verifyRetellSignatureWithKey(rawBody, signature, secret)) return true;
  }
  return false;
}
