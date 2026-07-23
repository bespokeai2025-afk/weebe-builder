/** Default WATI host when none is stored (US/global MT). EU tenants use eu-api.wati.io. */
export const DEFAULT_WATI_API_HOST = "live-mt-server.wati.io";

/** Strip protocol/path — store host only, e.g. eu-api.wati.io */
export function normalizeWatiApiHost(input?: string | null): string {
  const raw = input?.trim();
  if (!raw) {
    return (
      process.env.WATI_API_HOST?.trim()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "") || DEFAULT_WATI_API_HOST
    );
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      return new URL(raw).host;
    } catch {
      /* fall through */
    }
  }
  return raw
    .replace(/^https?:\/\//, "")
    .split("/")[0]!
    .replace(/\/$/, "");
}

export function watiApiRoot(tenantId: string, apiHost?: string | null): string {
  return `https://${normalizeWatiApiHost(apiHost)}/${tenantId}`;
}

export function watiApiV1Base(tenantId: string, apiHost?: string | null): string {
  return `${watiApiRoot(tenantId, apiHost)}/api/v1`;
}

export function watiApiV2Base(tenantId: string, apiHost?: string | null): string {
  return `${watiApiRoot(tenantId, apiHost)}/api/v2`;
}

/** WATI API V3 (recommended) — https://docs.wati.io/reference/ */
export function watiApiV3Base(tenantId: string, apiHost?: string | null): string {
  return `${watiApiRoot(tenantId, apiHost)}/api/ext/v3`;
}
