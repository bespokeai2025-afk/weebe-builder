/**
 * One-off diagnostic: confirms what this running server actually has loaded for the WBAH Retell
 * cutover, without ever exposing a real secret over the wire.
 *
 * Every key reports only its length and the first 8 hex characters of its SHA-256 — enough to
 * compare "is this exactly the value I think I set" against a value I already have on the other
 * end (compute the same hash locally and compare prefixes), impossible to reverse into the key
 * itself. Delete this route once the cutover is confirmed working; it has no reason to stay.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { getWbahAdditionalRetellApiKeys } from "@/lib/wbah/post-call/wbah-retell-agents.shared";

function fingerprint(value: string): { length: number; sha256_8: string } {
  return {
    length: value.length,
    sha256_8: createHash("sha256").update(value).digest("hex").slice(0, 8),
  };
}

export const Route = createFileRoute("/api/public/wbah-env-check")({
  server: {
    handlers: {
      GET: async () => {
        const publicBaseUrl =
          process.env.PUBLIC_BASE_URL?.trim() ||
          process.env.WEBEE_PUBLIC_URL?.trim() ||
          process.env.PUBLIC_URL?.trim() ||
          null;

        const additionalKeys = getWbahAdditionalRetellApiKeys();
        const primaryRetellKey = process.env.RETELL_API_KEY?.trim() || null;

        return new Response(
          JSON.stringify(
            {
              host: process.env.HOSTNAME || process.env.HOST || null,
              public_base_url: publicBaseUrl, // not a secret, safe to show in full
              wbah_additional_retell_keys: additionalKeys.map(fingerprint),
              wbah_additional_retell_keys_raw_env_vars_checked: [
                "WBAH_RETELL_NEW_WORKSPACE_API_KEY",
                "WBAH_RETELL_ADDITIONAL_API_KEYS",
                "WBAH_RETELL_LEGACY_API_KEY",
              ],
              primary_retell_api_key: primaryRetellKey ? fingerprint(primaryRetellKey) : null,
            },
            null,
            2,
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
