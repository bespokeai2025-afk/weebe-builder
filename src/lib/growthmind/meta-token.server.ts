// SERVER ONLY — AES-256-GCM encryption for Meta social access tokens.
// Key is derived from SUPABASE_SERVICE_ROLE_KEY (same convention as the ads
// token encryption) so no extra secret is required. Tokens are stored in
// growthmind_social_connections.access_token_encrypted, a column that is
// excluded from the authenticated role's column grants — it can never reach
// the browser through PostgREST.

import { createHash, createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getKey(): Buffer {
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "meta-social-fallback";
  return createHash("sha256").update(`${raw}:meta-social-token`).digest();
}

export function encryptMetaToken(plain: string): string {
  const iv     = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc    = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptMetaToken(stored: string): string {
  const [ver, ivB64, tagB64, dataB64] = stored.split(".");
  if (ver !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("Unrecognised token format");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}
